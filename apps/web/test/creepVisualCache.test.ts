import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  getCreepBodyGeometry,
  getCreepRingGeometry,
  getCreepRingMaterial,
  getFrostShardGeometry,
  getFrostShardMaterial,
  disposeCreepVisualCache,
} from '../src/creepVisualCache.js';

describe('creepVisualCache — proprietaire = le cache, pas l\'instance', () => {
  it('renvoie la MEME geometrie de corps pour deux appels avec les memes parametres', () => {
    const a = getCreepBodyGeometry(false, 0.12);
    const b = getCreepBodyGeometry(false, 0.12);
    expect(a).toBe(b);
  });

  it('renvoie des geometries de corps distinctes pour un rayon ou un isAir different', () => {
    const ground = getCreepBodyGeometry(false, 0.12);
    const air = getCreepBodyGeometry(true, 0.12);
    const otherRadius = getCreepBodyGeometry(false, 0.2);
    expect(ground).not.toBe(air);
    expect(ground).not.toBe(otherRadius);
  });

  it('renvoie le meme anneau (geometrie ET materiau) pour un meme rayon/une meme couleur', () => {
    const g1 = getCreepRingGeometry(0.15);
    const g2 = getCreepRingGeometry(0.15);
    expect(g1).toBe(g2);
    const m1 = getCreepRingMaterial('#ff0000');
    const m2 = getCreepRingMaterial('#ff0000');
    expect(m1).toBe(m2);
    // Une couleur differente ne doit jamais reutiliser le materiau d'une autre —
    // sinon changer la teinte d'une lane teindrait les anneaux de toutes les
    // autres.
    const m3 = getCreepRingMaterial('#00ff00');
    expect(m3).not.toBe(m1);
  });

  it('les eclats de givre partagent un materiau UNIQUE (une seule teinte dans tout le jeu)', () => {
    expect(getFrostShardMaterial()).toBe(getFrostShardMaterial());
  });

  it('un grand nombre de "spawns" du meme type ne fait grossir le cache que d\'une entree', () => {
    for (let i = 0; i < 500; i++) getCreepBodyGeometry(false, 0.18);
    // Pas d'API publique pour lire la taille de la Map interne — on verifie
    // indirectement : le meme objet est renvoye a chaque appel, donc aucune
    // geometrie supplementaire n'a pu etre allouee entre le premier et le
    // 500e appel.
    const first = getCreepBodyGeometry(false, 0.18);
    const last = getCreepBodyGeometry(false, 0.18);
    expect(first).toBe(last);
  });

  it('disposeCreepVisualCache() libere bien les ressources en cache', () => {
    const geo = getCreepBodyGeometry(false, 0.33);
    const ringGeo = getCreepRingGeometry(0.33);
    const ringMat = getCreepRingMaterial('#123456');
    const frostGeo = getFrostShardGeometry(0.33);
    const frostMat = getFrostShardMaterial();
    const spies = [geo, ringGeo, ringMat, frostGeo, frostMat].map((r) => vi.spyOn(r, 'dispose'));

    disposeCreepVisualCache();

    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);

    // Un appel apres nettoyage doit reconstruire une geometrie NEUVE et
    // parfaitement utilisable (pas l'ancienne, disposee) — une "unite recreee
    // apres nettoyage" doit s'afficher correctement.
    const rebuilt = getCreepBodyGeometry(false, 0.33);
    expect(rebuilt).not.toBe(geo);
    expect(rebuilt).toBeInstanceOf(THREE.BufferGeometry);
  });
});
