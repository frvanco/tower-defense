import * as THREE from 'three';
import type { TowerDef } from '@tower-defense/data';
import { teamMaterial, registerSharedTowerMaterial } from '../materials.js';
import { MAX_RADIUS, measureSweptRadius } from '../footprint.js';
import { deriveTowerVisual } from './types.js';
import { makeScaffold } from './cannon.js';

/**
 * Convention de nommage attendue dans les .glb de tours (voir
 * apps/web/public/models/towers/README.md). Un noeud absent n'est jamais une
 * erreur fatale : la tour se rend quand meme, elle perd juste la capacite
 * correspondante (une tour sans `Turret_Yaw` ne pivote pas vers sa cible).
 */
export const MODEL_TURRET_NODE = 'Turret_Yaw';
export const MODEL_MUZZLE_NODE = 'Muzzle_01';
/** Materiau dont la couleur est remplacee par celle du joueur proprietaire. */
export const MODEL_TEAM_MATERIAL = 'TeamColor';
/** Clip joue a chaque tir (recul du canon). Optionnel : un modele sans ce clip
 * se rend et vise normalement, il ne recule simplement pas. */
export const MODEL_FIRE_CLIP = 'Fire';

const DEFAULT_TEAM_COLOR = 0xc0392b;

/**
 * Marge sous MAX_RADIUS pour le calcul d'echelle. Son SEUL role est d'eviter
 * qu'un modele authore pile a la limite ne tombe exactement dessus, ou le test
 * strict `radius > MAX_RADIUS` se deciderait au dernier bit (meme piege que le
 * plafond de largeur des tours procedurales, voir MAX_WIDTH dans types.ts).
 *
 * Volontairement TENUE. Une marge large ne protege de rien de plus : la mise a
 * l'echelle est une multiplication uniforme, l'ecart entre le rayon extrapole
 * et le rayon mesure est de l'ordre de 1e-15, pas du pourcent. En revanche
 * elle coute de la hauteur a tout modele qui tient legitimement — mesure sur
 * la Moissonneuse (Cadence palier 5), dont le rayon a pleine hauteur vaut
 * 1.1889 pour 1.200 admis : a 2% de marge elle etait rabotee de 1.1% sans
 * qu'aucun debordement ne la menace.
 */
const FOOTPRINT_SAFETY = 0.995;

export interface PreparedTowerModel {
  /** Scene du .glb, materiaux deja convertis et partages. Jamais ajoutee telle
   * quelle a une scene : c'est le gabarit que `makeModelTower` clone. */
  source: THREE.Object3D;
  /** Hauteur du modele dans ses unites naturelles — sert a le normaliser sur
   * la hauteur imposee par son palier. */
  naturalHeight: number;
  /** Rayon balaye dans ses unites naturelles (distance max d'un sommet a
   * l'axe vertical, pas le coin de la boite englobante qui sur-estime). */
  naturalRadius: number;
  /** Clip de recul, ou null si le modele n'en a pas. */
  fireClip: THREE.AnimationClip | null;
}

/**
 * Prepare un .glb charge pour servir de gabarit : convertit ses materiaux une
 * seule fois et mesure ses proportions. A appeler UNE fois par fichier, le
 * resultat etant ensuite clone par tour construite.
 *
 * Les materiaux sont convertis en MeshLambertMaterial (donc eclaires par la
 * scene) plutot que laisses en MeshStandardMaterial du glTF : les cinq autres
 * branches sont procedurales et en Lambert, melanger du PBR et du Lambert sous
 * les memes lumieres se voit. Les couleurs, elles, viennent des COLOR_0 du
 * fichier (`vertexColors`), donc la palette de l'auteur est respectee.
 *
 * A l'inverse des creeps, PAS de `toneMapped: false` ni de MeshBasicMaterial :
 * les creeps sont petits et facettes, l'ambiant bleute de la scene les
 * delavait ; une tour est grande et doit rester eclairee comme le decor.
 */
