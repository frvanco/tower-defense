import { describe, it, expect } from 'vitest';
import {
  buildSlots,
  buildableTowers,
  lanes,
  rules,
  towers,
  SLOT_SIZE,
  builderStart,
  laneCorridor,
  inCorridor,
} from '@tower-defense/data';
import { createGame, tick, hashState, secToTicks, type GameState } from '../src/index.js';
import { drainBuilder } from './helpers.js';

const root = buildableTowers[0]!;
const rootCost = towers.get(root)!.goldCost;

/** Partie isolee : de l'or a volonte, aucun versement d'income pendant le
 * test (sinon l'or mesure apres un remboursement melangerait les deux). */
function game(gold = 1_000_000): GameState {
  const s = createGame(7, 2);
  s.nextRoundAt = 10_000_000;
  s.arenas[0]!.gold = gold;
  return s;
}

const slots = buildSlots(0);
const inner = slots.filter((sl) => sl.groupId.startsWith('interieur-'));
const outerBottom = slots.filter((sl) => sl.groupId.startsWith('exterieur-bas-'));

/** Emplacement interieur le PLUS LOIN du connecteur : l'atteindre depuis le
 * point de depart oblige a franchir le couloir, et le point d'arrivee est
 * franchement de l'autre cote (pas a cheval sur le bord, cas traite a part). */
const innerSlot = inner.reduce((a, b) => (b.y > a.y ? b : a));
/** Emplacement interieur le PLUS PROCHE du chemin — sert au cas limite ou
 * l'anneau d'arret mord sur le ruban. */
const nearPathSlot = inner.reduce((a, b) => (b.y < a.y ? b : a));
/** Bande exterieure basse : du meme cote que le point de depart, aucun
 * franchissement. */
const outerBottomSlot = outerBottom.reduce((a, b) => (b.y < a.y ? b : a));

function build(s: GameState, slot: { x: number; y: number }) {
  return tick(s, [{ type: 'buildTower', player: 0, defId: root, x: slot.x, y: slot.y }]);
}

describe('builder — position de depart', () => {
  it('part du centre de la carte, dans la bande verte sous le connecteur', () => {
    const s = game();
    const b = s.arenas[0]!.builder;
    const lane = lanes[0]!;
    const [x, y] = builderStart(lane);
    expect([b.x, b.y]).toEqual([x, y]);

    // Centre EXACT entre les deux bras du U.
    const midX = (lane.waypoints[1]![0] + lane.waypoints[2]![0]) / 2;
    expect(b.x).toBeCloseTo(midX, 6);
    // Sous le connecteur (le connecteur est le Y le plus bas du U), et hors
    // du couloir : le builder ne demarre jamais les pieds sur le chemin.
    expect(b.y).toBeLessThan(lane.waypoints[1]![1]);
    expect(inCorridor(laneCorridor(lane), b.x, b.y, 0)).toBe(false);
  });

  it('chaque joueur part du meme point relatif dans SA propre arene', () => {
    const s = createGame(7, 6);
    for (let p = 0; p < 6; p++) {
      const lane = lanes[p]!;
      const [x, y] = builderStart(lane);
      expect([s.arenas[p]!.builder.x, s.arenas[p]!.builder.y]).toEqual([x, y]);
    }
    // Les arenes sont des copies translatees : les ecarts au spawn de chaque
    // lane doivent etre identiques d'un joueur a l'autre.
    const offsets = s.arenas.map((a) => [a.builder.x - lanes[a.player]!.spawn[0], a.builder.y - lanes[a.player]!.spawn[1]]);
    for (const o of offsets) expect(o).toEqual(offsets[0]);
  });
});

