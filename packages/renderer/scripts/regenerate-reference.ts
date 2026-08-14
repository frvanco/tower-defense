// Regenere une version de reference/cannon-branch-v5.html entierement pilotee
// par @tower-defense/renderer, pour prouver que le portage produit le meme
// rendu que le prototype original. N'ECRASE PAS le prototype original :
// celui-ci reste la reference "ground truth" a comparer. Le fichier produit
// est reference/cannon-branch-v5.generated.html, cote a cote avec l'original.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const entry = path.join(here, '../demo/scene.ts');
const outFile = path.join(repoRoot, 'reference/cannon-branch-v5.generated.html');

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  write: false,
  // 'three' et ses addons restent EXTERNES : ils sont resolus dans le
  // navigateur via le meme import map (unpkg) que le prototype original,
  // meme version epinglee (0.160.0). C'est ce qui garantit que la
  // comparaison visuelle porte uniquement sur notre code, pas sur une
  // version de three differente.
  external: ['three', 'three/addons/*'],
  logLevel: 'info',
});

const bundle = result.outputFiles[0];
if (!bundle) throw new Error('esbuild n\'a produit aucun fichier de sortie');
const js = bundle.text;

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Tower Defense — branche Cannon (regenere depuis @tower-defense/renderer)</title>
<style>
  :root { --bg:#1a1d24; --panel:#22262f; --line:#333945; --text:#e6e8ec; --dim:#8b93a3; --accent:#2f6fb8; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 system-ui,sans-serif; overflow:hidden; }
  #app { position:fixed; inset:0; }
  #hud { position:fixed; top:0; left:0; right:0; padding:12px 16px; display:flex; gap:8px; align-items:center;
         flex-wrap:wrap; background:linear-gradient(var(--bg),transparent); pointer-events:none; }
  #hud > * { pointer-events:auto; }
  button { background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:6px;
           padding:6px 12px; font:inherit; cursor:pointer; }
  button:hover { border-color:#4a5364; }
  button.on { background:var(--accent); border-color:var(--accent); }
  .sep { width:1px; height:24px; background:var(--line); margin:0 4px; }
  #info { position:fixed; left:16px; bottom:16px; background:var(--panel); border:1px solid var(--line);
          border-radius:8px; padding:12px 14px; min-width:260px; }
  #info h2 { margin:0 0 6px; font-size:15px; }
  #info dl { margin:0; display:grid; grid-template-columns:auto 1fr; gap:2px 12px; font-size:13px; }
  #info dt { color:var(--dim); }
  #info dd { margin:0; }
  #hint { position:fixed; right:16px; bottom:16px; color:var(--dim); font-size:12px; text-align:right; }
  #banner { position:fixed; left:16px; top:70px; color:#6ec1ff; font-size:12px; max-width:360px; }
  label { color:var(--dim); font-size:13px; }
  input[type=range] { width:110px; vertical-align:middle; }
</style>
</head>
<body>
<div id="app"></div>
<div id="hud">
  <button id="btn-build">Construire</button>
  <button id="btn-attack">Tirer</button>
  <div class="sep"></div>
  <button id="btn-game" class="on">Vue de jeu</button>
  <button id="btn-close">Vue rapprochée</button>
  <div class="sep"></div>
  <button id="btn-track" class="on">Suivi de cible</button>
  <button id="btn-spin">Rotation libre</button>
  <button id="btn-idle">Figé</button>
  <button id="btn-range">Portée</button>
  <button id="btn-foot" class="on">Emprise</button>
  <button id="btn-wire">Fil de fer</button>
  <div class="sep"></div>
  <label>Durée build</label><input id="dur" type="range" min="0.5" max="5" step="0.5" value="2"><span id="dur-v">2.0s</span>
  <span style="flex:1"></span>
  <label>Équipe</label>
  <input id="team" type="color" value="#c0392b" style="width:38px;height:30px;border:1px solid var(--line);border-radius:6px;background:none;cursor:pointer">
</div>
<div id="banner">Régénéré depuis packages/renderer via scripts/regenerate-reference.ts — geometrie et comportement viennent entierement du package, rien n'est recopie a la main ici.</div>
<div id="info"><h2>—</h2><dl id="stats"></dl></div>
<div id="hint">clic = sélectionner · double-clic = rejouer la construction<br>la cible rouge s'arrête régulièrement : les tourelles gardent leur orientation</div>

<script type="importmap">
{ "imports": {
  "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
  "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
}}
</script>
<script>
addEventListener('error', (e) => {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:auto 16px 16px 16px;z-index:99;background:#4a1f1f;border:1px solid #8a3a3a;border-radius:8px;padding:12px 14px;font:13px/1.5 ui-monospace,monospace;color:#ffd9d9;white-space:pre-wrap';
  box.textContent = 'Erreur JS : ' + (e.message || e.error) + '\\n' + (e.filename || '') + ':' + (e.lineno || '');
  document.body.appendChild(box);
});
</script>
<script type="module">
${js}
</script>
</body>
</html>
`;

writeFileSync(outFile, html, 'utf8');
console.log(`ecrit : ${path.relative(repoRoot, outFile)} (${(html.length / 1024).toFixed(1)} kio)`);
