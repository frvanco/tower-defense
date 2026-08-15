import type { Lane } from '@tower-defense/data';
import { CELL } from '@tower-defense/renderer';

/**
 * `packages/sim/src/sim.ts` impose TOWER_FOOTPRINT = 64 unites monde entre
 * deux tours ; `@tower-defense/renderer` (footprint.ts) mappe ca sur
 * CELL = 2.0 unites de scene. Ce fichier n'a pas acces a la constante privee
 * TOWER_FOOTPRINT (non exportee par packages/sim), donc le 64 est recopie
 * ici comme dans packages/renderer/src/footprint.ts — c'est la MEME
 * convention, dupliquee au meme endroit que le prototype l'avait deja fait.
 */
const WORLD_TO_SCENE = CELL / 64;

/** Largeur du chemin, en unites monde — source commune pour le ruban rendu
 * (scene3d.ts) et le retrait des plateaux constructibles (terrain3d.ts), pour
 * que les deux restent coherents si l'un change. */
export const PATH_WIDTH_WORLD = 90;

export interface Frame3D {
  scale: number;
  centerX: number;
  centerY: number;
  /** Demi-etendue (unites de scene) de la boite englobante centree — sert au
   * dimensionnement du sol et au cadrage initial de la camera. */
  halfWidth: number;
  halfHeight: number;
}

/**
 * Cadre de conversion pour UNE arene : centre la boite englobante du couloir
 * (spawn + waypoints + zone constructible) sur l'origine de la scene, pour
 * que la camera puisse toujours viser (0,0,0) quel que soit le joueur/lane
 * affiche — les 8 lanes du jeu original sont a des positions monde tres
 * differentes les unes des autres.
 */
export function computeFrame(lane: Lane): Frame3D {
  const corners: Array<[number, number]> = [
    lane.spawn,
    ...lane.waypoints,
    [lane.buildZone.left, lane.buildZone.bottom],
    [lane.buildZone.left, lane.buildZone.top],
    [lane.buildZone.right, lane.buildZone.bottom],
    [lane.buildZone.right, lane.buildZone.top],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    scale: WORLD_TO_SCENE,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    halfWidth: ((maxX - minX) / 2) * WORLD_TO_SCENE,
    halfHeight: ((maxY - minY) / 2) * WORLD_TO_SCENE,
  };
}

/** Coordonnees monde (jeu) -> plan sol de la scene (X, Z). Y = hauteur, gere a part. */
export function worldToScene(frame: Frame3D, x: number, y: number): [number, number] {
  return [(x - frame.centerX) * frame.scale, (y - frame.centerY) * frame.scale];
}

export function sceneToWorld(frame: Frame3D, sx: number, sz: number): [number, number] {
  return [sx / frame.scale + frame.centerX, sz / frame.scale + frame.centerY];
}
