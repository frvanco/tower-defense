import type { GameState } from '@tower-defense/sim';
import { playerColor, playerLabel, ELIMINATED_COLOR } from './colors.js';

export interface ArenaPill {
  player: number;
  btn: HTMLButtonElement;
  livesEl: HTMLElement;
}

export interface ArenaBarRefs {
  pills: ArenaPill[];
}

/** (Re)construit la barre pour `playerCount` joueurs (rules.maxPlayers, fixe
 * a 6) — meme pattern que buildArenasPanel (hud.ts) : vide le conteneur
 * avant de le repeupler, puisque startGame() peut etre appelee plusieurs
 * fois sur le meme DOM (Retour a l'accueil puis Jouer, ou "Rejouer") et
 * qu'il ne faut jamais empiler les pastilles d'une partie precedente. */
export function buildArenaBar(
  container: HTMLElement,
  playerCount: number,
  onSelect: (player: number) => void,
): ArenaBarRefs {
  container.innerHTML = '';
  const pills: ArenaPill[] = [];
  for (let p = 0; p < playerCount; p++) {
    const btn = document.createElement('button');
    btn.className = 'arena-pill';
    btn.type = 'button';
    btn.style.setProperty('--pill-color', playerColor(p));

    const swatch = document.createElement('span');
    swatch.className = 'arena-pill-swatch';
    btn.appendChild(swatch);

    const label = document.createElement('span');
    label.className = 'arena-pill-label';
    label.textContent = playerLabel(p);
    btn.appendChild(label);

    const livesEl = document.createElement('span');
    livesEl.className = 'arena-pill-lives';
    btn.appendChild(livesEl);

    btn.addEventListener('click', () => onSelect(p));
    container.appendChild(btn);
    pills.push({ player: p, btn, livesEl });
  }
  return { pills };
}

/** A appeler chaque frame : couleur/vies/etats (mort, la sienne, observee). */
export function updateArenaBar(refs: ArenaBarRefs, state: GameState, viewedPlayer: number, ownPlayer: number): void {
  for (const pill of refs.pills) {
    const arena = state.arenas[pill.player];
    const alive = arena?.alive ?? false;
    pill.livesEl.textContent = alive ? String(arena!.lives) : '';
    pill.btn.classList.toggle('dead', !alive);
    pill.btn.classList.toggle('own', pill.player === ownPlayer);
    pill.btn.classList.toggle('viewed', pill.player === viewedPlayer);
    pill.btn.disabled = !alive;
    pill.btn.style.setProperty('--pill-color', alive ? playerColor(pill.player) : ELIMINATED_COLOR);
  }
}

/** Joueurs vivants, dans l'ordre des indices — sert a la navigation par
 * fleches (qui doit sauter les elimines) et au clic. */
export function livingPlayers(state: GameState): number[] {
  const out: number[] = [];
  for (let p = 0; p < state.arenas.length; p++) {
    if (state.arenas[p]?.alive) out.push(p);
  }
  return out;
}

/** Prochain joueur vivant dans la direction donnee, en bouclant en fin de
 * liste. null si plus personne n'est vivant. */
export function stepLivingPlayer(state: GameState, current: number, dir: 1 | -1): number | null {
  const living = livingPlayers(state);
  if (living.length === 0) return null;
  const idx = living.indexOf(current);
  const nextIdx = idx === -1 ? 0 : (idx + dir + living.length) % living.length;
  return living[nextIdx]!;
}
