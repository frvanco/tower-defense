import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import type { Arena, Creep } from '@tower-defense/sim';
import type { Frame3D } from '../src/world3d.js';

// entities3d.ts precharge les modeles GLB des creeps humanoides des son
// import (voir HUMANOID_MODEL_URLS) via GLTFLoader/fetch — indisponible sous
// Node/vitest (pas de `window`, URLs relatives non resolvables). Ces tests
// visent explicitement le chemin sphere/cone generique (aucun modele dedie
// pour GENERIC_DEF_ID) : on neutralise le chargement plutot que de le
// laisser echouer en arriere-plan.
vi.mock('../src/animatedCreepModel.js', () => ({
  loadAnimatedCreepModel: vi.fn(() => Promise.resolve(null)),
  getAnimatedCreepModel: vi.fn(() => null),
}));

const { CreepEntities } = await import('../src/entities3d.js');

const FRAME: Frame3D = { scale: 0.03, centerX: 0, centerY: 0, halfWidth: 10, halfHeight: 10 };
// h00A : creep generique (pas de modele GLB dedie — voir HUMANOID_MODEL_URLS
// dans entities3d.ts, restreint a n000/h001/h009), passe donc systematiquement
// par le chemin sphere/cone.
const GENERIC_DEF_ID = 'h00A';

function makeArena(creeps: Creep[]): Arena {
  return {
    player: 0,
    alive: true,
    gold: 0,
    income: 0,
    lives: 20,
    towers: [],
    creeps,
    stock: {},
    occupied: {},
    leaked: 0,
    killed: 0,
    goldSpentOnTowers: 0,
    goldSpentOnCreeps: 0,
    goldFromBounty: 0,
    goldFromIncome: 0,
  };
}

function findBody(layer: THREE.Group): THREE.Mesh {
  const body = layer.children.find(
    (o): o is THREE.Mesh => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).material instanceof THREE.MeshLambertMaterial,
  );
  if (!body) throw new Error('corps de creep introuvable dans le layer');
  return body;
}

function findRings(layer: THREE.Group): THREE.Mesh[] {
  return layer.children.filter(
    (o): o is THREE.Mesh => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry?.type === 'RingGeometry',
  );
}

