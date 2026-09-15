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
  update(arena: Arena, hoveredSlotId: string | null, active: boolean): void;
}

/**
 * Ivoire et non dore : les plateaux sont une pelouse vert vif, et jaune sur
 * vert est l'une des paires les moins contrastees qui soient — les anneaux
 * d'origine (dore a 0.16, cales sur l'ancien terrain brun sombre)
 * disparaissaient purement et simplement sur le nouveau decor. L'ivoire fait
 * en plus echo aux dalles de pierre du chemin plutot que de jurer avec.
 *
 * Un anneau SOMBRE contraste encore mieux, mais 236 cercles fonces quadrillent
 * lourdement la pelouse ; ces marqueurs sont censes rester discrets. Si la
 * lisibilite prime un jour sur la discretion, 0x14200f a 0.34 est le reglage
 * essaye et retenu comme solution de repli.
 */
const FREE_COLOR = 0xf2f5e6;
const FREE_OPACITY = 0.38;

/** Survol : jaune sature, la couleur de signalement du projet. Il reste lisible
 * a cette opacite, et son anneau depasse du fantome de pose (dont le rayon est
 * plus petit) — c'est ce liseré qui se voit, pas le disque. */
const HOVER_COLOR = 0xf2d24b;
const OCCUPIED_COLOR = 0xd0503c;

export function createSlotMarkers(frame: Frame3D): SlotMarkers {
  const group = new THREE.Group();
  group.name = 'buildSlots';
  group.visible = false;

  const outerR = (SLOT_SIZE / 2) * frame.scale * 0.92;
  const innerR = outerR * 0.86;
  const slots = buildSlots(0);
  const geometry = new THREE.RingGeometry(innerR, outerR, 20);
  const material = new THREE.MeshBasicMaterial({
    color: FREE_COLOR,
    transparent: true,
    opacity: FREE_OPACITY,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const markers = new THREE.InstancedMesh(geometry, material, slots.length);
  markers.name = 'availableBuildSlots';
  markers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  markers.renderOrder = 4;

  const positions = new Map<string, THREE.Vector3>();
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const matrix = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const zero = new THREE.Vector3(0, 0, 0);

  slots.forEach((slot, index) => {
    const [sx, sz] = worldToScene(frame, slot.x, slot.y);
    const position = new THREE.Vector3(sx, PLATFORM_HEIGHT + 0.014, sz);
    positions.set(slot.id, position);
    markers.setMatrixAt(index, matrix.compose(position, rotation, one));
  });
  markers.instanceMatrix.needsUpdate = true;
  markers.computeBoundingSphere();
  group.add(markers);

  // Un anneau distinct donne un survol plus franc sans recolorer les 317 instances.
  const hoverMaterial = new THREE.MeshBasicMaterial({
    color: HOVER_COLOR,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const hover = new THREE.Mesh(new THREE.RingGeometry(innerR * 0.72, outerR * 1.05, 28), hoverMaterial);
  hover.name = 'hoveredBuildSlot';
  hover.rotation.x = -Math.PI / 2;
  hover.renderOrder = 5;
  hover.visible = false;
  group.add(hover);

  function update(arena: Arena, hoveredSlotId: string | null, active: boolean): void {
    group.visible = active;
    if (!active) return;

    slots.forEach((slot, index) => {
      const position = positions.get(slot.id)!;
      markers.setMatrixAt(index, matrix.compose(position, rotation, arena.occupied[slot.id] ? zero : one));
    });
    markers.instanceMatrix.needsUpdate = true;

    const hoveredPosition = hoveredSlotId ? positions.get(hoveredSlotId) : undefined;
    hover.visible = hoveredPosition !== undefined;
    if (hoveredPosition) {
      hover.position.copy(hoveredPosition).setY(PLATFORM_HEIGHT + 0.019);
      hoverMaterial.color.set(arena.occupied[hoveredSlotId!] ? OCCUPIED_COLOR : HOVER_COLOR);
    }
  }

  return { group, update };
}
