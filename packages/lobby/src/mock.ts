import {
  LOBBY_CODE_ALPHABET,
  LOBBY_CODE_LENGTH,
  LOBBY_SIZE,
  firstEmptySlotIndex,
  isLobbyFull,
  normalizeLobbyCode,
  type BotDifficulty,
  type CommandResult,
  type JoinResult,
  type Lobby,
  type LobbyClient,
  type LobbyEvent,
  type LobbySlot,
  type PlayerId,
  type Unsubscribe,
} from './contract.js';

/**
 * Latence simulee, en millisecondes. Sa raison d'etre n'est pas le realisme :
 * c'est de rendre IMPOSSIBLE une UI qui presumerait qu'une commande a deja
 * reussi. Un rendu optimiste se verrait immediatement (l'ecran changerait
 * avant l'evenement `state`).
 */
export const MOCK_LATENCY_MS = 150;

/** Joueur connu du serveur mock. Le vrai serveur lira ca de la session. */
export interface MockPlayer {
  id: PlayerId;
  /** Nom affiche, deja mis en forme par l'appelant (ex. « Antoine#75 »). */
  displayName: string;
}

function emptySlot(index: number): LobbySlot {
  return { index, occupant: { kind: 'empty' } };
}

/** Copie profonde de l'etat rendu au client. Le serveur ne doit jamais rendre
 * une reference sur son etat interne : un client qui la muterait corromprait
 * le salon de tout le monde, ce qu'un vrai serveur rend impossible par
 * construction (serialisation reseau). */
function snapshot(lobby: Lobby): Lobby {
  return {
    code: lobby.code,
    hostId: lobby.hostId,
    slots: lobby.slots.map((s) => ({ index: s.index, occupant: { ...s.occupant } })),
  };
}

interface LobbyRecord {
  lobby: Lobby;
  /** Joueurs exclus : ils ne peuvent plus revenir dans CE salon. */
  kicked: Set<PlayerId>;
  /** Abonnes, par joueur. Un joueur exclu ou parti en sort. */
  listeners: Map<PlayerId, Set<(event: LobbyEvent) => void>>;
}

/**
 * Serveur de salon en memoire. Applique TOUTES les regles metier — l'UI n'en
 * duplique aucune : elle envoie des commandes et se rend sur `state`.
 *
 * Un seul serveur peut porter plusieurs salons et plusieurs joueurs
 * simultanement, y compris dans un seul onglet : c'est ce qui permet aux
 * controles de dev de simuler les autres joueurs.
 */
export class MockLobbyServer {
  private readonly lobbies = new Map<string, LobbyRecord>();
  /** Salon courant de chaque joueur — un joueur n'est jamais dans deux. */
  private readonly playerLobby = new Map<PlayerId, string>();

  constructor(private readonly randomChar: () => string = defaultRandomChar) {}

  // --- lecture (pour les controles de dev et les tests) --------------------

  listLobbies(): Lobby[] {
    return [...this.lobbies.values()].map((r) => snapshot(r.lobby));
  }

  getLobby(code: string): Lobby | null {
    const rec = this.lobbies.get(normalizeLobbyCode(code));
    return rec ? snapshot(rec.lobby) : null;
  }

  // --- abonnement ----------------------------------------------------------

  subscribe(playerId: PlayerId, listener: (event: LobbyEvent) => void): Unsubscribe {
    const code = this.playerLobby.get(playerId);
    // On accepte un abonnement AVANT la connexion : l'UI s'abonne d'abord,
    // puis appelle create/join, sans quoi elle raterait le premier `state`.
    this.pending.set(playerId, [...(this.pending.get(playerId) ?? []), listener]);
    if (code) this.attach(code, playerId, listener);
    return () => {
      this.pending.set(playerId, (this.pending.get(playerId) ?? []).filter((l) => l !== listener));
      const c = this.playerLobby.get(playerId);
      if (c) this.lobbies.get(c)?.listeners.get(playerId)?.delete(listener);
    };
  }

  private readonly pending = new Map<PlayerId, Array<(event: LobbyEvent) => void>>();

  private attach(code: string, playerId: PlayerId, listener: (event: LobbyEvent) => void): void {
    const rec = this.lobbies.get(code);
    if (!rec) return;
    const set = rec.listeners.get(playerId) ?? new Set();
    set.add(listener);
    rec.listeners.set(playerId, set);
  }

  private attachPending(code: string, playerId: PlayerId): void {
    for (const l of this.pending.get(playerId) ?? []) this.attach(code, playerId, l);
  }

  private emitTo(rec: LobbyRecord, playerId: PlayerId, event: LobbyEvent): void {
    for (const l of rec.listeners.get(playerId) ?? []) l(event);
  }

