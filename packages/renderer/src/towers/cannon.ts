import * as THREE from 'three';
import { MAT, teamMaterial } from '../materials.js';
import { MAX_RADIUS, measureSweptRadius } from '../footprint.js';
import { deriveTowerVisual, getBranchChain, type TowerVisual } from './types.js';
import { mesh } from './mesh.js';

/** Racine de la branche Cannon dans `buildableTowers` (@tower-defense/data). */
const CANNON_ROOT = 'h000';

/** Tourelle agrandie de 15% par rapport a une echelle 1:1 — porte du prototype :
 * une valeur plus faible ne balaie pas assez large pour paraitre imposante,
 * une valeur plus forte (essayee a 1.35 dans une version anterieure du
 * prototype) faisait deborder le rayon balaye hors de MAX_RADIUS combine a
 * la longueur des canons. */
const TURRET_SCALE = 1.15;

const DEFAULT_TEAM_COLOR = 0xc0392b;

/**
 * Porte de `makeCannonTower` dans reference/cannon-branch-v5.html, sans
 * changement de rendu. Seule difference fonctionnelle : `tier` indexe la
 * chaine d'upgrade REELLE lue depuis `@tower-defense/data` (`getBranchChain`)
 * au lieu du tableau `BRANCH` recopie a la main du prototype — rebalancer
 * `balance.json` reforme donc la tour automatiquement.
 *
 * `teamColor` est un ajout : le prototype n'avait qu'un seul `MAT.team`
 * mutable global (un color-picker, une tour a la fois). En jeu, jusqu'a 8
 * joueurs peuvent avoir chacun une tour de ce type simultanement — un
 * parametre optionnel etait necessaire pour que `materials.ts#teamMaterial`
 * serve a quelque chose. Valeur par defaut = la couleur du prototype.
 */
export function makeCannonTower(tier: number, teamColor: number = DEFAULT_TEAM_COLOR): THREE.Group {
  const chain = getBranchChain(CANNON_ROOT);
  const def = chain[tier];
  if (!def) {
    throw new Error(`palier ${tier} inexistant sur la branche Cannon (${chain.length} paliers connus)`);
  }
  const visual = deriveTowerVisual(def, tier);
  return buildCannonTower(visual, teamColor);
}

