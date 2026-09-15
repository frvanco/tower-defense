import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PATH_WIDTH, type Lane } from '@tower-defense/data';
import { worldToScene, type Frame3D } from './world3d.js';
import { buildPlatforms, PATH_SURFACE_Y } from './terrain3d.js';
import { createSanctuary, type Sanctuary, type SanctuaryOptions } from './sanctuary/index.js';

export interface Scene3D {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  towerLayer: THREE.Group;
  creepLayer: THREE.Group;
  sanctuary: Sanctuary;
}

type Point2 = [number, number];

const SKY_ZENITH = new THREE.Color(0x94b6b4);
const SKY_HORIZON = new THREE.Color(0xadbba0);
const SKY_BELOW = new THREE.Color(0x586e48);
const FOG_COLOR = 0x92a58a;
const GROUND_PAD_RATIO = 4.8;
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

  const pixels = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * Math.PI * 2;
    const v = y / size * Math.PI * 2;
    const variation = Math.sin(u + Math.sin(v)) * 5 + Math.cos(v * 2 - u) * 3;
    const i = (y * size + x) * 4;
    pixels.data[i] = 77 + variation;
    pixels.data[i + 1] = 103 + variation;
    pixels.data[i + 2] = 46 + variation * 0.5;
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  ctx.strokeStyle = 'rgba(142,164,79,0.12)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 500; i++) {
    const x = rand() * size;
    const y = rand() * size;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 1, y - 2); ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Dallage peint: joints, eclats et mousse sans geometrie sur le passage. */
function pavingTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const rand = seededRandom(0x0d17c0de);
  ctx.fillStyle = '#8f896d';
  ctx.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 6; row++) {
    const height = 512 / 6;
    for (let col = -1; col < 5; col++) {
      const x = col * 128 + (row % 2) * 64;
      const y = row * height;
      const light = Math.round(rand() * 14);
      ctx.fillStyle = `rgb(${190 + light},${182 + light},${150 + light})`;
      ctx.fillRect(x + 2, y + 2, 124, height - 4);
      ctx.strokeStyle = 'rgba(244,232,192,0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 4, y + 4, 120, height - 8);
      if (rand() < 0.3) {
        ctx.strokeStyle = 'rgba(95,97,66,0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x + 2, y + 24); ctx.lineTo(x + 19, y + 31); ctx.lineTo(x + 25, y + 44); ctx.stroke();
      }
      if (rand() < 0.3) {
        ctx.fillStyle = 'rgba(92,119,48,0.4)';
        ctx.fillRect(x + 3, y + height - 4, 20 + rand() * 28, 3);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function buildGround(frame: Frame3D): THREE.Mesh {
  const span = Math.max(frame.halfWidth, frame.halfHeight);
  const pad = span * GROUND_PAD_RATIO;
  const width = frame.halfWidth * 2 + pad * 2;
  const height = frame.halfHeight * 2 + pad * 2;
  const texture = grassTexture();
  texture.repeat.set(Math.max(6, Math.round(width / 18)), Math.max(6, Math.round(height / 18)));

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

function buildPath(lane: Lane, frame: Frame3D): THREE.Group {
  const group = new THREE.Group();
  group.name = 'path';
  const points = [lane.spawn, ...lane.waypoints].map(([x, y]) => worldToScene(frame, x, y));
  const width = PATH_WIDTH * frame.scale;

  group.add(buildPathLayer(
    points,
    width * 1.23,
    PATH_SURFACE_Y - 0.003,
    new THREE.MeshLambertMaterial({ color: 0x858369 }),
    'pathShoulder',
  ));
  group.add(buildPathLayer(
    points,
    width * 0.98,
    PATH_SURFACE_Y,
    new THREE.MeshLambertMaterial({ map: pavingTexture(), color: 0xffffff }),
    'pavedPath',
  ));
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

/** Le cadrage initial inclut le U entier et son sanctuaire en arriere-plan. */
const INITIAL_CAMERA_POSITION: readonly [number, number, number] = [0, 26.18, -62.23];
const INITIAL_CAMERA_TARGET: readonly [number, number, number] = [0, 0, -15];

/** Cap (convention `aimTurret` : atan2(dx, dz), 0 = +Z) d'une tour vers la
 * camera initiale. Derive des constantes ci-dessus plutot qu'ecrit en dur :
 * recadrer la camera un jour reoriente les tours avec elle. */
const CAMERA_YAW = Math.atan2(
  INITIAL_CAMERA_POSITION[0] - INITIAL_CAMERA_TARGET[0],
  INITIAL_CAMERA_POSITION[2] - INITIAL_CAMERA_TARGET[2],
);

/**
 * Ecart ajoute au cap camera pour l'orientation de repos. Un quart de tour
 * place le canon a mi-chemin entre « face au spectateur » et « plein droite »
 * (retour direct : plein face etait juste, mais trop frontal — un leger
 * trois-quarts se lit mieux).
 *
 * Le SIGNE suppose une camera situee du cote des Z negatifs, ce qui est le cas
 * ici : la droite de l'ecran est alors le -X du monde (mesure, pas deduit).
 * Deplacer la camera de l'autre cote de l'arene demanderait de l'inverser.
 */
const TURRET_REST_TOWARD_RIGHT = Math.PI / 4;

/**
 * Orientation d'une tourelle tant qu'elle n'a aucune cible. Les modeles
 * (procedural comme .glb) pointent leur canon vers +Z au repos, or la camera
 * est en Z negatif — sans correction, une tour qui vient d'etre posee montre
 * son dos, ce qui se lit comme un defaut.
 *
 * Constante et non suivie en continu : les tours ne doivent pas pivoter quand
 * on orbite autour de l'arene.
 */
export const TURRET_REST_ANGLE = CAMERA_YAW + TURRET_REST_TOWARD_RIGHT;

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

export function createScene3D(canvas: HTMLCanvasElement, lane: Lane, frame: Frame3D, sceneryOptions: SanctuaryOptions = {}): Scene3D {
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
  camera.position.set(...INITIAL_CAMERA_POSITION).multiplyScalar(span / 34.125);
  controls.target.set(...INITIAL_CAMERA_TARGET).multiplyScalar(span / 34.125);
  controls.update();
  installPanBounds(controls, camera, frame, span);

  scene.add(new THREE.HemisphereLight(0xc5d9da, 0x777953, 1.7));
  scene.add(new THREE.AmbientLight(0x9ba68a, 0.45));
  const key = new THREE.DirectionalLight(0xffe5b8, 2.5);
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
  const rim = new THREE.DirectionalLight(0xa0bec0, 0.55);
  rim.position.set(shadowSpan * 0.3, shadowSpan * 0.4, shadowSpan * 0.45);
  scene.add(rim);

  scene.add(buildGround(frame));
  scene.add(buildPath(lane, frame));
  scene.add(buildPlatforms(lane, frame));
  const sanctuary = createSanctuary(lane, frame, sceneryOptions);
  sanctuary.setPlayer(lane.player);
  scene.add(sanctuary.group);

  const towerLayer = new THREE.Group();
  towerLayer.name = 'towers';
  scene.add(towerLayer);
  const creepLayer = new THREE.Group();
  creepLayer.name = 'creeps';
  scene.add(creepLayer);

  return { scene, camera, renderer, controls, towerLayer, creepLayer, sanctuary };
}

export function resizeScene3D(s3d: Scene3D, width: number, height: number): void {
  s3d.camera.aspect = width / height;
  s3d.camera.updateProjectionMatrix();
  s3d.renderer.setSize(width, height, false);
}

/** Libere chaque ressource locale une fois, meme si plusieurs meshes la partagent. */
export function disposeScene3D(s3d: Scene3D): void {
  // Le module retire son groupe avant la traversee: ses ressources ont un seul proprietaire.
  s3d.sanctuary.dispose();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  s3d.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((entry) => materials.add(entry));
    else if (material) materials.add(material);
    if (obj instanceof THREE.InstancedMesh) obj.dispose();
    if (obj instanceof THREE.DirectionalLight) obj.shadow.dispose();
  });
  materials.forEach((material) => {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  });
  textures.forEach((texture) => texture.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  s3d.scene.clear();
  s3d.controls.dispose();
  s3d.renderer.dispose();
}
