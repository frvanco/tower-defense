import { towers, creeps, buildableTowers, buildSlots, lanes, type Slot, type Lane } from '@tower-defense/data';
import { nextRandom } from './rng.js';
import { TICK_RATE, type Command, type GameState, type Tower } from './types.js';
import type { TowerDef } from '@tower-defense/data';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface BotConfig {
  player: number;
  /** Part de l'or consacree aux envois de creeps ; le reste va aux tours.
   * Parametre de PERSONNALITE, independant du niveau de difficulte — si
   * omis, tire du RNG du bot a la construction. */
  aggression?: number;
  /** Branche de tours privilegiee (id de la tour racine). Parametre de
   * PERSONNALITE, independant du niveau de difficulte — si omis, tiree du
   * RNG du bot a la construction. */
  preferredRoot?: string;
  seed: number;
  /** Niveau de COMPETENCE : vitesse de decision, qualite du placement,
   * reaction aux menaces. N'affecte jamais aggression/preferredRoot — un bot
   * agressif n'est pas plus fort qu'un bot prudent, juste different. Defaut
   * 'medium'. */
  difficulty?: Difficulty;
}

/** Intervalle de decision par niveau — plus court = plus reactif. Choix
 * heuristiques du bot, pas des valeurs d'equilibrage. */
const DECISION_PERIOD_TICKS: Record<Difficulty, number> = {
  easy: TICK_RATE * 2,
  medium: TICK_RATE,
  hard: Math.round(TICK_RATE * 0.5),
};

/** Part de creeps aeriens dans l'arene au-dela de laquelle un bot medium/hard
 * reagit s'il n'a aucune tour capable de cibler l'air (voir decide()). */
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

/**
 * Bot heuristique. Il n'a AUCUN acces privilegie a l'etat : il lit la vue
 * publique et emet des Command, exactement comme le fera un client humain
 * via WebSocket. C'est ce qui en fait un test du protocole autant que du jeu.
 */
export class Bot {
  private rng: number;
  private slots: Slot[] | null = null;

  private readonly difficulty: Difficulty;
  /** Personnalite — toujours tiree du RNG si non fournie, quel que soit le
   * niveau : aggression/preferredRoot ne sont jamais un signal de force.
   * Publiques en lecture seule pour que l'appelant (apps/headless) puisse
   * les lire a posteriori dans ses statistiques, puisqu'il ne les calcule
   * plus lui-meme. */
  readonly aggression: number;
  readonly preferredRoot: string;

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

  constructor(private cfg: BotConfig) {
    this.rng = cfg.seed | 0;
    this.difficulty = cfg.difficulty ?? 'medium';
    this.aggression = cfg.aggression ?? 0.2 + this.rand() * 0.6;
    this.preferredRoot = cfg.preferredRoot ?? buildableTowers[Math.floor(this.rand() * buildableTowers.length)]!;
    this.phase = Math.floor(this.rand() * TICK_RATE);
    this.nextDecisionTick = this.phase;
  }

  private rand(): number {
    const r = nextRandom(this.rng);
    this.rng = r.state;
    return r.value;
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

    if (s.tick < this.nextDecisionTick) return [];
    // +-20% de gigue par decision : evite un rythme parfaitement mecanique
    // tout en restant seede/deterministe (RNG interne du bot uniquement).
    const jitter = 0.8 + this.rand() * 0.4;
    this.nextDecisionTick = s.tick + Math.max(1, Math.round(DECISION_PERIOD_TICKS[this.difficulty] * jitter));

    const cmds: Command[] = [];
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
        const st = arena.stock[c.id];
        return st && st.count > 0 && s.tick >= st.availableAt && c.goldCost <= spend;
      })
      .sort((a, b) => b.goldCost - a.goldCost);
    const pick = affordable[0];
    if (pick) {
      cmds.push({ type: 'sendCreep', player: this.cfg.player, defId: pick.id });
      spend -= pick.goldCost;
    }

    // 2. Upgrader une tour existante si c'est finançable, sinon en poser une
    // nouvelle. Niveau easy : ignore l'upgrade une fois sur deux (tire du
    // RNG du bot), le reste du comportement est identique aux autres niveaux.
    let upgradable: Array<{ t: Tower; def: TowerDef; next: TowerDef }> = [];
    const skipUpgrade = this.difficulty === 'easy' && this.rand() < 0.5;
    if (!skipUpgrade) {
      upgradable = arena.towers
        .map((t) => ({ t, def: towers.get(t.defId)! }))
        .filter((x) => x.def.upgradesTo.length > 0)
        .map((x) => ({ ...x, next: towers.get(x.def.upgradesTo[0]!)! }))
        .filter((x) => x.next && x.next.goldCost <= towerBudget)
        .sort((a, b) => b.next.goldCost - a.next.goldCost);
    }

    const up = upgradable[0];
    if (up) {
      cmds.push({ type: 'upgradeTower', player: this.cfg.player, eid: up.t.eid, defId: up.next.id });
      towerBudget -= up.next.goldCost;
    }

    // Reaction a l'aerien (medium/hard uniquement) : si une part significative
    // des creeps presents dans l'arene est aerienne et qu'aucune tour actuelle
    // ne peut la cibler, le bot construit temporairement sur une racine
    // anti-air plutot que sur sa preference habituelle — jusqu'a en posseder
    // une.
    let rootId = this.preferredRoot;
    if (this.difficulty !== 'easy') {
      const airCreepCount = arena.creeps.filter((c) => creeps.get(c.defId)?.isAir).length;
      const airShare = arena.creeps.length > 0 ? airCreepCount / arena.creeps.length : 0;
      const hasAntiAir = arena.towers.some((t) => towers.get(t.defId)?.targets.includes('air'));
      if (airShare > AIR_THREAT_SHARE && !hasAntiAir) {
        const airRoot = buildableTowers.find((id) => towers.get(id)?.targets.includes('air'));
        if (airRoot) rootId = airRoot;
      }
    }
    const root = towers.get(rootId) ?? towers.get(buildableTowers[0]!)!;
    // Garde-fou : une tour a cout nul ferait boucler le bot a l infini.
    const rootCost = Math.max(1, root.goldCost);
    // `arena.occupied` ne reflete que les commandes deja traitees par tick() —
    // une commande qu'on vient d'emettre dans CETTE meme decide() n'y figure
    // pas encore. `claimed` evite donc de viser deux fois le meme emplacement
    // dans le meme lot de commandes.
    const claimed = new Set<string>();
    while (towerBudget >= rootCost) {
      const slot = this.slots.find((sl) => !arena.occupied[sl.id] && !claimed.has(sl.id));
      if (!slot) break; // plus aucun emplacement libre
      claimed.add(slot.id);
      cmds.push({ type: 'buildTower', player: this.cfg.player, defId: root.id, x: slot.x, y: slot.y });
      towerBudget -= rootCost;
    }

    return cmds;
  }
}
