import type { ArmorType } from '@tower-defense/data';

/** One accent per creep armor type — this is the stat that actually drives the damage table, so it reads as "creep type" in the UI. */
export const ARMOR_COLORS: Record<ArmorType, string> = {
  small: '#7bd45c',
  medium: '#4fb2e6',
  large: '#e0a13f',
  fort: '#c9633f',
  normal: '#c3c9d6',
  hero: '#e05fb0',
  divine: '#f2d24b',
  none: '#7a8194',
};

/** The 8 lane colors used in the map data (`Lane.color`), as flat hex swatches. */
const LANE_COLORS: Record<string, string> = {
  red: '#e2453f',
  blue: '#4b8fe2',
  teal: '#29c3b0',
  purple: '#a259d9',
  yellow: '#d9c93f',
  orange: '#e2903f',
  green: '#4fbf4f',
  pink: '#e26fc0',
};

export function laneColor(name: string | undefined): string {
  if (!name) return '#9aa0ab';
  return LANE_COLORS[name] ?? '#9aa0ab';
}

/**
 * Identite visuelle d'un joueur (barre d'arenes, liseres, teinte des tours) —
 * concept distinct de LANE_COLORS ci-dessus (qui identifie "qui a envoye ce
 * creep", pas "de quelle arene s'agit-il"). Indexee par player (0-based) :
 * P1=rouge (meme rouge que l'ancien TEAM_COLOR de main.ts, pour ne rien
 * changer visuellement sur sa propre arene) ... P6=orange, comme specifie.
 * P7/P8 ajoutes pour rester correct au-dela de 6 joueurs (le selecteur de
 * bots va jusqu'a 7, soit 8 joueurs) — non specifies, choisis dans l'esprit
 * des teintes deja utilisees ailleurs dans le projet.
 */
export const PLAYER_COLORS: readonly string[] = [
  '#c0392b', // P1 rouge
  '#4b8fe2', // P2 bleu
  '#4fbf4f', // P3 vert
  '#a259d9', // P4 violet
  '#e26fc0', // P5 rose
  '#e2903f', // P6 orange
  '#29c3b0', // P7 sarcelle
  '#d9c93f', // P8 jaune
];

/** Gris neutre pour un joueur elimine — jamais reutilise dans PLAYER_COLORS
 * ci-dessus (c'est justement la convention "mort" que P6 orange doit eviter). */
export const ELIMINATED_COLOR = '#5a5f6b';

export function playerColor(player: number): string {
  return PLAYER_COLORS[player % PLAYER_COLORS.length]!;
}

export function playerLabel(player: number): string {
  return `P${player + 1}`;
}

/** '#rrggbb' -> 0xrrggbb, pour les APIs Three.js qui attendent un nombre
 * (THREE.Color, materiaux...) plutot qu'une chaine CSS. */
export function toHexNumber(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

/** Blends a #rrggbb color toward white — used for gradient highlights on flat armor-type fills. */
export function lighten(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * amt);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
