import * as THREE from 'three';
import { FROST_SHARD_COLOR } from './iceEffects.js';

/**
 * Geometries/materiaux PARTAGES entre tous les creeps generiques
 * (sphere/cone/anneau/eclats de givre) et, pour l'anneau, les creeps
 * humanoides aussi (voir CreepEntities.makeRing — une seule fonction sert
 * aux deux). Cle uniquement par ce qui determine leur FORME/COULEUR fixe,
 * jamais par un etat de jeu qui varie frame a frame :
 *
 * - geometrie du corps (sphere/cone) : depend de `isAir` et du rayon
 *   (creepRadius(def), fini — un par type de creep) — jamais mutee.
 * - geometrie de l'anneau : depend du rayon — jamais mutee.
 * - materiau de l'anneau : depend de la couleur de la lane (finie, ~6-8
 *   couleurs) — jamais mutee (contrairement au materiau du CORPS, qui, lui,
 *   change de teinte chaque frame pour le gel/poison — voir syncSphere() ;
 *   c'est precisement pour ca qu'il reste hors de ce cache, cree par
 *   instance, et dispose a la mort du creep).
 * - geometrie ET materiau des eclats de givre : couleur et taille par rayon
 *   toujours identiques (FROST_SHARD_COLOR, une seule teinte dans tout le
 *   jeu) — le materiau est donc un singleton unique, pas meme une Map.
 *
 * Cache au niveau du module (pas par partie/arene) : ces formes ne dependent
 * que des donnees statiques de @tower-defense/data, identiques d'une partie
 * a l'autre — inutile de les reconstruire a chaque redemarrage. Nettoyage
 * explicite via disposeCreepVisualCache() (voir scene3d.ts#disposeScene3D),
 * jamais implicite.
 */

function radiusKey(radius: number): string {
  return radius.toFixed(6);
}

const bodyGeometries = new Map<string, THREE.BufferGeometry>();

export function getCreepBodyGeometry(isAir: boolean, radius: number): THREE.BufferGeometry {
  const key = `${isAir ? 'air' : 'ground'}:${radiusKey(radius)}`;
  let geo = bodyGeometries.get(key);
  if (!geo) {
    geo = isAir ? new THREE.ConeGeometry(radius, radius * 2.1, 8) : new THREE.SphereGeometry(radius, 10, 8);
    bodyGeometries.set(key, geo);
  }
  return geo;
}

const ringGeometries = new Map<string, THREE.BufferGeometry>();

export function getCreepRingGeometry(radius: number): THREE.BufferGeometry {
  const key = radiusKey(radius);
  let geo = ringGeometries.get(key);
  if (!geo) {
    geo = new THREE.RingGeometry(radius * 0.95, radius * 1.25, 16);
    ringGeometries.set(key, geo);
  }
  return geo;
}

const ringMaterials = new Map<string, THREE.MeshBasicMaterial>();

export function getCreepRingMaterial(colorHex: string): THREE.MeshBasicMaterial {
  let mat = ringMaterials.get(colorHex);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide });
    ringMaterials.set(colorHex, mat);
  }
  return mat;
}

const frostGeometries = new Map<string, THREE.BufferGeometry>();
const frostMaterial = new THREE.MeshBasicMaterial({ color: FROST_SHARD_COLOR });

export function getFrostShardGeometry(radius: number): THREE.BufferGeometry {
  const key = radiusKey(radius);
  let geo = frostGeometries.get(key);
  if (!geo) {
    geo = new THREE.ConeGeometry(radius * 0.22, radius * 0.6, 4);
    frostGeometries.set(key, geo);
  }
  return geo;
}

export function getFrostShardMaterial(): THREE.MeshBasicMaterial {
  return frostMaterial;
}

/** A appeler uniquement au demontage complet du renderer (jamais entre deux
 * parties : ce cache vit pour toute la session, voir le commentaire de tete). */
export function disposeCreepVisualCache(): void {
  for (const g of bodyGeometries.values()) g.dispose();
  bodyGeometries.clear();
  for (const g of ringGeometries.values()) g.dispose();
  ringGeometries.clear();
  for (const m of ringMaterials.values()) m.dispose();
  ringMaterials.clear();
  for (const g of frostGeometries.values()) g.dispose();
  frostGeometries.clear();
  frostMaterial.dispose();
}
