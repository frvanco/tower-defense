import * as THREE from 'three';

/**
 * `packages/sim/src/sim.ts` impose TOWER_FOOTPRINT = 64 unites monde entre
 * deux tours. A l'echelle de cette scene, 64 unites monde = 2.0 unites de
 * scene (voir reference/cannon-branch-v5.html). MAX_RADIUS laisse un vide
 * net entre deux tours voisines plutot que de saturer exactement la case.
 */
export const CELL = 2.0;
export const MAX_RADIUS = CELL * 0.42;

/**
 * Rayon BALAYE d'un groupe, pas boite englobante au repos. Une tourelle
 * pivote : son emprise reelle en jeu est le cercle decrit par son point le
 * plus eloigne de l'axe vertical, pas l'etendue de sa geometrie a l'instant T.
 * Une tour avec des canons longs peut tenir au repos et deborder des qu'elle
 * se tourne de 90 degres — c'est ce que ce calcul attrape.
 *
 * Mesure relative a la position monde du groupe lui-meme (pas a l'origine de
 * la scene), pour rester correct que la tour ait deja ete positionnee ou non.
 */
export function measureSweptRadius(group: THREE.Object3D): number {
  group.updateMatrixWorld(true);
  const origin = group.getWorldPosition(new THREE.Vector3());

  let radius = 0;
  const v = new THREE.Vector3();
  group.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!(m as { isMesh?: boolean }).isMesh || !m.geometry) return;
    const pos = m.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).sub(origin);
      const r = Math.hypot(v.x, v.z);
      if (r > radius) radius = r;
    }
  });
  return radius;
}
