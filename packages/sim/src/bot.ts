import { towers, creeps, shops, buildSlots, lanes, type Slot, type Lane } from '@tower-defense/data';
import { nextRandom } from './rng.js';
import { TICK_RATE, type Command, type GameState, type Tower } from './types.js';
import type { TowerDef } from '@tower-defense/data';

export type Difficulty = 'easy' | 'medium' | 'hard';

/** defId de creep -> index de palier de boutique (meme derivation que
 * creepShopTier dans sim.ts, dupliquee ici plutot que partagee : bot.ts ne
 * depend aujourd'hui d'aucun module interne de sim.ts autre que types.ts, et
 * cette table est triviale a reconstruire — pas assez de valeur a une
 * extraction partagee pour ce lot). Sert a ce que le bot ne gaspille jamais
 * un cycle de decision a tenter d'envoyer un creep d'un palier qu'il n'a pas
 * encore debloque (sim.ts le rejetterait de toute facon, mais silencieusement
 * et sans que le bot n'essaie autre chose ce cycle-la). */
const creepShopTierForBot = new Map<string, number>();
shops.forEach((shop, tier) => {
  for (const id of shop.sells) {
    if (!creepShopTierForBot.has(id)) creepShopTierForBot.set(id, tier);
  }
});

/** Marge au-dela du cout d'un palier de boutique avant qu'un bot ne
 * l'achete : evite qu'il se retrouve totalement a sec juste apres avoir paye
 * 10 000 ou 100 000 or d'un coup, et ne puisse plus rien construire ni
 * envoyer le temps de reconstituer une reserve. ~20% au-dessus du cout est
 * le point de depart indique par le brief de ce lot — pas mesure/ajuste
 * au-dela. */
const SHOP_UNLOCK_RESERVE_FACTOR = 1.2;

/** Role d'une branche dans la composition d'un bot. `control` = ralentissement
 * (Ice/Poison), `antiair` = la branche dediee a l'aerien (Lightning),
 * `damage` = tout le reste (Cannon, Nuclear, mitrailleuse). */
type Category = 'damage' | 'control' | 'antiair';

/** Racine (id de tour) -> role de branche. Nuclear (h008) est classee
 * `damage` comme Cannon/mitrailleuse mais son cout de palier 1 (50000 or,
 * contre 10-60 pour toutes les autres racines) la rend quasiment
 * inatteignable en partie reelle — c'est une donnee source, pas une
 * surcharge de ce lot, donc non corrigee ici, mais elle explique
 * vraisemblablement une partie des parties sans vainqueur de la baseline :
 * un bot dont l'ancienne preferredRoot tombait sur h008 ne construisait
 * quasiment rien de toute la partie. Le nouveau modele la place en dernier
 * choix dans la categorie `damage` (jamais bloquante), donc ce risque
 * disparait de fait sans qu'il ait fallu toucher a son cout. */
const BRANCH_CATEGORY: Record<string, Category> = {
  h000: 'damage', // Cannon
  o008: 'damage', // Mitrailleuse
  h008: 'damage', // Nuclear (cf. note ci-dessus)
  o003: 'control', // Ice
  o001: 'control', // Poison
  h005: 'antiair', // Lightning
};

/** Racine de branche de n'importe quel id de tour (o007 -> o003, h010 ->
 * h000, ...), construite une fois en parcourant `upgradesTo` depuis chaque
 * racine de `BRANCH_CATEGORY`. Exportee pour que les stats externes (voir
 * apps/headless) puissent mesurer la branche REELLEMENT construite par un
 * bot plutot qu'une preference declaree — plus fiable maintenant qu'un bot
 * n'a plus une branche racine unique. */
const TOWER_TO_ROOT = new Map<string, string>();
for (const root of Object.keys(BRANCH_CATEGORY)) {
  let id: string | undefined = root;
  while (id) {
    TOWER_TO_ROOT.set(id, root);
    id = towers.get(id)?.upgradesTo[0];
  }
}
export function branchRootOf(defId: string): string | null {
  return TOWER_TO_ROOT.get(defId) ?? null;
}

