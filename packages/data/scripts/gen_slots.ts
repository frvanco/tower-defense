// Genere build_slots.json : dans chaque zone (packages/data/src/zoneFootprints.ts),
// les emplacements forment un bloc compact — cote a cote, espaces d'exactement
// SLOT_SIZE (les tours se touchent, comme demande) — centre dans la zone, avec
// une marge (RECUL) qui l'ecarte un peu du chemin plutot que de coller au bord.
// Retour direct : une premiere version repartissait les 218 emplacements sur
// toute l'etendue de chaque zone (gros espacement, presque au bord du chemin) ;
// ce n'est pas ce qui etait voulu — les tours doivent rester collees les unes
// aux autres, meme si les zones (plateaux) restent larges.
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
import { lanes, zoneFootprints, type ZoneFootprint } from '../src/index.js';

// --- Parametres, faciles a changer ---
// Dimensions demandees : milieu 5 de large x 22 de long ; cotes 3 de large x
// 12 de long (chacun) ; bas 12 de large x 3 de profond. 218 emplacements au
// total, toujours espaces de SLOT_SIZE (collees) — seule leur position dans
// la zone (centree, en retrait du chemin) depend de zoneFootprints.ts.
const DIMS: Record<ZoneFootprint['id'], { cols: number; rows: number; label: string }> = {
  milieu: { cols: 5, rows: 22, label: 'Milieu' },
  gauche: { cols: 3, rows: 12, label: 'Cote gauche' },
  droite: { cols: 3, rows: 12, label: 'Cote droite' },
  bas: { cols: 12, rows: 3, label: 'Bas' },
};
// --- fin des parametres ---

/** Emprise minimale entre deux tours (packages/sim/src/sim.ts) — aussi
 * l'espacement cible ici : les tours se touchent, elles ne sont pas ecartees. */
const SLOT_SIZE = 64;

/** Recul supplementaire par rapport au bord de la zone (donc par rapport au
 * chemin, qui longe la zone) avant de centrer le bloc compact. */
const RECUL = 60;

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
  const blockW = (cols - 1) * SLOT_SIZE;
  const blockH = (rows - 1) * SLOT_SIZE;
  const midX = (zone.x0 + RECUL + zone.x1 - RECUL) / 2;
  const midY = (zone.y0 + RECUL + zone.y1 - RECUL) / 2;
  const x0 = midX - blockW / 2;
  const y0 = midY - blockH / 2;

  for (let r = 0; r < rows; r++) {
    const y = y0 + r * SLOT_SIZE;
    const rowSlots: Array<[number, number]> = [];
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * SLOT_SIZE;
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
