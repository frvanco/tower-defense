import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Hauteur cible, une fois mis a l'echelle (voir buildModel : mesure au
 * chargement, jamais un facteur ecrit en dur). */
export const TRAINARD_MODEL_HEIGHT = 1.8;

/**
 * Noeuds animes du rig — les 13 nommes dans les clips Walk/Death, plus `Rig`
 * lui-meme (qui porte le mouvement d'ensemble ET le seul mesh, `Pelvis`, qui
 * ne tombe sous aucun des 13 autres — accroche sous `Hips`, un pivot
 * intermediaire non anime, absorbe naturellement par le calcul "matrice
 * relative au noeud" plus bas). Verifie sur le fichier livre ; a mettre a
 * jour si un futur modele renomme ces noeuds.
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

export interface TrainardModel {
  /** Meme ordre que ANIMATED_NODE_NAMES (noeuds absents du fichier filtres). */
  nodeNames: string[];
  /** Une geometrie fusionnee, indexee, par noeud (attributs position/normal/
   * color) — a transformer par la matrice du noeud courant a chaque frame. */
  geometries: THREE.BufferGeometry[];
  /** Materiau unique partage par tous les noeuds/instances (vertexColors +
   * flatShading, coherent avec packages/renderer/src/materials.ts). */
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
}

let cachedModel: TrainardModel | null = null;
let loadPromise: Promise<TrainardModel> | null = null;

/** Charge et pretraite le modele une seule fois (mise en cache du Promise) —
 * sans effet si deja charge ou en cours. Repli existant cote appelant tant
 * que la Promise n'est pas resolue (voir entities3d.ts). */
export function loadTrainardModel(): Promise<TrainardModel> {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    new GLTFLoader().load(
      '/models/trainard-lv1.glb',
      (gltf) => {
        cachedModel = buildModel(gltf.scene);
        resolve(cachedModel);
      },
      undefined,
      reject,
    );
  });
  return loadPromise;
}

export function getTrainardModel(): TrainardModel | null {
  return cachedModel;
}

/**
 * Collecte les meshes descendants de `node` qui n'appartiennent pas a un
 * autre noeud anime plus profond dans la hierarchie (on arrete la descente
 * des qu'on croise un nom present dans `animatedNames`, sauf a la racine de
 * l'appel). Partitionne ainsi tous les meshes du modele en exactement un
 * groupe par noeud anime, sans liste de meshes ecrite en dur.
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

function buildModel(root: THREE.Group): TrainardModel {
  root.updateMatrixWorld(true);

  // Echelle/assise — mesure sur la hierarchie NATURELLE (echelle 1), jamais
  // appliquee au root ni aux geometries : composee plus tard, a la pose de
  // chaque instance (voir TrainardModel.scale/groundOffsetY ci-dessus).
  const box = new THREE.Box3().setFromObject(root);
  const rawHeight = box.max.y - box.min.y;
  const scale = rawHeight > 0 ? TRAINARD_MODEL_HEIGHT / rawHeight : 1;
  const groundOffsetY = -box.min.y * scale;

  const animatedNamesSet = new Set<string>(ANIMATED_NODE_NAMES);
  const bucketNodes: THREE.Object3D[] = [];
  const nodeNames: string[] = [];
  for (const name of ANIMATED_NODE_NAMES) {
    const node = root.getObjectByName(name);
    if (!node) continue; // futur modele qui aurait renomme/retire ce noeud : ignore plutot que planter
    bucketNodes.push(node);
    nodeNames.push(name);
  }

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

  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  return { nodeNames, geometries, material, restMatrices, scale, groundOffsetY };
}