function categoryOf(defId: string): Category {
  const root = TOWER_TO_ROOT.get(defId);
  return (root && BRANCH_CATEGORY[root]) || 'damage';
}

/** Archetype de composition CIBLE, tire par bot — remplace l'ancienne
 * branche racine unique (`preferredRoot`). Personnalite, independante du
 * niveau de difficulte : aucun archetype n'est plus fort qu'un autre, ils
 * different juste dans la repartition du budget tours. */
export type Personality = 'damage' | 'control' | 'balanced';
const PERSONALITIES: Personality[] = ['damage', 'control', 'balanced'];

/** Planchers non negociables (part du budget TOURS cumule, toutes
 * difficultes et personnalites confondues) : aucun archetype ne peut
 * descendre en-dessous, meme le plus oriente degats. Valeurs choisies pour
 * garantir une presence reelle (pas un seul exemplaire symbolique) sans
 * etouffer la variation de personnalite au-dessus. */
const MIN_CONTROL_SHARE = 0.2;
const MIN_ANTIAIR_SHARE = 0.1;

const TARGET_SHARES: Record<Personality, Record<Category, number>> = {
  damage: { damage: 0.7, control: MIN_CONTROL_SHARE, antiair: MIN_ANTIAIR_SHARE },
  control: { damage: 0.4, control: 0.45, antiair: 0.15 },
  balanced: { damage: 0.5, control: 0.3, antiair: 0.2 },
};

/** Intervalle de decision par niveau — plus court = plus reactif. Choix
 * heuristiques du bot, pas des valeurs d'equilibrage. */
const DECISION_PERIOD_TICKS: Record<Difficulty, number> = {
  easy: TICK_RATE * 2,
  medium: TICK_RATE,
  hard: Math.round(TICK_RATE * 0.5),
};

/** Part de creeps aeriens dans l'arene au-dela de laquelle un bot medium/hard
 * force temporairement un investissement d'urgence dans la branche anti-air
 * (voir decide()) s'il n'a encore AUCUNE tour capable de cibler l'air.
 *
 * Note : dans les donnees actuelles, Ice et Poison ciblent deja l'air a
 * tous leurs paliers (tout comme Arrow Tower, palier 1 de Cannon) — Lightning
 * n'est pas la SEULE branche qui touche l'aerien, contrairement a la
 * premisse du brief de ce lot. Ce garde-fou d'urgence utilise donc la meme
 * detection generique que sim.ts (`targets.includes('air')`), pas une
 * verification Lightning-only : plus robuste et coherent avec le moteur.
 * Le plancher MIN_ANTIAIR_SHARE, lui, reste specifiquement sur Lightning
 * (voir rootsFor) car c'est la seule branche VOUEE a l'aerien (chaine a
 * rebonds) — signale plutot que suppose, a corriger si Ice/Poison doivent
 * perdre leur ciblage aerien dans un futur lot. */
const AIR_THREAT_SHARE = 0.3;

/** Modulation de `aggression` par phase de partie, reservee au niveau hard :
 * plus de tours en debut de partie (delta negatif), plus d'envois ensuite
 * (delta positif), rampe lineaire sur les 20 premiers rounds puis plafonne. */
function phaseAggressionDelta(round: number): number {
  const t = Math.min(1, round / 20);
  return -0.15 + 0.3 * t;
}

/** Distance d'un point a un segment [a, b] — plus petite distance a la
 * portion de chemin, pas seulement aux waypoints. Fonction pure, sans etat. */
