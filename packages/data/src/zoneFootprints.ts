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

/** Profondeur des bandes exterieures (nombre de colonnes/rangees). */
const DEPTH = 3;

/** Marge fixe entre le dernier emplacement d'une zone et le bord du plateau
 * rendu — le plateau est derive du contour des emplacements (voir
 * zoneFootprints), pas d'un rectangle englobant, donc cette marge est la
 * seule chose qui separe le bord du plateau du dernier emplacement, dans
 * toutes les directions y compris vers le chemin. */
const PLATFORM_MARGIN = 32;

export type ZoneId = 'interieur' | 'exterieur';

/**
 * Polygone (ferme) d'un plateau rendu (apps/web/src/terrain3d.ts) — derive
 * geometriquement des memes constantes que laneBandSlots ci-dessous (donc
 * ne peut pas en diverger), pas d'un rectangle englobant qui deborderait
 * des colonnes/rangees reelles. `interieur` est un simple rectangle ;
 * `exterieur` est un anneau en U (bras gauche + connecteur + bras droit
 * traites comme un seul contour, coins compris) — voir zoneFootprints().
 */
export interface ZoneFootprint {
  id: ZoneId;
  points: Array<[number, number]>;
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

/** Contour du couloir vu de l'exterieur du U, decale perpendiculairement de
 * `offset` : haut du bras gauche -> coin bas-gauche -> coin bas-droit ->
 * haut du bras droit. Un coin a 90° decale reste un coin a 90° (simple
 * intersection des deux lignes decalees) — partage entre laneBandSlots
 * (emplacements) et zoneFootprints (plateau) pour que les deux ne puissent
 * pas diverger. */
function exteriorContour(leftArmX: number, rightArmX: number, connectorY: number, armTopY: number, offset: number): Array<[number, number]> {
  return [
    [leftArmX - offset, armTopY],
    [leftArmX - offset, connectorY - offset],
    [rightArmX + offset, connectorY - offset],
    [rightArmX + offset, armTopY],
  ];
}

/**
 * Emplacements bruts (avant filtrage, a la charge de l'appelant — voir
 * packages/data/scripts/gen_slots.ts) :
 *
 * - L'INTERIEUR du U (entre les deux bras, au-dessus du connecteur) est
 *   entierement rempli par une grille reguliere a PATH_CLEARANCE du chemin,
 *   espacee de SLOT_SIZE (tours collees) — pas juste une bande le long des
 *   bras.
 * - L'EXTERIEUR est une bande de profondeur DEPTH qui longe les 3 segments
 *   du couloir (bras gauche, connecteur, bras droit) COMME UN SEUL CONTOUR
 *   continu : on decale la polyligne du chemin perpendiculairement vers
 *   l'exterieur (de PATH_CLEARANCE, PATH_CLEARANCE + SLOT_SIZE, ...), et on
 *   echantillonne ce contour a intervalle SLOT_SIZE. Les coins se raccordent
 *   naturellement : plus besoin de dedupliquer, contrairement a une
 *   generation par segment independant (retour direct : ca laissait une
 *   encoche visible aux coins).
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

  // --- Exterieur : contour continu offset, un jeu de points par colonne ---
  const segmentGroup = ['exterieur-gauche', 'exterieur-bas', 'exterieur-droite'] as const;
  const segmentLabel = ['Exterieur gauche', 'Exterieur bas', 'Exterieur droite'] as const;

  for (let col = 0; col < DEPTH; col++) {
    const offset = PATH_CLEARANCE + col * SLOT_SIZE;
    const samples = sampleAlongPolyline(exteriorContour(leftArmX, rightArmX, connectorY, armTopY, offset), SLOT_SIZE);
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
 * Polygones des plateaux rendus (apps/web/src/terrain3d.ts), derives des
 * memes constantes que laneBandSlots plutot que d'un rectangle englobant —
 * retour direct : le plateau debordait largement des colonnes de tours
 * (bande vide sur le pourtour, coins sans emplacements, pas d'arrondi aux
 * coins du couloir) parce qu'il etait calcule differemment des
 * emplacements.
 *
 * - `interieur` : rectangle a PLATFORM_MARGIN au-dela du dernier
 *   emplacement de la grille interieure, dans les 4 directions.
 * - `exterieur` : anneau en U a PLATFORM_MARGIN a l'interieur du premier
 *   emplacement (cote chemin) et PLATFORM_MARGIN au-dela du dernier (cote
 *   exterieur), les 3 segments traites comme un seul contour ferme (bord
 *   exterieur du U, puis retour par le bord interieur) — les coins suivent
 *   donc exactement l'angle droit du couloir, sans encoche ni rectangle en
 *   trop.
 */
export function zoneFootprints(lane: Lane): ZoneFootprint[] {
  const { leftArmX, rightArmX, connectorY, armTopY } = laneAnchors(lane);
  const innerR = PATH_CLEARANCE - PLATFORM_MARGIN;
  const outerR = PATH_CLEARANCE + (DEPTH - 1) * SLOT_SIZE + PLATFORM_MARGIN;
  const topY = armTopY + PLATFORM_MARGIN;

  const interieur: Array<[number, number]> = [
    [leftArmX + innerR, connectorY + innerR],
    [rightArmX - innerR, connectorY + innerR],
    [rightArmX - innerR, topY],
    [leftArmX + innerR, topY],
  ];

  // Bord exterieur (aller) puis bord interieur (retour), relies par 2
  // segments courts en bout de bras — trace un anneau en U ferme d'un
  // seul tenant, sans qu'aucun coin ne soit un rectangle separe.
  const exterieur: Array<[number, number]> = [
    [leftArmX - outerR, topY],
    [leftArmX - outerR, connectorY - outerR],
    [rightArmX + outerR, connectorY - outerR],
    [rightArmX + outerR, topY],
    [rightArmX + innerR, topY],
    [rightArmX + innerR, connectorY - innerR],
    [leftArmX - innerR, connectorY - innerR],
    [leftArmX - innerR, topY],
  ];

  return [
    { id: 'interieur', points: interieur },
    { id: 'exterieur', points: exterieur },
  ];
}
