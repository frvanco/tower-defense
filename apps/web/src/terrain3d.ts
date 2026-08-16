import * as THREE from 'three';
import { zoneFootprints, type Lane } from '@tower-defense/data';
import { worldToScene, type Frame3D } from './world3d.js';

/**
 * Le chemin reste au niveau bas (Y=0, cf. scene3d.ts). Les zones
 * constructibles sont un plateau surelevé d'un cran net, avec un rebord
 * visible — l'esprit d'un terrain WC3 a chemin encaisse plutot qu'un simple
 * marquage au sol. Exporte : les tours, marqueurs d'emplacement et le
 * fantome de pose doivent tous se poser a cette hauteur (les creeps, eux,
 * marchent sur le chemin et restent a Y=0).
 */
export const PLATFORM_HEIGHT = 0.18;

const TOP_COLOR = 0x33431f;
const CLIFF_COLOR = 0x4a4136;

/**
 * Construit un plateau a partir d'un polygone monde quelconque (ferme,
 * simple — pas forcement un rectangle : zoneFootprints() peut renvoyer un
 * anneau en U). Face du dessus triangulee (gere les polygones concaves,
 * comme l'anneau exterieur), plus une paroi verticale par arete du contour —
 * remplace l'ancien BoxGeometry par rectangle, qui ne pouvait pas suivre un
 * contour en U.
 */
function platformFromPolygon(points: Array<[number, number]>, frame: Frame3D): THREE.Group {
  const g = new THREE.Group();
  const scenePts = points.map(([x, y]) => worldToScene(frame, x, y));

  const shapePts = scenePts.map(([sx, sz]) => new THREE.Vector2(sx, sz));
  const triangles = THREE.ShapeUtils.triangulateShape(shapePts, []);
  const topPositions: number[] = [];
  for (const tri of triangles) {
    for (const idx of tri) {
      const [sx, sz] = scenePts[idx]!;
      topPositions.push(sx, PLATFORM_HEIGHT, sz);
    }
  }
  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute('position', new THREE.Float32BufferAttribute(topPositions, 3));
  topGeo.computeVertexNormals();
  const top = new THREE.Mesh(topGeo, new THREE.MeshLambertMaterial({ color: TOP_COLOR, side: THREE.DoubleSide }));
  top.receiveShadow = true;
  g.add(top);

  const wallPositions: number[] = [];
  for (let i = 0; i < scenePts.length; i++) {
    const [ax, az] = scenePts[i]!;
    const [bx, bz] = scenePts[(i + 1) % scenePts.length]!;
    wallPositions.push(
      ax, 0, az, bx, 0, bz, bx, PLATFORM_HEIGHT, bz,
      ax, 0, az, bx, PLATFORM_HEIGHT, bz, ax, PLATFORM_HEIGHT, az,
    );
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPositions, 3));
  wallGeo.computeVertexNormals();
  const walls = new THREE.Mesh(wallGeo, new THREE.MeshLambertMaterial({ color: CLIFF_COLOR, side: THREE.DoubleSide }));
  walls.castShadow = true;
  walls.receiveShadow = true;
  g.add(walls);

  return g;
}

export function buildPlatforms(lane: Lane, frame: Frame3D): THREE.Group {
  const g = new THREE.Group();
  g.name = 'platforms';

  for (const zone of zoneFootprints(lane)) {
    g.add(platformFromPolygon(zone.points, frame));
  }

  return g;
}
