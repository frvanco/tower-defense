import * as THREE from 'three';
import { secToTicks, type Arena } from '@tower-defense/sim';
import { rules } from '@tower-defense/data';
import { startBuild, updateBuild } from '@tower-defense/renderer';
import { worldToScene, type Frame3D } from './world3d.js';
import { PLATFORM_HEIGHT } from './terrain3d.js';
import { makeTowerMesh, disposeTowerGroup } from './entities3d.js';

/**
 * Apercus des constructions planifiees : une tour translucide sur chaque
 * emplacement de la file, tant que l'ouvrier n'a pas commence a la batir.
 *
 * C'est la seule chose qui donne a lire la file dans la scene — sans elle, un
 * clic ne produit rien de visible pendant plusieurs secondes et le joueur ne
 * sait ni ou ni quoi il a commande. Le compteur de la barre de commandes dit
 * COMBIEN, ceci dit OU et QUOI.
 *
 * Quand l'ouvrier commence a batir, l'apercu ne disparait PAS : il devient le
 * chantier. Il reprend ses couleurs pleines et joue l'animation de
 * construction (echafaudage, croissance, poussiere) pendant exactement la
 * duree du marteau. Sans ca le marteau frappait dans le vide et la tour
 * surgissait d'un coup a la fin — c'est l'incoherence que ceci corrige.
 *
 * La distinction n'est pas "sa propre arene ou non" mais PLANIFIE ou EN COURS :
 * - un ordre planifie revele une intention, il n'est montre que sur sa propre
 *   arene (voir `showPlanned`) ;
 * - un chantier en cours n'est plus un secret, et le cacher chez l'adversaire
 *   laisserait son ouvrier marteler le vide. Il est donc toujours affiche.
 */

/** Opacite des apercus. Assez visible pour lire la silhouette et la couleur de
 * branche, assez fantomatique pour ne jamais passer pour une tour reelle. */
const PREVIEW_OPACITY = 0.38;

/** Sous-objets du mesh de tour qui n'ont aucun sens sur un apercu : anneau de
 * portee, progression de chantier, echafaudage. Ils sont deja invisibles a la
 * creation, mais les masquer explicitement evite qu'un changement de leur
 * valeur par defaut ne fasse apparaitre des artefacts ici. */
const HIDDEN_PARTS = ['rangeRing', 'progress', 'scaffold'];

interface Preview {
  defId: string;
  group: THREE.Group;
  /** Passe a true quand le chantier a demarre : couleurs pleines et animation
   * de construction en cours. Ne revient jamais en arriere — un ordre en cours
   * n'est plus annulable. */
  building: boolean;
  /** Materiaux CLONES pour cet apercu : ceux des tours sont partages entre
   * toutes les instances (voir registerSharedTowerMaterial), les rendre
   * transparents sur place vandaliserait les vraies tours. Gardes en liste
   * pour repasser en opaque au demarrage du chantier ; leur liberation, elle,
   * est deleguee a disposeTowerGroup. */
  materials: THREE.Material[];
}

export class BuildPreviews {
  readonly group = new THREE.Group();
  private bySlot = new Map<string, Preview>();

  constructor(private teamColor: number) {}

  /** Couleur du joueur dont on regarde l'arene. Tout est reconstruit : un
   * apercu ne vit que quelques secondes et il n'y en a jamais plus de cinq. */
  setTeamColor(color: number): void {
    if (color === this.teamColor) return;
    this.teamColor = color;
    this.clear();
  }

