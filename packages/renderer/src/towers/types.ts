import { towers, type TowerDef } from '@tower-defense/data';
import { tierAccentColor } from '../materials.js';

/**
 * Identifiant de branche = id de la tour racine (celle listee dans
 * `buildableTowers` de `@tower-defense/data`). Le prompt suppose un export
 * `towerTrees` dans `@tower-defense/data` : il n'existe pas. La seule donnee
 * d'upgrade disponible est `TowerDef.upgradesTo` sur chaque tour. `getBranchChain`
 * ci-dessous fait le meme parcours que celui deja utilise par `apps/web/src/branches.ts`,
 * duplique ici car `packages/renderer` ne doit dependre que de `@tower-defense/data`
 * et `three` (pas de `apps/web`).
 */
export type BranchId = string;

/** Chaine ordonnee des tours d'une branche, du palier 1 (racine) au dernier. */
export function getBranchChain(rootId: BranchId): TowerDef[] {
  const chain: TowerDef[] = [];
  let current = towers.get(rootId);
  while (current) {
    chain.push(current);
    const nextId = current.upgradesTo[0];
    current = nextId ? towers.get(nextId) : undefined;
  }
  return chain;
}

/** Degats moyens par tir (dice=0 pour toutes les tours actuellement extraites, mais general). */
export function effectiveDamage(def: TowerDef): number {
  return def.damageBase + def.dice * ((def.sides + 1) / 2);
}

/**
 * Parametres de geometrie derives des stats — jamais de valeur en dur par
 * tour. Formules portees telles quelles depuis `makeCannonTower` du prototype ;
 * partagees ici pour que les 5 branches suivantes n'aient pas a les redupliquer.
 */
export interface TowerVisual {
  tier: number;
  def: TowerDef;
  /** 0..1, derive du cout en or (log). Pilote hauteur, blindage, largeur du socle. */
  armor: number;
  height: number;
  caliber: number;
  barrels: number;
  /** Plafonnee : la puissance passe par la hauteur, jamais par l'etalement au sol. */
  width: number;
  accentColor: number;
  /** true si cette tour cible l'air — declenche le marqueur anti-air (cone vers le haut). */
  isAntiAir: boolean;
}

/** Nombre de canons par palier (index = tier, 0-based). Derive du PALIER, pas d'une stat brute. */
const BARRELS_BY_TIER: readonly number[] = [0, 1, 1, 2, 3, 4];

export function deriveTowerVisual(def: TowerDef, tier: number): TowerVisual {
  const armor = Math.min(1, Math.log10(Math.max(10, def.goldCost)) / 4.3);
  const height = 1.55 + ((def.range - 700) / 800) * 1.0 + armor * 0.55;
  const dmg = effectiveDamage(def);
  const caliber = 0.105 + (Math.sqrt(dmg) / 34) * 0.075;
  const barrels = BARRELS_BY_TIER[Math.min(tier, BARRELS_BY_TIER.length - 1)] ?? 0;
  const width = Math.min(0.72, 0.6 + armor * 0.2);
  const accentColor = tierAccentColor(tier);
  const isAntiAir = def.targets.includes('air');

  return { tier, def, armor, height, caliber, barrels, width, accentColor, isAntiAir };
}
