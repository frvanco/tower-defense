export {
  MAT,
  TIER_ACCENT,
  tierAccentColor,
  accentMaterial,
  teamMaterial,
  isSharedTowerMaterial,
  disposeSharedTowerMaterials,
} from './materials.js';
export { CELL, MAX_RADIUS, measureSweptRadius } from './footprint.js';
export {
  type BranchId,
  type TowerVisual,
  getBranchChain,
  effectiveDamage,
  deriveTowerVisual,
} from './towers/types.js';
export { makeCannonTower, makeScaffold } from './towers/cannon.js';
export { makePlaceholderTower, hasDedicatedGeometry } from './towers/placeholder.js';
export { startBuild, updateBuild, DEFAULT_BUILD_DURATION_SEC } from './build.js';
export { aimTurret } from './turret.js';
