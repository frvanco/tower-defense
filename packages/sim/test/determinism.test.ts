import { describe, it, expect } from 'vitest';
import { createGame, tick, hashState, Bot, type Command, type Personality } from '../src/index.js';

const PERSONALITIES: Personality[] = ['damage', 'control', 'balanced'];

function runGame(seed: number, ticks: number): { hash: string; trace: string[] } {
  const s = createGame(seed, 4);
  const bots = s.arenas.map(
    (a, i) =>
      new Bot({
        player: a.player,
        aggression: 0.3 + i * 0.15,
        personality: PERSONALITIES[i % PERSONALITIES.length]!,
        seed: seed + i * 7919,
      }),
  );
  const trace: string[] = [];
  for (let i = 0; i < ticks; i++) {
    const cmds: Command[] = [];
    for (const b of bots) cmds.push(...b.decide(s));
    tick(s, cmds);
    if (i % 200 === 0) trace.push(hashState(s));
    if (s.finished) break;
  }
  return { hash: hashState(s), trace };
}

describe('determinisme', () => {
  it('meme seed => meme etat final', () => {
    const a = runGame(12345, 4000);
    const b = runGame(12345, 4000);
    expect(b.hash).toBe(a.hash);
    expect(b.trace).toEqual(a.trace);
  });

  it('seeds differents => etats differents', () => {
    const a = runGame(1, 4000);
    const b = runGame(2, 4000);
    expect(b.hash).not.toBe(a.hash);
  });

  it('un snapshot rejoue a l identique', () => {
    const s = createGame(999, 4);
    for (let i = 0; i < 500; i++) tick(s);
    const snap = structuredClone(s);
    for (let i = 0; i < 500; i++) tick(s);
    const after = hashState(s);
    for (let i = 0; i < 500; i++) tick(snap);
    expect(hashState(snap)).toBe(after);
  });
});

describe('regles', () => {
  it('income verse en debut de round', () => {
    const s = createGame(1, 2);
    const before = s.arenas[0]!.gold;
    for (let i = 0; i < 45; i++) tick(s);
    expect(s.arenas[0]!.gold).toBeGreaterThan(before);
  });

  it('un creep envoye spawn chez les autres, pas chez soi', () => {
    const s = createGame(1, 3);
    for (let i = 0; i < 1200; i++) tick(s);
    s.arenas[0]!.gold = 10000;
    const st = s.arenas[0]!.stock['n000']!;
    st.count = 5;
    tick(s, [{ type: 'sendCreep', player: 0, defId: 'n000' }]);
    expect(s.arenas[0]!.creeps.length).toBe(0);
    expect(s.arenas[1]!.creeps.length).toBe(1);
    expect(s.arenas[2]!.creeps.length).toBe(1);
  });

  it('envoyer un creep augmente l income', () => {
    const s = createGame(1, 2);
    for (let i = 0; i < 1200; i++) tick(s);
    s.arenas[0]!.gold = 10000;
    s.arenas[0]!.stock['n000']!.count = 5;
    const before = s.arenas[0]!.income;
    tick(s, [{ type: 'sendCreep', player: 0, defId: 'n000' }]);
    expect(s.arenas[0]!.income).toBeGreaterThan(before);
  });
});
