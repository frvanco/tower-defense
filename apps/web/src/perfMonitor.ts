import * as THREE from 'three';
import { TICK_RATE, type GameState } from '@tower-defense/sim';
import type { Scene3D } from './scene3d.js';
import type { TowerEntities, CreepEntities } from './entities3d.js';
import type { LightningArcs } from './lightningEffects.js';

/**
 * Instrumentation de performance, opt-in via `?perf=1` dans l'URL — jamais
 * active par defaut, aucun cout quand elle est absente (voir isPerfEnabled,
 * seul point d'entree lu par main.ts). Ne modifie aucun etat de jeu : lit
 * uniquement `renderer.info`, la scene et `state.arenas` pour produire un
 * rapport exportable via `window.__perf` (voir getReport()/downloadReport()).
 */
export function isPerfEnabled(): boolean {
  if (typeof location === 'undefined') return false;
  try {
    return new URLSearchParams(location.search).get('perf') === '1';
  } catch {
    return false;
  }
}

interface FrameSample {
  /** secondes ecoulees depuis le debut de la mesure (temps reel, horloge de rendu). */
  t: number;
  /** Delta reel entre deux requestAnimationFrame, JAMAIS plafonne — c'est la
   * SEULE valeur utilisee pour tout calcul de FPS/percentile ci-dessous (voir
   * PerfSampleInput). A ne pas confondre avec le delta clampe a 250ms que
   * main.ts utilise pour faire avancer la simulation (voir simulationDtMs) :
   * les deux servent des buts differents et ne doivent jamais etre melanges,
   * sans quoi les pires frames se retrouvent artificiellement ecretees. */
  rawFrameTimeMs: number;
}

export interface PerfSecondSnapshot {
  t: number;
  simElapsedSec: number;
  round: number;
  /** Tous calcules a partir de rawFrameTimeMs (non plafonne) — voir FrameSample. */
  fpsAvg: number;
  fpsMin: number;
  fpsMax: number;
  frameMsAvg: number;
  frameMsMax: number;
  frameCount: number;
  /** Delta CLAMPE (main.ts, Math.min(rawDt,250)) reellement consomme par la
   * simulation ce cycle — reporte a part, a titre informatif seulement,
   * jamais utilise dans les stats de fluidite ci-dessus. */
  simDtMsAvg: number;
  cpu: { simMsAvg: number; syncMsAvg: number; renderMsAvg: number };
  gpuMsAvg: number | null;
  renderer: {
    calls: number;
    triangles: number;
    lines: number;
    points: number;
    geometries: number;
    textures: number;
    programs: number | null;
  };
  scene: { totalObjects: number; visibleMeshes: number; hiddenMeshes: number; lights: number; shadowCastingLights: number };
  game: {
    viewedPlayer: number;
    viewedCreeps: number;
    viewedTowers: number;
    viewedCreepsByType: Record<string, number>;
    allArenasCreeps: number;
    allArenasTowers: number;
    humanoidAnimating: number;
    lightningArcsActive: number;
    poisonBubblesActive: number;
  };
  memory: { usedMB: number; totalMB: number; limitMB: number } | null;
}

export interface PerfMarker {
  tReal: number;
  simElapsedSec: number;
  label: string;
  detail?: string;
}

