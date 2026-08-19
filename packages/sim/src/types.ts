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

/** Ralentissement de la branche Ice — un seul actif a la fois (le plus fort
 * remplace le plus faible, cf. packages/sim/src/status.ts). */
export interface IceDebuff {
  pct: number;
  /** Tick auquel le debuff expire (exclusif). */
  untilTick: number;
}

/** Poison de la branche Poison — degats sur la duree + ralentissement, un
 * seul actif a la fois (le plus fort remplace le plus faible). */
export interface PoisonDebuff {
  pct: number;
  dps: number;
  untilTick: number;
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
  /** Champs plats, serialisables tels quels — pas de logique, juste l'etat. */
  ice?: IceDebuff;
  poison?: PoisonDebuff;
  /** true si engendre par la mort d'un autre creep (ex. Porte-essaim ->
   * Drone d'essaim) : n'a pas de cout en or propre, ne rapporte aucune prime
   * a sa propre mort (packages/sim/src/sim.ts, handleDeaths). */
  freeSpawn?: true;
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
  /** Or cumule recu en primes de mise a mort (packages/sim/src/sim.ts). */
  goldFromBounty: number;
  /** Or cumule recu en income de round — denominateur naturel pour mesurer
   * la part du revenu venant des primes (apps/headless). */
  goldFromIncome: number;
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
  | { type: 'rejected'; player: number; reason: string }
  /** Chaine d'eclair (branche Lightning) : positions des cibles touchees, dans
   * l'ordre reel des rebonds — purement informatif, pour le rendu (l'arc
   * visuel). Pas de logique de jeu ne depend de cet evenement. */
  | { type: 'lightningChain'; player: number; points: Array<[number, number]> };
