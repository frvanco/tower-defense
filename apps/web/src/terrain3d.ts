import * as THREE from 'three';
import { laneAnchors, buildZones, type Lane } from '@tower-defense/data';
import { worldToScene, PATH_WIDTH_WORLD, type Frame3D } from './world3d.js';

/**
 * Le chemin reste au niveau bas (Y=0, cf. scene3d.ts). Les zones
 * constructibles sont un plateau surelevé d'un cran net, avec un rebord
 * visible (les faces verticales de la boite) — l'esprit d'un terrain WC3 a
 * chemin encaisse plutot qu'un simple marquage au sol. Exporte : les tours,
 * marqueurs d'emplacement et le fantome de pose doivent tous se poser a
 * cette hauteur (les creeps, eux, marchent sur le chemin et restent a Y=0).
 */
export const PLATFORM_HEIGHT = 0.18;

/** Distance entre le chemin et le bord du plateau : juste assez pour degager
 * le chemin rendu (PATH_WIDTH_WORLD/2) plus une mince marge visible — le
 * plateau doit coller au chemin, pas en etre separe par de l'herbe. */
const PATH_CLEARANCE = PATH_WIDTH_WORLD / 2 + 8;

/** Marge entre le bord d'un plateau et le vrai bord de la zone constructible,
 * ou entre un plateau et les points de spawn/sortie — evite juste le
 * chevauchement visuel, sans laisser un vide notable. */
const EDGE_GAP = 24;
/** Marge specifique vis-a-vis des points de spawn/sortie (plus genereuse que
 * EDGE_GAP : ce sont des reperes de jeu, pas juste un bord de carte). */
const SPAWN_GAP = 70;

const TOP_COLOR = 0x33431f;
const CLIFF_COLOR = 0x4a4136;

function platformFromWorldRect(x0: number, x1: number, y0: number, y1: number, frame: Frame3D): THREE.Mesh {
  const [sx0, sz0] = worldToScene(frame, x0, y0);
  const [sx1, sz1] = worldToScene(frame, x1, y1);
  const width = Math.abs(sx1 - sx0);
  const depth = Math.abs(sz1 - sz0);
  const cx = (sx0 + sx1) / 2;
  const cz = (sz0 + sz1) / 2;

  const top = new THREE.MeshLambertMaterial({ color: TOP_COLOR });
  const side = new THREE.MeshLambertMaterial({ color: CLIFF_COLOR });
  // Ordre BoxGeometry : +x, -x, +y, -y, +z, -z — seul l'index 2 (+y) est le dessus.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, PLATFORM_HEIGHT, depth), [side, side, top, side, side, side]);
  mesh.position.set(cx, PLATFORM_HEIGHT / 2, cz);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

export function buildPlatforms(lane: Lane, frame: Frame3D): THREE.Group {
  const g = new THREE.Group();
  g.name = 'platforms';

  const { leftArmX, rightArmX, connectorY, armTopY } = laneAnchors(lane);
  const bz = lane.buildZone;
  const zones = new Map(buildZones(lane.player).map((z) => [z.id, z]));
  const armSpanTop = Math.max(lane.waypoints[0]![1], lane.spawn[1]); // haut du bras gauche = spawn
  const armSpanTop2 = Math.max(lane.waypoints[1]![1], lane.waypoints[2]![1]); // haut du bras droit = end

  // --- Milieu : colle aux deux bras, du connecteur jusqu'a pres du spawn/end
  // (le "haut" du U reste ouvert, sans plateau au-dela pour ne pas recouvrir
  // les reperes de spawn/sortie).
  if (zones.has('milieu')) {
    g.add(
      platformFromWorldRect(
        leftArmX + PATH_CLEARANCE,
        rightArmX - PATH_CLEARANCE,
        connectorY + PATH_CLEARANCE,
        armTopY - SPAWN_GAP,
        frame,
      ),
    );
  }

  // --- Cotes : collent a leur bras, s'etendent jusqu'au bord de la zone
  // constructible et sur presque toute la longueur du bras.
  if (zones.has('gauche')) {
    g.add(
      platformFromWorldRect(
        bz.left + EDGE_GAP,
        leftArmX - PATH_CLEARANCE,
        lane.waypoints[0]![1] + EDGE_GAP,
        armSpanTop - SPAWN_GAP,
        frame,
      ),
    );
  }
  if (zones.has('droite')) {
    g.add(
      platformFromWorldRect(
        rightArmX + PATH_CLEARANCE,
        bz.right - EDGE_GAP,
        lane.waypoints[1]![1] + EDGE_GAP,
        armSpanTop2 - SPAWN_GAP,
        frame,
      ),
    );
  }

  // --- Bas : colle au connecteur, s'etend jusqu'au bord bas et lateral de
  // la zone constructible.
  if (zones.has('bas')) {
    g.add(platformFromWorldRect(bz.left + EDGE_GAP, bz.right - EDGE_GAP, bz.bottom + EDGE_GAP, connectorY - PATH_CLEARANCE, frame));
  }

  return g;
}
