import type { Lane } from './index.js';

/**
 * Points cles du couloir : deux bras quasi verticaux relies par une liaison
 * quasi horizontale (spawn -> wp1 -> wp2 -> end). Les segments reels ont une
 * pente negligeable (quelques dizaines d'unites sur des milliers) ; les
 * traiter comme des droites axees suffit pour poser des blocs rectangulaires
 * (emplacements de construction, plateaux de terrain).
 *
 * Partage entre packages/data/scripts/gen_slots.ts (positions des
 * emplacements) et apps/web (plateaux sureleves) pour eviter que les deux
 * dérivent l'un de l'autre.
 */
export interface LaneAnchors {
  leftArmX: number;
  rightArmX: number;
  connectorY: number;
  /** Y le plus eloigne du connecteur (cote spawn/end), borne "ouverte" du U. */
  armTopY: number;
}

export function laneAnchors(lane: Lane): LaneAnchors {
  const [spawnX, spawnY] = lane.spawn;
  const [wp1X, wp1Y] = lane.waypoints[0]!;
  const [wp2X, wp2Y] = lane.waypoints[1]!;
  const [endX, endY] = lane.waypoints[2]!;
  return {
    leftArmX: (spawnX + wp1X) / 2,
    rightArmX: (wp2X + endX) / 2,
    connectorY: (wp1Y + wp2Y) / 2,
    armTopY: Math.max(spawnY, endY),
  };
}
