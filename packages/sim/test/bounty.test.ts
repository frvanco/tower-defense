import { describe, it, expect } from 'vitest';
import { rules, creeps, lanes } from '@tower-defense/data';
import { createGame, tick, type Creep } from '../src/index.js';

function makeCreep(overrides: Partial<Creep> & { eid: number; defId: string; x: number; y: number; hp: number; wp: number }): Creep {
  return { sender: 0, ...overrides };
}

describe('prime de mise a mort', () => {
  it('le taux est defini dans les donnees, a 5%', () => {
    expect(rules.bountyPct).toBe(0.05);
  });

  it('tuer un creep credite le proprietaire de l\'arene ou il meurt, pas l\'envoyeur', () => {
    const s = createGame(1, 3);
    const defender = s.arenas[0]!;
    // Le creep est "envoye" par le joueur 2 (sender) mais il meurt dans
    // l'arene du joueur 0 : c'est le joueur 0 qui doit etre credite.
    const c = makeCreep({ eid: 1, defId: 'n000', x: 0, y: 0, hp: -1, wp: 0, sender: 2 });
    defender.creeps.push(c);
    const goldBefore = defender.gold;
    const sender = s.arenas[2]!;
    const senderGoldBefore = sender.gold;

    tick(s);

    expect(defender.gold).toBeGreaterThan(goldBefore);
    expect(sender.gold).toBe(senderGoldBefore);
  });

  it('un creep qui atteint la fin du parcours (leak) ne credite personne', () => {
    const s = createGame(1, 2);
    const arena = s.arenas[0]!;
    const lane = lanes.find((l) => l.player === 0)!;
    const lastWp = lane.waypoints.length - 1;
    const [lx, ly] = lane.waypoints[lastWp]!;
    // Place exactement sur le dernier waypoint : arrive au bout des le premier tick.
    const c = makeCreep({ eid: 1, defId: 'n000', x: lx, y: ly, hp: 500, wp: lastWp });
    arena.creeps.push(c);
    const goldBefore = arena.gold;

    tick(s);

    expect(arena.leaked).toBe(1);
    expect(arena.gold).toBe(goldBefore);
    expect(arena.goldFromBounty).toBe(0);
  });

  it('la prime vaut 5% du cout, arrondie a l\'entier superieur, minimum 1', () => {
    const s = createGame(1, 2);
    const arena = s.arenas[0]!;
    const def = creeps.get('n000')!;
    const expectedBounty = Math.max(1, Math.ceil(def.goldCost * 0.05));

    const c = makeCreep({ eid: 1, defId: 'n000', x: 0, y: 0, hp: -1, wp: 0 });
    arena.creeps.push(c);
    const goldBefore = arena.gold;

    tick(s);

    expect(arena.gold - goldBefore).toBe(expectedBounty);
    expect(arena.goldFromBounty).toBe(expectedBounty);
  });

  it('un creep engendre a la mort d\'un autre (Porte-essaim) ne rapporte rien lui-meme', () => {
    const s = createGame(1, 2);
    const arena = s.arenas[0]!;
    const porteEssaim = creeps.get('u00B')!; // Porte-essaim, spawnsOnDeath -> h00Y x4
    expect(porteEssaim.spawnsOnDeath).not.toBeNull();

    const c = makeCreep({ eid: 1, defId: 'u00B', x: 0, y: 0, hp: -1, wp: 0 });
    arena.creeps.push(c);
    tick(s); // le porte-essaim meurt, engendre 4 drones d'essaim, paie sa propre prime

    const porteEssaimBounty = Math.max(1, Math.ceil(porteEssaim.goldCost * 0.05));
    expect(arena.goldFromBounty).toBe(porteEssaimBounty);
    const spawned = arena.creeps.filter((x) => x.defId === 'h00Y');
    expect(spawned.length).toBe(4);
    expect(spawned.every((x) => x.freeSpawn === true)).toBe(true);

    // Tuer les 4 creeps engendres ne doit ajouter aucune prime supplementaire.
    for (const x of spawned) x.hp = -1;
    tick(s);
    expect(arena.goldFromBounty).toBe(porteEssaimBounty);
  });

  it('un creep tue par le poison (degats sur la duree) rapporte bien la prime', () => {
    const s = createGame(1, 2);
    const arena = s.arenas[0]!;
    const c = makeCreep({ eid: 1, defId: 'n000', x: 0, y: 0, hp: 1, wp: 0 });
    arena.creeps.push(c);
    // Poison applique directement (contourne le tir d'une tour), degats
    // largement suffisants pour tuer au premier tick de poison.
    c.poison = { pct: 0.1, dps: 90, untilTick: 1000 };

    tick(s);

    expect(arena.creeps.find((x) => x.eid === 1)).toBeUndefined();
    const expectedBounty = Math.max(1, Math.ceil(creeps.get('n000')!.goldCost * 0.05));
    expect(arena.goldFromBounty).toBe(expectedBounty);
  });

  it('un creep tue par une attaque de zone ne rapporte la prime qu\'une seule fois', () => {
    const s = createGame(1, 2);
    const arena = s.arenas[0]!;
    // Deux creeps groupes, un seul coup de zone qui tue les deux : chacun
    // doit payer sa propre prime, une fois chacun (pas de doublon, pas d'oubli).
    const a = makeCreep({ eid: 1, defId: 'n000', x: 0, y: 0, hp: 1, wp: 0 });
    const b = makeCreep({ eid: 2, defId: 'n000', x: 10, y: 0, hp: 1, wp: 0 });
    arena.creeps.push(a, b);
    // Frappe de zone simulee directement : les deux meurent au meme tick.
    a.hp = -100;
    b.hp = -100;

    tick(s);

    const expectedEach = Math.max(1, Math.ceil(creeps.get('n000')!.goldCost * 0.05));
    expect(arena.goldFromBounty).toBe(expectedEach * 2);
    expect(arena.creeps.length).toBe(0);
  });

  it('un joueur elimine ne recoit plus de prime', () => {
    const s = createGame(1, 2);
    const arena = s.arenas[0]!;
    arena.alive = false;
    arena.gold = 0;
    const c = makeCreep({ eid: 1, defId: 'n000', x: 0, y: 0, hp: -1, wp: 0 });
    arena.creeps.push(c);

    tick(s);

    expect(arena.gold).toBe(0);
    expect(arena.goldFromBounty).toBe(0);
    // L'arene entiere est ignoree une fois eliminee : le creep n'est meme pas traite.
    expect(arena.creeps.length).toBe(1);
  });
});
