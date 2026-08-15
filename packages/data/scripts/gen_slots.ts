// Genere build_slots.json : quatre blocs rectangulaires d'emplacements de
// construction, poses par rapport aux points cles du couloir de la lane 0
// (les deux bras verticaux et la liaison horizontale qui les relie) :
//
//   - "milieu" : le grand espace INTERIEUR du couloir, entre les deux bras.
//   - "gauche" / "droite" : de chaque cote, a l'EXTERIEUR de chaque bras.
//   - "bas"    : sous la liaison horizontale, entre elle et le bord bas de
//                la zone constructible (pres du spawn).
//
// Chaque bloc est ecrit comme plusieurs rangees nommees (une rangee = un
// alignement de cases cote a cote, espacees exactement de slotSize) plutot
// que comme un seul groupe, pour rester coherent avec le format du fichier
// et avec le test qui verifie l'espacement au sein d'une rangee.
//
// Le systeme cible (grille de pathing avec `isBuildableSlot()`) n'existe pas
// dans ce depot — il n'y a pas de grille de pathing du tout, seulement un
// rectangle `lane.buildZone`. Le filtre utilise donc la meme regle que
// `inBuildZone` (ancienne version de packages/sim/src/sim.ts).
//
// Usage : npx tsx scripts/gen_slots.ts (depuis packages/data/)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lanes } from '../src/index.js';

// --- Parametres, faciles a changer ---
// Dimensions demandees : milieu 5 de large x 22 de long ; cotes 3 de large x
// 12 de long (chacun) ; bas 12 de large x 3 de profond. Remplace la version
// precedente (rangees eparses, ~48 emplacements au total, cf. git log) —
// choix explicite de densite plutot que de raret, a la demande directe.
const MIDDLE_COLS = 5;
const MIDDLE_ROWS = 22;
const SIDE_COLS = 3;
const SIDE_ROWS = 12;
const BOTTOM_COLS = 12;
const BOTTOM_ROWS = 3;
/** Distance minimale entre le couloir et le bord d'un bloc. */
const CLEARANCE = 150;
// --- fin des parametres ---

/** Meme valeur que TOWER_FOOTPRINT dans packages/sim/src/sim.ts : emprise
 * minimale entre deux tours, donc taille d'une case. */
const SLOT_SIZE = 64;

const lane = lanes.find((l) => l.player === 0);
if (!lane) throw new Error('lane 0 introuvable');

const [spawnX, spawnY] = lane.spawn;
const [wp1X, wp1Y] = lane.waypoints[0]!;
const [wp2X, wp2Y] = lane.waypoints[1]!;
const [endX, endY] = lane.waypoints[2]!;

/** Points cles du couloir : deux bras quasi verticaux relies par une liaison
 * quasi horizontale (spawn -> wp1 -> wp2 -> end). On les traite comme des
 * droites axees pour poser des blocs rectangulaires simples — les segments
 * reels ont une pente negligeable (quelques dizaines d'unites sur des
 * milliers), l'ecart est absorbe par CLEARANCE. */
const leftArmX = (spawnX + wp1X) / 2;
const rightArmX = (wp2X + endX) / 2;
const connectorY = (wp1Y + wp2Y) / 2;
const armTopY = Math.max(spawnY, endY);

const bz = lane.buildZone;

interface Group {
  id: string;
  label: string;
  slots: Array<[number, number]>;
}

function inBuildZone(x: number, y: number): boolean {
  return x >= bz.left && x <= bz.right && y >= bz.bottom && y <= bz.top;
}

/**
 * Un bloc = plusieurs rangees de `cols` emplacements, espacees de SLOT_SIZE
 * dans les deux directions. (originX, originY) est le coin de la rangee 0 ;
 * chaque rangee suivante avance de SLOT_SIZE le long de `rowDir` (+1 ou -1).
 */
function makeBlock(idPrefix: string, labelPrefix: string, originX: number, originY: number, cols: number, rows: number, rowDir: 1 | -1): Group[] {
  const groups: Group[] = [];
  for (let r = 0; r < rows; r++) {
    const y = originY + r * SLOT_SIZE * rowDir;
    const slots: Array<[number, number]> = [];
    for (let c = 0; c < cols; c++) {
      const x = originX + c * SLOT_SIZE;
      slots.push([Math.round(x), Math.round(y)]);
    }
    groups.push({ id: `${idPrefix}-r${r + 1}`, label: `${labelPrefix} — rangee ${r + 1}`, slots });
  }
  return groups;
}

const rawGroups: Group[] = [];

