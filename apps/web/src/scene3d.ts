import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PATH_WIDTH, type Lane } from '@tower-defense/data';
import { worldToScene, type Frame3D } from './world3d.js';
import { buildPlatforms, PATH_SURFACE_Y } from './terrain3d.js';

export interface Scene3D {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  towerLayer: THREE.Group;
  creepLayer: THREE.Group;
}

type Point2 = [number, number];

const SKY_ZENITH = new THREE.Color(0x14212b);
const SKY_HORIZON = new THREE.Color(0x40503f);
const SKY_BELOW = new THREE.Color(0x1a231a);
const FOG_COLOR = 0x303b31;
const GROUND_PAD_RATIO = 2.4;
const SCENERY_PAD_RATIO = 0.95;
const PATH_TEXTURE_SCALE = 4.2;

function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) | 0;
    return (state >>> 0) / 0x100000000;
  };
}

/** Texture d'herbe multi-echelle, generee une seule fois pour le grand sol. */
function grassTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rand = seededRandom(91125);

  ctx.fillStyle = '#2b3d1e';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 190; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const radius = 4 + rand() * 20;
    ctx.fillStyle = rand() < 0.52 ? 'rgba(91,116,52,0.09)' : 'rgba(9,18,8,0.10)';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 2100; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const radius = 0.45 + rand() * 1.5;
    ctx.fillStyle = rand() < 0.5 ? 'rgba(102,126,60,0.26)' : 'rgba(21,31,14,0.35)';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function dirtTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rand = seededRandom(0x0d17c0de);

  ctx.fillStyle = '#896743';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const rx = 2 + rand() * 9;
    const ry = 1 + rand() * 4;
    ctx.fillStyle = rand() > 0.45 ? 'rgba(151,116,72,0.10)' : 'rgba(61,43,29,0.12)';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 950; i++) {
    const shade = rand() > 0.7 ? 'rgba(190,160,112,0.24)' : 'rgba(45,31,22,0.24)';
    ctx.fillStyle = shade;
    ctx.fillRect(rand() * size, rand() * size, 0.6 + rand() * 1.6, 0.5 + rand());
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.MirroredRepeatWrapping;
  texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildGround(frame: Frame3D): THREE.Mesh {
  const span = Math.max(frame.halfWidth, frame.halfHeight);
  const pad = span * GROUND_PAD_RATIO;
  const width = frame.halfWidth * 2 + pad * 2;
  const height = frame.halfHeight * 2 + pad * 2;
  const texture = grassTexture();
  texture.repeat.set(Math.max(6, Math.round(width / 6)), Math.max(6, Math.round(height / 6)));

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshLambertMaterial({ map: texture, color: 0xffffff }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.004;
  ground.receiveShadow = true;
  ground.name = 'ground';
  return ground;
}

function pushHorizontalTriangle(
  positions: number[],
  uvs: number[],
  a: Point2,
  b: Point2,
  c: Point2,
  y: number,
): void {
  const vertices: [Point2, Point2, Point2] = [a, b, c];
  const normalY = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
  if (normalY < 0) [vertices[1], vertices[2]] = [vertices[2], vertices[1]];
  for (const [x, z] of vertices) {
    positions.push(x, y, z);
    uvs.push(x / PATH_TEXTURE_SCALE, z / PATH_TEXTURE_SCALE);
  }
}

/** Un seul buffer pour tous les segments et toutes les jointures arrondies. */
function buildPathLayer(
  points: Point2[],
  width: number,
  y: number,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const half = width * 0.5;

  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]!;
    const [bx, bz] = points[i + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * half;
    const nz = (dx / len) * half;
    const aLeft: Point2 = [ax + nx, az + nz];
    const aRight: Point2 = [ax - nx, az - nz];
    const bLeft: Point2 = [bx + nx, bz + nz];
    const bRight: Point2 = [bx - nx, bz - nz];
    pushHorizontalTriangle(positions, uvs, aLeft, aRight, bRight, y);
    pushHorizontalTriangle(positions, uvs, aLeft, bRight, bLeft, y);
  }

  const jointSegments = 20;
  for (const [x, z] of points) {
    for (let i = 0; i < jointSegments; i++) {
      const a = (i / jointSegments) * Math.PI * 2;
      const b = ((i + 1) / jointSegments) * Math.PI * 2;
      pushHorizontalTriangle(
        positions,
        uvs,
        [x, z],
        [x + Math.cos(a) * half, z + Math.sin(a) * half],
        [x + Math.cos(b) * half, z + Math.sin(b) * half],
        y,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  return mesh;
}

function buildPathRuts(points: Point2[], pathWidth: number): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const rutWidth = Math.max(0.055, pathWidth * 0.035);
  const offset = pathWidth * 0.18;

  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]!;
    const [bx, bz] = points[i + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;

    for (const sign of [-1, 1]) {
      const centerAx = ax + nx * offset * sign;
      const centerAz = az + nz * offset * sign;
      const centerBx = bx + nx * offset * sign;
      const centerBz = bz + nz * offset * sign;
      const hx = nx * rutWidth * 0.5;
      const hz = nz * rutWidth * 0.5;
      const aLeft: Point2 = [centerAx + hx, centerAz + hz];
      const aRight: Point2 = [centerAx - hx, centerAz - hz];
      const bLeft: Point2 = [centerBx + hx, centerBz + hz];
      const bRight: Point2 = [centerBx - hx, centerBz - hz];
      pushHorizontalTriangle(positions, uvs, aLeft, aRight, bRight, PATH_SURFACE_Y + 0.008);
      pushHorizontalTriangle(positions, uvs, aLeft, bRight, bLeft, PATH_SURFACE_Y + 0.008);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: 0x38281e, transparent: true, opacity: 0.26, depthWrite: false }),
  );
  mesh.name = 'pathRuts';
  mesh.renderOrder = 2;
  return mesh;
}

function buildPath(lane: Lane, frame: Frame3D): THREE.Group {
  const group = new THREE.Group();
  group.name = 'path';
  const points = [lane.spawn, ...lane.waypoints].map(([x, y]) => worldToScene(frame, x, y));
  const width = PATH_WIDTH * frame.scale;

  group.add(buildPathLayer(
    points,
    width * 1.23,
    PATH_SURFACE_Y - 0.003,
    new THREE.MeshLambertMaterial({ color: 0x4a3525 }),
    'pathShoulder',
  ));
  group.add(buildPathLayer(
    points,
    width * 0.98,
    PATH_SURFACE_Y,
    new THREE.MeshLambertMaterial({ map: dirtTexture(), color: 0xffffff }),
    'dirtPath',
  ));
  group.add(buildPathRuts(points, width));
  return group;
}

function buildSkyDome(radius: number): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, 24, 12);
  const position = geometry.getAttribute('position');
  const colors: number[] = [];
  const color = new THREE.Color();

  for (let i = 0; i < position.count; i++) {
    const normalizedY = position.getY(i) / radius;
    if (normalizedY >= 0) color.copy(SKY_HORIZON).lerp(SKY_ZENITH, Math.min(1, normalizedY * 1.7));
    else color.copy(SKY_HORIZON).lerp(SKY_BELOW, Math.min(1, -normalizedY * 2.4));
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    }),
  );
  sky.name = 'sky';
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  return sky;
}