describe('CreepEntities — cycle de vie des creeps generiques (sphere/cone)', () => {
  let layer: THREE.Group;
  let entities: CreepEntities;

  // Pas de jsdom/happy-dom dans ce depot (vitest tourne en environnement Node
  // pur) — makeHpBar() n'a besoin de `document.createElement('canvas')` que
  // pour peindre la barre de vie, un aspect visuel hors du perimetre de ces
  // tests (disposition/ownership des ressources). Un stub minimal suffit,
  // plutot que d'ajouter une dependance jsdom au projet pour ca.
  beforeAll(() => {
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag !== 'canvas') throw new Error(`stub document: element inattendu "${tag}"`);
        return {
          width: 0,
          height: 0,
          getContext: () => ({ clearRect: () => {}, fillRect: () => {}, fillStyle: '' }),
        };
      },
    });
  });
  afterAll(() => vi.unstubAllGlobals());

  beforeEach(() => {
    layer = new THREE.Group();
    entities = new CreepEntities(layer, FRAME, new Map([[0, '#c0392b']]));
  });

  it('la geometrie/le materiau d\'anneau sont PARTAGES entre creeps du meme rayon/de la meme lane', () => {
    const c1: Creep = { eid: 1, defId: GENERIC_DEF_ID, x: 0, y: 0, hp: 900, wp: 0, sender: 0 };
    const c2: Creep = { eid: 2, defId: GENERIC_DEF_ID, x: 1, y: 1, hp: 900, wp: 0, sender: 0 };
    entities.sync(makeArena([c1, c2]), 0, 0.016);

    const rings = findRings(layer);
    expect(rings.length).toBe(2);
    expect(rings[0]!.geometry).toBe(rings[1]!.geometry);
    expect(rings[0]!.material).toBe(rings[1]!.material);
  });

  it('mort en masse : le materiau du CORPS est dispose par instance, la geometrie/l\'anneau partages ne le sont jamais', () => {
    // Reference de depart : la geometrie/le materiau d'anneau et la
    // geometrie de corps de CE type de creep, tels qu'effectivement utilises
    // (pas recalcules a la main — evite toute divergence avec creepRadius()).
    const seed: Creep = { eid: -1, defId: GENERIC_DEF_ID, x: 0, y: 0, hp: 900, wp: 0, sender: 0 };
    entities.sync(makeArena([seed]), 0, 0.016);
    const seedBody = findBody(layer);
    const seedRing = findRings(layer)[0]!;
    const bodyGeoSpy = vi.spyOn(seedBody.geometry, 'dispose');
    const ringGeoSpy = vi.spyOn(seedRing.geometry, 'dispose');
    const ringMatSpy = vi.spyOn(seedRing.material as THREE.Material, 'dispose');
    entities.sync(makeArena([]), 0, 0.016); // la seed meurt aussi

    const bodyMaterialDisposeSpies: ReturnType<typeof vi.spyOn>[] = [];
    for (let round = 0; round < 200; round++) {
      const c: Creep = { eid: round, defId: GENERIC_DEF_ID, x: 0, y: 0, hp: 900, wp: 0, sender: 0 };
      entities.sync(makeArena([c]), 0, 0.016);
      const body = findBody(layer);
      bodyMaterialDisposeSpies.push(vi.spyOn(body.material as THREE.Material, 'dispose'));
      // La sim retire le creep la frame suivante (mort).
      entities.sync(makeArena([]), 0, 0.016);
    }

    for (const spy of bodyMaterialDisposeSpies) expect(spy).toHaveBeenCalledTimes(1);
    expect(ringGeoSpy).not.toHaveBeenCalled();
    expect(ringMatSpy).not.toHaveBeenCalled();
    expect(bodyGeoSpy).not.toHaveBeenCalled();
    // Plus aucun objet vivant dans le layer une fois tous les creeps morts —
    // seul reste le mesh instancie permanent des bulles de poison (ajoute une
    // fois pour toutes par le constructeur, jamais retire en cours de partie).
    expect(layer.children.length).toBe(1);
  });

  it('clear() dispose les materiaux de corps propres mais jamais les geometries/materiaux d\'anneau partages', () => {
    const creeps: Creep[] = [
      { eid: 1, defId: GENERIC_DEF_ID, x: 0, y: 0, hp: 900, wp: 0, sender: 0 },
      { eid: 2, defId: GENERIC_DEF_ID, x: 1, y: 1, hp: 900, wp: 0, sender: 0 },
    ];
    entities.sync(makeArena(creeps), 0, 0.016);
    const bodies = layer.children.filter(
      (o): o is THREE.Mesh => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).material instanceof THREE.MeshLambertMaterial,
    );
    const bodySpies = bodies.map((b) => vi.spyOn(b.material as THREE.Material, 'dispose'));
    const ring = findRings(layer)[0]!;
    const ringMatSpy = vi.spyOn(ring.material as THREE.Material, 'dispose');
    const ringGeoSpy = vi.spyOn(ring.geometry, 'dispose');

    entities.clear();

    for (const s of bodySpies) expect(s).toHaveBeenCalledTimes(1);
    expect(ringMatSpy).not.toHaveBeenCalled();
    expect(ringGeoSpy).not.toHaveBeenCalled();
    // Seul reste le mesh instancie permanent des bulles de poison (voir
    // l'autre test ci-dessus).
    expect(layer.children.length).toBe(1);
  });

  it('un creep recree apres clear() reutilise la geometrie en cache et s\'affiche correctement', () => {
    const c: Creep = { eid: 1, defId: GENERIC_DEF_ID, x: 0, y: 0, hp: 900, wp: 0, sender: 0 };
    entities.sync(makeArena([c]), 0, 0.016);
    entities.clear();
    entities.sync(makeArena([c]), 0, 0.016);
    const body = findBody(layer);
    expect(body.geometry).toBeDefined();
    expect(entities.counts.alive).toBe(1);
  });
});
