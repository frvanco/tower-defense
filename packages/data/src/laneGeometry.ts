import type { Lane } from './index.js';

/**
 * Points cles du couloir : deux bras verticaux relies par un connecteur
 * horizontal (spawn -> wp1 -> wp2 -> end). Les waypoints de map_data.json
 * sont exactement axes (spawn.x == wp1.x, wp2.x == end.x, wp1.y == wp2.y) —
 * moyenner reste la methode utilisee ici par simplicite/robustesse, mais ne
 * corrige plus aucune derive reelle.
 *
 * Partage entre packages/data/src/zoneFootprints.ts (emplacements de
 * construction et plateaux) pour eviter que geometrie du chemin et
 * geometrie des zones constructibles ne puissent diverger.
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
