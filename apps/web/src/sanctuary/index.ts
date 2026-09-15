import * as THREE from 'three';
import type { Lane } from '@tower-defense/data';
import type { Frame3D } from '../world3d.js';
import { playerColor } from '../colors.js';
import { DecorBatch, DecorResources } from './batch.js';
import { sanctuaryLayout } from './layout.js';
import { addBridge, addCastle, addRuins, addWorkshop } from './structures.js';
import type { Sanctuary, SanctuaryOptions } from './types.js';
export type { Sanctuary, SanctuaryOptions } from './types.js';

function randomSequence(): () => number {
  let seed = 0x5ace2026;
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
}

/** Decor statique local a une scene; les changements de joueur ne font que reteinter. */
export function createSanctuary(lane: Lane, frame: Frame3D, options: SanctuaryOptions = {}): Sanctuary {
  const resources = new DecorResources(options.colors);
  const group = new THREE.Group();
  group.name = 'sanctuary';
  group.visible = options.enabled ?? true;
  const density = THREE.MathUtils.clamp(options.density ?? 1, 0, 2);
  const layout = sanctuaryLayout(lane, frame);
  const { minX, maxX, minZ, maxZ, gate, direction, halfPath } = layout;
  const depth = maxZ - minZ;
  const rand = randomSequence();

  const castle = new DecorBatch(resources, 'sanctuary-castle', true);
  addCastle(castle, gate[0], gate[1], 0);
  // Ce parvis est purement visuel: il commence apres la capsule du parcours.
  const end = layout.path[layout.path.length - 1]!;
  const startX = end[0] + direction[0] * halfPath;
  const parvisWidth = Math.abs(gate[0] - startX);
  castle.add('stone', 'stone', [(startX + gate[0]) / 2, -0.055, end[1]], [parvisWidth, 0.12, halfPath * 1.7]);
  castle.add('stone', 'stone', [gate[0], -0.055, (end[1] + gate[1]) / 2], [halfPath * 1.7, 0.12, gate[1] - end[1]]);
  group.add(castle.finish());

  const workshops = new DecorBatch(resources, 'sanctuary-workshops', true);
  const workshopX = minX - 5.5;
  const workshopZ = minZ + depth * 0.67;
  addWorkshop(workshops, workshopX, workshopZ, -0.15, 0);
  addWorkshop(workshops, workshopX - 0.5, workshopZ + 8.5, 0.12, 1);
  group.add(workshops.finish());

  // Le lit est en creux dans les berges: eau opaque, sans reflet ni animation.
  // Tout est au-dessus du grand sol existant, sous le niveau du plateau.
  const river = new DecorBatch(resources, 'sanctuary-river');
  const riverX = maxX + 7.4;
  const riverStart = minZ - 24;
  const riverEnd = maxZ - 9;
  const sections = 64;
  const step = (riverEnd - riverStart) / sections;
  const riverCenter = (z: number) => riverX + Math.sin((z - riverStart) * 0.13) * 1.25;
  const bridgeZ = minZ + depth * 0.46;
  for (let i = 0; i < sections; i++) {
    const z = riverStart + step * (i + 0.5);
    const x = riverCenter(z);
    river.add('box', 'sand', [x, 0.01, z], [7.2, 0.08, step + 0.12]);
    river.add('box', 'water', [x, 0.075, z], [4.6, 0.04, step + 0.05], [0, 0, 0], i % 4 === 0 ? 0xf0f6f5 : 0xffffff);
    // Reflets peints geometriques, rares et opaques.
    if (i % 3 === 0) river.add('box', 'water', [x + rand() - 0.5, 0.099, z], [0.7 + rand(), 0.006, 0.045], [0, 0, 0], 0xd6f7eb);
    for (const side of [-1, 1]) {
      river.add('rock', 'sand', [x + side * 3.2, 0.06, z], [1.15, 0.55, step * 0.86], [0, rand(), 0]);
      river.add('rock', 'stone', [x + side * (2.4 + rand() * 0.4), 0.18, z + rand() * 0.5], [0.45 + rand() * 0.4, 0.3 + rand() * 0.5, 0.7], [0, rand() * 3, 0], 0xc4cabe);
      if (i % 3 === 0) river.add('sphere', 'moss', [x + side * 3.8, 0.28, z], [0.65, 0.55, 0.75]);
    }
  }
  const sourceX = riverCenter(riverEnd);
  river.add('rock', 'stone', [sourceX, 0.7, riverEnd + 1.6], [3.2, 1.45, 2.2]);
  river.add('box', 'water', [sourceX, 1.98, riverEnd + 1.1], [2.7, 0.04, 1.7]);
  river.add('box', 'water', [sourceX, 1.04, riverEnd + 0.22], [2.7, 1.84, 0.055]);
  for (const side of [-1, 1]) {
    river.add('rock', 'stone', [sourceX + side * 1.9, 1.1, riverEnd + 0.65], [0.7, 1.6, 1.1]);
    river.add('sphere', 'moss', [sourceX + side * 2.3, 2, riverEnd + 1.1], [0.8, 0.6, 0.9]);
  }
  addBridge(river, riverCenter(bridgeZ), bridgeZ);
  group.add(river.finish());

  const ruins = new DecorBatch(resources, 'sanctuary-ruins', true);
  addRuins(ruins, minX - 5.2, minZ + depth * 0.34, 0.3, 0);
  addRuins(ruins, minX - 4.8, minZ + depth * 0.11, -0.35, 2);
  addRuins(ruins, maxX + 4.7, maxZ - 4, -0.4, 1);
  addRuins(ruins, -5, maxZ + 5.5, -0.08, 0);
  addRuins(ruins, 5.3, maxZ + 7, 0.25, 2);
  group.add(ruins.finish());

  const tree = (batch: DecorBatch, x: number, z: number, scale: number) => {
    if (!layout.isClear(x, z, scale * 2.1)) return;
    if (Math.hypot(x - gate[0], z - gate[1] - 3) < 6.5) return;
    const rotation = rand() * Math.PI * 2;
    batch.add('rock', 'sand', [x, 0.06, z], [scale * 2.1, scale * 0.28, scale * 1.8], [0, rotation, 0]);
    for (let bush = 0; bush < 4; bush++) {
      const angle = rotation + bush * 1.8;
      batch.add('sphere', 'leaf', [x + Math.cos(angle) * scale, 0.4, z + Math.sin(angle) * scale], [scale * 0.75, scale * 0.6, scale * 0.8], [0, angle, 0], bush % 2 ? 0xc3d49b : 0xffffff);
    }
    batch.add('cylinder', 'wood', [x, scale * 1.4, z], [scale * 0.23, scale * 2.8, scale * 0.25], [0.05, rotation, -0.08]);
    for (let root = 0; root < 3; root++) {
      const angle = rotation + root * Math.PI * 2 / 3;
      batch.add('rock', 'wood', [x + Math.cos(angle) * scale * 0.35, 0.12, z + Math.sin(angle) * scale * 0.35], [scale * 0.7, scale * 0.16, scale * 0.2], [0, -angle, 0]);
    }
    for (let crown = 0; crown < 5; crown++) {
      const angle = rotation + crown * 2.4;
      const radius = crown === 0 ? 0 : scale * 0.85;
      const y = scale * (crown === 0 ? 3.8 : 3.15);
      batch.add('sphere', 'leaf', [x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius], [scale * 1.22, scale * 1.05, scale * 1.1], [0, angle, 0], [0xffffff, 0xb7d797, 0xd3de99, 0x88b394, 0xc2ce91][crown]!);
    }
  };

  for (const side of [-1, 0, 1]) {
    const foliage = new DecorBatch(resources, `sanctuary-grove-${side}`, true);
    const count = Math.round((side === 0 ? 24 : 28) * density);
    for (let i = 0; i < count; i++) {
      const x = side === 0 ? minX - 8 + rand() * (maxX - minX + 16) : (side < 0 ? minX : maxX) + side * (11 + rand() * 9);
      const z = side === 0 ? maxZ + 7 + rand() * 9 : minZ + depth * (0.16 + rand() * 0.98);
      tree(foliage, x, z, 0.9 + rand() * 0.75);
    }
    // Bouquets bas pres des murs, premier plan sans arbres hauts.
    for (let i = 0; i < Math.round(50 * density); i++) {
      const x = side === 0 ? minX + rand() * (maxX - minX) : (side < 0 ? minX : maxX) + side * (0.8 + rand() * 2.0);
      const z = side === 0 ? minZ - 1 - rand() * 1.5 : minZ + rand() * depth;
      if (!layout.isClear(x, z, 0.85)) continue;
      if (x > Math.min(end[0], gate[0]) - halfPath && x < Math.max(end[0], gate[0]) + halfPath
        && z > end[1] - halfPath - 0.8 && z < gate[1] + 1.5) continue;
      foliage.add('rock', 'stone', [x, 0.12, z], [0.3 + rand() * 0.4, 0.22 + rand() * 0.3, 0.4], [0.1, rand() * 6, 0.1], 0xb9bca5);
      for (let j = 0; j < 3; j++) foliage.add('sphere', 'leaf', [x + (rand() - 0.5) * 0.6, 0.25, z + (rand() - 0.5) * 0.5], [0.35, 0.35 + rand() * 0.25, 0.38], [0, rand(), 0], j === 0 ? 0xc7d58b : 0xffffff);
    }
    group.add(foliage.finish());
  }

  let disposed = false;
  return {
    group,
    setEnabled(enabled) { if (!disposed) group.visible = enabled; },
    setPlayer(player) { if (!disposed) resources.materials.team.color.set(playerColor(player)); },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      // InstancedMesh possede aussi des buffers d'instances, distincts des geometries.
      group.traverse((object) => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
      group.clear();
      resources.dispose();
    },
  };
}