function buildScenery(frame: Frame3D): THREE.Group {
  const group = new THREE.Group();
  group.name = 'scenery';
  const span = Math.max(frame.halfWidth, frame.halfHeight);
  const pad = span * SCENERY_PAD_RATIO;
  const rand = seededRandom(0x5ce9e7);
  const trees: Point2[] = [];

  // Une lisiere au fond et sur les flancs : jamais sur le chemin ni sur un slot.
  for (let i = 0; i < 14; i++) {
    trees.push([
      (rand() * 2 - 1) * (frame.halfWidth + pad * 0.62),
      frame.halfHeight + pad * (0.28 + rand() * 0.48),
    ]);
  }
  for (let i = 0; i < 22; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    trees.push([
      side * (frame.halfWidth + pad * (0.25 + rand() * 0.48)),
      -frame.halfHeight * 0.28 + rand() * (frame.halfHeight * 1.35 + pad * 0.16),
    ]);
  }

  const trunkGeometry = new THREE.CylinderGeometry(0.11, 0.17, 0.9, 6);
  const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x5b3f27 });
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, trees.length);
  trunks.name = 'treeTrunks';
  trunks.castShadow = true;

  const crownGeometry = new THREE.ConeGeometry(0.66, 1.5, 7);
  const crownMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, trees.length * 2);
  crowns.name = 'treeCrowns';
  crowns.castShadow = true;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  trees.forEach(([x, z], index) => {
    const scale = 1.02 + rand() * 0.66;
    const rotation = rand() * Math.PI * 2;
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
    matrix.compose(new THREE.Vector3(x, 0.45 * scale, z), quaternion, new THREE.Vector3(scale, scale, scale));
    trunks.setMatrixAt(index, matrix);

    const lowerScale = new THREE.Vector3(scale, scale * 1.05, scale);
    matrix.compose(new THREE.Vector3(x, 1.18 * scale, z), quaternion, lowerScale);
    crowns.setMatrixAt(index * 2, matrix);
    crowns.setColorAt(index * 2, new THREE.Color(index % 3 === 0 ? 0x304f27 : 0x3b5d2c));

    const upperScale = new THREE.Vector3(scale * 0.72, scale * 0.82, scale * 0.72);
    matrix.compose(new THREE.Vector3(x, 2.0 * scale, z), quaternion, upperScale);
    crowns.setMatrixAt(index * 2 + 1, matrix);
    crowns.setColorAt(index * 2 + 1, new THREE.Color(index % 4 === 0 ? 0x426832 : 0x35582a));
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  group.add(trunks, crowns);

  const rockCount = 24;
  const rocks = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.28, 0),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    rockCount,
  );
  rocks.name = 'boundaryRocks';
  rocks.receiveShadow = true;
  for (let i = 0; i < rockCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (frame.halfWidth + pad * (0.12 + rand() * 0.58));
    const z = -frame.halfHeight * 0.48 + rand() * (frame.halfHeight * 1.45 + pad * 0.35);
    quaternion.setFromEuler(new THREE.Euler(rand() * 0.5, rand() * Math.PI * 2, rand() * 0.35));
    const sx = 0.55 + rand() * 1.2;
    const sy = 0.45 + rand() * 0.7;
    const sz = 0.55 + rand() * 1.2;
    matrix.compose(new THREE.Vector3(x, 0.12 * sy, z), quaternion, new THREE.Vector3(sx, sy, sz));
    rocks.setMatrixAt(i, matrix);
    rocks.setColorAt(i, new THREE.Color(i % 3 === 0 ? 0x716953 : 0x5e5a49));
  }
  rocks.instanceMatrix.needsUpdate = true;
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
  group.add(rocks);
  return group;
}

