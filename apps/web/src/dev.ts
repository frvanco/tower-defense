import type { Command } from '@tower-defense/sim';

export interface DevToolsDeps {
  pendingHuman: Command[];
  getUnlockedTier: () => number;
  /** Camera et cible courantes, pour `camera()` ci-dessous. */
  getCamera: () => { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } };
}

declare global {
  interface Window {
    __dev?: {
      setGold(n: number): void;
      setLives(n: number): void;
      unlockTier(n: number): void;
      disableSendTimers(): void;
      camera(): { position: [number, number, number]; target: [number, number, number] };
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
    /**
     * Releve le cadrage courant. Sert a figer un cadrage trouve a la souris :
     * on oriente la vue comme on la veut, on appelle ceci, et on recopie les
     * deux lignes affichees dans INITIAL_CAMERA_POSITION / _TARGET
     * (apps/web/src/scene3d.ts). Reconstituer ces valeurs depuis une capture
     * d'ecran ne donne qu'une approximation.
     */
    camera() {
      const { position, target } = deps.getCamera();
      const r = (n: number) => Math.round(n * 100) / 100;
      const out = {
        position: [r(position.x), r(position.y), r(position.z)] as [number, number, number],
        target: [r(target.x), r(target.y), r(target.z)] as [number, number, number],
      };
      console.log(
        `[dev] cadrage courant — a recopier dans scene3d.ts :\n` +
          `  INITIAL_CAMERA_POSITION = [${out.position.join(', ')}]\n` +
          `  INITIAL_CAMERA_TARGET   = [${out.target.join(', ')}]`,
      );
      return out;
    },
  };
  console.log('[dev] window.__dev ready: setGold(n), setLives(n), unlockTier(n), disableSendTimers(), camera()');
}
