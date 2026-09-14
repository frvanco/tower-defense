import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Chargement et preparation du modele de l'ouvrier.
 *
 * Ce modele N'EST PAS un creep et n'emprunte rien a leur pipeline
 * (animatedCreepModel.ts / creepVisualCache.ts) : les creeps sont fusionnes et
 * rendus en InstancedMesh parce qu'il y en a des centaines. Ici il n'y en a
 * qu'UN seul a l'ecran — on n'observe jamais qu'une arene a la fois — donc
 * aucune instanciation, aucun cache, aucune fusion : une hierarchie de noeuds
 * clonee telle quelle et un AnimationMixer standard.
 *
 * Ce n'est pas un SkinnedMesh non plus : ce .glb n'a AUCUN skin (`skins: []`,
 * attributs POSITION/NORMAL seulement). C'est un assemblage de 45 pieces
 * rigides, anime par transformations de noeuds — la meme famille que les
 * modeles de tours (packages/renderer/src/towers/fromModel.ts).
 */

const MODEL_URL = '/models/builders/n1_builder.glb';

/** Hauteur visee du personnage en unites de scene. Le modele annonce 1.65
 * (extras.heightMeters) : sans mise a l'echelle il serait plus petit que les
 * creeps, alors que c'est le personnage le plus important de l'ecran. */
export const BUILDER_TARGET_HEIGHT = 2.0;

/** Sous-arbres d'accessoires, exclus de la mesure de hauteur et d'appui au
 * sol : leur taille au repos ne represente pas le personnage (la station
 * radio fait a elle seule ~2 unites de large). Leur VISIBILITE est pilotee
 * par les pistes de scale des animations — aucun code ne doit y toucher. */
const ACCESSORY_ROOTS = ['Hammer', 'CallEquipment', 'Holograms', 'JetpackFlames'];

/** Les trois materiaux qui portent l'identite rouge du personnage. Ce modele
 * n'a pas de materiau nomme `TeamColor` (convention des tours, voir
 * MODEL_TEAM_MATERIAL) ni la moindre vertex color : le rouge vient
 * exclusivement de ces trois-la, soit 8.9% des triangles. Les teinter tous
 * les trois donne donc bien au builder la couleur de son joueur. */
const TEAM_MATERIALS = ['Builder_vermilion', 'Cap_highlight', 'Red_seams'];
/** Celui dont la clarte sert de reference : les deux autres gardent leur
 * ecart relatif (un reflet plus clair, des coutures plus sombres) une fois
 * reteints, au lieu de s'aplatir sur une seule couleur. */
const TEAM_BASE_MATERIAL = 'Builder_vermilion';

/** Materiaux transparents du modele. Ils sont en alphaMode BLEND et
 * doubleSided : sans depthWrite a false, chacun ecrit dans le depth buffer et
 * masque les faces transparentes situees derriere lui (l'hologramme s'auto-
 * decoupe, le panache du jetpack troue la flamme). */
const BLENDED_MATERIALS = new Set(['Hologram_glass', 'Jet_plume']);

export interface BuilderModel {
  /** Hierarchie source, a cloner. */
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  /** Facteur a appliquer pour atteindre BUILDER_TARGET_HEIGHT. */
  scale: number;
  /** Decalage vertical, DEJA mis a l'echelle, a ajouter pour que les pieds
   * reposent sur le sol : l'origine du modele n'est pas a ses pieds. */
  footOffset: number;
  /** Materiaux d'equipe du clone, a reteindre par joueur — voir tintTeam. */
  teamMaterialNames: readonly string[];
}

let pending: Promise<BuilderModel | null> | null = null;

