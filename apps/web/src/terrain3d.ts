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
export const PLATFORM_HEIGHT = 0.45;

const TOP_COLOR = 0x33431f;
// Nettement plus sombre que TOP_COLOR (l'inverse etait vrai avant : la paroi
// etait plus claire que le dessus, ce qui contredit la lecture d'un
// denivele). Voir aussi la bande d'occlusion ambiante ci-dessous.
const CLIFF_COLOR = 0x2a241c;
// Bande sombre et semi-transparente au pied de la paroi, cote exterieur
// (chemin), qui simule l'occlusion ambiante — c'est le contact au sol qui
// fait « poser » un volume, plus que la geometrie elle-meme.
const AO_COLOR = 0x120d09;
const AO_OPACITY = 0.4;
const AO_WIDTH = 0.35;
/** Legerement au-dessus du dessus du chemin (0.006 dans buildPath,
 * scene3d.ts) pour eviter le z-fighting, sans jamais couvrir la paroi. */
const AO_Y = 0.012;

/**
 * Bande d'occlusion ambiante au ras du sol, courant le long de chaque arete
 * du contour, poussee vers l'EXTERIEUR du polygone (loin du centroide) — le
 * cote chemin, jamais le cote plateau. Une seule passe plate (pas de degrade
 * vertex-color) : suffisant pour l'effet de contact recherche.
 */
function buildAmbientOcclusionSkirt(scenePts: Array<[number, number]>): THREE.Mesh {
  let cx = 0;
  let cz = 0;
  for (const [sx, sz] of scenePts) {
    cx += sx;
    cz += sz;
  }
  cx /= scenePts.length;
  cz /= scenePts.length;

  const positions: number[] = [];
  for (let i = 0; i < scenePts.length; i++) {
    const [ax, az] = scenePts[i]!;
    const [bx, bz] = scenePts[(i + 1) % scenePts.length]!;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    // Deux normales candidates ; on garde celle qui eloigne du centroide.
    let nx = -dz / len;
    let nz = dx / len;
    const midx = (ax + bx) / 2;
    const midz = (az + bz) / 2;
    const towardCentroidX = cx - midx;
    const towardCentroidZ = cz - midz;
    if (nx * towardCentroidX + nz * towardCentroidZ > 0) {
      nx = -nx;
      nz = -nz;
    }
    const ox1 = ax + nx * AO_WIDTH;
    const oz1 = az + nz * AO_WIDTH;
    const ox2 = bx + nx * AO_WIDTH;
    const oz2 = bz + nz * AO_WIDTH;
    positions.push(
      ax, AO_Y, az, bx, AO_Y, bz, ox2, AO_Y, oz2,
      ax, AO_Y, az, ox2, AO_Y, oz2, ox1, AO_Y, oz1,
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: AO_COLOR, transparent: true, opacity: AO_OPACITY, side: THREE.DoubleSide }),
  );
  return mesh;
}

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

  g.add(buildAmbientOcclusionSkirt(scenePts));

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
