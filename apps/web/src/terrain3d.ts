import * as THREE from 'three';
import { zoneFootprints, type Lane } from '@tower-defense/data';
import { worldToScene, type Frame3D } from './world3d.js';

/**
 * Le chemin reste au niveau bas (Y=0, cf. scene3d.ts). Les zones
 * constructibles sont un plateau surelevé d'un cran net, avec un rebord
 * visible (les faces verticales de la boite) — l'esprit d'un terrain WC3 a
 * chemin encaisse plutot qu'un simple marquage au sol. Exporte : les tours,
 * marqueurs d'emplacement et le fantome de pose doivent tous se poser a
 * cette hauteur (les creeps, eux, marchent sur le chemin et restent a Y=0).
 */
export const PLATFORM_HEIGHT = 0.18;

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

  for (const zone of zoneFootprints(lane)) {
    g.add(platformFromWorldRect(zone.x0, zone.x1, zone.y0, zone.y1, frame));
  }

  return g;
}
