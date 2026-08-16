import { laneAnchors } from './laneGeometry.js';
import type { Lane } from './index.js';

/**
 * Largeur du couloir, en unites monde — determine le rendu du ruban de
 * chemin (apps/web/scene3d.ts). Source unique pour que rendu et retrait des
 * bandes constructibles ne puissent pas diverger.
 */
export const PATH_WIDTH = 90;

/** Distance entre le chemin et la premiere colonne/rangee d'emplacements.
 * >= SLOT_SIZE (packages/sim/test verifie qu'aucun emplacement n'empiete a
 * moins de SLOT_SIZE du couloir) avec une marge qui couvre aussi les coins
 * (un coin de bande peut etre plus proche d'un virage du chemin qu'un simple
 * retrait perpendiculaire). */
export const PATH_CLEARANCE = 84;

/** Emprise minimale entre deux tours (packages/sim/src/sim.ts) — aussi
 * l'espacement, exact, des emplacements le long d'une bande (les tours sont
 * collees). Duplique le SLOT_SIZE de slots.js (meme convention, pas
 * reexporte d'ici pour eviter un conflit de nom au niveau de index.ts). */
const SLOT_SIZE = 64;

/** Marge visuelle entre le dernier emplacement d'une bande et le bord du
 * plateau rendu (evite qu'une tour semble poser sa base dans le vide au bord
 * de la falaise). N'affecte pas le placement des emplacements eux-memes. */
const PLATFORM_MARGIN = 32;

export type BandId =
  | 'interieur-gauche'
  | 'exterieur-gauche'
  | 'interieur-droite'
  | 'exterieur-droite'
  | 'interieur-bas'
  | 'exterieur-bas';

/** Rectangle d'un plateau rendu (apps/web/src/terrain3d.ts) — une bande
 * longeant un segment du chemin, pas une zone remplie. */
