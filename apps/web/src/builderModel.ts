import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { BuilderDef } from './builders.js';

/**
 * Chargement et preparation d'un modele d'ouvrier, quel qu'il soit.
 *
 * Ce module ne connait AUCUN modele en particulier : tout ce qui varie d'un
 * ouvrier a l'autre est soit declare par le .glb lui-meme dans ses `extras`,
 * soit repris du catalogue (builders.ts) pour les fichiers qui ne declarent
 * rien. Ajouter un ouvrier ne demande donc pas d'y toucher.
 *
 * Ce n'est pas la pipeline des creeps (animatedCreepModel.ts) : ceux-la sont
 * fusionnes et rendus en InstancedMesh parce qu'il y en a des centaines. Ici
 * il n'y en a qu'UN a l'ecran — on n'observe qu'une arene a la fois — donc
 * aucune instanciation, aucun cache de geometrie, aucune fusion. Ce n'est pas
 * un SkinnedMesh non plus : ces modeles n'ont aucun skin, ce sont des
 * assemblages de pieces rigides animees par transformations de noeuds, la
 * meme famille que les modeles de tours.
 */

/** Hauteur visee du personnage en unites de scene. Les modeles annoncent
 * ~1.65 : sans mise a l'echelle l'ouvrier serait plus petit que les creeps,
 * alors que c'est le personnage le plus important de l'ecran. */
export const BUILDER_TARGET_HEIGHT = 2.0;

/** Extras que ce module sait lire a la racine du .glb. Tous optionnels. */
interface BuilderExtras {
  /** Hauteur du PERSONNAGE en metres, accessoires exclus. */
  heightMeters?: number;
  /** Nom du materiau portant la couleur du joueur (convention du projet, la
   * meme que les modeles de tours — voir MODEL_TEAM_MATERIAL). */
  teamColorMaterial?: string;
  /** Accessoires sortis par chaque clip : { clip: [noeuds] }. Certains
   * modeles y mettent une phrase en prose — d'ou le test de forme. */
  actionProps?: Record<string, string[]> | string;
}

export interface BuilderModel {
  /** Hierarchie source, a cloner. */
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  /** Facteur a appliquer pour atteindre BUILDER_TARGET_HEIGHT. */
  scale: number;
  /** Decalage vertical, DEJA mis a l'echelle, pour que les pieds reposent sur
   * le sol quand l'origine du modele n'est pas a ses pieds. */
  footOffset: number;
  /** Materiaux a reteindre a la couleur du joueur. Le premier sert de
   * reference de clarte (voir tintTeam). Vide si le modele n'en declare aucun
   * et que le catalogue n'en fournit pas. */
  teamMaterials: readonly string[];
}

/** Un modele par URL : changer d'ouvrier entre deux parties ne recharge pas
 * celui qu'on a deja lu. */
const cache = new Map<string, Promise<BuilderModel | null>>();

/** Boite englobante du PERSONNAGE seul, accessoires exclus. */
function characterBox(root: THREE.Object3D, accessoryRoots: readonly string[]): THREE.Box3 {
  const accessories = new Set<THREE.Object3D>();
  for (const name of accessoryRoots) {
    const node = root.getObjectByName(name);
    if (node) node.traverse((o) => accessories.add(o));
  }
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || accessories.has(o)) return;
    box.expandByObject(mesh);
  });
  return box;
}

/** Accessoires a ignorer dans la mesure de hauteur : declares par le fichier
 * quand `actionProps` est une table clip -> noeuds, sinon repris du catalogue. */
function accessoryRootsOf(extras: BuilderExtras, def: BuilderDef): readonly string[] {
  const props = extras.actionProps;
  if (props && typeof props === 'object') {
    return [...new Set(Object.values(props).flat())];
  }
  return def.accessoryRoots ?? [];
}

/**
 * Charge et prepare un modele, une seule fois par URL. Un echec est journalise
 * et renvoie null : le jeu doit rester jouable sans l'ouvrier a l'ecran (la
 * simulation, elle, ne depend d'aucun modele).
 */
