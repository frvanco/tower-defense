import { describe, it, expect } from 'vitest';
import { creeps } from '../src/index.js';

describe('creeps — isAir', () => {
  // Retour direct : deja corrige une fois puis reperdu lors d'une
  // regeneration des donnees (moveType n'est jamais "fly" dans les sources,
  // meme pour ces unites manifestement aeriennes). isAir doit rester derive
  // de baseId === 'ugar' (l'unite aerienne de base de l'original), pas
  // d'une liste d'ids maintenue a la main — ce test verifie la regle sur
  // les 11 unites concernees, pour qu'une regeneration future ne la reperde
  // pas une troisieme fois.
  const airUnitIds = ['u000', 'u001', 'u002', 'u003', 'u004', 'u005', 'u006', 'u007', 'u008', 'u00A', 'u00B'];

  it.each(airUnitIds)('%s (baseId ugar) est aerien', (id) => {
    const def = creeps.get(id);
    expect(def, `creep ${id} introuvable`).toBeDefined();
    expect(def!.isAir, `${id} devrait etre aerien (baseId ugar)`).toBe(true);
  });

  it('aucune autre unite (baseId different de ugar) n\'est marquee aerienne par erreur', () => {
    const airIds = new Set(airUnitIds);
    for (const [id, def] of creeps) {
      if (airIds.has(id)) continue;
      expect(def.isAir, `${id} ne devrait pas etre aerien`).toBe(false);
    }
  });
});
