/**
 * mulberry32 : PRNG deterministe, etat sur 32 bits.
 * L'etat vit dans le state du jeu et se serialise avec lui, donc reprendre
 * une partie depuis un snapshot rejoue exactement la meme suite.
 * Ne jamais utiliser Math.random dans la sim.
 */
export function nextRandom(state: number): { state: number; value: number } {
  let a = (state + 0x6d2b79f5) | 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: a, value };
}

/** Entier dans [0, max). */
export function nextInt(state: number, max: number): { state: number; value: number } {
  const r = nextRandom(state);
  return { state: r.state, value: Math.floor(r.value * max) };
}

/** Jet de des classique : dice * d(sides). */
export function rollDamage(
  state: number,
  base: number,
  dice: number,
  sides: number,
): { state: number; value: number } {
  let s = state;
  let total = base;
  for (let i = 0; i < dice; i++) {
    const r = nextInt(s, Math.max(1, sides));
    s = r.state;
    total += r.value + 1;
  }
  return { state: s, value: total };
}
