import { lanes, rules, towers, creeps, shops, buildableTowers, nearestSlot, type CreepDef, type TowerDef } from '@tower-defense/data';
import { rollDamage } from './rng.js';
import { finalDamage } from './damage.js';
import { applyIceSlow, applyPoison, totalSlowPct, poisonTickDamage, CHAIN_RANGE } from './status.js';
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
      occupied: {},
      leaked: 0,
      killed: 0,
      goldSpentOnTowers: 0,
      goldSpentOnCreeps: 0,
      goldFromBounty: 0,
      goldFromIncome: 0,
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
    // Le clic est snap sur l'emplacement le plus proche (a SLOT_SIZE pres) :
    // la tour prend la position exacte de l'emplacement, jamais celle du
    // clic — c'est ce qui garde la sim deterministe (le meme clic approximatif
    // d'un client rejoue toujours sur la meme case).
    const slot = nearestSlot(cmd.player, cmd.x, cmd.y);
    if (!slot) return events.push({ type: 'rejected', player: cmd.player, reason: 'no slot here' });
    if (arena.occupied[slot.id])
      return events.push({ type: 'rejected', player: cmd.player, reason: 'occupied' });
    arena.gold -= def.goldCost;
    arena.goldSpentOnTowers += def.goldCost;
    arena.occupied[slot.id] = true;
    arena.towers.push({ eid: s.nextEid++, defId: def.id, x: slot.x, y: slot.y, cooldown: 0, slotId: slot.id });
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
    delete arena.occupied[t.slotId];
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
    const slow = totalSlowPct(c, s.tick);
    const step = (def.moveSpeed * (1 - slow)) / TICK_RATE;
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
  arena.occupied = {};
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

function fireTowers(s: GameState, arena: Arena, events: SimEvent[]): void {
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
    const bestEid = best.eid;
    const bestX = best.x;
    const bestY = best.y;
    applyDamage(s, arena, def, bestEid, bestX, bestY, roll.value, events);
    // Les abilites (ralentissement, poison) s'appliquent apres les degats —
    // une cible achevee par le coup lui-meme n'a plus rien a ralentir ou
    // empoisonner (splice l'a deja retiree de arena.creeps).
    if (def.slow) applyIceAoeSlow(arena, def, def.slow, bestX, bestY, s.tick);
    if (def.poison) {
      const survivor = arena.creeps.find((c) => c.eid === bestEid);
      if (survivor) applyPoison(survivor, def.poison.slowPct, def.poison.dps, secToTicks(def.poison.durationSec), s.tick);
    }
    t.cooldown = Math.max(1, secToTicks(def.cooldown));
  }
}

/** Ralentissement de zone (branche Ice) : les `maxTargets` creeps les plus
 * proches du point d'impact, dans un rayon aoeFull — pas tous les creeps du
 * rayon, pour que le nombre de cibles touchees reste une progression
 * deliberee par palier (cf. balance.json) plutot qu'un effet de bord de la
 * densite locale de creeps. */
function applyIceAoeSlow(
  arena: Arena,
  def: TowerDef,
  slow: NonNullable<TowerDef['slow']>,
  cx: number,
  cy: number,
  currentTick: number,
): void {
  const radius2 = def.aoeFull * def.aoeFull;
  const inRange = arena.creeps
    .map((c) => ({ c, d2: dist2(cx, cy, c.x, c.y) }))
    .filter((x) => x.d2 <= radius2)
    .sort((a, b) => a.d2 - b.d2 || a.c.eid - b.c.eid)
    .slice(0, slow.maxTargets);
  const durationTicks = secToTicks(slow.durationSec);
  for (const { c } of inRange) applyIceSlow(c, slow.pct, durationTicks, currentTick);
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
  def: TowerDef,
  targetEid: number,
  cx: number,
  cy: number,
  raw: number,
  events: SimEvent[],
): void {
  if (def.chain) {
    applyChainDamage(s, arena, def.chain, def, targetEid, raw, events);
    return;
  }

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

  handleDeaths(s, arena);
}

/**
 * Chaine d'eclair (branche Lightning) : rebondit sur les creeps AERIENS les
 * plus proches (cf. cibles de la branche, air uniquement), jamais deux fois
 * sur la meme cible, degats decroissants par palier (dégâts au rebond n =
 * base * falloff^n — formule de Warcraft III). Le prochain saut se cherche
 * depuis la position de la derniere cible touchee (pas depuis l'impact
 * d'origine), a portee CHAIN_RANGE — plus courte que la portee de la tour.
 * Selection deterministe (le plus proche, eid en depart) : jamais de RNG.
 */
