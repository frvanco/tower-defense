import { tick, type GameState } from '../src/index.js';

/**
 * Laisse l'ouvrier vider sa file de construction.
 *
 * Depuis l'ajout du builder, une commande `buildTower` acceptee ne cree pas la
 * tour : elle entre dans une file, et l'ouvrier doit se rendre sur place avant
 * qu'elle n'apparaisse (packages/sim/src/builder.ts). Les tests qui portent sur
 * AUTRE CHOSE que ce delai — plafonds, emplacements, choix des bots — mesurent
 * donc apres cet appel. Le delai lui-meme est teste dans builder.test.ts.
 *
 * Un tick sans commande ne fait decider aucun bot : le rythme de decision d'un
 * bot sous test n'est pas perturbe par l'ecoulement de la file.
 */
export function drainBuilder(state: GameState, player = 0, maxTicks = 3000): void {
  for (let i = 0; i < maxTicks; i++) {
    const b = state.arenas[player]!.builder;
    if (b.queue.length === 0 && b.mode === 'idle') return;
    tick(state);
  }
  throw new Error(`l'ouvrier du joueur ${player} n'a pas vide sa file en ${maxTicks} ticks`);
}
