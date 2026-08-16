// Genere build_slots.json : les emplacements longent le chemin, des deux
// cotes de chacun de ses 3 segments (bras gauche, bras droit, connecteur) —
// deux bandes de 2 colonnes/rangees chacune (interieur et exterieur du U),
// collees les unes aux autres (espacement exact SLOT_SIZE). Vu de dessus,
// ca dessine deux U concentriques de tours autour du couloir ; l'interieur
// du U reste creux. Retour direct : une version precedente regroupait les
// tours en 4 blocs rectangulaires poses loin du couloir, avec de grands
// vides entre le chemin et les tours — voir packages/data/src/zoneFootprints.ts.
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
import { lanes, laneBandSlots, PATH_CLEARANCE } from '../src/index.js';

/** Emprise minimale entre deux tours (packages/sim/src/sim.ts) : aussi
 * l'espacement cible ici, les tours se touchent. */
const SLOT_SIZE = 64;

const lane = lanes.find((l) => l.player === 0);
if (!lane) throw new Error('lane 0 introuvable');

const bz = lane.buildZone;
const path2: Array<[number, number]> = [lane.spawn, ...lane.waypoints];

function inBuildZone(x: number, y: number): boolean {
  return x >= bz.left && x <= bz.right && y >= bz.bottom && y <= bz.top;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** laneBandSlots() positionne les bandes a PATH_CLEARANCE de la ligne
 * IDEALISEE (laneAnchors, qui moyenne les coordonnees brutes). Le couloir
 * REEL a un leger biais diagonal (les waypoints ne sont pas parfaitement
 * axes — voir laneGeometry.ts), donc un point a exactement PATH_CLEARANCE de
 * la ligne idealisee peut se retrouver plus proche du vrai trace. On
 * verifie donc aussi contre le polyligne reel plutot que de se fier
 * uniquement a la geometrie des bandes. */
function distanceToPath(x: number, y: number): number {
  let minDist = Infinity;
  for (let i = 0; i < path2.length - 1; i++) {
    const [ax, ay] = path2[i]!;
    const [bx, by] = path2[i + 1]!;
    minDist = Math.min(minDist, distanceToSegment(x, y, ax, ay, bx, by));
  }
  return minDist;
}

interface Group {
  id: string;
  label: string;
  slots: Array<[number, number]>;
}

const groups: Group[] = [];
let rejectedOutOfZone = 0;
let rejectedTooCloseToPath = 0;
let rejectedOverlap = 0;
const placed: Array<[number, number]> = [];

for (const band of laneBandSlots(lane)) {
  const bandSlots: Array<[number, number]> = [];
  for (const [x, y] of band.points) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (!inBuildZone(rx, ry)) {
      rejectedOutOfZone++;
      continue;
    }
    if (distanceToPath(rx, ry) < PATH_CLEARANCE) {
      rejectedTooCloseToPath++;
      continue;
    }
    const tooClose = placed.some(([px, py]) => Math.hypot(px - rx, py - ry) < SLOT_SIZE);
    if (tooClose) {
      rejectedOverlap++;
      continue;
    }
    placed.push([rx, ry]);
    bandSlots.push([rx, ry]);
  }
  if (bandSlots.length > 0) {
    groups.push({ id: band.groupId, label: band.label, slots: bandSlots });
  }
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

console.log(`${total} emplacements generes dans ${groups.length} rangees/colonnes.`);
console.log(
  `rejetes : ${rejectedOutOfZone} hors zone constructible, ${rejectedTooCloseToPath} trop proches du vrai chemin, ${rejectedOverlap} trop proches d'un autre emplacement.`,
);
for (const g of groups) {
  console.log(`  ${g.id}: ${g.slots.length}`);
}
console.log(`ecrit : ${path.relative(process.cwd(), outFile)}`);
