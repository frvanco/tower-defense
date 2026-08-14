import { lanes, rules, towers, creeps, shops, buildableTowers, type CreepDef } from '@tower-defense/data';
import { rollDamage } from './rng.js';
import { finalDamage } from './damage.js';
import {
  TICK_RATE,
  secToTicks,
  type Arena,
  type Command,
  type Creep,
  type GameState,
  type SimEvent,
  type Tower,
} from './types.js';

/** Tous les creeps vendus par un shop, a plat. Le stock gere le deblocage. */
const allSellableCreeps: string[] = [...new Set(shops.flatMap((s) => s.sells))].filter((id) =>
  creeps.has(id),
);

function makeStock(): Record<string, ReturnType<typeof stockEntry>> {
  const out: Record<string, ReturnType<typeof stockEntry>> = {};
  for (const id of allSellableCreeps) {
    const def = creeps.get(id)!;
    out[id] = stockEntry(def);
  }
  return out;
}

function stockEntry(def: CreepDef) {
  return {
    availableAt: secToTicks(def.stockStartDelay),
    count: 0,
    nextReplenish: secToTicks(def.stockStartDelay),
  };
}

export function createGame(seed: number, playerCount = rules.maxPlayers): GameState {
  const arenas: Arena[] = [];
  for (let i = 0; i < playerCount; i++) {
    arenas.push({
      player: i,
      alive: true,
      gold: 0,
      income: rules.startIncome,
      lives: rules.startLives,
      towers: [],
      creeps: [],
      stock: makeStock(),
      leaked: 0,
      killed: 0,
      goldSpentOnTowers: 0,
      goldSpentOnCreeps: 0,
    });
  }
  return {
    tick: 0,
    rng: seed | 0,
    nextEid: 1,
    round: 0,
    nextRoundAt: secToTicks(rules.firstRoundDelaySec),
    arenas,
    finished: false,
    winner: null,
  };
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function inBuildZone(player: number, x: number, y: number): boolean {
  const z = lanes[player]?.buildZone;
  if (!z) return false;
  return x >= z.left && x <= z.right && y >= z.bottom && y <= z.top;
}

/** Un creep occupe ~64u ; on interdit de poser une tour pile sur une autre. */
const TOWER_FOOTPRINT = 64;

function applyCommand(s: GameState, cmd: Command, events: SimEvent[]): void {
  const arena = s.arenas[cmd.player];
  if (!arena || !arena.alive) return;

  if (cmd.type === 'buildTower') {
    const def = towers.get(cmd.defId);
    if (!def) return events.push({ type: 'rejected', player: cmd.player, reason: 'unknown tower' });
    if (!buildableTowers.includes(cmd.defId))
      return events.push({ type: 'rejected', player: cmd.player, reason: 'not directly buildable' });
    if (arena.gold < def.goldCost)
      return events.push({ type: 'rejected', player: cmd.player, reason: 'not enough gold' });
    if (!inBuildZone(cmd.player, cmd.x, cmd.y))
      return events.push({ type: 'rejected', player: cmd.player, reason: 'outside build zone' });
    for (const t of arena.towers) {
      if (dist2(t.x, t.y, cmd.x, cmd.y) < TOWER_FOOTPRINT * TOWER_FOOTPRINT)
        return events.push({ type: 'rejected', player: cmd.player, reason: 'occupied' });
    }
    arena.gold -= def.goldCost;
    arena.goldSpentOnTowers += def.goldCost;
    arena.towers.push({ eid: s.nextEid++, defId: def.id, x: cmd.x, y: cmd.y, cooldown: 0 });
    return;
  }

  if (cmd.type === 'upgradeTower') {
    const t = arena.towers.find((x) => x.eid === cmd.eid);
    if (!t) return;
    const from = towers.get(t.defId);
    const to = towers.get(cmd.defId);
    if (!from || !to) return;
    if (!from.upgradesTo.includes(cmd.defId))
      return events.push({ type: 'rejected', player: cmd.player, reason: 'invalid upgrade' });
    if (arena.gold < to.goldCost)
      return events.push({ type: 'rejected', player: cmd.player, reason: 'not enough gold' });
    arena.gold -= to.goldCost;
    arena.goldSpentOnTowers += to.goldCost;
    t.defId = to.id;
    t.cooldown = 0;
    return;
  }

  if (cmd.type === 'sellTower') {
    const i = arena.towers.findIndex((x) => x.eid === cmd.eid);
    if (i < 0) return;
    const t = arena.towers[i]!;
    arena.gold += towers.get(t.defId)?.refund ?? 0;
    arena.towers.splice(i, 1);
    return;
  }

  if (cmd.type === 'sendCreep') {
    const def = creeps.get(cmd.defId);
    if (!def) return events.push({ type: 'rejected', player: cmd.player, reason: 'unknown creep' });
    const st = arena.stock[cmd.defId];
    if (!st || s.tick < st.availableAt)
      return events.push({ type: 'rejected', player: cmd.player, reason: 'not unlocked' });
    if (st.count < 1)
      return events.push({ type: 'rejected', player: cmd.player, reason: 'out of stock' });
    if (arena.gold < def.goldCost)
      return events.push({ type: 'rejected', player: cmd.player, reason: 'not enough gold' });

    arena.gold -= def.goldCost;
    arena.goldSpentOnCreeps += def.goldCost;
    st.count -= 1;
    // L'income est le vrai gain : depenser de l'or achete du revenu permanent.
    arena.income += def.pointValue;

    // Le creep ne spawn PAS chez l'acheteur, mais chez tous les autres joueurs vivants.
    for (const other of s.arenas) {
      if (other.player === cmd.player || !other.alive) continue;
      spawnCreep(s, other, def, cmd.player);
    }
    events.push({ type: 'creepSent', player: cmd.player, defId: def.id });
  }
}

function spawnCreep(s: GameState, arena: Arena, def: CreepDef, sender: number): void {
  const lane = lanes[arena.player];
  if (!lane) return;
  arena.creeps.push({
    eid: s.nextEid++,
    defId: def.id,
    x: lane.spawn[0],
    y: lane.spawn[1],
    hp: def.hitPoints,
    wp: 0,
    sender,
  });
}

function updateStock(s: GameState): void {
  for (const arena of s.arenas) {
    if (!arena.alive) continue;
    for (const id of allSellableCreeps) {
      const st = arena.stock[id]!;
      const def = creeps.get(id)!;
      if (s.tick < st.availableAt) continue;
      if (s.tick >= st.nextReplenish && st.count < def.stockMaximum) {
        st.count += 1;
        st.nextReplenish = s.tick + secToTicks(def.stockReplenishInterval);
      }
    }
  }
}

function moveCreeps(s: GameState, arena: Arena, events: SimEvent[]): void {
  const lane = lanes[arena.player]!;
  for (let i = arena.creeps.length - 1; i >= 0; i--) {
    const c = arena.creeps[i]!;
    const def = creeps.get(c.defId)!;
    const target = lane.waypoints[c.wp];
    if (!target) {
      arena.creeps.splice(i, 1);
      continue;
    }
    const step = def.moveSpeed / TICK_RATE;
    const dx = target[0] - c.x;
    const dy = target[1] - c.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= step) {
      c.x = target[0];
      c.y = target[1];
      c.wp += 1;
      if (c.wp >= lane.waypoints.length) {
        // Arrive au bout : le creep explose, le joueur perd une vie.
        arena.creeps.splice(i, 1);
        arena.leaked += 1;
        arena.lives -= 1;
        events.push({ type: 'leak', player: arena.player, livesLeft: arena.lives });
        if (arena.lives <= 0) {
          // killPlayer vide arena.creeps : il faut sortir de la boucle immediatement.
          killPlayer(arena, events);
          return;
        }
      }
    } else {
      c.x += (dx / d) * step;
      c.y += (dy / d) * step;
    }
  }
}

