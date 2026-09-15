import * as THREE from 'three';
import type { DecorMaterial, DecorShape, Point3, SanctuaryPalette } from './types.js';

export const SANCTUARY_PALETTE: SanctuaryPalette = {
  stone: 0xc6bd99, ivory: 0xede6cd, metal: 0x414b4a, wood: 0x746044,
  leaf: 0x547f32, moss: 0x6c863f, water: 0x319eaa, sand: 0x8d9562,
  team: 0xc0392b, energy: 0x44dfd7, roof: 0x777c6c,
};

function stoneGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.46, -0.46);
  shape.lineTo(0.46, -0.46);
  shape.lineTo(0.46, 0.46);
  shape.lineTo(-0.46, 0.46);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.92, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04,
    bevelSegments: 1, steps: 1, curveSegments: 1,
  });
  geometry.translate(0, 0, -0.46);
  geometry.clearGroups();
  return geometry;
}

/** Proprietaire unique: aucune ressource du decor n'est empruntee aux unites. */
export class DecorResources {
  readonly geometries: Record<DecorShape, THREE.BufferGeometry> = {
    box: new THREE.BoxGeometry(1, 1, 1), stone: stoneGeometry(),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 8),
    cone: new THREE.ConeGeometry(1, 1, 8), sphere: new THREE.IcosahedronGeometry(1, 1),
    rock: new THREE.DodecahedronGeometry(1, 0), torus: new THREE.TorusGeometry(1, 0.16, 4, 12),
  };
  readonly materials: Record<DecorMaterial, THREE.MeshLambertMaterial>;
  private disposed = false;

  constructor(colors: Partial<SanctuaryPalette> = {}) {
    const palette = { ...SANCTUARY_PALETTE, ...colors };
    this.materials = Object.fromEntries(Object.entries(palette).map(([key, color]) => [
      key, new THREE.MeshLambertMaterial({
        color, flatShading: true,
        ...(key === 'energy' ? { emissive: color, emissiveIntensity: 0.65 } : {}),
      }),
    ])) as Record<DecorMaterial, THREE.MeshLambertMaterial>;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    Object.values(this.geometries).forEach((geometry) => geometry.dispose());
    Object.values(this.materials).forEach((material) => material.dispose());
  }
}

interface Instance { matrix: THREE.Matrix4; color: THREE.Color }

/** Un lot par forme/materiau ET par secteur pour conserver le culling lateral. */
export class DecorBatch {
  private readonly entries = new Map<string, { shape: DecorShape; material: DecorMaterial; instances: Instance[] }>();
  constructor(private readonly resources: DecorResources, private readonly name: string, private readonly shadows = false) {}

  add(shape: DecorShape, material: DecorMaterial, position: Point3, scale: Point3, rotation: Point3 = [0, 0, 0], color: THREE.ColorRepresentation = 0xffffff): void {
    const key = `${shape}-${material}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { shape, material, instances: [] };
      this.entries.set(key, entry);
    }
    entry.instances.push({
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale),
      ),
      color: new THREE.Color(color),
    });
  }

  finish(): THREE.Group {
    const group = new THREE.Group();
    group.name = this.name;
    for (const [key, { shape, material, instances }] of this.entries) {
      const mesh = new THREE.InstancedMesh(this.resources.geometries[shape], this.resources.materials[material], instances.length);
      mesh.name = `${this.name}-${key}`;
      instances.forEach(({ matrix, color }, index) => {
        mesh.setMatrixAt(index, matrix);
        mesh.setColorAt(index, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      mesh.castShadow = this.shadows && material !== 'energy' && material !== 'water';
      mesh.receiveShadow = true;
      // Meme une future selection recursive de la scene ignore le decor.
      mesh.raycast = () => {};
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.entries.clear();
    return group;
  }
}
