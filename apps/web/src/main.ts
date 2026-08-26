import * as THREE from 'three';
import {
  createGame,
  tick,
  Bot,
  TICK_RATE,
  type Command,
  type Difficulty,
  type GameState,
  type SimEvent,
} from '@tower-defense/sim';
import { lanes, towers, rules, nearestSlot } from '@tower-defense/data';
import { MAX_RADIUS } from '@tower-defense/renderer';
import { createScene3D, resizeScene3D, disposeScene3D, type Scene3D } from './scene3d.js';
import { computeFrame, worldToScene, type Frame3D } from './world3d.js';
import { pickGroundWorld, pickTowerEid } from './pick3d.js';
import { TowerEntities, CreepEntities } from './entities3d.js';
import { LightningArcs } from './lightningEffects.js';
import { createSlotMarkers } from './slots3d.js';
import { PLATFORM_HEIGHT } from './terrain3d.js';
import { laneColor, playerColor, toHexNumber } from './colors.js';
import { buildArenaBar, updateArenaBar, stepLivingPlayer, type ArenaBarRefs } from './arenaBar.js';
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
import { DIFFICULTY_LABELS } from './difficulty.js';
import { PerfMonitor, isPerfEnabled } from './perfMonitor.js';

const STEP_MS = 1000 / TICK_RATE;
// A backgrounded/stalled tab can accumulate a huge dt on refocus; cap how many
// ticks one frame will catch up on so the game skips forward instead of freezing
// the UI while it replays minutes of simulation.
const MAX_STEPS_PER_FRAME = 8;

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

/** Surcharge de dev optionnelle (?seed=N dans l'URL) pour rejouer exactement
 * la meme partie d'un lancement a l'autre — utile pour comparer des mesures
 * de perf avant/apres sur un scenario strictement identique. Sans ce
 * parametre, comportement inchange (Date.now() | 0, une partie differente a
 * chaque lancement). */
function seedOverride(): number | null {
  if (typeof location === 'undefined') return null;
  const raw = new URLSearchParams(location.search).get('seed');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n | 0 : null;
}

function newGame(seedBase: number, difficulty: Difficulty): { state: GameState; bots: Bot[] } {
  const state = createGame(seedBase, rules.maxPlayers);
  const bots = state.arenas
    .filter((a) => a.player !== 0)
    .map(
      (a) =>
        // aggression/personality ne sont pas fournis : le bot les tire de
        // son propre RNG (personnalite), independamment du niveau choisi ici.
        new Bot({
          player: a.player,
          seed: seedBase + a.player * 7919,
          difficulty,
        }),
    );
  return { state, bots };
}

export interface GameCallbacks {
  /** Appele a chaque fin de partie (victoire, defaite ou match nul). */
  onGameOver: () => void;
  /** Appele au clic sur "Retour a l'accueil" dans l'ecran de fin de partie —
   * le launcher decide de l'arret effectif (voir la fonction retournee). */
  onExitToMenu: () => void;
}

/** Lance une partie locale contre bots dans le markup #app existant.
 * Retourne une fonction d'arret qui annule la boucle de rendu, les listeners
 * globaux et libere la scene 3D (voir disposeScene3D) — a appeler avant tout
 * nouvel appel a startGame() sur le meme canvas. Appele au clic sur "Jouer"
 * par le launcher — voir launcher.ts. */
