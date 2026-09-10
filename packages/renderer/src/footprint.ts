import * as THREE from 'three';
import { SLOT_SIZE } from '@tower-defense/data';

/**
 * Echelle de rendu monde -> scene, CONSTANTE du projet : elle fixe la taille
 * apparente du couloir, des distances et de tout ce qui est exprime en
 * coordonnees monde. Valeur historique (2.0 / 64) conservee telle quelle pour
 * que l'arene garde exactement les memes dimensions a l'ecran.
 *
 * A ne pas confondre avec CELL ci-dessous : changer SLOT_SIZE ecarte les
 * emplacements SANS changer cette echelle, ce qui donne mecaniquement plus de
 * place a chaque tour. C'est le levier utilise pour agrandir les tours (moins
 * de tours par arene, mais chacune plus imposante).
 */
export const WORLD_TO_SCENE = 2.0 / 64;

/**
 * Espacement de deux emplacements voisins, en unites de scene. DERIVE de
 * SLOT_SIZE (@tower-defense/data) plutot que recopie : c'est la meme distance,
 * exprimee dans l'autre unite, et les deux ne doivent jamais diverger — le 64
 * etait auparavant duplique ici et dans world3d.ts.
 */
export const CELL = SLOT_SIZE * WORLD_TO_SCENE;

/**
 * Part de la case qu'une tour a le droit d'occuper, en RAYON. Deux tours
 * voisines sont a CELL l'une de l'autre : au-dela de 0.5 elles se
 * chevaucheraient, a 0.5 exactement elles se toucheraient. 0.48 laisse un vide
 * net mais fin (4% de la case) — ne pas monter au-dela sans changer aussi
 * l'espacement des emplacements.
 */
export const FOOTPRINT_FACTOR = 0.48;

export const MAX_RADIUS = CELL * FOOTPRINT_FACTOR;

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
