import type { Lane } from './index.js';

/**
 * Points cles du couloir en U (bras vertical gauche, connecteur horizontal,
 * bras vertical droit) — la partie du chemin le long de laquelle les
 * emplacements de construction et les plateaux sont poses.
 *
 * `lane.spawn` et le dernier `lane.waypoints` ne sont PLUS les coins du U :
 * ce sont les points d'entree/sortie, au bout de deux courts bras
 * horizontaux ajoutes en haut de chaque bras vertical (packages/sim fait
 * avancer les creeps sur tout le chemin, entree -> ... -> sortie ; voir
 * ARM_EXTENSION dans zoneFootprints.ts pour leur longueur). Les 4 coins du U
 * lui-meme sont `lane.waypoints[0..3]` :
 *   [0] haut du bras gauche  [1] bas du bras gauche (connecteur)
 *   [2] bas du bras droit (connecteur)  [3] haut du bras droit
 * Les waypoints de map_data.json sont exactement axes (waypoints[0].x ==
 * waypoints[1].x, etc.) — moyenner reste la methode utilisee ici par
 * simplicite/robustesse, mais ne corrige plus aucune derive reelle.
 *
 * Partage entre packages/data/src/zoneFootprints.ts (emplacements de
 * construction et plateaux) pour eviter que geometrie du chemin et
 * geometrie des zones constructibles ne puissent diverger. Ces fonctions ne
 * s'interessent qu'au U lui-meme : les bras horizontaux d'entree/sortie
 * n'ont pas d'emplacements et ne sont pas representes ici.
 */
export interface LaneAnchors {
  leftArmX: number;
  rightArmX: number;
  connectorY: number;
  /** Y le plus eloigne du connecteur (haut des bras), borne "ouverte" du U. */
  armTopY: number;
}

export function laneAnchors(lane: Lane): LaneAnchors {
  const [topLeftX, topLeftY] = lane.waypoints[0]!;
  const [bottomLeftX, bottomLeftY] = lane.waypoints[1]!;
  const [bottomRightX, bottomRightY] = lane.waypoints[2]!;
  const [topRightX, topRightY] = lane.waypoints[3]!;
  return {
    leftArmX: (topLeftX + bottomLeftX) / 2,
    rightArmX: (bottomRightX + topRightX) / 2,
    connectorY: (bottomLeftY + bottomRightY) / 2,
    armTopY: Math.max(topLeftY, topRightY),
  };
}
