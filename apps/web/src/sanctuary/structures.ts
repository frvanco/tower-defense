import { Euler, Quaternion, type ColorRepresentation } from 'three';
import type { DecorBatch } from './batch.js';
import type { Point3 } from './types.js';

type Forme = Parameters<DecorBatch['add']>[0];
type Matiere = Parameters<DecorBatch['add']>[1];
type Piece = (forme: Forme, matiere: Matiere, position: Point3,
  echelle: Point3, rotation?: Point3, couleur?: ColorRepresentation) => void;

// Les constructions gardent leur repere local : leur emprise reste previsible.
function placement(batch: DecorBatch, x: number, z: number, yaw: number): Piece {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const pivot = new Quaternion().setFromEuler(new Euler(0, yaw, 0));
  const rotation = new Quaternion();
  const angles = new Euler();
  return (forme, matiere, p, taille, r = [0, 0, 0], couleur) => {
    angles.set(r[0], r[1], r[2]);
    rotation.setFromEuler(angles).premultiply(pivot);
    angles.setFromQuaternion(rotation);
    batch.add(forme, matiere,
      [x + p[0] * c + p[2] * s, p[1], z - p[0] * s + p[2] * c],
      taille, [angles.x, angles.y, angles.z], couleur);
  };
}

function boulons(p: Piece, x: number, y: number, z: number, largeur: number, hauteur: number): void {
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
    p('sphere', 'metal', [x + dx * largeur, y + dy * hauteur, z], [.055, .055, .035]);
  }
}

function plaque(p: Piece, x: number, y: number, z: number, largeur: number, hauteur: number): void {
  p('stone', 'ivory', [x, y, z], [largeur, hauteur, .12]);
  boulons(p, x, y, z - .075, largeur * .36, hauteur * .32);
}

function lierre(p: Piece, x: number, y: number, z: number, longueur: number): void {
  for (let i = 0; i < longueur; i++) {
    const dx = Math.sin(i * 1.9) * .1;
    p('sphere', i % 3 === 0 ? 'moss' : 'leaf', [x + dx, y - i * .22, z],
      [.16 + (i % 2) * .06, .16, .075], [0, 0, i * .6]);
  }
}

function banniere(p: Piece, x: number, y: number, z: number, largeur: number, hauteur: number): void {
  p('cylinder', 'metal', [x, y + .12, z], [.045, largeur + .2, .045], [0, 0, Math.PI / 2]);
  p('box', 'team', [x, y - hauteur * .42, z], [largeur, hauteur * .84, .045]);
  p('cone', 'team', [x, y - hauteur * .92, z], [largeur * .5, hauteur * .25, .035], [0, 0, Math.PI]);
  // Le losange ivoire reste lisible quelle que soit la couleur du joueur.
  p('box', 'ivory', [x, y - hauteur * .43, z - .03], [largeur * .28, largeur * .28, .035], [0, 0, Math.PI / 4]);
  p('box', 'team', [x, y - hauteur * .43, z - .053], [largeur * .14, largeur * .14, .035], [0, 0, Math.PI / 4]);
}

function tour(p: Piece, x: number, z: number): void {
  p('cylinder', 'stone', [x, .23, z], [1.37, .46, 1.37]);
  p('cylinder', 'stone', [x, 2.38, z], [1.1, 4.2, 1.1], undefined, 0xdddccc);
  for (let rangee = 0; rangee < 7; rangee++) {
    for (let cote = 0; cote < 8; cote++) {
      const angle = cote * Math.PI / 4 + (rangee % 2) * Math.PI / 8;
      p('stone', 'stone', [x + Math.sin(angle) * .97, .64 + rangee * .55,
        z + Math.cos(angle) * .97], [.79, .5, .28], [0, angle, 0],
      (rangee + cote) % 5 === 0 ? 0xd3d0b8 : 0xffffff);
    }
  }
  for (const y of [1.12, 4.35]) p('cylinder', 'ivory', [x, y, z], [1.22, .19, 1.22]);
  p('cylinder', 'stone', [x, 4.58, z], [1.32, .36, 1.32]);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    p('stone', 'stone', [x + Math.sin(a) * 1.09, 4.96, z + Math.cos(a) * 1.09],
      [.53, .48, .46], [0, a, 0]);
    p('sphere', 'metal', [x + Math.sin(a) * 1.325, 4.6, z + Math.cos(a) * 1.325], [.05, .055, .05]);
  }
  p('cylinder', 'stone', [x, 5.1, z], [.67, .63, .67]);
  p('cone', 'roof', [x, 5.97, z], [.96, 1.18, .96]);
  p('cylinder', 'ivory', [x, 5.43, z], [.92, .11, .92]);
  p('cylinder', 'metal', [x, 6.8, z], [.035, .72, .035]);
  p('box', 'team', [x + .31, 6.94, z], [.61, .3, .045]);
  banniere(p, x, 4.28, z - 1.245, .63, 1.85);
  plaque(p, x - .38, 1.7, z - 1.075, .53, .68);
  lierre(p, x + .72, 4.55, z - .9, 8);
}