export interface PerfReport {
  meta: {
    userAgent: string;
    mode: string;
    canvasWidth: number;
    canvasHeight: number;
    devicePixelRatio: number;
    threeRevision: string;
    fpsCap: string;
    gpuTimingAvailable: boolean;
    testStartedAtIso: string;
    testDurationSec: number;
    /** Fin de la fenetre de prechauffage (secondes reelles depuis le debut
     * de la mesure) — voir markWarmupEnd(). Les stats de `summary` sont
     * calculees UNIQUEMENT sur les echantillons posterieurs ; `perSecond`
     * et les marqueurs, eux, couvrent toute la duree sans filtrage. null si
     * markWarmupEnd() n'a jamais ete appele (tout est compte). */
    warmupEndSec: number | null;
  };
  summary: {
    frameCount: number;
    fpsAvg: number;
    fpsMin: number;
    fpsMax: number;
    fps1PctLow: number;
    fps01PctLow: number;
    /** Tous calcules sur rawFrameTimeMs, JAMAIS plafonne (voir FrameSample) —
     * un vrai p95/p99/max, pas ecrete par le clamp de simulation de main.ts. */
    frameMsMean: number;
    frameMsMedian: number;
    frameMsP95: number;
    frameMsP99: number;
    frameMsMax: number;
    framesOver16_67ms: number;
    framesOver33_33ms: number;
    framesOver50ms: number;
    framesOver100ms: number;
    maxViewedCreeps: number;
    maxAllArenasCreeps: number;
    maxTowers: number;
    maxDrawCalls: number;
    maxTriangles: number;
    memoryStartMB: number | null;
    memoryMidMB: number | null;
    memoryEndMB: number | null;
    memoryDeltaMB: number | null;
    memoryTrendSlopeMBPerMin: number | null;
  };
  slowestPeriods: PerfSecondSnapshot[];
  perSecond: PerfSecondSnapshot[];
  markers: PerfMarker[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Moyenne des FPS des N% de frames les plus lentes (definition usuelle du
 * "1% low"/"0.1% low" en benchmark) — jamais une simple moyenne globale. */
function lowPercentFps(frameMsSorted: number[], pct: number): number {
  if (frameMsSorted.length === 0) return 0;
  const n = Math.max(1, Math.round(frameMsSorted.length * (pct / 100)));
  const slowest = frameMsSorted.slice(-n);
  return mean(slowest.map((ms) => (ms > 0 ? 1000 / ms : 0)));
}

/** Tente une extension de timer GPU (WebGL2 uniquement) — no-op silencieux si
 * indisponible (contexte software/SwiftShader, navigateur sans support, etc.)
 * plutot que de fabriquer une mesure. Une requete par frame, resultats
 * recuperes de maniere non bloquante au prochain sondage. */
class GpuTimer {
  readonly available: boolean;
  private gl: WebGL2RenderingContext | null = null;
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private pending: WebGLQuery[] = [];
  private results: number[] = [];

  constructor(renderer: THREE.WebGLRenderer) {
    try {
      const gl = renderer.getContext();
      if (!(gl instanceof WebGL2RenderingContext)) {
        this.available = false;
        return;
      }
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (!ext) {
        this.available = false;
        return;
      }
      this.gl = gl;
      this.ext = ext;
      this.available = true;
    } catch {
      this.available = false;
    }
  }

  begin(): void {
    if (!this.available || !this.gl || !this.ext) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.pending.push(q);
  }

  end(): void {
    if (!this.available || !this.gl || !this.ext) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
  }

  /** A appeler une fois par frame, apres end() : draine les requetes emises
   * lors des frames precedentes devenues disponibles. */
  poll(): void {
    if (!this.available || !this.gl || !this.ext) return;
    const gl = this.gl;
    const ext = this.ext;
    while (this.pending.length > 0) {
      const q = this.pending[0]!;
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      if (!disjoint) {
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
        this.results.push(ns / 1e6);
      }
      gl.deleteQuery(q);
      this.pending.shift();
    }
  }

  /** Moyenne des resultats recuperes depuis le dernier appel, puis remet a
   * zero le tampon — a appeler une fois par snapshot (1s). */
  drainAverage(): number | null {
    if (this.results.length === 0) return this.available ? null : null;
    const avg = mean(this.results);
    this.results = [];
    return avg;
  }
}

export interface PerfSampleInput {
  /** Delta reel non plafonne entre deux frames (voir FrameSample) — c'est
   * celui-ci, et lui seul, que le moniteur utilise pour les FPS/percentiles. */
  rawFrameTimeMs: number;
  /** Delta clampe (main.ts, Math.min(rawDt,250)) reellement utilise pour
   * faire avancer la simulation ce cycle — enregistre a part, jamais mele
   * aux stats de fluidite (voir simDtMsAvg). */
  simulationDtMs: number;
  state: GameState;
  viewedPlayer: number;
  creepEntitiesByPlayer: CreepEntities[];
  towerEntitiesByPlayer: TowerEntities[];
  lightningArcs: LightningArcs;
  cpu: { simMs: number; syncMs: number; renderMs: number };
}

export class PerfMonitor {
  private readonly startedAtPerf = performance.now();
  private readonly startedAtIso = new Date().toISOString();
  private frames: FrameSample[] = [];
  private bucketFrames: FrameSample[] = [];
  private bucketSimDt: number[] = [];
  private bucketCpu: { simMs: number; syncMs: number; renderMs: number }[] = [];
  private bucketIndex = 0;
  private snapshots: PerfSecondSnapshot[] = [];
  private markers: PerfMarker[] = [];
  private maxAllArenasCreeps = 0;
  private maxTowers = 0;
  private lastRound = -1;
  private lastState: GameState | null = null;
  private warmupEndSec: number | null = null;
  private gpuTimer: GpuTimer;

  constructor(private s3d: Scene3D) {
    this.gpuTimer = new GpuTimer(s3d.renderer);
  }

  /** A appeler apres quelques secondes de jeu (le temps que les assets/GLB
   * finissent de charger et que le JIT/les caches WebGL se stabilisent) —
   * exclut tout ce qui precede du `summary` final sans jeter les
   * echantillons bruts (voir getReport). Idempotent : seul le premier appel
   * compte. */
  markWarmupEnd(): void {
    if (this.warmupEndSec !== null) return;
    this.warmupEndSec = (performance.now() - this.startedAtPerf) / 1000;
    if (this.lastState) this.markEvent('Fin de prechauffage', this.lastState);
  }

  /** Marqueur temporel manuel (debut de manche via l'evenement sim
   * roundStart, fin de partie, pic auto-detecte, etc.). */
  markEvent(label: string, state: GameState, detail?: string): void {
    this.markers.push({
      tReal: (performance.now() - this.startedAtPerf) / 1000,
      simElapsedSec: state.tick / TICK_RATE,
      label,
      detail,
    });
  }

  /** Execute l'appel de rendu en l'enveloppant d'une requete de timer GPU
   * (no-op si l'extension est indisponible, voir GpuTimer) et retourne le
   * temps CPU (ms) passe dans renderFn — la seule chose que main.ts a besoin
   * de connaitre de son cote. */
  timeRender(renderFn: () => void): number {
    const t0 = performance.now();
    this.gpuTimer.begin();
    renderFn();
    this.gpuTimer.end();
    return performance.now() - t0;
  }

  /** A appeler une fois par frame de rendu, juste apres renderer.render(). */
  sample(input: PerfSampleInput): void {
    this.gpuTimer.poll();
    this.lastState = input.state;

    const tReal = (performance.now() - this.startedAtPerf) / 1000;
    this.frames.push({ t: tReal, rawFrameTimeMs: input.rawFrameTimeMs });
    this.bucketFrames.push({ t: tReal, rawFrameTimeMs: input.rawFrameTimeMs });
    this.bucketSimDt.push(input.simulationDtMs);
    this.bucketCpu.push(input.cpu);

    if (input.state.round !== this.lastRound) {
      this.lastRound = input.state.round;
      this.markEvent(`Manche ${input.state.round}`, input.state);
    }

    let allArenasCreeps = 0;
    let allArenasTowers = 0;
    for (const arena of input.state.arenas) {
      if (!arena) continue;
      allArenasCreeps += arena.creeps.length;
      allArenasTowers += arena.towers.length;
    }
    if (allArenasCreeps > this.maxAllArenasCreeps * 1.2 && allArenasCreeps > 20) {
      this.markEvent('Pic d’unites', input.state, `${allArenasCreeps} creeps (toutes arenes)`);
    }
    if (allArenasCreeps > this.maxAllArenasCreeps) this.maxAllArenasCreeps = allArenasCreeps;
    if (allArenasTowers > this.maxTowers) this.maxTowers = allArenasTowers;

    const bucketNow = Math.floor(tReal);
    if (bucketNow > this.bucketIndex) {
      this.finalizeBucket(input, allArenasCreeps, allArenasTowers);
      this.bucketIndex = bucketNow;
    }
  }

  private finalizeBucket(input: PerfSampleInput, allArenasCreeps: number, allArenasTowers: number): void {
    if (this.bucketFrames.length === 0) return;
    const frameMsList = this.bucketFrames.map((f) => f.rawFrameTimeMs);
    const fpsList = frameMsList.map((ms) => (ms > 0 ? 1000 / ms : 0));

    const info = this.s3d.renderer.info;
    let totalObjects = 0;
    let visibleMeshes = 0;
    let hiddenMeshes = 0;
    let lights = 0;
    let shadowCastingLights = 0;
    this.s3d.scene.traverse((obj) => {
      totalObjects++;
      if ((obj as THREE.Light).isLight) {
        lights++;
        if ((obj as THREE.DirectionalLight).castShadow) shadowCastingLights++;
      }
      const mesh = obj as THREE.Mesh | THREE.InstancedMesh;
      if (mesh.isMesh) {
        if (mesh.visible) visibleMeshes++;
        else hiddenMeshes++;
      }
    });

    const viewedCreepEntities = input.creepEntitiesByPlayer[input.viewedPlayer];
    const viewedTowerArena = input.state.arenas[input.viewedPlayer];
    const viewedCreepsByType: Record<string, number> = {};
    if (viewedTowerArena) {
      for (const c of viewedTowerArena.creeps) viewedCreepsByType[c.defId] = (viewedCreepsByType[c.defId] ?? 0) + 1;
    }
    const viewedCounts = viewedCreepEntities?.counts;

    let humanoidAnimating = 0;
    let poisonBubblesActive = 0;
    for (const ce of input.creepEntitiesByPlayer) {
      const c = ce.counts;
      humanoidAnimating += c.animating;
      poisonBubblesActive += c.poisonBubbles;
    }

    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;

    const snapshot: PerfSecondSnapshot = {
      t: this.bucketFrames[0]!.t,
      simElapsedSec: input.state.tick / TICK_RATE,
      round: input.state.round,
      fpsAvg: mean(fpsList),
      fpsMin: Math.min(...fpsList),
      fpsMax: Math.max(...fpsList),
      frameMsAvg: mean(frameMsList),
      frameMsMax: Math.max(...frameMsList),
      frameCount: this.bucketFrames.length,
      simDtMsAvg: mean(this.bucketSimDt),
      cpu: {
        simMsAvg: mean(this.bucketCpu.map((c) => c.simMs)),
        syncMsAvg: mean(this.bucketCpu.map((c) => c.syncMs)),
        renderMsAvg: mean(this.bucketCpu.map((c) => c.renderMs)),
      },
      gpuMsAvg: this.gpuTimer.drainAverage(),
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        lines: info.render.lines,
        points: info.render.points,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? null,
      },
      scene: { totalObjects, visibleMeshes, hiddenMeshes, lights, shadowCastingLights },
      game: {
        viewedPlayer: input.viewedPlayer,
        viewedCreeps: viewedTowerArena?.creeps.length ?? 0,
        viewedTowers: viewedTowerArena?.towers.length ?? 0,
        viewedCreepsByType,
        allArenasCreeps,
        allArenasTowers,
        humanoidAnimating,
        lightningArcsActive: input.lightningArcs.activeCount,
        poisonBubblesActive,
      },
      memory: mem
        ? {
            usedMB: mem.usedJSHeapSize / (1024 * 1024),
            totalMB: mem.totalJSHeapSize / (1024 * 1024),
            limitMB: mem.jsHeapSizeLimit / (1024 * 1024),
          }
        : null,
    };
    void viewedCounts;
    this.snapshots.push(snapshot);
    this.bucketFrames = [];
    this.bucketSimDt = [];
    this.bucketCpu = [];
  }

  /** Calculable a tout moment (pendant ou apres la partie) — n'arrete rien.
   * `summary` et `slowestPeriods` ne portent que sur la fenetre posterieure a
   * markWarmupEnd() (tout, si jamais appelee) ; `perSecond`/`markers`
   * couvrent toute la duree, prechauffage inclus, pour rester transparents. */
  getReport(): PerfReport {
    const cutoff = this.warmupEndSec ?? 0;
    const framesInWindow = this.frames.filter((f) => f.t >= cutoff);
    const snapshotsInWindow = this.snapshots.filter((s) => s.t >= cutoff);

    const frameMsAll = framesInWindow.map((f) => f.rawFrameTimeMs);
    const frameMsSorted = [...frameMsAll].sort((a, b) => a - b);
    const fpsAll = frameMsAll.map((ms) => (ms > 0 ? 1000 / ms : 0));

    const memSnapshots = snapshotsInWindow.filter((s) => s.memory !== null).map((s) => s.memory!.usedMB);
    let memoryStartMB: number | null = null;
    let memoryMidMB: number | null = null;
    let memoryEndMB: number | null = null;
    let memoryTrendSlopeMBPerMin: number | null = null;
    if (memSnapshots.length > 0) {
      memoryStartMB = memSnapshots[0]!;
      memoryMidMB = memSnapshots[Math.floor(memSnapshots.length / 2)]!;
      memoryEndMB = memSnapshots[memSnapshots.length - 1]!;
      // Regression lineaire simple (t en minutes, memoire en MB) sur les
      // snapshots avec memoire disponible — indicateur de tendance, pas une
      // preuve de fuite a lui seul (voir la synthese qui l'accompagne).
      const pts = snapshotsInWindow.filter((s) => s.memory !== null).map((s) => [s.t / 60, s.memory!.usedMB] as const);
      const n = pts.length;
      if (n >= 2) {
        const sumX = pts.reduce((a, [x]) => a + x, 0);
        const sumY = pts.reduce((a, [, y]) => a + y, 0);
        const sumXY = pts.reduce((a, [x, y]) => a + x * y, 0);
        const sumXX = pts.reduce((a, [x]) => a + x * x, 0);
        const denom = n * sumXX - sumX * sumX;
        memoryTrendSlopeMBPerMin = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
      }
    }

    const slowest = [...snapshotsInWindow].sort((a, b) => a.fpsAvg - b.fpsAvg).slice(0, 10);
    const canvas = this.s3d.renderer.domElement;

    return {
      meta: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        mode: (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE ?? 'unknown',
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        devicePixelRatio: typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1,
        threeRevision: THREE.REVISION,
        fpsCap: 'aucune limite explicite — requestAnimationFrame, cadence du compositeur/ecran',
        gpuTimingAvailable: this.gpuTimer.available,
        testStartedAtIso: this.startedAtIso,
        testDurationSec: this.frames.length > 0 ? this.frames[this.frames.length - 1]!.t : 0,
        warmupEndSec: this.warmupEndSec,
      },
      summary: {
        frameCount: framesInWindow.length,
        fpsAvg: mean(fpsAll),
        fpsMin: fpsAll.length ? Math.min(...fpsAll) : 0,
        fpsMax: fpsAll.length ? Math.max(...fpsAll) : 0,
        fps1PctLow: lowPercentFps(frameMsSorted, 1),
        fps01PctLow: lowPercentFps(frameMsSorted, 0.1),
        frameMsMean: mean(frameMsAll),
        frameMsMedian: percentile(frameMsSorted, 50),
        frameMsP95: percentile(frameMsSorted, 95),
        frameMsP99: percentile(frameMsSorted, 99),
        frameMsMax: frameMsSorted.length ? frameMsSorted[frameMsSorted.length - 1]! : 0,
        framesOver16_67ms: frameMsAll.filter((ms) => ms > 16.67).length,
        framesOver33_33ms: frameMsAll.filter((ms) => ms > 33.33).length,
        framesOver50ms: frameMsAll.filter((ms) => ms > 50).length,
        framesOver100ms: frameMsAll.filter((ms) => ms > 100).length,
        maxViewedCreeps: Math.max(0, ...snapshotsInWindow.map((s) => s.game.viewedCreeps)),
        maxAllArenasCreeps: this.maxAllArenasCreeps,
        maxTowers: this.maxTowers,
        maxDrawCalls: Math.max(0, ...snapshotsInWindow.map((s) => s.renderer.calls)),
        maxTriangles: Math.max(0, ...snapshotsInWindow.map((s) => s.renderer.triangles)),
        memoryStartMB,
        memoryMidMB,
        memoryEndMB,
        memoryDeltaMB: memoryStartMB !== null && memoryEndMB !== null ? memoryEndMB - memoryStartMB : null,
        memoryTrendSlopeMBPerMin,
      },
      slowestPeriods: slowest,
      perSecond: this.snapshots,
      markers: this.markers,
    };
  }
}
