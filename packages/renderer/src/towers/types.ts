import { towers, type TowerDef } from '@tower-defense/data';
import { tierAccentColor } from '../materials.js';
import { MAX_RADIUS } from '../footprint.js';

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

/**
 * Hauteur de base par palier (index 0-based : [0] = palier 1). Pilotee par le
 * PALIER et rien d'autre, parce que c'est la seule donnee monotone par
 * construction. L'ancienne formule derivait la hauteur de la portee, qui
 * plafonne a 1500 sur plusieurs branches : la progression etait en marches
 * irregulieres (Givre : +0.82 puis +0.06 puis +0.06), et surtout un palier 3
 * d'une branche pouvait depasser un palier 5 d'une autre (Blizzard 2.91 contre
 * Tempete 2.45). Les creeps mesurent 0.36 a 2.52 unites de scene, cette table
 * place donc toute tour au-dessus d'un creep courant des le palier 1.
 *
 * Au-dela du dernier index, la derniere valeur est reprise.
 */
export const TOWER_HEIGHT_BY_TIER: readonly number[] = [2.3, 2.65, 3.0, 3.35, 3.7];

/**
 * Evasement du socle : le bas du socle est plus large que `width` (c'est ce
 * qui donne l'assise). Ce sont donc `width * SOCLE_FLARE` qui touchent le bord
 * de la case en premier — jamais les canons, verifie sur les 27 tours. Partage
 * par toutes les branches pour que le plafond de largeur ci-dessous reste
 * valable quelle que soit la geometrie utilisee.
 */
export const SOCLE_FLARE = 1.12;

/** Largeur maximale utilisable : celle dont le socle evase touche le bord de la
 * case, moins une marge de securite. DERIVEE de MAX_RADIUS, donc elle suit
 * automatiquement SLOT_SIZE et FOOTPRINT_FACTOR — aucune valeur a
 * resynchroniser a la main. Le 0.99 n'est pas cosmetique : sans lui
 * `width * SOCLE_FLARE` vaut MAX_RADIUS au bit pres et le test
 * `radius > MAX_RADIUS` de measureSweptRadius se declenche au hasard des
 * arrondis flottants. */
const MAX_WIDTH = (MAX_RADIUS / SOCLE_FLARE) * 0.99;

/** Largeur d'une tour bon marche, en proportion de la largeur maximale : une
 * tour de palier 1 doit deja etre massive, l'ecart de prix se lit surtout a la
 * hauteur et au detail. */
const MIN_WIDTH = MAX_WIDTH * 0.75;

/** Amplitude MAXIMALE de l'ajustement portee/prix ajoute a la table ci-dessus.
 * Borne a moins de la moitie du pas entre deux paliers (0.35) : deux paliers
 * successifs ne peuvent donc jamais se croiser, quelles que soient leurs
 * stats — c'est ce qui garantit la monotonie. */
const HEIGHT_VARIATION = 0.15;

/**
 * Palier de reference d'une tour dans la table de hauteurs : les branches
 * courtes sont alignees sur la FIN de la table, pas sur son debut. Le Reacteur
 * (h008 -> h00T) n'a que 2 paliers mais coute 30 000 et 180 000 or : c'est du
 * late game, il doit avoir la stature des paliers 4 et 5, pas celle des
 * paliers 1 et 2. Regle derivee de la longueur de chaine plutot qu'une liste
 * d'ids en dur — ce fichier ne contient aucune valeur par tour, et une branche
 * future de longueur inhabituelle sera traitee correctement sans y toucher.
 */
function heightTierIndex(tier: number, chainLength: number): number {
  const last = TOWER_HEIGHT_BY_TIER.length - 1;
  const offset = Math.max(0, TOWER_HEIGHT_BY_TIER.length - chainLength);
  return Math.min(last, tier + offset);
}

export function deriveTowerVisual(def: TowerDef, tier: number, chainLength = TOWER_HEIGHT_BY_TIER.length): TowerVisual {
  const armor = Math.min(1, Math.log10(Math.max(10, def.goldCost)) / 4.3);

  // Hauteur : table par palier + un ajustement BORNE derive de la portee et du
  // prix, qui garde un peu de variation entre branches sans jamais pouvoir
  // inverser deux paliers (voir HEIGHT_VARIATION).
  const base = TOWER_HEIGHT_BY_TIER[heightTierIndex(tier, chainLength)] ?? TOWER_HEIGHT_BY_TIER[0]!;
  // Deux composantes centrees sur 0, chacune dans [-0.5, 0.5] : la portee
  // (700-1500 est la plage reelle des tours) et le prix via armor.
  const rangeTerm = Math.max(-0.5, Math.min(0.5, (def.range - 1100) / 800));
  const costTerm = armor - 0.5;
  const height = base + (rangeTerm * 0.6 + costTerm * 0.4) * HEIGHT_VARIATION * 2;

  const dmg = effectiveDamage(def);
  const caliber = 0.105 + (Math.sqrt(dmg) / 34) * 0.075;
  const barrels = BARRELS_BY_TIER[Math.min(tier, BARRELS_BY_TIER.length - 1)] ?? 0;
  // Plafond calibre sur MAX_RADIUS : le socle est evase (jusqu'a width * 1.12
  // sur la branche Cannon), c'est LUI qui touche le bord de la case en premier,
  // pas les canons. Voir la note de MAX_WIDTH.
  const width = Math.min(MAX_WIDTH, MIN_WIDTH + armor * (MAX_WIDTH - MIN_WIDTH) * 1.15);
  const accentColor = tierAccentColor(tier);
  const isAntiAir = def.targets.includes('air');

  return { tier, def, armor, height, caliber, barrels, width, accentColor, isAntiAir };
}
