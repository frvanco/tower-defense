import * as THREE from 'three';
import type { AnimatedCreepModel } from './animatedCreepModel.js';

/** Capacite fixe par arene, partagee par toutes les instances d'UN modele qui
 * y sont presentes. Un debordement (plus de 256 instances vivantes
 * simultanement dans une arene) est un cas limite jamais rencontre en
 * pratique (tailles de vague reelles tres en dessous) ; allocate() retourne
 * alors null et l'appelant ignore la pose pour ce cycle plutot que de
 * planter. */
const ANIMATED_CREEP_INSTANCE_CAPACITY = 256;

const ZERO_SCALE = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Un `InstancedMesh` par noeud anime du modele (voir animatedCreepModel.ts),
 * partage par toutes les instances d'UN modele dans UNE arene — une
 * douzaine de draw calls par modele et par arene, quel que soit le nombre
 * de creeps vivants de ce type, plutot qu'un clone complet (des dizaines de
 * meshes) par creep.
 */
export class AnimatedInstancedGroup {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[];
  private freeIndices: number[] = [];
  private byEid = new Map<number, number>();
  private tmpMatrix = new THREE.Matrix4();

  constructor(private model: AnimatedCreepModel) {
    this.group.name = 'animated-creeps';
    this.meshes = model.geometries.map((geo) => {
      const mesh = new THREE.InstancedMesh(geo, model.material, ANIMATED_CREEP_INSTANCE_CAPACITY);
      // Les instances vivent tant que le creep existe, pas seulement pendant
      // les rares upgrades — DynamicDrawUsage est le bon choix (buffer
      // recree/reecrit chaque frame, pas un one-shot StaticDrawUsage).
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      // Les personnages se deplacent dans un unique InstancedMesh. Three.js
      // ne recalcule pas automatiquement sa bounding sphere apres chaque
      // setMatrixAt() : en zoom serre, le volume reste pres d'une ancienne
      // position et tout le lot peut etre exclu alors qu'il est a l'ecran.
      // Le groupe de l'arene non observee reste masque par son parent ; pour
      // l'arene visible, desactiver ce culling est plus fiable et moins cher
      // qu'un recalcul de toutes les bornes a chaque frame.
      mesh.frustumCulled = false;
      // `count` demarre a 0 : le GPU ne doit traiter QUE les instances
      // reellement utilisees, pas les 256 de la capacite (une matrice a
      // echelle nulle masque visuellement une instance inutilisee, mais le
      // GPU continue de la traiter tant qu'elle est comprise dans `count` —
      // sans cette borne, 256 instances "vides" coutent quasiment autant que
      // 256 pleines). Mis a jour par updateCount() a chaque allocate/free.
      mesh.count = 0;
      for (let i = 0; i < ANIMATED_CREEP_INSTANCE_CAPACITY; i++) mesh.setMatrixAt(i, ZERO_SCALE);
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
      return mesh;
    });
    for (let i = ANIMATED_CREEP_INSTANCE_CAPACITY - 1; i >= 0; i--) this.freeIndices.push(i);
  }

  /** Recalcule `count` = plus haut indice actuellement utilise + 1, et le
   * propage a chacun des InstancedMesh — appele apres chaque allocate/free.
   * O(instances vivantes), donc trivial (au plus 256), et seulement au
   * moment ou la population change, jamais par frame. */
  private updateCount(): void {
    let max = 0;
    for (const index of this.byEid.values()) if (index + 1 > max) max = index + 1;
    for (const mesh of this.meshes) mesh.count = max;
  }

  /** Indice deja alloue pour ce creep, s'il en a un. */
  indexOf(eid: number): number | undefined {
    return this.byEid.get(eid);
  }

  /** Alloue un indice pour ce creep s'il n'en a pas deja un (idempotent).
   * Prend toujours le plus petit indice libre disponible (pas une pile
   * LIFO) : garde la population allouee compacte vers le bas, pour que
   * `count` (voir updateCount) redescende reellement quand des instances a
   * indice eleve meurent, plutot que de rester bloque pres de la capacite.
   * null si la capacite est epuisee (voir le commentaire de la classe). */
  allocate(eid: number): number | null {
    const existing = this.byEid.get(eid);
    if (existing !== undefined) return existing;
    if (this.freeIndices.length === 0) return null;
    let minPos = 0;
    for (let i = 1; i < this.freeIndices.length; i++) {
      if (this.freeIndices[i]! < this.freeIndices[minPos]!) minPos = i;
    }
    const index = this.freeIndices[minPos]!;
    this.freeIndices.splice(minPos, 1);
    this.byEid.set(eid, index);
    this.updateCount();
    return index;
  }

