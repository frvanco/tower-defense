import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { prepareTowerModel, type PreparedTowerModel } from '@tower-defense/renderer';

/**
 * Modeles 3D de tours, par id de tour (@tower-defense/data) — une entree par
 * PALIER, pas par branche : chaque palier est une tour distincte avec sa
 * propre silhouette. Les tours sans entree ici restent procedurales
 * (packages/renderer/src/towers), ce qui est encore le cas de 26 des 27.
 *
 * Chemins : `public/models/towers/<slug de branche>/`, le slug venant de la
 * section `branches` de balance.json — voir le README de ce dossier.
 */
const TOWER_MODEL_CONFIG: Record<string, string> = {
  // Balistique — la seule branche entierement modelisee a ce jour.
  h000: '/models/towers/balistique/lv1_balistique.glb', // Tourelle       — palier 1
  h004: '/models/towers/balistique/lv2_balistique.glb', // Canon          — palier 2
  h002: '/models/towers/balistique/lv3_balistique.glb', // Canon lourd    — palier 3
  h012: '/models/towers/balistique/lv4_balistique.glb', // Obusier        — palier 4
  h010: '/models/towers/balistique/lv5_balistique.glb', // Canon à rail   — palier 5
};

const cache = new Map<string, PreparedTowerModel>();
const loading = new Map<string, Promise<PreparedTowerModel | null>>();

/**
 * Charge et prepare un modele une seule fois par url. Mis en cache ; les
 * echecs (fichier absent, glb invalide) sont journalises et retournent null
 * plutot que de rejeter — une tour sans modele retombe sur sa geometrie
 * procedurale, ce qui est un repli parfaitement jouable.
 */
function load(defId: string, url: string): Promise<PreparedTowerModel | null> {
  const existing = loading.get(url);
  if (existing) return existing;
  const promise = new Promise<PreparedTowerModel | null>((resolve) => {
    const fail = (err: unknown): void => {
      console.warn(`[tour] modele ${defId} illisible (${url}) — repli sur la geometrie procedurale`, err);
      resolve(null);
    };
    // try/catch EN PLUS du callback d'erreur : hors navigateur (vitest), une
    // url relative fait lever GLTFLoader.load() de facon SYNCHRONE, ce que le
    // callback ne rattrape pas — la promesse partait alors en rejet non gere.
    // Ce module est importe par entities3d.ts, donc par tout test qui touche
    // au rendu.
    try {
      new GLTFLoader().load(
        url,
        (gltf) => {
          const prepared = prepareTowerModel(gltf.scene, gltf.animations);
          cache.set(defId, prepared);
          resolve(prepared);
        },
        undefined,
        fail,
      );
    } catch (err) {
      fail(err);
    }
  });
  loading.set(url, promise);
  return promise;
}

/** Lance le chargement de tous les modeles declares. Appele une fois au
 * demarrage : les tours se construisent plusieurs secondes apres, le modele
 * est donc pret en pratique — et sinon le repli procedural s'applique. */
export function preloadTowerModels(): void {
  for (const [defId, url] of Object.entries(TOWER_MODEL_CONFIG)) void load(defId, url);
}

/** Modele pret pour cette tour, ou null s'il n'y en a pas / pas encore. */
export function getTowerModel(defId: string): PreparedTowerModel | null {
  return cache.get(defId) ?? null;
}
