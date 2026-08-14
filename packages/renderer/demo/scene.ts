// ---------------------------------------------------------------------------
// Galerie de demo de la branche Cannon, recreee a partir de
// reference/cannon-branch-v5.html mais entierement pilotee par
// @tower-defense/renderer : c'est la preuve que le portage produit le meme
// rendu que le prototype. Toute la logique specifique aux tours (geometrie,
// visee, construction) vient du package ; ce fichier ne fait que composer une
// scene Three.js autour, exactement comme le ferait un vrai client de jeu.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  makeCannonTower,
  aimTurret,
  startBuild,
  updateBuild,
  MAT,
  CELL,
  MAX_RADIUS,
  getBranchChain,
  teamMaterial,
} from '@tower-defense/renderer';

const chain = getBranchChain('h000');

const app = document.getElementById('app')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1d24);
scene.fog = new THREE.Fog(0x1a1d24, 14, 30);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

function setView(kind: 'game' | 'close'): void {
  if (kind === 'game') {
    camera.position.set(0, 7.4, 9.0);
    controls.target.set(0, 0.8, 0);
  } else {
    camera.position.set(0, 2.6, 5.2);
    controls.target.set(0, 1.2, 0);
  }
  controls.update();
}
setView('game');

scene.add(new THREE.AmbientLight(0x5a6478, 1.5));
const key = new THREE.DirectionalLight(0xfff0dd, 2.1);
key.position.set(5, 9, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -10;
key.shadow.camera.right = 10;
key.shadow.camera.top = 10;
key.shadow.camera.bottom = -10;
scene.add(key);
const rim = new THREE.DirectionalLight(0x6f9fd8, 0.8);
rim.position.set(-6, 3, -5);
scene.add(rim);

function groundMesh(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshLambertMaterial({ color: 0x2b3038 }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}
scene.add(groundMesh());
const grid = new THREE.GridHelper(30, 30, 0x3a4150, 0x30363f);
grid.position.y = 0.001;
scene.add(grid);

// Vitesse de rotation de tourelle, rad/s — volontairement lente : une
// tourelle qui se cale instantanement ne donne aucune impression de masse.
const TURN_RATE = 2.6;
let mode: 'track' | 'spin' | 'idle' = 'track';

const towers: THREE.Group[] = [];
const SPACING = CELL;
let teamColor = 0xc0392b;
chain.forEach((_def, tier) => {
  const t = makeCannonTower(tier, teamColor);
  t.position.x = (tier - (chain.length - 1) / 2) * SPACING;
  scene.add(t);
  towers.push(t);
});

const targetMarker = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff5a4a }));
targetMarker.position.set(0, 0.4, 3.5);
scene.add(targetMarker);
const targetRing = new THREE.Mesh(
  new THREE.RingGeometry(0.24, 0.3, 24),
  new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
);
targetRing.rotation.x = -Math.PI / 2;
scene.add(targetRing);

let BUILD_DURATION = 2.0;

interface Shot {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  arc: number;
}
const shots: Shot[] = [];

function fire(tower: THREE.Group): void {
  if (tower.userData.build) return;
  const turret = tower.userData.turret as THREE.Object3D;
  const muzzle = turret.getObjectByName('muzzle');
  if (!muzzle) return;
  const from = muzzle.getWorldPosition(new THREE.Vector3());
  const to = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, -from.y + 0.1, 3.8));
  const size = 0.05 + (tower.userData.tier as number) * 0.015;
  const p = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), MAT.hot);
  p.position.copy(from);
  scene.add(p);
  shots.push({ mesh: p, from, to, t: 0, arc: 0.9 });

  const flash = new THREE.Mesh(new THREE.SphereGeometry(size * 3.2, 8, 6), MAT.hot);
  flash.position.copy(from);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 70);
  tower.userData.recoil = 1;
}

const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selected = 0;
let showRange = false;
let showFoot = true;

function pickTower(e: PointerEvent): THREE.Group | null {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  const hit = ray.intersectObjects(towers, true)[0];
  if (!hit) return null;
  let o: THREE.Object3D | null = hit.object;
  while (o && o.parent && !o.userData.def) o = o.parent;
  return o && o.userData.def ? (o as THREE.Group) : null;
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  const t = pickTower(e);
  if (t) {
    selected = t.userData.tier as number;
    showInfo();
  }
});
renderer.domElement.addEventListener('dblclick', (e) => {
  const t = pickTower(e as unknown as PointerEvent);
  if (t) startBuild(t, BUILD_DURATION);
});

function showInfo(): void {
  const d = chain[selected]!;
  document.querySelector('#info h2')!.textContent = `${d.name}  ·  palier ${selected + 1}/${chain.length}`;
  document.getElementById('stats')!.innerHTML = `
    <dt>Or</dt><dd>${d.goldCost.toLocaleString('fr-FR')}</dd>
    <dt>Dégâts</dt><dd>${d.damageBase}</dd>
    <dt>Cadence</dt><dd>${d.cooldown}s</dd>
    <dt>Portée</dt><dd>${d.range}</dd>
    <dt>Zone</dt><dd>${d.aoeFull || 'mono-cible'}</dd>
    <dt>Cibles</dt><dd>${d.targets.includes('air') ? 'air + sol' : 'sol'}</dd>
    <dt>Emprise</dt><dd>${towers[selected] ? (towers[selected]!.userData.radius as number).toFixed(2) : '?'} / ${MAX_RADIUS.toFixed(2)}</dd>`;
}
showInfo();

