import { describe, it, expect } from 'vitest';
import { buildableTowers, towers } from '@tower-defense/data';
import { getBranchChain, deriveTowerVisual, TOWER_HEIGHT_BY_TIER } from '../src/towers/types.js';
import { makeCannonTower } from '../src/towers/cannon.js';
import { makePlaceholderTower, hasDedicatedGeometry } from '../src/towers/placeholder.js';
import { measureSweptRadius, MAX_RADIUS } from '../src/footprint.js';

/**
 * Garantit qu'aucune tour ne deborde de sa case en jeu (SLOT_SIZE unites monde
 * dans packages/data, mappe sur CELL unites de scene). Tourne sous Node sans
 * navigateur : construire des Object3D / BufferGeometry et lire leurs sommets
 * ne touche ni WebGLRenderer ni DOM.
 *
 * Couvre les SIX branches, pas seulement Cannon : les 5 autres passent par
 * makePlaceholderTower, dont la largeur de socle est justement ce qui touche
 * le bord de la case en premier. Les laisser hors test laissait 22 tours sur
 * 27 sans garantie.
 */
describe('emprise au sol — toutes branches', () => {
  const cases = buildableTowers.flatMap((rootId) =>
    getBranchChain(rootId).map((def, tier) => ({ rootId, tier, id: def.id, name: def.name })),
  );

  it('les 27 tours buildables sont couvertes', () => {
    expect(cases.length).toBe(27);
  });

  it.each(cases)('$id $name (palier $tier, branche $rootId) tient dans MAX_RADIUS', ({ rootId, tier }) => {
    const tower = hasDedicatedGeometry(rootId) ? makeCannonTower(tier) : makePlaceholderTower(rootId, tier, 200);
    const radius = measureSweptRadius(tower.userData.body);

    expect(radius).toBeLessThanOrEqual(MAX_RADIUS);
    // Coherence avec la mesure que la fabrique fait elle-meme et stocke dans
    // userData — les deux doivent tomber sur le meme nombre.
    expect(radius).toBeCloseTo(tower.userData.radius as number, 9);
  });
});

/**
 * La hauteur est pilotee par le PALIER (voir TOWER_HEIGHT_BY_TIER) justement
 * pour etre monotone par construction. L'ancienne formule la derivait de la
 * portee, qui plafonne a 1500 : un palier 3 pouvait depasser un palier 5 d'une
 * autre branche (Blizzard 2.91 contre Tempete 2.45).
 */
describe('progression des hauteurs', () => {
  const branches = buildableTowers.map((rootId) => {
    const chain = getBranchChain(rootId);
    return {
      rootId,
      name: towers.get(rootId)?.name ?? rootId,
      heights: chain.map((def, tier) => deriveTowerVisual(def, tier, chain.length).height),
    };
  });

  it.each(branches)('$name : la hauteur croit strictement a chaque palier', ({ heights }) => {
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]!).toBeGreaterThan(heights[i - 1]!);
    }
  });

  it('aucun palier n\'est plus haut qu\'un palier superieur d\'une autre branche', () => {
    // Compare le MAX d'un rang au MIN du rang suivant, toutes branches
    // confondues : c'est la garantie qu'un joueur lit le palier d'une tour a
    // sa stature, meme entre deux branches differentes. Les branches courtes
    // (Reacteur, 2 paliers) sont alignees sur la FIN de la table, leurs
    // paliers sont donc compares a ceux de meme stature, pas de meme index.
    const byRank = new Map<number, number[]>();
    for (const { heights } of branches) {
      const offset = TOWER_HEIGHT_BY_TIER.length - heights.length;
      heights.forEach((h, i) => {
        const rank = i + Math.max(0, offset);
        if (!byRank.has(rank)) byRank.set(rank, []);
        byRank.get(rank)!.push(h);
      });
    }
    const ranks = [...byRank.keys()].sort((a, b) => a - b);
    for (let i = 1; i < ranks.length; i++) {
      const prevMax = Math.max(...byRank.get(ranks[i - 1]!)!);
      const currMin = Math.min(...byRank.get(ranks[i]!)!);
      expect(currMin, `rang ${ranks[i]} chevauche le rang ${ranks[i - 1]}`).toBeGreaterThan(prevMax);
    }
  });
});