export interface ZoneFootprint {
  id: BandId;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface BandSlots {
  /** Identifiant de rangee/colonne, ex. "interieur-gauche-c1" — utilise tel
   * quel comme groupId dans build_slots.json. */
  groupId: string;
  label: string;
  points: Array<[number, number]>;
}

function range(start: number, end: number, step: number): number[] {
  const out: number[] = [];
  if (end >= start) {
    for (let v = start; v <= end; v += step) out.push(v);
  } else {
    for (let v = start; v >= end; v -= step) out.push(v);
  }
  return out;
}

/**
 * Emplacements bruts (avant filtrage/dedup, a la charge de l'appelant — voir
 * packages/data/scripts/gen_slots.ts) : pour chacun des 3 segments du
 * couloir (bras gauche, bras droit, connecteur), deux bandes de 2
 * colonnes/rangees chacune, l'une du cote interieur du U, l'autre du cote
 * exterieur. Chaque bande longe son segment sur toute sa longueur, a
 * PATH_CLEARANCE puis PATH_CLEARANCE + SLOT_SIZE de la ligne du chemin —
 * dessine, vu de dessus, deux U concentriques de tours autour du couloir.
 * Les coins de bandes perpendiculaires se recoupent par construction ; le
 * dedup est fait par l'appelant, pas ici.
 */
export function laneBandSlots(lane: Lane): BandSlots[] {
  const { leftArmX, rightArmX, connectorY, armTopY } = laneAnchors(lane);
  // Symetrique au bornage des rangees du connecteur ci-dessous : la colonne
  // "interieure" d'un bras (x entre les deux bras, donc dans l'intervalle X
  // du connecteur) ne peut pas descendre jusqu'a y = connectorY, sous peine
  // de toucher la ligne du connecteur lui-meme (distance 0, quel que soit
  // le decalage en X). Elle est donc bornee a connectorY + PATH_CLEARANCE.
  // La colonne "exterieure" (x hors de l'intervalle du connecteur) peut
  // descendre jusqu'a connectorY sans risque : sa distance au connecteur se
  // mesure alors depuis l'extremite du segment, deja >= PATH_CLEARANCE.
  const armYsInterior = range(connectorY + PATH_CLEARANCE, armTopY, SLOT_SIZE);
  const armYsExterior = range(connectorY, armTopY, SLOT_SIZE);
  // La rangee "interieure" du connecteur (y = connectorY + PATH_CLEARANCE ou
  // plus) est encore dans l'intervalle Y des deux bras : sans bornage en X
  // elle traverserait leur ligne de chemin (x = leftArmX / rightArmX) au
  // lieu de juste recouper leurs colonnes en coin. On la borne donc a la
  // meme limite que les colonnes interieures des bras. La rangee
  // "exterieure" (y = connectorY - PATH_CLEARANCE ou moins) est hors de cet
  // intervalle : distance aux bras deja garantie via leurs extremites, elle
  // peut couvrir toute la largeur sans risque.
  const connectorXsInterior = range(leftArmX + PATH_CLEARANCE, rightArmX - PATH_CLEARANCE, SLOT_SIZE);
  const connectorXsExterior = range(leftArmX, rightArmX, SLOT_SIZE);

  const bands: BandSlots[] = [];

  const arm = (id: string, label: string, xBase: number, dir: 1 | -1, ys: number[]) => {
    for (let i = 0; i < 2; i++) {
      const x = xBase + dir * (PATH_CLEARANCE + i * SLOT_SIZE);
      bands.push({ groupId: `${id}-c${i + 1}`, label: `${label} — colonne ${i + 1}`, points: ys.map((y) => [x, y]) });
    }
  };
  arm('interieur-gauche', 'Interieur gauche', leftArmX, 1, armYsInterior);
  arm('exterieur-gauche', 'Exterieur gauche', leftArmX, -1, armYsExterior);
  arm('interieur-droite', 'Interieur droite', rightArmX, -1, armYsInterior);
  arm('exterieur-droite', 'Exterieur droite', rightArmX, 1, armYsExterior);

  const connector = (id: string, label: string, yBase: number, dir: 1 | -1, xs: number[]) => {
    for (let i = 0; i < 2; i++) {
      const y = yBase + dir * (PATH_CLEARANCE + i * SLOT_SIZE);
      bands.push({ groupId: `${id}-r${i + 1}`, label: `${label} — rangee ${i + 1}`, points: xs.map((x) => [x, y]) });
    }
  };
  connector('interieur-bas', 'Interieur bas', connectorY, 1, connectorXsInterior);
  connector('exterieur-bas', 'Exterieur bas', connectorY, -1, connectorXsExterior);

  return bands;
}

/**
 * Rectangles des 6 plateaux rendus (apps/web/src/terrain3d.ts) : chacun
 * couvre les 2 colonnes/rangees d'une bande, plus une fine marge visuelle
 * (PLATFORM_MARGIN). Correspond exactement a l'emprise de laneBandSlots(),
 * donc plateau rendu et emplacements ne peuvent pas diverger.
 */
export function zoneFootprints(lane: Lane): ZoneFootprint[] {
  const { leftArmX, rightArmX, connectorY, armTopY } = laneAnchors(lane);
  const armY0 = Math.min(connectorY, armTopY) - PLATFORM_MARGIN;
  const armY1 = Math.max(connectorY, armTopY) + PLATFORM_MARGIN;
  // La rangee interieure du connecteur est bornee (meme limite que
  // laneBandSlots) pour ne pas chevaucher la ligne des bras ; l'exterieure
  // couvre la largeur complete, cf. commentaire dans laneBandSlots.
  const interiorX0 = Math.min(leftArmX, rightArmX) + PATH_CLEARANCE - PLATFORM_MARGIN;
  const interiorX1 = Math.max(leftArmX, rightArmX) - PATH_CLEARANCE + PLATFORM_MARGIN;
  const exteriorX0 = Math.min(leftArmX, rightArmX) - PLATFORM_MARGIN;
  const exteriorX1 = Math.max(leftArmX, rightArmX) + PLATFORM_MARGIN;
  const bandDepth = SLOT_SIZE + 2 * PLATFORM_MARGIN;

  return [
    { id: 'interieur-gauche', x0: leftArmX + PATH_CLEARANCE - PLATFORM_MARGIN, x1: leftArmX + PATH_CLEARANCE - PLATFORM_MARGIN + bandDepth, y0: armY0, y1: armY1 },
    { id: 'exterieur-gauche', x0: leftArmX - PATH_CLEARANCE - SLOT_SIZE - PLATFORM_MARGIN, x1: leftArmX - PATH_CLEARANCE + PLATFORM_MARGIN, y0: armY0, y1: armY1 },
    { id: 'interieur-droite', x0: rightArmX - PATH_CLEARANCE - SLOT_SIZE - PLATFORM_MARGIN, x1: rightArmX - PATH_CLEARANCE + PLATFORM_MARGIN, y0: armY0, y1: armY1 },
    { id: 'exterieur-droite', x0: rightArmX + PATH_CLEARANCE - PLATFORM_MARGIN, x1: rightArmX + PATH_CLEARANCE - PLATFORM_MARGIN + bandDepth, y0: armY0, y1: armY1 },
    { id: 'interieur-bas', x0: interiorX0, x1: interiorX1, y0: connectorY + PATH_CLEARANCE - PLATFORM_MARGIN, y1: connectorY + PATH_CLEARANCE - PLATFORM_MARGIN + bandDepth },
    { id: 'exterieur-bas', x0: exteriorX0, x1: exteriorX1, y0: connectorY - PATH_CLEARANCE - SLOT_SIZE - PLATFORM_MARGIN, y1: connectorY - PATH_CLEARANCE + PLATFORM_MARGIN },
  ];
}
