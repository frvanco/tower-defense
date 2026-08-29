import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Noeuds animes du rig — les 13 nommes dans les clips Walk/Death des
 * modeles livres jusqu'ici (Trainard, Conscrit), plus `Rig` lui-meme (qui
 * porte le mouvement d'ensemble ET le seul mesh, `Pelvis`, qui ne tombe
 * sous aucun des 13 autres — accroche sous `Hips`, un pivot intermediaire
 * non anime, absorbe naturellement par le calcul "matrice relative au
 * noeud" plus bas). Un modele qui n'a pas tel ou tel noeud (le Conscrit n'a
 * pas de `Backpack`) le voit simplement ignore, voir buildModel — cette
 * liste n'a donc pas besoin d'etre un sous-ensemble exact par modele.
 */
export const ANIMATED_NODE_NAMES = [
  'Rig',
  'Torso',
  'Head',
  'Backpack',
  'LeftUpperArm',
  'RightUpperArm',
  'LeftLowerArm',
  'RightLowerArm',
  'LeftUpperLeg',
  'RightUpperLeg',
  'LeftLowerLeg',
  'RightLowerLeg',
  'LeftFoot',
  'RightFoot',
] as const;

export interface AnimatedCreepModel {
  /** Meme ordre que ANIMATED_NODE_NAMES (noeuds absents du fichier filtres). */
  nodeNames: string[];
  /** Une geometrie fusionnee, indexee, par noeud (attributs position/normal/
   * color) — a transformer par la matrice du noeud courant a chaque frame. */
  geometries: THREE.BufferGeometry[];
  /** Materiau unique partage par tous les noeuds/instances (vertexColors,
   * non eclaire — les lumieres de scene, notamment l'ambient/rim bleutes de
   * createScene3D, assombrissaient et teintaient la majeure partie d'un
   * personnage petit/facette sous MeshLambertMaterial ; voir buildModel.
   * Hors brouillard de scene aussi — un petit personnage detaille s'y
   * delave bien plus qu'un pan de terrain). */
  material: THREE.Material;
  /** Pose de repos (rest pose du fichier), une matrice par noeud, relative a
   * la racine du modele — pas encore d'animation echantillonnee. */
  restMatrices: THREE.Matrix4[];
  /** Facteur d'echelle uniforme mesure au chargement (voir buildModel). A
   * appliquer a la position/placement de chaque instance, PAS aux
   * geometries : les matrices ci-dessus restent en unites naturelles du
   * fichier, l'echelle se compose proprement par-dessus au rendu. */
  scale: number;
  /** Decalage vertical (unites de scene, donc deja multiplie par `scale`) a
   * ajouter a la position au sol pour que les pieds reposent a Y=0. */
  groundOffsetY: number;
  /** Poses echantillonnees du clip "Walk" (boucle) : walkFrames[pas][noeud].
   * 32 pas repartis sur [0, duree) — pas de doublon du premier/dernier pas,
   * la boucle doit se refermer sans a-coup. */
  walkFrames: THREE.Matrix4[][];
  /** Duree reelle du clip Walk (secondes), lue sur le fichier — utilisee
   * pour calibrer la distance d'un cycle complet (voir entities3d.ts). */
  walkClipDuration: number;
  /** Poses echantillonnees du clip "Death" (jouee une fois) :
   * deathFrames[pas][noeud]. 24 pas INCLUANT les deux extremites (pose de
   * depart et pose finale figee). */
  deathFrames: THREE.Matrix4[][];
  /** Duree reelle du clip Death (secondes), lue sur le fichier. */
  deathClipDuration: number;
  /** Angle (radians) a ajouter au cap de deplacement pour que le modele
   * marche face a sa direction — voir detectHeadingOffset. */
  headingOffset: number;
}

const cachedModels = new Map<string, AnimatedCreepModel>();
const loadPromises = new Map<string, Promise<AnimatedCreepModel>>();

/**
 * Charge et pretraite un modele (chemin GLB -> hauteur cible en unites de
 * scene) une seule fois par URL — mis en cache par url, sans effet si deja
 * charge ou en cours pour cette meme url. Repli existant cote appelant tant
 * que la Promise n'est pas resolue (voir entities3d.ts).
 */
