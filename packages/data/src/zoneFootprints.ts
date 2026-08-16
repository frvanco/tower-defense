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
 * l'espacement, exact, des emplacements le long d'une bande ou d'une grille
 * (les tours sont collees). Duplique le SLOT_SIZE de slots.js (meme
 * convention, pas reexporte d'ici pour eviter un conflit de nom au niveau
 * de index.ts). */
const SLOT_SIZE = 64;

/** Marge visuelle entre le dernier emplacement d'une zone et le bord du
 * plateau rendu (evite qu'une tour semble poser sa base dans le vide au bord
 * de la falaise). N'affecte pas le placement des emplacements eux-memes. */
const PLATFORM_MARGIN = 32;

export type ZoneId = 'interieur' | 'exterieur-gauche' | 'exterieur-droite' | 'exterieur-bas';

/** Rectangle d'un plateau rendu (apps/web/src/terrain3d.ts). Les 3 plateaux
 * exterieurs debordent volontairement les uns dans les autres au niveau des
 * coins bas (cf. zoneFootprints ci-dessous) pour qu'il n'y ait pas d'encoche
 * visible entre eux, meme si leurs bords ne tombent pas au pixel pres au
 * meme endroit. */
export interface ZoneFootprint {
  id: ZoneId;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface BandSlots {
  /** Identifiant de rangee/colonne, ex. "interieur-r1" ou
   * "exterieur-gauche-c1" — utilise tel quel comme groupId dans
   * build_slots.json. */
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
 * Echantillonne une polyligne a intervalle regulier (longueur d'arc), en
 * numerotant chaque point par l'indice du segment source (0 = premier
 * segment de `points`, etc.) — sert a re-decouper le contour continu
 * ci-dessous en groupes nommes (gauche / bas / droite) sans jamais generer
 * deux points pour un meme endroit : contrairement a un echantillonnage par
 * segment independant, un coin n'est visite qu'une seule fois.
 */
function sampleAlongPolyline(points: Array<[number, number]>, step: number): Array<{ point: [number, number]; segment: number }> {
  const samples: Array<{ point: [number, number]; segment: number }> = [];
  let covered = 0;
  let nextAt = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i]!;
    const [bx, by] = points[i + 1]!;
    const segLen = Math.hypot(bx - ax, by - ay);
    while (nextAt <= covered + segLen + 1e-6) {
      const t = segLen === 0 ? 0 : (nextAt - covered) / segLen;
      samples.push({ point: [ax + t * (bx - ax), ay + t * (by - ay)], segment: i });
      nextAt += step;
    }
    covered += segLen;
  }
  return samples;
}

/**
 * Emplacements bruts (avant filtrage, a la charge de l'appelant — voir
 * packages/data/scripts/gen_slots.ts) :
 *
 * - L'INTERIEUR du U (entre les deux bras, au-dessus du connecteur) est
 *   entierement rempli par une grille reguliere a PATH_CLEARANCE du chemin,
 *   espacee de SLOT_SIZE (tours collees) — pas juste une bande le long des
 *   bras.
 * - L'EXTERIEUR est une bande de profondeur 2 qui longe les 3 segments du
 *   couloir (bras gauche, connecteur, bras droit) COMME UN SEUL CONTOUR
 *   continu : on decale la polyligne du chemin perpendiculairement vers
 *   l'exterieur (de PATH_CLEARANCE, puis PATH_CLEARANCE + SLOT_SIZE), et on
 *   echantillonne ce contour a intervalle SLOT_SIZE. Les coins se raccordent
 *   naturellement (le contour decale d'un angle droit reste un angle droit,
 *   son sommet est simplement les deux segments voisins decales) : plus
 *   besoin de dedupliquer, contrairement a une generation par segment
 *   independant (retour direct : ca laissait une encoche visible aux coins).
 */