  /** Diffuse l'etat complet a tous les humains presents. Appele apres CHAQUE
   * changement : c'est la seule facon dont l'UI apprend quoi que ce soit. */
  private broadcastState(rec: LobbyRecord): void {
    for (const playerId of rec.listeners.keys()) {
      this.emitTo(rec, playerId, { type: 'state', lobby: snapshot(rec.lobby) });
    }
  }

  // --- commandes -----------------------------------------------------------

  create(player: MockPlayer): Lobby {
    const code = this.freshCode();
    const slots = Array.from({ length: LOBBY_SIZE }, (_, i) => emptySlot(i));
    // L'hote occupe TOUJOURS la place 0.
    slots[0] = {
      index: 0,
      occupant: { kind: 'human', playerId: player.id, displayName: player.displayName },
    };
    const rec: LobbyRecord = {
      lobby: { code, hostId: player.id, slots },
      kicked: new Set(),
      listeners: new Map(),
    };
    this.lobbies.set(code, rec);
    this.playerLobby.set(player.id, code);
    this.attachPending(code, player.id);
    this.broadcastState(rec);
    return snapshot(rec.lobby);
  }

  join(player: MockPlayer, rawCode: string): JoinResult {
    const code = normalizeLobbyCode(rawCode);
    const rec = this.lobbies.get(code);
    // Un salon dissous ou lance a ete retire de la map : son code est donc
    // « introuvable », pas « plein ». Les salons sont jetables.
    if (!rec) return { ok: false, error: 'not_found' };
    if (rec.kicked.has(player.id)) return { ok: false, error: 'kicked' };

    const index = firstEmptySlotIndex(rec.lobby);
    if (index === null) return { ok: false, error: 'full' };

    rec.lobby.slots[index] = {
      index,
      occupant: { kind: 'human', playerId: player.id, displayName: player.displayName },
    };
    this.playerLobby.set(player.id, code);
    this.attachPending(code, player.id);
    this.broadcastState(rec);
    return { ok: true, lobby: snapshot(rec.lobby) };
  }

  leave(playerId: PlayerId): void {
    const rec = this.currentRecord(playerId);
    if (!rec) return;

    if (rec.lobby.hostId === playerId) {
      this.dissolve(rec);
      return;
    }

    const slot = rec.lobby.slots.find(
      (s) => s.occupant.kind === 'human' && s.occupant.playerId === playerId,
    );
    // La place redevient vide et GARDE son index, donc sa couleur. Personne ne
    // se decale.
    if (slot) rec.lobby.slots[slot.index] = emptySlot(slot.index);
    this.detach(rec, playerId);
    this.broadcastState(rec);
  }

  addBot(playerId: PlayerId, slotIndex: number, difficulty: BotDifficulty): CommandResult {
    return this.hostCommand(playerId, (rec) => {
      const slot = rec.lobby.slots[slotIndex];
      if (!slot || slot.occupant.kind !== 'empty') return { ok: false, error: 'slot_not_empty' };
      rec.lobby.slots[slotIndex] = { index: slotIndex, occupant: { kind: 'bot', difficulty } };
      return { ok: true };
    });
  }

  setBotDifficulty(playerId: PlayerId, slotIndex: number, difficulty: BotDifficulty): CommandResult {
    return this.hostCommand(playerId, (rec) => {
      const slot = rec.lobby.slots[slotIndex];
      if (!slot || slot.occupant.kind !== 'bot') return { ok: false, error: 'slot_not_bot' };
      rec.lobby.slots[slotIndex] = { index: slotIndex, occupant: { kind: 'bot', difficulty } };
      return { ok: true };
    });
  }

  removeBot(playerId: PlayerId, slotIndex: number): CommandResult {
    return this.hostCommand(playerId, (rec) => {
      const slot = rec.lobby.slots[slotIndex];
      if (!slot || slot.occupant.kind !== 'bot') return { ok: false, error: 'slot_not_bot' };
      rec.lobby.slots[slotIndex] = emptySlot(slotIndex);
      return { ok: true };
    });
  }

  kick(playerId: PlayerId, slotIndex: number): CommandResult {
    return this.hostCommand(playerId, (rec) => {
      const slot = rec.lobby.slots[slotIndex];
      if (!slot || slot.occupant.kind !== 'human') return { ok: false, error: 'slot_not_human' };
      // L'hote ne peut pas s'exclure lui-meme : sa place est la seule occupee
      // par lui, et la traiter comme un depart d'hote deguise dissoudrait le
      // salon par un chemin auquel l'UI ne s'attend pas.
      if (slot.occupant.playerId === rec.lobby.hostId) return { ok: false, error: 'slot_not_human' };

      const victim = slot.occupant.playerId;
      rec.lobby.slots[slotIndex] = emptySlot(slotIndex);
      rec.kicked.add(victim);
      this.emitTo(rec, victim, { type: 'kicked' });
      this.detach(rec, victim);
      return { ok: true };
    });
  }

