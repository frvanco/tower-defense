import { describe, expect, it } from 'vitest';
import { buildSlots, creeps, lanes, towers } from '@tower-defense/data';
import { Bot, createGame, tick, type Difficulty, type GameState } from '../src/index.js';
import { drainBuilder } from './helpers.js';

function readyGame(playerCount = 2): GameState {
  const s = createGame(42, playerCount);
  s.tick = 100;
  s.nextRoundAt = 10_000;
  for (const arena of s.arenas) {
    for (const stock of Object.values(arena.stock)) {
      stock.count = 0;
      stock.nextReplenish = 10_000;
    }
  }
  return s;
}

function addTower(s: GameState, defId: string): number {
  const arena = s.arenas[0]!;
  const slot = buildSlots(0).find((candidate) => !arena.occupied[candidate.id])!;
  const eid = s.nextEid++;
  arena.towers.push({ eid, defId, x: slot.x, y: slot.y, slotId: slot.id, cooldown: 0 });
  arena.occupied[slot.id] = true;
  return eid;
}

function addAirThreat(s: GameState): void {
  const lane = lanes.find((candidate) => candidate.player === 0)!;
  s.arenas[0]!.creeps.push({
    eid: s.nextEid++,
    defId: 'u000',
    x: lane.spawn[0],
    y: lane.spawn[1],
    hp: creeps.get('u000')!.hitPoints,
    wp: 0,
    sender: 1,
  });
}

describe('placement des bots', () => {
  it.each([
    ['medium', 0],
    ['hard', 0],
    ['medium', 5],
    ['hard', 5],
  ] as const)('%s couvre une grande portion du chemin du joueur %i', (difficulty, player) => {
    const s = readyGame(6);
    s.arenas[player]!.gold = 80;
    const bot = new Bot({ player, seed: 5, difficulty, aggression: 0, personality: 'damage' });
    const build = bot.decide(s).find((command) => command.type === 'buildTower');
    expect(build).toBeDefined();
    if (!build || build.type !== 'buildTower') throw new Error('Le bot doit construire une tour');

    // Mesure independante par echantillonnage du trajet, sans reprendre le
    // calcul analytique du bot. Les deux bras du U doivent etre exploites.
    const lane = lanes.find((candidate) => candidate.player === player)!;
    const points = [lane.spawn, ...lane.waypoints];
    const samples: Array<{ x: number; y: number; length: number }> = [];
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1]!;
      const [bx, by] = points[i]!;
      const length = Math.hypot(bx - ax, by - ay);
      const count = Math.ceil(length / 4);
      for (let j = 0; j < count; j++) {
        const fraction = (j + 0.5) / count;
        samples.push({ x: ax + (bx - ax) * fraction, y: ay + (by - ay) * fraction, length: length / count });
      }
    }
    const range = towers.get(build.defId)!.range;
    const coveredLength = (position: { x: number; y: number }) => samples.reduce(
      (length, point) => length + (Math.hypot(point.x - position.x, point.y - position.y) <= range ? point.length : 0),
      0,
    );
    const bestCoverage = Math.max(...buildSlots(player).map(coveredLength));
    expect(coveredLength(build)).toBeGreaterThanOrEqual(bestCoverage - 20);
    expect(coveredLength(build)).toBeGreaterThan(2_500);
  });
});

describe('reaction des bots aux creeps aeriens', () => {
  it.each([199, 200])('respecte le plafond lors de l\'urgence avec deja %i tours', (initialCount) => {
    const s = readyGame();
    const arena = s.arenas[0]!;
    for (let i = 0; i < initialCount; i++) addTower(s, 'h004');
    arena.gold = 1_000_000;
    addAirThreat(s);
    const bot = new Bot({ player: 0, seed: 5, difficulty: 'medium', aggression: 0 });

    const commands = bot.decide(s);
    const builds = commands.filter((command) => command.type === 'buildTower');
    expect(builds).toHaveLength(200 - initialCount);
    if (initialCount === 199) expect(builds[0]!.defId).toBe('h005');
    const events = tick(s, commands);
    expect(events.filter((event) => event.type === 'rejected')).toEqual([]);
    drainBuilder(s);
    expect(arena.towers).toHaveLength(200);
  });

  it('finance une defense aerienne avant une amelioration terrestre', () => {
    const s = readyGame();
    const arena = s.arenas[0]!;
    const groundTower = addTower(s, 'h004');
    const nextGroundDef = towers.get(towers.get('h004')!.upgradesTo[0]!)!;
    arena.gold = nextGroundDef.goldCost;
    addAirThreat(s);
    const bot = new Bot({ player: 0, seed: 5, difficulty: 'medium', aggression: 0 });

    const commands = bot.decide(s);
    expect(commands.some((command) => command.type === 'buildTower' && command.defId === 'h005')).toBe(true);
    expect(commands.some((command) => command.type === 'upgradeTower' && command.eid === groundTower)).toBe(false);
    const events = tick(s, commands);
    expect(events.filter((event) => event.type === 'rejected')).toEqual([]);
    drainBuilder(s);
    expect(arena.towers.some((tower) => towers.get(tower.defId)!.targets.includes('air'))).toBe(true);
  });

  it('conserve sa derniere tour capable de viser les airs pendant une attaque', () => {
    const s = readyGame();
    const arena = s.arenas[0]!;
    const arrow = addTower(s, 'h000');
    arena.gold = towers.get(towers.get('h000')!.upgradesTo[0]!)!.goldCost;
    addAirThreat(s);
    const bot = new Bot({ player: 0, seed: 5, difficulty: 'medium', aggression: 0 });

    const commands = bot.decide(s);
    expect(commands.some((command) => command.type === 'upgradeTower' && command.eid === arrow)).toBe(false);
    const events = tick(s, commands);
    expect(events.filter((event) => event.type === 'rejected')).toEqual([]);
    expect(arena.towers.some((tower) => towers.get(tower.defId)!.targets.includes('air'))).toBe(true);
  });

  it('peut ameliorer une tour en conservant une autre defense aerienne', () => {
    const s = readyGame();
    const arena = s.arenas[0]!;
    addTower(s, 'h000');
    addTower(s, 'h000');
    const upgradeCost = towers.get(towers.get('h000')!.upgradesTo[0]!)!.goldCost;
    arena.gold = upgradeCost * 2;
    addAirThreat(s);
    const bot = new Bot({ player: 0, seed: 5, difficulty: 'medium', aggression: 0 });

    const commands = bot.decide(s);
    expect(commands.filter((command) => command.type === 'upgradeTower')).toHaveLength(1);
    const events = tick(s, commands);
    expect(events.filter((event) => event.type === 'rejected')).toEqual([]);
    expect(arena.towers.some((tower) => towers.get(tower.defId)!.targets.includes('air'))).toBe(true);
  });

  it('ameliore normalement la derniere tourelle en absence de menace aerienne', () => {
    const s = readyGame();
    const arrow = addTower(s, 'h000');
    s.arenas[0]!.gold = towers.get(towers.get('h000')!.upgradesTo[0]!)!.goldCost;
    const bot = new Bot({ player: 0, seed: 5, difficulty: 'medium', aggression: 0 });

    expect(bot.decide(s).some((command) => command.type === 'upgradeTower' && command.eid === arrow)).toBe(true);
  });
});

