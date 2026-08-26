import * as THREE from 'three';
import { MAT } from './materials.js';

/** Duree par defaut d'une construction/upgrade, en secondes — porte du prototype. */
export const DEFAULT_BUILD_DURATION_SEC = 2;

interface BuildState {
  t: number;
  duration: number;
}

interface DustParticle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

/**
 * Le prototype ajoute ses particules de poussiere directement a la Scene, en
 * coordonnees monde derivees de `tower.position`. `build.ts` ne connait pas
 * de Scene (l'API demandee est `startBuild(tower, duration)` /
 * `updateBuild(tower, dt)`, rien d'autre) : les particules sont donc plutot
 * les enfants d'un sous-Group `dust` attache a la tour, en coordonnees
 * LOCALES. Meme animation, meme resultat visuel relatif a la tour — seule la
 * hierarchie de parentage change. Voir README, section incertitudes : ce
 * repositionnement n'a pas ete verifie a l'ecran, seulement raisonne.
 */
const dustParticlesByTower = new WeakMap<THREE.Object3D, DustParticle[]>();

function dustContainer(tower: THREE.Object3D): THREE.Group {
  let d = tower.getObjectByName('dust') as THREE.Group | undefined;
  if (!d) {
    d = new THREE.Group();
    d.name = 'dust';
    tower.add(d);
  }
  return d;
}

function spawnDust(tower: THREE.Object3D, n: number): void {
  const container = dustContainer(tower);
  let list = dustParticlesByTower.get(tower);
  if (!list) {
    list = [];
    dustParticlesByTower.set(tower, list);
  }
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.5 + Math.random() * 0.5;
    const particleMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.05 + Math.random() * 0.06, 6, 5),
      MAT.dust.clone(),
    );
    particleMesh.position.set(Math.cos(a) * r, 0.05, Math.sin(a) * r);
    container.add(particleMesh);
    list.push({
      mesh: particleMesh,
      vy: 0.4 + Math.random() * 0.5,
      vx: Math.cos(a) * 0.35,
      vz: Math.sin(a) * 0.35,
      life: 1,
    });
  }
}

function updateDust(tower: THREE.Object3D, dt: number): void {
  const list = dustParticlesByTower.get(tower);
  if (!list || list.length === 0) return;
  const container = dustContainer(tower);
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i]!;
    p.life -= dt * 1.4;
    if (p.life <= 0) {
      container.remove(p.mesh);
      p.mesh.geometry.dispose();
      // MAT.dust.clone() (spawnDust) cree un materiau NEUF par particule —
      // jamais partage, donc toujours sur a disposer ici (contrairement a
      // MAT.dust lui-meme, le singleton d'origine dont il derive).
      (p.mesh.material as THREE.Material).dispose();
      list.splice(i, 1);
      continue;
    }
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    p.vy -= dt * 0.7;
    (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life * 0.55;
    p.mesh.scale.setScalar(1 + (1 - p.life) * 0.8);
  }
}

/**
 * Demarre l'animation de construction (ou de reconstruction, pour un
 * upgrade — un seul systeme sert aux deux). `tower` doit avoir ete produite
 * par une fonction `makeXxxTower` : elle attend `tower.userData.body` et des
 * enfants nommes `scaffold` / `progress`.
 */
export function startBuild(tower: THREE.Object3D, durationSec: number = DEFAULT_BUILD_DURATION_SEC): void {
  tower.userData.build = { t: 0, duration: durationSec } satisfies BuildState;
  const scaffold = tower.getObjectByName('scaffold');
  const prog = tower.getObjectByName('progress');
  if (scaffold) scaffold.visible = true;
  if (prog) prog.visible = true;
  spawnDust(tower, 14);
}

/**
 * A appeler une fois par frame pour CHAQUE tour, qu'elle soit en construction
 * ou non : gere la poussiere residuelle, la croissance, l'anneau de
 * progression, et le petit rebond final, tout en un seul point d'entree.
 */
export function updateBuild(tower: THREE.Object3D, dt: number): void {
  updateDust(tower, dt);

  const body = tower.userData.body as THREE.Object3D | undefined;
  if (!body) return;

  const b = tower.userData.build as BuildState | null | undefined;
  if (b) {
    b.t += dt / b.duration;
    const scaffold = tower.getObjectByName('scaffold');
    const prog = tower.getObjectByName('progress') as THREE.Mesh | undefined;

    if (b.t >= 1) {
      tower.userData.build = null;
      tower.userData.pop = 1;
      body.scale.set(1, 1, 1);
      if (scaffold) scaffold.visible = false;
      if (prog) prog.visible = false;
      spawnDust(tower, 10);
      return;
    }

    // La tour pousse par le bas avec un leger ecrasement horizontal : une
    // mise a l'echelle uniforme donne un effet "ballon" peu convaincant.
    const e = b.t < 0.85 ? b.t / 0.85 : 1;
    const ease = e * e * (3 - 2 * e);
    body.scale.set(0.85 + ease * 0.15, 0.06 + ease * 0.94, 0.85 + ease * 0.15);

    if (scaffold) {
      scaffold.scale.setScalar(1);
      scaffold.position.y = Math.sin(b.t * 40) * 0.006;
      scaffold.visible = b.t < 0.9;
    }

    if (prog) {
      prog.geometry.dispose();
      prog.geometry = new THREE.RingGeometry(0.72, 0.86, 48, 1, -Math.PI / 2, Math.max(0.001, b.t * Math.PI * 2));
    }

    if (Math.random() < dt * 8) spawnDust(tower, 1);
    return;
  }

  // Petit rebond a l'achevement : signale la fin sans son ni texte.
  const pop = (tower.userData.pop as number | undefined) ?? 0;
  if (pop > 0) {
    const k = 1 + Math.sin(pop * Math.PI) * 0.1;
    body.scale.set(k, 2 - k, k);
    const next = Math.max(0, pop - dt * 3.2);
    tower.userData.pop = next;
    if (next === 0) body.scale.set(1, 1, 1);
  }
}