function killPlayer(arena: Arena, events: SimEvent[]): void {
  arena.alive = false;
  arena.gold = 0;
  arena.towers.length = 0;
  arena.creeps.length = 0;
  events.push({ type: 'defeat', player: arena.player });
}

/** Progression du creep sur son chemin : sert a cibler celui qui est le plus avance. */
function progress(c: Creep, arena: Arena): number {
  const lane = lanes[arena.player]!;
  const target = lane.waypoints[c.wp];
  if (!target) return Number.MAX_SAFE_INTEGER;
  const d = Math.sqrt(dist2(c.x, c.y, target[0], target[1]));
  return c.wp * 100000 - d;
}

function fireTowers(s: GameState, arena: Arena): void {
  // Creeps sent in the same tick advance in perfect synchronism (identical
  // progress() every tick, since they share moveSpeed/spawn point/path) : without
  // this, every tower in range independently re-derives the same "most advanced"
  // creep and they'd all pile onto that one, leaving the rest of the group
  // completely untouched regardless of how much firepower is aimed at it.
  const targetedThisTick = new Set<number>();

  for (const t of arena.towers) {
    if (t.cooldown > 0) {
      t.cooldown -= 1;
      continue;
    }
    const def = towers.get(t.defId)!;
    const range2 = def.range * def.range;

    // Cible la plus avancee sur le chemin. A egalite : un creep qu'aucune tour
    // n'a encore vise ce tick (repartit les tirs sur tout le groupe synchronise),
    // sinon le moins de PV (acheve les creeps affaiblis), eid en dernier recours.
    let best: Creep | null = null;
    let bestScore = -Infinity;
    for (const c of arena.creeps) {
      const cd = creeps.get(c.defId)!;
      if (cd.isAir && !def.targets.includes('air')) continue;
      if (!cd.isAir && !def.targets.includes('ground')) continue;
      if (dist2(t.x, t.y, c.x, c.y) > range2) continue;
      const p = progress(c, arena);
      const better =
        p > bestScore || (p === bestScore && best !== null && isBetterTiebreak(c, best, targetedThisTick));
      if (better) {
        best = c;
        bestScore = p;
      }
    }
    if (!best) continue;

    targetedThisTick.add(best.eid);
    const roll = rollDamage(s.rng, def.damageBase, def.dice, def.sides);
    s.rng = roll.state;
    applyDamage(s, arena, def, best.eid, best.x, best.y, roll.value);
    t.cooldown = Math.max(1, secToTicks(def.cooldown));
  }
}

