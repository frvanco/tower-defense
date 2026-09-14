import { describe, expect, it } from 'vitest';
import { buildSlots, creeps, shops, towers, rules } from '@tower-defense/data';
import { Bot, createGame, tick, TICK_RATE, type Command, type Difficulty } from '../src/index.js';
import { drainBuilder } from './helpers.js';

const difficulties: Difficulty[] = ['easy', 'medium', 'hard'];
const creepId = shops[0]!.sells[0]!;

function fixture(towerCount = 0) {
  const state = createGame(42, 2);
  const arena = state.arenas[0]!;
  // Depasse la phase initiale du bot, sans versement d'income ni reappro
  // pendant les decisions : chaque commande doit financer son propre cout.
  state.tick = TICK_RATE;
  state.nextRoundAt = 1_000_000;
  arena.gold = 1_000_000;
  for (const stock of Object.values(arena.stock)) {
    stock.count = 0;
    stock.availableAt = 0;
    stock.nextReplenish = 1_000_000;
  }
  arena.stock[creepId]!.count = 20;
  // Tours au dernier palier pour isoler la construction des ameliorations.
  for (const slot of buildSlots(0).slice(0, towerCount)) {
    arena.towers.push({
      eid: state.nextEid++,
      defId: 'h010',
      x: slot.x,
      y: slot.y,
      cooldown: 0,
      slotId: slot.id,
    });
    arena.occupied[slot.id] = true;
  }
  return { state, arena };
}

function makeBot(difficulty: Difficulty) {
  return new Bot({ player: 0, seed: 42, difficulty, aggression: 0.5, personality: 'balanced' });
}

function commandCost(command: Command, unlockCost: number): number {
  switch (command.type) {
    case 'unlockShop':
      return unlockCost;
    case 'buildTower':
    case 'upgradeTower':
      return towers.get(command.defId)!.goldCost;
    case 'sendCreep':
      return creeps.get(command.defId)!.goldCost;
    default:
      return 0;
  }
}

describe.each(difficulties)('bot %s — plafond de tours', (difficulty) => {
  // Deux plafonds se cumulent desormais : MAX_BOT_TOWERS (200) et la file de
  // construction du builder (rules.builderQueueMax, 5). Depuis 0 tour le bot
  // n'emet donc plus 200 constructions d'un lot mais 5 — la meme limite que
  // celle opposee au joueur humain. Il reprendra les suivantes a sa prochaine
  // decision, au fur et a mesure que son ouvrier vide la file.
  it.each([
    { initialCount: 0, expectedBuilds: Math.min(200, rules.builderQueueMax) },
    { initialCount: 199, expectedBuilds: 1 },
    { initialCount: 200, expectedBuilds: 0 },
    { initialCount: 201, expectedBuilds: 0 },
  ])('depuis $initialCount tours, emet au plus $expectedBuilds constructions', ({ initialCount, expectedBuilds }) => {
    const { state, arena } = fixture(initialCount);
    const commands = makeBot(difficulty).decide(state);

    // Le lot entier respecte les deux plafonds avant meme son application.
    expect(commands.filter((command) => command.type === 'buildTower')).toHaveLength(expectedBuilds);
    const events = tick(state, commands);

    expect(events.filter((event) => event.type === 'rejected')).toEqual([]);
    // Une construction acceptee entre dans la file, la tour n'apparait que
    // quand l'ouvrier a fini : ce qui est "engage" est donc la somme des deux.
    expect(arena.towers.length + arena.builder.queue.length).toBe(initialCount + expectedBuilds);
    const engagedSlots = [...arena.towers.map((t) => t.slotId), ...arena.builder.queue.map((o) => o.slotId)];
    expect(new Set(engagedSlots).size).toBe(engagedSlots.length);
  });

  it('continue les ameliorations et les envois a 200 tours', () => {
    const { state, arena } = fixture(200);
    const upgradeable = arena.towers[0]!;
    upgradeable.defId = 'h000';
    const bot = makeBot(difficulty);
    let sent = 0;

    // Easy peut volontairement sauter une passe d'amelioration ; plusieurs
    // decisions verifient qu'il reste actif sans imposer le rythme de hard.
    for (let decision = 0; decision < 8; decision++) {
      const commands = bot.decide(state);
      expect(commands.some((command) => command.type === 'buildTower')).toBe(false);
      const events = tick(state, commands);
      expect(events.filter((event) => event.type === 'rejected')).toEqual([]);
      sent += events.filter((event) => event.type === 'creepSent').length;
      expect(arena.towers).toHaveLength(200);
      state.tick += TICK_RATE * 3;
    }

    expect(upgradeable.defId).not.toBe('h000');
    expect(arena.goldSpentOnTowers).toBeGreaterThan(0);
    expect(sent).toBeGreaterThan(0);
    expect(arena.goldSpentOnCreeps).toBeGreaterThan(0);
  });

  it('remplace une tour vendue puis reste a 200 tours', () => {
    const { state, arena } = fixture(199);
    const bot = makeBot(difficulty);
    const firstEvents = tick(state, bot.decide(state));
    expect(firstEvents.filter((event) => event.type === 'rejected')).toEqual([]);
    drainBuilder(state);
    expect(arena.towers).toHaveLength(200);

    tick(state, [{ type: 'sellTower', player: 0, eid: arena.towers[0]!.eid }]);
    expect(arena.towers).toHaveLength(199);
    state.tick += TICK_RATE * 3;

    const replacement = bot.decide(state);
    expect(replacement.filter((command) => command.type === 'buildTower')).toHaveLength(1);
    const events = tick(state, replacement);
    expect(events.filter((event) => event.type === 'rejected')).toEqual([]);
    drainBuilder(state);
    expect(arena.towers).toHaveLength(200);

    state.tick += TICK_RATE * 3;
    const nextCommands = bot.decide(state);
    expect(nextCommands.some((command) => command.type === 'buildTower')).toBe(false);
    tick(state, nextCommands);
    drainBuilder(state);
    expect(arena.towers).toHaveLength(200);
  });
});

describe.each(difficulties)('bot %s — budget des boutiques', (difficulty) => {
  it.each([1, 2])('deduit le prix du palier %i avant les autres achats du meme lot', (tier) => {
    const { state, arena } = fixture(1);
    arena.towers[0]!.defId = 'h000';
    arena.unlockedShopTier = tier - 1;
    state.round = 1;
    const shopCost = shops[tier]!.goldCost;
    const startingGold = Math.ceil(shopCost * 1.2);
    arena.gold = startingGold;

    const commands = makeBot(difficulty).decide(state);
    expect(commands.filter((command) => command.type === 'unlockShop')).toHaveLength(1);
    expect(commands.some((command) => command.type === 'sendCreep')).toBe(true);
    expect(commands.some((command) => command.type === 'buildTower')).toBe(true);
    if (difficulty !== 'easy') {
      expect(commands.some((command) => command.type === 'upgradeTower')).toBe(true);
    }
    const totalCost = commands.reduce((sum, command) => sum + commandCost(command, shopCost), 0);
    expect(totalCost).toBeLessThanOrEqual(startingGold);

    const events = tick(state, commands);
    expect(events.filter((event) => event.type === 'rejected')).toEqual([]);
    expect(arena.unlockedShopTier).toBe(tier);
    expect(arena.gold).toBe(startingGold - totalCost);
  });
});
