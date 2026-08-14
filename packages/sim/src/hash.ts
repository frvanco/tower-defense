import type { GameState } from './types.js';

/**
 * Stringify JSON avec les cles d'objet triees, pour que deux etats
 * structurellement identiques produisent toujours la meme chaine, meme si
 * l'ordre d'insertion des cles a pu differer (p.ex. apres structuredClone).
 * Les tableaux gardent leur ordre : c'est significatif (ordre des creeps,
 * des tours, etc.).
 */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]));
  return '{' + parts.join(',') + '}';
}

/** FNV-1a 32 bits. Pas cryptographique : juste assez pour detecter une divergence en test. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Empreinte deterministe d'un GameState complet (y compris l'etat du PRNG
 * seede). Deux simulations lancees independamment avec la meme seed doivent
 * produire le meme hash a tout instant ; deux seeds differentes doivent
 * (avec une probabilite ecrasante) produire des hash differents.
 */
export function hashState(s: GameState): string {
  return fnv1a(stableStringify(s));
}
