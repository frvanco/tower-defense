import raw from './map_data.json' with { type: 'json' };
import balance from './balance.json' with { type: 'json' };

export type ArmorType = 'small' | 'medium' | 'large' | 'fort' | 'normal' | 'hero' | 'divine' | 'none';
export type AttackType = 'normal' | 'pierce' | 'siege' | 'magic' | 'chaos' | 'hero' | 'spells';
export type TargetFlag = 'air' | 'ground';

export interface TowerDef {
  id: string;
  name: string;
  goldCost: number;
  /** Remboursement a la vente. Valeur litterale de l'original (parfois > goldCost). */
  refund: number;
  damageBase: number;
  dice: number;
  sides: number;
  /** Secondes entre deux attaques. */
  cooldown: number;
  range: number;
  acquisitionRange: number;
  attackType: AttackType;
  targets: TargetFlag[];
  /** Rayons de degats de zone. 0 = mono-cible. */
  aoeFull: number;
  aoeMedium: number;
  aoeSmall: number;
  upgradesTo: string[];
  requires: string[];
  abilities: string[];
}

export interface CreepDef {
  id: string;
  name: string;
  goldCost: number;
  /** Income gagne par l'envoyeur. */
  pointValue: number;
  hitPoints: number;
  armor: number;
  armorType: ArmorType;
  moveSpeed: number;
  isAir: boolean;
  /** Secondes avant que le creep devienne achetable. */
  stockStartDelay: number;
  stockReplenishInterval: number;
  stockMaximum: number;
  /** Creeps spawnes a la mort (Goblin Zeppelin). */
  spawnsOnDeath: { id: string; count: number } | null;
}

export interface Lane {
  player: number;
  color: string;
  spawn: [number, number];
  waypoints: Array<[number, number]>;
  buildZone: { left: number; bottom: number; right: number; top: number };
}

export interface Rules {
  startLives: number;
  startIncome: number;
  roundIntervalSec: number;
  firstRoundDelaySec: number;
  maxPlayers: number;
}

/**
 * Valeurs heritees des unites de base du jeu d'origine. La map ne les redefinit
 * pas, donc elles ne sont PAS extraites des donnees sources : ce sont des valeurs
 * a verifier contre les data du jeu. `defaultsUsed` liste ce qui est retombe dessus.
 */
const BASE_DEFAULTS: Record<string, Partial<TowerDef & CreepDef>> = {
  hgtw: { range: 700, acquisitionRange: 800, attackType: 'pierce' },
  hctw: { range: 800, acquisitionRange: 900, attackType: 'siege' },
  owtw: { range: 600, acquisitionRange: 700, attackType: 'pierce' },
  hhdl: { moveSpeed: 270, armorType: 'medium', hitPoints: 500 },
  ugar: { moveSpeed: 270, armorType: 'medium', hitPoints: 500 },
  nvil: { moveSpeed: 270, armorType: 'medium', hitPoints: 500 },
};

export const defaultsUsed: Array<{ id: string; field: string }> = [];

function pick<T>(id: string, base: string, field: string, value: T | undefined, fallbackKey: string): T {
  if (value !== undefined && value !== null && value !== '') return value;
  const d = BASE_DEFAULTS[base]?.[fallbackKey as keyof typeof BASE_DEFAULTS[string]];
  defaultsUsed.push({ id, field });
  return d as T;
}