export function startGame(callbacks: GameCallbacks, difficulty: Difficulty): () => void {
  // canvas et boutons (build/shop/HUD/game-over) sont le markup statique de
  // #app, jamais recree entre deux appels de startGame() — sans un moyen de
  // retirer PRECISEMENT les listeners de CETTE partie, rejouer empilerait un
  // nouveau jeu de listeners par-dessus l'ancien a chaque cycle (fuite, et
  // les listeners perimes reagiraient encore avec un state deja disparu).
  // Un seul controller pour tout, aboli d'un coup dans la fonction d'arret.
  const controller = new AbortController();
  const listenerOpts = { signal: controller.signal };

  const lane0 = must(lanes[0], 'lane 0 introuvable dans @tower-defense/data');
  // Une seule arene sert a construire le decor (terrain/lumieres/camera) :
  // les 8 sont geometriquement identiques (meme couloir, memes emplacements),
  // seule leur position monde BRUTE differe — computeFrame() de CHAQUE lane
  // recentre deja sa propre boite englobante sur l'origine de la scene (voir
  // world3d.ts), donc convertir les entites d'une autre arene ne demande que
  // de changer QUEL frame on utilise, jamais de reconstruire le decor.
  const frames: Frame3D[] = lanes.map((l) => computeFrame(l));
  const frame: Frame3D = must(frames[0], 'frame 0 introuvable');

  const laneColorByPlayer = new Map(lanes.map((l) => [l.player, laneColor(l.color)]));

  const canvasWrap = byId<HTMLDivElement>('canvas-wrap');
  const canvas = byId<HTMLCanvasElement>('game-canvas');
  const s3d: Scene3D = createScene3D(canvas, lane0, frame);

  // Instrumentation perf, opt-in via ?perf=1 — jamais active par defaut (voir
  // perfMonitor.ts). Expose window.__perf.getReport() pour recuperer le
  // rapport (JSON serialisable) depuis l'exterieur (console, Playwright...).
  const perf: PerfMonitor | null = isPerfEnabled() ? new PerfMonitor(s3d) : null;
  if (perf) (window as unknown as Record<string, unknown>).__perf = perf;

  // Une instance TowerEntities/CreepEntities PAR JOUEUR (jusqu'a 8, la borne
  // haute du selecteur de bots), chacune avec son propre sous-Group toujours
  // synchronisee — meme quand elle n'est pas affichee. C'est ce qui garantit
  // qu'aucune geometrie ne se cree/detruit AU MOMENT de basculer d'arene :
  // les meshes apparaissent/disparaissent au fil du jeu (un bot construit,
  // un creep meurt), etalés dans le temps plutot qu'en rafale au clic.
  // Basculer = inverser deux `.visible`, cout nul. Pas un pool a taille fixe
  // avec reaffectation de slots (voir le commit de cablage du rendu) : pour
  // les tours, changer de "type" change la geometrie procedurale elle-meme
  // (packages/renderer/src/towers/types.ts), un pool n'aurait rien economise
  // de plus que ces N jeux d'entites permanents.
  const towerGroups: THREE.Group[] = [];
  const creepGroups: THREE.Group[] = [];
  const towerEntitiesByPlayer: TowerEntities[] = [];
  const creepEntitiesByPlayer: CreepEntities[] = [];
  for (let p = 0; p < frames.length; p++) {
    const pFrame = frames[p]!;
    const towerGroup = new THREE.Group();
    towerGroup.visible = p === 0;
    s3d.towerLayer.add(towerGroup);
    towerGroups.push(towerGroup);
    towerEntitiesByPlayer.push(new TowerEntities(towerGroup, pFrame, toHexNumber(playerColor(p))));

    const creepGroup = new THREE.Group();
    creepGroup.visible = p === 0;
    s3d.creepLayer.add(creepGroup);
    creepGroups.push(creepGroup);
    creepEntitiesByPlayer.push(new CreepEntities(creepGroup, pFrame, laneColorByPlayer));
  }

  const lightningArcs = new LightningArcs();
  s3d.scene.add(lightningArcs.group);

  const slotMarkers = createSlotMarkers(frame);
  s3d.scene.add(slotMarkers.group);

  // Fantome de placement : positionne exactement sur l'emplacement survole
  // (jamais sur la position brute du curseur) pendant qu'une tour est armee.
  // Vert = libre, rouge = deja occupe. Taille = MAX_RADIUS
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
    elapsed: byId('stat-elapsed'),
  };

  // Ces conteneurs sont le markup statique de #app, reutilise a chaque appel
  // de startGame() (retour au menu puis Jouer a nouveau) : on repart d'un DOM
  // vide plutot que d'empiler les rangees du build/shop/arenas de la partie
  // precedente par-dessus les nouvelles.
  const buildList = byId<HTMLDivElement>('build-list');
  buildList.innerHTML = '';
  const shopList = byId<HTMLDivElement>('shop-list');
  shopList.innerHTML = '';
  const arenasList = byId<HTMLDivElement>('arenas-list');
  arenasList.innerHTML = '';
  const toastsEl = byId('toasts');
  toastsEl.innerHTML = '';
  initToasts(toastsEl);

  const selectedRefs: SelectedRefs = {
    section: byId('panel-selected'),
    name: byId('selected-name'),
    info: byId('selected-info'),
    upgradeBtn: byId('upgrade-btn'),
    sellBtn: byId('sell-btn'),
  };

  const gameOverEl = byId<HTMLDivElement>('game-over');
  gameOverEl.hidden = true;
  const gameOverTitle = byId('game-over-title');
  const gameOverDetail = byId('game-over-detail');
  const restartBtn = byId<HTMLButtonElement>('restart-btn');
  const exitToMenuBtn = byId<HTMLButtonElement>('exit-to-menu-btn');

  // Niveau choisi dans le launcher avant l'appel a startGame() (voir le
  // panneau de difficulte) — fixe pour toute la session de jeu, y compris
  // "Rejouer" (startNewGame() plus bas la reutilise sans jamais la
  // reassigner). Libelle statique dans la topbar, jamais recalcule par
  // frame : il ne change pas en cours de partie.
  byId('stat-difficulty').textContent = DIFFICULTY_LABELS[difficulty];

  let selectedTowerEid: number | null = null;
  let hoveredTowerEid: number | null = null;
  let armedBuildDefId: string | null = null;
  let mouseWorld: [number, number] | null = null;

  const pendingHuman: Command[] = [];
  let { state, bots } = newGame(seedOverride() ?? (Date.now() | 0), difficulty);
  let speed = 1;

  const buildButtons = buildBuildPanel(buildList, (defId) => {
    if (isObserving()) return;
    armedBuildDefId = armedBuildDefId === defId ? null : defId;
    selectedTowerEid = null;
  });

  const shopRows = buildShopPanel(shopList, (defId) => {
    if (isObserving()) return;
    pendingHuman.push({ type: 'sendCreep', player: 0, defId });
  });

  let arenaRows = buildArenasPanel(arenasList, rules.maxPlayers);

  // Barre d'arenes : navigation entre les 6+ arenes (observation seule, voir
  // setViewedPlayer plus bas — le joueur humain est toujours le player 0).
  const arenaPillsEl = byId<HTMLDivElement>('arena-pills');
  const arenaPrevBtn = byId<HTMLButtonElement>('arena-prev');
  const arenaNextBtn = byId<HTMLButtonElement>('arena-next');
  const sidebarEl = byId<HTMLElement>('sidebar');
  const backToOwnArenaBtn = byId<HTMLButtonElement>('back-to-own-arena-btn');
  let viewedPlayer = 0;

  /** true des qu'on regarde une arene qui n'est pas la sienne : aucune action
   * n'est possible dans cet etat (ni construire, ni ameliorer, ni vendre, ni
   * envoyer — voir les gardes sur les handlers de clic plus bas). */
  function isObserving(): boolean {
    return viewedPlayer !== 0;
  }

  function setViewedPlayer(player: number): void {
    // Meme si player === viewedPlayer (ex. reclique sur la sienne), on repasse
    // par la remise a plat ci-dessous : inoffensif et evite un etat "arme"
    // fantome si jamais un appel externe changeait ces refs entre-temps.
    towerGroups[viewedPlayer]!.visible = false;
    creepGroups[viewedPlayer]!.visible = false;
    viewedPlayer = player;
    towerGroups[viewedPlayer]!.visible = true;
    creepGroups[viewedPlayer]!.visible = true;

    // Rien ne doit rester arme/selectionne en changeant de vue — que ce soit
    // en partant observer (fantome de pose fantome sur la mauvaise arene) ou
    // en revenant (selection perimee d'avant le depart).
    armedBuildDefId = null;
    selectedTowerEid = null;
    mouseWorld = null;
    hoveredTowerEid = null;

    const observing = isObserving();
    sidebarEl.classList.toggle('observing', observing);
    backToOwnArenaBtn.hidden = !observing;
    canvasWrap.classList.toggle('observing', observing);
    canvasWrap.style.setProperty('--observed-color', playerColor(viewedPlayer));
  }

  let arenaBarRefs = buildArenaBar(arenaPillsEl, rules.maxPlayers, setViewedPlayer);

  // Toujours actif meme si sa propre arene est eliminee (contrairement aux
  // pastilles/fleches, qui sautent les elimines) : c'est un raccourci dedie
  // "revenir chez moi", pas une navigation dans la liste des vivants.
  backToOwnArenaBtn.addEventListener('click', () => setViewedPlayer(0), listenerOpts);

  arenaPrevBtn.addEventListener(
    'click',
    () => {
      const next = stepLivingPlayer(state, viewedPlayer, -1);
      if (next !== null) setViewedPlayer(next);
    },
    listenerOpts,
  );
  arenaNextBtn.addEventListener(
    'click',
    () => {
      const next = stepLivingPlayer(state, viewedPlayer, 1);
      if (next !== null) setViewedPlayer(next);
    },
    listenerOpts,
  );

  // main.ts est le seul module qui sait si une partie est en cours — c'est
  // donc lui, et non le launcher, qui possede la garde de fermeture
  // accidentelle. Idempotentes : armer deux fois de suite ne pose qu'un seul
  // handler.
  let exitGuardHandler: ((ev: BeforeUnloadEvent) => void) | null = null;
  function armExitGuard(): void {
    if (exitGuardHandler) return;
    exitGuardHandler = (ev) => {
      ev.preventDefault();
    };
    window.addEventListener('beforeunload', exitGuardHandler, listenerOpts);
  }
  function disarmExitGuard(): void {
    if (!exitGuardHandler) return;
    window.removeEventListener('beforeunload', exitGuardHandler);
    exitGuardHandler = null;
  }
  armExitGuard();

  function startNewGame(): void {
    // difficulty ne change jamais en cours de session (plus de selecteur
    // dans le HUD, voir le panneau du launcher) : "Rejouer" relance
    // implicitement au meme niveau, rien a repasser ici.
    const next = newGame(seedOverride() ?? (Date.now() | 0), difficulty);
    state = next.state;
    bots = next.bots;
    pendingHuman.length = 0;
    selectedTowerEid = null;
    armedBuildDefId = null;
    gameOverEl.hidden = true;
    for (const te of towerEntitiesByPlayer) te.clear();
    for (const ce of creepEntitiesByPlayer) ce.clear();
    lightningArcs.clear();
    arenasList.innerHTML = '';
    arenaRows = buildArenasPanel(arenasList, rules.maxPlayers);
    // Revient toujours a sa propre arene au lancement d'une nouvelle partie.
    for (const g of towerGroups) g.visible = false;
    for (const g of creepGroups) g.visible = false;
    viewedPlayer = 0;
    towerGroups[0]!.visible = true;
    creepGroups[0]!.visible = true;
    arenaBarRefs = buildArenaBar(arenaPillsEl, rules.maxPlayers, setViewedPlayer);
    // "Rejouer" relance une partie sans repasser par le launcher : sans ce
    // rearm, une partie relancee apres une premiere fin de partie perdrait la
    // confirmation de fermeture accidentelle.
    armExitGuard();
  }

  selectedRefs.upgradeBtn.addEventListener(
    'click',
    () => {
      if (isObserving()) return;
      const arena = state.arenas[0];
      const eid = selectedTowerEid;
      if (!arena || eid === null) return;
      const t = arena.towers.find((x) => x.eid === eid);
      const nextId = t && towers.get(t.defId)?.upgradesTo[0];
      if (!nextId) return;
      pendingHuman.push({ type: 'upgradeTower', player: 0, eid, defId: nextId });
    },
    listenerOpts,
  );

  selectedRefs.sellBtn.addEventListener(
    'click',
    () => {
      if (isObserving()) return;
      const eid = selectedTowerEid;
      if (eid === null) return;
      pendingHuman.push({ type: 'sellTower', player: 0, eid });
      selectedTowerEid = null;
    },
    listenerOpts,
  );

  restartBtn.addEventListener('click', startNewGame, listenerOpts);
  exitToMenuBtn.addEventListener('click', () => callbacks.onExitToMenu(), listenerOpts);

  const speedButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.speed-btn'));
  for (const btn of speedButtons) {
    btn.addEventListener(
      'click',
      () => {
        speed = Number(btn.dataset.speed ?? '1');
        for (const b of speedButtons) b.classList.toggle('active', b === btn);
      },
      listenerOpts,
    );
  }

  function eventToNdc(ev: MouseEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    return [x, y];
  }

  canvas.addEventListener(
    'mousemove',
    (ev) => {
      const [ndcX, ndcY] = eventToNdc(ev);
      mouseWorld = pickGroundWorld(s3d, frame, ndcX, ndcY);
      hoveredTowerEid = pickTowerEid(s3d, towerGroups[viewedPlayer]!, ndcX, ndcY);
    },
    listenerOpts,
  );

  canvas.addEventListener(
    'mouseleave',
    () => {
      mouseWorld = null;
      hoveredTowerEid = null;
    },
    listenerOpts,
  );

  canvas.addEventListener(
    'click',
    (ev) => {
      // Aucune action possible en observation : ni construire, ni
      // selectionner une tour (qui ouvrirait un panneau upgrade/vendre inerte
      // sur une tour qu'on ne controle pas).
      if (isObserving()) return;
      const [ndcX, ndcY] = eventToNdc(ev);

      if (armedBuildDefId) {
        const world = pickGroundWorld(s3d, frame, ndcX, ndcY);
        const slot = world && nearestSlot(0, world[0], world[1]);
        if (!slot) {
          toast('No slot here', 'warn');
          return;
        }
        pendingHuman.push({ type: 'buildTower', player: 0, defId: armedBuildDefId, x: slot.x, y: slot.y });
        armedBuildDefId = null;
        return;
      }

      selectedTowerEid = pickTowerEid(s3d, towerGroups[viewedPlayer]!, ndcX, ndcY);
    },
    listenerOpts,
  );

  canvas.addEventListener(
    'contextmenu',
    (ev) => {
      ev.preventDefault();
      armedBuildDefId = null;
      selectedTowerEid = null;
    },
    listenerOpts,
  );

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape') return;
    armedBuildDefId = null;
    selectedTowerEid = null;
  }
  window.addEventListener('keydown', onKeydown, listenerOpts);

  function resize(): void {
    const rect = canvasWrap.getBoundingClientRect();
    resizeScene3D(s3d, rect.width, rect.height);
  }
  window.addEventListener('resize', resize, listenerOpts);
  resize();

  function handleEvents(events: SimEvent[]): void {
    for (const ev of events) {
      if (ev.type === 'rejected' && ev.player === 0) {
        toast(ev.reason, 'warn');
      } else if (ev.type === 'defeat' && ev.player === 0) {
        toast('You have been eliminated', 'danger');
      } else if (ev.type === 'lightningChain' && ev.player === 0) {
        lightningArcs.spawn(ev.points.map(([x, y]) => worldToScene(frame, x, y)));
      } else if (ev.type === 'gameOver') {
        const you = ev.winner === 0;
        gameOverTitle.textContent =
          ev.winner === null ? 'Game over' : you ? 'Victory!' : `Player ${ev.winner} wins`;
        gameOverDetail.textContent =
          ev.winner === null ? 'No one survived.' : you ? 'You outlasted everyone.' : 'Better luck next time.';
        gameOverEl.hidden = false;
        disarmExitGuard();
        perf?.markEvent('Fin de partie', state, ev.winner === null ? 'timeout' : `victoire joueur ${ev.winner}`);
        callbacks.onGameOver();
      }
    }
  }

  let acc = 0;
  let last = performance.now();
  let rafId = 0;

  function frame3d(now: number): void {
    // trueDt : delta reel entre deux frames, JAMAIS plafonne — pour
    // l'instrumentation perf uniquement (voir perf.sample plus bas). rawDt,
    // lui, reste plafonne a 250ms pour la simulation (comportement de jeu
    // inchange : un onglet remis au premier plan ne doit pas rejouer des
    // minutes de simulation d'un coup) — les deux valeurs servent des buts
    // differents et ne doivent jamais etre confondues (voir perfMonitor.ts).
    const trueDt = now - last;
    const rawDt = Math.min(trueDt, 250);
    last = now;
    acc += rawDt * speed;

    const perfSimT0 = perf ? performance.now() : 0;
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
    const simMs = perf ? performance.now() - perfSimT0 : 0;

    // Les animations (construction, visee) tournent en temps reel MULTIPLIE par
    // la vitesse de simulation choisie : a 4x, la partie va 4x plus vite, donc
    // une tour ne doit pas rester 2 secondes pleines en chantier pendant que 4x
    // plus de ticks s'écoulent derriere — sinon elle pourrait deja etre revendue
    // avant la fin de sa propre animation de construction.
    const animDt = (rawDt / 1000) * speed;

    const perfSyncT0 = perf ? performance.now() : 0;
    const arena0 = state.arenas[0];
    const hoveredSlot = mouseWorld ? nearestSlot(0, mouseWorld[0], mouseWorld[1]) : null;

    // Les 6+ arenes sont synchronisees a CHAQUE frame, pas seulement celle
    // affichee : c'est ce qui garantit qu'aucun mesh ne se cree/detruit au
    // moment de basculer (voir la construction des tableaux plus haut). Le
    // rendu GPU, lui, reste sur une seule arene (les groupes non visibles
    // sont ignores au draw).
    for (let p = 0; p < state.arenas.length; p++) {
      const arena = state.arenas[p];
      if (!arena) continue;
      const isViewed = p === viewedPlayer;
      towerEntitiesByPlayer[p]!.sync(arena);
      creepEntitiesByPlayer[p]!.sync(arena, state.tick, animDt);
      towerEntitiesByPlayer[p]!.update(arena, animDt, isViewed ? selectedTowerEid : null, isViewed ? hoveredTowerEid : null);
    }
    if (arena0) {
      slotMarkers.update(state.arenas[viewedPlayer] ?? arena0, hoveredSlot?.id ?? null);
      updateTopbar(topbarRefs, state);
      updateBuildPanel(buildButtons, arena0, armedBuildDefId);
      updateShopPanel(shopRows, state, arena0);
      updateSelectedPanel(selectedRefs, arena0, selectedTowerEid);

      if (armedBuildDefId && hoveredSlot) {
        const occupied = !!arena0.occupied[hoveredSlot.id];
        const [gx, gz] = worldToScene(frame, hoveredSlot.x, hoveredSlot.y);
        ghost.position.set(gx, PLATFORM_HEIGHT + 0.03, gz);
        (ghost.material as THREE.MeshBasicMaterial).color.set(occupied ? 0xd0503c : 0x4a9e5c);
        ghost.visible = true;
      } else {
        ghost.visible = false;
      }
    }
    updateArenasPanel(arenaRows, state);
    updateArenaBar(arenaBarRefs, state, viewedPlayer, 0);
    lightningArcs.update(animDt);
    const syncMs = perf ? performance.now() - perfSyncT0 : 0;

    s3d.controls.update();
    const renderMs = perf
      ? perf.timeRender(() => s3d.renderer.render(s3d.scene, s3d.camera))
      : (s3d.renderer.render(s3d.scene, s3d.camera), 0);

    if (perf) {
      perf.sample({
        rawFrameTimeMs: trueDt,
        simulationDtMs: rawDt,
        state,
        viewedPlayer,
        creepEntitiesByPlayer,
        towerEntitiesByPlayer,
        lightningArcs,
        cpu: { simMs, syncMs, renderMs },
      });
    }

    rafId = requestAnimationFrame(frame3d);
  }
  rafId = requestAnimationFrame(frame3d);

  return () => {
    cancelAnimationFrame(rafId);
    disarmExitGuard();
    controller.abort();
    disposeScene3D(s3d);
  };
}