function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export interface BotConfig {
  player: number;
  /** Part de l'or consacree aux envois de creeps ; le reste va aux tours.
   * Parametre de PERSONNALITE, independant du niveau de difficulte — si
   * omis, tire du RNG du bot a la construction. */
  aggression?: number;
  /** Archetype de composition cible (repartition du budget tours entre
   * degats/controle/anti-air). Parametre de PERSONNALITE, independant du
   * niveau de difficulte — si omis, tire du RNG du bot a la construction. */
  personality?: Personality;
  seed: number;
  /** Niveau de COMPETENCE : vitesse de decision, qualite du placement,
   * reaction aux menaces. N'affecte jamais aggression/personality — un bot
   * agressif n'est pas plus fort qu'un bot prudent, juste different. Defaut
   * 'medium'. */
  difficulty?: Difficulty;
}

/**
 * Bot heuristique. Il n'a AUCUN acces privilegie a l'etat : il lit la vue
 * publique et emet des Command, exactement comme le fera un client humain
 * via WebSocket. C'est ce qui en fait un test du protocole autant que du jeu.
 *
 * Composition : chaque bot vise une repartition de son budget tours entre
 * trois roles (degats/controle/anti-air, voir `Category`) plutot que
 * d'empiler une seule branche — voir `TARGET_SHARES`. La repartition REELLE
 * (`spent`) est suivie tour par tour ; a chaque construction, la categorie
 * la plus en retard sur sa cible est financee en priorite (ordonnancement
 * proportionnel-equitable simple), ce qui garantit les planchers
 * (MIN_CONTROL_SHARE, MIN_ANTIAIR_SHARE) sans jamais figer une branche
 * unique pour toute la partie.
 */
export class Bot {
  private rng: number;
  private slots: Slot[] | null = null;

  private readonly difficulty: Difficulty;
  /** Personnalite — toujours tiree du RNG si non fournie, quel que soit le
   * niveau. Publique en lecture seule pour que l'appelant (apps/headless)
   * puisse la lire a posteriori dans ses statistiques. */
  readonly aggression: number;
  readonly personality: Personality;
  private readonly targetShares: Record<Category, number>;
  /** Ordre de preference au sein d'une categorie a plusieurs branches
   * (degats : Cannon ou mitrailleuse ; controle : Ice ou Poison), tire une
   * fois par bot — c'est ce qui fait qu'un bot 'damage' privilegie plutot
   * Cannon et un autre plutot la mitrailleuse. Repli sur l'autre option de
   * la categorie quand la preferee n'est pas encore financable ce cycle
   * (voir le build loop) : sans repli, un bot mitrailleuse (racine a 60 or)
   * laisse sa categorie `damage` bloquee de nombreux cycles de suite pendant
   * qu'il economise, ce qui l'a mesure PIRE pour la dominance de l'Arrow
   * Tower (racine a 10 or, la moins chere du jeu) que le repli — mesure a
   * l'usage plutot que suppose, voir le commit de ce lot. Nuclear (h008, cf.
   * note sur BRANCH_CATEGORY) n'est volontairement pas dans cette liste :
   * son cout de racine le rend hors de portee en pratique. */
  private readonly damagePref: readonly string[];
  private readonly controlPref: readonly string[];

  /** Or cumule investi par categorie (constructions + ameliorations),
   * persiste sur toute la partie — c'est ce qui permet de comparer la
   * repartition REELLE a la cible d'un cycle de decision a l'autre. */
  private readonly spent: Record<Category, number> = { damage: 0, control: 0, antiair: 0 };

  /** Decalage de phase propre a ce bot (tire une fois, a la construction) :
   * evite que tous les bots decident au meme tick et envoient leurs creeps en
   * salve synchronisee (ce qu'on n'observerait jamais face a des humains). */
  private readonly phase: number;
  /** Prochain tick auquel ce bot doit decider. Un compteur d'etat plutot
   * qu'un simple `(tick + phase) % period` : la periode elle-meme varie
   * legerement d'une decision a l'autre (jitter, ci-dessous), et un modulo a
   * periode fixe ne recale pas correctement quand la periode change — le
   * compteur, lui, avance toujours depuis la derniere decision reelle. */
  private nextDecisionTick: number;

