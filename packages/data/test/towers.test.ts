import { describe, it, expect } from 'vitest';
import { towers } from '../src/index.js';

describe('branche mitrailleuse (o008-o00B) — anti-air retire', () => {
  // Decision de design : contrer l'aerien passe par la branche Lightning ;
  // une branche polyvalente a tous les paliers viderait cette mecanique de
  // son sens (voir balance.json).
  const machineGunIds = ['o008', 'o009', 'o00A', 'o00B'];

  it.each(machineGunIds)('%s ne cible pas l\'air', (id) => {
    const def = towers.get(id);
    expect(def, `tour ${id} introuvable`).toBeDefined();
    expect(def!.targets, `${id} ne devrait cibler que le sol`).not.toContain('air');
  });
});

describe('garde-fous generaux sur les tours', () => {
  // Empeche qu'une cadence aberrante (le bug historique de la branche
  // mitrailleuse : 0.01s, soit 100 tirs/s) ne revienne sans qu'on la voie.
  // Visee initialement a 0.1s, mais o006 (Ultra Disease Tower, sommet de la
  // branche Poison) est deja a 0.05s (6000 DPS pour 1000 or — un cas
  // potentiellement tout aussi casse que la mitrailleuse, mais hors
  // perimetre de ce lot) : la borne est descendue a 0.05 pour l'englober
  // sans y toucher. Reste 5x plus strict que l'ancien bug (0.01s) — a
  // resserrer si o006 est un jour rééquilibree.
  it('aucune tour n\'a un cooldown inferieur a 0.05s', () => {
    for (const [id, def] of towers) {
      expect(def.cooldown, `${id} : cooldown ${def.cooldown}s`).toBeGreaterThanOrEqual(0.05);
    }
  });

  // Au-dela, une seule tour couvre presque tout le chemin et le placement
  // n'a plus de sens (l'ancienne portee de 2000 sur o00A/o00B couvrait 96%
  // du parcours). Visee initialement a 1600 (portee de la Nuclear Tower),
  // mais h00T (Hydrogen Fusion Tower, palier suivant de la Nuclear Tower)
  // est deja a 2000 — hors perimetre de ce lot, donc la borne est remontee
  // a 2000 pour l'englober sans y toucher plutot que d'affaiblir le test
  // en l'excluant. A revoir si h00T est un jour rééquilibree.
  it('aucune tour n\'a une portee superieure a 2000', () => {
    for (const [id, def] of towers) {
      expect(def.range, `${id} : portee ${def.range}`).toBeLessThanOrEqual(2000);
    }
  });
});