const $ = (id: string) => document.getElementById(id)!;
function setMode(m: typeof mode): void {
  mode = m;
  targetMarker.visible = m === 'track';
  for (const b of ['btn-track', 'btn-spin', 'btn-idle']) $(b).classList.remove('on');
  $({ track: 'btn-track', spin: 'btn-spin', idle: 'btn-idle' }[m]).classList.add('on');
}
$('btn-track').onclick = () => setMode('track');
$('btn-spin').onclick = () => setMode('spin');
$('btn-idle').onclick = () => setMode('idle');
$('btn-attack').onclick = () => towers.forEach((t, i) => setTimeout(() => fire(t), i * 90));
$('btn-build').onclick = () => towers.forEach((t, i) => setTimeout(() => startBuild(t, BUILD_DURATION), i * 140));
$('btn-game').onclick = (e) => {
  setView('game');
  (e.target as HTMLElement).classList.add('on');
  $('btn-close').classList.remove('on');
};
$('btn-close').onclick = (e) => {
  setView('close');
  (e.target as HTMLElement).classList.add('on');
  $('btn-game').classList.remove('on');
};
$('btn-range').onclick = (e) => {
  showRange = !showRange;
  (e.target as HTMLElement).classList.toggle('on', showRange);
};
$('btn-foot').onclick = (e) => {
  showFoot = !showFoot;
  (e.target as HTMLElement).classList.toggle('on', showFoot);
};
$('btn-wire').onclick = (e) => {
  const on = !MAT.stone.wireframe;
  Object.values(MAT).forEach((m) => {
    if ('wireframe' in m) (m as THREE.MeshLambertMaterial).wireframe = on;
  });
  (e.target as HTMLElement).classList.toggle('on', on);
};
($('team') as HTMLInputElement).oninput = (e) => {
  teamColor = parseInt((e.target as HTMLInputElement).value.slice(1), 16);
  const mat = teamMaterial(teamColor);
  for (const t of towers) {
    const flag = t.getObjectByName('flag') as THREE.Mesh | undefined;
    if (flag) flag.material = mat;
  }
};
($('dur') as HTMLInputElement).oninput = (e) => {
  BUILD_DURATION = +(e.target as HTMLInputElement).value;
  $('dur-v').textContent = BUILD_DURATION.toFixed(1) + 's';
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
function loop(): void {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.getElapsedTime();

  const cycle = (time * 0.28) % 1;
  const paused = cycle > 0.42 && cycle < 0.58;
  targetMarker.position.x = Math.sin(time * 0.55) * 5.2;
  targetMarker.position.z = 3.2 + Math.cos(time * 0.4) * 0.9;
  targetMarker.visible = mode === 'track' && !paused;
  targetRing.visible = targetMarker.visible;
  targetRing.position.set(targetMarker.position.x, 0.02, targetMarker.position.z);

  towers.forEach((t, i) => {
    updateBuild(t, dt);
    const building = !!t.userData.build;
    const turret = t.userData.turret as THREE.Object3D;

    if (!building) {
      if (mode === 'track' && targetMarker.visible) {
        aimTurret(turret, targetMarker.position, TURN_RATE, dt);
      } else if (mode === 'spin') {
        turret.rotation.y = time * 0.55 + i * 0.4;
      }
    }

    const r = (t.userData.recoil as number) ?? 0;
    if (r > 0) {
      turret.position.z = -r * 0.18;
      t.userData.recoil = Math.max(0, r - dt * 4.5);
    } else {
      turret.position.z = 0;
    }

    const flag = t.getObjectByName('flag');
    if (flag) flag.rotation.y = Math.sin(time * 2.4 + i) * 0.22;

    t.getObjectByName('rangeRing')!.visible = showRange && i === selected && !building;
    t.getObjectByName('footprint')!.visible = showFoot;
    t.position.y = i === selected && !building ? Math.sin(time * 2) * 0.03 + 0.05 : 0;
  });

  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i]!;
    s.t += dt * 1.5;
    if (s.t >= 1) {
      scene.remove(s.mesh);
      shots.splice(i, 1);
      continue;
    }
    s.mesh.position.lerpVectors(s.from, s.to, s.t);
    s.mesh.position.y += Math.sin(s.t * Math.PI) * s.arc;
  }

  controls.update();
  renderer.render(scene, camera);
}
loop();

// Petit crochet pour les captures automatisees : signale que la scene a
// construit ses 6 tours et rendu au moins une frame.
(window as unknown as { __sceneReady: boolean }).__sceneReady = true;
