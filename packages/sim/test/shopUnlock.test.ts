import { describe, it, expect } from 'vitest';
import { shops } from '@tower-defense/data';
import { createGame, tick, hashState } from '../src/index.js';

describe('deblocage des paliers de boutique', () => {
  it('debloque avec succes : or debite du bon montant, palier incremente', () => {
    const s = createGame(1, 2);
    const arena = s.arenas[0]!;
    const forgeCost = shops[1]!.goldCost;
    arena.gold = forgeCost + 500;

    const events = tick(s, [{ type: 'unlockShop', player: 0 }]);

    expect(arena.unlockedShopTier).toBe(1);
    expect(arena.gold).toBe(500);
    expect(events.some((e) => e.type === 'shopUnlocked' && e.player === 0 && e.tier === 1)).toBe(true);
  });

  it('or insuffisant : aucun changement d\'etat', () => {
    const s = createGame(1, 2);
    const arena = s.arenas[0]!;
    const forgeCost = shops[1]!.goldCost;
    arena.gold = forgeCost - 1;

    const events = tick(s, [{ type: 'unlockShop', player: 0 }]);

    expect(arena.unlockedShopTier).toBe(0);
    expect(arena.gold).toBe(forgeCost - 1);
    expect(events.some((e) => e.type === 'rejected' && e.reason === 'not enough gold')).toBe(true);
  });

  it('saut de palier refuse : Fonderie impossible sans Forge', () => {
    const s = createGame(1, 2);
    const arena = s.arenas[0]!;
    // Largement assez d'or pour la Fonderie (palier 2) directement, mais la
    // Forge (palier 1) n'a jamais ete achetee — doit rester bloque au palier
    // suivant immediat, jamais un saut.
    arena.gold = shops[2]!.goldCost + 1_000_000;

    tick(s, [{ type: 'unlockShop', player: 0 }]);

    // Un seul appel de unlockShop ne peut debloquer QUE le palier 1 (Forge),
    // jamais directement le palier 2 (Fonderie) — verifie qu'il s'est bien
    // arrete la, pas qu'il a echoue.
    expect(arena.unlockedShopTier).toBe(1);

    // Un second appel, lui, doit reussir (Forge -> Fonderie, sequentiel).
    const events2 = tick(s, [{ type: 'unlockShop', player: 0 }]);
    expect(arena.unlockedShopTier).toBe(2);
    expect(events2.some((e) => e.type === 'shopUnlocked' && e.tier === 2)).toBe(true);
  });

  it('double achat du meme palier refuse : la commande cible toujours le SUIVANT, jamais celui deja acquis', () => {
    const s = createGame(1, 2);
    const arena = s.arenas[0]!;
    const forgeCost = shops[1]!.goldCost;
    // Juste assez pour la Forge une fois, jamais assez pour deux fois de
    // suite au meme prix.
    arena.gold = forgeCost + 10;

    tick(s, [{ type: 'unlockShop', player: 0 }]);
    expect(arena.unlockedShopTier).toBe(1);
    const goldAfterFirstUnlock = arena.gold;

    // Une seconde commande, avec le meme or restant (trop peu pour la
    // Fonderie), doit etre rejetee — la preuve qu'elle vise bien le palier 2
    // et non une repetition du palier 1 deja paye.
    const events = tick(s, [{ type: 'unlockShop', player: 0 }]);
    expect(arena.unlockedShopTier).toBe(1);
    expect(arena.gold).toBe(goldAfterFirstUnlock);
    expect(events.some((e) => e.type === 'rejected' && e.reason === 'not enough gold')).toBe(true);

    // Meme au dernier palier deja acquis, une commande supplementaire echoue
    // proprement (pas de palier 3) sans planter ni degrader l'etat.
    arena.gold = 1_000_000;
    tick(s, [{ type: 'unlockShop', player: 0 }]);
    expect(arena.unlockedShopTier).toBe(2);
    const goldAtMax = arena.gold;
    const eventsAtMax = tick(s, [{ type: 'unlockShop', player: 0 }]);
    expect(arena.unlockedShopTier).toBe(2);
    expect(arena.gold).toBe(goldAtMax);
    expect(eventsAtMax.some((e) => e.type === 'rejected' && e.reason === 'no next shop tier')).toBe(true);
  });

  it('envoi refuse pour un creep d\'une boutique non debloquee, accepte apres deblocage', () => {
    const s = createGame(1, 2);
    const arena = s.arenas[0]!;
    // h00H : vendu par la Forge (shops[1]), jamais par la Caserne.
    const forgeCreepId = shops[1]!.sells[0]!;
    arena.gold = 1_000_000;
    // nextReplenish loin dans le futur : evite qu'updateStock() (appele a
    // chaque tick(), avant les commandes) ne fasse grossir le stock tout
    // seul pendant le test et ne brouille l'assertion sur `count`.
    arena.stock[forgeCreepId] = { availableAt: 0, count: 5, nextReplenish: 1_000_000 };

    const beforeEvents = tick(s, [{ type: 'sendCreep', player: 0, defId: forgeCreepId }]);
    expect(beforeEvents.some((e) => e.type === 'rejected' && e.reason === 'shop not unlocked')).toBe(true);
    expect(arena.stock[forgeCreepId]!.count).toBe(5);

    tick(s, [{ type: 'unlockShop', player: 0 }]);
    expect(arena.unlockedShopTier).toBe(1);

    const afterEvents = tick(s, [{ type: 'sendCreep', player: 0, defId: forgeCreepId }]);
    expect(afterEvents.some((e) => e.type === 'creepSent' && e.defId === forgeCreepId)).toBe(true);
    expect(arena.stock[forgeCreepId]!.count).toBe(4);
  });

  it('preserve le determinisme : deux parties de meme graine, avec des deblocages, produisent le meme hash', () => {
    function run(): string {
      const s = createGame(42, 2);
      for (let i = 0; i < 5; i++) {
        s.arenas[0]!.gold += 50_000;
        tick(s, [{ type: 'unlockShop', player: 0 }]);
      }
      return hashState(s);
    }
    expect(run()).toBe(run());
  });
});
