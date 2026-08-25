import type { Difficulty } from '@tower-defense/sim';
import { ApiError, claim, fetchMe, guest, login, logout, type PublicUser } from './api.js';
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_DESCRIPTIONS,
  DEFAULT_DIFFICULTY,
  loadStoredDifficulty,
  storeDifficulty,
} from './difficulty.js';

type Screen = 'chargement' | 'pseudo' | 'pseudo-login' | 'menu' | 'menu-claim' | 'difficulte' | 'partie';

const root = document.getElementById('launcher');
if (!root) throw new Error('missing #launcher');

const appEl = document.getElementById('app');
if (!appEl) throw new Error('missing #app');

let user: PublicUser | null = null;
let stopGame: (() => void) | null = null;
/** Niveau de la partie en cours, a cote de stopGame ci-dessus — la source de
 * verite pour "Rejouer" reste le closure de main.ts (jamais reassignee tant
 * que le launcher n'est pas repasse), ceci suit juste quel niveau tourne. */
let currentDifficulty: Difficulty | null = null;

const ICON_USER =
  '<svg class="launcher-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M4.5 20c1.4-4 4.2-6 7.5-6s6.1 2 7.5 6"/></svg>';
const ICON_MAIL =
  '<svg class="launcher-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><path d="M4 6.5l8 6.5 8-6.5"/></svg>';
const ICON_LOCK =
  '<svg class="launcher-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="9.5" rx="1.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>';

const DIVIDER = '<div class="launcher-divider"><span></span></div>';

function field(icon: string, id: string, label: string, attrs: string): string {
  return `
    <label class="sr-only" for="${id}">${label}</label>
    <div class="launcher-input">
      ${icon}
      <input id="${id}" placeholder="${label}" ${attrs} />
    </div>
  `;
}

function render(screen: Screen, error?: string): void {
  root!.dataset.screen = screen;
  if (screen === 'chargement') {
    root!.innerHTML = `<div class="launcher-screen"><p class="launcher-loading">Chargement…</p></div>`;
    return;
  }
  if (screen === 'pseudo') renderPseudoScreen(error);
  else if (screen === 'pseudo-login') renderLoginScreen(error);
  else if (screen === 'menu') renderMenuScreen();
  else if (screen === 'menu-claim') renderClaimScreen(error);
  else if (screen === 'difficulte') renderDifficultyScreen();
}

// Echap ferme le panneau de difficulte et revient au menu — un seul listener
// permanent gate par l'ecran courant plutot qu'un ajout/retrait par render(),
// pour ne jamais risquer de laisser un handler perime derriere soi.
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && root!.dataset.screen === 'difficulte') render('menu');
});

function renderPseudoScreen(error?: string): void {
  root!.innerHTML = `
    <div class="launcher-screen">
      <h1>Tower Defense</h1>
      ${DIVIDER}
      <form id="pseudo-form" class="launcher-form">
        ${field(ICON_USER, 'pseudo-input', 'Pseudo', 'name="pseudo" type="text" maxlength="20" autocomplete="off" required')}
        ${error ? `<p class="launcher-error">${escapeHtml(error)}</p>` : ''}
        <button type="submit">Continuer</button>
      </form>
      <a href="#" id="to-login">J'ai déjà un compte</a>
    </div>
  `;
  root!.querySelector<HTMLFormElement>('#pseudo-form')!.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pseudo = (root!.querySelector<HTMLInputElement>('#pseudo-input')!.value ?? '').trim();
    try {
      user = await guest(pseudo);
      render('menu');
    } catch (err) {
      render('pseudo', errorMessage(err));
    }
  });
  root!.querySelector<HTMLAnchorElement>('#to-login')!.addEventListener('click', (ev) => {
    ev.preventDefault();
    render('pseudo-login');
  });
}

function renderLoginScreen(error?: string): void {
  root!.innerHTML = `
    <div class="launcher-screen">
      <h1>Tower Defense</h1>
      ${DIVIDER}
      <form id="login-form" class="launcher-form">
        ${field(ICON_MAIL, 'login-email', 'Email', 'name="email" type="email" autocomplete="email" required')}
        ${field(ICON_LOCK, 'login-password', 'Mot de passe', 'name="password" type="password" autocomplete="current-password" required')}
        ${error ? `<p class="launcher-error">${escapeHtml(error)}</p>` : ''}
        <button type="submit">Se connecter</button>
      </form>
      <a href="#" id="to-pseudo">Créer un compte invité</a>
    </div>
  `;
  root!.querySelector<HTMLFormElement>('#login-form')!.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = root!.querySelector<HTMLInputElement>('#login-email')!.value;
    const password = root!.querySelector<HTMLInputElement>('#login-password')!.value;
    try {
      user = await login(email, password);
      render('menu');
    } catch (err) {
      render('pseudo-login', errorMessage(err));
    }
  });
  root!.querySelector<HTMLAnchorElement>('#to-pseudo')!.addEventListener('click', (ev) => {
    ev.preventDefault();
    render('pseudo');
  });
}

