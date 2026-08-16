import { laneAnchors } from './laneGeometry.js';
import type { Lane } from './index.js';

/**
 * Largeur du couloir, en unites monde — determine a la fois le rendu du
 * ruban de chemin (apps/web/scene3d.ts) et le retrait des zones
 * constructibles vis-a-vis du chemin (PATH_CLEARANCE ci-dessous). Source
 * unique pour que rendu et emplacements ne puissent pas diverger.
 */
export const PATH_WIDTH = 90;

/** >= SLOT_SIZE (ci-dessous) : un emplacement pose au bord meme d'une zone
 * reste a distance de securite du chemin (packages/sim/test verifie
 * qu'aucun emplacement n'empiete a moins de SLOT_SIZE du couloir). La marge
 * au-dela de SLOT_SIZE couvre les coins (un coin de zone peut etre plus
 * proche d'un virage du chemin qu'un simple retrait perpendiculaire). */
const PATH_CLEARANCE = 84;

/** Emprise minimale entre deux tours (packages/sim/src/sim.ts) — aussi
 * l'espacement des emplacements dans chaque zone : les tours sont collees.
 * Duplique le SLOT_SIZE de slots.js (meme convention, pas reexporte d'ici
 * pour eviter un conflit de nom au niveau de index.ts). */
const SLOT_SIZE = 64;

/** Marge visuelle entre le dernier emplacement et le bord du plateau (evite
 * qu'une tour semble poser sa base dans le vide au bord de la falaise). */
const PLATFORM_MARGIN = 32;

/**
 * Nombre d'emplacements par zone (colonnes x rangees). Determine directement
 * la taille du plateau (cf. zoneFootprints ci-dessous) : a espacement fixe
 * (SLOT_SIZE, les tours sont collees), le plateau est dimensionne pour
 * correspondre exactement au bloc de tours — pas de zone constructible sans
 * tour dessus, pas de tour qui deborde du plateau.
 */
export const DIMS: Record<ZoneFootprint['id'], { cols: number; rows: number; label: string }> = {
  milieu: { cols: 5, rows: 22, label: 'Milieu' },
  gauche: { cols: 3, rows: 16, label: 'Cote gauche' },
  droite: { cols: 3, rows: 16, label: 'Cote droite' },
  bas: { cols: 12, rows: 3, label: 'Bas' },
};

export interface ZoneFootprint {
  id: 'milieu' | 'gauche' | 'droite' | 'bas';
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function blockSize(id: ZoneFootprint['id']): { w: number; h: number } {
  const { cols, rows } = DIMS[id];
  return {
    w: (cols - 1) * SLOT_SIZE + 2 * PLATFORM_MARGIN,
    h: (rows - 1) * SLOT_SIZE + 2 * PLATFORM_MARGIN,
  };
}

/**
 * Rectangles des 4 zones constructibles (coordonnees monde, arene du joueur
 * 0) : milieu (interieur du couloir, entre les deux bras), gauche/droite
 * (exterieur de chaque bras), bas (sous la liaison horizontale). Chaque
 * plateau est colle au chemin (son bord le plus proche est a PATH_CLEARANCE
 * du chemin) et dimensionne au plus juste pour son bloc de tours (DIMS) —
 * retour direct : les tours doivent etre collees les unes aux autres tout en
 * occupant 100% de leur zone, donc c'est la zone qui s'adapte au bloc de
 * tours plutot que l'inverse.
 */
export function zoneFootprints(lane: Lane): ZoneFootprint[] {
  const { leftArmX, rightArmX, connectorY } = laneAnchors(lane);
  const midX = (leftArmX + rightArmX) / 2;
  const bottomTop = connectorY - PATH_CLEARANCE;

  const milieu = blockSize('milieu');
  const gauche = blockSize('gauche');
  const droite = blockSize('droite');
  const bas = blockSize('bas');

  const milieuY0 = connectorY + PATH_CLEARANCE;

  return [
    {
      id: 'milieu',
      x0: midX - milieu.w / 2,
      x1: midX + milieu.w / 2,
      y0: milieuY0,
      y1: milieuY0 + milieu.h,
    },
    {
      id: 'gauche',
      x0: leftArmX - PATH_CLEARANCE - gauche.w,
      x1: leftArmX - PATH_CLEARANCE,
      y0: bottomTop,
      y1: bottomTop + gauche.h,
    },
    {
      id: 'droite',
      x0: rightArmX + PATH_CLEARANCE,
      x1: rightArmX + PATH_CLEARANCE + droite.w,
      y0: bottomTop,
      y1: bottomTop + droite.h,
    },
    {
      id: 'bas',
      x0: midX - bas.w / 2,
      x1: midX + bas.w / 2,
      y0: bottomTop - bas.h,
      y1: bottomTop,
    },
  ];
}

/** Rectangle d'un plateau, retire de PLATFORM_MARGIN sur chaque bord :
 * correspond exactement au bloc de tours (espacement SLOT_SIZE, collees) —
 * utilise pour le PLACEMENT des emplacements (packages/data/scripts/gen_slots.ts),
 * separement du rectangle plein utilise pour le rendu du plateau. */
export function slotFootprint(zone: ZoneFootprint): ZoneFootprint {
  return {
    id: zone.id,
    x0: zone.x0 + PLATFORM_MARGIN,
    x1: zone.x1 - PLATFORM_MARGIN,
    y0: zone.y0 + PLATFORM_MARGIN,
    y1: zone.y1 - PLATFORM_MARGIN,
  };
}
