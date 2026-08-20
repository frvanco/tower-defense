import { createGame, tick, Bot, TICK_RATE, type Command, type Difficulty } from '@tower-defense/sim';
import { towers, defaultsUsed } from '@tower-defense/data';

const GAMES = Number(process.argv[2] ?? 50);
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const difficultyArg = process.argv[3];
if (difficultyArg && !DIFFICULTIES.includes(difficultyArg as Difficulty)) {
  throw new Error(`difficulte inconnue "${difficultyArg}" — attendu : ${DIFFICULTIES.join(', ')}`);
}
const DIFFICULTY: Difficulty = (difficultyArg as Difficulty) ?? 'medium';

const MAX_MINUTES = 25;
const MAX_TICKS = MAX_MINUTES * 60 * TICK_RATE;

interface Result {
  seed: number;
  winner: number | null;
  ticks: number;
  rootOfWinner: string | null;
  aggressionOfWinner: number | null;
  totalLeaks: number;
  totalBounty: number;
  totalIncome: number;
}

function playOne(seed: number): Result {
  const s = createGame(seed, 8);
  const bots = s.arenas.map((a, i) => new Bot({ player: a.player, seed: seed + i * 7919, difficulty: DIFFICULTY }));

  let t = 0;
  for (; t < MAX_TICKS && !s.finished; t++) {
    const cmds: Command[] = [];
    for (const b of bots) cmds.push(...b.decide(s));
    tick(s, cmds);
  }

  // aggression/preferredRoot sont desormais tires du RNG interne de chaque
  // bot (personnalite, cf. packages/sim/src/bot.ts) : on ne les lit plus
  // depuis une config qu'on aurait nous-memes calculee, mais depuis l'objet
  // Bot du gagnant, seul a les connaitre.
  const winnerBot = s.winner !== null ? bots[s.winner] : null;
  return {
    seed,
    winner: s.winner,
    ticks: t,
    rootOfWinner: winnerBot?.preferredRoot ?? null,
    aggressionOfWinner: winnerBot?.aggression ?? null,
    totalLeaks: s.arenas.reduce((acc, a) => acc + a.leaked, 0),
    totalBounty: s.arenas.reduce((acc, a) => acc + a.goldFromBounty, 0),
    totalIncome: s.arenas.reduce((acc, a) => acc + a.goldFromIncome, 0),
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

console.log(`difficulte : ${DIFFICULTY}`);
console.log(`${GAMES} parties en ${elapsed.toFixed(1)}s (${(GAMES / elapsed).toFixed(1)} parties/s)`);
console.log(
  `duree moyenne : ${(results.reduce((a, r) => a + r.ticks, 0) / GAMES / TICK_RATE / 60).toFixed(1)} min`,
);
console.log(`parties sans vainqueur (timeout) : ${results.filter((r) => r.winner === null).length}`);

const totalBounty = results.reduce((a, r) => a + r.totalBounty, 0);
const totalIncome = results.reduce((a, r) => a + r.totalIncome, 0);
const bountyShare = totalBounty / (totalBounty + totalIncome);
console.log(
  `part du revenu venant des primes de mise a mort : ${(bountyShare * 100).toFixed(1)}% (${totalBounty} or de primes / ${totalIncome} or d'income sur ${GAMES} parties)`,
);

console.log('\nvictoires par branche de tours :');
for (const [root, n] of [...byRoot].sort((a, b) => b[1] - a[1])) {
  const name = towers.get(root)?.name ?? root;
  console.log(`  ${name.padEnd(22)} ${String(n).padStart(3)}  ${((n / GAMES) * 100).toFixed(0)}%`);
}

console.log('\nvictoires par agressivite (part de l or en creeps, personnalite tiree du RNG de chaque bot) :');
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
