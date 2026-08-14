import { createGame, tick, Bot, TICK_RATE, type Command } from '@tower-defense/sim';
import { buildableTowers, towers, defaultsUsed } from '@tower-defense/data';

const GAMES = Number(process.argv[2] ?? 50);
const MAX_MINUTES = 25;
const MAX_TICKS = MAX_MINUTES * 60 * TICK_RATE;

interface Result {
  seed: number;
  winner: number | null;
  ticks: number;
  rootOfWinner: string | null;
  aggressionOfWinner: number | null;
  totalLeaks: number;
}

function playOne(seed: number): Result {
  const s = createGame(seed, 8);
  const configs = s.arenas.map((a, i) => ({
    player: a.player,
    aggression: 0.2 + (i % 4) * 0.2,
    preferredRoot: buildableTowers[i % buildableTowers.length]!,
    seed: seed + i * 7919,
  }));
  const bots = configs.map((c) => new Bot(c));

  let t = 0;
  for (; t < MAX_TICKS && !s.finished; t++) {
    const cmds: Command[] = [];
    for (const b of bots) cmds.push(...b.decide(s));
    tick(s, cmds);
  }

  const wc = s.winner !== null ? configs[s.winner] : null;
  return {
    seed,
    winner: s.winner,
    ticks: t,
    rootOfWinner: wc?.preferredRoot ?? null,
    aggressionOfWinner: wc?.aggression ?? null,
    totalLeaks: s.arenas.reduce((acc, a) => acc + a.leaked, 0),
  };
}

const started = Date.now();
const results: Result[] = [];
for (let i = 0; i < GAMES; i++) results.push(playOne(1000 + i));
const elapsed = (Date.now() - started) / 1000;

const byRoot = new Map<string, number>();
const byAggr = new Map<number, number>();
for (const r of results) {
  if (r.rootOfWinner) byRoot.set(r.rootOfWinner, (byRoot.get(r.rootOfWinner) ?? 0) + 1);
  if (r.aggressionOfWinner !== null)
    byAggr.set(r.aggressionOfWinner, (byAggr.get(r.aggressionOfWinner) ?? 0) + 1);
}

console.log(`${GAMES} parties en ${elapsed.toFixed(1)}s (${(GAMES / elapsed).toFixed(1)} parties/s)`);
console.log(
  `duree moyenne : ${(results.reduce((a, r) => a + r.ticks, 0) / GAMES / TICK_RATE / 60).toFixed(1)} min`,
);
console.log(`parties sans vainqueur (timeout) : ${results.filter((r) => r.winner === null).length}`);

console.log('\nvictoires par branche de tours :');
for (const [root, n] of [...byRoot].sort((a, b) => b[1] - a[1])) {
  const name = towers.get(root)?.name ?? root;
  console.log(`  ${name.padEnd(22)} ${String(n).padStart(3)}  ${((n / GAMES) * 100).toFixed(0)}%`);
}

console.log('\nvictoires par agressivite (part de l or en creeps) :');
for (const [a, n] of [...byAggr].sort((x, y) => x[0] - y[0])) {
  console.log(`  ${(a * 100).toFixed(0).padStart(3)}%  ${String(n).padStart(3)}`);
}

const missing = new Map<string, Set<string>>();
for (const d of defaultsUsed) {
  if (!missing.has(d.field)) missing.set(d.field, new Set());
  missing.get(d.field)!.add(d.id);
}
if (missing.size) {
  console.log('\nvaleurs retombees sur les defauts d\'origine (absentes des donnees sources, a verifier) :');
  for (const [field, ids] of missing) console.log(`  ${field}: ${[...ids].join(', ')}`);
}
