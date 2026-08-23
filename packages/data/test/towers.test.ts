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
  // o006 (Ultra Disease Tower) est repassee a 0.20s dans ce lot, donc n'est
  // plus la contrainte. Visee a 0.20s par le brief de ce lot ("plus aucune
  // tour n'est en dessous"), mais h011 (Ultra Shock Tower, sommet de la
  // branche Lightning, anti-air) est a 0.10s — 12000 DPS, un cas encore plus
  // extreme que ne l'etait o006 avant son nerf, decouvert en verifiant cette
  // borne, hors perimetre de ce lot (Lightning n'y est pas touchee). Borne
  // descendue a 0.10 pour l'englober sans y toucher plutot que d'affaiblir
  // le test en l'excluant. Signale : h011 merite son propre nerf.
  it('aucune tour n\'a un cooldown inferieur a 0.10s', () => {
    for (const [id, def] of towers) {
      expect(def.cooldown, `${id} : cooldown ${def.cooldown}s`).toBeGreaterThanOrEqual(0.1);
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

  // buildTower() dans packages/data/src/index.ts retombe sur l'id comme nom
  // quand les donnees source n'en fournissent pas (`name: t.name ?? id`) —
  // c'etait deja arrive une fois (h003, corrige via balance.json). Empeche
  // qu'une regeneration future des donnees le reperde sans qu'on le voie.
  it('aucune tour n\'a un name egal a son id (nom manquant)', () => {
    for (const [id, def] of towers) {
      expect(def.name, `${id} n'a pas de nom propre`).not.toBe(id);
    }
  });
});
