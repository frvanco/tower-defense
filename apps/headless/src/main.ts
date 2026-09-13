import { createGame, tick, Bot, branchRootOf, TICK_RATE, type Command, type Difficulty, type Arena } from '@tower-defense/sim';
import { towers, defaultsUsed, rules, buildableTowers, buildSlots } from '@tower-defense/data';

// --- Palier (1-indexe) de chaque tour dans sa branche, + cout cumule pour
// l'atteindre depuis le palier 1 (somme des goldCost successifs, coherent
// avec sim.ts : une amelioration se paie au prix plein du palier vise, pas
// au differentiel). Meme algorithme que apps/web/src/branches.ts (BFS depuis
// buildableTowers via upgradesTo) mais reimplemente ici, sans dependre de
// apps/web : chaque chaine de ce jeu est lineaire (jamais de fourche), donc
// un seul id par niveau de frontiere a chaque etape.
const tierOf = new Map<string, number>();
const cumulativeCostOf = new Map<string, number>();
for (const rootId of buildableTowers) {
  let frontier: string[] = [rootId];
  let tier = 1;
  let cumulative = 0;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      if (tierOf.has(id)) continue;
      const def = towers.get(id);
      if (!def) continue;
      cumulative += def.goldCost;
      tierOf.set(id, tier);
      cumulativeCostOf.set(id, cumulative);
      next.push(...def.upgradesTo);
    }
    frontier = next;
    tier += 1;
  }
}

const TOTAL_SLOTS = buildSlots(0).length;

// Un bot n'a plus de branche racine unique declaree (voir packages/sim/src/bot.ts,
// refonte de la composition) : la branche "gagnante" est desormais MESUREE sur
// l'arene du vainqueur plutot que lue sur une preference qu'il aurait annoncee —
// plus fiable, et repond directement a la question du brief ("l'Arrow Tower
// reste-t-elle > 30% des victoires ?"). Retenue : la branche dont les tours
// presentes en fin de partie representent le plus d'or investi (palier actuel).
function dominantBranch(arena: Arena): string | null {
  const goldByRoot = new Map<string, number>();
  for (const t of arena.towers) {
    const root = branchRootOf(t.defId);
    if (!root) continue;
    const cost = towers.get(t.defId)?.goldCost ?? 0;
    goldByRoot.set(root, (goldByRoot.get(root) ?? 0) + cost);
  }
  let best: string | null = null;
  let bestGold = -1;
  for (const [root, gold] of goldByRoot) {
    if (gold > bestGold) {
      bestGold = gold;
      best = root;
    }
  }
  return best;
}

const GAMES = Number(process.argv[2] ?? 50);
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const difficultyArg = process.argv[3];
if (difficultyArg && !DIFFICULTIES.includes(difficultyArg as Difficulty)) {
  throw new Error(`difficulte inconnue "${difficultyArg}" — attendu : ${DIFFICULTIES.join(', ')}`);
}
const DIFFICULTY: Difficulty = (difficultyArg as Difficulty) ?? 'medium';
// Aligne par defaut sur rules.maxPlayers (verrouille a 6, voir balance.json)
// plutot qu'une valeur recopiee ici : reste synchronise si ce format change
// un jour. Avec des envois globaux, la pression subie par joueur est
// proportionnelle au nombre d'adversaires (n-1 flux) — mesurer a 8 gonflait
// artificiellement la pression de 40% par rapport au format reel. Toujours
// parametrable pour explorer d'autres effectifs au besoin.
const PLAYER_COUNT = Number(process.argv[4] ?? rules.maxPlayers);

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
  /** Palier de CHAQUE tour encore debout, toutes arenes confondues, mesure
   * en fin de partie (victoire ou timeout) — brief : "palier median atteint". */
  standingTiers: number[];
  /** Round auquel une arene (n'importe laquelle) a la premiere atteint 317/317
   * emplacements occupes — null si jamais atteint sur cette partie (brief :
   * "avec 317 emplacements il n'arrivera probablement jamais"). */
  saturationRound: number | null;
  /** Or cumule investi (somme des couts de palier successifs, jamais le
   * differentiel — coherent avec sim.ts) dans les tours ENCORE DEBOUT en fin
   * de partie, par branche racine. N'inclut pas les tours vendues entre
   * temps (non reconstruit depuis l'historique, hors de portee sans toucher
   * packages/sim) — approximation assumee, signalee dans le rapport. */
  investedGoldByRoot: Map<string, number>;
}

