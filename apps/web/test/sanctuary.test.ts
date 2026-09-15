import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { lanes, PATH_WIDTH, zoneFootprints } from '@tower-defense/data';
import { playerColor } from '../src/colors.js';
import { createSanctuary } from '../src/sanctuary/index.js';
import { computeFrame, worldToScene } from '../src/world3d.js';

type Point2 = [number, number];
const EPSILON = 1e-5;

function distanceSegment(x: number, z: number, a: Point2, b: Point2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const projection = Math.max(0, Math.min(1,
    ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0] - projection * dx, z - a[1] - projection * dz);
}

function dansPolygone(x: number, z: number, polygone: Point2[]): boolean {
  let interieur = false;
  for (let i = 0, j = polygone.length - 1; i < polygone.length; j = i++) {
    const a = polygone[i]!;
    const b = polygone[j]!;
    // Un raccord exactement sur une limite ne constitue pas un empietement.
    if (distanceSegment(x, z, a, b) < EPSILON) return false;
    if ((a[1] > z) !== (b[1] > z)
      && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) interieur = !interieur;
  }
  return interieur;
}

function ressources(groupe: THREE.Group) {
  const meshes: THREE.Mesh[] = [];
  const geometries = new Set<THREE.BufferGeometry>();
  const materiaux = new Set<THREE.Material>();
  groupe.traverse((objet) => {
    if (!(objet instanceof THREE.Mesh)) return;
    meshes.push(objet);
    geometries.add(objet.geometry);
    for (const materiau of Array.isArray(objet.material) ? objet.material : [objet.material]) materiaux.add(materiau);
  });
  return { meshes, geometries, materiaux };
}

describe('sanctuaire: emprise des decors', () => {
  for (const densite of [1, 2]) {
    it.each(lanes)('garde les surfaces jouables libres pour $color, densite ' + densite, (lane) => {
      const cadre = computeFrame(lane);
      const decor = createSanctuary(lane, cadre, { density: densite });
      const polygones = zoneFootprints(lane).map((zone) =>
        zone.points.map(([x, y]) => worldToScene(cadre, x, y)));
      const chemin = [lane.spawn, ...lane.waypoints].map(([x, y]) => worldToScene(cadre, x, y));
      const segments = chemin.slice(1).map((point, index) => [chemin[index]!, point] as [Point2, Point2]);
      const demiLargeur = PATH_WIDTH * cadre.scale / 2;
      const violations: string[] = [];
      const sommet = new THREE.Vector3();
      const instance = new THREE.Matrix4();
      const monde = new THREE.Matrix4();
      let sommetsVerifies = 0;

      try {
        decor.group.updateMatrixWorld(true);
        decor.group.traverse((objet) => {
          if (!(objet instanceof THREE.Mesh)) return;
          const positions = objet.geometry.getAttribute('position');
          const nombre = objet instanceof THREE.InstancedMesh ? objet.count : 1;
          for (let numero = 0; numero < nombre; numero++) {
            if (objet instanceof THREE.InstancedMesh) {
              objet.getMatrixAt(numero, instance);
              monde.multiplyMatrices(objet.matrixWorld, instance);
            } else monde.copy(objet.matrixWorld);

            for (let i = 0; i < positions.count; i++) {
              sommet.fromBufferAttribute(positions, i).applyMatrix4(monde);
              sommetsVerifies++;
              const plateau = polygones.some((polygone) => dansPolygone(sommet.x, sommet.z, polygone));
              // Le controle part des donnees de jeu; la marge propre au placement
              // du decor ne doit pas rejeter la dalle qui raccorde la vraie sortie.
              const parcours = segments.some(([a, b]) =>
                distanceSegment(sommet.x, sommet.z, a, b) < demiLargeur - EPSILON);
              if ((plateau || parcours) && violations.length < 8) {
                violations.push(`${objet.name}[${numero}], sommet ${i}: `
                  + `${sommet.x.toFixed(4)}, ${sommet.y.toFixed(4)}, ${sommet.z.toFixed(4)} `
                  + `dans ${plateau ? 'plateau' : 'chemin'}`);
              }
            }
          }
        });
        expect(sommetsVerifies).toBeGreaterThan(0);
        expect(violations).toEqual([]);
      } finally {
        decor.dispose();
      }
    });
  }
});