export function laneBandSlots(lane: Lane): BandSlots[] {
  const { leftArmX, rightArmX, connectorY, armTopY } = laneAnchors(lane);

  // --- Interieur : grille pleine ---
  const interiorXs = range(leftArmX + PATH_CLEARANCE, rightArmX - PATH_CLEARANCE, SLOT_SIZE);
  const interiorYs = range(connectorY + PATH_CLEARANCE, armTopY, SLOT_SIZE);

  const bands: BandSlots[] = [];
  interiorYs.forEach((y, i) => {
    bands.push({ groupId: `interieur-r${i + 1}`, label: `Interieur — rangee ${i + 1}`, points: interiorXs.map((x) => [x, y]) });
  });

  // --- Exterieur : contour continu offset, un jeu de points par colonne (c1/c2) ---
  // Contour du couloir vu de l'exterieur du U : haut du bras gauche -> coin
  // bas-gauche -> coin bas-droit -> haut du bras droit. Decale de `offset`
  // (perpendiculairement, donc en X pour les bras et en Y pour le
  // connecteur), le coin decale est simplement l'intersection des deux
  // lignes decalees — un angle droit reste un angle droit.
  const exteriorContour = (offset: number): Array<[number, number]> => [
    [leftArmX - offset, armTopY],
    [leftArmX - offset, connectorY - offset],
    [rightArmX + offset, connectorY - offset],
    [rightArmX + offset, armTopY],
  ];

  const segmentGroup = ['exterieur-gauche', 'exterieur-bas', 'exterieur-droite'] as const;
  const segmentLabel = ['Exterieur gauche', 'Exterieur bas', 'Exterieur droite'] as const;

  for (let col = 0; col < 2; col++) {
    const offset = PATH_CLEARANCE + col * SLOT_SIZE;
    const samples = sampleAlongPolyline(exteriorContour(offset), SLOT_SIZE);
    const bySegment = new Map<number, Array<[number, number]>>();
    for (const s of samples) {
      if (!bySegment.has(s.segment)) bySegment.set(s.segment, []);
      bySegment.get(s.segment)!.push(s.point);
    }
    for (let seg = 0; seg < 3; seg++) {
      const pts = bySegment.get(seg) ?? [];
      if (pts.length === 0) continue;
      const id = segmentGroup[seg];
      bands.push({
        groupId: `${id}-c${col + 1}`,
        label: `${segmentLabel[seg]} — colonne ${col + 1}`,
        points: pts,
      });
    }
  }

  return bands;
}

/**
 * Rectangles des plateaux rendus (apps/web/src/terrain3d.ts) : un grand
 * rectangle pour l'interieur plein, et 3 rectangles pour les bandes
 * exterieures. Ces 3 derniers debordent volontairement les uns dans les
 * autres au niveau des coins bas (leur etendue depasse le strict minimum)
 * pour garantir un raccord visuel sans encoche, meme si leurs bords ne
 * correspondent pas au pixel pres a l'emplacement exact du dernier
 * emplacement.
 */
export function zoneFootprints(lane: Lane): ZoneFootprint[] {
  const { leftArmX, rightArmX, connectorY, armTopY } = laneAnchors(lane);
  const outerDepth = PATH_CLEARANCE + SLOT_SIZE; // 148 : bord le plus eloigne du chemin

  return [
    {
      id: 'interieur',
      x0: leftArmX + PATH_CLEARANCE - PLATFORM_MARGIN,
      x1: rightArmX - PATH_CLEARANCE + PLATFORM_MARGIN,
      y0: connectorY + PATH_CLEARANCE - PLATFORM_MARGIN,
      y1: armTopY + PLATFORM_MARGIN,
    },
    {
      id: 'exterieur-gauche',
      x0: leftArmX - outerDepth - PLATFORM_MARGIN,
      x1: leftArmX - PATH_CLEARANCE + PLATFORM_MARGIN,
      // Deborde jusqu'au bord bas du plateau "exterieur-bas" pour couvrir le coin.
      y0: connectorY - outerDepth - PLATFORM_MARGIN,
      y1: armTopY + PLATFORM_MARGIN,
    },
    {
      id: 'exterieur-droite',
      x0: rightArmX + PATH_CLEARANCE - PLATFORM_MARGIN,
      x1: rightArmX + outerDepth + PLATFORM_MARGIN,
      y0: connectorY - outerDepth - PLATFORM_MARGIN,
      y1: armTopY + PLATFORM_MARGIN,
    },
    {
      id: 'exterieur-bas',
      // Deborde jusqu'au bord exterieur des plateaux des bras pour couvrir les 2 coins.
      x0: leftArmX - outerDepth - PLATFORM_MARGIN,
      x1: rightArmX + outerDepth + PLATFORM_MARGIN,
      y0: connectorY - outerDepth - PLATFORM_MARGIN,
      y1: connectorY - PATH_CLEARANCE + PLATFORM_MARGIN,
    },
  ];
}
