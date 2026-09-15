import { PATH_WIDTH, zoneFootprints, type Lane } from '@tower-defense/data';
import { worldToScene, type Frame3D } from '../world3d.js';

type Point2 = [number, number];

/** Bornes des vrais plateaux, pas du buildZone historique qui est plus large. */
export function sanctuaryLayout(lane: Lane, frame: Frame3D) {
  const polygons = zoneFootprints(lane).map((zone) => zone.points.map(([x, y]) => worldToScene(frame, x, y)));
  const points = polygons.flat();
  const path = [lane.spawn, ...lane.waypoints].map(([x, y]) => worldToScene(frame, x, y));
  const halfPath = PATH_WIDTH * frame.scale / 2;
  const minX = Math.min(...points.map(([x]) => x));
  const maxX = Math.max(...points.map(([x]) => x));
  const minZ = Math.min(...points.map(([, z]) => z));
  const maxZ = Math.max(...points.map(([, z]) => z));
  const exit = path[path.length - 1]!;
  const previous = path[path.length - 2]!;
  const length = Math.hypot(exit[0] - previous[0], exit[1] - previous[1]);
  const direction: Point2 = [(exit[0] - previous[0]) / length, (exit[1] - previous[1]) / length];
  // La porte fait face au premier plan. Un court parvis en L, au-dela de la
  // sortie, garde la facade lisible sans deplacer le dernier waypoint.
  const gate: Point2 = [exit[0] + direction[0] * 5.1, Math.max(exit[1] + 2, maxZ + 0.7)];

  // Cercle conservateur: rejette aussi les objets dont le centre est hors jeu
  // mais dont le feuillage ou la base deborderait dans une surface jouable.
  function isClear(x: number, z: number, radius: number): boolean {
    const distanceToSegment = (a: Point2, b: Point2): number => {
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
    };
    for (const polygon of polygons) {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i]!;
        const b = polygon[j]!;
        if (distanceToSegment(a, b) < radius) return false;
        if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      }
      if (inside) return false;
    }
    for (let i = 1; i < path.length; i++) {
      if (distanceToSegment(path[i - 1]!, path[i]!) < radius + halfPath + 0.12) return false;
    }
    return true;
  }

  return { minX, maxX, minZ, maxZ, path, halfPath, gate, direction, isClear };
}
