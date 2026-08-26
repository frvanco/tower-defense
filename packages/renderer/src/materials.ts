import * as THREE from 'three';

/**
 * Palette partagee par toutes les branches, portee telle quelle du prototype
 * (reference/cannon-branch-v5.html). Les couleurs elles-memes ne derivent
 * d'aucune stat — seul leur usage (calibre, hauteur, nombre de canons...)
 * derive des donnees.
 */
export const MAT = {
  stone: new THREE.MeshLambertMaterial({ color: 0x8a8f9c }),
  stone2: new THREE.MeshLambertMaterial({ color: 0x6f7480 }),
  metal: new THREE.MeshLambertMaterial({ color: 0x3c4149 }),
  metal2: new THREE.MeshLambertMaterial({ color: 0x272b31 }),
  wood: new THREE.MeshLambertMaterial({ color: 0x7a5b3a }),
  scaff: new THREE.MeshLambertMaterial({ color: 0x8a6a42 }),
  hot: new THREE.MeshBasicMaterial({ color: 0xffb04a }),
  dust: new THREE.MeshBasicMaterial({ color: 0x9aa0ac, transparent: true, opacity: 0.55 }),
};

/**
 * Accent chaud par palier (0-5). Portee du prototype : la geometrie seule ne
 * suffit plus a distinguer les paliers 4/5/6 vus de loin.
 */
export const TIER_ACCENT: readonly number[] = [
  0x9a7b4f, 0xb08040, 0xc07a33, 0xd06a28, 0xe0561f, 0xf03c14,
];

export function tierAccentColor(tier: number): number {
  return TIER_ACCENT[Math.min(tier, TIER_ACCENT.length - 1)] ?? TIER_ACCENT[TIER_ACCENT.length - 1]!;
}

export function accentMaterial(tier: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: tierAccentColor(tier) });
}

/**
 * Proprietaire de chaque materiau partage (MAT.* + le cache teamMaterial
 * ci-dessous) — consulte par le rendu (entities3d.ts) avant de disposer un
 * materiau retire de la scene : un materiau present dans cet ensemble est
 * reference par potentiellement PLUSIEURS tours simultanement (toutes celles
 * de la meme equipe, ou toutes celles utilisant une texture de pierre/metal
 * commune) et ne doit donc JAMAIS etre dispose individuellement, seulement
 * au demontage complet du renderer (voir disposeSharedTowerMaterials).
 */
const sharedTowerMaterials = new Set<THREE.Material>(Object.values(MAT));

export function isSharedTowerMaterial(m: THREE.Material): boolean {
  return sharedTowerMaterials.has(m);
}

/**
 * Le prototype avait un unique MAT.team modifiable via un color-picker (une
 * seule tour, une seule equipe a la fois). En jeu il y a jusqu'a 8 joueurs :
 * un materiau par couleur d'equipe, mis en cache pour ne pas en recreer un a
 * chaque tour construite.
 */
const teamMaterialCache = new Map<number, THREE.MeshLambertMaterial>();

export function teamMaterial(color: number): THREE.MeshLambertMaterial {
  let m = teamMaterialCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    teamMaterialCache.set(color, m);
    sharedTowerMaterials.add(m);
  }
  return m;
}

/** A appeler uniquement au demontage complet du renderer (jamais entre deux
 * parties : MAT/teamMaterial vivent pour toute la session). */
export function disposeSharedTowerMaterials(): void {
  for (const m of sharedTowerMaterials) m.dispose();
  sharedTowerMaterials.clear();
  teamMaterialCache.clear();
}
