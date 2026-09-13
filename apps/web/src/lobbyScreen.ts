import {
  type CommandError,
  type JoinError,
  type Lobby,
  type LobbyClient,
  type PlayerId,
  type Unsubscribe,
} from '@tower-defense/lobby';
import { renderComposition, renderLobby, type LobbyViewActions } from './lobbyView.js';

/**
 * Controleur du salon : branche un `LobbyClient` sur la vue et gere les etats
 * qui ne sont pas « un salon a afficher » (connexion, exclusion, dissolution,
 * lancement).
 *
 * Regle structurante : on ne se rend QUE sur l'evenement `state`. Les valeurs
 * de retour des commandes ne servent qu'a afficher une erreur — jamais a
 * mettre a jour l'ecran. Aucune mise a jour optimiste.
 */

/** Compte a rebours avant l'ecran de composition, en secondes. */
const COUNTDOWN_SECONDS = 3;

const JOIN_ERROR_MESSAGES: Record<JoinError, string> = {
  not_found: 'Aucun salon ne porte ce code.',
  full: 'Ce salon est complet.',
  kicked: 'Tu as été exclu de ce salon.',
};

const COMMAND_ERROR_MESSAGES: Record<CommandError, string> = {
  not_in_lobby: 'Tu n’es plus dans ce salon.',
  not_host: 'Seul l’hôte peut faire ça.',
  slot_not_empty: 'Cette place n’est plus libre.',
  slot_not_bot: 'Cette place n’est pas occupée par un bot.',
  slot_not_human: 'Cette place n’est pas occupée par un joueur.',
  lobby_not_full: 'Il faut six places occupées pour lancer.',
};

export interface LobbyScreenDeps {
  /** Conteneur ou le salon se dessine (le `#launcher`). */
  root: HTMLElement;
  client: LobbyClient;
  viewerId: PlayerId;
  /** Retour a l'accueil, apres exclusion, dissolution ou depart volontaire. */
  onExit(): void;
  /** Message ephemere (toast). */
  notify(message: string, kind: 'info' | 'warn' | 'danger'): void;
}

/** Session de salon en cours. `dispose` coupe l'abonnement et les minuteries —
 * a appeler avant de quitter l'ecran, sinon un evenement tardif redessinerait
 * un salon qu'on a deja quitte. */
export interface LobbySession {
  dispose(): void;
}

function renderPending(root: HTMLElement, message: string): void {
  root.innerHTML = `
    <div class="launcher-screen lobby-screen">
      <p class="launcher-loading">${message}</p>
    </div>
  `;
}

function renderCountdown(root: HTMLElement, seconds: number): void {
  root.innerHTML = `
    <div class="launcher-screen lobby-screen lobby-countdown-screen">
      <h1 class="lobby-title">La partie commence</h1>
      <p class="lobby-countdown">${seconds}</p>
    </div>
  `;
}

/**
 * Ouvre l'ecran de salon. `enter` fait la commande initiale (create ou join) ;
 * son resultat ne sert qu'a signaler un echec, l'affichage venant du `state`
 * recu par l'abonnement.
 *
 * L'abonnement est pose AVANT `enter` : le premier `state` arrive en reponse a
 * la creation/connexion, le rater laisserait un ecran de chargement fige.
 */
export function openLobbyScreen(
  deps: LobbyScreenDeps,
  enter: (client: LobbyClient) => Promise<{ ok: boolean; error?: JoinError }>,
  pendingMessage: string,
): LobbySession {
  const { root, client, viewerId, onExit, notify } = deps;

  let disposed = false;
  let unsubscribe: Unsubscribe | null = null;
  let countdownTimer: ReturnType<typeof setInterval> | null = null;

  function dispose(): void {
    disposed = true;
    unsubscribe?.();
    unsubscribe = null;
    if (countdownTimer !== null) clearInterval(countdownTimer);
    countdownTimer = null;
  }

  /** Sort du salon et revient a l'accueil. `dispose` d'abord : une fois
   * l'evenement terminal recu, plus rien de ce salon ne doit nous atteindre. */
  function exitWith(message: string, kind: 'info' | 'warn' | 'danger'): void {
    dispose();
    notify(message, kind);
    onExit();
  }

  /** Enveloppe commune aux commandes de gestion : une commande qui echoue
   * n'affiche qu'un message, elle ne touche jamais a l'ecran. */
  function run(command: Promise<{ ok: boolean; error?: CommandError }>): void {
    void command.then((res) => {
      if (disposed || res.ok) return;
      notify(res.error ? COMMAND_ERROR_MESSAGES[res.error] : 'Action refusée.', 'warn');
    });
  }

  const actions: LobbyViewActions = {
    onAddBot: (i) => run(client.addBot(i, 'medium')),
    onSetBotDifficulty: (i, d) => run(client.setBotDifficulty(i, d)),
    onRemoveBot: (i) => run(client.removeBot(i)),
    onKick: (i) => run(client.kick(i)),
    onStart: () => run(client.start()),
    onLeave: () => {
      // On quitte l'ecran tout de suite : `leave` est le seul cas ou l'intention
      // de l'utilisateur suffit — il n'y a rien a afficher en cas d'echec, et
      // rester bloque sur un salon qu'on a demande a quitter serait pire.
      void client.leave();
      exitWith('Tu as quitté le salon.', 'info');
    },
    onCopyCode: () => {
      const code = currentLobby?.code;
      if (!code) return;
      void navigator.clipboard
        .writeText(code)
        .then(() => notify('Code copié.', 'info'))
        .catch(() => notify('Copie impossible — code : ' + code, 'warn'));
    },
  };

  let currentLobby: Lobby | null = null;

  function startCountdown(lobby: Lobby): void {
    // Le salon n'existe deja plus cote serveur : on coupe l'abonnement mais on
    // garde l'ecran, le temps du compte a rebours puis du resume.
    unsubscribe?.();
    unsubscribe = null;

    let remaining = COUNTDOWN_SECONDS;
    renderCountdown(root, remaining);
    countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        renderCountdown(root, remaining);
        return;
      }
      if (countdownTimer !== null) clearInterval(countdownTimer);
      countdownTimer = null;
      // Le moteur n'est PAS appele : ce lot s'arrete a la composition.
      renderComposition(root, lobby, () => {
        dispose();
        onExit();
      });
    }, 1000);
  }

  renderPending(root, pendingMessage);

  unsubscribe = client.subscribe((event) => {
    if (disposed) return;
    switch (event.type) {
      case 'state':
        currentLobby = event.lobby;
        renderLobby(root, event.lobby, viewerId, actions);
        break;
      case 'kicked':
        exitWith('Tu as été exclu du salon.', 'danger');
        break;
      case 'dissolved':
        exitWith('L’hôte a quitté : le salon est dissous.', 'warn');
        break;
      case 'gameStarting':
        startCountdown(event.lobby);
        break;
    }
  });

  void enter(client).then((res) => {
    if (disposed || res.ok) return;
    // Echec de connexion : pas de `state` ne viendra, c'est le seul endroit ou
    // le retour d'une commande decide de l'ecran.
    dispose();
    notify(res.error ? JOIN_ERROR_MESSAGES[res.error] : 'Connexion impossible.', 'danger');
    onExit();
  });

  return { dispose };
}