function renderMenuScreen(): void {
  const u = user!;
  root!.innerHTML = `
    <div class="launcher-screen">
      <h1>Tower Defense</h1>
      ${DIVIDER}
      <p class="launcher-player">${escapeHtml(u.pseudo)}#${u.joinNumber}</p>
      <!-- Libelle deliberement specifique ("contre des bots") plutot que
           "Jouer" seul : annonce qu'un mode multijoueur existera, et laisse
           la place a un second bouton plus tard sans redessiner l'ecran. -->
      <button id="play-btn" class="launcher-play">Jouer contre des bots</button>
      ${u.isGuest ? `<a href="#" id="save-account" class="launcher-save">Sauvegarder mon compte</a>` : ''}
      <a href="#" id="logout-link" class="launcher-logout">Se déconnecter</a>
    </div>
  `;
  root!.querySelector<HTMLButtonElement>('#play-btn')!.addEventListener('click', () => {
    render('difficulte');
  });
  root!.querySelector<HTMLAnchorElement>('#save-account')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    render('menu-claim');
  });
  root!.querySelector<HTMLAnchorElement>('#logout-link')!.addEventListener('click', (ev) => {
    ev.preventDefault();
    void logout().then(() => {
      user = null;
      render('pseudo');
    });
  });
}

const DIFFICULTY_ORDER: readonly Difficulty[] = ['easy', 'medium', 'hard'];

function renderDifficultyScreen(): void {
  // Preselectionne le dernier niveau joue (localStorage, survit au rechargement
  // de page) — relancer une partie est un clic de confirmation, pas un choix a
  // refaire. Defaut 'medium' au tout premier lancement (aucune valeur stockee).
  const selected = loadStoredDifficulty();
  root!.innerHTML = `
    <div class="launcher-screen">
      <h1>Choisis un niveau</h1>
      ${DIVIDER}
      <form id="difficulty-form" class="launcher-form">
        <div class="difficulty-options">
          ${DIFFICULTY_ORDER.map(
            (d) => `
            <label class="difficulty-option">
              <input type="radio" name="difficulty" value="${d}" ${d === selected ? 'checked' : ''} />
              <span class="difficulty-option-body">
                <span class="difficulty-option-title">${DIFFICULTY_LABELS[d]}</span>
                <span class="difficulty-option-desc">${DIFFICULTY_DESCRIPTIONS[d]}</span>
              </span>
            </label>
          `,
          ).join('')}
        </div>
        <button type="submit" class="launcher-play">Jouer</button>
      </form>
      <a href="#" id="difficulty-back">Retour</a>
    </div>
  `;
  root!.querySelector<HTMLFormElement>('#difficulty-form')!.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const checked = root!.querySelector<HTMLInputElement>('input[name="difficulty"]:checked');
    const difficulty = (checked?.value as Difficulty | undefined) ?? DEFAULT_DIFFICULTY;
    storeDifficulty(difficulty);
    void startGameScreen(difficulty);
  });
  root!.querySelector<HTMLAnchorElement>('#difficulty-back')!.addEventListener('click', (ev) => {
    ev.preventDefault();
    render('menu');
  });
}

function renderClaimScreen(error?: string): void {
  root!.innerHTML = `
    <div class="launcher-screen">
      <h1>Sauvegarder mon compte</h1>
      ${DIVIDER}
      <form id="claim-form" class="launcher-form">
        ${field(ICON_MAIL, 'claim-email', 'Email', 'name="email" type="email" autocomplete="email" required')}
        ${field(ICON_LOCK, 'claim-password', 'Mot de passe', 'name="password" type="password" minlength="8" autocomplete="new-password" required')}
        ${field(ICON_LOCK, 'claim-password-confirm', 'Confirmation', 'name="passwordConfirm" type="password" minlength="8" autocomplete="new-password" required')}
        ${error ? `<p class="launcher-error">${escapeHtml(error)}</p>` : ''}
        <button type="submit">Sauvegarder</button>
      </form>
      <a href="#" id="back-to-menu">Annuler</a>
    </div>
  `;
  root!.querySelector<HTMLFormElement>('#claim-form')!.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = root!.querySelector<HTMLInputElement>('#claim-email')!.value;
    const password = root!.querySelector<HTMLInputElement>('#claim-password')!.value;
    const confirm = root!.querySelector<HTMLInputElement>('#claim-password-confirm')!.value;
    if (password !== confirm) {
      render('menu-claim', 'Les mots de passe ne correspondent pas');
      return;
    }
    try {
      user = await claim(email, password);
      render('menu');
    } catch (err) {
      render('menu-claim', errorMessage(err));
    }
  });
  root!.querySelector<HTMLAnchorElement>('#back-to-menu')!.addEventListener('click', (ev) => {
    ev.preventDefault();
    render('menu');
  });
}

async function startGameScreen(difficulty: Difficulty): Promise<void> {
  const { startGame } = await import('./main.js');
  root!.hidden = true;
  appEl!.hidden = false;
  currentDifficulty = difficulty;

  stopGame = startGame(
    {
      // La garde de fermeture accidentelle (beforeunload) est entierement geree
      // par main.ts, seul module a savoir si une partie est en cours (couvre
      // aussi "Rejouer", qui ne repasse pas par le launcher). Ce callback reste
      // dans l'interface pour l'invitation "Sauvegarder ta progression ?" a la
      // fin d'une partie gagnee, prevue dans un lot ulterieur.
      onGameOver: () => {},
      onExitToMenu: () => {
        stopGame?.();
        stopGame = null;
        currentDifficulty = null;
        appEl!.hidden = true;
        root!.hidden = false;
        render('menu');
      },
    },
    difficulty,
  );
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Une erreur est survenue';
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

async function boot(): Promise<void> {
  render('chargement');
  try {
    user = await fetchMe();
    render('menu');
  } catch {
    render('pseudo');
  }
}

void boot();
