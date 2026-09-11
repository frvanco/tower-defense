import { describe, expect, it } from 'vitest';
import type { Difficulty } from '@tower-defense/sim';
import {
  LOBBY_CODE_ALPHABET,
  LOBBY_SIZE,
  normalizeLobbyCode,
  type BotDifficulty,
} from '../src/index.js';

/**
 * Le contrat declare son PROPRE `BotDifficulty` plutot que d'importer celui du
 * moteur : ce qui circulera sur le fil ne doit pas dependre de
 * `@tower-defense/sim`. Le prix de cette independance est un risque de derive,
 * que ces deux assertions de type paient a la compilation — si un niveau est
 * ajoute d'un cote seulement, le typecheck casse ici et nulle part ailleurs.
 */
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _botDifficultyMatchesEngine: AssertEqual<BotDifficulty, Difficulty> = true;
void _botDifficultyMatchesEngine;

describe('contrat', () => {
  it('fige le format a 6 places', () => {
    // Aligne sur rules.maxPlayers (verrouille a 6 dans balance.json).
    expect(LOBBY_SIZE).toBe(6);
  });

  it("exclut de l'alphabet les caracteres visuellement ambigus", () => {
    for (const ambiguous of ['I', 'O', '0', '1']) {
      expect(LOBBY_CODE_ALPHABET).not.toContain(ambiguous);
    }
    // Pas de doublon : chaque caractere tire est equiprobable.
    expect(new Set(LOBBY_CODE_ALPHABET).size).toBe(LOBBY_CODE_ALPHABET.length);
  });

  it('normalise casse et espaces autour, mais pas les espaces internes', () => {
    expect(normalizeLobbyCode('  ab2c ')).toBe('AB2C');
    // Un espace au milieu n'est pas un code valide : le laisser tel quel fait
    // echouer la recherche en not_found, ce qui est le bon message.
    expect(normalizeLobbyCode('a b')).toBe('A B');
  });
});
