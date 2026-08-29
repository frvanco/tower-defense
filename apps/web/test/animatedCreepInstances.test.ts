import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AnimatedCreepController } from '../src/animatedCreepInstances.js';
import type { AnimatedCreepModel } from '../src/animatedCreepModel.js';

function makeModel(): AnimatedCreepModel {
  const pose = new THREE.Matrix4();
  return {
    nodeNames: ['Rig'],
    geometries: [new THREE.BoxGeometry(1, 1, 1)],
    material: new THREE.MeshBasicMaterial(),
    restMatrices: [pose],
    scale: 1,
    groundOffsetY: 0,
    walkFrames: [[pose]],
    walkClipDuration: 1,
    deathFrames: [[pose]],
    deathClipDuration: 1,
    headingOffset: Math.PI,
  };
}

describe('AnimatedCreepController', () => {
  it('ne laisse pas un volume de culling obsolete masquer les creeps mobiles', () => {
    const model = makeModel();
    const controller = new AnimatedCreepController(model);
    const meshes: THREE.InstancedMesh[] = [];
    controller.sceneGroup.traverse((object) => {
      if ((object as THREE.InstancedMesh).isInstancedMesh) meshes.push(object as THREE.InstancedMesh);
    });

    expect(meshes).toHaveLength(model.geometries.length);
    expect(meshes.every((mesh) => mesh.frustumCulled === false)).toBe(true);

    model.geometries.forEach((geometry) => geometry.dispose());
    model.material.dispose();
  });
});