  private makePreview(defId: string): Preview {
    const group = makeTowerMesh(defId, this.teamColor);
    for (const name of HIDDEN_PARTS) {
      const part = group.getObjectByName(name);
      if (part) part.visible = false;
    }
    const materials: THREE.Material[] = [];
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material;
      const clone = (Array.isArray(src) ? src[0]! : src).clone();
      clone.transparent = true;
      clone.opacity = PREVIEW_OPACITY;
      // Sans ca, chaque partie de la tour ecrit dans le depth buffer et
      // decoupe celles situees derriere elle : l'apercu se troue lui-meme.
      clone.depthWrite = false;
      mesh.material = clone;
      mesh.castShadow = false;
      materials.push(clone);
    });
    return { defId, group, materials, building: false };
  }

  private drop(slotId: string): void {
    const p = this.bySlot.get(slotId);
    if (!p) return;
    this.group.remove(p.group);
    // Delegue a la meme fonction que la vente d'une tour : elle sait quelles
    // geometries et quels materiaux sont PARTAGES avec le modele en cache et
    // ne doivent jamais etre disposes. Couvre aussi les particules de
    // poussiere qu'un chantier interrompu aurait laissees.
    disposeTowerGroup(p.group);
    this.bySlot.delete(slotId);
  }

  /** Fait passer un apercu translucide en chantier reel : couleurs pleines,
   * ombre portee, et animation de construction calee sur la duree du marteau
   * (rules.builderBuildSec) — la meme que celle que compte la simulation. */
  private startConstruction(p: Preview): void {
    for (const m of p.materials) {
      m.transparent = false;
      m.opacity = 1;
      m.depthWrite = true;
    }
    p.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = true;
    });
    // startBuild rallume lui-meme l'echafaudage et l'anneau de progression.
    // Surtout, on ne touche PAS a `rangeRing` : l'anneau de portee ne doit
    // apparaitre qu'a la selection de la tour, jamais pendant le chantier.
    startBuild(p.group, rules.builderBuildSec);
    p.building = true;
  }

  /**
   * A appeler apres tick(), pour l'arene du joueur. Chaque ordre de la file a
   * son apercu ; celui que l'ouvrier est en train de batir (queue[0] en mode
   * 'building') devient le chantier anime.
   *
   * `dt` est le delta d'animation deja multiplie par la vitesse de simulation
   * (voir animDt dans main.ts) : le chantier avance donc exactement au meme
   * rythme que le decompte de la simulation, y compris en x2 ou x4.
   */
  sync(arena: Arena, frame: Frame3D, dt: number, showPlanned: boolean): void {
    const b = arena.builder;
    const building = b.mode === 'building';

    const alive = new Set<string>();
    for (let i = 0; i < b.queue.length; i++) {
      // Chez un adversaire, seul le chantier en cours est montre : les ordres
      // suivants sont ses intentions, elles ne regardent que lui.
      if (!showPlanned && !(i === 0 && building)) break;
      const order = b.queue[i]!;
      alive.add(order.slotId);
      let preview = this.bySlot.get(order.slotId);
      // Meme emplacement mais autre tour (annulation puis reconstruction) :
      // on refait l'apercu.
      if (preview && preview.defId !== order.defId) {
        this.drop(order.slotId);
        preview = undefined;
      }
      if (!preview) {
        preview = this.makePreview(order.defId);
        const [sx, sz] = worldToScene(frame, order.x, order.y);
        preview.group.position.set(sx, PLATFORM_HEIGHT, sz);
        this.group.add(preview.group);
        this.bySlot.set(order.slotId, preview);
      }
      // Seul le PREMIER ordre peut etre en chantier : c'est celui sur lequel
      // l'ouvrier est arrete.
      if (i === 0 && building && !preview.building) this.startConstruction(preview);
      if (preview.building) {
        // Avancement lu sur la SIMULATION plutot qu'accumule image par image :
        // arriver en cours de chantier (changement d'arene, tour observee) le
        // reprend a son avancement reel au lieu de le rejouer depuis zero.
        const total = secToTicks(rules.builderBuildSec);
        const state = preview.group.userData.build as { t: number } | null | undefined;
        if (state && total > 0) state.t = 1 - b.buildTicksLeft / total;
        updateBuild(preview.group, dt);
      }
    }

    if (this.bySlot.size === alive.size) return;
    for (const slotId of [...this.bySlot.keys()]) {
      if (!alive.has(slotId)) this.drop(slotId);
    }
  }

  clear(): void {
    for (const slotId of [...this.bySlot.keys()]) this.drop(slotId);
  }

  dispose(): void {
    this.clear();
    this.group.clear();
  }
}