  start(playerId: PlayerId): CommandResult {
    return this.hostCommand(playerId, (rec) => {
      if (!isLobbyFull(rec.lobby)) return { ok: false, error: 'lobby_not_full' };
      const final = snapshot(rec.lobby);
      for (const pid of [...rec.listeners.keys()]) {
        this.emitTo(rec, pid, { type: 'gameStarting', lobby: final });
      }
      // Salon jetable : lance = il n'existe plus, son code redevient
      // introuvable.
      this.destroy(rec);
      return { ok: true };
    });
  }

  // --- interne -------------------------------------------------------------

  /** Facteur commun des cinq commandes de gestion : etre dans un salon, en
   * etre l'hote, puis diffuser l'etat si la commande a abouti. */
  private hostCommand(
    playerId: PlayerId,
    run: (rec: LobbyRecord) => CommandResult,
  ): CommandResult {
    const rec = this.currentRecord(playerId);
    if (!rec) return { ok: false, error: 'not_in_lobby' };
    if (rec.lobby.hostId !== playerId) return { ok: false, error: 'not_host' };
    const result = run(rec);
    // `start` a deja detruit le salon : ne pas rediffuser un etat mort.
    if (result.ok && this.lobbies.has(rec.lobby.code)) this.broadcastState(rec);
    return result;
  }

  private currentRecord(playerId: PlayerId): LobbyRecord | null {
    const code = this.playerLobby.get(playerId);
    if (!code) return null;
    return this.lobbies.get(code) ?? null;
  }

  private dissolve(rec: LobbyRecord): void {
    for (const pid of [...rec.listeners.keys()]) {
      this.emitTo(rec, pid, { type: 'dissolved' });
    }
    this.destroy(rec);
  }

  /** Retire le salon et deconnecte tout le monde. Ne notifie rien : les
   * appelants (dissolve, start) ont deja emis leur evenement terminal. */
  private destroy(rec: LobbyRecord): void {
    for (const pid of rec.listeners.keys()) this.playerLobby.delete(pid);
    for (const s of rec.lobby.slots) {
      if (s.occupant.kind === 'human') this.playerLobby.delete(s.occupant.playerId);
    }
    rec.listeners.clear();
    this.lobbies.delete(rec.lobby.code);
  }

  private detach(rec: LobbyRecord, playerId: PlayerId): void {
    rec.listeners.delete(playerId);
    this.playerLobby.delete(playerId);
  }

  private freshCode(): string {
    // Boucle bornee : a 32^4 codes possibles, une collision est deja tres
    // improbable, mais une boucle non bornee sur un generateur deterministe
    // (les tests en injectent un) tournerait indefiniment.
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < LOBBY_CODE_LENGTH; i++) code += this.randomChar();
      if (!this.lobbies.has(code)) return code;
    }
    throw new Error('impossible de generer un code de salon libre');
  }
}

function defaultRandomChar(): string {
  const i = Math.floor(Math.random() * LOBBY_CODE_ALPHABET.length);
  return LOBBY_CODE_ALPHABET[i] ?? 'A';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Adapte le serveur en memoire a l'interface `LobbyClient`, pour UN joueur.
 * C'est l'objet que l'UI manipule ; le remplacer par un client reseau ne
 * change rien au reste du front.
 *
 * Chaque commande attend MOCK_LATENCY_MS avant d'agir : l'aller-retour est
 * donc toujours observable, et une UI optimiste se trahirait.
 */
export function createMockLobbyClient(server: MockLobbyServer, player: MockPlayer): LobbyClient {
  return {
    async create() {
      await delay(MOCK_LATENCY_MS);
      return server.create(player);
    },
    async join(code) {
      await delay(MOCK_LATENCY_MS);
      return server.join(player, code);
    },
    async leave() {
      await delay(MOCK_LATENCY_MS);
      server.leave(player.id);
    },
    async addBot(slotIndex, difficulty) {
      await delay(MOCK_LATENCY_MS);
      return server.addBot(player.id, slotIndex, difficulty);
    },
    async setBotDifficulty(slotIndex, difficulty) {
      await delay(MOCK_LATENCY_MS);
      return server.setBotDifficulty(player.id, slotIndex, difficulty);
    },
    async removeBot(slotIndex) {
      await delay(MOCK_LATENCY_MS);
      return server.removeBot(player.id, slotIndex);
    },
    async kick(slotIndex) {
      await delay(MOCK_LATENCY_MS);
      return server.kick(player.id, slotIndex);
    },
    async start() {
      await delay(MOCK_LATENCY_MS);
      return server.start(player.id);
    },
    subscribe(listener) {
      return server.subscribe(player.id, listener);
    },
  };
}