function splitList(s: unknown): string[] {
  if (typeof s !== 'string' || s === '') return [];
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

const rawTowers = raw.towers as Array<Record<string, unknown>>;
const rawCreeps = raw.creeps as Array<Record<string, unknown>>;

function buildTower(t: Record<string, unknown>): TowerDef {
  const id = t.id as string;
  const base = t.baseId as string;
  const targets = splitList(t.atk1Targets).filter((x): x is TargetFlag => x === 'air' || x === 'ground');
  return {
    id,
    name: (t.name as string) ?? id,
    goldCost: (t.goldCost as number) ?? 0,
    refund: (t.pointValue as number) ?? 0,
    damageBase: (t.atk1DamageBase as number) ?? 0,
    dice: (t.atk1Dice as number) ?? 0,
    sides: (t.atk1Sides as number) ?? 0,
    cooldown: (t.atk1Cooldown as number) ?? 1,
    range: pick(id, base, 'range', t.atk1Range as number, 'range'),
    acquisitionRange: (t.acquisitionRange as number) ?? pick(id, base, 'acquisitionRange', undefined, 'acquisitionRange'),
    attackType: pick(id, base, 'attackType', t.atk1AttackType as AttackType, 'attackType'),
    targets: targets.length ? targets : ['ground'],
    aoeFull: (t.atk1AoeFull as number) ?? 0,
    aoeMedium: (t.atk1AoeMedium as number) ?? 0,
    aoeSmall: (t.atk1AoeSmall as number) ?? 0,
    upgradesTo: splitList(t.upgradesTo).filter((x) => !x.startsWith('n')),
    requires: splitList(t.requires),
    abilities: splitList(t.abilities),
  };
}

function buildCreep(c: Record<string, unknown>): CreepDef {
  const id = c.id as string;
  const base = c.baseId as string;
  return {
    id,
    name: (c.name as string) ?? id,
    goldCost: (c.goldCost as number) ?? 0,
    pointValue: (c.pointValue as number) ?? 0,
    hitPoints: pick(id, base, 'hitPoints', c.hitPoints as number, 'hitPoints'),
    armor: (c.armor as number) ?? 0,
    armorType: pick(id, base, 'armorType', c.armorType as ArmorType, 'armorType'),
    moveSpeed: pick(id, base, 'moveSpeed', c.moveSpeed as number, 'moveSpeed'),
    isAir: (c.moveType as string) === 'fly',
    stockStartDelay: (c.stockStartDelaySec as number) ?? 0,
    stockReplenishInterval: (c.stockReplenishIntervalSec as number) ?? 8,
    stockMaximum: Math.max(1, Math.round((c.stockMaximum as number) ?? 1)),
    spawnsOnDeath: id === 'u00B' ? { id: 'h00Y', count: 4 } : null,
  };
}

function applyOverrides<T extends object>(defs: Map<string, T>, over: Record<string, Partial<T>>) {
  for (const [id, patch] of Object.entries(over)) {
    const d = defs.get(id);
    if (d) Object.assign(d, patch);
  }
}

export const towers = new Map<string, TowerDef>(rawTowers.map((t) => [t.id as string, buildTower(t)]));
export const creeps = new Map<string, CreepDef>(rawCreeps.map((c) => [c.id as string, buildCreep(c)]));

applyOverrides(towers, (balance.towers ?? {}) as Record<string, Partial<TowerDef>>);
applyOverrides(creeps, (balance.creeps ?? {}) as Record<string, Partial<CreepDef>>);

/** Creeps achetables, par shop. Le stock les debloque progressivement. */
export const shops = (raw.shops as Array<Record<string, unknown>>).map((s) => ({
  id: s.id as string,
  name: s.name as string,
  goldCost: (s.goldCost as number) ?? 0,
  sells: (s.sells as Array<{ id: string }>).map((x) => x.id),
}));

export const lanes: Lane[] = (raw.lanes as Array<Record<string, unknown>>).map((l) => ({
  player: l.player as number,
  color: l.color as string,
  spawn: l.spawn as [number, number],
  waypoints: [l.waypoint1, l.waypoint2, l.end] as Array<[number, number]>,
  buildZone: l.buildZone as Lane['buildZone'],
}));

const rawRules = raw.rules as Record<string, unknown>;
export const rules: Rules = {
  startLives: (rawRules.startLives as number) ?? 30,
  startIncome: (rawRules.startIncome as number) ?? 40,
  roundIntervalSec: (rawRules.roundIntervalSec as number) ?? 30,
  firstRoundDelaySec: (rawRules.firstRoundDelaySec as number) ?? 2,
  maxPlayers: (raw.map as Record<string, unknown>).maxPlayers as number ?? 8,
  ...((balance.rules ?? {}) as Partial<Rules>),
};

/** Tours constructibles directement par le Peasant (racines des 6 branches). */
export const buildableTowers = ['h000', 'o001', 'o003', 'h005', 'h008', 'o008'];

export { type Slot, SLOT_SIZE, buildSlots, nearestSlot } from './slots.js';
