// Genere build_slots.json : les emplacements de construction sont repartis
// sur TOUTE l'etendue de chaque zone (packages/data/src/zoneFootprints.ts),
// pas serres dans un coin ni regroupes en un seul bloc compact — l'espacement
// entre deux emplacements adjacents s'ajuste donc a la taille reelle de la
// zone. Retour direct : une version "bloc compact et collé, en retrait du
// chemin" laissait la majeure partie de chaque zone visuellement
// constructible mais sans aucun emplacement dessus — desormais toute la
// zone est couverte.
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
// Milieu 5 de large x 22 de long ; bas 12 de large x 3 de profond, inchanges.
// Cotes elargis de 12 a 16 de long (toujours 3 de large) — retour direct.
const DIMS: Record<ZoneFootprint['id'], { cols: number; rows: number; label: string }> = {
  milieu: { cols: 5, rows: 22, label: 'Milieu' },
  gauche: { cols: 3, rows: 16, label: 'Cote gauche' },
  droite: { cols: 3, rows: 16, label: 'Cote droite' },
  bas: { cols: 12, rows: 3, label: 'Bas' },
};
// --- fin des parametres ---

/** Emprise minimale entre deux tours (packages/sim/src/sim.ts) : plancher de
 * securite pour l'espacement calcule, jamais la valeur cible elle-meme (les
 * zones sont plus grandes que ce qu'un espacement serre a SLOT_SIZE
 * remplirait). */
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
let minSpacingSeen = Infinity;
const placed: Array<[number, number]> = [];

for (const zone of zoneFootprints(lane)) {
  const { cols, rows, label } = DIMS[zone.id];
  // "bas" touche EXACTEMENT "gauche"/"droite" (meme Y, cf. zoneFootprints.ts —
  // c'est voulu, aucun vide entre les zones). Sans marge, la rangee la plus
  // proche de "bas" tombe pile sur celle de "gauche"/"droite" et se fait
  // rejeter par le dedup. On retire un SLOT_SIZE au bord partage, seulement
  // pour le PLACEMENT des cases — le plateau rendu (zoneFootprints) continue
  // de toucher exactement, la jonction reste visuellement sans coupure.
  const y1 = zone.id === 'bas' ? zone.y1 - SLOT_SIZE : zone.y1;
  const xSpacing = cols > 1 ? (zone.x1 - zone.x0) / (cols - 1) : 0;
  const ySpacing = rows > 1 ? (y1 - zone.y0) / (rows - 1) : 0;
  minSpacingSeen = Math.min(minSpacingSeen, Math.abs(xSpacing) || Infinity, Math.abs(ySpacing) || Infinity);

  for (let r = 0; r < rows; r++) {
    const y = zone.y0 + r * ySpacing;
    const rowSlots: Array<[number, number]> = [];
    for (let c = 0; c < cols; c++) {
      const x = zone.x0 + c * xSpacing;
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
console.log(`espacement le plus serre observe : ${minSpacingSeen.toFixed(0)} unites (plancher SLOT_SIZE=${SLOT_SIZE}).`);
console.log(`rejetes : ${rejectedOutOfZone} hors zone constructible, ${rejectedOverlap} trop proches d'un autre emplacement.`);
if (total !== expected) {
  console.warn('ATTENTION : le total ne correspond pas au calcul attendu — verifier zoneFootprints.ts ou les dimensions.');
}
if (minSpacingSeen < SLOT_SIZE) {
  console.warn(`ATTENTION : espacement (${minSpacingSeen.toFixed(0)}) sous SLOT_SIZE — reduire cols/rows ou agrandir la zone.`);
}
console.log(`ecrit : ${path.relative(process.cwd(), outFile)}`);