function buildGate(x: number, z: number, color: number, tangent: Point2, hostile = false): THREE.Group {
  const group = new THREE.Group();
  group.name = hostile ? 'exitGate' : 'spawnGate';
  const tangentLength = Math.hypot(tangent[0], tangent[1]) || 1;
  const nx = -tangent[1] / tangentLength;
  const nz = tangent[0] / tangentLength;

  const haloMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.4, hostile ? 1.08 : 1.24, 32), haloMaterial);
  halo.rotation.x = -Math.PI / 2;
  halo.position.set(x, PATH_SURFACE_Y + 0.018, z);
  halo.renderOrder = 3;
  group.add(halo);

  const pylonGeometry = new THREE.CylinderGeometry(0.16, 0.26, 1.65, 6);
  const pylonMaterial = new THREE.MeshLambertMaterial({ color: hostile ? 0x493732 : 0x625b49, flatShading: true });
  const pylons = new THREE.InstancedMesh(pylonGeometry, pylonMaterial, 2);
  pylons.castShadow = true;
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    matrix.makeTranslation(x + nx * 1.05 * side, 0.82, z + nz * 1.05 * side);
    pylons.setMatrixAt(i, matrix);
  }
  pylons.instanceMatrix.needsUpdate = true;
  group.add(pylons);

  const crystals = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(hostile ? 0.21 : 0.25, 0),
    new THREE.MeshBasicMaterial({ color }),
    2,
  );
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    matrix.makeTranslation(x + nx * 1.05 * side, 1.78, z + nz * 1.05 * side);
    crystals.setMatrixAt(i, matrix);
  }
  crystals.instanceMatrix.needsUpdate = true;
  group.add(crystals);

  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(hostile ? 0.36 : 0.3, 0),
    new THREE.MeshBasicMaterial({ color }),
  );
  core.position.set(x, hostile ? 0.4 : 0.34, z);
  core.rotation.y = Math.PI * 0.25;
  group.add(core);
  return group;
}

