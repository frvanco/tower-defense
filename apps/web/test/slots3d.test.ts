import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildSlots } from '@tower-defense/data';
import type { Arena } from '@tower-defense/sim';
import { createSlotMarkers } from '../src/slots3d.js';
import type { Frame3D } from '../src/world3d.js';

const FRAME: Frame3D = { scale: 0.03, centerX: 0, centerY: 0, halfWidth: 10, halfHeight: 10 };

function makeArena(): Arena {
  return {
    player: 0,
    alive: true,
    gold: 0,
    income: 0,
    lives: 20,
    towers: [],
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

describe('SlotMarkers', () => {
  it('regroupe les emplacements dans une instance et ne les affiche qu’en construction', () => {
    const markers = createSlotMarkers(FRAME);
    const instances = markers.group.getObjectByName('availableBuildSlots') as THREE.InstancedMesh;

    expect(markers.group.visible).toBe(false);
    expect(instances).toBeInstanceOf(THREE.InstancedMesh);
    expect(instances.count).toBe(buildSlots(0).length);

    markers.update(makeArena(), null, true);
    expect(markers.group.visible).toBe(true);

    markers.update(makeArena(), null, false);
    expect(markers.group.visible).toBe(false);
  });

  it('masque une instance occupee sans recreer la geometrie', () => {
    const markers = createSlotMarkers(FRAME);
    const instances = markers.group.getObjectByName('availableBuildSlots') as THREE.InstancedMesh;
    const firstSlot = buildSlots(0)[0]!;
    const arena = makeArena();
    arena.occupied[firstSlot.id] = true;

    const geometry = instances.geometry;
    markers.update(arena, firstSlot.id, true);

    const matrix = new THREE.Matrix4();
    instances.getMatrixAt(0, matrix);
    expect(matrix.getMaxScaleOnAxis()).toBe(0);
    expect(instances.geometry).toBe(geometry);
    expect(markers.group.getObjectByName('hoveredBuildSlot')?.visible).toBe(true);
  });
});
