import { TICK_RATE, type Creep } from './types.js';

/**
 * Plafond global de ralentissement (toutes sources additionnees). Au-dela,
 * un creep devient statique et bloque la partie — nomme plutot que perdu
 * dans une formule, pour rester facile a retrouver et ajuster.
 */
export const SLOW_CAP = 0.7;

/**
 * Portee des rebonds de la branche Lightning — volontairement plus courte
 * que la portee des tours (packages/data/src/balance.json), pour que la
 * chaine ne saute pas d'un bout a l'autre de l'ecran.
 */
export const CHAIN_RANGE = 300;

/**
 * Applique (ou rafraichit) le ralentissement Ice sur un creep. Regle de
 * cumul "meme source" : si un ralentissement Ice est deja actif et plus
 * fort (ou egal), le nouveau coup n'a aucun effet — vingt tours Ice
 * n'appliquent jamais plus que le meilleur ralentissement Ice. Si le
 * ralentissement en cours est plus faible ou expire, il est remplace
 * (pourcentage ET duree) par celui du coup courant : c'est ce qui fait
 * qu'une tour plus forte "rafraichit" continuellement son propre debuff
 * tant qu'elle reste a portee.
 */
export function applyIceSlow(creep: Creep, pct: number, durationTicks: number, currentTick: number): void {
  const current = creep.ice;
  const stillActive = current !== undefined && current.untilTick > currentTick;
  if (!stillActive || pct >= current!.pct) {
    creep.ice = { pct, untilTick: currentTick + durationTicks };
  }
}

/**
 * Applique (ou rafraichit) le poison sur un creep. Meme regle de cumul que
 * le ralentissement Ice, mais comparee sur les degats/s : le poison le plus
 * fort remplace le plus faible, jamais l'inverse, et les degats ne
 * s'additionnent pas entre plusieurs tours Poison visant la meme cible.
 */
export function applyPoison(creep: Creep, pct: number, dps: number, durationTicks: number, currentTick: number): void {
  const current = creep.poison;
  const stillActive = current !== undefined && current.untilTick > currentTick;
  if (!stillActive || dps >= current!.dps) {
    creep.poison = { pct, dps, untilTick: currentTick + durationTicks };
  }
}

/**
 * Ralentissement total applique a un creep : Ice et Poison sont deux
 * sources distinctes et s'additionnent (contrairement a deux applications
 * de la meme source), plafonnees a SLOW_CAP pour qu'un creep ne devienne
 * jamais totalement statique.
 */
export function totalSlowPct(creep: Creep, currentTick: number): number {
  const ice = creep.ice && creep.ice.untilTick > currentTick ? creep.ice.pct : 0;
  const poison = creep.poison && creep.poison.untilTick > currentTick ? creep.poison.pct : 0;
  return Math.min(SLOW_CAP, ice + poison);
}

/** Degats de poison pour un tick, ou 0 si aucun poison actif. A appliquer
 * directement sur `hp` : le poison ignore l'armure (packages/sim/src/sim.ts
 * n'appelle pas finalDamage() pour ces degats), et peut donc achever un
 * creep — contrairement au Slow Poison de Warcraft III d'origine. */
export function poisonTickDamage(creep: Creep, currentTick: number): number {
  if (!creep.poison || creep.poison.untilTick <= currentTick) return 0;
  return creep.poison.dps / TICK_RATE;
}