/** Cadrage proche, tout en conservant la silhouette complete du U. */
const INITIAL_CAMERA_POSITION: readonly [number, number, number] = [0.25, 45, -59];
const INITIAL_CAMERA_TARGET: readonly [number, number, number] = [0, 0, 1];

/** Marge (unites de scene) ajoutee de chaque cote du rectangle halfWidth x
 * halfHeight de l'arene -- genereuse plutot que serree (brief) : suivre un
 * creep jusqu'au bout du chemin ne doit jamais toucher cette limite. */
const PAN_MARGIN_RATIO = 0.3;

/** Plage verticale (unites de scene) autorisee pour la cible -- le chemin et
 * les plateformes constructibles vivent entre PATH_SURFACE_Y (~0) et
 * PLATFORM_HEIGHT (1.2), donc une plage etroite autour de ca suffit. Sans
 * elle, un clic droit + glisse verticalement N'EST PAS retenu par
 * maxX/maxZ : OrbitControls pan en espace-ecran (screenSpacePanning=true
 * par defaut), et un glisse vertical a l'ecran deplace la cible selon le
 * vecteur "haut" de la camera -- lequel, camera inclinee, pointe surtout
 * selon Y (avec un peu de Z), pas selon X/Z purs. C'est la 2e porte vers le
 * vide, laissee grande ouverte par le seul rectangle X/Z (retour direct :
 * "les cotes sont bons mais je peux aller loin en haut/bas"). */
const MIN_TARGET_Y = -1;
const MAX_TARGET_Y = 2;

/** Borne la cible des OrbitControls (translation laterale ET verticale) a
 * un volume autour de l'arene -- sans ca, glisser la camera sans dezoomer
 * sort directement dans le vide (brief). Ecrete chaque axe INDEPENDAMMENT
 * et apres chaque changement (listener 'change', qui se declenche a chaque
 * update() ou quelque chose a bouge, y compris pendant l'inertie du
 * damping) : glisser en diagonale le long d'une limite reste donc fluide
 * (l'axe encore libre continue de suivre la souris normalement) plutot que
 * de se figer des qu'un seul axe est au bout. `camera.position` recoit la
 * meme correction que `target` pour garder leur decalage spherique intact :
 * OrbitControls le relit tel quel au prochain update() (rotation/zoom
 * continuent de fonctionner normalement). */
function installPanBounds(controls: OrbitControls, camera: THREE.PerspectiveCamera, frame: Frame3D, span: number): void {
  const maxX = frame.halfWidth + PAN_MARGIN_RATIO * span;
  const maxZ = frame.halfHeight + PAN_MARGIN_RATIO * span;

  controls.addEventListener('change', () => {
    const clampedX = THREE.MathUtils.clamp(controls.target.x, -maxX, maxX);
    const clampedZ = THREE.MathUtils.clamp(controls.target.z, -maxZ, maxZ);
    const clampedY = THREE.MathUtils.clamp(controls.target.y, MIN_TARGET_Y, MAX_TARGET_Y);
    if (clampedX !== controls.target.x || clampedZ !== controls.target.z || clampedY !== controls.target.y) {
      camera.position.x += clampedX - controls.target.x;
      camera.position.z += clampedZ - controls.target.z;
      camera.position.y += clampedY - controls.target.y;
      controls.target.y = clampedY;
      controls.target.x = clampedX;
      controls.target.z = clampedZ;
    }
  });
}

