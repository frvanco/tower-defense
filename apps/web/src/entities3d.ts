import * as THREE from 'three';
import type { Arena, Tower, Creep } from '@tower-defense/sim';
import { totalSlowPct } from '@tower-defense/sim';
import { buildableTowers, towers as towerDefs, creeps as creepDefs, type TowerDef, type CreepDef } from '@tower-defense/data';
import {
  makeCannonTower,
  makePlaceholderTower,
  hasDedicatedGeometry,
  startBuild,
  updateBuild,
  aimTurret,
  DEFAULT_BUILD_DURATION_SEC,
} from '@tower-defense/renderer';
import { branchInfo, branchHue } from './branches.js';
import { ARMOR_COLORS } from './colors.js';
import { worldToScene, type Frame3D } from './world3d.js';
import { PLATFORM_HEIGHT } from './terrain3d.js';
import {
  ICE_TINT_COLOR,
  ICE_TINT_MAX_PCT,
  ICE_TINT_MAX_MIX,
  BOB_BASE_HZ,
  NOMINAL_MOVE_SPEED,
  BOB_AMPLITUDE_RATIO,
  FROST_SHARD_SLOW_THRESHOLD,
  FROST_SHARD_COLOR,
} from './iceEffects.js';
import { PoisonBubbles, POISON_EMISSIVE_COLOR, POISON_PULSE_HZ, POISON_PULSE_MIN } from './poisonEffects.js';
import { loadAnimatedCreepModel, getAnimatedCreepModel, type AnimatedCreepModel } from './animatedCreepModel.js';
import { AnimatedCreepController } from './animatedCreepInstances.js';

/** Meme vitesse de rotation que la galerie de demo validee (packages/renderer/demo). */
const TURN_RATE = 2.6;

// ---------------------------------------------------------------------------
// Tours
// ---------------------------------------------------------------------------

interface TrackedTower {
  defId: string;
  group: THREE.Group;
}

export class TowerEntities {
  private byEid = new Map<number, TrackedTower>();

  constructor(
    private layer: THREE.Group,
    private frame: Frame3D,
    private teamColor: number,
  ) {}

  private makeMesh(defId: string, eid: number): THREE.Group {
    const { branch, tier } = branchInfo(defId);
    const root = buildableTowers[branch]!;
    const group = hasDedicatedGeometry(root)
      ? makeCannonTower(tier, this.teamColor)
      : makePlaceholderTower(root, tier, branchHue(defId), this.teamColor);
    group.userData.eid = eid;
    return group;
  }

  private place(group: THREE.Group, t: Tower): void {
    const [sx, sz] = worldToScene(this.frame, t.x, t.y);
    // Les tours se posent sur le plateau surelevé (voir terrain3d.ts) ; le
    // chemin, lui, reste au niveau bas.
    group.position.set(sx, PLATFORM_HEIGHT, sz);
  }

  /** A appeler apres tick() : cree/upgrade/retire les meshes pour coller a `arena.towers`. */
  sync(arena: Arena): void {
    const seen = new Set<number>();
    for (const t of arena.towers) {
      seen.add(t.eid);
      const tracked = this.byEid.get(t.eid);
      if (!tracked) {
        const group = this.makeMesh(t.defId, t.eid);
        this.place(group, t);
        this.layer.add(group);
        startBuild(group, DEFAULT_BUILD_DURATION_SEC);
        this.byEid.set(t.eid, { defId: t.defId, group });
        continue;
      }
      if (tracked.defId !== t.defId) {
        // Upgrade : `makeCannonTower`/`makePlaceholderTower` decrivent un
        // palier fixe, pas une geometrie qui grandit — on rebâtit un nouveau
        // Group au nouveau palier et on rejoue le MEME systeme de
        // construction que pour la pose initiale (c'est explicitement le but
        // de build.ts : un seul systeme pour le build ET les upgrades).
        this.layer.remove(tracked.group);
        const group = this.makeMesh(t.defId, t.eid);
        this.place(group, t);
        this.layer.add(group);
        startBuild(group, DEFAULT_BUILD_DURATION_SEC);
        tracked.defId = t.defId;
        tracked.group = group;
      }
    }
    for (const [eid, tracked] of this.byEid) {
      if (!seen.has(eid)) {
        this.layer.remove(tracked.group);
        this.byEid.delete(eid);
      }
    }
  }

