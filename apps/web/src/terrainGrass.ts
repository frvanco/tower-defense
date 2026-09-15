import * as THREE from 'three';

/** Texture partagee entre plateaux, peinte seulement a la creation de la scene. */
export function createPlatformGrassTexture(): THREE.CanvasTexture {
  const taille = 512;
  const toile = document.createElement('canvas');
  toile.width = toile.height = taille;
  const contexte = toile.getContext('2d')!;
  let graine = 0x6a55cafe;
  const aleatoire = (): number => {
    graine = (Math.imul(graine, 1664525) + 1013904223) | 0;
    return (graine >>> 0) / 0x100000000;
  };

  // Des grilles periodiques evitent les bandes sinusoidales et les coutures
  // du carrelage. Les petites echelles s'effacent naturellement dans les mipmaps.
  const bruit = (dimension: number) => {
    const valeurs = Float32Array.from({ length: dimension * dimension }, aleatoire);
    return (u: number, v: number): number => {
      const x = u * dimension;
      const y = v * dimension;
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const a = valeurs[(iy % dimension) * dimension + ix % dimension]!;
      const b = valeurs[(iy % dimension) * dimension + (ix + 1) % dimension]!;
      const c = valeurs[((iy + 1) % dimension) * dimension + ix % dimension]!;
      const d = valeurs[((iy + 1) % dimension) * dimension + (ix + 1) % dimension]!;
      return a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sy - 0.5;
    };
  };
  const grandesPlaques = bruit(4);
  const bouquets = bruit(18);
  const petitesMottes = bruit(64);
  const teinte = bruit(7);
  const pixels = contexte.createImageData(taille, taille);
  for (let y = 0; y < taille; y++) for (let x = 0; x < taille; x++) {
    const u = x / taille;
    const v = y / taille;
    const nuance = grandesPlaques(u, v) * 26 + bouquets(u, v) * 18 + petitesMottes(u, v) * 7;
    const chaleur = teinte(u, v) * 10;
    const index = (y * taille + x) * 4;
    pixels.data[index] = 105 + nuance + chaleur;
    pixels.data[index + 1] = 146 + nuance;
    pixels.data[index + 2] = 54 + nuance * 0.48 - chaleur * 0.3;
    pixels.data[index + 3] = 255;
  }
  contexte.putImageData(pixels, 0, 0);

  // Petites feuilles peintes, jamais de brins 3D : ni appels de dessin,
  // ni ombres, ni animation supplementaires sur les surfaces constructibles.
  for (let i = 0; i < 1150; i++) {
    const x = aleatoire() * taille;
    const y = aleatoire() * taille;
    const longueur = 3 + aleatoire() * 5;
    const angle = aleatoire() * Math.PI * 2;
    const clair = aleatoire() > 0.38;
    // Recopie aux bords pour que les touffes restent entieres entre deux tuiles.
    const offsetsX = x < 10 ? [0, taille] : x > taille - 10 ? [0, -taille] : [0];
    const offsetsY = y < 10 ? [0, taille] : y > taille - 10 ? [0, -taille] : [0];
    for (const dx of offsetsX) for (const dy of offsetsY) {
      contexte.save();
      contexte.translate(x + dx, y + dy);
      contexte.rotate(angle);
      contexte.fillStyle = clair ? 'rgba(180,193,97,0.27)' : 'rgba(53,85,32,0.25)';
      for (const sens of [-1, 0, 1]) {
        contexte.beginPath();
        contexte.moveTo(sens * 0.6, 1);
        contexte.quadraticCurveTo(sens * 3.2 - 1, -longueur * 0.4, sens * 2.7, -longueur * (sens === 0 ? 1 : 0.7));
        contexte.quadraticCurveTo(sens * 2 + 1.4, -longueur * 0.3, sens * 0.6 + 1, 1);
        contexte.fill();
      }
      contexte.restore();
    }
  }

  const texture = new THREE.CanvasTexture(toile);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  // Le filtrage existant suffit : une seule lecture de map dans le materiau
  // Lambert, sans normal map et sans anisotropie supplementaire.
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}