describe('builder — file de construction et or', () => {
  it('debite l or au clic, et la tour n existe pas encore', () => {
    const s = game(1000);
    build(s, outerBottomSlot);
    const a = s.arenas[0]!;

    expect(a.gold).toBe(1000 - rootCost);
    expect(a.towers).toHaveLength(0);
    expect(a.builder.queue).toHaveLength(1);
    // L'emplacement est reserve des la planification.
    expect(a.occupied[outerBottomSlot.id]).toBe(true);
  });

  it('la tour apparait a la fin de la construction, pas avant', () => {
    const s = game();
    build(s, outerBottomSlot);
    drainBuilder(s);
    const a = s.arenas[0]!;

    expect(a.towers).toHaveLength(1);
    expect(a.towers[0]!.slotId).toBe(outerBottomSlot.id);
    expect(a.towers[0]!.x).toBe(outerBottomSlot.x);
    expect(a.builder.queue).toHaveLength(0);
    expect(a.builder.mode).toBe('idle');
  });

  it('refuse le clic au-dela du plafond, sans rien debiter', () => {
    const s = game();
    const free = slots.filter((sl) => sl.groupId.startsWith('exterieur-bas-')).slice(0, rules.builderQueueMax + 1);
    expect(free.length).toBe(rules.builderQueueMax + 1);

    for (const sl of free.slice(0, rules.builderQueueMax)) build(s, sl);
    const a = s.arenas[0]!;
    expect(a.builder.queue).toHaveLength(rules.builderQueueMax);

    const goldBefore = a.gold;
    const events = build(s, free[rules.builderQueueMax]!);

    expect(events.some((e) => e.type === 'rejected' && e.reason === 'build queue full')).toBe(true);
    expect(a.gold).toBe(goldBefore);
    expect(a.builder.queue).toHaveLength(rules.builderQueueMax);
    expect(a.occupied[free[rules.builderQueueMax]!.id]).toBeUndefined();
  });

  it('le temps de construction est le meme pour la tour la moins chere et la plus chere', () => {
    const expensive = [...towers.values()].filter((d) => buildableTowers.includes(d.id)).sort((x, y) => y.goldCost - x.goldCost)[0]!;
    const durations = [root, expensive.id].map((defId) => {
      const s = game();
      tick(s, [{ type: 'buildTower', player: 0, defId, x: outerBottomSlot.x, y: outerBottomSlot.y }]);
      let ticks = 0;
      while (s.arenas[0]!.builder.mode !== 'building') {
        tick(s);
        ticks++;
      }
      let building = 0;
      while (s.arenas[0]!.towers.length === 0) {
        tick(s);
        building++;
      }
      return building;
    });
    expect(durations[0]).toBe(durations[1]);
    expect(durations[0]).toBe(secToTicks(rules.builderBuildSec));
  });
});

describe('builder — annulation', () => {
  it('rembourse a 100% les constructions planifiees et libere leurs emplacements', () => {
    const s = game(1000);
    const targets = slots.filter((sl) => sl.groupId.startsWith('exterieur-bas-')).slice(0, 3);
    for (const sl of targets) build(s, sl);
    const a = s.arenas[0]!;
    expect(a.gold).toBe(1000 - 3 * rootCost);

    tick(s, [{ type: 'cancelBuildQueue', player: 0 }]);

    // Le builder n'a pas encore atteint sa cible : les trois sont annulees.
    expect(a.builder.queue).toHaveLength(0);
    expect(a.gold).toBe(1000);
    for (const sl of targets) expect(a.occupied[sl.id]).toBeUndefined();
    expect(a.towers).toHaveLength(0);
  });

  it('laisse se terminer la construction en cours, sans la rembourser', () => {
    const s = game(1000);
    const targets = slots.filter((sl) => sl.groupId.startsWith('exterieur-bas-')).slice(0, 3);
    for (const sl of targets) build(s, sl);
    const a = s.arenas[0]!;

    // Laisse le builder arriver et COMMENCER la premiere.
    while (a.builder.mode !== 'building') tick(s);
    const goldBefore = a.gold;

    tick(s, [{ type: 'cancelBuildQueue', player: 0 }]);
    expect(a.builder.queue).toHaveLength(1);
    expect(a.gold).toBe(goldBefore + 2 * rootCost); // 2 annulees, celle en cours non remboursee
    expect(a.occupied[targets[0]!.id]).toBe(true);
    expect(a.occupied[targets[1]!.id]).toBeUndefined();

    drainBuilder(s);
    expect(a.towers).toHaveLength(1);
    expect(a.towers[0]!.slotId).toBe(targets[0]!.id);
  });
});

