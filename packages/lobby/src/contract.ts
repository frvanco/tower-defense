/**
 * Contrat du salon prive — volontairement INDEPENDANT de toute
 * implementation : le mock en memoire (mock.ts) et le futur client reseau
 * doivent satisfaire exactement cette interface, sans qu'un seul type d'ici
 * ne trahisse lequel des deux tourne.
 *
 * C'est aussi pour ca que rien ici n'importe `@tower-defense/sim` ni
 * `@tower-defense/data` : ces types decrivent ce qui circulera un jour sur le
 * fil, pas l'etat interne du moteur. `BotDifficulty` redefinit donc son propre
 * ensemble de valeurs plutot que de reutiliser `Difficulty` du moteur — avec
 * un garde-fou contre la derive, voir test/contract.test.ts.
 */

/** Nombre de places d'un salon. Fige : le format du jeu est verrouille a 6
 * (voir `rules.maxPlayers` dans balance.json, 1 humain + 5 adversaires). */
export const LOBBY_SIZE = 6;

/**
 * Alphabet des codes de salon. Sans I, O, 0, 1 ni caracteres accentues : un
 * code se lit a voix haute ou se recopie depuis une capture d'ecran, les
 * confusions I/1 et O/0 y sont la premiere source d'erreur.
 */
export const LOBBY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Longueur d'un code de salon. */
export const LOBBY_CODE_LENGTH = 4;

/**
 * Met une saisie utilisateur sous forme canonique : espaces autour retires,
 * casse remontee. A appliquer AVANT toute comparaison de code — la saisie est
 * insensible a la casse et aux espaces, la comparaison ne l'est pas.
 */
export function normalizeLobbyCode(input: string): string {
  return input.trim().toUpperCase();
}

/** Difficulte d'un bot. Doit rester alignee sur le `Difficulty` du moteur
 * (garde-fou de type dans les tests), mais reste declaree ici pour que le
 * contrat ne dependre de rien. */
export type BotDifficulty = 'easy' | 'medium' | 'hard';

/** Identifiant stable d'un joueur — cote jeu, l'`id` (uuid) de PublicUser. */
export type PlayerId = string;

/** Occupant d'une place : vide, un humain, ou un bot avec sa difficulte. */
export type SlotOccupant =
  | { kind: 'empty' }
  | { kind: 'human'; playerId: PlayerId; displayName: string }
  | { kind: 'bot'; difficulty: BotDifficulty };

/**
 * Une place. `index` est sa position 0-based, qui determine AUSSI sa couleur
 * (voir PLAYER_COLORS cote front) : une place garde sa couleur quand son
 * occupant part, et personne ne change jamais de place.
 */
export interface LobbySlot {
  index: number;
  occupant: SlotOccupant;
}

/** Etat complet d'un salon. Le serveur ne renvoie jamais autre chose que ca
 * (jamais de delta), voir LobbyEvent. */
export interface Lobby {
  code: string;
  /** Hote du salon. Occupe toujours la place 0 ; son depart dissout le salon. */
  hostId: PlayerId;
  /** Toujours LOBBY_SIZE entrees, index 0..LOBBY_SIZE-1 dans l'ordre. */
  slots: LobbySlot[];
}

/** Echecs possibles d'une connexion a un salon. */
export type JoinError = 'not_found' | 'full' | 'kicked';

/** Echecs possibles d'une commande de gestion. */
export type CommandError =
  | 'not_in_lobby'
  | 'not_host'
  | 'slot_not_empty'
  | 'slot_not_bot'
  | 'slot_not_human'
  | 'lobby_not_full';

/** Resultat d'une commande : rien en cas de succes (l'etat arrive par
 * l'evenement `state`), sinon la raison de l'echec. L'UI ne se rend JAMAIS a
 * partir de cette valeur, elle ne s'en sert que pour afficher une erreur. */
export type CommandResult = { ok: true } | { ok: false; error: CommandError };

/** Idem pour une connexion. */
export type JoinResult = { ok: true; lobby: Lobby } | { ok: false; error: JoinError };

/**
 * Evenements pousses par le serveur. `state` porte l'etat COMPLET a chaque
 * changement. Les trois autres sont terminaux : apres eux, le client n'est
 * plus dans le salon et n'en recevra plus rien.
 */
export type LobbyEvent =
  | { type: 'state'; lobby: Lobby }
  /** Ce client vient d'etre exclu par l'hote. Terminal. */
  | { type: 'kicked' }
  /** L'hote est parti, le salon n'existe plus. Terminal. */
  | { type: 'dissolved' }
  /** L'hote a lance la partie ; `lobby` est la composition figee. Terminal. */
  | { type: 'gameStarting'; lobby: Lobby };

/** Se desabonne d'un flux d'evenements. */
export type Unsubscribe = () => void;

/**
 * Ce que l'UI consomme. Une instance represente UN joueur connecte : c'est le
 * point d'injection unique entre le mock et le futur client reseau.
 *
 * Toutes les commandes sont asynchrones et peuvent echouer — l'UI ne doit
 * jamais presumer qu'une commande a reussi, ni appliquer de mise a jour
 * optimiste. Le seul chemin vers un rendu est l'evenement `state`.
 */
export interface LobbyClient {
  /** Cree un salon dont ce joueur est l'hote, et l'y connecte (place 0). */
  create(): Promise<Lobby>;
  /** Rejoint un salon par son code. La normalisation est faite ici. */
  join(code: string): Promise<JoinResult>;
  /** Quitte le salon courant. Si ce joueur est l'hote, le salon est dissous
   * pour tout le monde. Sans effet s'il n'est dans aucun salon. */
  leave(): Promise<void>;

  addBot(slotIndex: number, difficulty: BotDifficulty): Promise<CommandResult>;
  setBotDifficulty(slotIndex: number, difficulty: BotDifficulty): Promise<CommandResult>;
  removeBot(slotIndex: number): Promise<CommandResult>;
  /** Exclut l'humain occupant cette place. L'hote ne peut pas s'exclure. */
  kick(slotIndex: number): Promise<CommandResult>;
  /** Lance la partie. Refuse tant que les 6 places ne sont pas occupees. */
  start(): Promise<CommandResult>;

  /** S'abonne au flux d'evenements de ce joueur. */
  subscribe(listener: (event: LobbyEvent) => void): Unsubscribe;
}

// --- Aides de lecture, partagees par le mock, l'UI et les tests -------------

/** Places libres, dans l'ordre. */
export function emptySlots(lobby: Lobby): LobbySlot[] {
  return lobby.slots.filter((s) => s.occupant.kind === 'empty');
}

/** Premiere place libre, ou null si le salon est plein — c'est la place que
 * prend un humain qui arrive. */
export function firstEmptySlotIndex(lobby: Lobby): number | null {
  const slot = lobby.slots.find((s) => s.occupant.kind === 'empty');
  return slot ? slot.index : null;
}

export function isLobbyFull(lobby: Lobby): boolean {
  return lobby.slots.every((s) => s.occupant.kind !== 'empty');
}

export function occupiedCount(lobby: Lobby): number {
  return lobby.slots.filter((s) => s.occupant.kind !== 'empty').length;
}

/** Place occupee par ce joueur, ou null s'il n'est pas dans le salon. */
export function slotOfPlayer(lobby: Lobby, playerId: PlayerId): LobbySlot | null {
  return (
    lobby.slots.find((s) => s.occupant.kind === 'human' && s.occupant.playerId === playerId) ?? null
  );
}

export function isHost(lobby: Lobby, playerId: PlayerId): boolean {
  return lobby.hostId === playerId;
}
