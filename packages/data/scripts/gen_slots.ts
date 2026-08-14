// Genere build_slots.json : des rangees d'emplacements de construction
// paralleles a chaque segment du couloir de la lane 0, filtrees pour ne
// garder que celles a l'interieur de la zone constructible.
//
// Le systeme cible (grille de pathing avec `isBuildableSlot()`) n'existe pas
// dans ce depot — il n'y a pas de grille de pathing du tout, seulement un
// rectangle `lane.buildZone`. Le filtre utilise donc la meme regle que
// `inBuildZone` dans packages/sim/src/sim.ts.
//
// Usage : npx tsx scripts/gen_slots.ts (depuis packages/data/)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lanes } from '../src/index.js';

// --- Parametres, faciles a changer ---
// 6/2 (valeurs de depart) donnaient 72 emplacements (3 segments x 2 cotes x
// 2 rangees x 6 cases), au-dessus de la fourchette visee (40-60) avec 0 rejet
// — DISTANCE_FROM_PATH=150 laissait largement assez de place dans la zone
// constructible, le probleme etait juste "trop de cases", pas leur position.
// Reduit a 4 cases/rangee pour retomber a 48.
const SLOTS_PER_ROW = 4;
const ROWS_PER_SIDE = 2;
const DISTANCE_FROM_PATH = 150;
// --- fin des parametres ---

/** Meme valeur que TOWER_FOOTPRINT dans packages/sim/src/sim.ts : emprise
 * minimale entre deux tours, donc taille d'une case. */
const SLOT_SIZE = 64;

const lane = lanes.find((l) => l.player === 0);
if (!lane) throw new Error('lane 0 introuvable');

/** Le couloir de ce jeu a toujours exactement 3 segments (spawn -> wp1 -> wp2
 * -> end, cf. Lane.waypoints dans packages/data/src/index.ts) : pas besoin de
 * generaliser a un nombre de segments variable. */
const path0: Array<[number, number]> = [lane.spawn, ...lane.waypoints];
const SEGMENT_LABELS = ['bas', 'milieu', 'haut'];
const SIDE_LABELS: Record<number, string> = { [-1]: 'gauche', 1: 'droite' };

interface Group {
  id: string;
  label: string;
  slots: Array<[number, number]>;
}

function inBuildZone(x: number, y: number): boolean {
  const z = lane!.buildZone;
  return x >= z.left && x <= z.right && y >= z.bottom && y <= z.top;
}

const rawGroups: Group[] = [];
let rejectedOutOfZone = 0;

for (let seg = 0; seg < path0.length - 1; seg++) {
  const a = path0[seg]!;
  const b = path0[seg + 1]!;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const dirX = dx / len;
  const dirY = dy / len;
  const perpX = -dirY;
  const perpY = dirX;

  const rowSpan = (SLOTS_PER_ROW - 1) * SLOT_SIZE;
  const startAlong = (len - rowSpan) / 2; // centre la rangee sur le segment

  for (const side of [-1, 1] as const) {
    for (let r = 0; r < ROWS_PER_SIDE; r++) {
      const distance = DISTANCE_FROM_PATH + r * SLOT_SIZE;
      const rowSlots: Array<[number, number]> = [];
      for (let i = 0; i < SLOTS_PER_ROW; i++) {
        const along = startAlong + i * SLOT_SIZE;
        const x = a[0] + dirX * along + perpX * side * distance;
        const y = a[1] + dirY * along + perpY * side * distance;
        if (!inBuildZone(x, y)) {
          rejectedOutOfZone++;
          continue;
        }
        rowSlots.push([Math.round(x), Math.round(y)]);
      }
      if (rowSlots.length === 0) continue;
      const segLabel = SEGMENT_LABELS[seg] ?? `segment${seg}`;
      const id = `${segLabel}-${SIDE_LABELS[side]}-r${r + 1}`;
      rawGroups.push({
        id,
        label: `Segment ${segLabel} — cote ${SIDE_LABELS[side]}, rangee ${r + 1}`,
        slots: rowSlots,
      });
    }
  }
}

// Dedup : deux rangees issues de segments differents peuvent se recouvrir
// pres d'un virage. On garde le premier arrive ; l'espacement minimum est
// SLOT_SIZE, la meme regle que l'emprise TOWER_FOOTPRINT en jeu.
const placed: Array<[number, number]> = [];
let rejectedOverlap = 0;
const groups: Group[] = [];
for (const g of rawGroups) {
  const slots: Array<[number, number]> = [];
  for (const [x, y] of g.slots) {
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

const out = {
  note: 'Emplacements de construction. Coordonnees monde, arene du joueur 0.',
  slotSize: SLOT_SIZE,
  groups,
};

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(here, '../src/build_slots.json');
writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n', 'utf8');

console.log(`${total} emplacements generes dans ${groups.length} rangees.`);
console.log(`rejetes : ${rejectedOutOfZone} hors zone constructible, ${rejectedOverlap} trop proches d'un autre emplacement.`);
if (total < 40 || total > 60) {
  console.warn(
    `ATTENTION : ${total} est hors de la fourchette visee (40-60). Ajuster SLOTS_PER_ROW/ROWS_PER_SIDE/DISTANCE_FROM_PATH en tete du script.`,
  );
}
if (rejectedOutOfZone > total * 0.15) {
  console.warn('ATTENTION : beaucoup de rejets hors zone — DISTANCE_FROM_PATH est probablement mal choisi.');
}
console.log(`ecrit : ${path.relative(process.cwd(), outFile)}`);
