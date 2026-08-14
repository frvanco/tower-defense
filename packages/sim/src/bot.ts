import { lanes, towers, creeps, buildableTowers } from '@tower-defense/data';
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

/**
 * Bot heuristique. Il n'a AUCUN acces privilegie a l'etat : il lit la vue
 * publique et emet des Command, exactement comme le fera un client humain
 * via WebSocket. C'est ce qui en fait un test du protocole autant que du jeu.
 */
export class Bot {
  private rng: number;
  private slots: Array<[number, number]> | null = null;
  private slotIndex = 0;

  constructor(private cfg: BotConfig) {
    this.rng = cfg.seed | 0;
  }

  private rand(): number {
    const r = nextRandom(this.rng);
    this.rng = r.state;
    return r.value;
  }

  /**
   * Emplacements de tours precalcules le long du couloir.
   * Le chemin est fixe et sans maze, donc un placement statique le long des
   * segments est deja quasi optimal : pas besoin de pathfinding ni d'IA.
   */
  private buildSlots(): Array<[number, number]> {
    const lane = lanes[this.cfg.player]!;
    const path: Array<[number, number]> = [lane.spawn, ...lane.waypoints];
    const out: Array<[number, number]> = [];
    const OFFSET = 200;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      const nx = -dy / len;
      const ny = dx / len;
      const steps = Math.max(1, Math.floor(len / 180));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const px = a[0] + dx * t;
        const py = a[1] + dy * t;
        for (const side of [1, -1]) {
          const x = px + nx * OFFSET * side;
          const y = py + ny * OFFSET * side;
          const z = lane.buildZone;
          if (x >= z.left && x <= z.right && y >= z.bottom && y <= z.top) out.push([x, y]);
        }
      }
    }
    return out;
  }

  decide(s: GameState): Command[] {
    const arena = s.arenas[this.cfg.player];
    if (!arena || !arena.alive) return [];
    if (!this.slots) this.slots = this.buildSlots();

    // Une decision par seconde : evite de spammer 20 commandes/sec pour rien.
    if (s.tick % TICK_RATE !== 0) return [];

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

    const root = towers.get(this.cfg.preferredRoot) ?? towers.get(buildableTowers[0]!)!;
    // Garde-fou : une tour a cout nul ferait boucler le bot a l infini.
    const rootCost = Math.max(1, root.goldCost);
    while (towerBudget >= rootCost && this.slotIndex < this.slots.length) {
      const slot = this.slots[this.slotIndex++]!;
      cmds.push({ type: 'buildTower', player: this.cfg.player, defId: root.id, x: slot[0], y: slot[1] });
      towerBudget -= rootCost;
    }

    return cmds;
  }
}
