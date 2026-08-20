import { towers, creeps, buildableTowers, buildSlots, lanes, type Slot, type Lane } from '@tower-defense/data';
import { nextRandom } from './rng.js';
import { TICK_RATE, type Command, type GameState } from './types.js';

export interface BotConfig {
  player: number;
  /** Part de l'or consacree aux envois de creeps ; le reste va aux tours. */
  aggression: number;
  /** Branche de tours privilegiee (id de la tour racine). */
  preferredRoot: string;
  seed: number;
}

/** Part de creeps aeriens dans l'arene au-dela de laquelle le bot reagit s'il
 * n'a aucune tour capable de cibler l'air (voir decide()). Choix heuristique
 * du bot, pas une valeur d'equilibrage — n'a rien a faire dans balance.json. */
const AIR_THREAT_SHARE = 0.3;

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
      const lane = lanes.find((l) => l.player === this.cfg.player);
      this.slots = lane ? this.rankSlotsByPath(raw, lane) : raw;
    }

    if (s.tick < this.nextDecisionTick) return [];
    // +-20% de gigue par decision : evite un rythme parfaitement mecanique
    // tout en restant seede/deterministe (RNG interne du bot uniquement).
    const jitter = 0.8 + this.rand() * 0.4;
    this.nextDecisionTick = s.tick + Math.max(1, Math.round(TICK_RATE * jitter));

    const cmds: Command[] = [];
    const creepBudget = arena.gold * this.cfg.aggression;
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

    // 2. Upgrader une tour existante si c'est finançable, sinon en poser une nouvelle.
    const upgradable = arena.towers
      .map((t) => ({ t, def: towers.get(t.defId)! }))
      .filter((x) => x.def.upgradesTo.length > 0)
      .map((x) => ({ ...x, next: towers.get(x.def.upgradesTo[0]!)! }))
      .filter((x) => x.next && x.next.goldCost <= towerBudget)
      .sort((a, b) => b.next.goldCost - a.next.goldCost);

    const up = upgradable[0];
    if (up) {
      cmds.push({ type: 'upgradeTower', player: this.cfg.player, eid: up.t.eid, defId: up.next.id });
      towerBudget -= up.next.goldCost;
    }

    // Reaction a l'aerien : si une part significative des creeps presents
    // dans l'arene est aerienne et qu'aucune tour actuelle ne peut la cibler,
    // le bot construit temporairement sur une racine anti-air plutot que sur
    // sa preference habituelle — jusqu'a en posseder au moins une.
    let rootId = this.cfg.preferredRoot;
    const airCreepCount = arena.creeps.filter((c) => creeps.get(c.defId)?.isAir).length;
    const airShare = arena.creeps.length > 0 ? airCreepCount / arena.creeps.length : 0;
    const hasAntiAir = arena.towers.some((t) => towers.get(t.defId)?.targets.includes('air'));
    if (airShare > AIR_THREAT_SHARE && !hasAntiAir) {
      const airRoot = buildableTowers.find((id) => towers.get(id)?.targets.includes('air'));
      if (airRoot) rootId = airRoot;
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
