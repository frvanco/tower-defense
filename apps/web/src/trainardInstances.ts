import * as THREE from 'three';
import type { TrainardModel } from './trainardModel.js';

/** Capacite fixe par arene, partagee par tous les Trainards qui y sont
 * presents — voir le brief : "capacite fixe raisonnable". Un debordement
 * (plus de 256 Trainards vivants simultanement dans une arene) est un cas
 * limite jamais rencontre en pratique (tailles de vague reelles tres en
 * dessous) ; allocate() retourne alors null et l'appelant ignore la pose
 * pour ce cycle plutot que de planter. */
const TRAINARD_INSTANCE_CAPACITY = 256;

const ZERO_SCALE = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Un `InstancedMesh` par noeud anime du modele (voir trainardModel.ts),
 * partage par tous les Trainards d'UNE arene — une douzaine de draw calls
 * pour l'arene entiere, quel que soit le nombre de Trainards vivants,
 * plutot qu'un clone complet (30 meshes) par creep.
 */
export class TrainardInstancedGroup {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[];
  private freeIndices: number[] = [];
  private byEid = new Map<number, number>();
  private tmpMatrix = new THREE.Matrix4();

  constructor(private model: TrainardModel) {
    this.group.name = 'trainards';
    this.meshes = model.geometries.map((geo) => {
      const mesh = new THREE.InstancedMesh(geo, model.material, TRAINARD_INSTANCE_CAPACITY);
      // Les instances vivent tant que le creep existe, pas seulement pendant
      // les rares upgrades — DynamicDrawUsage est le bon choix (buffer
      // recree/reecrit chaque frame, pas un one-shot StaticDrawUsage).
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      // `count` demarre a 0 : le GPU ne doit traiter QUE les instances
      // reellement utilisees, pas les 256 de la capacite (une matrice a
      // echelle nulle masque visuellement une instance inutilisee, mais le
      // GPU continue de la traiter tant qu'elle est comprise dans `count` —
      // sans cette borne, 256 instances "vides" coutent quasiment autant que
      // 256 pleines). Mis a jour par updateCount() a chaque allocate/free.
      mesh.count = 0;
      for (let i = 0; i < TRAINARD_INSTANCE_CAPACITY; i++) mesh.setMatrixAt(i, ZERO_SCALE);
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
      return mesh;
    });
    for (let i = TRAINARD_INSTANCE_CAPACITY - 1; i >= 0; i--) this.freeIndices.push(i);
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
   * `count` (voir updateCount) redescende reellement quand des Trainards a
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
   * (position au sol, cap, echelle) ; `bucketMatrices` donne, pour chaque
   * noeud anime (meme ordre que model.nodeNames), sa matrice locale au pas
   * d'animation courant (pose de repos tant qu'aucune table d'animation
   * n'est cablee par l'appelant).
   */
  setPose(index: number, worldMatrix: THREE.Matrix4, bucketMatrices: readonly THREE.Matrix4[]): void {
    for (let b = 0; b < this.meshes.length; b++) {
      this.tmpMatrix.multiplyMatrices(worldMatrix, bucketMatrices[b]!);
      this.meshes[b]!.setMatrixAt(index, this.tmpMatrix);
      this.meshes[b]!.instanceMatrix.needsUpdate = true;
    }
  }

  /** Libere toutes les instances — utilise au redemarrage d'une partie. */
  clear(): void {
    for (const eid of [...this.byEid.keys()]) this.free(eid);
  }
}
