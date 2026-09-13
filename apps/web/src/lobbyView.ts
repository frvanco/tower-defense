import {
  LOBBY_SIZE,
  isHost,
  occupiedCount,
  type BotDifficulty,
  type Lobby,
  type LobbySlot,
  type PlayerId,
} from '@tower-defense/lobby';
import { playerColor, playerLabel } from './colors.js';
import { DIFFICULTY_LABELS } from './difficulty.js';

/**
 * Rendu du salon — hote et invite partagent le MEME ecran. La vue invite n'est
 * pas un ecran distinct : ce sont les memes six lignes, privees de toute
 * action de gestion. Un seul rendu a maintenir, et aucun risque qu'une action
 * reservee a l'hote apparaisse par erreur cote invite.
 */

const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['easy', 'medium', 'hard'];

/** Actions demandees par l'UI. Toutes passent par le LobbyClient cote
 * appelant : cette vue ne connait ni le client, ni le reseau. */
export interface LobbyViewActions {
  onAddBot(slotIndex: number): void;
  onSetBotDifficulty(slotIndex: number, difficulty: BotDifficulty): void;
  onRemoveBot(slotIndex: number): void;
  onKick(slotIndex: number): void;
  onLeave(): void;
  onStart(): void;
  onCopyCode(): void;
}

export function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function hostDisplayName(lobby: Lobby): string {
  const slot = lobby.slots[0];
  return slot && slot.occupant.kind === 'human' ? slot.occupant.displayName : '?';
}

function slotActions(slot: LobbySlot, viewerIsHost: boolean, viewerId: PlayerId): string {
  // Vue invite : aucune action de gestion, quelle que soit la place.
  if (!viewerIsHost) return '';
  const i = slot.index;

  if (slot.occupant.kind === 'empty') {
    return `<button type="button" class="lobby-action" data-act="add-bot" data-slot="${i}">+ Bot</button>`;
  }

  if (slot.occupant.kind === 'bot') {
    const current = slot.occupant.difficulty;
    const options = BOT_DIFFICULTIES.map(
      (d) => `<option value="${d}"${d === current ? ' selected' : ''}>${DIFFICULTY_LABELS[d]}</option>`,
    ).join('');
    return `
      <label class="sr-only" for="lobby-diff-${i}">Difficulté du bot place ${i + 1}</label>
      <select id="lobby-diff-${i}" class="lobby-difficulty" data-act="set-difficulty" data-slot="${i}">${options}</select>
      <button type="button" class="lobby-action" data-act="remove-bot" data-slot="${i}">Retirer</button>
    `;
  }

  // Humain : l'hote peut exclure tout le monde SAUF lui-meme.
  if (slot.occupant.playerId === viewerId) return '';
  return `<button type="button" class="lobby-action lobby-action-danger" data-act="kick" data-slot="${i}">Exclure</button>`;
}

function slotLabel(slot: LobbySlot): string {
  if (slot.occupant.kind === 'empty') return '<span class="lobby-empty">Place libre</span>';
  if (slot.occupant.kind === 'bot') return '<span class="lobby-bot">Bot</span>';
  return escapeHtml(slot.occupant.displayName);
}

function renderSlot(slot: LobbySlot, lobby: Lobby, viewerIsHost: boolean, viewerId: PlayerId): string {
  const isHostSlot = slot.occupant.kind === 'human' && slot.occupant.playerId === lobby.hostId;
  const isSelf = slot.occupant.kind === 'human' && slot.occupant.playerId === viewerId;
  return `
    <li class="lobby-slot${slot.occupant.kind === 'empty' ? ' lobby-slot-empty' : ''}">
      <span class="lobby-swatch" style="--slot-color:${playerColor(slot.index)}" aria-hidden="true"></span>
      <span class="lobby-seat">${playerLabel(slot.index)}</span>
      <span class="lobby-name">${slotLabel(slot)}</span>
      ${isHostSlot ? '<span class="lobby-badge">Hôte</span>' : ''}
      ${isSelf && !isHostSlot ? '<span class="lobby-badge lobby-badge-self">Toi</span>' : ''}
      <span class="lobby-slot-actions">${slotActions(slot, viewerIsHost, viewerId)}</span>
    </li>
  `;
}