export function prepareTowerModel(
  scene: THREE.Object3D,
  animations: readonly THREE.AnimationClip[] = [],
): PreparedTowerModel {
  scene.updateMatrixWorld(true);

  for (const obj of collectMeshes(scene)) {
    const src = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (!src) continue;
    const isTeam = src.name === MODEL_TEAM_MATERIAL;
    const converted = new THREE.MeshLambertMaterial({
      // Les meshes d'equipe n'ont pas de COLOR_0 : leur couleur est celle du
      // joueur, injectee par instance dans makeModelTower.
      vertexColors: !!obj.geometry.getAttribute('color'),
      color: (src as THREE.MeshStandardMaterial).color?.clone() ?? new THREE.Color(0xffffff),
    });
    converted.name = src.name;
    // Partage entre TOUTES les tours issues de ce modele : jamais dispose par
    // instance (voir registerSharedTowerMaterial).
    registerSharedTowerMaterial(converted);
    obj.material = converted;
    // Les geometries sont partagees avec les clones pour la meme raison —
    // marquees ici, respectees par le nettoyage cote jeu.
    obj.userData.sharedGeometry = true;
    obj.userData.isTeamMesh = isTeam;
    obj.castShadow = true;
    obj.receiveShadow = true;
  }

  const box = new THREE.Box3().setFromObject(scene);
  return {
    source: scene,
    naturalHeight: Math.max(1e-6, box.max.y - box.min.y),
    naturalRadius: Math.max(1e-6, measureSweptRadius(scene)),
    fireClip: animations.find((a) => a.name === MODEL_FIRE_CLIP) ?? null,
  };
}

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) out.push(m);
  });
  return out;
}

/**
 * Construit une tour a partir d'un modele prepare, au MEME contrat que
 * `makeCannonTower` / `makePlaceholderTower` : meme `userData` (dont `body`,
 * `turret` et `muzzle` par reference) et memes enfants cherches par nom
 * (`body`, `scaffold`, `rangeRing`, `progress`, `footprint`). Le reste du jeu
 * ne fait donc aucune distinction entre une tour procedurale et une tour
 * modelisee.
 *
 * L'echelle vient de la hauteur du PALIER (voir TOWER_HEIGHT_BY_TIER), pas de
 * la taille du fichier : redimensionner un .glb n'a aucun effet, exactement
 * comme pour les creeps. Elle est en revanche PLAFONNEE pour que l'emprise au
 * sol tienne dans la case — un modele trop large finit plus petit que la
 * hauteur cible plutot que de mordre sur ses voisines.
 */
