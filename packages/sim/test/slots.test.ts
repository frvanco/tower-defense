import { describe, it, expect } from 'vitest';
import { buildSlots, nearestSlot, SLOT_SIZE, lanes, buildableTowers } from '@tower-defense/data';
import { createGame, tick } from '../src/index.js';

/**
 * Le prompt d'origine demandait de remplacer packages/sim/test/grid.test.ts,
 * qui n'existe pas dans ce depot (il n'y a pas de grille de pathing du tout —
 * voir packages/data/scripts/gen_slots.ts). Ce fichier teste directement le
 * systeme d'emplacements ecrits a la main (packages/data/src/build_slots.json).
 */

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

describe('emplacements de construction — layout', () => {
  const slots = buildSlots(0);

  it('le nombre d\'emplacements correspond aux dimensions des 4 blocs (milieu 5x22, cotes 3x12 chacun, bas 12x3)', () => {
    // Choix explicite de densite plutot que de raret (demande directe) :
    // remplace la fourchette 40-60 de la premiere version du systeme — voir
    // packages/data/scripts/gen_slots.ts.
    expect(slots.length).toBe(5 * 22 + 2 * 3 * 12 + 12 * 3);
  });

  it('deux emplacements ne se chevauchent jamais (distance >= SLOT_SIZE)', () => {
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const d = Math.hypot(slots[i]!.x - slots[j]!.x, slots[i]!.y - slots[j]!.y);
        expect(d).toBeGreaterThanOrEqual(SLOT_SIZE - 1); // -1 : tolerance d'arrondi (coords ecrites arrondies a l'unite)
      }
    }
  });

  it('au sein d\'une rangee, les emplacements sont exactement espaces de SLOT_SIZE', () => {
    const byGroup = new Map<string, typeof slots>();
    for (const s of slots) {
      if (!byGroup.has(s.groupId)) byGroup.set(s.groupId, []);
      byGroup.get(s.groupId)!.push(s);
    }
    for (const [, group] of byGroup) {
      for (let i = 1; i < group.length; i++) {
        const d = Math.hypot(group[i]!.x - group[i - 1]!.x, group[i]!.y - group[i - 1]!.y);
        expect(d).toBeCloseTo(SLOT_SIZE, 0);
      }
    }
  });

  it('aucun emplacement ne tombe sur le couloir', () => {
    const lane = lanes.find((l) => l.player === 0)!;
    const path: Array<[number, number]> = [lane.spawn, ...lane.waypoints];
    for (const s of slots) {
      let minDist = Infinity;
      for (let i = 0; i < path.length - 1; i++) {
        const [ax, ay] = path[i]!;
        const [bx, by] = path[i + 1]!;
        minDist = Math.min(minDist, distanceToSegment(s.x, s.y, ax, ay, bx, by));
      }
      expect(minDist).toBeGreaterThanOrEqual(SLOT_SIZE);
    }
  });
});

describe('emplacements de construction — en jeu', () => {
  const root = buildableTowers[0]!;

  it('un clic pres d\'un emplacement construit dessus, recentre exactement', () => {
    const s = createGame(1, 2);
    s.arenas[0]!.gold = 1000;
    const slot = buildSlots(0)[0]!;

    tick(s, [{ type: 'buildTower', player: 0, defId: root, x: slot.x + 10, y: slot.y - 5 }]);

    expect(s.arenas[0]!.towers.length).toBe(1);
    const t = s.arenas[0]!.towers[0]!;
    expect(t.x).toBe(slot.x);
    expect(t.y).toBe(slot.y);
    expect(t.slotId).toBe(slot.id);
  });

  it('un clic loin de tout emplacement est rejete', () => {
    const s = createGame(1, 2);
    s.arenas[0]!.gold = 1000;

    const events = tick(s, [{ type: 'buildTower', player: 0, defId: root, x: 0, y: 0 }]);

    expect(s.arenas[0]!.towers.length).toBe(0);
    expect(events.some((e) => e.type === 'rejected' && e.reason === 'no slot here')).toBe(true);
  });

  it('deux constructions sur le meme emplacement : la seconde est rejetee', () => {
    const s = createGame(1, 2);
    s.arenas[0]!.gold = 1000;
    const slot = buildSlots(0)[0]!;

    tick(s, [{ type: 'buildTower', player: 0, defId: root, x: slot.x, y: slot.y }]);
    const events = tick(s, [{ type: 'buildTower', player: 0, defId: root, x: slot.x, y: slot.y }]);

    expect(s.arenas[0]!.towers.length).toBe(1);
    expect(events.some((e) => e.type === 'rejected' && e.reason === 'occupied')).toBe(true);
  });

  it('vendre libere l\'emplacement', () => {
    const s = createGame(1, 2);
    s.arenas[0]!.gold = 1000;
    const slot = buildSlots(0)[0]!;

    tick(s, [{ type: 'buildTower', player: 0, defId: root, x: slot.x, y: slot.y }]);
    const eid = s.arenas[0]!.towers[0]!.eid;
    tick(s, [{ type: 'sellTower', player: 0, eid }]);
    expect(s.arenas[0]!.occupied[slot.id]).toBeUndefined();

    tick(s, [{ type: 'buildTower', player: 0, defId: root, x: slot.x, y: slot.y }]);
    expect(s.arenas[0]!.towers.length).toBe(1);
  });
});
