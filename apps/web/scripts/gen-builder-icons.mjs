/**
 * Genere les vignettes du panneau de choix d'ouvrier (public/icons/builders/).
 *
 *     node apps/web/scripts/gen-builder-icons.mjs
 *
 * DEPANNAGE UNIQUEMENT. Les vignettes livrees sont des visuels dessines, a la
 * meme convention que les icones de tours et de creeps
 * (`<id>_builder_mini.png`). Ce script ne sert qu'a un ouvrier qui arriverait
 * sans visuel, et ne remplace jamais un fichier existant sans `--force`.
 *
 * Des PNG livres, et pas un rendu 3D a l'execution. Charger three.js et plusieurs Mo de .glb pour dessiner deux
 * vignettes de 128px couterait bien plus que de les livrer, et le cout
 * grandirait a chaque ouvrier ajoute.
 *
 * Le script est autonome : il sert lui-meme les .glb et three.js sur un port
 * ephemere (aucun `pnpm dev` requis), pilote un Chrome headless, rend chaque
 * modele avec l'ECLAIRAGE DU JEU (repris de apps/web/src/scene3d.ts) et
 * recupere le canvas en PNG. Fond transparent : la vignette se pose sur le
 * panneau quelle que soit sa couleur.
 *
 * Apres avoir ajoute un ouvrier a apps/web/src/builders.ts, relancer ce
 * script puis commiter le PNG produit.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(here, '../../..');
const outDir = path.join(webRoot, 'public/icons/builders');

/** Rendu carre en 2x, reduit ensuite : l'antialiasing du downscale vaut mieux
 * que le MSAA seul sur des aretes dures. */
const RENDER_SIZE = 256;
const OUT_SIZE = 128;

const MIME = { '.glb': 'model/gltf-binary', '.js': 'text/javascript', '.html': 'text/html; charset=utf-8' };

// Racine reelle du paquet three : resolue par Node plutot que devinee — pnpm
// ne pose qu'un lien dans apps/web/node_modules, le vrai dossier vit dans son
// magasin et son chemin contient la version.
// `three/package.json` n'est pas expose par le champ `exports` du paquet : on
// resout son point d'entree puis on remonte de deux niveaux (build/xxx.cjs).
const require = createRequire(path.join(webRoot, 'package.json'));
const threeRoot = path.resolve(path.dirname(require.resolve('three')), '..');

// --- serveur statique ephemere ---------------------------------------------
const roots = { '/models': path.join(webRoot, 'public/models'), '/three': threeRoot };

/** Page hote : sans import map, GLTFLoader echoue — il importe `three` en
 * specificateur nu, que le navigateur ne sait pas resoudre seul. */
