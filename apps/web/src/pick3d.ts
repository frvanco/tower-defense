import * as THREE from 'three';
import type { Scene3D } from './scene3d.js';
import { sceneToWorld, type Frame3D } from './world3d.js';
import { PLATFORM_HEIGHT } from './terrain3d.js';

const raycaster = new THREE.Raycaster();
// Plan au niveau du PLATEAU (terrain3d.ts), pas du chemin (Y=0) : c'est la
// surface que le joueur voit et vise pour construire. Avec la camera en
// plongee, viser le mauvais plan decale le point calcule de la position
// visuelle du curseur — petit mais suffisant pour rater l'emplacement.
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PLATFORM_HEIGHT);
const ndc = new THREE.Vector2();
const hitPoint = new THREE.Vector3();

/** Coordonnees monde (jeu) du point du plateau vise par le pointeur (NDC [-1,1]). */
export function pickGroundWorld(s3d: Scene3D, frame: Frame3D, ndcX: number, ndcY: number): [number, number] | null {
  ndc.set(ndcX, ndcY);
  raycaster.setFromCamera(ndc, s3d.camera);
  if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return null;
  return sceneToWorld(frame, hitPoint.x, hitPoint.z);
}

/** eid de la tour sous le pointeur, ou null. Les meshes portent leur eid dans
 * `userData.eid` sur le Group racine (pose par TowerEntities). */
export function pickTowerEid(s3d: Scene3D, ndcX: number, ndcY: number): number | null {
  ndc.set(ndcX, ndcY);
  raycaster.setFromCamera(ndc, s3d.camera);
  const hits = raycaster.intersectObjects(s3d.towerLayer.children, true);
  for (const hit of hits) {
    let o: THREE.Object3D | null = hit.object;
    while (o && o.parent !== s3d.towerLayer) o = o.parent;
    if (o && typeof o.userData.eid === 'number') return o.userData.eid as number;
  }
  return null;
}
