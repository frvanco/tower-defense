import * as THREE from 'three';

/** Tolerance d'alignement, en radians — porte du prototype. */
const ALIGN_TOLERANCE = 0.06;

const _worldPos = new THREE.Vector3();

/**
 * Pivote `turret` vers `targetWorldPos` a vitesse limitee (`turnRate`, rad/s).
 * Ne fait RIEN pour repositionner la tourelle si aucune cible n'est fournie :
 * appeler cette fonction est deja la decision de viser. Quand il n'y a plus
 * rien a viser, l'appelant arrete simplement d'appeler `aimTurret` et la
 * tourelle GARDE son orientation — pas de retour a une position neutre, pas
 * de rotation permanente. Une tourelle qui tourne en permanence n'attire plus
 * l'œil ; des tourelles figees font de chaque rotation un signal.
 *
 * Fonction pure du delta : tout ce qui compte tient dans les 4 parametres,
 * rien n'est lu depuis un etat cache par ailleurs. Elle MUTE `turret.rotation.y`
 * en place (idiome Three.js habituel pour un objet de scene, cf. le prototype) ;
 * "pure" signifie ici qu'aucun historique implicite (cible precedente, etc.)
 * n'est stocke entre deux appels.
 *
 * Retourne `true` quand la tourelle est alignee (tolerance ~0.06 rad).
 */
export function aimTurret(
  turret: THREE.Object3D,
  targetWorldPos: THREE.Vector3,
  turnRate: number,
  dt: number,
): boolean {
  turret.getWorldPosition(_worldPos);
  const dx = targetWorldPos.x - _worldPos.x;
  const dz = targetWorldPos.z - _worldPos.z;
  const want = Math.atan2(dx, dz);

  let diff = want - turret.rotation.y;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;

  const maxStep = turnRate * dt;
  turret.rotation.y += Math.max(-maxStep, Math.min(maxStep, diff));

  return Math.abs(diff) < ALIGN_TOLERANCE;
}