const PAGE = `<!doctype html><meta charset="utf-8">
<script type="importmap">
{"imports": {"three": "/three/build/three.module.js", "three/addons/": "/three/examples/jsm/"}}
<\/script>
<body></body>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    return void res.writeHead(200, { 'content-type': MIME['.html'] }).end(PAGE);
  }
  const prefix = Object.keys(roots).find((p) => url.pathname.startsWith(p + '/'));
  if (!prefix) return void res.writeHead(404).end();
  const file = path.join(roots[prefix], url.pathname.slice(prefix.length));
  // Refuse toute sortie du dossier servi.
  if (!file.startsWith(roots[prefix])) return void res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
// Garde-fou : un chemin faux donnerait un 404 opaque dans la page.
await readFile(path.join(threeRoot, 'build/three.module.js'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// --- Chrome headless --------------------------------------------------------
const PORT = 9333;
const chrome = spawn(
  'google-chrome',
  ['--headless=new', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
   `--remote-debugging-port=${PORT}`, '--window-size=400,400', 'about:blank'],
  { stdio: 'ignore', detached: true },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* pas encore pret */ }
    await sleep(500);
  }
  throw new Error('Chrome headless injoignable — google-chrome est-il installe ?');
}

const ws = new WebSocket(await cdp());
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) =>
  new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'erreur page');
  return r.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.navigate', { url: origin });  // page hote, avec son import map
await sleep(800);

// --- catalogue : lu dans builders.ts, jamais recopie ------------------------
const src = await readFile(path.join(webRoot, 'src/builders.ts'), 'utf8');
const entries = [...src.matchAll(/id:\s*'([^']+)'[\s\S]*?url:\s*'([^']+)'/g)].map((m) => ({ id: m[1], url: m[2] }));
if (entries.length === 0) throw new Error('aucun ouvrier trouve dans builders.ts');
console.log(`${entries.length} ouvrier(s) : ${entries.map((e) => e.id).join(', ')}`);

const results = [];
for (const entry of entries) {
  const png = await evaluate(`(async () => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(${RENDER_SIZE}, ${RENDER_SIZE});
    renderer.setClearAlpha(0);
    const scene = new THREE.Scene();

    // Eclairage repris de createScene3D (apps/web/src/scene3d.ts) pour que la
    // vignette ressemble a ce qu'on voit en jeu.
    scene.add(new THREE.HemisphereLight(0x9eb7c7, 0x2a2619, 1.35));
    scene.add(new THREE.AmbientLight(0x566052, 0.35));
    const key = new THREE.DirectionalLight(0xffe2b8, 2.05);
    key.position.set(-1.2, 2.6, -1.8);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7898bc, 0.65);
    rim.position.set(0.9, 1.1, 1.3);
    scene.add(rim);

    const gltf = await new Promise((res, rej) =>
      new GLTFLoader().load('${origin}${entry.url}', res, undefined, rej));
    const model = gltf.scene;

    // Pose de repos : sans mixer, la hierarchie est en pose de bind et TOUS
    // les accessoires sont deployes (marteau, radio, hologrammes...). On joue
    // donc une image du clip Idle, qui les remet a l'echelle zero — c'est lui
    // qui pilote leur visibilite (voir builderModel.ts).
    const idle = gltf.animations.find((c) => c.name === 'Idle');
    if (idle) {
      const mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(idle).play();
      mixer.update(0.001);
    }
    model.updateMatrixWorld(true);
    scene.add(model);

    // Cadrage sur la boite reelle APRES la pose de repos.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    const radius = Math.max(size.x, size.y, size.z) * 0.5;
    const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.12;
    // Trois quarts face, legerement en plongee : la silhouette se lit mieux
    // que de face, et on voit le dos de l'equipement (jetpack, reacteurs).
    camera.position.set(center.x + dist * 0.42, center.y + dist * 0.30, center.z + dist * 0.86);
    camera.lookAt(center);
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);

    // Reduction en ${OUT_SIZE}px (la taille des icones de tours) par un second
    // canvas : le filtrage du downscale lisse les aretes bien mieux que le
    // MSAA seul a la taille finale. Fait ici pour que le script produise
    // directement le fichier a livrer, sans etape manuelle derriere.
    const out = document.createElement('canvas');
    out.width = out.height = ${OUT_SIZE};
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(renderer.domElement, 0, 0, ${OUT_SIZE}, ${OUT_SIZE});
    const url = out.toDataURL('image/png');
    renderer.dispose();
    return url;
  })()`);
  results.push({ id: entry.id, png });
  console.log(`  rendu : ${entry.id}`);
}

ws.close();
try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* deja mort */ }
server.close();

// --- ecriture ---------------------------------------------------------------
const { mkdir, writeFile } = await import('node:fs/promises');
await mkdir(outDir, { recursive: true });
const force = process.argv.includes('--force');
for (const { id, png } of results) {
  const file = path.join(outDir, `${id}_builder_mini.png`);
  // Les vignettes livrees sont des visuels DESSINES : ce script ne sert qu'a
  // depanner un ouvrier qui arriverait sans. Il ne remplace donc jamais un
  // fichier existant sans --force explicite.
  if (!force && existsSync(file)) {
    console.log(`  conserve : ${path.relative(repoRoot, file)} (deja present, --force pour remplacer)`);
    continue;
  }
  await writeFile(file, Buffer.from(png.split(',')[1], 'base64'));
  console.log(`  ecrit : ${path.relative(repoRoot, file)}`);
}
console.log(`\nTermine : ${OUT_SIZE}x${OUT_SIZE}px, fond transparent, prets a commiter.`);
