import { describe, it, expect } from 'vitest';
import { getBranchChain } from '../src/towers/types.js';
import { makeCannonTower } from '../src/towers/cannon.js';
import { measureSweptRadius, MAX_RADIUS } from '../src/footprint.js';

/**
 * Garantit qu'aucune tour de la branche Cannon ne deborde de sa case en jeu
 * (TOWER_FOOTPRINT = 64 unites monde dans packages/sim/src/sim.ts). Tourne
 * sous Node sans navigateur : construire des Object3D / BufferGeometry et
 * lire leurs sommets ne touche ni WebGLRenderer ni DOM.
 *
 * C'est la garantie que les 5 branches suivantes ne reintroduiront pas le
 * probleme de la v4 du prototype (rayon mesure au repos au lieu du rayon
 * BALAYE par la rotation de la tourelle).
 */
describe('emprise au sol — branche Cannon', () => {
  const chain = getBranchChain('h000');

  it('la branche a bien 5 paliers connus', () => {
    expect(chain.length).toBe(5);
  });

  it.each(chain.map((def, tier) => ({ tier, name: def.name })))(
    'palier $tier ($name) tient dans MAX_RADIUS',
    ({ tier }) => {
      const tower = makeCannonTower(tier);
      const radius = measureSweptRadius(tower.userData.body);

      expect(radius).toBeLessThanOrEqual(MAX_RADIUS);
      // Coherence avec la mesure que makeCannonTower fait elle-meme et stocke
      // dans userData — les deux doivent tomber sur le meme nombre.
      expect(radius).toBeCloseTo(tower.userData.radius as number, 9);
    },
  );
});