  /** Dernier `s.round` observe — sert a detecter la RECEPTION d'income (le
   * round vient d'avancer, voir tick() dans sim.ts qui credite l'income au
   * meme moment) independamment du rythme de decision normal
   * (nextDecisionTick), qui peut etre bien plus lent. Initialise a 0 pour
   * matcher le round initial de createGame() : aucun income n'a encore ete
   * verse a ce moment, donc pas de tentative d'achat prematuree. */
  private lastSeenRound = 0;

  constructor(private cfg: BotConfig) {
    this.rng = cfg.seed | 0;
    this.difficulty = cfg.difficulty ?? 'medium';
    // Plage relevee de [0.2, 0.8] a [0.35, 0.85] (voir le commit de ce lot) :
    // maintenant que le budget tours n'est presque plus jamais gaspille (la
    // passe d'amelioration ci-dessous l'absorbe systematiquement), l'ancien
    // mecanisme implicite qui laissait l'or de defense inutilise "fuiter"
    // vers les envois de creeps au cycle suivant a disparu. Sans ce relevement,
    // l'offense de TOUS les bots baisse simultanement alors que leur defense
    // devient bien plus efficace, et plus personne ne parvient a eliminer
    // personne (mesure : parties sans vainqueur passees de ~30% a 87% sur 200
    // parties avec l'ancienne plage). Ce relevement recupere une bonne partie
    // de l'ecart sans l'effacer completement — voir le rapport de ce lot.
    this.aggression = cfg.aggression ?? 0.35 + this.rand() * 0.5;
    this.personality = cfg.personality ?? PERSONALITIES[Math.floor(this.rand() * PERSONALITIES.length)]!;
    this.targetShares = TARGET_SHARES[this.personality];
    this.damagePref = this.rand() < 0.5 ? ['h000', 'o008'] : ['o008', 'h000'];
    this.controlPref = this.rand() < 0.5 ? ['o003', 'o001'] : ['o001', 'o003'];
    this.phase = Math.floor(this.rand() * TICK_RATE);
    this.nextDecisionTick = this.phase;
  }

  private rand(): number {
    const r = nextRandom(this.rng);
    this.rng = r.state;
    return r.value;
  }

  private rootsFor(cat: Category): readonly string[] {
    if (cat === 'damage') return this.damagePref;
    if (cat === 'control') return this.controlPref;
    return ['h005'];
  }

  /** Trie les emplacements par distance croissante au chemin (les plus utiles
   * — portee vraiment exploitee — en premier). Egalites departagees par un
   * tirage du RNG du bot, pour que deux bots ne remplissent pas dans le meme
   * ordre. Calcule une seule fois, au premier decide(). */
  private rankSlotsByPath(slots: Slot[], lane: Lane): Slot[] {
    const points: Array<[number, number]> = [lane.spawn, ...lane.waypoints];
    const scored = slots.map((slot) => {
      let dist = Infinity;
      for (let i = 0; i < points.length - 1; i++) {
        const [ax, ay] = points[i]!;
        const [bx, by] = points[i + 1]!;
        const d = pointToSegmentDistance(slot.x, slot.y, ax, ay, bx, by);
        if (d < dist) dist = d;
      }
      return { slot, dist, tiebreak: this.rand() };
    });
    scored.sort((a, b) => a.dist - b.dist || a.tiebreak - b.tiebreak);
    return scored.map((x) => x.slot);
  }

