import * as THREE from 'three';
import type { TowerDef } from '@tower-defense/data';
import { MAT, teamMaterial } from '../materials.js';
import { MAX_RADIUS, measureSweptRadius } from '../footprint.js';
import { deriveTowerVisual, getBranchChain } from './types.js';
import { makeScaffold } from './cannon.js';
import { mesh } from './mesh.js';

const DEFAULT_TEAM_COLOR = 0xc0392b;

/**
 * Tour generique pour toute branche qui n'a pas encore de geometrie dediee et
 * validee visuellement (5 branches sur 6 actuellement — seule Cannon a ete
 * portee depuis un prototype). DELIBEREMENT simple : un fut de pierre et un
 * marqueur colore, rien de la richesse de `makeCannonTower` (pas de canons,
 * pas de bandes de renfort, pas de blindage). Le but n'est pas de faire semblant
 * d'etre fini, c'est de tenir sa case et de rester lisible en attendant la
 * vraie geometrie de la branche.
 *
 * Les proportions suivent la MEME derivation que les branches reelles
 * (`deriveTowerVisual` : hauteur <- portee/prix, largeur plafonnee <- prix)
 * pour que la progression visuelle reste coherente meme sans detail.
 */
export function makePlaceholderTower(
  rootId: string,
  tier: number,
  branchHue: number,
  teamColor: number = DEFAULT_TEAM_COLOR,
): THREE.Group {
  const chain = getBranchChain(rootId);
  const def = chain[tier];
  if (!def) {
    throw new Error(`palier ${tier} inexistant sur la branche ${rootId} (${chain.length} paliers connus)`);
  }
  return buildPlaceholderTower(def, tier, branchHue, teamColor);
}

function buildPlaceholderTower(def: TowerDef, tier: number, branchHue: number, teamColor: number): THREE.Group {
  const visual = deriveTowerVisual(def, tier);
  const { height, width, armor } = visual;
  const accent = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(branchHue / 360, 0.55, 0.5) });

  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  g.add(body);

  // --- Fut unique, pas de socle multi-etage ni de plateforme crenelee : c'est
  // volontairement le degre de detail minimal qui reste identifiable comme
  // "une tour" sans emprunter la lecture visuelle d'une branche existante.
  body.add(mesh(new THREE.CylinderGeometry(width, width * 1.1, 0.24, 8), MAT.stone2, 0, 0.12, 0));
  const shaftH = height * 0.6;
  body.add(mesh(new THREE.CylinderGeometry(width * 0.62, width * 0.78, shaftH, 8), MAT.stone, 0, 0.24 + shaftH / 2, 0));
  const platY = 0.24 + shaftH;

  // --- Tourelle : un simple bloc excentre pour que la visee (aimTurret) reste
  // visible malgre la simplicite — un cube parfaitement symetrique ne montrerait
  // aucune rotation.
  const turret = new THREE.Group();
  turret.position.y = platY + 0.12;
  turret.name = 'turret';
  body.add(turret);

  const markerSize = 0.14 + armor * 0.1;
  turret.add(mesh(new THREE.BoxGeometry(markerSize, markerSize, markerSize), accent, 0, markerSize / 2, 0));
  const snout = mesh(
    new THREE.BoxGeometry(markerSize * 0.4, markerSize * 0.4, markerSize * 1.4),
    MAT.metal,
    0,
    markerSize / 2,
    markerSize * 0.9,
  );
  turret.add(snout);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, markerSize / 2, markerSize * 1.6);
  muzzle.name = 'muzzle';
  turret.add(muzzle);

  // --- Fanion d'equipe, meme convention que les branches reelles.
  const poleH = 0.26 + armor * 0.5;
  const fx = width * 0.5;
  const fz = -width * 0.5;
  body.add(mesh(new THREE.CylinderGeometry(0.016, 0.016, poleH, 5), MAT.metal, fx, platY + poleH / 2, fz));
  const flag = mesh(new THREE.BoxGeometry(0.18, 0.12, 0.014), teamMaterial(teamColor), fx + 0.1, platY + poleH - 0.08, fz);
  flag.name = 'flag';
  body.add(flag);

  // --- Echafaudage/anneaux : memes noms que les branches reelles pour que
  // build.ts et le jeu n'aient pas de cas particulier a gerer.
  const scaffold = makeScaffold(width, platY + 0.25);
  scaffold.visible = false;
  scaffold.name = 'scaffold';
  g.add(scaffold);

  const rangeRing = new THREE.Mesh(
    new THREE.RingGeometry(def.range * 0.0028 - 0.02, def.range * 0.0028, 64),
    new THREE.MeshBasicMaterial({ color: accent.color, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
  );
  rangeRing.rotation.x = -Math.PI / 2;
  rangeRing.position.y = 0.02;
  rangeRing.visible = false;
  rangeRing.name = 'rangeRing';
  g.add(rangeRing);

  const prog = new THREE.Mesh(
    new THREE.RingGeometry(width * 1.15, width * 1.32, 48, 1, -Math.PI / 2, 0.001),
    new THREE.MeshBasicMaterial({ color: 0x6ec1ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  prog.rotation.x = -Math.PI / 2;
  prog.position.y = 0.03;
  prog.visible = false;
  prog.name = 'progress';
  g.add(prog);

  const foot = new THREE.Mesh(
    new THREE.RingGeometry(MAX_RADIUS - 0.02, MAX_RADIUS, 8),
    new THREE.MeshBasicMaterial({ color: 0x4a9e5c, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
  );
  foot.rotation.x = -Math.PI / 2;
  foot.rotation.z = Math.PI / 8;
  foot.position.y = 0.015;
  foot.name = 'footprint';
  g.add(foot);

  g.userData = { tier, def, turret, body, build: null, recoil: 0 };

  const radius = measureSweptRadius(body);
  g.userData.radius = radius;
  if (radius > MAX_RADIUS) {
    (foot.material as THREE.MeshBasicMaterial).color.set(0xd0503c);
    console.warn(`[emprise] placeholder ${def.name} (palier ${tier + 1}) deborde : rayon ${radius.toFixed(3)} > ${MAX_RADIUS.toFixed(3)}`);
  }

  return g;
}

/** Racines de branche qui ont une geometrie dediee portee depuis un prototype
 * valide visuellement, plutot que le placeholder generique. A completer au
 * fur et a mesure que les 5 branches restantes sont portees. */
const DEDICATED_GEOMETRY_ROOTS = new Set<string>(['h000']);

export function hasDedicatedGeometry(rootId: string): boolean {
  return DEDICATED_GEOMETRY_ROOTS.has(rootId);
}