  /** A appeler chaque frame : anime la construction et vise les cibles a portee. */
  update(arena: Arena, dt: number, selectedEid: number | null, hoveredEid: number | null): void {
    for (const t of arena.towers) {
      const tracked = this.byEid.get(t.eid);
      if (!tracked) continue;
      updateBuild(tracked.group, dt);
      const building = !!tracked.group.userData.build;

      if (!building) {
        const def = towerDefs.get(t.defId);
        const target = def ? pickVisualTarget(t, def, arena) : null;
        if (target) {
          const [tx, tz] = worldToScene(this.frame, target.x, target.y);
          aimTurret(tracked.group.userData.turret as THREE.Object3D, new THREE.Vector3(tx, 0, tz), TURN_RATE, dt);
        }
      }

      const isSelected = t.eid === selectedEid;
      const isHovered = t.eid === hoveredEid;
      const footprint = tracked.group.getObjectByName('footprint');
      if (footprint) footprint.visible = isSelected;
      const rangeRing = tracked.group.getObjectByName('rangeRing');
      if (rangeRing) rangeRing.visible = (isSelected || isHovered) && !building;
    }
  }

  groupFor(eid: number): THREE.Group | undefined {
    return this.byEid.get(eid)?.group;
  }

  /** Vide tout — utilise au redemarrage d'une partie (les eid repartent de 1,
   * il ne faut pas laisser d'anciens meshes trainer sous des eid reutilises). */
  clear(): void {
    for (const { group } of this.byEid.values()) this.layer.remove(group);
    this.byEid.clear();
  }
}

/**
 * Cible visuelle pour l'aiming des tourelles — approximation deliberement
 * simple de fireTowers() (packages/sim/src/sim.ts) : meme regle air/sol et
 * meme portee, priorite au creep le plus avance sur son chemin. L'autorite
 * sur les degats reste entierement dans packages/sim ; ceci ne decide QUE ou
 * pointer une tourelle a l'ecran.
 */
