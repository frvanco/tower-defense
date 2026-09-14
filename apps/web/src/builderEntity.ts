import * as THREE from 'three';
import type { Arena, BuilderMode } from '@tower-defense/sim';
import { worldToScene, type Frame3D } from './world3d.js';
import { PLATFORM_HEIGHT } from './terrain3d.js';
import { loadBuilderModel, tintTeam, type BuilderModel } from './builderModel.js';

/**
 * L'ouvrier a l'ecran. UN SEUL objet pour toute la partie : on n'observe
 * jamais qu'une arene a la fois, donc changer d'arene ne cree pas un second
 * builder — on repositionne et on reteint celui-ci (voir setPlayer).
 *
 * Cette classe ne decide de RIEN : position, cap et mode viennent de la
 * simulation (arena.builder), y compris pour l'arene d'un adversaire observe.
 * Elle choisit le clip correspondant et interpole ce qui est purement visuel
 * (l'altitude de vol, que la simulation ne modelise pas).
 */

/** Hauteur de survol du couloir, unites de scene. Purement visuel : la
 * simulation ne connait que deux vitesses, pas d'altitude. */
const FLY_HEIGHT = 1.6;
/** Vitesse de montee/descente, en fraction d'ecart rattrapee par seconde. */
const ALTITUDE_LERP = 6;
/** Duree des fondus entre clips. */
const FADE = 0.18;

/** Clips joues UNE seule fois, qui rendent ensuite la main. Les autres
 * bouclent. Le fichier en compte 8 : Idle, Walk, Build, Call, Command,
 * Takeoff, Fly, Land. */
const ONCE = new Set(['Takeoff', 'Land', 'Call', 'Command']);

/**
 * Etape de la sequence de vol. Elle ne peut pas se deduire du seul mode de
 * simulation : `flying` couvre a la fois le decollage, le survol et
 * l'atterrissage, qui sont trois clips distincts a enchainer dans l'ordre.
 */
type FlightPhase = 'ground' | 'takeoff' | 'fly' | 'land';

export class BuilderEntity {
  readonly group = new THREE.Group();

  private model: BuilderModel | null = null;
  private instance: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: string | null = null;
  /** Action en train de disparaitre, et ce qu'il reste de son fondu. Une fois
   * a zero elle est ARRETEE : une action a poids nul continue sinon d'evaluer
   * ses 111 pistes a chaque frame, et elles s'accumulent a chaque transition. */
  private fading: { action: THREE.AnimationAction; left: number } | null = null;
  private phase: FlightPhase = 'ground';
  /** Clip ponctuel demande par l'interface (Call/Command). */
  private transient: string | null = null;
  private altitude = 0;
  private color = new THREE.Color(0xffffff);
  private disposed = false;

  constructor() {
    this.group.visible = false;
    void loadBuilderModel().then((model) => {
      if (!model || this.disposed) return;
      this.model = model;
      // `clone(true)` suffit : ce modele n'a aucun skin (SkeletonUtils serait
      // necessaire sinon).
      const instance = model.scene.clone(true);
      instance.scale.setScalar(model.scale);
      this.instance = instance;
      this.group.add(instance);

      this.mixer = new THREE.AnimationMixer(instance);
      for (const [name, clip] of model.clips) {
        const action = this.mixer.clipAction(clip);
        if (ONCE.has(name)) {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        }
        this.actions.set(name, action);
      }
      this.mixer.addEventListener('finished', (e) => {
        const done = (e as unknown as { action: THREE.AnimationAction }).action;
        const name = [...this.actions].find(([, a]) => a === done)?.[0];
        if (!name) return;
        // Decollage termine -> survol ; atterrissage termine -> de nouveau au
        // sol, ou le mode de simulation reprend la main.
        if (name === 'Takeoff' && this.phase === 'takeoff') this.phase = 'fly';
        else if (name === 'Land' && this.phase === 'land') this.phase = 'ground';
        else if (name === this.transient) this.transient = null;
      });

      tintTeam(instance, this.color);
    });
  }

  /** Couleur du joueur observe. Appelee au changement d'arene : le meme objet
   * change de camp au lieu qu'un second soit cree. */
  setPlayer(color: THREE.Color): void {
    this.color.copy(color);
    if (this.instance) tintTeam(this.instance, this.color);
    // On saute d'une arene a l'autre : aucune trajectoire continue a lisser.
    this.altitude = 0;
    this.phase = 'ground';
    this.transient = null;
  }