export function addCastle(batch: DecorBatch, x: number, z: number, yaw: number): void {
  const p = placement(batch, x, z, yaw);
  // Un seuil clair relie visuellement la sortie reelle a la herse.
  p('stone', 'stone', [0, .13, .6], [3.14, .26, 1.16]);
  for (const cote of [-1, 1]) {
    p('stone', 'stone', [cote * 3.55, .23, 3.75], [1.15, .46, 3.7]);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 4; i++) {
      p('stone', 'stone', [cote * 3.55, .72 + j * .61, 2.34 + i * .91],
        [1.02, .55, .85], undefined, (i + j) % 4 === 0 ? 0xe0dbc9 : 0xffffff);
    }
    for (let i = 0; i < 5; i++) p('stone', 'stone', [cote * 3.55, 3.92, 2.12 + i * .74], [.99, .65, .45]);
  }
  // Le donjon recule derriere la porte pour conserver une silhouette de chateau.
  p('stone', 'stone', [0, 2.8, 4.25], [4.16, 5.6, 3.1]);
  for (let j = 0; j < 8; j++) for (let i = 0; i < 5; i++) {
    p('stone', 'stone', [-1.65 + i * .82, .39 + j * .68, 2.64], [.77, .62, .18],
      undefined, (i + j * 3) % 7 === 0 ? 0xd1cfb9 : 0xffffff);
  }
  for (const cote of [-1, 1]) {
    p('box', 'metal', [cote * 1.17, 4.37, 2.49], [.37, 1.06, .09]);
    p('stone', 'ivory', [cote * 1.17, 4.96, 2.46], [.65, .17, .22]);
    p('stone', 'stone', [cote * 1.9, 5.83, 4.22], [.45, .36, 3.47]);
  }
  p('stone', 'ivory', [0, 5.66, 4.25], [4.5, .22, 3.48]);
  for (let i = 0; i < 6; i++) {
    p('stone', 'stone', [-1.88 + i * .75, 6.02, 2.67], [.46, .55, .51]);
    p('stone', 'stone', [-1.88 + i * .75, 6.02, 5.82], [.46, .55, .35]);
  }
  p('stone', 'stone', [0, 6.27, 4.35], [2.22, 1.16, 1.83]);
  p('cone', 'roof', [0, 7.02, 4.24], [1.43, 1.18, 1.15], [0, Math.PI / 8, 0]);
  p('cylinder', 'metal', [0, 7.82, 4.35], [.04, 1, .04]);
  p('box', 'team', [.42, 8.12, 4.35], [.83, .4, .045]);

  for (const cote of [-1, 1]) {
    for (let j = 0; j < 4; j++) p('stone', 'stone', [cote * 1.65, .38 + j * .65, .47], [.68, .6, .88]);
  }
  for (let i = 0; i <= 8; i++) {
    const a = i * Math.PI / 8;
    p('stone', 'stone', [Math.cos(a) * 1.5, 2.27 + Math.sin(a) * 1.5, .47],
      [.63, .63, .88], [0, 0, a - Math.PI / 2]);
  }
  // Le fond sombre et les barreaux evoquent une ouverture sans lumiere additionnelle.
  p('box', 'wood', [0, 1.38, .89], [2.43, 2.75, .13], undefined, 0x424743);
  for (let i = 0; i < 9; i++) {
    const bx = -.99 + i * .2475;
    const h = 2.24 + Math.sqrt(Math.max(0, 1.3 ** 2 - bx ** 2));
    p('box', 'metal', [bx, h * .5, .69], [.078, h, .085]);
  }
  for (const y of [.78, 1.61, 2.34]) p('box', 'metal', [0, y, .63], [2.45, .095, .095]);
  p('stone', 'ivory', [0, 4.16, .55], [3.6, .46, 1.04]);
  for (let i = 0; i < 5; i++) p('stone', 'stone', [-1.5 + i * .75, 4.59, .45], [.46, .46, .85]);
  p('stone', 'stone', [0, 4.95, 1.04], [1.49, 1.45, .99]);
  plaque(p, 0, 5.1, .49, 1.31, 1.15);
  p('torus', 'metal', [0, 5.1, .37], [.45, .45, .35]);
  p('sphere', 'energy', [0, 5.1, .32], [.27, .27, .1]);
  for (const cote of [-1, 1]) {
    p('box', 'metal', [cote * .88, 4.08, .195], [.15, .67, .1]);
    p('sphere', 'metal', [cote * .88, 4.05, .125], [.1, .1, .045]);
    tour(p, cote * 2.84, 1.49);
  }
  lierre(p, -1.9, 3.55, .08, 10);
  lierre(p, 1.9, 5.7, 2.45, 5);
}