function pickVisualTarget(tower: Tower, def: TowerDef, arena: Arena): Creep | null {
  const range2 = def.range * def.range;
  let best: Creep | null = null;
  let bestScore = -Infinity;
  for (const c of arena.creeps) {
    const cd = creepDefs.get(c.defId);
    if (!cd) continue;
    if (cd.isAir && !def.targets.includes('air')) continue;
    if (!cd.isAir && !def.targets.includes('ground')) continue;
    const dx = c.x - tower.x;
    const dy = c.y - tower.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > range2) continue;
    const score = c.wp * 100000 - Math.sqrt(d2);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Creeps
// ---------------------------------------------------------------------------

/**
 * Skins 3D reels (modele + animations) plutot que la sphere generique, pour
 * les creeps qui en ont un — cle : id du creep (@tower-defense/data). Chargement
 * + pretraitement (echelle, fusion par noeud anime, materiau partage) geres
 * par animatedCreepModel.ts ; rendu/anim instancies par arene geres par
 * animatedCreepInstances.ts. Declenche une seule fois ici, par modele ;
 * tant qu'un modele n'est pas pret, spawn() retombe sur la sphere/cone
 * habituelle pour ce creep (aucun blocage). Hauteur cible commune (1.8) :
 * les deux sont des unites humaines de gabarit comparable.
 */
const HUMANOID_CREEP_HEIGHT = 1.8;
const HUMANOID_MODEL_URLS: Record<string, string> = {
  n000: '/models/trainard-lv1.glb', // Trainard
  h001: '/models/conscrit_lv2.glb', // Conscrit
  h009: '/models/sapeur_lv3.glb', // Sapeur
};
for (const url of Object.values(HUMANOID_MODEL_URLS)) void loadAnimatedCreepModel(url, HUMANOID_CREEP_HEIGHT);

function creepRadius(def: CreepDef): number {
  return Math.max(0.05, Math.min(0.22, 0.05 + Math.log10(Math.max(1, def.hitPoints)) * 0.045));
}

function creepHeight(def: CreepDef): number {
  return def.isAir ? 1.1 : creepRadius(def);
}

function makeHpBar(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 8;
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, sizeAttenuation: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.7, 0.09, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function paintHpBar(sprite: THREE.Sprite, frac: number): void {
  const material = sprite.material as THREE.SpriteMaterial;
  const texture = material.map as THREE.CanvasTexture;
  const canvas = texture.image as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = frac > 0.5 ? '#4fd67a' : frac > 0.25 ? '#ffb84d' : '#ff5c5c';
  ctx.fillRect(1, 1, (canvas.width - 2) * Math.max(0, frac), canvas.height - 2);
  texture.needsUpdate = true;
}

/** Trois petits eclats coniques autour du corps, masques par defaut — bascules
 * visibles quand le ralentissement total approche du plafond (voir sync()). */
function buildFrostShards(r: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'frost';
  const mat = new THREE.MeshBasicMaterial({ color: FROST_SHARD_COLOR });
  for (let i = 0; i < 3; i++) {
    const shard = new THREE.Mesh(new THREE.ConeGeometry(r * 0.22, r * 0.6, 4), mat);
    const angle = (i / 3) * Math.PI * 2;
    shard.position.set(Math.cos(angle) * r * 0.7, r * 0.2, Math.sin(angle) * r * 0.7);
    shard.rotation.z = angle;
    g.add(shard);
  }
  return g;
}

interface TrackedCreepBase {
  ring: THREE.Mesh;
  bar: THREE.Sprite;
}

/** Sphere/cone generique — tous les creeps sans skin dedie (et un creep avec
 * skin dedie tant que son modele n'est pas encore charge, voir spawn()). */
interface TrackedCreepSphere extends TrackedCreepBase {
  kind: 'sphere';
  body: THREE.Mesh;
  baseColor: THREE.Color;
  frost: THREE.Group;
  /** Phase du bob de marche (radians) — avance a une vitesse proportionnelle
   * a la vitesse reelle du creep (moveSpeed ET ralentissement gel/poison actif),
   * donc suit tout changement de l'une ou l'autre. */
  phase: number;
}

/** Creep rendu par instance partagee (voir animatedCreepInstances.ts) — pas
 * de body individuel ici, juste l'anneau/la barre de vie propres a ce creep.
 * `modelUrl` selectionne le bon AnimatedCreepController parmi ceux geres par
 * CreepEntities (un par modele charge). */
interface TrackedCreepHumanoid extends TrackedCreepBase {
  kind: 'humanoid';
  modelUrl: string;
}

type TrackedCreep = TrackedCreepSphere | TrackedCreepHumanoid;

export class CreepEntities {
  private byEid = new Map<number, TrackedCreep>();
  private poisonBubbles = new PoisonBubbles();
  private clock = 0;
  private tmpColor = new THREE.Color();
  /** Un AnimatedCreepController par modele (url), cree au premier creep de ce
   * type rencontre une fois son modele charge — pas par id de creep : si un
   * jour deux creeps differents partagent le meme fichier, ils partagent
   * aussi son rendu instancie. */
  private animControllers = new Map<string, AnimatedCreepController>();

  constructor(
    private layer: THREE.Group,
    private frame: Frame3D,
    private laneColorByPlayer: Map<number, string>,
  ) {
    this.layer.add(this.poisonBubbles.mesh);
  }

  /** Cree le rendu/animation instancies de ce modele des qu'il est charge
   * (asynchrone, voir animatedCreepModel.ts) — au plus une fois par arene et
   * par modele. `creepId` sert uniquement a retrouver la vitesse nominale du
   * creep pour calibrer le cycle de marche (voir plus bas). */
  private ensureAnimController(url: string, creepId: string): AnimatedCreepController | null {
    const existing = this.animControllers.get(url);
    if (existing) return existing;
    const model = getAnimatedCreepModel(url);
    if (!model) return null;
    const controller = new AnimatedCreepController(model);
    this.animControllers.set(url, controller);
    this.layer.add(controller.sceneGroup);

    // Distance d'un cycle de marche complet = ce que ce creep parcourt, a sa
    // propre vitesse nominale, pendant la duree reelle du clip Walk —
    // calibration derivee des donnees plutot qu'une valeur choisie a l'oeil
    // (voir aussi la verification visuelle du glissement des pieds).
    const def = creepDefs.get(creepId);
    if (def) controller.setCycleDistance(def.moveSpeed * this.frame.scale * model.walkClipDuration);
    return controller;
  }

  private makeRing(sender: number, r: number): THREE.Mesh {
    const ringColor = this.laneColorByPlayer.get(sender) ?? '#888888';
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.95, r * 1.25, 16),
      new THREE.MeshBasicMaterial({ color: ringColor, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    this.layer.add(ring);
    return ring;
  }

  private spawn(c: Creep, def: CreepDef): TrackedCreep {
    const modelUrl = HUMANOID_MODEL_URLS[def.id];
    if (modelUrl && this.ensureAnimController(modelUrl, def.id)) {
      const ring = this.makeRing(c.sender, creepRadius(def));
      const bar = makeHpBar();
      this.layer.add(bar);
      return { kind: 'humanoid', modelUrl, ring, bar };
    }
    // Pas de modele dedie pour ce creep, ou pas encore charge : repli sur la
    // sphere/cone generique ci-dessous.

    const r = creepRadius(def);
    const baseColor = new THREE.Color(ARMOR_COLORS[def.armorType]);
    const body = new THREE.Mesh(
      def.isAir ? new THREE.ConeGeometry(r, r * 2.1, 8) : new THREE.SphereGeometry(r, 10, 8),
      new THREE.MeshLambertMaterial({ color: baseColor.clone() }),
    );
    body.castShadow = true;
    this.layer.add(body);

    const frost = buildFrostShards(r);
    frost.visible = false;
    body.add(frost);

    const ring = this.makeRing(c.sender, r);
    const bar = makeHpBar();
    this.layer.add(bar);

    return { kind: 'sphere', body, ring, bar, baseColor, frost, phase: Math.random() * Math.PI * 2 };
  }

  private syncHumanoid(tracked: TrackedCreepHumanoid, c: Creep, def: CreepDef, sx: number, sz: number, dt: number, poisonDps: number): void {
    // kind === 'humanoid' implique que le modele etait deja charge au moment
    // du spawn (voir spawn()) et reste en cache indefiniment : controller et
    // model sont donc garantis presents ici, pas de repli a gerer.
    const controller = this.animControllers.get(tracked.modelUrl)!;
    const model = getAnimatedCreepModel(tracked.modelUrl)!;

    // La progression du cycle de marche depend de la distance reellement
    // parcourue depuis le dernier sync (calculee a l'interieur de
    // updateAlive a partir de sx/sz), jamais du temps ecoule : un creep
    // ralenti par la glace marche au ralenti, il ne patine pas.
    controller.updateAlive(c.eid, sx, sz);

    tracked.ring.position.set(sx, 0.02, sz);
    tracked.bar.position.set(sx, model.groundOffsetY + HUMANOID_CREEP_HEIGHT + 0.16, sz);
    paintHpBar(tracked.bar, def.hitPoints > 0 ? c.hp / def.hitPoints : 0);
    if (poisonDps > 0) this.poisonBubbles.requestSpawn(c.eid, sx, model.groundOffsetY, sz, poisonDps, dt);
    else this.poisonBubbles.clearAccumulator(c.eid);
  }

  private syncSphere(tracked: TrackedCreepSphere, c: Creep, def: CreepDef, sx: number, sz: number, dt: number, icePct: number, poisonDps: number, slow: number): void {
    // Cadence de marche proportionnelle a la vitesse reelle : moveSpeed du
    // creep (relatif a NOMINAL_MOVE_SPEED — suit donc creepSpeedMultiplier
    // de balance.json) ET meme facteur 1-slow que packages/sim/src/sim.ts
    // moveCreeps pour le ralentissement gel/poison actif.
    const speedRatio = def.moveSpeed / NOMINAL_MOVE_SPEED;
    tracked.phase += dt * BOB_BASE_HZ * speedRatio * Math.PI * 2 * (1 - slow);
    const r = creepRadius(def);
    const bob = Math.sin(tracked.phase) * r * BOB_AMPLITUDE_RATIO;

    const h = creepHeight(def);
    tracked.body.position.set(sx, h + bob, sz);
    tracked.ring.position.set(sx, 0.02, sz);
    tracked.bar.position.set(sx, h + r + bob + 0.16, sz);
    paintHpBar(tracked.bar, def.hitPoints > 0 ? c.hp / def.hitPoints : 0);

    const mat = tracked.body.material as THREE.MeshLambertMaterial;
    const iceMix = Math.min(1, icePct / ICE_TINT_MAX_PCT) * ICE_TINT_MAX_MIX;
    mat.color.copy(tracked.baseColor).lerp(ICE_TINT_COLOR, iceMix);

    // Pulsation de poison : canal emissif separe, se compose sans jamais
    // entrer en conflit avec la teinte de gel ci-dessus.
    if (poisonDps > 0) {
      const pulse =
        POISON_PULSE_MIN + (1 - POISON_PULSE_MIN) * (0.5 + 0.5 * Math.sin(this.clock * POISON_PULSE_HZ * Math.PI * 2));
      mat.emissive.copy(this.tmpColor.copy(POISON_EMISSIVE_COLOR).multiplyScalar(pulse));
      this.poisonBubbles.requestSpawn(c.eid, sx, h, sz, poisonDps, dt);
    } else {
      mat.emissive.setRGB(0, 0, 0);
      this.poisonBubbles.clearAccumulator(c.eid);
    }

    tracked.frost.visible = slow >= FROST_SHARD_SLOW_THRESHOLD;
  }

  /** A appeler une fois par frame de rendu (pas seulement par tick sim) : sync
   * position/vie ET fait vivre les effets d'ability (teinte, bob, particules). */
  sync(arena: Arena, tick: number, dt: number): void {
    this.clock += dt;
    const seen = new Set<number>();
    for (const c of arena.creeps) {
      seen.add(c.eid);
      const def = creepDefs.get(c.defId);
      if (!def) continue;
      let tracked = this.byEid.get(c.eid);
      if (!tracked) {
        tracked = this.spawn(c, def);
        this.byEid.set(c.eid, tracked);
      }

      const icePct = c.ice && c.ice.untilTick > tick ? c.ice.pct : 0;
      const poisonDps = c.poison && c.poison.untilTick > tick ? c.poison.dps : 0;
      const slow = totalSlowPct(c, tick);
      const [sx, sz] = worldToScene(this.frame, c.x, c.y);

      if (tracked.kind === 'humanoid') this.syncHumanoid(tracked, c, def, sx, sz, dt, poisonDps);
      else this.syncSphere(tracked, c, def, sx, sz, dt, icePct, poisonDps, slow);
    }
    for (const [eid, tracked] of this.byEid) {
      if (!seen.has(eid)) {
        // La sim a deja retire ce creep (immediat, packages/sim reste seul
        // maitre du timing) — la barre de vie et l'anneau disparaissent avec
        // lui des maintenant. Le corps d'un creep avec skin dedie, lui, reste
        // brievement : l'instance joue Death une fois avant de se liberer
        // (voir AnimatedCreepController.markDying/advanceDying) ; une
        // sphere, elle, n'a pas d'animation de mort et disparait
        // immediatement aussi.
        if (tracked.kind === 'humanoid') this.animControllers.get(tracked.modelUrl)?.markDying(eid);
        else this.layer.remove(tracked.body);
        this.layer.remove(tracked.ring, tracked.bar);
        this.poisonBubbles.clearAccumulator(eid);
        this.byEid.delete(eid);
      }
    }
    for (const controller of this.animControllers.values()) controller.advanceDying(dt);
    this.poisonBubbles.update(dt);
  }

  clear(): void {
    for (const tracked of this.byEid.values()) {
      if (tracked.kind === 'sphere') this.layer.remove(tracked.body);
      this.layer.remove(tracked.ring, tracked.bar);
    }
    for (const controller of this.animControllers.values()) controller.clear();
    this.byEid.clear();
    this.poisonBubbles.clear();
  }
}
