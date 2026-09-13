import { describe, expect, it } from 'vitest';
import { towers, buildableTowers, type TowerDef } from '@tower-defense/data';
import { formatDamage, towerStatLines } from '../src/towerStats.js';

function withDice(dice: number, sides: number): TowerDef {
  return { ...towers.get('h000')!, damageBase: 46, dice, sides };
}

describe('formatDamage', () => {
  it("n'affiche pas de jet de des quand il n'y en a pas", () => {
    // Le cas signale : « 46+0d1 » se lisait comme une coquille.
    expect(formatDamage(withDice(0, 1))).toBe('46');
    expect(formatDamage(withDice(0, 6))).toBe('46');
  });

  it('affiche le jet de des quand il existe reellement', () => {
    // Le champ reste lu par le calcul de degats : une tour a des doit rester
    // representable si les donnees en introduisent une.
    expect(formatDamage(withDice(2, 6))).toBe('46+2d6');
    expect(formatDamage(withDice(1, 4))).toBe('46+1d4');
  });

  it('traite un nombre de des negatif comme une absence', () => {
    expect(formatDamage(withDice(-1, 6))).toBe('46');
  });
});

describe('towerStatLines', () => {
  it('rend les trois statistiques dans l ordre, en francais', () => {
    const def = towers.get('h000')!;
    expect(towerStatLines(def)).toEqual([
      `Dégâts ${formatDamage(def)}`,
      `Portée ${def.range}`,
      `Cadence ${def.cooldown}s`,
    ]);
  });

  it("aucune des 27 tours du jeu n'affiche de jet de des", () => {
    // Garde-fou : si une tour a des apparait un jour dans les donnees, ce test
    // tombe et signale qu'il faut verifier l'affichage plutot que de le
    // decouvrir a l'ecran.
    const chainOf = (root: string): TowerDef[] => {
      const out: TowerDef[] = [];
      let cur = towers.get(root);
      while (cur) {
        out.push(cur);
        const next = cur.upgradesTo[0];
        cur = next ? towers.get(next) : undefined;
      }
      return out;
    };
    const all = buildableTowers.flatMap(chainOf);
    expect(all).toHaveLength(27);
    for (const def of all) {
      expect(def.dice, `${def.id} ${def.name}`).toBe(0);
      expect(formatDamage(def)).toBe(String(def.damageBase));
      expect(formatDamage(def)).not.toContain('d');
    }
  });
});
