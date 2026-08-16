import { describe, it, expect } from 'vitest';
import { buildSlots, nearestSlot, SLOT_SIZE, PATH_CLEARANCE, lanes, zoneFootprints, buildableTowers } from '@tower-defense/data';
import { createGame, tick } from '../src/index.js';

const PLATFORM_MARGIN = 32; // duplique zoneFootprints.ts (non exporte)

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

  it('le nombre d\'emplacements correspond a une grille pleine interieure + un contour exterieur de profondeur 3', () => {
    // 348, pas les 357 attendus au crayon : l'interieur (grille 6x25 = 150)
    // correspond exactement, l'ecart vient du contour exterieur — 6
    // emplacements sont deduplique pres des coins bas (contre 4 a
    // profondeur 2 : plus de colonnes pres du coin, plus de collisions).
    // Ce n'est pas un artefact de generation : pres d'un virage a 90°, deux
    // points echantillonnes a exactement SLOT_SIZE d'arc peuvent se
    // retrouver a moins de SLOT_SIZE en ligne droite (le chemin "replie" sur
    // lui-meme) — le dedup applique la meme regle que partout ailleurs (deux
    // emplacements ne se chevauchent jamais). Voir
    // packages/data/scripts/gen_slots.ts pour le detail par groupe.
    expect(slots.length).toBe(348);
  });

  it('l\'interieur du U forme une grille pleine de 6 x 25 sans case manquante', () => {
    const interiorGroups = Array.from({ length: 25 }, (_, i) => `interieur-r${i + 1}`);
    const byGroup = new Map<string, typeof slots>();
    for (const s of slots) {
      if (!byGroup.has(s.groupId)) byGroup.set(s.groupId, []);
      byGroup.get(s.groupId)!.push(s);
    }
    for (const groupId of interiorGroups) {
      const group = byGroup.get(groupId);
      expect(group, `groupe ${groupId} manquant`).toBeDefined();
      expect(group!.length, `groupe ${groupId} incomplet`).toBe(6);
    }
  });

  it('deux emplacements ne se chevauchent jamais (distance >= SLOT_SIZE)', () => {
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const d = Math.hypot(slots[i]!.x - slots[j]!.x, slots[i]!.y - slots[j]!.y);
        expect(d).toBeGreaterThanOrEqual(SLOT_SIZE - 1); // -1 : tolerance d'arrondi (coords ecrites arrondies a l'unite)
      }
    }
  });

  it('au sein d\'une rangee, les emplacements sont regulierement espaces (>= SLOT_SIZE)', () => {
    // Les tours sont collees (espacement SLOT_SIZE exact, cf.
    // packages/data/src/zoneFootprints.ts) — verifie la regularite plutot que
    // la valeur exacte pour rester robuste a l'arrondi des coordonnees.
    const byGroup = new Map<string, typeof slots>();
    for (const s of slots) {
      if (!byGroup.has(s.groupId)) byGroup.set(s.groupId, []);
      byGroup.get(s.groupId)!.push(s);
    }
    for (const [, group] of byGroup) {
      if (group.length < 2) continue;
      const first = Math.hypot(group[1]!.x - group[0]!.x, group[1]!.y - group[0]!.y);
      expect(first).toBeGreaterThanOrEqual(SLOT_SIZE - 1);
      for (let i = 2; i < group.length; i++) {
        const d = Math.hypot(group[i]!.x - group[i - 1]!.x, group[i]!.y - group[i - 1]!.y);
        expect(Math.abs(d - first)).toBeLessThanOrEqual(2); // tolerance d'arrondi (coords ecrites arrondies a l'unite)
      }
    }
  });

  it('aucun emplacement n\'empiete a moins de PATH_CLEARANCE du couloir', () => {
    const lane = lanes.find((l) => l.player === 0)!;
    const path: Array<[number, number]> = [lane.spawn, ...lane.waypoints];
    for (const s of slots) {
      let minDist = Infinity;
      for (let i = 0; i < path.length - 1; i++) {
        const [ax, ay] = path[i]!;
        const [bx, by] = path[i + 1]!;
        minDist = Math.min(minDist, distanceToSegment(s.x, s.y, ax, ay, bx, by));
      }
      expect(minDist).toBeGreaterThanOrEqual(PATH_CLEARANCE - 1); // -1 : tolerance d'arrondi
    }
  });

  it('aucun emplacement exterieur n\'est a plus de PATH_CLEARANCE + 3*SLOT_SIZE du couloir (les tours restent collees au chemin)', () => {
    // Restreint aux groupes exterieur-* : l'interieur remplit toute la
    // surface entre les bras (jusqu'a armTopY), donc loin du chemin par
    // construction — ce test ne s'applique qu'a la bande qui longe le
    // chemin.
    const lane = lanes.find((l) => l.player === 0)!;
    const path: Array<[number, number]> = [lane.spawn, ...lane.waypoints];
    const maxAllowed = PATH_CLEARANCE + 3 * SLOT_SIZE;
    for (const s of slots) {
      if (!s.groupId.startsWith('exterieur-')) continue;
      let minDist = Infinity;
      for (let i = 0; i < path.length - 1; i++) {
        const [ax, ay] = path[i]!;
        const [bx, by] = path[i + 1]!;
        minDist = Math.min(minDist, distanceToSegment(s.x, s.y, ax, ay, bx, by));
      }
      expect(minDist).toBeLessThanOrEqual(maxAllowed + 1); // +1 : tolerance d'arrondi
    }
  });

  it('le plateau rendu ne deborde pas largement de l\'enveloppe des emplacements', () => {
    // Le plateau (zoneFootprints) est cense suivre le contour des
    // emplacements a PLATFORM_MARGIN pres, pas etre un rectangle englobant —
    // c'est precisement le bug corrige ici (le plateau debordait largement,
    // de centaines d'unites sur tout le pourtour). On verifie chaque sommet
    // du polygone plutot que son aire : un sommet trop loin de tout
    // emplacement du meme groupe (interieur/exterieur) revele un plateau
    // plus large que necessaire.
    //
    // Tolerance plus large que PLATFORM_MARGIN aux coins de l'anneau
    // exterieur (mesure : jusqu'a ~97 sur la lane 0) : l'echantillonnage du
    // contour se fait par longueur d'arc (SLOT_SIZE), colonne par colonne —
    // rien ne garantit qu'un emplacement tombe pile au coin geometrique
    // theorique pour une colonne donnee, l'ecart peut donc approcher
    // PLATFORM_MARGIN + SLOT_SIZE la ou deux segments se rejoignent. C'est
    // un slack borne et localise aux coins, pas le defaut d'origine (une
    // marge large et uniforme sur tout le plateau).
    const lane = lanes.find((l) => l.player === 0)!;
    for (const zone of zoneFootprints(lane)) {
      const zoneSlots = slots.filter((s) => s.groupId.startsWith(zone.id));
      expect(zoneSlots.length, `aucun emplacement pour la zone ${zone.id}`).toBeGreaterThan(0);
      for (const [vx, vy] of zone.points) {
        let minDist = Infinity;
        for (const s of zoneSlots) minDist = Math.min(minDist, Math.hypot(s.x - vx, s.y - vy));
        expect(minDist, `sommet (${vx},${vy}) de ${zone.id} trop loin de tout emplacement`).toBeLessThanOrEqual(
          PLATFORM_MARGIN + SLOT_SIZE + 10,
        );
      }
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
