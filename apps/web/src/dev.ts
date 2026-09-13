import type { Command } from '@tower-defense/sim';

export interface DevToolsDeps {
  pendingHuman: Command[];
  getUnlockedTier: () => number;
}

declare global {
  interface Window {
    __dev?: {
      setGold(n: number): void;
      setLives(n: number): void;
      unlockTier(n: number): void;
      disableSendTimers(): void;
    };
  }
}

/** Outil de test manuel (console navigateur), jamais appele par le jeu
 * lui-meme — voir main.ts pour l'activation (?dev=1, chargee dynamiquement
 * derriere `if (import.meta.env.DEV)` : ce module est absent du bundle de
 * prod, tree-shake par Vite). Passe systematiquement par `pendingHuman`,
 * la meme file d'attente que les vrais clics de l'UI, jamais par une
 * ecriture directe dans `state` : les commandes de triche restent donc
 * soumises aux memes regles de validation que le jeu normal (ex: acheter un
 * creep reste bloque si le palier de boutique n'est pas debloque). */
export function installDevTools(deps: DevToolsDeps): void {
  window.__dev = {
    setGold(n) {
      deps.pendingHuman.push({ type: 'debugSetGold', player: 0, amount: n });
      console.log(`[dev] setGold(${n})`);
    },
    setLives(n) {
      deps.pendingHuman.push({ type: 'debugSetLives', player: 0, amount: n });
      console.log(`[dev] setLives(${n})`);
    },
    unlockTier(n) {
      // API 1-indexee (tier 1 = Caserne, deja debloquee par defaut ; tier 2 =
      // Forge ; tier 3 = Fonderie) — traduite vers l'index interne 0-indexe
      // `unlockedShopTier` via des dispatches repetes de la commande
      // sequentielle existante 'unlockShop' (elle ne debloque jamais qu'un
      // SEUL palier, toujours le suivant — voir packages/sim/src/sim.ts) :
      // aucune nouvelle commande sim necessaire pour celle-ci.
      const target = n - 1;
      const current = deps.getUnlockedTier();
      for (let i = current; i < target; i++) {
        deps.pendingHuman.push({ type: 'unlockShop', player: 0 });
      }
      console.log(`[dev] unlockTier(${n})`);
    },
    disableSendTimers() {
      deps.pendingHuman.push({ type: 'debugMaxStock', player: 0 });
      console.log('[dev] disableSendTimers()');
    },
  };
  console.log('[dev] window.__dev ready: setGold(n), setLives(n), unlockTier(n), disableSendTimers()');
}