export function makeModelTower(
  model: PreparedTowerModel,
  def: TowerDef,
  tier: number,
  chainLength: number,
  teamColor: number = DEFAULT_TEAM_COLOR,
): THREE.Group {
  const visual = deriveTowerVisual(def, tier, chainLength);

  const byHeight = visual.height / model.naturalHeight;
  const byFootprint = (MAX_RADIUS * FOOTPRINT_SAFETY) / model.naturalRadius;
  const scale = Math.min(byHeight, byFootprint);

  // Un modele trop large pour sa case est reduit plutot que laisse a deborder
  // — mais SILENCIEUSEMENT, il passerait inapercu : la tour se rend juste plus
  // petite que son palier, ce qui ne ressemble pas a une erreur. On le signale
  // donc, avec le rapport a viser au reexport (la hauteur est imposee par le
  // palier, c'est la LARGEUR du modele qui doit ceder).
  if (byFootprint < byHeight) {
    const maxRatio = (MAX_RADIUS * FOOTPRINT_SAFETY) / visual.height;
    console.warn(
      `[emprise] ${def.name} (palier ${tier + 1}) est trop large pour sa case : reduit a ` +
        `${(model.naturalHeight * scale).toFixed(2)} au lieu de ${visual.height.toFixed(2)} ` +
        `(-${((1 - scale / byHeight) * 100).toFixed(0)}%). Rapport rayon/hauteur du modele ` +
        `${(model.naturalRadius / model.naturalHeight).toFixed(3)}, maximum admis ${maxRatio.toFixed(3)}.`,
    );
  }

  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  g.add(body);

  // Le clone partage geometries ET materiaux avec la source (pas de skin dans
  // ces modeles, `clone()` suffit — SkeletonUtils serait necessaire sinon).
  const instance = model.source.clone(true);
  instance.scale.setScalar(scale);
  body.add(instance);

  // Couleur du joueur : seuls les meshes portant le materiau d'equipe sont
  // repeints, avec le materiau partage par couleur (teamMaterial est deja
  // mis en cache et declare partage).
  for (const mesh of collectMeshes(instance)) {
    if (mesh.userData.isTeamMesh) mesh.material = teamMaterial(teamColor);
  }

  // Les noeuds gardent LEUR nom d'origine, on n'expose que des references :
  // un AnimationClip cible ses noeuds par NOM, renommer `Turret_Yaw` ou
  // `Muzzle_01` casserait silencieusement tout clip qui les anime le jour ou
  // un modele en aura un (celui-ci n'anime que `Barrel_Recoil`).
  const turret = instance.getObjectByName(MODEL_TURRET_NODE) ?? instance;
  const muzzle = instance.getObjectByName(MODEL_MUZZLE_NODE) ?? null;

  // Un mixer par tour : chacune tire a son propre rythme. Le clip cible ses
  // noeuds par nom dans CE clone, les instances sont donc independantes.
  let mixer: THREE.AnimationMixer | null = null;
  let fireAction: THREE.AnimationAction | null = null;
  if (model.fireClip) {
    mixer = new THREE.AnimationMixer(instance);
    fireAction = mixer.clipAction(model.fireClip);
    fireAction.setLoop(THREE.LoopOnce, 1);
    // Pas de clampWhenFinished : le canon doit revenir a sa position de repos
    // apres le recul, pas rester enfonce.
    fireAction.clampWhenFinished = false;
  }

  // Rayon reel apres mise a l'echelle : mesure plutot que deduite, c'est elle
  // qui sert de reference aux elements au sol ci-dessous.
  const radius = measureSweptRadius(body);

  const scaffold = makeScaffold(radius * 0.92, visual.height * 0.55);
  scaffold.visible = false;
  scaffold.name = 'scaffold';
  g.add(scaffold);

  const rangeRing = new THREE.Mesh(
    new THREE.RingGeometry(def.range * 0.0028 - 0.02, def.range * 0.0028, 64),
    new THREE.MeshBasicMaterial({
      color: visual.accentColor,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    }),
  );
  rangeRing.rotation.x = -Math.PI / 2;
  rangeRing.position.y = 0.02;
  rangeRing.visible = false;
  rangeRing.name = 'rangeRing';
  g.add(rangeRing);

  const progInner = radius * 1.05;
  const progOuter = radius * 1.2;
  const prog = new THREE.Mesh(
    new THREE.RingGeometry(progInner, progOuter, 48, 1, -Math.PI / 2, 0.001),
    new THREE.MeshBasicMaterial({ color: 0x6ec1ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  prog.rotation.x = -Math.PI / 2;
  prog.position.y = 0.03;
  prog.visible = false;
  prog.name = 'progress';
  g.add(prog);

  const foot = new THREE.Mesh(
    new THREE.RingGeometry(MAX_RADIUS - 0.02, MAX_RADIUS, 8),
    new THREE.MeshBasicMaterial({ color: 0x4a9e5c, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
  );
  foot.rotation.x = -Math.PI / 2;
  foot.rotation.z = Math.PI / 8;
  foot.position.y = 0.015;
  foot.name = 'footprint';
  g.add(foot);

  // `progressRadii` : rayons a redonner a l'anneau de progression pendant la
  // construction. Sans ca, updateBuild le reconstruisait a des rayons fixes,
  // sans rapport avec la taille de la tour (voir build.ts).
  g.userData = {
    tier,
    def,
    turret,
    muzzle,
    body,
    build: null,
    recoil: 0,
    radius,
    progressRadii: [progInner, progOuter],
    mixer,
    fireAction,
  };

  if (radius > MAX_RADIUS) {
    (foot.material as THREE.MeshBasicMaterial).color.set(0xd0503c);
    console.warn(`[emprise] modele ${def.name} (palier ${tier + 1}) deborde : rayon ${radius.toFixed(3)} > ${MAX_RADIUS.toFixed(3)}`);
  }

  return g;
}

/**
 * Fait avancer l'animation d'une tour. Sans effet — et sans cout — sur une
 * tour procedurale ou sur un modele sans clip : appelable sur TOUTES les
 * tours a chaque frame, comme `updateBuild`, sans que l'appelant ait a savoir
 * de quel type elles sont.
 */
export function updateTowerAnimation(tower: THREE.Object3D, dt: number): void {
  const mixer = tower.userData.mixer as THREE.AnimationMixer | null | undefined;
  if (!mixer) return;
  // Un mixer dont aucune action ne tourne n'a rien a faire. Le jeu appelle
  // cette fonction pour CHAQUE tour de CHAQUE arene a chaque frame (les 6
  // arenes sont synchronisees en permanence, pas seulement celle affichee —
  // voir la boucle de rendu de main.ts) : sans ce filtre, une partie saturee
  // reveillerait plus d'un millier de mixers par frame pour ne rien animer.
  const action = tower.userData.fireAction as THREE.AnimationAction | null | undefined;
  if (action && !action.isRunning()) return;
  mixer.update(dt);
}

/**
 * Joue le recul du canon. `reset()` avant `play()` pour qu'un tir pendant
 * qu'un recul est encore en cours reparte du debut plutot que d'etre ignore :
 * aux cadences elevees (le palier 5 de Cadence tire ~10 fois par seconde) les
 * tirs se chevauchent, et une animation figee se lirait comme une tour qui
 * ne tire plus. Sans effet si la tour n'a pas de clip de tir.
 */
export function playTowerFire(tower: THREE.Object3D): void {
  const action = tower.userData.fireAction as THREE.AnimationAction | null | undefined;
  action?.reset().play();
}