export function createScene3D(canvas: HTMLCanvasElement, lane: Lane, frame: Frame3D): Scene3D {
  const span = Math.max(frame.halfWidth, frame.halfHeight);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.Fog(FOG_COLOR, span * 2.1, span * 6.2);
  scene.add(buildSkyDome(span * 12));

  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.14;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  // Empeche la vue rasante a l'horizon (maxPolarAngle) et la vue strictement
  // zenithale qui ecraserait le relief du chemin (minPolarAngle) -- l'angle
  // d'elevation par defaut (~53 deg, cadrage inchange ci-dessous) reste dans
  // cette plage.
  controls.minPolarAngle = 0.5;
  controls.maxPolarAngle = 1.15;
  controls.minDistance = 2;
  controls.maxDistance = span * 2.3;
  camera.position.set(...INITIAL_CAMERA_POSITION);
  controls.target.set(...INITIAL_CAMERA_TARGET);
  controls.update();
  installPanBounds(controls, camera, frame, span);

  scene.add(new THREE.HemisphereLight(0x9eb7c7, 0x2a2619, 1.35));
  scene.add(new THREE.AmbientLight(0x566052, 0.35));
  const key = new THREE.DirectionalLight(0xffe2b8, 2.05);
  const shadowSpan = span * 1.3;
  key.position.set(-shadowSpan * 0.45, shadowSpan * 1.05, -shadowSpan * 0.7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -shadowSpan;
  key.shadow.camera.right = shadowSpan;
  key.shadow.camera.top = shadowSpan;
  key.shadow.camera.bottom = -shadowSpan;
  key.shadow.camera.far = shadowSpan * 4;
  key.shadow.bias = -0.00035;
  key.shadow.normalBias = 0.025;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7898bc, 0.65);
  rim.position.set(shadowSpan * 0.3, shadowSpan * 0.4, shadowSpan * 0.45);
  scene.add(rim);

  scene.add(buildGround(frame));
  scene.add(buildPath(lane, frame));
  scene.add(buildPlatforms(lane, frame));
  scene.add(buildScenery(frame));

  const pathPoints = [lane.spawn, ...lane.waypoints].map(([x, y]) => worldToScene(frame, x, y));
  const spawn = pathPoints[0];
  const spawnNext = pathPoints[1];
  if (spawn && spawnNext) {
    scene.add(buildGate(
      spawn[0],
      spawn[1],
      0x63d9ff,
      [spawnNext[0] - spawn[0], spawnNext[1] - spawn[1]],
    ));
  }
  const end = pathPoints[pathPoints.length - 1];
  const endPrev = pathPoints[pathPoints.length - 2];
  if (end && endPrev) {
    scene.add(buildGate(end[0], end[1], 0xff5c4a, [end[0] - endPrev[0], end[1] - endPrev[1]], true));
  }

  const towerLayer = new THREE.Group();
  towerLayer.name = 'towers';
  scene.add(towerLayer);
  const creepLayer = new THREE.Group();
  creepLayer.name = 'creeps';
  scene.add(creepLayer);

  return { scene, camera, renderer, controls, towerLayer, creepLayer };
}

export function resizeScene3D(s3d: Scene3D, width: number, height: number): void {
  s3d.camera.aspect = width / height;
  s3d.camera.updateProjectionMatrix();
  s3d.renderer.setSize(width, height, false);
}

function disposeMaterial(material: THREE.Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}

/** Libere le renderer et toutes les ressources encore attachees a la scene. */
export function disposeScene3D(s3d: Scene3D): void {
  s3d.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else if (material) disposeMaterial(material);
  });
  s3d.scene.clear();
  s3d.controls.dispose();
  s3d.renderer.dispose();
}
