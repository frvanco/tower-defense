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
 * Echantillonne un segment [a,b] en incluant TOUJOURS ses deux extremites,
 * avec n+1 points repartis a intervalle egal (n = longueur / step, arrondi —
 * donc tres proche de `step` sans l'etre pixel-pres). Retour direct sur deux
 * essais precedents :
 *
 * 1. Accumuler la longueur d'arc en continu sur toute la polyligne
 *    gauche+bas+droite ne garantissait pas qu'un point tombe pile sur un
 *    coin : les deux points les plus proches de part et d'autre d'un virage
 *    a 90° pouvaient se retrouver a moins de `step` l'un de l'autre en ligne
 *    droite (le chemin "replie" sur lui-meme), obligeant a en supprimer un
 *    apres coup — les trous aux coins signales.
 * 2. Echantillonner chaque segment a `step` fixe depuis une seule extremite
 *    (l'autre extremite ajoutee separement) force bien les deux bouts a
 *    etre des points, mais laisse le reliquat d'arrondi (si la longueur du
 *    segment n'est pas un multiple exact de `step`) toujours du meme cote
 *    (celui ou l'echantillonnage s'arrete). Applique a "gauche" (du haut
 *    vers le bas) et "droite" (du bas vers le haut), le reliquat finit a
 *    des extremites OPPOSEES en coordonnees absolues (bas pour l'un, haut
 *    pour l'autre) : les deux bandes ont alors le meme nombre de points mais
 *    ne sont plus l'image miroir l'une de l'autre — casse la symetrie
 *    gauche/droite et laisse un emplacement de bord sans voisin a exactement
 *    `step`.
 *
 * Repartir uniformement resout les deux a la fois : les extremites sont
 * toujours des points (donc les coins se raccordent), et le motif est
 * identique quel que soit le sens de parcours (donc gauche et droite,
 * segments de meme longueur, sont des images miroir exactes).
 */
function sampleSegmentEnds(ax: number, ay: number, bx: number, by: number, step: number): Array<[number, number]> {
  const segLen = Math.hypot(bx - ax, by - ay);
  // floor, pas round : l'espacement resultant (segLen/n) doit rester >=
  // step (jamais deux tours a moins de SLOT_SIZE), quitte a s'eloigner un
  // peu plus de `step` que ne le ferait l'arrondi le plus proche.
  const n = Math.max(1, Math.floor(segLen / step));
  const pts: Array<[number, number]> = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    pts.push([ax + t * (bx - ax), ay + t * (by - ay)]);
  }
  return pts;
}

/**
 * Meme repartition uniforme que sampleSegmentEnds (n = floor(longueur /
 * step) intervalles egaux), mais SANS les extremites — pour le segment du
 * milieu (connecteur/bas), dont les deux coins sont deja couverts par les
 * segments voisins (gauche et droite) qui incluent leurs propres
 * extremites. Evite que le coin partage soit compte deux fois sous deux
 * groupIds differents.
 *
 * Reutilise le meme n (pas un pas fixe depuis une seule extremite) pour que
 * l'ensemble des points reste symetrique par rapport au milieu du segment :
 * le point a k/n a pour miroir celui a (n-k)/n, lui aussi dans l'ensemble
 * genere (k et n-k parcourent tous deux 1..n-1). Un simple pas fixe depuis
 * une extremite unique ne garantit pas cette symetrie (retour direct :
 * c'est ce qui cassait la symetrie gauche/droite de la bande du bas).
 */
function sampleSegmentInterior(ax: number, ay: number, bx: number, by: number, step: number): Array<[number, number]> {
  const segLen = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.floor(segLen / step));
  const pts: Array<[number, number]> = [];
  for (let k = 1; k < n; k++) {
    const t = k / n;
    pts.push([ax + t * (bx - ax), ay + t * (by - ay)]);
  }
  return pts;
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
  // Gauche et droite incluent chacun leurs deux extremites (dont le coin
  // partage avec "bas") ; "bas" ne reprend que son interieur — evite de
  // compter un coin deux fois, et donne a gauche/droite la meme longueur de
  // segment donc le meme nombre de points (symetrie).
  for (let col = 0; col < DEPTH; col++) {
    const offset = PATH_CLEARANCE + col * SLOT_SIZE;
    const topLeft: [number, number] = [leftArmX - offset, armTopY];
    const bottomLeft: [number, number] = [leftArmX - offset, connectorY - offset];
    const bottomRight: [number, number] = [rightArmX + offset, connectorY - offset];
    const topRight: [number, number] = [rightArmX + offset, armTopY];

    const gauche = sampleSegmentEnds(...topLeft, ...bottomLeft, SLOT_SIZE);
    const bas = sampleSegmentInterior(...bottomLeft, ...bottomRight, SLOT_SIZE);
    const droite = sampleSegmentEnds(...bottomRight, ...topRight, SLOT_SIZE);

    bands.push({ groupId: `exterieur-gauche-c${col + 1}`, label: `Exterieur gauche — colonne ${col + 1}`, points: gauche });
    if (bas.length > 0) bands.push({ groupId: `exterieur-bas-c${col + 1}`, label: `Exterieur bas — colonne ${col + 1}`, points: bas });
    bands.push({ groupId: `exterieur-droite-c${col + 1}`, label: `Exterieur droite — colonne ${col + 1}`, points: droite });
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
