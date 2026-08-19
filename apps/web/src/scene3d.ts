import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PATH_WIDTH, type Lane } from '@tower-defense/data';
import { worldToScene, type Frame3D } from './world3d.js';
import { laneColor } from './colors.js';
import { buildPlatforms } from './terrain3d.js';

export interface Scene3D {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  towerLayer: THREE.Group;
  creepLayer: THREE.Group;
}

/**
 * Texture d'herbe tachetee, meme esprit que le sol procedural de la version
 * canvas 2D (apps/web/src/render.ts historique) mais en CanvasTexture pour
 * un plan Three.js — genere une seule fois et repete par tuile.
 */
function grassTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#233019';
  ctx.fillRect(0, 0, size, size);

  let seed = 91125;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 2600; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 0.6 + rand() * 2.2;
    ctx.fillStyle = rand() < 0.5 ? 'rgba(86,110,54,0.35)' : 'rgba(28,38,18,0.4)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildGround(frame: Frame3D): THREE.Mesh {
  const pad = Math.max(frame.halfWidth, frame.halfHeight) * 0.3;
  const w = frame.halfWidth * 2 + pad * 2;
  const h = frame.halfHeight * 2 + pad * 2;
  const tex = grassTexture();
  const repeats = Math.max(4, Math.round(Math.max(w, h) / 6));
  tex.repeat.set(repeats, repeats);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshLambertMaterial({ map: tex, color: 0xffffff }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  return ground;
}

/** Suite de segments plats + jointures cylindriques arrondies, meme lecture que le
 * stroke arrondi de la version canvas 2D mais en geometrie 3D reelle. */
function buildPath(lane: Lane, frame: Frame3D): THREE.Group {
  const g = new THREE.Group();
  g.name = 'path';
  const points = [lane.spawn, ...lane.waypoints].map(([x, y]) => worldToScene(frame, x, y));
  const width = PATH_WIDTH * frame.scale;
  const bed = new THREE.MeshLambertMaterial({ color: 0x6e5a3f });
  const edge = new THREE.MeshLambertMaterial({ color: 0x241c14 });

  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]!;
    const [bx, bz] = points[i + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const angle = Math.atan2(dz, dx);
    const mid = new THREE.Vector3((ax + bx) / 2, 0.005, (az + bz) / 2);

    const under = new THREE.Mesh(new THREE.PlaneGeometry(len + width * 0.4, width * 1.25), edge);
    under.rotation.x = -Math.PI / 2;
    under.rotation.z = -angle;
    under.position.copy(mid).setY(0.004);
    g.add(under);

    const top = new THREE.Mesh(new THREE.PlaneGeometry(len, width * 0.85), bed);
    top.rotation.x = -Math.PI / 2;
    top.rotation.z = -angle;
    top.position.copy(mid).setY(0.006);
    g.add(top);
  }
  for (const [x, z] of points) {
    const joint = new THREE.Mesh(new THREE.CircleGeometry(width * 0.42, 16), bed);
    joint.rotation.x = -Math.PI / 2;
    joint.position.set(x, 0.006, z);
    g.add(joint);
  }
  return g;
}

function glowGate(x: number, z: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(0.01, 1.1, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(x, 0.02, z);
  g.add(glow);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), new THREE.MeshBasicMaterial({ color }));
  core.position.set(x, 0.35, z);
  g.add(core);
  return g;
}

export function createScene3D(canvas: HTMLCanvasElement, lane: Lane, frame: Frame3D): Scene3D {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1d24);
  scene.fog = new THREE.Fog(0x1a1d24, Math.max(frame.halfWidth, frame.halfHeight) * 1.5, Math.max(frame.halfWidth, frame.halfHeight) * 5);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 2;
  controls.maxDistance = Math.max(frame.halfWidth, frame.halfHeight) * 4;

  const span = Math.max(frame.halfWidth, frame.halfHeight);
  camera.position.set(0, span * 1.5, -span * 1.75);
  controls.target.set(0, 0, 0);
  controls.update();

  scene.add(new THREE.AmbientLight(0x5a6478, 1.5));
  const key = new THREE.DirectionalLight(0xfff0dd, 2.1);
  const shadowSpan = span * 1.3;
  key.position.set(shadowSpan * 0.4, shadowSpan * 0.8, shadowSpan * 0.3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -shadowSpan;
  key.shadow.camera.right = shadowSpan;
  key.shadow.camera.top = shadowSpan;
  key.shadow.camera.bottom = -shadowSpan;
  key.shadow.camera.far = shadowSpan * 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6f9fd8, 0.8);
  rim.position.set(-shadowSpan * 0.3, shadowSpan * 0.3, -shadowSpan * 0.3);
  scene.add(rim);

  scene.add(buildGround(frame));
  scene.add(buildPath(lane, frame));
  scene.add(buildPlatforms(lane, frame));

  const [sx, sz] = worldToScene(frame, lane.spawn[0], lane.spawn[1]);
  scene.add(glowGate(sx, sz, new THREE.Color(laneColor(lane.color)).getHex()));
  const end = lane.waypoints[lane.waypoints.length - 1];
  if (end) {
    const [ex, ez] = worldToScene(frame, end[0], end[1]);
    scene.add(glowGate(ex, ez, 0xff5c4a));
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

/** Libere le contexte WebGL et toute la geometrie/matieres/textures de la
 * scene avant qu'un nouveau `createScene3D` ne reutilise le meme canvas —
 * sans ca, quitter puis relancer une partie fuit un WebGLRenderer et un jeu
 * complet de meshes a chaque cycle. Parcourt le graphe de scene generiquement
 * plutot que d'ajouter un dispose() a chaque module qui cree des meshes
 * (entities3d, terrain3d, slots3d, lightningEffects...). */
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
