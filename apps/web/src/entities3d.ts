import * as THREE from 'three';
import type { Arena, Tower, Creep } from '@tower-defense/sim';
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

interface TrackedCreep {
  body: THREE.Mesh;
  ring: THREE.Mesh;
  bar: THREE.Sprite;
}

export class CreepEntities {
  private byEid = new Map<number, TrackedCreep>();

  constructor(
    private layer: THREE.Group,
    private frame: Frame3D,
    private laneColorByPlayer: Map<number, string>,
  ) {}

  private spawn(c: Creep, def: CreepDef): TrackedCreep {
    const r = creepRadius(def);
    const color = ARMOR_COLORS[def.armorType];
    const geo = def.isAir ? new THREE.ConeGeometry(r, r * 2.1, 8) : new THREE.SphereGeometry(r, 10, 8);
    const body = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
    body.castShadow = true;
    this.layer.add(body);

    const ringColor = this.laneColorByPlayer.get(c.sender) ?? '#888888';
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.95, r * 1.25, 16),
      new THREE.MeshBasicMaterial({ color: ringColor, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    this.layer.add(ring);

    const bar = makeHpBar();
    this.layer.add(bar);

    return { body, ring, bar };
  }

  sync(arena: Arena): void {
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
      const [sx, sz] = worldToScene(this.frame, c.x, c.y);
      const h = creepHeight(def);
      tracked.body.position.set(sx, h, sz);
      tracked.ring.position.set(sx, 0.02, sz);
      tracked.bar.position.set(sx, h + creepRadius(def) + 0.16, sz);
      paintHpBar(tracked.bar, def.hitPoints > 0 ? c.hp / def.hitPoints : 0);
    }
    for (const [eid, tracked] of this.byEid) {
      if (!seen.has(eid)) {
        this.layer.remove(tracked.body, tracked.ring, tracked.bar);
        this.byEid.delete(eid);
      }
    }
  }

  clear(): void {
    for (const { body, ring, bar } of this.byEid.values()) this.layer.remove(body, ring, bar);
    this.byEid.clear();
  }
}