function robot(p: Piece, x: number, z: number): void {
  for (const dx of [-.29, .29]) for (const dz of [-.25, .25]) {
    p('cylinder', 'metal', [x + dx, .24, z + dz], [.2, .16, .2], [0, 0, Math.PI / 2]);
    p('sphere', 'ivory', [x + dx * 1.25, .24, z + dz], [.07, .1, .1]);
  }
  p('stone', 'ivory', [x, .52, z], [.73, .54, .7]);
  p('stone', 'metal', [x, .85, z - .05], [.5, .29, .48]);
  p('box', 'energy', [x, .87, z - .3], [.22, .085, .035]);
  p('box', 'team', [x, .57, z - .36], [.26, .25, .035]);
  p('cylinder', 'metal', [x + .46, .65, z], [.055, .41, .055], [0, 0, -.8]);
  p('sphere', 'ivory', [x + .6, .8, z], [.13, .13, .13]);
}

export function addWorkshop(batch: DecorBatch, x: number, z: number, yaw: number, variant: number): void {
  const p = placement(batch, x, z, yaw);
  p('stone', 'stone', [-.37, .12, .05], [3.76, .24, 3.44]);
  p('stone', 'stone', [-.43, 1.26, .88], [3.22, 2.5, .54]);
  for (const cote of [-1, 1]) for (let j = 0; j < 5; j++) {
    p('stone', 'stone', [-.4 + cote * 1.48, .4 + j * .53, -.62], [.58, .48, 2.39],
      undefined, j % 3 === 0 ? 0xd8d6bf : 0xffffff);
  }
  p('box', 'wood', [-.4, 1.39, .53], [2.31, 2.36, .13], undefined, 0x69675e);
  p('stone', 'stone', [-.42, 2.85, -.48], [3.64, .42, 2.9]);
  p('box', 'wood', [-.44, 2.51, -1.35], [2.86, .18, .23]);
  for (let i = 0; i < 6; i++) p('box', 'wood', [-1.57 + i * .47, 2.76, -.42], [.13, .14, 2.91]);
  if (variant % 2 === 0) {
    for (const cote of [-1, 1]) p('box', 'roof', [-.42 + cote * .77, 3.32, -.32],
      [1.94, .16, 2.99], [0, 0, -cote * .36]);
    p('stone', 'stone', [-1.53, 3.57, .48], [.57, 1.46, .61]);
    p('stone', 'ivory', [-1.53, 4.34, .48], [.72, .2, .76]);
  } else {
    for (let i = 0; i < 4; i++) p('stone', 'stone', [-1.77 + i * .91, 3.27, .93], [.58, .57, .55]);
    p('box', 'wood', [-.28, 3.15, -.34], [2.8, .12, 1.1]);
    p('stone', 'stone', [-1.6, 3.63, .83], [.68, 1.12, .67]);
  }
  // Echafaudage lateral, pale de levage et etabli de restauration.
  for (const sz of [-1.2, 1.36]) {
    p('cylinder', 'wood', [1.58, 1.97, sz], [.065, 3.93, .065]);
    p('cylinder', 'wood', [.69, 2.17, sz], [.065, 4.32, .065]);
    p('box', 'wood', [1.14, 3.21, sz], [1.3, .14, .16]);
  }
  for (let i = 0; i < 4; i++) p('box', 'wood', [.8 + i * .27, 3.36, .04], [.25, .12, 2.97]);
  p('box', 'wood', [1.57, 1.81, .03], [.1, 3.55, .1], [.62, 0, 0]);
  p('box', 'metal', [1.15, 4.32, .07], [2.26, .19, .19]);
  p('box', 'metal', [2.16, 3.74, .07], [.055, 1.05, .055]);
  p('torus', 'metal', [2.16, 3.13, .07], [.12, .14, .13]);
  plaque(p, -1.91, 1.19, -1.81, .54, .82);
  p('box', 'team', [-.44, 2.36, -1.64], [2.43, .1, .6], [.24, 0, 0]);
  for (const tx of [-1.44, .54]) p('cylinder', 'wood', [tx, 1.1, -1.77], [.055, 2.17, .055]);
  p('box', 'wood', [-.5, .91, -.46], [1.62, .15, .65]);
  for (const tx of [-1.15, .15]) p('box', 'wood', [tx, .48, -.46], [.1, .91, .44]);
  p('stone', 'ivory', [-.77, 1.1, -.46], [.41, .25, .38]);
  p('torus', 'metal', [-.07, 1.11, -.46], [.16, .16, .18], [Math.PI / 2, 0, 0]);
  p('stone', 'wood', [-1.59, .42, -1.5], [.47, .57, .48]);
  robot(p, 1.57, -1.43);
  lierre(p, -1.87, 2.91, -1.59, 9);
  lierre(p, -.73, 2.9, -1.91, 4);
}

