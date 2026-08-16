import { describe, it, expect } from 'vitest';
import { lanes, creeps, towers } from '@tower-defense/data';
import { createGame, tick, type Creep, type Tower } from '../src/index.js';
import { applyIceSlow, applyPoison, totalSlowPct, SLOW_CAP } from '../src/status.js';

function makeCreep(overrides: Partial<Creep> & { eid: number; defId: string; x: number; y: number; hp: number; wp: number }): Creep {
  return { sender: 0, ...overrides };
}

describe('ralentissement — regles de cumul', () => {
  it('meme source appliquee plusieurs fois : le ralentissement ne double pas', () => {
    const c = makeCreep({ eid: 1, defId: 'n000', x: 0, y: 0, hp: 500, wp: 0 });
    for (let i = 0; i < 20; i++) applyIceSlow(c, 0.15, 60, 0);
    expect(totalSlowPct(c, 0)).toBeCloseTo(0.15, 6);
  });

  it('une application plus faible que le ralentissement actif ne le remplace pas', () => {
    const c = makeCreep({ eid: 1, defId: 'n000', x: 0, y: 0, hp: 500, wp: 0 });
    applyIceSlow(c, 0.38, 60, 0);
    applyIceSlow(c, 0.15, 60, 0);
    expect(totalSlowPct(c, 0)).toBeCloseTo(0.38, 6);
  });

  it('une application plus forte remplace le ralentissement actif', () => {
    const c = makeCreep({ eid: 1, defId: 'n000', x: 0, y: 0, hp: 500, wp: 0 });
    applyIceSlow(c, 0.15, 60, 0);
    applyIceSlow(c, 0.38, 60, 0);
    expect(totalSlowPct(c, 0)).toBeCloseTo(0.38, 6);
  });

  it('sources differentes (Ice + Poison) : les ralentissements s\'additionnent', () => {
    const c = makeCreep({ eid: 1, defId: 'n000', x: 0, y: 0, hp: 500, wp: 0 });
    applyIceSlow(c, 0.3, 60, 0);
    applyPoison(c, 0.2, 10, 60, 0);
    expect(totalSlowPct(c, 0)).toBeCloseTo(0.5, 6);
  });

  it('le ralentissement total ne depasse jamais SLOW_CAP, meme si la somme des sources le depasserait', () => {
    const c = makeCreep({ eid: 1, defId: 'n000', x: 0, y: 0, hp: 500, wp: 0 });
    applyIceSlow(c, 0.5, 60, 0);
    applyPoison(c, 0.5, 10, 60, 0);
    expect(totalSlowPct(c, 0)).toBe(SLOW_CAP);
    expect(SLOW_CAP).toBe(0.7);
  });

  it('avec les valeurs reelles des paliers 4 (Ice 38% + Poison 25%), le total reste sous le plafond', () => {
    const iceMax = towers.get('o007')!.slow!;
    const poisonMax = towers.get('o006')!.poison!;
    const c = makeCreep({ eid: 1, defId: 'n000', x: 0, y: 0, hp: 500, wp: 0 });
    applyIceSlow(c, iceMax.pct, 60, 0);
    applyPoison(c, poisonMax.slowPct, poisonMax.dps, 60, 0);
    const total = totalSlowPct(c, 0);
    expect(total).toBeCloseTo(iceMax.pct + poisonMax.slowPct, 6);
    expect(total).toBeLessThan(SLOW_CAP);
  });

  it('le ralentissement expire : redevient nul une fois untilTick depasse', () => {
    const c = makeCreep({ eid: 1, defId: 'n000', x: 0, y: 0, hp: 500, wp: 0 });
    applyIceSlow(c, 0.3, 10, 0);
    expect(totalSlowPct(c, 5)).toBeCloseTo(0.3, 6);
    expect(totalSlowPct(c, 10)).toBe(0);
  });

  it('un creep ralenti se deplace effectivement plus lentement (integration)', () => {
    const lane = lanes.find((l) => l.player === 0)!;
    const [wx, wy] = lane.waypoints[0]!;
    // Deux creeps identiques, loin du waypoint pour ne pas l'atteindre en un tick ;
    // seul l'un des deux est ralenti.
    const slow: Creep = makeCreep({ eid: 1, defId: 'n000', x: wx - 5000, y: wy, hp: 500, wp: 0 });
    const normal: Creep = makeCreep({ eid: 2, defId: 'n000', x: wx - 5000, y: wy, hp: 500, wp: 0 });
    applyIceSlow(slow, 0.5, 1000, 0);

    const s = createGame(1, 2);
    s.arenas[0]!.creeps.push(slow, normal);
    tick(s);

    const after = s.arenas[0]!.creeps;
    const slowAfter = after.find((c) => c.eid === 1)!;
    const normalAfter = after.find((c) => c.eid === 2)!;
    const slowDist = Math.hypot(slowAfter.x - (wx - 5000), slowAfter.y - wy);
    const normalDist = Math.hypot(normalAfter.x - (wx - 5000), normalAfter.y - wy);
    expect(slowDist).toBeLessThan(normalDist);
    expect(slowDist).toBeCloseTo(normalDist * 0.5, 3);
  });
});

