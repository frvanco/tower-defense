import * as THREE from 'three';
import { zoneFootprints, type Lane } from '@tower-defense/data';
import { worldToScene, type Frame3D } from './world3d.js';
import { createPlatformGrassTexture } from './terrainGrass.js';

/** Niveau du chemin et du sol. Les couches decoratives se placent juste au-dessus. */
export const PATH_SURFACE_Y = 0.008;

/**
 * Le chemin reste au niveau bas. Les zones constructibles forment un plateau
 * sureleve : tours, marqueurs et fantome de pose utilisent tous cette hauteur.
 */
export const PLATFORM_HEIGHT = 1.2;

const AO_COLOR = 0x3b4328;
const AO_OPACITY = 0.24;
const AO_WIDTH = 0.24;
const AO_Y = PATH_SURFACE_Y + 0.006;
const TOP_TEXTURE_SCALE = 24;

type Point2 = [number, number];

interface TerrainMaterials {
  top: THREE.MeshLambertMaterial;
  wall: THREE.MeshLambertMaterial;
  ao: THREE.MeshBasicMaterial;
}

function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return (state >>> 0) / 0x100000000;
  };
}

function createTerrainMaterials(): TerrainMaterials {
  return {
    top: new THREE.MeshLambertMaterial({ map: createPlatformGrassTexture(), color: 0xffffff }),
    wall: new THREE.MeshLambertMaterial({ color: 0x958b6b }),
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
  const ccw = signedArea(scenePts) > 0;
  // Le fond des joints reste en retrait; les blocs restent dans le contour d'origine.
  const retrait = offsetPolygon(scenePts, -0.05);
  for (let edge = 0; edge < retrait.length; edge++) {
    const [ax, az] = retrait[edge]!;
    const [bx, bz] = retrait[(edge + 1) % retrait.length]!;
    if (ccw) {
      positions.push(
        ax, 0, az, ax, PLATFORM_HEIGHT, az, bx, PLATFORM_HEIGHT, bz,
        ax, 0, az, bx, PLATFORM_HEIGHT, bz, bx, 0, bz,
      );
    } else {
      positions.push(
        ax, 0, az, bx, 0, bz, bx, PLATFORM_HEIGHT, bz,
        ax, 0, az, bx, PLATFORM_HEIGHT, bz, ax, PLATFORM_HEIGHT, az,
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'jointsSoutenement';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

interface InstanceMur {
  matrice: THREE.Matrix4;
  couleur: number;
}

interface LotsMurs {
  pierres: InstanceMur[];
  plaques: InstanceMur[];
  fixations: InstanceMur[];
  fissures: InstanceMur[];
  feuilles: InstanceMur[];
}

/** Une geometrie biseautee pour toutes les pierres, sans allocation par bloc. */
function pierreBiseautee(): THREE.BufferGeometry {
  const forme = new THREE.Shape();
  forme.moveTo(-0.445, -0.445);
  forme.lineTo(0.445, -0.445);
  forme.lineTo(0.445, 0.445);
  forme.lineTo(-0.445, 0.445);
  forme.closePath();
  const geometrie = new THREE.ExtrudeGeometry(forme, {
    depth: 0.84,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.055,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geometrie.translate(0, 0, -0.42);
  return geometrie;
}

function garnirMurs(contour: Point2[], lots: LotsMurs, graine: number): void {
  const hasard = seededRandom(graine);
  const ccw = signedArea(contour) > 0;
  const objet = new THREE.Object3D();
  const pierres = [0xc2b58d, 0xd1c5a3, 0xbbb18f, 0xd6caa7, 0xc7bc99];
  const verts = [0x647e38, 0x789244, 0x516f31];
  const niveaux = [0.025, 0.43, 0.9, PLATFORM_HEIGHT - 0.008];

  for (let arete = 0; arete < contour.length; arete++) {
    const a = contour[arete]!;
    const b = contour[(arete + 1) % contour.length]!;
    const longueur = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (longueur < 0.1) continue;
    const tx = (b[0] - a[0]) / longueur;
    const tz = (b[1] - a[1]) / longueur;
    const [nx, nz] = edgeOutwardNormal(a, b, ccw);
    const rotation = Math.atan2(nx, nz);
    const ajouter = (
      lot: InstanceMur[], position: number, hauteur: number, retrait: number,
      largeur: number, epaisseur: number, profondeur: number, couleur: number, inclinaison = 0,
    ): void => {
      objet.position.set(a[0] + tx * position - nx * retrait, hauteur, a[1] + tz * position - nz * retrait);
      objet.rotation.set(0, rotation, inclinaison, 'YXZ');
      objet.scale.set(largeur, epaisseur, profondeur);
      objet.updateMatrix();
      lot.push({ matrice: objet.matrix.clone(), couleur });
    };

    for (let assise = 0; assise < niveaux.length - 1; assise++) {
      const bas = niveaux[assise]!;
      const haut = niveaux[assise + 1]!;
      let debut = 0;
      while (debut < longueur - 0.015) {
        // Les assises commencent avec des largeurs differentes pour decaler les joints.
        const cible = debut === 0 ? 0.75 + hasard() * 0.95 : 1.35 + hasard() * 0.7;
        const fin = Math.min(longueur, debut + cible);
        const largeur = fin - debut - 0.025;
        if (largeur > 0.015) {
          const profondeur = 0.20 + hasard() * 0.055;
          ajouter(lots.pierres, (debut + fin) / 2, (bas + haut) / 2,
            profondeur / 2 + 0.016, largeur, haut - bas - 0.018,
            profondeur, pierres[Math.floor(hasard() * pierres.length)]!);

          if (assise < 2 && hasard() < 0.13 && largeur > 0.5) {
            const position = (debut + fin) / 2;
            const hauteur = (bas + haut) / 2 + 0.08;
            ajouter(lots.fissures, position, hauteur, 0.012,
              0.012, 0.13, 0.007, 0x80765c, -0.34);
            ajouter(lots.fissures, position + 0.027, hauteur - 0.11, 0.012,
              0.011, 0.105, 0.007, 0x80765c, 0.2);
          }
        }
        debut = fin;
      }
    }

    for (let position = 2.1 + hasard() * 3; position < longueur - 0.5; position += 8 + hasard() * 7) {
      const hauteur = 0.52 + hasard() * 0.19;
      ajouter(lots.plaques, position, hauteur, 0.013, 0.56, 0.34, 0.020, 0xe5dfc5);
      ajouter(lots.fixations, position, hauteur, 0.0045, 0.10, 0.40, 0.007, 0x555951);
      for (const cote of [-1, 1]) {
        ajouter(lots.fixations, position + cote * 0.205, hauteur + 0.10, 0.002,
          0.042, 0.042, 0.003, 0x77796c);
        ajouter(lots.fixations, position + cote * 0.205, hauteur - 0.10, 0.002,
          0.042, 0.042, 0.003, 0x77796c);
      }
    }

    for (let position = 0.8 + hasard() * 2; position < longueur - 0.45; position += 4 + hasard() * 5) {
      const nombre = 3 + Math.floor(hasard() * 4);
      for (let feuille = 0; feuille < nombre; feuille++) {
        const hauteur = PLATFORM_HEIGHT - 0.15 - feuille * 0.135;
        const cote = feuille % 2 === 0 ? -1 : 1;
        // Le lierre reste sous le sommet et contre la face, meme dans les angles du U.
        ajouter(lots.feuilles, position + cote * 0.075, hauteur, 0.014,
          0.20, 0.24, 0.022, verts[Math.floor(hasard() * verts.length)]!, cote * 0.55);
      }
    }
  }
}

function ajouterLot(
  groupe: THREE.Group, nom: string, instances: InstanceMur[], geometrie: THREE.BufferGeometry,
  materiau: THREE.MeshLambertMaterial,
): void {
  if (instances.length === 0) return;
  const lot = new THREE.InstancedMesh(geometrie, materiau, instances.length);
  const couleur = new THREE.Color();
  for (let i = 0; i < instances.length; i++) {
    const instance = instances[i]!;
    lot.setMatrixAt(i, instance.matrice);
    lot.setColorAt(i, couleur.set(instance.couleur));
  }
  lot.name = nom;
  lot.instanceMatrix.needsUpdate = true;
  if (lot.instanceColor) lot.instanceColor.needsUpdate = true;
  lot.receiveShadow = true;
  lot.computeBoundingBox();
  lot.computeBoundingSphere();
  groupe.add(lot);
}

function platformFromPolygon(
  points: Point2[], frame: Frame3D, materials: TerrainMaterials, name: string, lots: LotsMurs, graine: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  const scenePts = points.map(([x, y]) => worldToScene(frame, x, y));
  group.add(buildTop(scenePts, materials.top));
  group.add(buildWalls(scenePts, materials.wall));
  group.add(buildAmbientOcclusionSkirt(scenePts, materials.ao));
  garnirMurs(scenePts, lots, graine);
  return group;
}

export function buildPlatforms(lane: Lane, frame: Frame3D): THREE.Group {
  const group = new THREE.Group();
  group.name = 'platforms';
  const materials = createTerrainMaterials();
  const lots: LotsMurs = { pierres: [], plaques: [], fixations: [], fissures: [], feuilles: [] };
  let index = 0;
  for (const zone of zoneFootprints(lane)) {
    group.add(platformFromPolygon(zone.points, frame, materials, `platform-${zone.id}`, lots, 711 + index++));
  }
  // Cinq lots pour l'ensemble des deux plateaux; toutes les ressources vivent dans ce groupe.
  const bloc = new THREE.BoxGeometry(1, 1, 1);
  const materiau = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  ajouterLot(group, 'pierresSoutenement', lots.pierres, pierreBiseautee(), materiau);
  ajouterLot(group, 'plaquesSoutenement', lots.plaques, bloc, materiau);
  ajouterLot(group, 'fixationsSoutenement', lots.fixations, bloc, materiau);
  ajouterLot(group, 'fissuresSoutenement', lots.fissures, bloc, materiau);
  ajouterLot(group, 'lierreSoutenement', lots.feuilles, new THREE.IcosahedronGeometry(0.5, 0), materiau);
  return group;
}