describe('salves de creeps des bots', () => {
  it.each<[Difficulty, number]>([
    ['easy', 20],
    ['medium', 20],
    ['hard', 17],
  ])('%s peut envoyer %i creeps dans la meme decision selon son budget', (difficulty, expectedCount) => {
    const s = readyGame();
    const arena = s.arenas[0]!;
    arena.gold = 100;
    arena.stock.n000 = { count: 100, availableAt: 0, nextReplenish: 10_000 };
    const bot = new Bot({ player: 0, seed: 5, difficulty, aggression: 1 });

    const commands = bot.decide(s);
    expect(commands.filter((command) => command.type === 'sendCreep')).toHaveLength(expectedCount);
    const events = tick(s, commands);
    expect(events.filter((event) => event.type === 'rejected')).toEqual([]);
    expect(events.filter((event) => event.type === 'creepSent')).toHaveLength(expectedCount);
    expect(arena.stock.n000.count).toBe(100 - expectedCount);
  });

  it('peut depasser cinq envois en utilisant le stock de plusieurs types', () => {
    const s = readyGame();
    const arena = s.arenas[0]!;
    arena.gold = 100;
    arena.stock.h001 = { count: 4, availableAt: 0, nextReplenish: 10_000 };
    arena.stock.n000 = { count: 2, availableAt: 0, nextReplenish: 10_000 };
    const bot = new Bot({ player: 0, seed: 5, difficulty: 'medium', aggression: 1 });

    const commands = bot.decide(s);
    const sends = commands.filter((command) => command.type === 'sendCreep');
    expect(sends.map((command) => command.defId)).toEqual(['h001', 'h001', 'h001', 'h001', 'n000', 'n000']);
    expect(arena.stock.h001.count).toBe(4);
    expect(arena.stock.n000.count).toBe(2);
    const events = tick(s, commands);
    expect(events.filter((event) => event.type === 'rejected')).toEqual([]);
    expect(events.filter((event) => event.type === 'creepSent')).toHaveLength(6);
    expect(arena.stock.h001.count).toBe(0);
    expect(arena.stock.n000.count).toBe(0);
  });

  it('epuise le stock disponible sans programmer de commandes excedentaires', () => {
    const s = readyGame();
    const arena = s.arenas[0]!;
    arena.gold = 100;
    arena.stock.n000 = { count: 2, availableAt: 0, nextReplenish: 10_000 };
    const bot = new Bot({ player: 0, seed: 5, difficulty: 'hard', aggression: 1 });

    const commands = bot.decide(s);
    expect(commands.filter((command) => command.type === 'sendCreep')).toHaveLength(2);
    expect(arena.stock.n000.count).toBe(2);
    const events = tick(s, commands);
    expect(events.filter((event) => event.type === 'rejected')).toEqual([]);
    expect(arena.stock.n000.count).toBe(0);
  });

  it('recalcule le budget restant et se replie sur un creep moins cher', () => {
    const s = readyGame();
    const arena = s.arenas[0]!;
    arena.gold = 54;
    arena.stock.h001 = { count: 10, availableAt: 0, nextReplenish: 10_000 };
    arena.stock.n000 = { count: 10, availableAt: 0, nextReplenish: 10_000 };
    const bot = new Bot({ player: 0, seed: 5, difficulty: 'medium', aggression: 0.5 });

    const commands = bot.decide(s);
    const sends = commands.filter((command) => command.type === 'sendCreep');
    expect(sends.map((command) => command.defId)).toEqual(['h001', 'h001', 'n000']);
    expect(sends.reduce((cost, command) => cost + creeps.get(command.defId)!.goldCost, 0)).toBeLessThanOrEqual(27);
    const events = tick(s, commands);
    expect(events.filter((event) => event.type === 'rejected')).toEqual([]);
  });
});