describe('poison — degats sur la duree', () => {
  it('un creep empoisonne qui sort de portee continue de perdre des PV', () => {
    const s = createGame(1, 2);
    const lane = lanes.find((l) => l.player === 0)!;
    const [tx, ty] = lane.waypoints[0]!; // Poison Tower (o001), portee 600
    const tower: Tower = { eid: 1, defId: 'o001', x: tx, y: ty, cooldown: 0, slotId: 'test' };
    const c: Creep = makeCreep({ eid: 1, defId: 'n000', x: tx, y: ty, hp: 10000, wp: 0 });
    s.arenas[0]!.towers.push(tower);
    s.arenas[0]!.creeps.push(c);

    tick(s); // la tour tire, applique le poison
    const afterHit = s.arenas[0]!.creeps.find((x) => x.eid === 1)!;
    expect(afterHit.poison).toBeDefined();
    const hpJustAfterHit = afterHit.hp;

    // Le creep sort largement de portee (portee de la tour = 600).
    afterHit.x = tx + 100000;
    const hpFarAway1 = afterHit.hp;

    for (let i = 0; i < 10; i++) tick(s);
    const later = s.arenas[0]!.creeps.find((x) => x.eid === 1)!;

    expect(later.hp).toBeLessThan(hpFarAway1);
    expect(later.hp).toBeLessThan(hpJustAfterHit);
  });

  it('le poison peut achever un creep : il ne reste pas bloque a 1 PV', () => {
    const s = createGame(1, 2);
    const c: Creep = makeCreep({ eid: 1, defId: 'n000', x: 0, y: 0, hp: 3, wp: 0 });
    s.arenas[0]!.creeps.push(c);
    applyPoison(c, 0.1, 90, 240, s.tick); // 90 dps, largement de quoi tuer en un tick (4.5 PV/tick)

    tick(s);

    expect(s.arenas[0]!.creeps.find((x) => x.eid === 1)).toBeUndefined();
    expect(s.arenas[0]!.killed).toBe(1);
  });

  it('le poison ignore l\'armure : memes degats sur un creep divine et un creep normal', () => {
    const s = createGame(1, 2);
    const divineDef = creeps.get('h00Y')!; // Demon Hunter, armorType divine
    const normalDef = creeps.get('h009')!; // Wolfman, armorType normal
    expect(divineDef.armorType).toBe('divine');
    expect(normalDef.armorType).toBe('normal');

    const divine: Creep = makeCreep({ eid: 1, defId: 'h00Y', x: 0, y: 0, hp: 10000, wp: 0 });
    const normal: Creep = makeCreep({ eid: 2, defId: 'h009', x: 100, y: 0, hp: 10000, wp: 0 });
    s.arenas[0]!.creeps.push(divine, normal);
    applyPoison(divine, 0, 60, 240, s.tick);
    applyPoison(normal, 0, 60, 240, s.tick);

    for (let i = 0; i < 5; i++) tick(s);

    const divineAfter = s.arenas[0]!.creeps.find((x) => x.eid === 1)!;
    const normalAfter = s.arenas[0]!.creeps.find((x) => x.eid === 2)!;
    expect(divineAfter.hp).toBeCloseTo(normalAfter.hp, 6);
    expect(divineAfter.hp).toBeLessThan(10000);
  });

  it('sur la meme cible, le poison le plus fort remplace le plus faible (pas de cumul des degats)', () => {
    const c = makeCreep({ eid: 1, defId: 'n000', x: 0, y: 0, hp: 10000, wp: 0 });
    applyPoison(c, 0.1, 8, 100, 0);
    applyPoison(c, 0.1, 20, 100, 0); // plus fort : remplace
    applyPoison(c, 0.1, 8, 100, 0); // plus faible : ignore
    expect(c.poison!.dps).toBe(20);
  });
});

