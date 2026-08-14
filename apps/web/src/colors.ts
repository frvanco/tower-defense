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

/** Blends a #rrggbb color toward white — used for gradient highlights on flat armor-type fills. */
export function lighten(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * amt);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