describe('sanctuaire: changement de joueur et cycle de vie', () => {
  it('reteinte les six equipes et masque le decor sans reconstruire ses ressources', () => {
    const lane = lanes[0]!;
    const teinteEquipe = new THREE.Color(0xfa02da);
    const decor = createSanctuary(lane, computeFrame(lane), { colors: { team: teinteEquipe } });
    const avant = ressources(decor.group);
    const equipes = [...avant.materiaux].filter((materiau): materiau is THREE.MeshLambertMaterial =>
      materiau instanceof THREE.MeshLambertMaterial && materiau.color.equals(teinteEquipe));
    const autres = [...avant.materiaux].filter((materiau): materiau is THREE.MeshLambertMaterial =>
      materiau instanceof THREE.MeshLambertMaterial && !equipes.includes(materiau))
      .map((materiau) => ({ materiau, couleur: materiau.color.clone() }));

    try {
      expect(equipes.length).toBeGreaterThan(0);
      for (let joueur = 0; joueur < 6; joueur++) {
        decor.setEnabled(false);
        expect(decor.group.visible).toBe(false);
        decor.setPlayer(joueur);
        for (const materiau of equipes) expect(materiau.color.equals(new THREE.Color(playerColor(joueur)))).toBe(true);
        for (const { materiau, couleur } of autres) expect(materiau.color.equals(couleur)).toBe(true);
        decor.setEnabled(true);
        expect(decor.group.visible).toBe(true);
        const apres = ressources(decor.group);
        expect(apres.meshes).toEqual(avant.meshes);
        expect(apres.geometries).toEqual(avant.geometries);
        expect(apres.materiaux).toEqual(avant.materiaux);
      }
    } finally {
      decor.dispose();
    }
  });

  it('libere une seule fois les ressources partagees sans toucher a une autre arene', () => {
    const lane = lanes[0]!;
    const premier = createSanctuary(lane, computeFrame(lane));
    const second = createSanctuary(lane, computeFrame(lane));
    const premiereScene = new THREE.Scene();
    const secondeScene = new THREE.Scene();
    premiereScene.add(premier.group);
    secondeScene.add(second.group);
    const ressourcesPremier = ressources(premier.group);
    const ressourcesSecond = ressources(second.group);
    const geometries = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const materiaux = vi.spyOn(THREE.Material.prototype, 'dispose');
    const instances = vi.spyOn(THREE.InstancedMesh.prototype, 'dispose');

    try {
      premier.dispose();
      premier.dispose();
      expect(premier.group.parent).toBeNull();
      expect(premier.group.children).toHaveLength(0);
      expect(new Set(geometries.mock.contexts).size).toBe(geometries.mock.calls.length);
      expect(new Set(materiaux.mock.contexts).size).toBe(materiaux.mock.calls.length);
      expect(new Set(instances.mock.contexts).size).toBe(instances.mock.calls.length);
      for (const geometrie of ressourcesPremier.geometries) expect(geometries.mock.contexts).toContain(geometrie);
      for (const materiau of ressourcesPremier.materiaux) expect(materiaux.mock.contexts).toContain(materiau);
      for (const mesh of ressourcesPremier.meshes) {
        if (mesh instanceof THREE.InstancedMesh) expect(instances.mock.contexts).toContain(mesh);
      }
      for (const geometrie of ressourcesSecond.geometries) expect(geometries.mock.contexts).not.toContain(geometrie);
      for (const materiau of ressourcesSecond.materiaux) expect(materiaux.mock.contexts).not.toContain(materiau);
      for (const mesh of ressourcesSecond.meshes) expect(instances.mock.contexts).not.toContain(mesh);
      expect(second.group.parent).toBe(secondeScene);
      expect(ressources(second.group).meshes).toEqual(ressourcesSecond.meshes);
      second.setEnabled(false);
      second.setPlayer(5);
      second.setEnabled(true);
      expect(second.group.visible).toBe(true);
    } finally {
      vi.restoreAllMocks();
      premier.dispose();
      second.dispose();
    }
  });
});
