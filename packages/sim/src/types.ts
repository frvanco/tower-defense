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

/** Une construction planifiee. L'emplacement est deja resolu et RESERVE
 * (arena.occupied) au moment ou l'ordre entre dans la file : l'or est debite
 * au clic, pas a l'arrivee du builder. */
export interface BuildOrder {
  defId: string;
  /** Slot.id (packages/data/src/slots.ts) — sert a liberer la reservation si
   * l'ordre est annule. */
  slotId: string;
  /** Position de l'emplacement, deja snappee par nearestSlot. */
  x: number;
  y: number;
}

/** `moving` et `flying` sont le MEME deplacement en ligne droite, a deux
 * vitesses : `flying` vaut pendant le survol du couloir des creeps (voir
 * inCorridor dans packages/data). Rien d'autre ne les distingue. */
export type BuilderMode = 'idle' | 'moving' | 'flying' | 'building';

/**
 * L'ouvrier d'un joueur : un par arene, bots compris. Il ne combat pas, n'a
 * pas de points de vie, ne peut pas etre cible ni perturbe — il n'apparait
 * dans aucune boucle de combat. Son seul role est de rendre la construction
 * non instantanee.
 *
 * Vit dans Arena, donc dans GameState : hashState le couvre par sa
 * stringification generique (aucun code dedie), et un client qui observe une
 * autre arene lit cet etat tel quel au lieu de le reconstruire.
 */
export interface Builder {
  x: number;
  y: number;
  /** Cap courant en radians (atan2(dy, dx)), conserve quand il s'arrete :
   * l'orientation du rendu ne doit pas sauter a l'arret. */
  facing: number;
  /** FIFO. queue[0] est la cible courante — jamais reordonnee, donc aucune
   * egalite a departager. */
  queue: BuildOrder[];
  mode: BuilderMode;
  /** Ticks restants de la construction en cours (mode 'building'). */
  buildTicksLeft: number;
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
  /** Cle = Slot.id (packages/data/src/slots.ts). Presence = occupe. Un
   * emplacement est marque des la PLANIFICATION de la construction, pas a
   * l'apparition de la tour : c'est ce qui empeche deux ordres de viser la
   * meme case, joueur comme bot (voir buildTower dans sim.ts). */
  occupied: Record<string, true>;
  /** L'ouvrier de ce joueur (voir Builder ci-dessus). */
  builder: Builder;
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
  /** Index du palier de boutique d'envoi le plus eleve debloque (0 = Caserne
   * seule, deja acquise sans cout — voir createGame). Correspond a un index
   * dans `shops` (@tower-defense/data, ordre garanti par map_data.json :
   * htow=0, hkee=1, hcas=2). Fait partie de l'etat de simulation (entre dans
   * hashState via la stringification generique de GameState, aucun code
   * dedie necessaire) — ne pas confondre avec le palier CONSULTE cote
   * interface (apps/web), qui est un etat d'UI local, jamais stocke ici. */
  unlockedShopTier: number;
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
  | { type: 'sendCreep'; player: number; defId: string }
  /** Debloque le PROCHAIN palier de boutique d'envoi (toujours sequentiel —
   * jamais un palier cible explicite, voir sim.ts#applyCommand). */
  | { type: 'unlockShop'; player: number }
  /** Vide les constructions PLANIFIEES et les rembourse a 100%, en liberant
   * leurs emplacements. La construction en cours (mode 'building') va au
   * bout et n'est pas remboursee. */
  | { type: 'cancelBuildQueue'; player: number }
  /** Debug uniquement (voir apps/web/src/dev.ts, active par ?dev=1, absent du
   * bundle de prod) — jamais construite ailleurs dans le jeu. Fixe l'or a une
   * valeur absolue. */
  | { type: 'debugSetGold'; player: number; amount: number }
  /** Debug uniquement — fixe les vies a une valeur absolue et ressuscite
   * l'arene (alive=true) si amount > 0 : seule exception a la regle "la mort
   * est definitive" du jeu normal, assumee pour cet outil de test local (voir
   * sim.ts#applyCommand, traitee avant la garde arena.alive). */
  | { type: 'debugSetLives'; player: number; amount: number }
  /** Debug uniquement — leve la limite d'achat (stock + delai de reappro) de
   * tous les creeps vendables de cette arene, pour tester l'envoi en rafale
   * sans attendre. */
  | { type: 'debugMaxStock'; player: number };

export type SimEvent =
  | { type: 'roundStart'; round: number }
  | { type: 'leak'; player: number; livesLeft: number }
  | { type: 'defeat'; player: number }
  | { type: 'creepSent'; player: number; defId: string }
  | { type: 'gameOver'; winner: number | null }
  | { type: 'rejected'; player: number; reason: string }
  /** Palier de boutique d'envoi debloque avec succes — `tier` est le nouvel
   * index de `arena.unlockedShopTier` (voir types.ts). */
  | { type: 'shopUnlocked'; player: number; tier: number }
  /** Chaine d'eclair (branche Lightning) : positions des cibles touchees, dans
   * l'ordre reel des rebonds — purement informatif, pour le rendu (l'arc
   * visuel). Pas de logique de jeu ne depend de cet evenement. */
  | { type: 'lightningChain'; player: number; points: Array<[number, number]> };
