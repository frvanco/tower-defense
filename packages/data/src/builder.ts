import { laneAnchors } from './laneGeometry.js';
import { PATH_WIDTH, PATH_CLEARANCE } from './zoneFootprints.js';
import type { Lane } from './index.js';

/**
 * Geometrie du builder : d'ou il part, et ou est le couloir qu'il doit
 * survoler. Tout est DERIVE de la geometrie de la lane (laneGeometry.ts +
 * zoneFootprints.ts), jamais recopie en dur : deplacer une arene ou elargir
 * le couloir reste donc une seule modification.
 *
 * Unites : coordonnees monde, comme tout ce que manipule packages/sim. Le
 * rendu applique WORLD_TO_SCENE par-dessus, ce module ne le connait pas.
 */

/** Profondeur, sous le bord interieur de la bande exterieure, du point de
 * depart du builder. Vaut une case : le place au milieu exact de la bande
 * verte sous le connecteur (la rangee "exterieur-bas-c2"), plutot que collee
 * a l'un de ses deux bords. */
const START_DEPTH = 80;

/**
 * Position de depart du builder : centre de la carte en X, dans la zone verte
 * sous le connecteur du couloir. Pour la lane 0 : (-4148, 1884).
 *
 * Le Y descend depuis l'axe du connecteur — PATH_CLEARANCE est mesure depuis
 * cet axe (c'est ce qui place "exterieur-bas-c1" a connectorY - 84), pas
 * depuis le bord du ruban.
 */
export function builderStart(lane: Lane): [number, number] {
  const a = laneAnchors(lane);
  return [(a.leftArmX + a.rightArmX) / 2, a.connectorY - PATH_CLEARANCE - START_DEPTH];
}

/** Rectangle aligne sur les axes, en coordonnees monde. */
export interface Rect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Le couloir des creeps, en 5 rectangles : bras d'entree, bras vertical
 * gauche, connecteur, bras vertical droit, bras de sortie. Chaque segment du
 * chemin est axis-aligned, donc sa boite englobante elargie de la demi-largeur
 * du ruban EST le ruban.
 *
 * L'elargissement se fait sur les DEUX axes (bouts carres) plutot que
 * perpendiculairement seulement : c'est ce qui remplit les deux coins du U,
 * qu'un elargissement perpendiculaire laisserait a decouvert.
 */
export function laneCorridor(lane: Lane): Rect[] {
  const hw = PATH_WIDTH / 2;
  const points: Array<[number, number]> = [lane.spawn, ...lane.waypoints];
  const rects: Rect[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i]!;
    const [bx, by] = points[i + 1]!;
    rects.push({
      minX: Math.min(ax, bx) - hw,
      maxX: Math.max(ax, bx) + hw,
      minY: Math.min(ay, by) - hw,
      maxY: Math.max(ay, by) + hw,
    });
  }
  return rects;
}

/**
 * Le point est-il dans le couloir, marge comprise ? C'est le SEUL test qui
 * decide du vol : il porte sur la geometrie fixe du chemin, jamais sur une
 * notion de "builder bloque" (rien ne bloque le builder, les tours se
 * traversent). La marge sert de piste de decollage — le builder quitte le sol
 * avant d'atteindre le ruban et se repose apres l'avoir depasse.
 */
export function inCorridor(corridor: readonly Rect[], x: number, y: number, margin: number): boolean {
  for (const r of corridor) {
    if (x >= r.minX - margin && x <= r.maxX + margin && y >= r.minY - margin && y <= r.maxY + margin) {
      return true;
    }
  }
  return false;
}
