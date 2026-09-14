import { describe, it, expect } from 'vitest';
import { buildSlots, nearestSlot, SLOT_SIZE, PATH_CLEARANCE, lanes, zoneFootprints, buildableTowers } from '@tower-defense/data';
import { createGame, tick } from '../src/index.js';
import { drainBuilder } from './helpers.js';

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
    // Instantane, entierement determine par SLOT_SIZE : la zone constructible
    // est fixe, donc plus les emplacements sont ecartes, moins il y en a.
    // 317 a SLOT_SIZE = 64 ; 236 depuis le passage a 80 (choix de game design
    // assume — moins de tours par arene, mais chacune sensiblement plus
    // grande, voir zoneFootprints.ts). Regenerer build_slots.json avec
    // packages/data/scripts/gen_slots.ts apres tout changement de SLOT_SIZE,
    // puis mettre ce nombre a jour avec celui qu'il affiche.
    expect(slots.length).toBe(236);
  });

  it('l\'interieur du U forme une grille pleine et rectangulaire, sans case manquante', () => {
    // Ne fige plus les dimensions (c'etait 5 x 25 a SLOT_SIZE = 64, 4 x 20 a
    // 80) : ce qui doit rester vrai quel que soit l'ecartement, c'est que
    // l'interieur est un RECTANGLE plein — toutes les rangees ont le meme
    // nombre de colonnes, aux memes X. Une rangee plus courte que les autres
    // signalerait un trou dans la grille, ce que la version chiffree
    // attrapait aussi mais en obligeant a la reecrire a chaque changement.
    const rows = new Map<string, typeof slots>();
    for (const s of slots) {
      if (!s.groupId.startsWith('interieur-r')) continue;
      if (!rows.has(s.groupId)) rows.set(s.groupId, []);
      rows.get(s.groupId)!.push(s);
    }
    expect(rows.size, "aucune rangee interieure").toBeGreaterThan(0);

    const signatures = new Set<string>();
    for (const [groupId, row] of rows) {
      const xs = row.map((s) => s.x).sort((a, b) => a - b);
      // Toutes les rangees doivent partager exactement le meme jeu de X.
      signatures.add(xs.join(','));
      // Et a l'interieur d'une rangee, l'ecart entre deux colonnes voisines
      // est exactement SLOT_SIZE (pas de colonne sautee).
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i]! - xs[i - 1]!, `colonne manquante dans ${groupId}`).toBeCloseTo(SLOT_SIZE, 6);
      }
    }
    expect(signatures.size, 'les rangees interieures n\'ont pas toutes les memes colonnes').toBe(1);
  });

  it('le contour exterieur est continu : chaque emplacement a un voisin proche, meme aux coins', () => {
    // Regroupe par colonne (c1/c2/c3) plutot que par sous-groupe
    // (gauche/bas/droite) : un coin partage appartient a un seul groupe
    // (cf. laneBandSlots), mais son voisin de l'autre cote du virage est
    // dans le groupe voisin, a la meme profondeur. Un emplacement isole
    // (ancien symptome des coins qui ne se raccordaient pas) n'aurait aucun
    // voisin proche dans sa colonne.
    //
    // Tolerance au-dela de SLOT_SIZE : gauche/droite/bas repartissent leurs
    // points uniformement sur toute la longueur du segment (n = longueur /
    // SLOT_SIZE, arrondi au sol pour ne jamais descendre sous SLOT_SIZE —
    // voir sampleSegmentEnds), donc l'espacement reel est SLOT_SIZE ou un
    // peu plus (mesure : jusqu'a ~66 ici), jamais exactement 64 sauf si la
    // longueur du segment tombe pile sur un multiple.
    const exterieur = slots.filter((s) => s.groupId.startsWith('exterieur-'));
    const byColumn = new Map<string, typeof slots>();
    for (const s of exterieur) {
      const col = s.groupId.slice(s.groupId.lastIndexOf('-c'));
      if (!byColumn.has(col)) byColumn.set(col, []);
      byColumn.get(col)!.push(s);
    }
    for (const [col, group] of byColumn) {
      for (const s of group) {
        const hasNeighbor = group.some((o) => {
          if (o === s) return false;
          const d = Math.hypot(o.x - s.x, o.y - s.y);
          return d >= SLOT_SIZE - 1 && d <= SLOT_SIZE * 1.2;
        });
        expect(hasNeighbor, `emplacement isole : ${s.id} (colonne ${col})`).toBe(true);
      }
    }
  });

  it('symetrie : tout emplacement a gauche de l\'axe du U a un symetrique a droite', () => {
    const lane = lanes.find((l) => l.player === 0)!;
    // waypoints[1]/[2] = bas des bras gauche/droite (le U lui-meme) —
    // waypoints[0]/[3] (haut des bras) donneraient le meme axe, mais [1]/[2]
    // restent valables independamment de la longueur des bras horizontaux.
    const midX = (lane.waypoints[1]![0] + lane.waypoints[2]![0]) / 2;
    for (const s of slots) {
      if (Math.abs(s.x - midX) < 1) continue; // sur l'axe : son propre symetrique
      const mirrorX = 2 * midX - s.x;
      const hasMirror = slots.some((o) => Math.abs(o.x - mirrorX) <= 1 && Math.abs(o.y - s.y) <= 1);
      expect(hasMirror, `pas de symetrique pour ${s.id} (${s.x},${s.y}), attendu pres de (${mirrorX},${s.y})`).toBe(true);
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

  it('aucun emplacement exterieur n\'est a plus de PATH_CLEARANCE + 3*SLOT_SIZE du couloir, coins compris (les tours restent collees au chemin)', () => {
    // Restreint aux groupes exterieur-* : l'interieur remplit toute la
    // surface entre les bras (jusqu'a armTopY), donc loin du chemin par
    // construction — ce test ne s'applique qu'a la bande qui longe le
    // chemin.
    //
    // Au coin le plus exterieur (colonne c3), le point est a PATH_CLEARANCE
    // + 2*SLOT_SIZE (212) du chemin EN X ET EN Y a la fois — un coin a 90°
    // decale reste un coin a 90°, donc sa distance au vrai coin du chemin
    // est la diagonale 212*sqrt(2) =~ 300, pas 212. La borne lineaire
    // PATH_CLEARANCE + 3*SLOT_SIZE (276) ne couvre que le cas "en face d'un
    // segment droit" ; on l'etend par sqrt(2) pour couvrir aussi les coins.
    const lane = lanes.find((l) => l.player === 0)!;
    const path: Array<[number, number]> = [lane.spawn, ...lane.waypoints];
    const straightBound = PATH_CLEARANCE + 3 * SLOT_SIZE;
    const cornerBound = (PATH_CLEARANCE + 2 * SLOT_SIZE) * Math.SQRT2;
    const maxAllowed = Math.max(straightBound, cornerBound);
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

describe('chemin — bras d\'entree et de sortie', () => {
  it('le chemin compte 5 segments (6 points : entree, 4 coins du U, sortie)', () => {
    const lane = lanes.find((l) => l.player === 0)!;
    expect(lane.waypoints.length).toBe(5);
  });

  it('entree et sortie sont a la meme hauteur', () => {
    const lane = lanes.find((l) => l.player === 0)!;
    const entryY = lane.spawn[1];
    const exitY = lane.waypoints[lane.waypoints.length - 1]![1];
    expect(Math.abs(entryY - exitY)).toBeLessThanOrEqual(1);
  });

  it('les deux bras horizontaux (entree et sortie) ont la meme longueur', () => {
    const lane = lanes.find((l) => l.player === 0)!;
    const [entryX] = lane.spawn;
    const [topLeftX] = lane.waypoints[0]!;
    const [topRightX] = lane.waypoints[3]!;
    const [exitX] = lane.waypoints[4]!;
    const entryArmLen = Math.abs(topLeftX - entryX);
    const exitArmLen = Math.abs(exitX - topRightX);
    expect(Math.abs(entryArmLen - exitArmLen)).toBeLessThanOrEqual(1);
  });
});

describe('emplacements de construction — en jeu', () => {
  const root = buildableTowers[0]!;

  it('un clic pres d\'un emplacement construit dessus, recentre exactement', () => {
    const s = createGame(1, 2);
    s.arenas[0]!.gold = 1000;
    const slot = buildSlots(0)[0]!;

    tick(s, [{ type: 'buildTower', player: 0, defId: root, x: slot.x + 10, y: slot.y - 5 }]);
    drainBuilder(s);

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
    // Rejetee des le tick suivant, sans attendre : l'emplacement est reserve
    // par la PLANIFICATION, pas par l'apparition de la tour.
    const events = tick(s, [{ type: 'buildTower', player: 0, defId: root, x: slot.x, y: slot.y }]);
    expect(events.some((e) => e.type === 'rejected' && e.reason === 'occupied')).toBe(true);

    drainBuilder(s);
    expect(s.arenas[0]!.towers.length).toBe(1);
  });

  it('vendre libere l\'emplacement', () => {
    const s = createGame(1, 2);
    s.arenas[0]!.gold = 1000;
    const slot = buildSlots(0)[0]!;

    tick(s, [{ type: 'buildTower', player: 0, defId: root, x: slot.x, y: slot.y }]);
    drainBuilder(s);
    const eid = s.arenas[0]!.towers[0]!.eid;
    tick(s, [{ type: 'sellTower', player: 0, eid }]);
    expect(s.arenas[0]!.occupied[slot.id]).toBeUndefined();

    tick(s, [{ type: 'buildTower', player: 0, defId: root, x: slot.x, y: slot.y }]);
    drainBuilder(s);
    expect(s.arenas[0]!.towers.length).toBe(1);
  });
});
