import type { TowerDef } from '@tower-defense/data';

/**
 * Mise en forme des degats d'une tour.
 *
 * `dice`/`sides` decrivent un jet de des herite du jeu d'origine : les degats
 * valent `damageBase + dice x D(sides)`. AUCUNE des 27 tours du jeu n'utilise
 * ce jet (toutes ont `dice: 0`), donc afficher la formule complete donnait
 * systematiquement « 46+0d1 » — une somme de zero des, qui se lit comme une
 * coquille et n'apprend rien.
 *
 * La partie des n'apparait donc que si elle existe reellement. Le champ n'est
 * pas supprime pour autant : il est bien lu par le calcul de degats
 * (`effectiveDamage`, packages/renderer), et une tour a des reste
 * representable si les donnees en introduisent une un jour.
 */
export function formatDamage(def: TowerDef): string {
  if (def.dice <= 0) return String(def.damageBase);
  return `${def.damageBase}+${def.dice}d${def.sides}`;
}

/**
 * Les trois statistiques affichees d'une tour, dans l'ordre. Partagees par
 * l'infobulle et le panneau de selection : les deux les montraient cote a
 * cote avec des libelles differents (l'un en francais, l'autre en anglais) et
 * la meme erreur de des dupliquee. Une seule source, donc plus de divergence
 * possible.
 */
export function towerStatLines(def: TowerDef): string[] {
  return [`Dégâts ${formatDamage(def)}`, `Portée ${def.range}`, `Cadence ${def.cooldown}s`];
}