function buildCannonTower(visual: TowerVisual, teamColor: number): THREE.Group {
  const { def, tier, armor, height, caliber, barrels, width, accentColor, isAntiAir } = visual;
  const g = new THREE.Group();
  const accent = new THREE.MeshLambertMaterial({ color: accentColor });

  // Tout le corps vit dans un sous-Group : l'animation de construction le met
  // a l'echelle sans toucher aux echafaudages ni aux effets au sol.
  const body = new THREE.Group();
  body.name = 'body';
  g.add(body);

  // --- Socle
  body.add(mesh(new THREE.CylinderGeometry(width, width * 1.12, 0.26, 8), MAT.stone2, 0, 0.13, 0));
  body.add(mesh(new THREE.CylinderGeometry(width * 0.86, width * 0.94, 0.2, 8), MAT.stone, 0, 0.36, 0));

  // --- Fut. Il s'epaissit avec le palier au lieu de s'affiner : un canon lourd
  // doit paraitre lourd.
  const taper = 0.55 + tier * 0.035;
  const shaftH = height * 0.52;
  body.add(
    mesh(new THREE.CylinderGeometry(width * taper, width * 0.8, shaftH, 8), MAT.stone, 0, 0.46 + shaftH / 2, 0),
  );

  // Bandes de renfort a partir du palier 3 (index 2).
  if (tier >= 2) {
    for (let i = 0; i < tier - 1; i++) {
      const y = 0.62 + (shaftH - 0.2) * (i / Math.max(1, tier - 1));
      const band = mesh(new THREE.TorusGeometry(width * (taper + 0.09), 0.04, 6, 8), MAT.metal, 0, y, 0);
      band.rotation.x = Math.PI / 2;
      body.add(band);
    }
  }

  // --- Plateforme
  const platY = 0.46 + shaftH;
  const platR = width * (0.74 + armor * 0.2);
  body.add(mesh(new THREE.CylinderGeometry(platR, platR * 0.88, 0.14, 8), MAT.stone2, 0, platY + 0.07, 0));

  const merlons = 4 + tier;
  for (let i = 0; i < merlons; i++) {
    const a = (i / merlons) * Math.PI * 2;
    body.add(
      mesh(
        new THREE.BoxGeometry(0.12, 0.14, 0.12),
        MAT.stone,
        Math.cos(a) * platR * 0.86,
        platY + 0.2,
        Math.sin(a) * platR * 0.86,
      ),
    );
  }

  // --- Tourelle
  const turret = new THREE.Group();
  turret.position.y = platY + 0.16;
  turret.scale.setScalar(TURRET_SCALE);
  turret.name = 'turret';
  body.add(turret);

  if (isAntiAir) {
    // Marqueur anti-air commun a toutes les branches : toit de bois + arbalete,
    // aucun canon, un cone accent oriente vers le haut. La difference de role
    // doit se lire instantanement, quelle que soit la branche.
    turret.add(mesh(new THREE.ConeGeometry(platR * 0.95, 0.44, 8), MAT.wood, 0, 0.3, 0));
    turret.add(mesh(new THREE.BoxGeometry(0.07, 0.07, 0.48), MAT.wood, 0, 0.12, 0.21));
    turret.add(mesh(new THREE.BoxGeometry(0.36, 0.05, 0.05), MAT.wood, 0, 0.12, 0.31));
    turret.add(mesh(new THREE.ConeGeometry(0.05, 0.16, 6), accent, 0, 0.5, 0));
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.12, 0.46);
    muzzle.name = 'muzzle';
    turret.add(muzzle);
  } else {
    const breechR = caliber * 2.0;
    turret.add(mesh(new THREE.CylinderGeometry(breechR, breechR, breechR * 1.6, 8), MAT.metal, 0, breechR * 0.8, 0));
    const ring = mesh(new THREE.TorusGeometry(breechR * 1.05, 0.028, 6, 10), accent, 0, breechR * 0.8, 0);
    ring.rotation.x = Math.PI / 2;
    turret.add(ring);

    // Canons courts et epais plutot que longs et fins : a diametre egal, la
    // longueur coute beaucoup plus cher en rayon balaye que le calibre.
    const len = 0.28 + caliber * 1.0;
    // Canons groupes AUTOUR DE L'AXE (disposition en couronne, type barillet)
    // plutot qu'etales en eventail : garde l'impression de puissance sans
    // elargir l'emprise au sol.
    const cluster = barrels <= 1 ? 0 : caliber * 1.0;
    const axisY = breechR * 0.95;
    for (let i = 0; i < barrels; i++) {
      let ox = 0;
      let oy = axisY;
      if (barrels === 2) {
        ox = (i - 0.5) * cluster * 2;
      } else if (barrels > 2) {
        const a = (i / barrels) * Math.PI * 2 - Math.PI / 2;
        ox = Math.cos(a) * cluster;
        oy = axisY + Math.sin(a) * cluster;
      }
      const b = mesh(new THREE.CylinderGeometry(caliber * 0.8, caliber, len, 10), MAT.metal2, ox, oy, len / 2);
      b.rotation.x = Math.PI / 2;
      turret.add(b);
      const m = mesh(new THREE.CylinderGeometry(caliber * 1.2, caliber * 0.85, caliber * 0.75, 10), MAT.metal, ox, oy, len);
      m.rotation.x = Math.PI / 2;
      turret.add(m);
    }
    // Collier de maintien : lie les canons entre eux, indispensable pour que
    // le barillet ne ressemble pas a des tubes qui flottent cote a cote.
    if (barrels > 1) {
      const collar = mesh(
        new THREE.TorusGeometry(cluster + caliber * 0.9, caliber * 0.22, 6, 12),
        MAT.metal,
        0,
        axisY,
        len * 0.62,
      );
      turret.add(collar);
    }
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, axisY, len + 0.06);
    muzzle.name = 'muzzle';
    turret.add(muzzle);

    // Blindage plaque contre la culasse a partir du palier 5 (index 4).
    if (tier >= 4) {
      for (const s of [-1, 1]) {
        turret.add(
          mesh(
            new THREE.BoxGeometry(0.05, breechR * 1.7, breechR * 1.9),
            MAT.metal,
            s * (cluster + caliber * 1.35),
            axisY,
            breechR * 0.5,
          ),
        );
      }
    }
  }

  // --- Fanion d'equipe : sa hauteur suit le prix. Reperer un joueur riche
  // d'un coup d'oeil est une information de jeu, pas de la decoration.
  const poleH = 0.3 + armor * 0.55;
  // Le mat reste a l'interieur du diametre du socle.
  const fx = platR * 0.52;
  const fz = -platR * 0.52;
  body.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, poleH, 5), MAT.metal, fx, platY + poleH / 2, fz));
  const flag = mesh(new THREE.BoxGeometry(0.2, 0.13, 0.015), teamMaterial(teamColor), fx + 0.11, platY + poleH - 0.085, fz);
  flag.name = 'flag';
  body.add(flag);

  // --- Echafaudages : montres uniquement pendant la construction.
  const scaffold = makeScaffold(width, platY + 0.3);
  scaffold.visible = false;
  scaffold.name = 'scaffold';
  g.add(scaffold);

  // --- Anneau de portee. Facteur d'echelle (range * 0.0028) porte tel quel
  // du prototype : c'est une echelle de PRESENTATION pour cette galerie, pas
  // la meme conversion que CELL/MAX_RADIUS (voir README, section incertitudes).
  const ringGeo = new THREE.RingGeometry(def.range * 0.0028 - 0.02, def.range * 0.0028, 64);
  const rangeRing = new THREE.Mesh(
    ringGeo,
    new THREE.MeshBasicMaterial({ color: accentColor, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
  );
  rangeRing.rotation.x = -Math.PI / 2;
  rangeRing.position.y = 0.02;
  rangeRing.visible = false;
  rangeRing.name = 'rangeRing';
  g.add(rangeRing);

  // --- Anneau de progression de construction
  const prog = new THREE.Mesh(
    new THREE.RingGeometry(width * 1.15, width * 1.32, 48, 1, -Math.PI / 2, 0.001),
    new THREE.MeshBasicMaterial({ color: 0x6ec1ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  prog.rotation.x = -Math.PI / 2;
  prog.position.y = 0.03;
  prog.visible = false;
  prog.name = 'progress';
  g.add(prog);

  // --- Contour d'emprise. Vert = tient dans sa case, rouge = deborde.
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

  // Mesure du RAYON BALAYE (voir footprint.ts), pas de la boite au repos.
  const radius = measureSweptRadius(body);
  g.userData.radius = radius;
  if (radius > MAX_RADIUS) {
    (foot.material as THREE.MeshBasicMaterial).color.set(0xd0503c);
    console.warn(`[emprise] ${def.name} (palier ${tier + 1}) deborde : rayon ${radius.toFixed(3)} > ${MAX_RADIUS.toFixed(3)}`);
  }

  return g;
}

/** Echafaudage generique. Un seul modele sert a la construction ET a tous les upgrades ;
 * exporte pour que `towers/placeholder.ts` (et toute branche future) puisse le reutiliser
 * au lieu d'en recopier un. */
export function makeScaffold(width: number, top: number): THREE.Group {
  const s = new THREE.Group();
  const r = width * 1.15;
  const posts = 4;
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    s.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, top, 5), MAT.scaff, x, top / 2, z));
  }
  for (const h of [0.3, 0.58, 0.86]) {
    for (let i = 0; i < posts; i++) {
      const a1 = (i / posts) * Math.PI * 2 + Math.PI / 4;
      const a2 = ((i + 1) / posts) * Math.PI * 2 + Math.PI / 4;
      const p1 = new THREE.Vector3(Math.cos(a1) * r, top * h, Math.sin(a1) * r);
      const p2 = new THREE.Vector3(Math.cos(a2) * r, top * h, Math.sin(a2) * r);
      const mid = p1.clone().lerp(p2, 0.5);
      const beam = mesh(new THREE.BoxGeometry(p1.distanceTo(p2), 0.045, 0.045), MAT.scaff, mid.x, mid.y, mid.z);
      beam.rotation.y = -Math.atan2(p2.z - p1.z, p2.x - p1.x);
      s.add(beam);
    }
  }
  return s;
}