/** Boite englobante du PERSONNAGE seul, accessoires exclus. */
function characterBox(root: THREE.Object3D): THREE.Box3 {
  const accessories = new Set<THREE.Object3D>();
  for (const name of ACCESSORY_ROOTS) {
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

/**
 * Charge le .glb une seule fois. Un echec est journalise et renvoie null : le
 * jeu doit rester jouable sans l'ouvrier a l'ecran (la simulation, elle, ne
 * depend d'aucun modele).
 */
export function loadBuilderModel(): Promise<BuilderModel | null> {
  if (pending) return pending;
  pending = new Promise<BuilderModel | null>((resolve) => {
    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        const scene = gltf.scene;

        for (const obj of scene.children) obj.updateMatrixWorld(true);
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
            | THREE.MeshStandardMaterial
            | undefined;
          if (!src) return;
          // MeshLambertMaterial comme le reste du jeu (tours, creeps) : meme
          // reponse a l'eclairage de la scene, et bien moins couteux que le
          // standard PBR livre par l'exportateur.
          const m = new THREE.MeshLambertMaterial({ color: src.color?.clone() ?? new THREE.Color(0xffffff) });
          m.name = src.name;
          if (BLENDED_MATERIALS.has(src.name)) {
            m.transparent = true;
            m.opacity = src.opacity ?? 1;
            m.depthWrite = false;
            m.side = THREE.DoubleSide;
          }
          mesh.material = m;
        });

        // Hauteur annoncee par le modele plutot que mesuree : la boite
        // englobante brute inclut les accessoires deployes en pose de repos et
        // surestimerait le personnage de 30%.
        const extras = (scene.userData ?? {}) as { heightMeters?: number };
        const box = characterBox(scene);
        const measured = box.max.y - box.min.y;
        const declared = typeof extras.heightMeters === 'number' ? extras.heightMeters : measured;
        const scale = BUILDER_TARGET_HEIGHT / (declared || 1);

        const clips = new Map<string, THREE.AnimationClip>();
        for (const c of gltf.animations) clips.set(c.name, c);

        resolve({
          scene,
          clips,
          scale,
          footOffset: -box.min.y * scale,
          teamMaterialNames: TEAM_MATERIALS,
        });
      },
      undefined,
      (err) => {
        console.warn(`[builder] modele ${MODEL_URL} illisible, l'ouvrier ne sera pas affiche`, err);
        resolve(null);
      },
    );
  });
  return pending;
}

/**
 * Reteint les materiaux d'equipe d'un clone a la couleur d'un joueur.
 *
 * Travaille en HSL : la teinte et la saturation viennent du joueur, la clarte
 * de chaque materiau garde son ECART a celle du materiau de reference. Le
 * reflet de casquette reste donc plus clair et les coutures plus sombres que
 * le vetement principal, dans la nouvelle couleur — au lieu des trois pieces
 * aplaties sur un aplat uniforme.
 */
export function tintTeam(instance: THREE.Object3D, color: THREE.Color): void {
  const team: THREE.MeshLambertMaterial[] = [];
  instance.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshLambertMaterial;
    if (!m?.name || !TEAM_MATERIALS.includes(m.name)) return;
    // La couleur d'origine se memorise SUR CHAQUE MATERIAU, jamais par nom :
    // la conversion au chargement cree un materiau par mesh, donc plusieurs
    // portent le meme nom. Les indexer par nom ne memorisait la couleur que
    // pour le premier de chaque nom, et reteinter lisait ensuite `undefined`
    // sur les autres — l'exception interrompait la teinte a mi-parcours et
    // laissait le personnage dans sa couleur d'origine.
    if (!m.userData.originalColor) m.userData.originalColor = m.color.clone();
    team.push(m);
  });

  // Un modele dont les materiaux d'equipe auraient ete renommes se rendrait
  // en rouge pour tous les joueurs, silencieusement : le signaler une fois
  // vaut mieux que de le chercher a l'oeil sur une silhouette de 25 pixels.
  if (team.length === 0) {
    console.warn(`[builder] aucun materiau d'equipe trouve (attendus : ${TEAM_MATERIALS.join(', ')})`);
    return;
  }

  const base = team.find((m) => m.name === TEAM_BASE_MATERIAL) ?? team[0]!;
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