export function loadBuilderModel(def: BuilderDef): Promise<BuilderModel | null> {
  const hit = cache.get(def.url);
  if (hit) return hit;

  const pending = new Promise<BuilderModel | null>((resolve) => {
    new GLTFLoader().load(
      def.url,
      (gltf) => {
        const scene = gltf.scene;
        // Les extras de la RACINE du fichier : three.js ne les recopie nulle
        // part (assignExtrasToUserData ne traite que scenes/noeuds/materiaux),
        // il faut donc les lire sur le json du parser.
        const extras = ((gltf.parser as { json?: { extras?: BuilderExtras } } | undefined)?.json?.extras ??
          {}) as BuilderExtras;

        const teamMaterials = extras.teamColorMaterial
          ? [extras.teamColorMaterial]
          : (def.teamMaterials ?? []);
        if (teamMaterials.length === 0) {
          console.warn(`[builder] ${def.id} : aucun materiau d'equipe declare, il gardera sa couleur d'origine`);
        }

        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
            | THREE.MeshStandardMaterial
            | undefined;
          if (!src) return;
          // MeshLambertMaterial comme le reste du jeu (tours, creeps) : meme
          // reponse a l'eclairage, bien moins couteux que le PBR livre par
          // l'exportateur.
          const m = new THREE.MeshLambertMaterial({ color: src.color?.clone() ?? new THREE.Color(0xffffff) });
          m.name = src.name;
          // La transparence se lit sur le materiau SOURCE (GLTFLoader pose ce
          // drapeau pour alphaMode BLEND) plutot que sur une liste de noms :
          // les noms changent d'un modele a l'autre, pas la semantique.
          if (src.transparent) {
            m.transparent = true;
            m.opacity = src.opacity ?? 1;
            // Sans ca chaque face transparente ecrit dans le depth buffer et
            // masque celles situees derriere elle.
            m.depthWrite = false;
            m.side = THREE.DoubleSide;
          }
          mesh.material = m;
        });

        const box = characterBox(scene, accessoryRootsOf(extras, def));
        const measured = box.max.y - box.min.y;
        // Hauteur ANNONCEE de preference a la mesure : la boite englobante
        // brute inclut les accessoires deployes en pose de repos.
        const declared = typeof extras.heightMeters === 'number' ? extras.heightMeters : measured;
        const scale = BUILDER_TARGET_HEIGHT / (declared || 1);

        const clips = new Map<string, THREE.AnimationClip>();
        for (const c of gltf.animations) clips.set(c.name, c);

        resolve({ scene, clips, scale, footOffset: -box.min.y * scale, teamMaterials });
      },
      undefined,
      (err) => {
        console.warn(`[builder] modele ${def.url} illisible, l'ouvrier ne sera pas affiche`, err);
        resolve(null);
      },
    );
  });
  cache.set(def.url, pending);
  return pending;
}

/**
 * Reteint les materiaux d'equipe d'un clone a la couleur d'un joueur.
 *
 * Travaille en HSL : teinte et saturation viennent du joueur, la clarte de
 * chaque materiau garde son ECART a celle du premier de la liste. Un modele
 * dont l'identite tient dans plusieurs materiaux (un reflet plus clair, des
 * coutures plus sombres) garde donc son modele d'ombrage une fois reteint, au
 * lieu de s'aplatir sur un aplat uniforme.
 */
export function tintTeam(instance: THREE.Object3D, color: THREE.Color, teamMaterials: readonly string[]): void {
  if (teamMaterials.length === 0) return;
  const team: THREE.MeshLambertMaterial[] = [];
  instance.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshLambertMaterial;
    if (!m?.name || !teamMaterials.includes(m.name)) return;
    // La couleur d'origine se memorise SUR CHAQUE MATERIAU, jamais par nom :
    // la conversion au chargement cree un materiau par mesh, donc plusieurs
    // portent le meme nom. Les indexer par nom ne memorisait la couleur que
    // pour le premier de chaque nom, et reteinter lisait ensuite `undefined`
    // sur les autres — l'exception interrompait la teinte a mi-parcours et
    // laissait le personnage dans sa couleur d'origine.
    if (!m.userData.originalColor) m.userData.originalColor = m.color.clone();
    team.push(m);
  });

  if (team.length === 0) {
    console.warn(`[builder] materiaux d'equipe introuvables dans le modele (attendus : ${teamMaterials.join(', ')})`);
    return;
  }

  const base = team.find((m) => m.name === teamMaterials[0]) ?? team[0]!;
  const baseHsl = { h: 0, s: 0, l: 0 };
  (base.userData.originalColor as THREE.Color).getHSL(baseHsl);
  const target = { h: 0, s: 0, l: 0 };
  color.getHSL(target);

  for (const m of team) {
    const own = { h: 0, s: 0, l: 0 };
    (m.userData.originalColor as THREE.Color).getHSL(own);
    const l = THREE.MathUtils.clamp(target.l + (own.l - baseHsl.l), 0.04, 0.96);
    m.color.setHSL(target.h, target.s, l);
  }
}