  /** Libere l'indice de ce creep (masque l'instance et la remet en pool). */
  free(eid: number): void {
    const index = this.byEid.get(eid);
    if (index === undefined) return;
    this.byEid.delete(eid);
    this.hide(index);
    this.freeIndices.push(index);
    this.updateCount();
  }

  hide(index: number): void {
    for (const mesh of this.meshes) {
      mesh.setMatrixAt(index, ZERO_SCALE);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Pose l'instance `index` : `worldMatrix` place le personnage entier
   * (position au sol, cap, echelle) ; `frameTable[noeud][frameIndex]` donne
   * la matrice locale du noeud au pas d'animation courant (meme ordre que
   * model.nodeNames). Indexe directement dans la table plutot que de
   * recevoir un tableau deja resolu : evite une allocation par instance et
   * par frame (chemin chaud, jusqu'a des dizaines de creeps a la fois).
   */
  setPose(index: number, worldMatrix: THREE.Matrix4, frameTable: readonly THREE.Matrix4[][], frameIndex: number): void {
    for (let b = 0; b < this.meshes.length; b++) {
      const local = frameTable[b]![frameIndex] ?? frameTable[b]![0]!;
      this.tmpMatrix.multiplyMatrices(worldMatrix, local);
      this.meshes[b]!.setMatrixAt(index, this.tmpMatrix);
      this.meshes[b]!.instanceMatrix.needsUpdate = true;
    }
  }

  /** Libere toutes les instances — utilise au redemarrage d'une partie. */
  clear(): void {
    for (const eid of [...this.byEid.keys()]) this.free(eid);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
/** Sous ce seuil (unites de scene), un ecart de position n'est que du bruit
 * numerique — pas un vrai deplacement, on ne recalcule pas le cap dessus. */
const HEADING_MIN_DISTANCE = 0.001;

interface InstanceAnim {
  index: number;
  /** Distance cumulee parcourue (unites de scene) depuis l'apparition — la
   * progression dans le cycle de marche en depend directement, jamais du
   * temps ecoule : un creep ralenti par la glace marche au ralenti, il ne
   * "patine" pas sur place. */
  walkDistance: number;
  /** Decalage de phase propre a ce creep (derive de son eid) : deux
   * instances cote a cote ne sont jamais synchrones. */
  phaseOffset: number;
  /** Cap actuel (rotation Y, radians) — recalcule uniquement sur un vrai
   * deplacement (voir HEADING_MIN_DISTANCE), conserve sinon. */
  headingAngle: number;
  hasPrevPosition: boolean;
  prevSx: number;
  prevSz: number;
  dying: boolean;
  /** Secondes ecoulees depuis le debut de l'animation de mort. */
  deathElapsed: number;
}

/**
 * Anime les instances d'un modele dans une arene par-dessus
 * AnimatedInstancedGroup : suit la distance parcourue de chacune
 * (progression du cycle de marche), joue Death une fois a la mort avant de
 * liberer l'instance, et pose chaque frame en indexant dans les tables
 * pre-echantillonnees de animatedCreepModel.ts — jamais d'AnimationMixer ni
 * d'evaluation de courbe par instance.
 */
export class AnimatedCreepController {
  private group: AnimatedInstancedGroup;
  private anims = new Map<number, InstanceAnim>();
  private tmpPosition = new THREE.Vector3();
  private tmpQuaternion = new THREE.Quaternion();
  private tmpScale = new THREE.Vector3();
  private tmpWorldMatrix = new THREE.Matrix4();
  /** Distance (unites de scene) d'un cycle de marche complet — calibree par
   * l'appelant (voir entities3d.ts, setCycleDistance) : depend de la
   * vitesse du creep et de l'echelle monde->scene, hors du ressort de ce
   * module. 1 par defaut (evite une division par zero avant calibration). */
  private cycleDistance = 1;

  constructor(private model: AnimatedCreepModel) {
    this.group = new AnimatedInstancedGroup(model);
  }

  get sceneGroup(): THREE.Group {
    return this.group.group;
  }

  /** Nombre d'instances actuellement animees (marche OU mort) — utilise par
   * l'instrumentation perf (perf=1), pas par le rendu lui-meme. */
  get activeCount(): number {
    return this.anims.size;
  }

  setCycleDistance(distance: number): void {
    if (distance > 0) this.cycleDistance = distance;
  }

  private phaseOffsetFor(eid: number): number {
    // Repartition deterministe sur [0,1) via le nombre d'or : evite les
    // paquets synchronises pour des eid consecutifs (contrairement a un
    // simple modulo), sans dependre de Math.random().
    const x = eid * 0.6180339887498949;
    return x - Math.floor(x);
  }

  /** A appeler pour chaque creep vivant de ce modele, une fois par frame de
   * rendu. `sx`/`sz` : position au sol en unites de scene (voir worldToScene). */
  updateAlive(eid: number, sx: number, sz: number): void {
    let anim = this.anims.get(eid);
    if (!anim) {
      const index = this.group.allocate(eid);
      if (index === null) return; // capacite epuisee (cas limite, voir AnimatedInstancedGroup)
      anim = {
        index,
        walkDistance: 0,
        phaseOffset: this.phaseOffsetFor(eid),
        headingAngle: 0,
        hasPrevPosition: false,
        prevSx: sx,
        prevSz: sz,
        dying: false,
        deathElapsed: 0,
      };
      this.anims.set(eid, anim);
    }

    if (anim.hasPrevPosition) {
      const dx = sx - anim.prevSx;
      const dz = sz - anim.prevSz;
      const dist = Math.hypot(dx, dz);
      if (dist > HEADING_MIN_DISTANCE) {
        // +PI : les modeles livres jusqu'ici font face a -Z au repos (verifie
        // a l'usage sur le Trainard — pas +Z comme suppose au premier jet),
        // sans quoi le creep marchait dos a sa direction de deplacement.
        anim.headingAngle = Math.atan2(dx, dz) + Math.PI;
        anim.walkDistance += dist;
      }
    }
    anim.hasPrevPosition = true;
    anim.prevSx = sx;
    anim.prevSz = sz;

    const walkFrames = this.model.walkFrames;
    const stepCount = walkFrames[0]?.length ?? 1;
    const rawPhase = anim.walkDistance / this.cycleDistance + anim.phaseOffset;
    const phase = ((rawPhase % 1) + 1) % 1;
    const frame = Math.min(stepCount - 1, Math.floor(phase * stepCount));

    this.writePose(anim, sx, sz, walkFrames, frame);
  }

  /** A appeler quand un creep de ce modele vient de disparaitre de la
   * simulation : conserve son instance pour jouer Death une fois plutot que
   * de la liberer immediatement (la suppression sim, elle, reste immediate
   * — voir entities3d.ts). Sans effet si ce creep n'a jamais eu d'instance
   * (repli sphere actif au moment de son apparition) ou est deja en train
   * de mourir. */
  markDying(eid: number): void {
    const anim = this.anims.get(eid);
    if (!anim || anim.dying) return;
    anim.dying = true;
    anim.deathElapsed = 0;
  }

  /** A appeler une fois par frame : avance toutes les depouilles en cours de
   * Death, les libere une fois le clip termine. */
  advanceDying(dt: number): void {
    const deathFrames = this.model.deathFrames;
    const stepCount = deathFrames[0]?.length ?? 1;
    const duration = this.model.deathClipDuration;
    for (const [eid, anim] of this.anims) {
      if (!anim.dying) continue;
      anim.deathElapsed += dt;
      const t = Math.min(1, duration > 0 ? anim.deathElapsed / duration : 1);
      const frame = Math.min(stepCount - 1, Math.floor(t * stepCount));
      this.writePose(anim, anim.prevSx, anim.prevSz, deathFrames, frame);
      if (anim.deathElapsed >= duration) {
        this.group.free(eid);
        this.anims.delete(eid);
      }
    }
  }

  private writePose(anim: InstanceAnim, sx: number, sz: number, frameTable: readonly THREE.Matrix4[][], frameIndex: number): void {
    this.tmpPosition.set(sx, this.model.groundOffsetY, sz);
    this.tmpQuaternion.setFromAxisAngle(UP, anim.headingAngle);
    this.tmpScale.setScalar(this.model.scale);
    this.tmpWorldMatrix.compose(this.tmpPosition, this.tmpQuaternion, this.tmpScale);
    this.group.setPose(anim.index, this.tmpWorldMatrix, frameTable, frameIndex);
  }

  /** Reinitialise tout — utilise au redemarrage d'une partie. */
  clear(): void {
    this.group.clear();
    this.anims.clear();
  }
}
