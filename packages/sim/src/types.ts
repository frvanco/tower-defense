/** 20 ticks/seconde. Le temps est toujours un entier de ticks, jamais un delta flottant. */
export const TICK_RATE = 20;
export const secToTicks = (s: number): number => Math.round(s * TICK_RATE);

export interface Tower {
  eid: number;
  defId: string;
  x: number;
  y: number;
  /** Ticks restants avant la prochaine attaque. */
  cooldown: number;
  /** Emplacement occupe (packages/data/src/slots.ts) — cle pour liberer la case a la vente. */
  slotId: string;
}

export interface Creep {
  eid: number;
  defId: string;
  x: number;
  y: number;
  hp: number;
  /** Index du prochain waypoint. */
  wp: number;
  /** Envoye par ce joueur (pour les stats, pas pour la logique). */
  sender: number;
}

export interface StockEntry {
  /** Tick a partir duquel le creep devient achetable. */
  availableAt: number;
  count: number;
  /** Tick du prochain reappro. */
  nextReplenish: number;
}

export interface Arena {
  player: number;
  alive: boolean;
  gold: number;
  income: number;
  lives: number;
  towers: Tower[];
  creeps: Creep[];
  /** Cle = defId du creep. */
  stock: Record<string, StockEntry>;
  /** Cle = Slot.id (packages/data/src/slots.ts). Presence = occupe. */
  occupied: Record<string, true>;
  /** Stats cumulees, utiles pour les runs headless. */
  leaked: number;
  killed: number;
  goldSpentOnTowers: number;
  goldSpentOnCreeps: number;
}

export interface GameState {
  tick: number;
  rng: number;
  nextEid: number;
  round: number;
  /** Tick du prochain versement d'income. */
  nextRoundAt: number;
  arenas: Arena[];
  finished: boolean;
  winner: number | null;
}

export type Command =
  | { type: 'buildTower'; player: number; defId: string; x: number; y: number }
  | { type: 'upgradeTower'; player: number; eid: number; defId: string }
  | { type: 'sellTower'; player: number; eid: number }
  | { type: 'sendCreep'; player: number; defId: string };

export type SimEvent =
  | { type: 'roundStart'; round: number }
  | { type: 'leak'; player: number; livesLeft: number }
  | { type: 'defeat'; player: number }
  | { type: 'creepSent'; player: number; defId: string }
  | { type: 'gameOver'; winner: number | null }
  | { type: 'rejected'; player: number; reason: string };