export function loadAnimatedCreepModel(url: string, targetHeight: number): Promise<AnimatedCreepModel> {
  const existing = loadPromises.get(url);
  if (existing) return existing;
  const promise = new Promise<AnimatedCreepModel>((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => {
        const model = buildModel(gltf.scene, gltf.animations, targetHeight);
        cachedModels.set(url, model);
        resolve(model);
      },
      undefined,
      reject,
    );
  });
  loadPromises.set(url, promise);
  return promise;
}

export function getAnimatedCreepModel(url: string): AnimatedCreepModel | null {
  return cachedModels.get(url) ?? null;
}

/**
 * Cherche un noeud anime par son nom canonique (voir ANIMATED_NODE_NAMES),
 * avec repli sur une convention alternative rencontree sur certains exports
 * — suffixe _L/_R plutot que prefixe Left/Right (ex. `UpperArm_L` au lieu de
 * `LeftUpperArm`) — avant d'abandonner ce noeud pour ce modele (voir l'appel
 * dans buildModel, qui tolere deja un noeud absent). Tente la variante
 * uniquement si le nom canonique n'existe pas, donc sans incidence sur un
 * modele deja au format attendu (Conscrit, Sapeur).
 */
function resolveAnimatedNode(root: THREE.Object3D, canonicalName: string): THREE.Object3D | null {
  const direct = root.getObjectByName(canonicalName);
  if (direct) return direct;
  const altName = canonicalName.startsWith('Left')
    ? canonicalName.slice('Left'.length) + '_L'
    : canonicalName.startsWith('Right')
      ? canonicalName.slice('Right'.length) + '_R'
      : null;
  return (altName ? root.getObjectByName(altName) : undefined) ?? null;
}

/**
 * Determine dans quel sens ce modele fait face au repos, en mesurant la
 * position du noeud `Nose` relative a la racine : un nez pointe toujours
 * vers l'avant du visage, donc son signe en Z revele la convention de cet
 * export sans ambiguite — plutot que de supposer une constante unique
 * partagee par tous les modeles (ce qui etait le cas avant : un `+PI` fixe
 * dans animatedCreepInstances.ts, calibre sur un ancien export du Trainard
 * qui pointait en Z negatif comme le Conscrit/Sapeur. Un export plus recent
 * du Trainard pointe en Z POSITIF — le decalage fixe le faisait alors
 * marcher a reculons). Repli sur `Math.PI` (convention historique) si aucun
 * noeud `Nose` n'existe dans ce fichier.
 */
function detectHeadingOffset(root: THREE.Object3D): number {
  const nose = root.getObjectByName('Nose');
  if (!nose) return Math.PI;
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const local = new THREE.Matrix4().multiplyMatrices(rootInverse, nose.matrixWorld);
  const pos = new THREE.Vector3().setFromMatrixPosition(local);
  return pos.z > 0 ? 0 : Math.PI;
}

/**
 * Collecte les meshes descendants de `node` qui n'appartiennent pas a un
 * autre noeud anime plus profond dans la hierarchie (on arrete la descente
 * des qu'on croise un nom present dans `animatedNames`, sauf a la racine de
 * l'appel). Partitionne ainsi tous les meshes du modele en exactement un
 * groupe par noeud anime, sans liste de meshes ecrite en dur. `animatedNames`
 * doit contenir les noms REELS des noeuds retenus (voir buildModel) — pas les
 * noms canoniques : avec la variante _L/_R ci-dessus, un noeud peut etre
 * retenu sous un nom different de sa cle canonique.
 */
function collectOwnedMeshes(node: THREE.Object3D, animatedNames: ReadonlySet<string>): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  function visit(n: THREE.Object3D, isRoot: boolean): void {
    if (!isRoot && animatedNames.has(n.name)) return; // appartient a un autre groupe
    if ((n as THREE.Mesh).isMesh) out.push(n as THREE.Mesh);
    for (const child of n.children) visit(child, false);
  }
  visit(node, true);
  return out;
}

const WALK_SAMPLE_STEPS = 32;
const DEATH_SAMPLE_STEPS = 24;

