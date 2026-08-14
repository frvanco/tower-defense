import type { ArmorType, AttackType } from '@tower-defense/data';

/**
 * Table de degats : multiplicateur type d'attaque -> type d'armure.
 * C'est le coeur de l'equilibrage. Sans elle, armorType et attackType
 * n'ont aucun effet et toutes les tours se valent.
 */
const TABLE: Record<AttackType, Record<ArmorType, number>> = {
  normal: { small: 1.0, medium: 1.5, large: 1.0, fort: 0.7, normal: 1.0, hero: 1.0, divine: 0.05, none: 1.0 },
  pierce: { small: 2.0, medium: 0.75, large: 1.0, fort: 0.35, normal: 1.5, hero: 0.5, divine: 0.05, none: 1.5 },
  siege: { small: 1.0, medium: 0.5, large: 1.0, fort: 1.5, normal: 1.0, hero: 0.5, divine: 0.05, none: 1.5 },
  magic: { small: 1.0, medium: 0.75, large: 2.0, fort: 0.35, normal: 1.0, hero: 0.5, divine: 0.05, none: 1.0 },
  chaos: { small: 1.0, medium: 1.0, large: 1.0, fort: 1.0, normal: 1.0, hero: 1.0, divine: 1.0, none: 1.0 },
  hero: { small: 1.0, medium: 1.0, large: 1.0, fort: 0.5, normal: 1.0, hero: 1.0, divine: 1.0, none: 1.0 },
  spells: { small: 1.0, medium: 1.0, large: 1.0, fort: 1.0, normal: 1.0, hero: 0.7, divine: 0.05, none: 1.0 },
};

export function typeMultiplier(attack: AttackType, armor: ArmorType): number {
  return TABLE[attack]?.[armor] ?? 1.0;
}

/** Reduction par points d'armure. Armure negative augmente les degats. */
export function armorMultiplier(armor: number): number {
  if (armor >= 0) return 1 - (0.06 * armor) / (1 + 0.06 * armor);
  return 2 - Math.pow(0.94, -armor);
}

export function finalDamage(
  raw: number,
  attack: AttackType,
  armorType: ArmorType,
  armor: number,
): number {
  return raw * typeMultiplier(attack, armorType) * armorMultiplier(armor);
}
