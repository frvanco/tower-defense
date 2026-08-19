import * as THREE from 'three';

/**
 * Reglages visuels du gel (branche Ice) — regroupes ici pour rester
 * modifiables sans fouiller entities3d.ts.
 */

/** Teinte cible du corps a plein effet — bleu glace. */
export const ICE_TINT_COLOR = new THREE.Color(0x8fd6ff);
/** pct de ralentissement Ice au-dela duquel la teinte est consideree "franche"
 * (correspond au palier le plus fort de balance.json). */
export const ICE_TINT_MAX_PCT = 0.38;
/** Melange (0-1) applique a la teinte cible quand pct atteint ICE_TINT_MAX_PCT —
 * volontairement < 1 pour que la couleur d'armure reste devinable. */
export const ICE_TINT_MAX_MIX = 0.8;

/** Frequence du cycle de "marche" (bob vertical) a vitesse pleine, en Hz. */
export const BOB_BASE_HZ = 2.4;
/** Amplitude du bob, en fraction du rayon du creep. */
export const BOB_AMPLITUDE_RATIO = 0.32;

/** Ralentissement total (SLOW_CAP = 0.7) a partir duquel les eclats de givre apparaissent. */
export const FROST_SHARD_SLOW_THRESHOLD = 0.6;
export const FROST_SHARD_COLOR = 0xe8faff;