// --- Milieu : interieur du couloir, entre les deux bras, au-dessus de la liaison.
{
  const midX = (leftArmX + rightArmX) / 2;
  const blockWidth = (MIDDLE_COLS - 1) * SLOT_SIZE;
  const originX = midX - blockWidth / 2;
  const vSpanStart = connectorY + CLEARANCE;
  const vSpanEnd = armTopY - CLEARANCE;
  const blockHeight = (MIDDLE_ROWS - 1) * SLOT_SIZE;
  const originY = vSpanStart + (vSpanEnd - vSpanStart - blockHeight) / 2;
  rawGroups.push(...makeBlock('milieu', 'Milieu', originX, originY, MIDDLE_COLS, MIDDLE_ROWS, 1));
}

// --- Cotes : a l'exterieur de chaque bras, centres sur sa longueur.
{
  const armSpanStart = Math.min(wp1Y, spawnY);
  const armSpanEnd = Math.max(wp1Y, spawnY);
  const blockHeight = (SIDE_ROWS - 1) * SLOT_SIZE;
  const originY = armSpanStart + (armSpanEnd - armSpanStart - blockHeight) / 2;
  const nearX = leftArmX - CLEARANCE;
  const originX = nearX - (SIDE_COLS - 1) * SLOT_SIZE; // s'etend plus loin vers l'exterieur (x decroissant)
  rawGroups.push(...makeBlock('gauche', 'Cote gauche', originX, originY, SIDE_COLS, SIDE_ROWS, 1));
}
{
  const armSpanStart = Math.min(wp2Y, endY);
  const armSpanEnd = Math.max(wp2Y, endY);
  const blockHeight = (SIDE_ROWS - 1) * SLOT_SIZE;
  const originY = armSpanStart + (armSpanEnd - armSpanStart - blockHeight) / 2;
  const originX = rightArmX + CLEARANCE; // s'etend vers l'exterieur (x croissant)
  rawGroups.push(...makeBlock('droite', 'Cote droite', originX, originY, SIDE_COLS, SIDE_ROWS, 1));
}

// --- Bas : sous la liaison, entre elle et le bord bas de la zone constructible.
{
  const midX = (leftArmX + rightArmX) / 2;
  const blockWidth = (BOTTOM_COLS - 1) * SLOT_SIZE;
  const originX = midX - blockWidth / 2;
  const spanStart = bz.bottom;
  const spanEnd = connectorY - CLEARANCE;
  const blockHeight = (BOTTOM_ROWS - 1) * SLOT_SIZE;
  const originY = spanStart + (spanEnd - spanStart - blockHeight) / 2;
  rawGroups.push(...makeBlock('bas', 'Bas', originX, originY, BOTTOM_COLS, BOTTOM_ROWS, 1));
}

// --- Filtrage : zone constructible + dedup (garde-fous, ne devraient rejeter
// personne avec des parametres sensés vu le calcul par blocs centres).
let rejectedOutOfZone = 0;
let rejectedOverlap = 0;
const placed: Array<[number, number]> = [];
const groups: Group[] = [];
for (const g of rawGroups) {
  const slots: Array<[number, number]> = [];
  for (const [x, y] of g.slots) {
    if (!inBuildZone(x, y)) {
      rejectedOutOfZone++;
      continue;
    }
    const tooClose = placed.some(([px, py]) => Math.hypot(px - x, py - y) < SLOT_SIZE);
    if (tooClose) {
      rejectedOverlap++;
      continue;
    }
    placed.push([x, y]);
    slots.push([x, y]);
  }
  if (slots.length > 0) groups.push({ ...g, slots });
}

const total = groups.reduce((n, g) => n + g.slots.length, 0);
const expected = MIDDLE_COLS * MIDDLE_ROWS + 2 * SIDE_COLS * SIDE_ROWS + BOTTOM_COLS * BOTTOM_ROWS;

const out = {
  note: 'Emplacements de construction. Coordonnees monde, arene du joueur 0.',
  slotSize: SLOT_SIZE,
  groups,
};

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(here, '../src/build_slots.json');
writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n', 'utf8');

console.log(`${total} emplacements generes dans ${groups.length} rangees (attendu : ${expected}).`);
console.log(`rejetes : ${rejectedOutOfZone} hors zone constructible, ${rejectedOverlap} trop proches d'un autre emplacement.`);
if (total !== expected) {
  console.warn('ATTENTION : le total ne correspond pas au calcul attendu — verifier CLEARANCE ou les dimensions de blocs.');
}
console.log(`ecrit : ${path.relative(process.cwd(), outFile)}`);