/**
 * Ecrit le salon dans `root`. Appele a CHAQUE evenement `state` et jamais
 * autrement : l'UI n'a pas d'etat propre, elle est une fonction de l'etat
 * serveur. C'est ce qui rend toute mise a jour optimiste impossible par
 * construction.
 */
export function renderLobby(
  root: HTMLElement,
  lobby: Lobby,
  viewerId: PlayerId,
  actions: LobbyViewActions,
): void {
  const viewerIsHost = isHost(lobby, viewerId);
  const count = occupiedCount(lobby);
  const full = count === LOBBY_SIZE;

  root.innerHTML = `
    <div class="launcher-screen lobby-screen">
      <h1 class="lobby-title">Salon de ${escapeHtml(hostDisplayName(lobby))}</h1>
      <div class="lobby-meta">
        <span class="lobby-count">${count}/${LOBBY_SIZE}</span>
        <span class="lobby-code-wrap">
          <span class="lobby-code">${escapeHtml(lobby.code)}</span>
          <button type="button" id="lobby-copy" class="lobby-copy" title="Copier le code">Copier</button>
        </span>
      </div>
      <ul class="lobby-slots">
        ${lobby.slots.map((s) => renderSlot(s, lobby, viewerIsHost, viewerId)).join('')}
      </ul>
      <div class="lobby-footer">
        <button type="button" id="lobby-leave" class="lobby-leave">Quitter</button>
        ${
          viewerIsHost
            ? `<button type="button" id="lobby-start" class="launcher-play lobby-start"${full ? '' : ' disabled'}>Lancer la partie</button>`
            : '<p class="lobby-waiting">En attente de l’hôte…</p>'
        }
      </div>
    </div>
  `;

  root.querySelector<HTMLButtonElement>('#lobby-copy')!.addEventListener('click', actions.onCopyCode);
  root.querySelector<HTMLButtonElement>('#lobby-leave')!.addEventListener('click', actions.onLeave);
  root.querySelector<HTMLButtonElement>('#lobby-start')?.addEventListener('click', actions.onStart);

  // Delegation sur les actions de place : les boutons sont reconstruits a
  // chaque `state`, attacher un listener par bouton les multiplierait.
  for (const el of root.querySelectorAll<HTMLElement>('[data-act]')) {
    const slotIndex = Number(el.dataset.slot);
    const act = el.dataset.act;
    if (act === 'add-bot') el.addEventListener('click', () => actions.onAddBot(slotIndex));
    else if (act === 'remove-bot') el.addEventListener('click', () => actions.onRemoveBot(slotIndex));
    else if (act === 'kick') el.addEventListener('click', () => actions.onKick(slotIndex));
    else if (act === 'set-difficulty') {
      el.addEventListener('change', () => {
        actions.onSetBotDifficulty(slotIndex, (el as HTMLSelectElement).value as BotDifficulty);
      });
    }
  }
}

/** Resume de composition affiche apres le compte a rebours — le moteur n'est
 * pas encore branche au salon, cet ecran tient lieu de destination. */
export function renderComposition(root: HTMLElement, lobby: Lobby, onBack: () => void): void {
  root.innerHTML = `
    <div class="launcher-screen lobby-screen">
      <h1 class="lobby-title">Composition</h1>
      <p class="lobby-provisional">Le moteur n’est pas encore branché au salon — voici la composition qui lui sera transmise.</p>
      <ul class="lobby-slots">
        ${lobby.slots
          .map(
            (s) => `
          <li class="lobby-slot">
            <span class="lobby-swatch" style="--slot-color:${playerColor(s.index)}" aria-hidden="true"></span>
            <span class="lobby-seat">${playerLabel(s.index)}</span>
            <span class="lobby-name">${slotLabel(s)}</span>
            ${s.occupant.kind === 'bot' ? `<span class="lobby-badge">${DIFFICULTY_LABELS[s.occupant.difficulty]}</span>` : ''}
          </li>
        `,
          )
          .join('')}
      </ul>
      <div class="lobby-footer">
        <button type="button" id="lobby-composition-back" class="lobby-leave">Retour à l’accueil</button>
      </div>
    </div>
  `;
  root.querySelector<HTMLButtonElement>('#lobby-composition-back')!.addEventListener('click', onBack);
}
