import { laneAnchors } from './laneGeometry.js';
import type { Lane } from './index.js';

/**
 * Largeur du couloir, en unites monde — determine a la fois le rendu du
 * ruban de chemin (apps/web/scene3d.ts) et le retrait des zones
 * constructibles vis-a-vis du chemin (PATH_CLEARANCE ci-dessous). Source
 * unique pour que rendu et emplacements ne puissent pas diverger.
 */
export const PATH_WIDTH = 90;

/** >= SLOT_SIZE (packages/data/src/slots.ts) : un emplacement pose au bord
 * meme d'une zone reste a distance de securite du chemin (packages/sim/test
 * verifie qu'aucun emplacement n'empiete a moins de SLOT_SIZE du couloir). La
 * marge au-dela de SLOT_SIZE couvre les coins (un coin de zone peut etre plus
 * proche d'un virage du chemin qu'un simple retrait perpendiculaire). */
const PATH_CLEARANCE = 84;
/** Marge entre le bord d'une zone et le vrai bord de la zone constructible. */
const EDGE_GAP = 24;
/** Marge vis-a-vis des points de spawn/sortie — plus genereuse que EDGE_GAP :
 * ce sont des reperes de jeu, pas juste un bord de carte. */
const SPAWN_GAP = 70;
/** Profondeur de la zone "bas", volontairement bornee plutot que de s'etendre
 * jusqu'au bord de la zone constructible (retour direct : elle partait trop
 * loin vers le bas). */
const BOTTOM_DEPTH = 500;

export interface ZoneFootprint {
  id: 'milieu' | 'gauche' | 'droite' | 'bas';
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Rectangles des 4 zones constructibles (coordonnees monde, arene du joueur
 * 0) : milieu (interieur du couloir, entre les deux bras), gauche/droite
 * (exterieur de chaque bras), bas (sous la liaison horizontale). Cotes et
 * bas se rejoignent exactement (meme Y) : pas d'espace ni de 3e zone entre
 * eux.
 */
export function zoneFootprints(lane: Lane): ZoneFootprint[] {
  const { leftArmX, rightArmX, connectorY, armTopY } = laneAnchors(lane);
  const bz = lane.buildZone;
  const armTopLeft = Math.max(lane.waypoints[0]![1], lane.spawn[1]);
  const armTopRight = Math.max(lane.waypoints[1]![1], lane.waypoints[2]![1]);
  const bottomTop = connectorY - PATH_CLEARANCE;

  return [
    {
      id: 'milieu',
      x0: leftArmX + PATH_CLEARANCE,
      x1: rightArmX - PATH_CLEARANCE,
      y0: connectorY + PATH_CLEARANCE,
      y1: armTopY - SPAWN_GAP,
    },
    {
      id: 'gauche',
      x0: bz.left + EDGE_GAP,
      x1: leftArmX - PATH_CLEARANCE,
      y0: bottomTop,
      y1: armTopLeft - SPAWN_GAP,
    },
    {
      id: 'droite',
      x0: rightArmX + PATH_CLEARANCE,
      x1: bz.right - EDGE_GAP,
      y0: bottomTop,
      y1: armTopRight - SPAWN_GAP,
    },
    {
      id: 'bas',
      x0: bz.left + EDGE_GAP,
      x1: bz.right - EDGE_GAP,
      y0: bottomTop - BOTTOM_DEPTH,
      y1: bottomTop,
    },
  ];
}
