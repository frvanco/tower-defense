import * as THREE from 'three';
import { createGame, tick, Bot, TICK_RATE, type Command, type GameState, type SimEvent } from '@tower-defense/sim';
import { buildableTowers, lanes, towers, rules } from '@tower-defense/data';
import { MAX_RADIUS } from '@tower-defense/renderer';
import { createScene3D, resizeScene3D, type Scene3D } from './scene3d.js';
import { computeFrame, worldToScene, isInBuildZone, type Frame3D } from './world3d.js';
import { pickGroundWorld, pickTowerEid } from './pick3d.js';
import { TowerEntities, CreepEntities } from './entities3d.js';
import { laneColor } from './colors.js';
import {
  buildBuildPanel,
  updateBuildPanel,
  buildShopPanel,
  updateShopPanel,
  buildArenasPanel,
  updateArenasPanel,
  updateSelectedPanel,
  updateTopbar,
  type TopbarRefs,
  type SelectedRefs,
} from './hud.js';
import { initToasts, toast } from './toast.js';

const MAX_BOTS = rules.maxPlayers - 1;
const STEP_MS = 1000 / TICK_RATE;
// A backgrounded/stalled tab can accumulate a huge dt on refocus; cap how many
// ticks one frame will catch up on so the game skips forward instead of freezing
// the UI while it replays minutes of simulation.
const MAX_STEPS_PER_FRAME = 8;

/** Couleur d'equipe du joueur humain — memes conventions que le prototype
 * (reference/cannon-branch-v5.html) et sa demo portee (packages/renderer/demo). */
const TEAM_COLOR = 0xc0392b;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

// A plain `if (!v) throw` guard doesn't narrow `v` inside functions declared
// later (closures see the pre-guard nullable type) — same pitfall as
// `must2dContext` in the old 2D version. Returning the checked value from its
// own function sidesteps it.
function must<T>(v: T | undefined, message: string): T {
  if (v === undefined) throw new Error(message);
  return v;
}

function newGame(seedBase: number, botCount: number): { state: GameState; bots: Bot[] } {
  const state = createGame(seedBase, botCount + 1);
  const bots = state.arenas
    .filter((a) => a.player !== 0)
    .map(
      (a) =>
        new Bot({
          player: a.player,
          aggression: 0.2 + (a.player % 4) * 0.2,
          preferredRoot: buildableTowers[a.player % buildableTowers.length]!,
          seed: seedBase + a.player * 7919,
        }),
    );
  return { state, bots };
}

const lane0 = must(lanes[0], 'lane 0 introuvable dans @tower-defense/data');
const frame: Frame3D = computeFrame(lane0);

const laneColorByPlayer = new Map(lanes.map((l) => [l.player, laneColor(l.color)]));

const canvasWrap = byId<HTMLDivElement>('canvas-wrap');
const canvas = byId<HTMLCanvasElement>('game-canvas');
const s3d: Scene3D = createScene3D(canvas, lane0, frame);

const towerEntities = new TowerEntities(s3d.towerLayer, frame, TEAM_COLOR);
const creepEntities = new CreepEntities(s3d.creepLayer, frame, laneColorByPlayer);

