import { lanes, rules, SLOT_SIZE, builderStart, laneCorridor, inCorridor, type Rect } from '@tower-defense/data';
import { TICK_RATE, secToTicks, type Arena, type Builder, type GameState } from './types.js';

/**
 * L'ouvrier : un par arene, qui doit se rendre sur place avant qu'une tour
 * n'apparaisse. Le temps de trajet EST la mecanique — voir types.ts#Builder
 * pour la forme de l'etat, et sim.ts#applyCommand pour l'entree dans la file.
 *
 * Deterministe par construction : aucun Math.random, aucune horloge, aucune
 * iteration de Map. La file est une FIFO jamais reordonnee, donc il n'y a
 * aucune egalite a departager. Les positions sont des flottants avances par
 * `vitesse / TICK_RATE`, exactement comme moveCreeps (sim.ts).
 */

/** Le couloir de chaque arene, calcule une seule fois : la geometrie des
 * lanes est fixe pour toute la duree du processus. */
const corridorByPlayer: Rect[][] = lanes.map((lane) => laneCorridor(lane));

/** Distance a laquelle le builder s'immobilise du CENTRE de l'emplacement :
 * la demi-case plus son propre rayon, pour qu'il se tienne au bord et non sur
 * la case, qui va accueillir un batiment. */
function stopDistance(): number {
  return SLOT_SIZE / 2 + rules.builderRadius;
}

export function createBuilder(player: number): Builder {
  const lane = lanes[player];
  const [x, y] = lane ? builderStart(lane) : [0, 0];
  return { x, y, facing: 0, queue: [], mode: 'idle', buildTicksLeft: 0 };
}

/**
 * Un tick de builder. Appele depuis la boucle d'arenes de tick() (sim.ts),
 * dont l'ordre est l'index d'arene — donc stable.
 */
export function updateBuilder(s: GameState, arena: Arena): void {
  const b = arena.builder;

  // Construction en cours : rien d'autre ne peut l'interrompre, pas meme une
  // annulation (voir cancelBuildQueue dans sim.ts).
  if (b.mode === 'building') {
    b.buildTicksLeft -= 1;
    if (b.buildTicksLeft > 0) return;
    const order = b.queue.shift();
    b.mode = 'idle';
    if (!order) return;
    // L'emplacement est deja reserve dans arena.occupied depuis la
    // planification : rien a marquer ici, la tour ne fait qu'y apparaitre.
    arena.towers.push({
      eid: s.nextEid++,
      defId: order.defId,
      x: order.x,
      y: order.y,
      cooldown: 0,
      slotId: order.slotId,
    });
    return;
  }

  const order = b.queue[0];
  if (!order) {
    // File vide : il reste EXACTEMENT la ou il a fini. Aucun retour a une
    // position de repos — c'est ce qui donne au joueur un moyen indirect de
    // placer son ouvrier, par l'ordre dans lequel il construit.
    b.mode = 'idle';
    return;
  }

  const dx = order.x - b.x;
  const dy = order.y - b.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  // Cap conserve tel quel quand il est deja sur place : sans ca l'orientation
  // du rendu sauterait a l'arrivee.
  if (d > 0) b.facing = Math.atan2(dy, dx);

  // Le SEUL obstacle est le couloir des creeps, teste sur sa geometrie fixe
  // (packages/data) — jamais sur une notion de "builder bloque", qui n'existe
  // pas : les tours se traversent, delibere. La marge sert de piste de
  // decollage, donc un trajet qui recoupe le couloir plusieurs fois redecolle
  // a chaque fois, sans etat a conserver entre les ticks.
  const corridor = corridorByPlayer[arena.player] ?? [];
  const flying = inCorridor(corridor, b.x, b.y, rules.builderFlyMargin);
  const speed = flying ? rules.builderFlySpeed : rules.builderGroundSpeed;
  const step = speed / TICK_RATE;

  const stop = stopDistance();
  // Arrivee testee AVANT de bouger, et position posee en ABSOLU depuis la
  // cible. Avancer d'un pas tronque a `d - stop` ne converge pas : en virgule
  // flottante le point d'arrivee retombe a stop + epsilon, le pas suivant vaut
  // epsilon, et le builder rampe indefiniment sans jamais satisfaire `d <= stop`.
  if (d - stop <= step) {
    // d == 0 (deja pile sur le centre de la case) rendrait dx/d indefini : on
    // garde alors la position telle quelle, il n'y a aucune direction a suivre.
    if (d > 0) {
      b.x = order.x - (dx / d) * stop;
      b.y = order.y - (dy / d) * stop;
    }
    b.mode = 'building';
    b.buildTicksLeft = secToTicks(rules.builderBuildSec);
    return;
  }

  b.mode = flying ? 'flying' : 'moving';
  b.x += (dx / d) * step;
  b.y += (dy / d) * step;
}