describe('builder — deplacement', () => {
  it('s arrete au BORD de l emplacement, jamais dessus', () => {
    const s = game();
    build(s, outerBottomSlot);
    drainBuilder(s);
    const b = s.arenas[0]!.builder;

    const d = Math.hypot(b.x - outerBottomSlot.x, b.y - outerBottomSlot.y);
    expect(d).toBeCloseTo(SLOT_SIZE / 2 + rules.builderRadius, 6);
  });

  it('reste exactement la ou il a construit, sans retour a une position de repos', () => {
    const s = game();
    build(s, outerBottomSlot);
    drainBuilder(s);
    const b = s.arenas[0]!.builder;
    const resting = [b.x, b.y];

    for (let i = 0; i < 200; i++) tick(s);
    expect([b.x, b.y]).toEqual(resting);
    expect(b.mode).toBe('idle');
  });

  it('survole le couloir quand le trajet le croise, et marche sinon', () => {
    // Vers l'interieur du U : le segment coupe forcement le connecteur.
    const crossing = game();
    build(crossing, innerSlot);
    const modes = new Set<string>();
    for (let i = 0; i < 3000 && crossing.arenas[0]!.builder.mode !== 'building'; i++) {
      tick(crossing);
      modes.add(crossing.arenas[0]!.builder.mode);
    }
    expect(modes.has('flying')).toBe(true);
    expect(modes.has('moving')).toBe(true);

    // Vers la bande basse : meme cote que le depart, aucun franchissement.
    const straight = game();
    build(straight, outerBottomSlot);
    const straightModes = new Set<string>();
    for (let i = 0; i < 3000 && straight.arenas[0]!.builder.mode !== 'building'; i++) {
      tick(straight);
      straightModes.add(straight.arenas[0]!.builder.mode);
    }
    expect(straightModes.has('flying')).toBe(false);
  });

  it('redecolle a chaque franchissement d un trajet qui recoupe le couloir', () => {
    // Interieur du U -> bande basse : le retour recoupe le connecteur, donc le
    // builder vole, se pose, puis vole a nouveau sur le trajet suivant.
    const s = game();
    build(s, innerSlot);
    drainBuilder(s);

    // Retour vers la rangee exterieure la plus basse : le builder repasse
    // au-dessus du connecteur, puis se repose franchement au-dela.
    build(s, outerBottomSlot);
    let landedAfterFlight = false;
    let flew = false;
    for (let i = 0; i < 3000 && s.arenas[0]!.builder.mode !== 'building'; i++) {
      tick(s);
      const m = s.arenas[0]!.builder.mode;
      if (m === 'flying') flew = true;
      if (flew && m === 'moving') landedAfterFlight = true;
    }
    expect(flew).toBe(true);
    expect(landedAfterFlight).toBe(true);
  });

  it('ne traverse jamais le couloir a pied', () => {
    // L'invariant porte sur le DEPLACEMENT : au-dessus du ruban, le builder
    // est toujours en vol, jamais en marche. Il peut en revanche s'y tenir
    // immobile pour construire une case qui le borde (test suivant).
    const corridor = laneCorridor(lanes[0]!);
    for (const target of [innerSlot, nearPathSlot]) {
      const s = game();
      build(s, target);
      for (let i = 0; i < 3000 && s.arenas[0]!.towers.length === 0; i++) {
        tick(s);
        const b = s.arenas[0]!.builder;
        if (inCorridor(corridor, b.x, b.y, 0)) {
          expect(b.mode, `a pied sur le couloir en (${b.x}, ${b.y})`).not.toBe('moving');
        }
      }
    }
  });

  it('construit la rangee qui borde le chemin en se tenant sur le bord du ruban', () => {
    // Consequence ASSUMEE de la geometrie : PATH_CLEARANCE (84, mesure depuis
    // l'axe) place la premiere rangee a 39 unites du bord du ruban, alors que
    // la distance d'arret vaut 49.6. Le builder deborde donc d'une dizaine
    // d'unites sur le chemin pour cette rangee-la — soit environ un tiers de
    // son propre rayon. Rien ne l'en empeche : les creeps ne peuvent pas le
    // perturber, et il ne les gene pas. Documente ici pour que ce ne soit pas
    // pris pour un bug plus tard.
    const s = game();
    build(s, nearPathSlot);
    drainBuilder(s);
    const b = s.arenas[0]!.builder;
    expect(s.arenas[0]!.towers).toHaveLength(1);
    expect(inCorridor(laneCorridor(lanes[0]!), b.x, b.y, 0)).toBe(true);
    expect(b.mode).toBe('idle');
  });
});

describe('builder — determinisme', () => {
  it('meme graine, memes positions de builder a la fin', () => {
    const run = (): Array<[number, number, string]> => {
      const s = createGame(4242, 6);
      const targets = slots.filter((sl) => sl.groupId.startsWith('interieur-')).slice(0, 4);
      for (const a of s.arenas) a.gold = 1_000_000;
      for (const sl of targets) {
        tick(s, s.arenas.map((a) => ({ type: 'buildTower' as const, player: a.player, defId: root, x: sl.x, y: sl.y })));
      }
      for (let i = 0; i < 1500; i++) tick(s);
      return s.arenas.map((a) => [a.builder.x, a.builder.y, a.builder.mode]);
    };
    expect(run()).toEqual(run());
  });

  it('le builder entre dans l empreinte d etat', () => {
    const a = game();
    const b = game();
    expect(hashState(b)).toBe(hashState(a));
    build(a, outerBottomSlot);
    for (let i = 0; i < 10; i++) tick(a);
    for (let i = 0; i < 11; i++) tick(b);
    // Meme nombre de ticks, mais l'un a un ouvrier en chemin : les empreintes
    // doivent differer, sinon l'etat du builder ne serait pas hashe.
    expect(hashState(b)).not.toBe(hashState(a));
  });
});