function applyChainDamage(
  s: GameState,
  arena: Arena,
  chain: NonNullable<TowerDef['chain']>,
  def: TowerDef,
  startEid: number,
  raw: number,
  events: SimEvent[],
): void {
  const hitEids = new Set<number>();
  const range2 = CHAIN_RANGE * CHAIN_RANGE;
  let currentEid: number | undefined = startEid;
  // Positions au moment de l'impact, dans l'ordre reel des rebonds — capturees
  // avant handleDeaths() (qui peut retirer une cible achevee par son propre
  // rebond) pour que le rendu puisse tracer l'arc meme si une cible meurt.
  const points: Array<[number, number]> = [];

  for (let n = 0; n <= chain.bounces; n++) {
    const target = arena.creeps.find((c) => c.eid === currentEid);
    if (!target) break;
    hitEids.add(target.eid);
    points.push([target.x, target.y]);
    const cd = creeps.get(target.defId)!;
    target.hp -= finalDamage(raw * Math.pow(chain.falloff, n), def.attackType, cd.armorType, cd.armor);

    if (n === chain.bounces) break;
    let next: Creep | null = null;
    let bestD2 = Infinity;
    for (const c of arena.creeps) {
      if (hitEids.has(c.eid)) continue;
      const ccd = creeps.get(c.defId)!;
      if (!ccd.isAir) continue; // la branche Lightning ne cible que les unites aeriennes
      const d2 = dist2(target.x, target.y, c.x, c.y);
      if (d2 > range2) continue;
      if (d2 < bestD2 || (d2 === bestD2 && c.eid < next!.eid)) {
        next = c;
        bestD2 = d2;
      }
    }
    if (!next) break;
    currentEid = next.eid;
  }

  if (points.length >= 2) events.push({ type: 'lightningChain', player: arena.player, points });
  handleDeaths(s, arena);
}

/** Retire les creeps a 0 PV ou moins, compte les kills, gere le spawn a la
 * mort (Porte-essaim) — factorise pour rester identique quelle que soit
 * la source des degats (attaque normale, chaine, poison sur la duree). */
function handleDeaths(s: GameState, arena: Arena): void {
  for (let i = arena.creeps.length - 1; i >= 0; i--) {
    const c = arena.creeps[i]!;
    if (c.hp > 0) continue;
    const cd = creeps.get(c.defId)!;
    arena.creeps.splice(i, 1);
    arena.killed += 1;
    // Prime versee au proprietaire de l'arene ou le creep meurt (c'est lui
    // qui defend), jamais a l'envoyeur. Rien pour un joueur deja elimine.
    // Rien non plus pour un creep engendre par la mort d'un autre (pas de
    // cout en or propre) — sinon un Porte-essaim paierait deux fois.
    if (arena.alive && !c.freeSpawn) {
      const bounty = Math.max(1, Math.ceil(cd.goldCost * rules.bountyPct));
      arena.gold += bounty;
      arena.goldFromBounty += bounty;
    }
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
            freeSpawn: true,
          });
        }
      }
    }
  }
}

/** Degats de poison, une fois par tick, pour tous les creeps affectes —
 * independant de la portee de toute tour (le creep continue de perdre des
 * PV apres etre sorti de portee). Ignore l'armure (pas de finalDamage) :
 * c'est le role du poison de rester efficace contre les creeps a armure
 * elevee. Peut achever un creep, contrairement au Slow Poison d'origine. */
function applyPoisonTicks(s: GameState, arena: Arena): void {
  for (const c of arena.creeps) {
    const dmg = poisonTickDamage(c, s.tick);
    if (dmg > 0) c.hp -= dmg;
  }
  handleDeaths(s, arena);
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
    for (const a of s.arenas) {
      if (!a.alive) continue;
      a.gold += a.income;
      a.goldFromIncome += a.income;
    }
    events.push({ type: 'roundStart', round: s.round });
  }

  updateStock(s);

  for (const cmd of commands) applyCommand(s, cmd, events);

  for (const arena of s.arenas) {
    if (!arena.alive) continue;
    fireTowers(s, arena, events);
    applyPoisonTicks(s, arena);
    moveCreeps(s, arena, events);
  }

  checkEnd(s, events);
  return events;
}
