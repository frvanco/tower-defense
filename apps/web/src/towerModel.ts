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
  // Balistique
  h000: '/models/towers/balistique/lv1_balistique.glb', // Tourelle       — palier 1
  h004: '/models/towers/balistique/lv2_balistique.glb', // Canon          — palier 2
  h002: '/models/towers/balistique/lv3_balistique.glb', // Canon lourd    — palier 3
  h012: '/models/towers/balistique/lv4_balistique.glb', // Obusier        — palier 4
  h010: '/models/towers/balistique/lv5_balistique.glb', // Canon à rail   — palier 5
  // Acide
  o001: '/models/towers/acide/lv1_acide.glb', // Acide        — palier 1
  o002: '/models/towers/acide/lv2_acide.glb', // Corrosive    — palier 2
  o000: '/models/towers/acide/lv3_acide.glb', // Dissolvante  — palier 3
  o006: '/models/towers/acide/lv4_acide.glb', // Nécrose      — palier 4
  o00D: '/models/towers/acide/lv5_acide.glb', // Solvant      — palier 5
  // Anti-aérien
  h005: '/models/towers/anti-aerien/lv1_anti-aerien.glb', // Flak     — palier 1
  h006: '/models/towers/anti-aerien/lv2_anti-aerien.glb', // Arc      — palier 2
  h007: '/models/towers/anti-aerien/lv3_anti-aerien.glb', // Foudre   — palier 3
  h013: '/models/towers/anti-aerien/lv4_anti-aerien.glb', // Orage    — palier 4
  h011: '/models/towers/anti-aerien/lv5_anti-aerien.glb', // Tempête  — palier 5
  // Cadence
  o008: '/models/towers/cadence/lv1_cadence.glb', // Répétiteur   — palier 1
  o009: '/models/towers/cadence/lv2_cadence.glb', // Mitrailleuse — palier 2
  o00A: '/models/towers/cadence/lv3_cadence.glb', // Gatling      — palier 3
  o00B: '/models/towers/cadence/lv4_cadence.glb', // Fauchoir     — palier 4
  o00E: '/models/towers/cadence/lv5_cadence.glb', // Moissonneuse — palier 5
  // Réacteur — 2 paliers seulement, mais alignes sur les paliers 4-5 (late
  // game, 30 000 et 180 000 or) : budget d'emprise resserre des le premier.
  // Ces deux modeles n'ont ni Barrel_Recoil ni clip Fire — un reacteur n'a pas
  // de canon qui recule. Le rendu le gere : pas de mixer, pas de recul.
  h008: '/models/towers/reacteur/lv1_reacteur.glb', // Réacteur          — palier 1
  h00T: '/models/towers/reacteur/lv2_reacteur.glb', // Soleil artificiel — palier 2
  // Givre
  o003: '/models/towers/givre/lv1_givre.glb', // Givre        — palier 1
  o004: '/models/towers/givre/lv2_givre.glb', // Gel          — palier 2
  o005: '/models/towers/givre/lv3_givre.glb', // Blizzard     — palier 3
  o007: '/models/towers/givre/lv4_givre.glb', // Cryogène     — palier 4
  o00C: '/models/towers/givre/lv5_givre.glb', // Zéro absolu  — palier 5
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
