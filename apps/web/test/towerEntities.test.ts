import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import type { Arena, Tower } from '@tower-defense/sim';
import { MAT, teamMaterial, isSharedTowerMaterial } from '@tower-defense/renderer';
import type { Frame3D } from '../src/world3d.js';

// entities3d.ts precharge les modeles GLB des creeps humanoides des son
// import (voir HUMANOID_MODEL_URLS) via GLTFLoader/fetch — indisponible sous
// Node/vitest (pas de `window`, URLs relatives non resolvables). Hors sujet
// pour ces tests, qui ne portent que sur TowerEntities : on la neutralise.
vi.mock('../src/animatedCreepModel.js', () => ({
  loadAnimatedCreepModel: vi.fn(() => Promise.resolve(null)),
  getAnimatedCreepModel: vi.fn(() => null),
}));

const { TowerEntities } = await import('../src/entities3d.js');

const FRAME: Frame3D = { scale: 0.03, centerX: 0, centerY: 0, halfWidth: 10, halfHeight: 10 };

function makeArena(towers: Tower[]): Arena {
  return {
    player: 0,
    alive: true,
    gold: 0,
    income: 0,
    lives: 20,
    towers,
    creeps: [],
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

/** Compte toutes les geometries/materiaux d'un groupe (pour espionner leurs
 * dispose() avant qu'ils ne soient retires par TowerEntities). */
function collectDisposables(group: THREE.Object3D): { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.push(mesh.geometry);
    const m = mesh.material as THREE.Material | THREE.Material[];
    for (const mat of Array.isArray(m) ? m : [m]) materials.push(mat);
  });
  return { geometries, materials };
}

describe('TowerEntities — cycle de vie des ressources (build/upgrade/vente/clear)', () => {
  let layer: THREE.Group;
  let entities: TowerEntities;

  beforeEach(() => {
    layer = new THREE.Group();
    entities = new TowerEntities(layer, FRAME, 0xc0392b);
  });

  it('construction puis vente repetee de nombreuses tours dispose bien geometrie ET materiaux propres', () => {
    for (let round = 0; round < 30; round++) {
      const tower: Tower = { eid: round, defId: 'h000', x: 0, y: 0, cooldown: 0, slotId: `s${round}` };
      entities.sync(makeArena([tower]));
      const group = entities.groupFor(round)!;
      const { geometries, materials } = collectDisposables(group);
      const geoSpies = geometries.map((g) => vi.spyOn(g, 'dispose'));
      const matSpies = materials
        .filter((m) => !isSharedTowerMaterial(m))
        .map((m) => vi.spyOn(m, 'dispose'));
      const sharedUsed = materials.filter((m) => isSharedTowerMaterial(m));
      expect(sharedUsed.length).toBeGreaterThan(0); // la tour utilise bien MAT.*

      // Vente : plus aucune tour dans l'arene la manche suivante.
      entities.sync(makeArena([]));

      for (const s of geoSpies) expect(s).toHaveBeenCalledTimes(1);
      for (const s of matSpies) expect(s).toHaveBeenCalledTimes(1);
    }
    expect(layer.children.length).toBe(0);
  });

  it('un upgrade dispose l\'ANCIEN groupe (pas le nouveau) et ne touche jamais aux materiaux partages', () => {
    const t0: Tower = { eid: 1, defId: 'h000', x: 0, y: 0, cooldown: 0, slotId: 's1' };
    entities.sync(makeArena([t0]));
    const oldGroup = entities.groupFor(1)!;
    const { geometries: oldGeo, materials: oldMat } = collectDisposables(oldGroup);
    const oldGeoSpies = oldGeo.map((g) => vi.spyOn(g, 'dispose'));
    const oldMatSpies = oldMat.filter((m) => !isSharedTowerMaterial(m)).map((m) => vi.spyOn(m, 'dispose'));
    const sharedMatSpies = [...new Set(oldMat.filter((m) => isSharedTowerMaterial(m)))].map((m) => vi.spyOn(m, 'dispose'));

    const t1: Tower = { eid: 1, defId: 'h003', x: 0, y: 0, cooldown: 0, slotId: 's1' };
    entities.sync(makeArena([t1]));

    for (const s of oldGeoSpies) expect(s).toHaveBeenCalledTimes(1);
    for (const s of oldMatSpies) expect(s).toHaveBeenCalledTimes(1);
    for (const s of sharedMatSpies) expect(s).not.toHaveBeenCalled();

    const newGroup = entities.groupFor(1)!;
    expect(newGroup).not.toBe(oldGroup);
    const { geometries: newGeo } = collectDisposables(newGroup);
    // Le nouveau groupe reste parfaitement utilisable (pas de geometrie deja
    // disposee par erreur).
    expect(newGeo.length).toBeGreaterThan(0);
  });

  it('clear() dispose toutes les tours restantes sans jamais toucher MAT.* ni teamMaterial()', () => {
    const towers: Tower[] = [
      { eid: 1, defId: 'h000', x: 0, y: 0, cooldown: 0, slotId: 's1' },
      { eid: 2, defId: 'o001', x: 1, y: 1, cooldown: 0, slotId: 's2' },
      { eid: 3, defId: 'h005', x: 2, y: 2, cooldown: 0, slotId: 's3' },
    ];
    entities.sync(makeArena(towers));
    const sharedSpy = vi.spyOn(teamMaterial(0xc0392b), 'dispose');
    const matStoneSpy = vi.spyOn(MAT.stone, 'dispose');

    entities.clear();

    expect(sharedSpy).not.toHaveBeenCalled();
    expect(matStoneSpy).not.toHaveBeenCalled();
    expect(layer.children.length).toBe(0);
  });

  it('une tour reconstruite apres clear() est un groupe neuf et fonctionnel (pas un residu disposé)', () => {
    const t: Tower = { eid: 1, defId: 'h000', x: 0, y: 0, cooldown: 0, slotId: 's1' };
    entities.sync(makeArena([t]));
    entities.clear();
    entities.sync(makeArena([t]));
    const group = entities.groupFor(1)!;
    expect(group).toBeDefined();
    expect(group.children.length).toBeGreaterThan(0);
    expect(layer.children).toContain(group);
  });
});