// Fantome de placement : suit le pointeur pendant qu'une tour est armee.
// Vert = dans la zone constructible, rouge = hors zone. Taille = MAX_RADIUS
// (packages/renderer/src/footprint.ts) pour que le joueur voie l'emprise
// reelle avant de poser.
const ghost = new THREE.Mesh(
  new THREE.CircleGeometry(MAX_RADIUS, 24),
  new THREE.MeshBasicMaterial({ color: 0x4a9e5c, transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
);
ghost.rotation.x = -Math.PI / 2;
ghost.visible = false;
s3d.scene.add(ghost);

const topbarRefs: TopbarRefs = {
  gold: byId('stat-gold'),
  income: byId('stat-income'),
  lives: byId('stat-lives'),
  round: byId('stat-round'),
  countdown: byId('stat-countdown'),
};

const buildList = byId<HTMLDivElement>('build-list');
const shopList = byId<HTMLDivElement>('shop-list');
const arenasList = byId<HTMLDivElement>('arenas-list');
initToasts(byId('toasts'));

const selectedRefs: SelectedRefs = {
  section: byId('panel-selected'),
  name: byId('selected-name'),
  info: byId('selected-info'),
  upgradeBtn: byId('upgrade-btn'),
  sellBtn: byId('sell-btn'),
};

const gameOverEl = byId<HTMLDivElement>('game-over');
const gameOverTitle = byId('game-over-title');
const gameOverDetail = byId('game-over-detail');
const restartBtn = byId<HTMLButtonElement>('restart-btn');

const botCountSelect = byId<HTMLSelectElement>('bot-count');

let selectedTowerEid: number | null = null;
let hoveredTowerEid: number | null = null;
let armedBuildDefId: string | null = null;
let mouseWorld: [number, number] | null = null;

const pendingHuman: Command[] = [];
let botCount = Math.min(MAX_BOTS, Math.max(1, Number(botCountSelect.value)));
let { state, bots } = newGame(Date.now() | 0, botCount);
let speed = 1;

const buildButtons = buildBuildPanel(buildList, (defId) => {
  armedBuildDefId = armedBuildDefId === defId ? null : defId;
  selectedTowerEid = null;
});

const shopRows = buildShopPanel(shopList, (defId) => {
  pendingHuman.push({ type: 'sendCreep', player: 0, defId });
});

let arenaRows = buildArenasPanel(arenasList, botCount + 1);

function startNewGame(): void {
  const next = newGame(Date.now() | 0, botCount);
  state = next.state;
  bots = next.bots;
  pendingHuman.length = 0;
  selectedTowerEid = null;
  armedBuildDefId = null;
  gameOverEl.hidden = true;
  towerEntities.clear();
  creepEntities.clear();
  arenasList.innerHTML = '';
  arenaRows = buildArenasPanel(arenasList, botCount + 1);
}

botCountSelect.addEventListener('change', () => {
  botCount = Math.min(MAX_BOTS, Math.max(1, Number(botCountSelect.value)));
  startNewGame();
});

selectedRefs.upgradeBtn.addEventListener('click', () => {
  const arena = state.arenas[0];
  const eid = selectedTowerEid;
  if (!arena || eid === null) return;
  const t = arena.towers.find((x) => x.eid === eid);
  const nextId = t && towers.get(t.defId)?.upgradesTo[0];
  if (!nextId) return;
  pendingHuman.push({ type: 'upgradeTower', player: 0, eid, defId: nextId });
});

selectedRefs.sellBtn.addEventListener('click', () => {
  const eid = selectedTowerEid;
  if (eid === null) return;
  pendingHuman.push({ type: 'sellTower', player: 0, eid });
  selectedTowerEid = null;
});

restartBtn.addEventListener('click', startNewGame);

const speedButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.speed-btn'));
for (const btn of speedButtons) {
  btn.addEventListener('click', () => {
    speed = Number(btn.dataset.speed ?? '1');
    for (const b of speedButtons) b.classList.toggle('active', b === btn);
  });
}

function eventToNdc(ev: MouseEvent): [number, number] {
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  return [x, y];
}

canvas.addEventListener('mousemove', (ev) => {
  const [ndcX, ndcY] = eventToNdc(ev);
  mouseWorld = pickGroundWorld(s3d, frame, ndcX, ndcY);
  hoveredTowerEid = pickTowerEid(s3d, ndcX, ndcY);
});

canvas.addEventListener('mouseleave', () => {
  mouseWorld = null;
  hoveredTowerEid = null;
});

canvas.addEventListener('click', (ev) => {
  const [ndcX, ndcY] = eventToNdc(ev);

  if (armedBuildDefId) {
    const world = pickGroundWorld(s3d, frame, ndcX, ndcY);
    if (!world) return;
    const [wx, wy] = world;
    if (!isInBuildZone(lane0, wx, wy)) {
      toast('Outside the build zone', 'warn');
      return;
    }
    pendingHuman.push({ type: 'buildTower', player: 0, defId: armedBuildDefId, x: wx, y: wy });
    armedBuildDefId = null;
    return;
  }

  selectedTowerEid = pickTowerEid(s3d, ndcX, ndcY);
});

canvas.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  armedBuildDefId = null;
  selectedTowerEid = null;
});