function playOne(seed: number): Result {
  const s = createGame(seed, PLAYER_COUNT);
  const bots = s.arenas.map((a, i) => new Bot({ player: a.player, seed: seed + i * 7919, difficulty: DIFFICULTY }));

  let t = 0;
  let lastRound = -1;
  let saturationRound: number | null = null;
  for (; t < MAX_TICKS && !s.finished; t++) {
    const cmds: Command[] = [];
    for (const b of bots) cmds.push(...b.decide(s));
    tick(s, cmds);

    if (saturationRound === null && s.round !== lastRound) {
      lastRound = s.round;
      for (const a of s.arenas) {
        if (Object.keys(a.occupied).length >= TOTAL_SLOTS) {
          saturationRound = s.round;
          break;
        }
      }
    }
  }

  // aggression est tiree du RNG interne de chaque bot (personnalite, cf.
  // packages/sim/src/bot.ts) : on ne la lit pas depuis une config qu'on
  // aurait nous-memes calculee, mais depuis l'objet Bot du gagnant, seul a
  // la connaitre. rootOfWinner est mesure sur l'arene (voir dominantBranch
  // ci-dessus), pas declare par le bot.
  const winnerBot = s.winner !== null ? bots[s.winner] : null;
  const winnerArena = s.winner !== null ? s.arenas[s.winner] : null;

  const standingTiers: number[] = [];
  const investedGoldByRoot = new Map<string, number>();
  for (const a of s.arenas) {
    for (const twr of a.towers) {
      const tier = tierOf.get(twr.defId);
      if (tier !== undefined) standingTiers.push(tier);
      const root = branchRootOf(twr.defId);
      const cost = cumulativeCostOf.get(twr.defId);
      if (root && cost !== undefined) investedGoldByRoot.set(root, (investedGoldByRoot.get(root) ?? 0) + cost);
    }
  }

  return {
    seed,
    winner: s.winner,
    ticks: t,
    rootOfWinner: winnerArena ? dominantBranch(winnerArena) : null,
    aggressionOfWinner: winnerBot?.aggression ?? null,
    totalLeaks: s.arenas.reduce((acc, a) => acc + a.leaked, 0),
    totalBounty: s.arenas.reduce((acc, a) => acc + a.goldFromBounty, 0),
    totalIncome: s.arenas.reduce((acc, a) => acc + a.goldFromIncome, 0),
    standingTiers,
    saturationRound,
    investedGoldByRoot,
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

console.log(`difficulte : ${DIFFICULTY} — effectif : ${PLAYER_COUNT} joueurs`);
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

// --- Les 3 mesures du lot "5 paliers par branche" (voir _notes.towerEfficiency).
const allTiers = results.flatMap((r) => r.standingTiers).sort((a, b) => a - b);
const median = allTiers.length
  ? allTiers.length % 2 === 1
    ? allTiers[(allTiers.length - 1) / 2]!
    : (allTiers[allTiers.length / 2 - 1]! + allTiers[allTiers.length / 2]!) / 2
  : NaN;
console.log(
  `\npalier median atteint en fin de partie (${allTiers.length} tours mesurees, cible 4) : ${median}`,
);

const saturated = results.filter((r) => r.saturationRound !== null);
if (saturated.length) {
  const rounds = saturated.map((r) => r.saturationRound as number).sort((a, b) => a - b);
  console.log(
    `round de saturation de la carte (${TOTAL_SLOTS} emplacements) : atteint dans ${saturated.length}/${GAMES} parties, round median ${rounds[Math.floor(rounds.length / 2)]}`,
  );
} else {
  console.log(`round de saturation de la carte (${TOTAL_SLOTS} emplacements) : jamais atteint sur ${GAMES} parties`);
}

const investedTotals = new Map<string, number>();
for (const r of results) {
  for (const [root, gold] of r.investedGoldByRoot) {
    investedTotals.set(root, (investedTotals.get(root) ?? 0) + gold);
  }
}
const investedGrandTotal = [...investedTotals.values()].reduce((a, b) => a + b, 0);
console.log(`\npart de l'or investi par branche (tours encore debout en fin de partie, cout cumule par palier) :`);
for (const [root, gold] of [...investedTotals].sort((a, b) => b[1] - a[1])) {
  const name = towers.get(root)?.name ?? root;
  const share = investedGrandTotal ? (gold / investedGrandTotal) * 100 : 0;
  console.log(`  ${name.padEnd(22)} ${share.toFixed(1).padStart(5)}%`);
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