// A l'echelle d'un creep (quelques dizaines de px a l'ecran), les teintes
// pastel de ces modeles (chemise, peau claire, blanc des yeux) se distinguent
// mal les unes des autres et donnent une impression generale de blancheur
// (retour direct). Boost applique une fois ici, au moment ou la couleur du
// materiau est figee en couleur de sommet — pas de cout de rendu par frame.
const CREEP_SATURATION_BOOST = 1.45;
const CREEP_CONTRAST_BOOST = 1.15;
const tmpHsl = { h: 0, s: 0, l: 0 };

function boostCreepColor(color: THREE.Color): void {
  color.getHSL(tmpHsl);
  const s = Math.min(1, tmpHsl.s * CREEP_SATURATION_BOOST);
  const l = Math.min(1, Math.max(0, 0.5 + (tmpHsl.l - 0.5) * CREEP_CONTRAST_BOOST));
  color.setHSL(tmpHsl.h, s, l);
}

interface PoseSnapshot {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

/** Sauvegarde la transformation locale de chaque noeud de la hierarchie —
 * sert a repartir d'une pose de repos propre entre deux clips echantillonnes
 * (Death ne touche pas les pieds : sans ce reset, ils garderaient la pose
 * laissee par le dernier pas de Walk echantillonne juste avant). */
function snapshotLocalPose(root: THREE.Object3D): Map<THREE.Object3D, PoseSnapshot> {
  const snapshot = new Map<THREE.Object3D, PoseSnapshot>();
  root.traverse((n) => {
    snapshot.set(n, { position: n.position.clone(), quaternion: n.quaternion.clone(), scale: n.scale.clone() });
  });
  return snapshot;
}

function restoreLocalPose(snapshot: Map<THREE.Object3D, PoseSnapshot>): void {
  for (const [n, p] of snapshot) {
    n.position.copy(p.position);
    n.quaternion.copy(p.quaternion);
    n.scale.copy(p.scale);
  }
}

/**
 * Echantillonne un clip a `steps` pas repartis sur sa duree, et releve a
 * chaque pas la matrice de chaque noeud de `bucketNodes` relative a `root`.
 * `includeEnd` : true pour couvrir [0, duree] inclus (clip joue une fois,
 * Death), false pour [0, duree) exclusif (clip en boucle, Walk — sinon le
 * premier et le dernier pas dupliquent la meme pose et la boucle "bute").
 * Un mixer temporaire suffit : on lit juste la pose a des temps fixes, sans
 * jamais laisser tourner la lecture automatique.
 */
function sampleClip(
  clip: THREE.AnimationClip,
  root: THREE.Object3D,
  bucketNodes: THREE.Object3D[],
  steps: number,
  includeEnd: boolean,
): THREE.Matrix4[][] {
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();

  const result: THREE.Matrix4[][] = bucketNodes.map(() => []);
  const denom = includeEnd ? Math.max(1, steps - 1) : steps;
  for (let i = 0; i < steps; i++) {
    action.time = (i / denom) * clip.duration;
    mixer.update(0);
    root.updateMatrixWorld(true);
    const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    for (let b = 0; b < bucketNodes.length; b++) {
      result[b]!.push(new THREE.Matrix4().multiplyMatrices(rootInverse, bucketNodes[b]!.matrixWorld));
    }
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  return result;
}

function buildModel(root: THREE.Group, animations: THREE.AnimationClip[], targetHeight: number): AnimatedCreepModel {
  root.updateMatrixWorld(true);

  // Echelle/assise — mesure sur la hierarchie NATURELLE (echelle 1), jamais
  // appliquee au root ni aux geometries : composee plus tard, a la pose de
  // chaque instance (voir AnimatedCreepModel.scale/groundOffsetY ci-dessus).
  const box = new THREE.Box3().setFromObject(root);
  const rawHeight = box.max.y - box.min.y;
  const scale = rawHeight > 0 ? targetHeight / rawHeight : 1;
  const groundOffsetY = -box.min.y * scale;
  const headingOffset = detectHeadingOffset(root);

  const bucketNodes: THREE.Object3D[] = [];
  const nodeNames: string[] = [];
  for (const name of ANIMATED_NODE_NAMES) {
    const node = resolveAnimatedNode(root, name);
    if (!node) continue; // ce modele n'a pas ce noeud (ex. pas de Backpack) : ignore plutot que planter
    bucketNodes.push(node);
    nodeNames.push(name);
  }
  // Noms REELS des noeuds retenus (pas les cles canoniques ci-dessus) : voir
  // le commentaire de collectOwnedMeshes.
  const animatedNamesSet = new Set<string>(bucketNodes.map((n) => n.name));

  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const geometries: THREE.BufferGeometry[] = [];
  const restMatrices: THREE.Matrix4[] = [];
  const tmpColor = new THREE.Color();

  for (const bucketNode of bucketNodes) {
    const nodeInverse = new THREE.Matrix4().copy(bucketNode.matrixWorld).invert();
    const meshes = collectOwnedMeshes(bucketNode, animatedNamesSet);
    const parts: THREE.BufferGeometry[] = [];

    for (const mesh of meshes) {
      const src = mesh.geometry;
      const pos = src.getAttribute('position');
      const nrm = src.getAttribute('normal');
      if (!pos || !nrm) continue; // geometrie inattendue (sans position/normal) : ignoree plutot que planter

      // Reconstruit une geometrie propre avec exactement position/normal/color
      // (mergeGeometries exige des attributs identiques sur toutes les
      // entrees) — ignore UV/tangent/etc si jamais presents.
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', pos.clone());
      geo.setAttribute('normal', nrm.clone());
      if (src.index) geo.setIndex(src.index.clone());

      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      tmpColor.copy((material as THREE.MeshStandardMaterial).color ?? new THREE.Color(0xffffff));
      boostCreepColor(tmpColor);
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        colors[i * 3] = tmpColor.r;
        colors[i * 3 + 1] = tmpColor.g;
        colors[i * 3 + 2] = tmpColor.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      // Transformation locale du mesh relative au noeud anime proprietaire —
      // constante (rest pose), figee une fois pour toutes ici : c'est ce qui
      // permet de fusionner sans perdre le placement relatif de chaque piece.
      const meshToNode = new THREE.Matrix4().multiplyMatrices(nodeInverse, mesh.matrixWorld);
      geo.applyMatrix4(meshToNode);

      parts.push(geo);
    }

    const merged = parts.length > 0 ? mergeGeometries(parts, false) : new THREE.BufferGeometry();
    for (const p of parts) p.dispose();
    geometries.push(merged ?? new THREE.BufferGeometry());
    restMatrices.push(new THREE.Matrix4().multiplyMatrices(rootInverse, bucketNode.matrixWorld));
  }

  // MeshBasicMaterial (non eclaire), pas MeshLambertMaterial : sur un
  // personnage petit et facette, la reponse diffuse de Lambert a l'angle des
  // lumieres de scene (cf. createScene3D — un key chaud, mais un ambient et
  // un rim tous deux bleutes, 0x5a6478/0x6f9fd8) plonge une bonne partie du
  // corps dans une ombre gris-bleu qui ecrase les couleurs du GLB (verifie
  // par comparaison directe sous le meme eclairage : Lambert assombrit/teinte
  // plus de la moitie d'une sphere de meme couleur, Basic la restitue
  // fidelement en integralite). L'ombre PORTEE au sol (castShadow) ne depend
  // pas du type de materiau — elle est intacte avec Basic.
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });

  // Echantillonnage des animations — APRES la fusion ci-dessus (qui a besoin
  // de la pose de repos), sur la meme hierarchie temporaire. Repart d'une
  // pose de repos propre entre les deux clips (voir snapshotLocalPose) pour
  // que Death ne herite pas d'une pose laissee par le dernier pas de Walk.
  const walkClip = animations.find((a) => a.name === 'Walk');
  const deathClip = animations.find((a) => a.name === 'Death');
  const bindPose = snapshotLocalPose(root);

  const walkFrames = walkClip
    ? sampleClip(walkClip, root, bucketNodes, WALK_SAMPLE_STEPS, false)
    : restMatrices.map((m) => [m.clone()]);
  restoreLocalPose(bindPose);

  const deathFrames = deathClip
    ? sampleClip(deathClip, root, bucketNodes, DEATH_SAMPLE_STEPS, true)
    : restMatrices.map((m) => [m.clone()]);
  restoreLocalPose(bindPose);

  return {
    nodeNames,
    geometries,
    material,
    restMatrices,
    scale,
    groundOffsetY,
    walkFrames,
    walkClipDuration: walkClip?.duration ?? 1,
    deathFrames,
    deathClipDuration: deathClip?.duration ?? 1,
    headingOffset,
  };
}
