import * as THREE from 'three';
import { zoneFootprints, type Lane } from '@tower-defense/data';
import { worldToScene, type Frame3D } from './world3d.js';

/** Niveau du chemin et du sol. Les couches decoratives se placent juste au-dessus. */
export const PATH_SURFACE_Y = 0.008;

/**
 * Le chemin reste au niveau bas. Les zones constructibles forment un plateau
 * sureleve : tours, marqueurs et fantome de pose utilisent tous cette hauteur.
 */
export const PLATFORM_HEIGHT = 1.2;

const AO_COLOR = 0x17110d;
const AO_OPACITY = 0.58;
const AO_WIDTH = 0.42;
const AO_Y = PATH_SURFACE_Y + 0.006;
const EDGE_TRIM_WIDTH = 0.11;
const TOP_TEXTURE_SCALE = 4.5;

type Point2 = [number, number];

interface TerrainMaterials {
  top: THREE.MeshLambertMaterial;
  wall: THREE.MeshLambertMaterial;
  trim: THREE.MeshLambertMaterial;
  ao: THREE.MeshBasicMaterial;
}

function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return (state >>> 0) / 0x100000000;
  };
}

/** Texture d'herbe peinte une fois sur Canvas, sans asset ni travail par frame. */
function platformTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rand = seededRandom(0x51a7f00d);

  ctx.fillStyle = '#405a28';
  ctx.fillRect(0, 0, size, size);

  // Grandes nuances diffuses : cassent l'aplat sans produire de bruit haute frequence.
  for (let i = 0; i < 170; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const radius = 5 + rand() * 18;
    const light = rand() > 0.48;
    ctx.fillStyle = light ? 'rgba(108,130,57,0.055)' : 'rgba(21,36,14,0.07)';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Touffes courtes, orientees de facon deterministe.
  ctx.lineWidth = 0.75;
  for (let i = 0; i < 1250; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 0.8 + rand() * 2.4;
    const angle = -0.45 + rand() * 0.9;
    ctx.strokeStyle = rand() > 0.5 ? 'rgba(139,154,77,0.17)' : 'rgba(24,42,15,0.22)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.sin(angle) * len, y - Math.cos(angle) * len);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createTerrainMaterials(): TerrainMaterials {
  return {
    top: new THREE.MeshLambertMaterial({ map: platformTexture(), color: 0xffffff }),
    wall: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    trim: new THREE.MeshLambertMaterial({ color: 0x718746, side: THREE.DoubleSide }),
    ao: new THREE.MeshBasicMaterial({
      color: AO_COLOR,
      transparent: true,
      opacity: AO_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  };
}

/** Aire signee dans le plan X/Z. Positive = contour anti-horaire. */
function signedArea(points: Point2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [ax, az] = points[i]!;
    const [bx, bz] = points[(i + 1) % points.length]!;
    area += ax * bz - bx * az;
  }
  return area * 0.5;
}

/** Normale exterieure coherente, y compris pour un contour concave. */
function edgeOutwardNormal(a: Point2, b: Point2, ccw: boolean): Point2 {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  return ccw ? [dz / len, -dx / len] : [-dz / len, dx / len];
}

/**
 * Offset a jointures miter. Contrairement a l'ancienne heuristique basee sur
 * le centroide, l'orientation signee reste correcte dans le creux du U.
 */
function offsetPolygon(points: Point2[], distance: number): Point2[] {
  const ccw = signedArea(points) > 0;
  const normals = points.map((point, i) => edgeOutwardNormal(point, points[(i + 1) % points.length]!, ccw));

  return points.map(([x, z], i) => {
    const prev = normals[(i - 1 + normals.length) % normals.length]!;
    const next = normals[i]!;
    let mx = prev[0] + next[0];
    let mz = prev[1] + next[1];
    const mLen = Math.hypot(mx, mz);
    if (mLen < 1e-5) return [x + next[0] * distance, z + next[1] * distance];
    mx /= mLen;
    mz /= mLen;
    const projection = mx * next[0] + mz * next[1];
    const rawScale = Math.abs(projection) > 0.2 ? distance / projection : distance;
    const maxScale = Math.abs(distance) * 2.8;
    const scale = THREE.MathUtils.clamp(rawScale, -maxScale, maxScale);
    return [x + mx * scale, z + mz * scale];
  });
}

function buildHorizontalBand(
  inner: Point2[],
  outer: Point2[],
  y: number,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const positions: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    const [ax, az] = inner[i]!;
    const [bx, bz] = inner[(i + 1) % inner.length]!;
    const [oax, oaz] = outer[i]!;
    const [obx, obz] = outer[(i + 1) % outer.length]!;
    positions.push(
      ax, y, az, bx, y, bz, obx, y, obz,
      ax, y, az, obx, y, obz, oax, y, oaz,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

function buildAmbientOcclusionSkirt(scenePts: Point2[], material: THREE.Material): THREE.Mesh {
  return buildHorizontalBand(scenePts, offsetPolygon(scenePts, AO_WIDTH), AO_Y, material, 'cliffAo');
}

function buildTop(scenePts: Point2[], material: THREE.Material): THREE.Mesh {
  const triangles = THREE.ShapeUtils.triangulateShape(
    scenePts.map(([sx, sz]) => new THREE.Vector2(sx, sz)),
    [],
  );
  const positions: number[] = [];
  const uvs: number[] = [];

  for (const triangle of triangles) {
    const vertices = triangle.map((index) => scenePts[index]!) as [Point2, Point2, Point2];
    const [a, b, c] = vertices;
    // Dans le plan X/Z, un triangle anti-horaire pointe vers -Y : inverse si necessaire.
    const normalY = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    if (normalY < 0) [vertices[1], vertices[2]] = [vertices[2], vertices[1]];
    for (const [sx, sz] of vertices) {
      positions.push(sx, PLATFORM_HEIGHT, sz);
      uvs.push(sx / TOP_TEXTURE_SCALE, sz / TOP_TEXTURE_SCALE);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'grassTop';
  mesh.receiveShadow = true;
  return mesh;
}

function buildWalls(scenePts: Point2[], material: THREE.Material): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const ccw = signedArea(scenePts) > 0;
  const levels = [0, PLATFORM_HEIGHT * 0.34, PLATFORM_HEIGHT * 0.7, PLATFORM_HEIGHT];
  const palette = [0x211711, 0x30231a, 0x443326, 0x51402b].map((hex) => new THREE.Color(hex));

  const pushVertex = (x: number, y: number, z: number, color: THREE.Color): void => {
    positions.push(x, y, z);
    colors.push(color.r, color.g, color.b);
  };

  for (let edge = 0; edge < scenePts.length; edge++) {
    const [ax, az] = scenePts[edge]!;
    const [bx, bz] = scenePts[(edge + 1) % scenePts.length]!;
    const variation = 0.9 + ((edge * 37) % 9) * 0.018;

    for (let band = 0; band < levels.length - 1; band++) {
      const y0 = levels[band]!;
      const y1 = levels[band + 1]!;
      const c0 = palette[band]!.clone().multiplyScalar(variation);
      const c1 = palette[band + 1]!.clone().multiplyScalar(variation);

      if (ccw) {
        // A0 -> A1 -> B1 produit la normale droite de l'arete : l'exterieur d'un contour CCW.
        pushVertex(ax, y0, az, c0); pushVertex(ax, y1, az, c1); pushVertex(bx, y1, bz, c1);
        pushVertex(ax, y0, az, c0); pushVertex(bx, y1, bz, c1); pushVertex(bx, y0, bz, c0);
      } else {
        pushVertex(ax, y0, az, c0); pushVertex(bx, y0, bz, c0); pushVertex(bx, y1, bz, c1);
        pushVertex(ax, y0, az, c0); pushVertex(bx, y1, bz, c1); pushVertex(ax, y1, az, c1);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'stratifiedCliff';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function platformFromPolygon(points: Point2[], frame: Frame3D, materials: TerrainMaterials, name: string): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  const scenePts = points.map(([x, y]) => worldToScene(frame, x, y));

  group.add(buildTop(scenePts, materials.top));
  group.add(buildWalls(scenePts, materials.wall));
  group.add(buildHorizontalBand(
    scenePts,
    offsetPolygon(scenePts, -EDGE_TRIM_WIDTH),
    PLATFORM_HEIGHT + 0.008,
    materials.trim,
    'mossTrim',
  ));
  group.add(buildAmbientOcclusionSkirt(scenePts, materials.ao));
  return group;
}

export function buildPlatforms(lane: Lane, frame: Frame3D): THREE.Group {
  const group = new THREE.Group();
  group.name = 'platforms';
  const materials = createTerrainMaterials();

  for (const zone of zoneFootprints(lane)) {
    group.add(platformFromPolygon(zone.points, frame, materials, `platform-${zone.id}`));
  }
  return group;
}