function colonne(p: Piece, x: number, z: number, hauteur: number, inclinaison = 0): void {
  p('stone', 'stone', [x, .17, z], [1.09, .34, 1.05]);
  p('stone', 'stone', [x, .41, z], [.85, .18, .8]);
  const troncons = Math.ceil(hauteur / .59);
  for (let i = 0; i < troncons; i++) {
    const h = (hauteur / troncons);
    p('cylinder', 'stone', [x + i * inclinaison, .53 + h * (i + .5), z],
      [.38 - i * .007, h - .045, .38 - i * .007], [0, i % 2 * .12, -inclinaison],
      i % 3 === 0 ? 0xd4d3bb : 0xffffff);
  }
  p('stone', 'stone', [x + (troncons - 1) * inclinaison, hauteur + .65, z], [.93, .27, .84],
    [0, 0, -inclinaison]);
}

export function addRuins(batch: DecorBatch, x: number, z: number, yaw: number, variant: number): void {
  const p = placement(batch, x, z, yaw);
  if (variant % 3 === 0) {
    for (const cote of [-1, 1]) {
      const h = cote === -1 ? 2.6 : 2.03;
      for (let i = 0; i < 5; i++) {
        p('stone', 'stone', [cote * 1.71, .31 + i * .54, 0], [.87, .49, .93],
          undefined, i % 3 === 0 ? 0xd4d1bb : 0xffffff);
      }
      p('stone', 'stone', [cote * 1.71, .14, 0], [1.13, .28, 1.16]);
      for (let i = 0; i < (cote === -1 ? 4 : 2); i++) {
        const a = cote === -1 ? Math.PI - i * .26 : i * .26;
        p('stone', 'stone', [Math.cos(a) * 1.72, h + Math.sin(a) * 1.72, 0],
          [.69, .57, .96], [0, 0, a - Math.PI / 2]);
      }
    }
    p('stone', 'stone', [-1.6, 3.32, .02], [.94, .32, 1.12]);
    lierre(p, -1.63, 3.51, -.55, 11);
    p('stone', 'stone', [.25, .43, .5], [.87, .64, .77], [0, .4, .35]);
    p('stone', 'ivory', [1.72, 1.6, -.5], [.85, .19, .14]);
  } else if (variant % 3 === 1) {
    colonne(p, -1.1, .47, 3.25);
    colonne(p, 1.32, .2, 1.68, .027);
    p('cylinder', 'stone', [.29, .36, -.69], [.35, 1.58, .35], [0, 0, 1.47]);
    p('stone', 'stone', [-1.1, 4.13, .46], [1.28, .4, 1.12]);
    lierre(p, -1.35, 4.3, .03, 13);
    p('stone', 'moss', [-1.15, 4.38, .48], [.92, .1, .77]);
  } else {
    // Fragments d'un visage monumental, taille dans les memes pierres que les murs.
    p('rock', 'stone', [-.15, .39, 0], [1.26, .57, .99], [0, .2, .1]);
    p('stone', 'stone', [0, 1.53, .09], [1.69, 2.04, 1.34], [0, 0, -.13]);
    p('stone', 'stone', [.14, 2.77, .13], [1.66, .62, 1.35], [0, 0, -.13]);
    p('stone', 'stone', [.06, 1.69, -.77], [.42, .88, .55], [0, 0, -.13]);
    for (const cote of [-1, 1]) {
      p('box', 'metal', [cote * .42, 2.18 - cote * .06, -.6], [.36, .14, .055], [0, 0, -.13], 0x858578);
      p('stone', 'stone', [cote * .42, 2.33 - cote * .06, -.66], [.65, .22, .23], [0, 0, -.13]);
    }
    p('box', 'metal', [-.06, 1.14, -.605], [.6, .085, .075], [0, 0, -.13], 0x777a6d);
    p('stone', 'stone', [-.13, .88, -.63], [.82, .38, .3], [0, 0, -.13]);
    p('rock', 'moss', [.06, 3.05, .1], [.86, .18, .73]);
    lierre(p, -.73, 2.88, -.56, 8);
    colonne(p, 2.04, .57, .79);
  }
  for (let i = 0; i < 5; i++) {
    const a = i * 2.38 + variant;
    p('stone', i % 3 === 0 ? 'moss' : 'stone', [Math.sin(a) * 2.36, .17, Math.cos(a) * 1.12],
      [.34 + i % 2 * .17, .3, .36], [0, a, i % 2 * .15]);
  }
}