function isBetterTiebreak(c: Creep, best: Creep, targetedThisTick: Set<number>): boolean {
  const cTargeted = targetedThisTick.has(c.eid);
  const bestTargeted = targetedThisTick.has(best.eid);
  if (cTargeted !== bestTargeted) return !cTargeted;
  if (c.hp !== best.hp) return c.hp < best.hp;
  return c.eid < best.eid;
}

function applyDamage(
  s: GameState,
  arena: Arena,
  def: ReturnType<typeof towers.get> & object,
  targetEid: number,
  cx: number,
  cy: number,
  raw: number,
): void {
  const hits: Array<{ c: Creep; factor: number }> = [];
  if (def.aoeFull > 0) {
    // Trois paliers de degats de zone : 100% / 50% / 25% selon le rayon.
    for (const c of arena.creeps) {
      const d2 = dist2(cx, cy, c.x, c.y);
      if (d2 <= def.aoeFull * def.aoeFull) hits.push({ c, factor: 1.0 });
      else if (d2 <= def.aoeMedium * def.aoeMedium) hits.push({ c, factor: 0.5 });
      else if (d2 <= def.aoeSmall * def.aoeSmall) hits.push({ c, factor: 0.25 });
    }
  } else {
    // Par identite, pas par position : des creeps synchronises partagent
    // exactement les memes coordonnees, une recherche par position pourrait
    // silencieusement toucher un autre membre du groupe que la cible visee.
    const c = arena.creeps.find((x) => x.eid === targetEid);
    if (c) hits.push({ c, factor: 1.0 });
  }

  for (const h of hits) {
    const cd = creeps.get(h.c.defId)!;
    h.c.hp -= finalDamage(raw * h.factor, def.attackType, cd.armorType, cd.armor);
  }

  for (let i = arena.creeps.length - 1; i >= 0; i--) {
    const c = arena.creeps[i]!;
    if (c.hp > 0) continue;
    const cd = creeps.get(c.defId)!;
    arena.creeps.splice(i, 1);
    arena.killed += 1;
    if (cd.spawnsOnDeath) {
      const spawn = creeps.get(cd.spawnsOnDeath.id);
      if (spawn) {
        for (let k = 0; k < cd.spawnsOnDeath.count; k++) {
          arena.creeps.push({
            eid: s.nextEid++,
            defId: spawn.id,
            x: c.x,
            y: c.y,
            hp: spawn.hitPoints,
            wp: c.wp,
            sender: c.sender,
          });
        }
      }
    }
  }
}

function checkEnd(s: GameState, events: SimEvent[]): void {
  const alive = s.arenas.filter((a) => a.alive);
  if (alive.length <= 1) {
    s.finished = true;
    s.winner = alive[0]?.player ?? null;
    events.push({ type: 'gameOver', winner: s.winner });
  }
}

/**
 * Avance la simulation d'un tick. Muter l'etat en place est volontaire :
 * copier 8 arenes 20 fois par seconde couterait plus cher que ca ne rapporte.
 * Pour un snapshot, structuredClone(state) avant d'appeler.
 */
export function tick(s: GameState, commands: Command[] = []): SimEvent[] {
  const events: SimEvent[] = [];
  if (s.finished) return events;

  s.tick += 1;

  if (s.tick >= s.nextRoundAt) {
    s.round += 1;
    s.nextRoundAt = s.tick + secToTicks(rules.roundIntervalSec);
    for (const a of s.arenas) if (a.alive) a.gold += a.income;
    events.push({ type: 'roundStart', round: s.round });
  }

  updateStock(s);

  for (const cmd of commands) applyCommand(s, cmd, events);

  for (const arena of s.arenas) {
    if (!arena.alive) continue;
    fireTowers(s, arena);
    moveCreeps(s, arena, events);
  }

  checkEnd(s, events);
  return events;
}
