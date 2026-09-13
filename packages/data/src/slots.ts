import raw from './map_data.json' with { type: 'json' };
import slotLayout from './build_slots.json' with { type: 'json' };

export interface Slot {
  /** Stable ("bas-gauche-r1-3") : cle de reseau et d'occupation, lisible et
   * stable si le layout change d'ordre — contrairement a un index numerique. */
  id: string;
  groupId: string;
  x: number;
  y: number;
}

interface SlotGroupLayout {
  id: string;
  label: string;
  slots: Array<[number, number]>;
}

interface SlotFileLayout {
  note: string;
  slotSize: number;
  groups: SlotGroupLayout[];
}

const layout = slotLayout as SlotFileLayout;

/** Taille d'une case = emprise minimale entre deux tours (packages/sim/src/sim.ts). */
export const SLOT_SIZE = layout.slotSize;

/** Emplacements canoniques, coordonnees de l'arene du joueur 0. */
const canonicalSlots: Slot[] = layout.groups.flatMap((g) =>
  g.slots.map((s, i) => ({ id: `${g.id}-${i + 1}`, groupId: g.id, x: s[0], y: s[1] })),
);

/**
 * Les 8 arenes du jeu original sont des copies congruentes du meme couloir,
 * translatees a des positions differentes sur la carte (verifie : memes
 * dimensions de zone constructible a quelques unites pres). Le layout n'est
 * donc ecrit qu'une fois (pour le joueur 0) et translate par arene, en
 * utilisant le point de spawn de chaque lane comme reference commune stable.
 */
const rawLanes = raw.lanes as Array<Record<string, unknown>>;
function spawnOf(player: number): [number, number] {
  const l = rawLanes.find((x) => x.player === player);
  return (l?.spawn as [number, number]) ?? [0, 0];
}
const spawn0 = spawnOf(0);

const slotsByPlayer = new Map<number, Slot[]>();

function slotsFor(player: number): Slot[] {
  const cached = slotsByPlayer.get(player);
  if (cached) return cached;
  const spawn = spawnOf(player);
  const dx = spawn[0] - spawn0[0];
  const dy = spawn[1] - spawn0[1];
  const translated = canonicalSlots.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
  slotsByPlayer.set(player, translated);
  return translated;
}

/** Emplacements de construction d'une arene, coordonnees monde deja translatees. */
export function buildSlots(player: number): Slot[] {
  return slotsFor(player);
}

/** L'emplacement le plus proche de (x, y), ou null au-dela de SLOT_SIZE de distance. */
export function nearestSlot(player: number, x: number, y: number): Slot | null {
  let best: Slot | null = null;
  let bestDist2 = Infinity;
  for (const s of slotsFor(player)) {
    const dx = s.x - x;
    const dy = s.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      best = s;
    }
  }
  return best && bestDist2 <= SLOT_SIZE * SLOT_SIZE ? best : null;
}

export interface SlotZoneBounds {
  /** "milieu" / "gauche" / "droite" / "bas" — prefixe des ids de rangee. */
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Boite englobante des emplacements de chaque zone (regroupes par le
 * prefixe de groupId avant "-rN") — sert au rendu pour poser un plateau
 * surelevé qui couvre reellement les emplacements, sans dupliquer la
 * geometrie de gen_slots.ts. */
export function buildZones(player: number): SlotZoneBounds[] {
  const byZone = new Map<string, SlotZoneBounds>();
  for (const s of slotsFor(player)) {
    const zoneId = s.groupId.split('-r')[0]!;
    let z = byZone.get(zoneId);
    if (!z) {
      z = { id: zoneId, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      byZone.set(zoneId, z);
    }
    z.minX = Math.min(z.minX, s.x);
    z.maxX = Math.max(z.maxX, s.x);
    z.minY = Math.min(z.minY, s.y);
    z.maxY = Math.max(z.maxY, s.y);
  }
  return [...byZone.values()];
}