export function addBridge(batch: DecorBatch, x: number, z: number): void {
  const p = placement(batch, x, z, 0);
  for (const cote of [-1, 1]) {
    for (const rive of [-1, 1]) {
      p('stone', 'stone', [rive * 3.38, .59, cote * .83], [1.1, .88, .49]);
      p('stone', 'stone', [rive * 3.38, 1.51, cote * .87], [.66, .85, .44]);
      p('stone', 'ivory', [rive * 3.38, 1.99, cote * .87], [.76, .19, .44]);
    }
    for (let i = 0; i <= 12; i++) {
      const a = i * Math.PI / 12;
      const angle = Math.atan2(.84 * Math.cos(a), -3.2 * Math.sin(a));
      p('stone', 'stone', [Math.cos(a) * 3.2, .49 + Math.sin(a) * .84, cote * .83],
        [.65, .36, .43], [0, 0, angle]);
    }
    p('box', 'metal', [0, 1.55, cote * .9], [2.05, .34, .18]);
    for (const bx of [-1.02, 1.02]) {
      p('stone', 'ivory', [bx, 1.56, cote * .9], [.44, .45, .26]);
      p('sphere', 'metal', [bx, 1.56, cote * 1.05], [.06, .06, .035]);
    }
    for (const bx of [-2.36, 2.36]) p('stone', 'stone', [bx, 1.68, cote * .9], [1.25, .48, .35]);
  }
  for (let i = 0; i < 11; i++) {
    const bx = -3.5 + i * .7;
    const y = 1.02 + .37 * (1 - (bx / 3.8) ** 2);
    if (Math.abs(bx) < .8) {
      p('box', 'metal', [bx, y, 0], [.66, .17, 1.69]);
      for (const dz of [-.48, 0, .48]) p('box', 'ivory', [bx, y + .1, dz], [.49, .06, .1]);
    } else {
      for (const dz of [-.43, .43]) p('stone', 'stone', [bx, y, dz], [.66, .21, .8],
        undefined, i % 3 === 0 ? 0xd8d5bf : 0xffffff);
    }
  }
  lierre(p, -2.34, 1.85, -1.02, 6);
}