window.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  armedBuildDefId = null;
  selectedTowerEid = null;
});

function resize(): void {
  const rect = canvasWrap.getBoundingClientRect();
  resizeScene3D(s3d, rect.width, rect.height);
}
window.addEventListener('resize', resize);
resize();

function handleEvents(events: SimEvent[]): void {
  for (const ev of events) {
    if (ev.type === 'rejected' && ev.player === 0) {
      toast(ev.reason, 'warn');
    } else if (ev.type === 'defeat' && ev.player === 0) {
      toast('You have been eliminated', 'danger');
    } else if (ev.type === 'gameOver') {
      const you = ev.winner === 0;
      gameOverTitle.textContent =
        ev.winner === null ? 'Game over' : you ? 'Victory!' : `Player ${ev.winner} wins`;
      gameOverDetail.textContent =
        ev.winner === null ? 'No one survived.' : you ? 'You outlasted everyone.' : 'Better luck next time.';
      gameOverEl.hidden = false;
    }
  }
}

let acc = 0;
let last = performance.now();

function frame3d(now: number): void {
  const rawDt = Math.min(now - last, 250);
  last = now;
  acc += rawDt * speed;

  let steps = 0;
  let firstIter = true;
  while (acc >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
    const cmds: Command[] = firstIter ? pendingHuman.splice(0) : [];
    firstIter = false;
    for (const b of bots) cmds.push(...b.decide(state));
    handleEvents(tick(state, cmds));
    acc -= STEP_MS;
    steps += 1;
  }
  if (steps === MAX_STEPS_PER_FRAME) acc = 0;

  // Les animations (construction, visee) tournent en temps reel MULTIPLIE par
  // la vitesse de simulation choisie : a 4x, la partie va 4x plus vite, donc
  // une tour ne doit pas rester 2 secondes pleines en chantier pendant que 4x
  // plus de ticks s'écoulent derriere — sinon elle pourrait deja etre revendue
  // avant la fin de sa propre animation de construction.
  const animDt = (rawDt / 1000) * speed;

  const arena0 = state.arenas[0];
  if (arena0) {
    towerEntities.sync(arena0);
    creepEntities.sync(arena0);
    towerEntities.update(arena0, animDt, selectedTowerEid, hoveredTowerEid);

    updateTopbar(topbarRefs, state);
    updateBuildPanel(buildButtons, arena0, armedBuildDefId);
    updateShopPanel(shopRows, state, arena0);
    updateSelectedPanel(selectedRefs, arena0, selectedTowerEid);
  }
  updateArenasPanel(arenaRows, state);

  if (armedBuildDefId && mouseWorld) {
    const inside = isInBuildZone(lane0, mouseWorld[0], mouseWorld[1]);
    const [gx, gz] = worldToScene(frame, mouseWorld[0], mouseWorld[1]);
    ghost.position.set(gx, 0.03, gz);
    (ghost.material as THREE.MeshBasicMaterial).color.set(inside ? 0x4a9e5c : 0xd0503c);
    ghost.visible = true;
  } else {
    ghost.visible = false;
  }

  s3d.controls.update();
  s3d.renderer.render(s3d.scene, s3d.camera);

  requestAnimationFrame(frame3d);
}
requestAnimationFrame(frame3d);