  decide(s: GameState): Command[] {
    const arena = s.arenas[this.cfg.player];
    if (!arena || !arena.alive) return [];
    if (!this.slots) {
      const raw = buildSlots(this.cfg.player);
      // easy : ordre brut de buildSlots (comportement d'origine). medium/hard
      // : trie par utilite reelle (distance au chemin).
      if (this.difficulty === 'easy') {
        this.slots = raw;
      } else {
        const lane = lanes.find((l) => l.player === this.cfg.player);
        this.slots = lane ? this.rankSlotsByPath(raw, lane) : raw;
      }
    }

    // Achat de palier de boutique — verifie a CHAQUE appel de decide() (donc
    // a chaque tick), independamment de nextDecisionTick ci-dessous : "au
    // moment de recevoir l'income, pas a chaque tick" (brief de ce lot) se
    // traduit par "des que s.round vient de changer" (tick() credite
    // l'income exactement a ce moment-la, voir sim.ts), jamais par le rythme
    // de decision normal du bot, qui peut etre plus lent que le versement
    // d'income lui-meme. Deterministe par construction (comparaison de seuil
    // pure, aucun rand() necessaire ni utilise).
    const cmds: Command[] = [];
    if (s.round !== this.lastSeenRound) {
      this.lastSeenRound = s.round;
      const nextTier = arena.unlockedShopTier + 1;
      const nextShop = shops[nextTier];
      if (nextShop && arena.gold >= nextShop.goldCost * SHOP_UNLOCK_RESERVE_FACTOR) {
        cmds.push({ type: 'unlockShop', player: this.cfg.player });
      }
    }

    if (s.tick < this.nextDecisionTick) return cmds;
    // +-20% de gigue par decision : evite un rythme parfaitement mecanique
    // tout en restant seede/deterministe (RNG interne du bot uniquement).
    const jitter = 0.8 + this.rand() * 0.4;
    this.nextDecisionTick = s.tick + Math.max(1, Math.round(DECISION_PERIOD_TICKS[this.difficulty] * jitter));

    const effectiveAggression =
      this.difficulty === 'hard'
        ? Math.min(0.95, Math.max(0.05, this.aggression + phaseAggressionDelta(s.round)))
        : this.aggression;
    const creepBudget = arena.gold * effectiveAggression;
    let towerBudget = arena.gold - creepBudget;

    // 1. Envoyer le creep le plus cher qu'on peut se payer et qui est en stock.
    let spend = creepBudget;
    const affordable = [...creeps.values()]
      .filter((c) => {
        // Sans ce filtre, un bot viserait parfois un creep de palier
        // superieur (plus cher, donc trie en tete par la suite) que sim.ts
        // rejetterait silencieusement ('shop not unlocked') — le cycle de
        // decision serait gaspille au lieu de retomber sur un creep
        // reellement envoyable ce tour-ci.
        const tier = creepShopTierForBot.get(c.id) ?? 0;
        if (tier > arena.unlockedShopTier) return false;
        const st = arena.stock[c.id];
        return st && st.count > 0 && s.tick >= st.availableAt && c.goldCost <= spend;
      })
      .sort((a, b) => b.goldCost - a.goldCost);
    const pick = affordable[0];
    if (pick) {
      cmds.push({ type: 'sendCreep', player: this.cfg.player, defId: pick.id });
      spend -= pick.goldCost;
    }

    // 2. Ameliorer TOUT ce qui est finançable avant de poser une seule tour
    // neuve. L'ancienne version ne tentait qu'UNE amelioration par cycle de
    // decision alors qu'elle pouvait poser plusieurs tours neuves dans le
    // meme cycle — elle favorisait donc systematiquement la largeur (plus de
    // tours de base) sur la profondeur (des tours amelioree). C'etait le
    // defaut le plus coûteux du bot precedent (brief de ce lot) : une seule
    // branche jamais amelioree domine juste parce que c'est tout ce qui se
    // construit. Niveau easy : ignore la PASSE entiere d'amelioration une
    // fois sur deux (tire du RNG du bot, meme frequence qu'avant), le reste
    // du comportement est identique aux autres niveaux.
    const skipUpgrades = this.difficulty === 'easy' && this.rand() < 0.5;
    if (!skipUpgrades) {
      const touchedThisCycle = new Set<number>();
      for (;;) {
        const candidates = arena.towers
          .filter((t) => !touchedThisCycle.has(t.eid))
          .map((t) => ({ t, def: towers.get(t.defId)! }))
          .filter((x) => x.def.upgradesTo.length > 0)
          .map((x) => ({ ...x, next: towers.get(x.def.upgradesTo[0]!)! }))
          .filter((x) => x.next && x.next.goldCost <= towerBudget);
        if (candidates.length === 0) break;
        // le moins cher d'abord : maximise le nombre d'ameliorations
        // financees par ce cycle plutot que d'en griller tout le budget sur
        // une seule tour.
        candidates.sort((a, b) => a.next.goldCost - b.next.goldCost);
        const up = candidates[0]!;
        cmds.push({ type: 'upgradeTower', player: this.cfg.player, eid: up.t.eid, defId: up.next.id });
        towerBudget -= up.next.goldCost;
        touchedThisCycle.add(up.t.eid);
        this.spent[categoryOf(up.next.id)] += up.next.goldCost;
      }
    }

    // 3. Construire des tours neuves avec ce qu'il reste, en priorisant la
    // categorie (degats/controle/anti-air) la plus en retard sur sa cible de
    // composition — ordonnancement proportionnel-equitable simple, qui
    // garantit les planchers (MIN_CONTROL_SHARE, MIN_ANTIAIR_SHARE) sans
    // figer une branche unique pour toute la partie.
    //
    // Urgence anti-air (medium/hard uniquement, inchangee dans l'esprit de
    // l'ancien code) : si une part significative des creeps de l'arene est
    // aerienne et qu'aucune tour actuelle ne peut la cibler, la toute
    // premiere construction de ce cycle est forcee sur la categorie
    // anti-air (Lightning), peu importe son retard relatif — le temps que
    // l'ordonnancement normal reprenne la main.
    let forcedCat: Category | null = null;
    if (this.difficulty !== 'easy') {
      const airCreepCount = arena.creeps.filter((c) => creeps.get(c.defId)?.isAir).length;
      const airShare = arena.creeps.length > 0 ? airCreepCount / arena.creeps.length : 0;
      const hasAntiAir = arena.towers.some((t) => towers.get(t.defId)?.targets.includes('air'));
      if (airShare > AIR_THREAT_SHARE && !hasAntiAir) forcedCat = 'antiair';
    }

    const claimed = new Set<string>();
    const blocked = new Set<Category>();
    const hasFreeSlot = () => this.slots!.some((sl) => !arena.occupied[sl.id] && !claimed.has(sl.id));
    while (towerBudget > 0 && blocked.size < 3 && hasFreeSlot()) {
      let cat: Category;
      if (forcedCat && !blocked.has(forcedCat)) {
        cat = forcedCat;
      } else {
        const totalSpent = this.spent.damage + this.spent.control + this.spent.antiair;
        let best: Category | null = null;
        let bestDeficit = -Infinity;
        for (const c of ['damage', 'control', 'antiair'] as Category[]) {
          if (blocked.has(c)) continue;
          const actual = totalSpent > 0 ? this.spent[c] / totalSpent : 0;
          const deficit = this.targetShares[c] - actual;
          if (deficit > bestDeficit) {
            bestDeficit = deficit;
            best = c;
          }
        }
        if (!best) break;
        cat = best;
      }
      forcedCat = null;

      let built = false;
      for (const rootId of this.rootsFor(cat)) {
        const rootDef = towers.get(rootId);
        if (!rootDef) continue;
        // Garde-fou : une tour a cout nul ferait boucler le bot a l'infini.
        const cost = Math.max(1, rootDef.goldCost);
        if (cost > towerBudget) continue;
        // `arena.occupied` ne reflete que les commandes deja traitees par
        // tick() — une commande qu'on vient d'emettre dans CETTE meme
        // decide() n'y figure pas encore. `claimed` evite donc de viser deux
        // fois le meme emplacement dans le meme lot de commandes.
        const slot = this.slots!.find((sl) => !arena.occupied[sl.id] && !claimed.has(sl.id));
        if (!slot) break;
        claimed.add(slot.id);
        cmds.push({ type: 'buildTower', player: this.cfg.player, defId: rootDef.id, x: slot.x, y: slot.y });
        towerBudget -= cost;
        this.spent[cat] += cost;
        built = true;
        break;
      }
      if (!built) blocked.add(cat);
    }

    return cmds;
  }
}