  /** Ouverture du panneau d'envoi de creeps : deploie la station radio. */
  signalSendPanel(): void {
    this.trigger('Call');
  }

  /** Ouverture du panneau d'abilites : deploie les ecrans holographiques. */
  signalAbilityPanel(): void {
    this.trigger('Command');
  }

  private trigger(clip: string): void {
    // Uniquement s'il est disponible : une construction ou un deplacement en
    // cours n'est jamais interrompu par une consultation de panneau.
    if (!this.actions.has(clip) || this.phase !== 'ground' || this.busy) return;
    this.transient = clip;
    this.play(clip, true);
  }

  /** Vrai des que la simulation lui fait faire quelque chose. */
  private busy = false;

  private play(name: string, restart = false): void {
    const next = this.actions.get(name);
    if (!next || (this.current === name && !restart)) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    if (restart) next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next) {
      prev.crossFadeTo(next, FADE, false);
      // L'ancienne action precedente n'a pas fini son fondu : elle n'aura
      // jamais de poids visible, on l'arrete tout de suite.
      this.fading?.action.stop();
      this.fading = { action: prev, left: FADE };
    }
    this.current = name;
  }

  /** Clip correspondant a l'etat de simulation, hors vol et hors ponctuel. */
  private static groundClip(mode: BuilderMode): string {
    switch (mode) {
      case 'building':
        return 'Build';
      case 'moving':
        return 'Walk';
      default:
        return 'Idle';
    }
  }

  /**
   * Un frame. `arena` est celle REGARDEE — son builder peut donc etre celui
   * d'un adversaire, auquel cas sa position vient de la replication, jamais
   * d'une reconstruction locale.
   */
  sync(arena: Arena, frame: Frame3D, dt: number): void {
    if (!this.instance) return;
    const b = arena.builder;
    this.group.visible = true;
    this.busy = b.mode !== 'idle';

    const [sx, sz] = worldToScene(frame, b.x, b.y);
    const flying = b.mode === 'flying';
    this.altitude += ((flying ? FLY_HEIGHT : 0) - this.altitude) * Math.min(1, ALTITUDE_LERP * dt);
    this.group.position.set(sx, PLATFORM_HEIGHT + this.model!.footOffset + this.altitude, sz);

    // Le modele regarde +Z (extras.forward). Une rotation de PI/2 - cap amene
    // ce +Z sur la direction voulue du plan XZ, ou worldToScene envoie le X
    // monde sur X et le Y monde sur Z.
    this.group.rotation.y = Math.PI / 2 - b.facing;

    // --- Sequence de vol : Takeoff (une fois) -> Fly (boucle) -> Land (une
    // fois). Le mode de simulation dit seulement "au-dessus du couloir ou
    // non" ; l'enchainement des trois clips se tient ici.
    if (flying && (this.phase === 'ground' || this.phase === 'land')) {
      this.phase = 'takeoff';
      this.transient = null;
      this.play('Takeoff', true);
    } else if (!flying && (this.phase === 'takeoff' || this.phase === 'fly')) {
      this.phase = 'land';
      this.play('Land', true);
    }

    if (this.phase === 'fly') this.play('Fly');
    else if (this.phase === 'ground') {
      // Un clip ponctuel ne survit pas a une action reelle : construire ou se
      // deplacer reprend la main immediatement.
      if (this.transient && this.busy) this.transient = null;
      this.play(this.transient ?? BuilderEntity.groundClip(b.mode));
    }

    if (this.fading) {
      this.fading.left -= dt;
      if (this.fading.left <= 0) {
        this.fading.action.stop();
        this.fading = null;
      }
    }

    this.mixer?.update(dt);
  }

  dispose(): void {
    this.disposed = true;
    this.mixer?.stopAllAction();
    this.instance?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Geometries et materiaux viennent du clone : le modele SOURCE reste en
      // cache pour une partie suivante, on ne dispose que ce qui est a nous.
      const m = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(m)) for (const one of m) one.dispose();
      else m?.dispose();
    });
    this.group.clear();
    this.instance = null;
    this.mixer = null;
    this.actions.clear();
    this.fading = null;
  }
}
