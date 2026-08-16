// Genere build_slots.json : dans chaque zone (packages/data/src/zoneFootprints.ts),
// les emplacements forment une grille collee (espacement exact SLOT_SIZE) qui
// occupe tout le plateau — le plateau lui-meme est desormais dimensionne pour
// correspondre exactement au bloc de tours (DIMS), donc "collees" et "toute
// la zone occupee" ne sont plus contradictoires. Retour direct : une version
// precedente gardait de grandes zones (issues de la geometrie du chemin) et y
// etalait les emplacements avec un grand espacement pour les couvrir en
// entier ; ce n'est pas ce qui etait voulu — voir zoneFootprints.ts.
//
// Le systeme cible du prompt d'origine (grille de pathing avec
// `isBuildableSlot()`) n'existe pas dans ce depot — il n'y a pas de grille de
// pathing du tout. Le filtre utilise donc la meme regle que `inBuildZone`
// (ancienne version de packages/sim/src/sim.ts).
//
// Usage : npx tsx scripts/gen_slots.ts (depuis packages/data/)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lanes, zoneFootprints, slotFootprint, DIMS } from '../src/index.js';

/** Emprise minimale entre deux tours (packages/sim/src/sim.ts) : aussi
 * l'espacement cible ici, les tours se touchent. */
const SLOT_SIZE = 64;

const lane = lanes.find((l) => l.player === 0);
if (!lane) throw new Error('lane 0 introuvable');

const bz = lane.buildZone;

interface Group {
  id: string;
  label: string;
  slots: Array<[number, number]>;
}

function inBuildZone(x: number, y: number): boolean {
  return x >= bz.left && x <= bz.right && y >= bz.bottom && y <= bz.top;
}

const groups: Group[] = [];
let rejectedOutOfZone = 0;
let rejectedOverlap = 0;
const placed: Array<[number, number]> = [];

for (const zone of zoneFootprints(lane)) {
  const { cols, rows, label } = DIMS[zone.id];
  const inset = slotFootprint(zone);

  for (let r = 0; r < rows; r++) {
    const y = inset.y0 + r * SLOT_SIZE;
    const rowSlots: Array<[number, number]> = [];
    for (let c = 0; c < cols; c++) {
      const x = inset.x0 + c * SLOT_SIZE;
      const rx = Math.round(x);
      const ry = Math.round(y);
      if (!inBuildZone(rx, ry)) {
        rejectedOutOfZone++;
        continue;
      }
      const tooClose = placed.some(([px, py]) => Math.hypot(px - rx, py - ry) < SLOT_SIZE);
      if (tooClose) {
        rejectedOverlap++;
        continue;
      }
      placed.push([rx, ry]);
      rowSlots.push([rx, ry]);
    }
    if (rowSlots.length > 0) {
      groups.push({ id: `${zone.id}-r${r + 1}`, label: `${label} — rangee ${r + 1}`, slots: rowSlots });
    }
  }
}

const total = groups.reduce((n, g) => n + g.slots.length, 0);
const expected = Object.values(DIMS).reduce((n, d) => n + d.cols * d.rows, 0);

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
  console.warn('ATTENTION : le total ne correspond pas au calcul attendu — verifier zoneFootprints.ts ou les dimensions.');
}
console.log(`ecrit : ${path.relative(process.cwd(), outFile)}`);
