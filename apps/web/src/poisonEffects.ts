import * as THREE from 'three';

/**
 * Reglages visuels du poison — regroupes ici pour rester modifiables sans
 * fouiller entities3d.ts.
 */

export const POISON_BUBBLE_COLOR = 0x6be36b;
export const POISON_EMISSIVE_COLOR = new THREE.Color(0x3fdf5a);
/** Frequence de la pulsation emissive qui marque chaque "tick" de degats. */
export const POISON_PULSE_HZ = 3;
export const POISON_PULSE_MIN = 0.25;

/** Nombre max de bulles actives simultanement, toutes sources confondues —
 * plafond dur pour la performance quel que soit le nombre de creeps touches. */
export const POISON_MAX_PARTICLES = 240;
/** Bulles/seconde pour le poison le plus faible (palier 1, 8 dps). */
export const POISON_BASE_RATE = 3;
/** Bulles/seconde ajoutees par point de dps — au palier 4 (90 dps) ca donne
 * une densite nettement superieure au palier 1, comme demande. */
export const POISON_RATE_PER_DPS = 0.11;
export const POISON_MAX_RATE = 14;
export const POISON_PARTICLE_LIFE_SEC = 0.9;
export const POISON_PARTICLE_RISE_SPEED = 0.22;
export const POISON_PARTICLE_BASE_SCALE = 0.045;

// ---------------------------------------------------------------------------
// Pool de particules instanciees (pas d'allocation par frame/creep)
// ---------------------------------------------------------------------------

interface PoisonParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vy: number;
  age: number;
  life: number;
  scale: number;
}

export class PoisonBubbles {
  readonly mesh: THREE.InstancedMesh;
  private particles: PoisonParticle[] = [];
  private spawnAcc = new Map<number, number>();
  private nextFree = 0;
  private tmpMatrix = new THREE.Matrix4();
  private tmpPos = new THREE.Vector3();
  private tmpScale = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();

  constructor() {
    const geo = new THREE.SphereGeometry(1, 6, 5);
    const mat = new THREE.MeshBasicMaterial({ color: POISON_BUBBLE_COLOR, transparent: true, opacity: 0.75 });
    this.mesh = new THREE.InstancedMesh(geo, mat, POISON_MAX_PARTICLES);
    this.mesh.name = 'poisonBubbles';
    this.mesh.frustumCulled = false;
    for (let i = 0; i < POISON_MAX_PARTICLES; i++) {
      this.particles.push({ active: false, x: 0, y: 0, z: 0, vy: 0, age: 0, life: 1, scale: 0 });
      this.mesh.setMatrixAt(i, this.tmpMatrix.makeScale(0, 0, 0));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** A appeler une fois par creep empoisonne, chaque frame — accumule un taux
   * de spawn proportionnel aux dps et fait naitre des bulles quand il deborde. */
  requestSpawn(eid: number, x: number, y: number, z: number, dps: number, dt: number): void {
    const rate = Math.min(POISON_MAX_RATE, POISON_BASE_RATE + dps * POISON_RATE_PER_DPS);
    const acc = (this.spawnAcc.get(eid) ?? 0) + rate * dt;
    let remaining = acc;
    while (remaining >= 1) {
      this.spawn(x, y, z);
      remaining -= 1;
    }
    this.spawnAcc.set(eid, remaining);
  }

  /** A appeler une fois par frame pour un eid qui n'est plus empoisonne — evite
   * qu'un vieux reliquat d'accumulateur fasse jaillir une bulle en retard. */
  clearAccumulator(eid: number): void {
    this.spawnAcc.delete(eid);
  }

  private spawn(x: number, y: number, z: number): void {
    for (let tries = 0; tries < POISON_MAX_PARTICLES; tries++) {
      const idx = this.nextFree;
      this.nextFree = (this.nextFree + 1) % POISON_MAX_PARTICLES;
      const p = this.particles[idx]!;
      if (p.active) continue;
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 0.06;
      p.active = true;
      p.x = x + Math.cos(angle) * radius;
      p.z = z + Math.sin(angle) * radius;
      p.y = y;
      p.vy = POISON_PARTICLE_RISE_SPEED * (0.7 + Math.random() * 0.6);
      p.age = 0;
      p.life = POISON_PARTICLE_LIFE_SEC * (0.75 + Math.random() * 0.5);
      p.scale = POISON_PARTICLE_BASE_SCALE * (0.7 + Math.random() * 0.6);
      return;
    }
    // Pool plein : la plus vieille bulle sera recyclee au prochain cycle,
    // on abandonne simplement ce spawn plutot que de depasser le plafond.
  }

  update(dt: number): void {
    let anyActive = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      if (!p.active) continue;
      anyActive = true;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        this.mesh.setMatrixAt(i, this.tmpMatrix.makeScale(0, 0, 0));
        continue;
      }
      p.y += p.vy * dt;
      const t = p.age / p.life;
      // Grossit vite au debut, retombe a rien sur le dernier quart de vie.
      const growth = Math.min(1, t / 0.25);
      const fade = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
      const s = p.scale * growth * fade;
      this.tmpPos.set(p.x, p.y, p.z);
      this.tmpScale.set(s, s, s);
      this.mesh.setMatrixAt(i, this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale));
    }
    if (anyActive) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < this.particles.length; i++) {
      this.particles[i]!.active = false;
      this.mesh.setMatrixAt(i, this.tmpMatrix.makeScale(0, 0, 0));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.spawnAcc.clear();
  }

  /** Bulles actuellement actives — utilise par l'instrumentation perf
   * (perf=1) uniquement. */
  get activeCount(): number {
    let n = 0;
    for (const p of this.particles) if (p.active) n++;
    return n;
  }
}