describe('chaine d\'eclair (branche Lightning)', () => {
  it('rebondit sur les cibles aeriennes les plus proches, ne revient jamais sur la precedente, et respecte le nombre de rebonds', () => {
    const s = createGame(1, 2);
    const lane = lanes.find((l) => l.player === 0)!;
    const [wx, wy] = lane.waypoints[0]!;
    const def = towers.get('h005')!; // Lightning Tower : bounces=2, falloff=0.6, air only
    expect(def.chain).toEqual({ bounces: 2, falloff: 0.6 });

    // A = cible primaire (exactement sur le waypoint => selectionnee en
    // premier par le ciblage "le plus avance"). B tout pres de A. C plus
    // loin de A mais plus pres de B que ne l'est A lui-meme : sans
    // l'exclusion des cibles deja touchees, le 2e rebond depuis B
    // reviendrait sur A (distance 80) plutot que d'aller sur C (distance
    // 120). D est a portee de C (150 < CHAIN_RANGE) mais n'a plus de
    // rebond disponible (bounces=2 => 3 coups au total : A, B, C).
    const A: Creep = makeCreep({ eid: 1, defId: 'u001', x: wx, y: wy, hp: 100000, wp: 0 });
    const B: Creep = makeCreep({ eid: 2, defId: 'u001', x: wx + 80, y: wy, hp: 100000, wp: 0 });
    const C: Creep = makeCreep({ eid: 3, defId: 'u001', x: wx + 200, y: wy, hp: 100000, wp: 0 });
    const D: Creep = makeCreep({ eid: 4, defId: 'u001', x: wx + 350, y: wy, hp: 100000, wp: 0 });
    const tower: Tower = { eid: 1, defId: 'h005', x: wx, y: wy, cooldown: 0, slotId: 'test' };
    s.arenas[0]!.towers.push(tower);
    s.arenas[0]!.creeps.push(A, B, C, D);

    tick(s);

    const after = s.arenas[0]!.creeps;
    const a = after.find((c) => c.eid === 1)!;
    const b = after.find((c) => c.eid === 2)!;
    const c = after.find((c) => c.eid === 3)!;
    const d = after.find((c) => c.eid === 4)!;

    const dmgA = 100000 - a.hp;
    const dmgB = 100000 - b.hp;
    const dmgC = 100000 - c.hp;
    const dmgD = 100000 - d.hp;

    expect(dmgA).toBeGreaterThan(0);
    expect(dmgB).toBeGreaterThan(0);
    expect(dmgC).toBeGreaterThan(0); // preuve que la chaine n'est pas revenue sur A
    expect(dmgD).toBe(0); // hors budget de rebonds, meme si a portee de C

    // Degats decroissants par palier (facteur^n), donc strictement decroissants ici.
    expect(dmgB).toBeLessThan(dmgA);
    expect(dmgC).toBeLessThan(dmgB);
  });

  it('le nombre de rebonds et le facteur suivent le palier de la tour', () => {
    const t1 = towers.get('h005')!.chain!;
    const t2 = towers.get('h006')!.chain!;
    const t3 = towers.get('h007')!.chain!;
    const t4 = towers.get('h011')!.chain!;
    expect([t1.bounces, t2.bounces, t3.bounces, t4.bounces]).toEqual([2, 3, 4, 6]);
    expect([t1.falloff, t2.falloff, t3.falloff, t4.falloff]).toEqual([0.6, 0.68, 0.75, 0.82]);
  });

  it('la chaine ne rebondit que sur des cibles aeriennes (branche air uniquement)', () => {
    const s = createGame(1, 2);
    const lane = lanes.find((l) => l.player === 0)!;
    const [wx, wy] = lane.waypoints[0]!;
    const air: Creep = makeCreep({ eid: 1, defId: 'u001', x: wx, y: wy, hp: 100000, wp: 0 });
    const ground: Creep = makeCreep({ eid: 2, defId: 'n000', x: wx + 50, y: wy, hp: 100000, wp: 0 }); // plus proche que tout autre, mais au sol
    const tower: Tower = { eid: 1, defId: 'h005', x: wx, y: wy, cooldown: 0, slotId: 'test' };
    s.arenas[0]!.towers.push(tower);
    s.arenas[0]!.creeps.push(air, ground);

    tick(s);

    const groundAfter = s.arenas[0]!.creeps.find((c) => c.eid === 2)!;
    expect(groundAfter.hp).toBe(100000); // jamais touche, ni comme cible primaire ni par rebond
  });
});
