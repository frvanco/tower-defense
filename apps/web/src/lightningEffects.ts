import * as THREE from 'three';

/**
 * Reglages visuels de la chaine d'eclair — regroupes ici pour rester
 * modifiables sans fouiller main.ts.
 */

export const LIGHTNING_ARC_LIFE_SEC = 0.15;
export const LIGHTNING_ARC_COLOR_START = new THREE.Color(0xffffff);
export const LIGHTNING_ARC_COLOR_END = new THREE.Color(0x4a9fff);
/** Hauteur (scene) a laquelle l'arc est dessine — au niveau du corps des creeps. */
export const LIGHTNING_ARC_HEIGHT = 0.35;
/** Arcs concurrents max — les arcs s'eteignent en 150ms donc ce plafond ne
 * se voit qu'en cas de rafale de tours Lightning tirant au meme tick. */
export const LIGHTNING_ARC_MAX_CONCURRENT = 24;

// ---------------------------------------------------------------------------
// Arcs transitoires, pool reutilise (pas d'allocation par frame)
// ---------------------------------------------------------------------------

interface ArcSlot {
  line: THREE.Line;
  age: number;
  life: number;
}

export class LightningArcs {
  readonly group = new THREE.Group();
  private pool: ArcSlot[] = [];

  constructor() {
    this.group.name = 'lightningArcs';
  }

  /** Dessine un arc reliant `points` (coordonnees scene X/Z) dans l'ordre reel
   * des rebonds. Recycle l'arc le plus ancien si le pool est plein. */
  spawn(points: Array<[number, number]>): void {
    if (points.length < 2) return;

    let slot = this.pool.find((s) => s.age >= s.life);
    if (!slot && this.pool.length < LIGHTNING_ARC_MAX_CONCURRENT) {
      const geo = new THREE.BufferGeometry();
      const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1 });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      this.group.add(line);
      slot = { line, age: 0, life: 0 };
      this.pool.push(slot);
    }
    if (!slot) {
      // Pool plein et tout occupe : reutilise le plus proche de sa fin de vie.
      slot = this.pool.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
    }

    const positions = new Float32Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      const [x, z] = points[i]!;
      positions[i * 3] = x;
      positions[i * 3 + 1] = LIGHTNING_ARC_HEIGHT;
      positions[i * 3 + 2] = z;
      const t = i / (points.length - 1);
      const c = LIGHTNING_ARC_COLOR_START.clone().lerp(LIGHTNING_ARC_COLOR_END, t);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    slot.line.geometry.dispose();
    slot.line.geometry = new THREE.BufferGeometry();
    slot.line.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    slot.line.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    slot.age = 0;
    slot.life = LIGHTNING_ARC_LIFE_SEC;
    slot.line.visible = true;
    (slot.line.material as THREE.LineBasicMaterial).opacity = 1;
  }

  update(dt: number): void {
    for (const slot of this.pool) {
      if (slot.age >= slot.life) {
        slot.line.visible = false;
        continue;
      }
      slot.age += dt;
      const remaining = 1 - slot.age / slot.life;
      (slot.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, remaining);
      if (slot.age >= slot.life) slot.line.visible = false;
    }
  }

  clear(): void {
    for (const slot of this.pool) {
      slot.age = slot.life;
      slot.line.visible = false;
    }
  }

  /** Arcs actuellement visibles — utilise par l'instrumentation perf
   * (perf=1) comme proxy d'effets/"projectiles" (le combat est hit-scan,
   * voir packages/sim/src/sim.ts fireTowers : pas de mesh de projectile). */
  get activeCount(): number {
    let n = 0;
    for (const slot of this.pool) if (slot.age < slot.life) n++;
    return n;
  }
}
