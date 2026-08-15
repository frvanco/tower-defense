import * as THREE from 'three';
import { buildSlots, SLOT_SIZE } from '@tower-defense/data';
import type { Arena } from '@tower-defense/sim';
import { worldToScene, type Frame3D } from './world3d.js';
import { PLATFORM_HEIGHT } from './terrain3d.js';

/**
 * Contours discrets au sol pour chaque emplacement de construction du joueur
 * 0 — le joueur ne doit jamais avoir a viser a l'oeil : il approche le
 * curseur, une case s'allume (voir `update`), il clique. Les emplacements
 * occupes sont masques (la tour posee dessus suffit a le signaler).
 */
export interface SlotMarkers {
  group: THREE.Group;
  update(arena: Arena, hoveredSlotId: string | null): void;
}

const FREE_COLOR = 0xc9a227;
const HOVER_COLOR = 0xf2d24b;

export function createSlotMarkers(frame: Frame3D): SlotMarkers {
  const group = new THREE.Group();
  group.name = 'buildSlots';

  const outerR = (SLOT_SIZE / 2) * frame.scale * 0.92;
  const innerR = outerR * 0.86;

  const meshes = new Map<string, THREE.Mesh>();
  for (const slot of buildSlots(0)) {
    const [sx, sz] = worldToScene(frame, slot.x, slot.y);
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(innerR, outerR, 20),
      new THREE.MeshBasicMaterial({ color: FREE_COLOR, transparent: true, opacity: 0.28, side: THREE.DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(sx, PLATFORM_HEIGHT + 0.012, sz);
    group.add(mesh);
    meshes.set(slot.id, mesh);
  }

  function update(arena: Arena, hoveredSlotId: string | null): void {
    for (const [id, mesh] of meshes) {
      mesh.visible = !arena.occupied[id];
      const hovered = id === hoveredSlotId;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(hovered ? HOVER_COLOR : FREE_COLOR);
      mat.opacity = hovered ? 0.75 : 0.28;
    }
  }

  return { group, update };
}
