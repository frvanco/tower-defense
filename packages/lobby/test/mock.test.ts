import { describe, expect, it, vi } from 'vitest';
import {
  LOBBY_CODE_ALPHABET,
  LOBBY_CODE_LENGTH,
  LOBBY_SIZE,
  MockLobbyServer,
  createMockLobbyClient,
  isLobbyFull,
  normalizeLobbyCode,
  occupiedCount,
  type Lobby,
  type LobbyEvent,
  type MockPlayer,
} from '../src/index.js';

function player(n: number): MockPlayer {
  return { id: `p${n}`, displayName: `Joueur${n}#${n}` };
}

/** Generateur de code deterministe : les tests n'ont pas a deviner le code
 * genere, et deux salons successifs ne collisionnent pas. */
function sequentialCodes(): () => string {
  let i = 0;
  return () => LOBBY_CODE_ALPHABET[i++ % LOBBY_CODE_ALPHABET.length] ?? 'A';
}

function newServer(): MockLobbyServer {
  return new MockLobbyServer(sequentialCodes());
}

/** Remplit le salon avec des bots jusqu'a ce qu'il soit plein. */
function fillWithBots(server: MockLobbyServer, hostId: string, lobby: Lobby): void {
  for (const slot of lobby.slots) {
    if (slot.occupant.kind === 'empty') server.addBot(hostId, slot.index, 'medium');
  }
}

describe('code de salon', () => {
  it("fait 4 caracteres pris dans l'alphabet sans caracteres ambigus", () => {
    const server = new MockLobbyServer();
    const lobby = server.create(player(1));
    expect(lobby.code).toHaveLength(LOBBY_CODE_LENGTH);
    for (const ch of lobby.code) expect(LOBBY_CODE_ALPHABET).toContain(ch);
    // Les confusions visuelles sont exclues par construction.
    for (const ambiguous of ['I', 'O', '0', '1']) expect(lobby.code).not.toContain(ambiguous);
  });

  it('est insensible a la casse et aux espaces autour a la saisie', () => {
    const server = newServer();
    const lobby = server.create(player(1));
    expect(normalizeLobbyCode(`  ${lobby.code.toLowerCase()} `)).toBe(lobby.code);
    expect(server.join(player(2), `  ${lobby.code.toLowerCase()} `)).toEqual({
      ok: true,
      lobby: expect.anything(),
    });
  });
});

describe('structure du salon', () => {
  it("cree 6 places dont la premiere est l'hote", () => {
    const server = newServer();
    const lobby = server.create(player(1));
    expect(lobby.slots).toHaveLength(LOBBY_SIZE);
    expect(lobby.hostId).toBe('p1');
    expect(lobby.slots[0]?.occupant).toEqual({
      kind: 'human',
      playerId: 'p1',
      displayName: 'Joueur1#1',
    });
    for (let i = 1; i < LOBBY_SIZE; i++) expect(lobby.slots[i]?.occupant.kind).toBe('empty');
  });

  it('place un humain qui arrive sur la premiere place vide', () => {
    const server = newServer();
    const lobby = server.create(player(1));
    // Un bot en place 1 : l'arrivant doit donc prendre la 2, pas la 1.
    server.addBot('p1', 1, 'easy');
    const joined = server.join(player(2), lobby.code);
    expect(joined.ok).toBe(true);
    const after = server.getLobby(lobby.code)!;
    expect(after.slots[1]?.occupant.kind).toBe('bot');
    expect(after.slots[2]?.occupant).toMatchObject({ kind: 'human', playerId: 'p2' });
  });
});

describe('regle — lancement refuse si le salon n est pas plein', () => {
  it('refuse avec lobby_not_full, puis accepte une fois les 6 places prises', () => {
    const server = newServer();
    const lobby = server.create(player(1));
    expect(server.start('p1')).toEqual({ ok: false, error: 'lobby_not_full' });

    fillWithBots(server, 'p1', server.getLobby(lobby.code)!);
    expect(isLobbyFull(server.getLobby(lobby.code)!)).toBe(true);
    expect(server.start('p1')).toEqual({ ok: true });
  });
});

describe('regle — commande de gestion refusee pour un non-hote', () => {
  it('refuse addBot, setBotDifficulty, removeBot, kick et start avec not_host', () => {
    const server = newServer();
    const lobby = server.create(player(1));
    server.addBot('p1', 1, 'easy');
    server.join(player(2), lobby.code);

    expect(server.addBot('p2', 3, 'easy')).toEqual({ ok: false, error: 'not_host' });
    expect(server.setBotDifficulty('p2', 1, 'hard')).toEqual({ ok: false, error: 'not_host' });
    expect(server.removeBot('p2', 1)).toEqual({ ok: false, error: 'not_host' });
    expect(server.kick('p2', 0)).toEqual({ ok: false, error: 'not_host' });
    expect(server.start('p2')).toEqual({ ok: false, error: 'not_host' });
  });

  it("refuse avec not_in_lobby un joueur qui n'est dans aucun salon", () => {
    const server = newServer();
    expect(server.addBot('inconnu', 1, 'easy')).toEqual({ ok: false, error: 'not_in_lobby' });
    expect(server.start('inconnu')).toEqual({ ok: false, error: 'not_in_lobby' });
  });
});

describe('regle — salon plein', () => {
  it('refuse une connexion supplementaire avec full', () => {
    const server = newServer();
    const lobby = server.create(player(1));
    for (let i = 2; i <= LOBBY_SIZE; i++) {
      expect(server.join(player(i), lobby.code).ok).toBe(true);
    }
    expect(occupiedCount(server.getLobby(lobby.code)!)).toBe(LOBBY_SIZE);
    expect(server.join(player(99), lobby.code)).toEqual({ ok: false, error: 'full' });
  });

  it('refuse un bot sur une place deja occupee avec slot_not_empty', () => {
    const server = newServer();
    server.create(player(1));
    expect(server.addBot('p1', 0, 'easy')).toEqual({ ok: false, error: 'slot_not_empty' });
  });
});

describe('regle — exclusion puis tentative de retour', () => {
  it("exclut l'humain, libere sa place et lui interdit de revenir", () => {
    const server = newServer();
    const lobby = server.create(player(1));
    server.join(player(2), lobby.code);

    const events: LobbyEvent[] = [];
    server.subscribe('p2', (e) => events.push(e));

    expect(server.kick('p1', 1)).toEqual({ ok: true });
    expect(events).toContainEqual({ type: 'kicked' });
    expect(server.getLobby(lobby.code)!.slots[1]?.occupant.kind).toBe('empty');
    // Ce salon-la lui reste ferme.
    expect(server.join(player(2), lobby.code)).toEqual({ ok: false, error: 'kicked' });
  });

  it("empeche l'hote de s'exclure lui-meme", () => {
    const server = newServer();
    server.create(player(1));
    expect(server.kick('p1', 0)).toEqual({ ok: false, error: 'slot_not_human' });
    expect(server.getLobby(server.listLobbies()[0]!.code)).not.toBeNull();
  });

  it('refuse kick sur une place vide ou occupee par un bot', () => {
    const server = newServer();
    server.create(player(1));
    server.addBot('p1', 1, 'easy');
    expect(server.kick('p1', 2)).toEqual({ ok: false, error: 'slot_not_human' });
    expect(server.kick('p1', 1)).toEqual({ ok: false, error: 'slot_not_human' });
  });
});

describe('regle — depart d un invite, place reprise par le suivant', () => {
  it('rend la place vide sans decaler personne, et le suivant la reprend avec le meme index', () => {
    const server = newServer();
    const lobby = server.create(player(1));
    server.join(player(2), lobby.code); // place 1
    server.join(player(3), lobby.code); // place 2

    server.leave('p2');
    const after = server.getLobby(lobby.code)!;
    expect(after.slots[1]?.occupant.kind).toBe('empty');
    // p3 n'a PAS bouge : ni de place, ni donc de couleur.
    expect(after.slots[2]?.occupant).toMatchObject({ kind: 'human', playerId: 'p3' });

    server.join(player(4), lobby.code);
    const refilled = server.getLobby(lobby.code)!;
    // Le nouvel arrivant reprend exactement l'index libere, donc la couleur.
    expect(refilled.slots[1]?.occupant).toMatchObject({ kind: 'human', playerId: 'p4' });
    expect(refilled.slots[2]?.occupant).toMatchObject({ kind: 'human', playerId: 'p3' });
  });
});

describe('regle — depart de l hote', () => {
  it('emet dissolved a tout le monde et supprime le salon', () => {
    const server = newServer();
    const lobby = server.create(player(1));
    server.join(player(2), lobby.code);

    const hostEvents: LobbyEvent[] = [];
    const guestEvents: LobbyEvent[] = [];
    server.subscribe('p1', (e) => hostEvents.push(e));
    server.subscribe('p2', (e) => guestEvents.push(e));

    server.leave('p1');
    expect(guestEvents).toContainEqual({ type: 'dissolved' });
    expect(hostEvents).toContainEqual({ type: 'dissolved' });
    expect(server.getLobby(lobby.code)).toBeNull();
  });
});

describe('regle — code introuvable apres lancement', () => {
  it('detruit le salon au lancement et emet gameStarting avec la composition figee', () => {
    const server = newServer();
    const lobby = server.create(player(1));
    server.join(player(2), lobby.code);
    fillWithBots(server, 'p1', server.getLobby(lobby.code)!);

    const events: LobbyEvent[] = [];
    server.subscribe('p2', (e) => events.push(e));

    expect(server.start('p1')).toEqual({ ok: true });

    const starting = events.find((e) => e.type === 'gameStarting');
    expect(starting).toBeDefined();
    // La composition envoyee est bien complete et figee.
    if (starting?.type === 'gameStarting') {
      expect(isLobbyFull(starting.lobby)).toBe(true);
      expect(starting.lobby.slots).toHaveLength(LOBBY_SIZE);
    }

    expect(server.getLobby(lobby.code)).toBeNull();
    expect(server.join(player(3), lobby.code)).toEqual({ ok: false, error: 'not_found' });
  });

  it('renvoie not_found sur un code jamais cree', () => {
    const server = newServer();
    expect(server.join(player(1), 'ZZZZ')).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('gestion des bots', () => {
  it('change la difficulte et retire un bot', () => {
    const server = newServer();
    server.create(player(1));
    server.addBot('p1', 1, 'easy');
    expect(server.setBotDifficulty('p1', 1, 'hard')).toEqual({ ok: true });
    expect(server.getLobby(server.listLobbies()[0]!.code)!.slots[1]?.occupant).toEqual({
      kind: 'bot',
      difficulty: 'hard',
    });
    expect(server.removeBot('p1', 1)).toEqual({ ok: true });
    expect(server.getLobby(server.listLobbies()[0]!.code)!.slots[1]?.occupant.kind).toBe('empty');
  });

  it('refuse setBotDifficulty et removeBot sur une place qui n est pas un bot', () => {
    const server = newServer();
    server.create(player(1));
    expect(server.setBotDifficulty('p1', 0, 'hard')).toEqual({ ok: false, error: 'slot_not_bot' });
    expect(server.removeBot('p1', 2)).toEqual({ ok: false, error: 'slot_not_bot' });
  });
});

describe('diffusion de l etat', () => {
  it("envoie l'etat COMPLET a chaque changement, jamais de delta", () => {
    const server = newServer();
    const lobby = server.create(player(1));
    const events: LobbyEvent[] = [];
    server.subscribe('p1', (e) => events.push(e));

    server.addBot('p1', 1, 'easy');
    server.join(player(2), lobby.code);

    const states = events.filter((e) => e.type === 'state');
    expect(states.length).toBeGreaterThanOrEqual(2);
    for (const e of states) {
      if (e.type !== 'state') continue;
      expect(e.lobby.slots).toHaveLength(LOBBY_SIZE);
      expect(e.lobby.code).toBe(lobby.code);
    }
  });

  it("ne rend jamais une reference sur l'etat interne", () => {
    const server = newServer();
    const lobby = server.create(player(1));
    // Muter ce qu'on a recu ne doit rien changer cote serveur.
    lobby.slots[3] = { index: 3, occupant: { kind: 'bot', difficulty: 'hard' } };
    expect(server.getLobby(lobby.code)!.slots[3]?.occupant.kind).toBe('empty');
  });
});

describe('client mock', () => {
  it('impose une latence : aucune commande ne peut etre presumee immediate', async () => {
    vi.useFakeTimers();
    try {
      const server = newServer();
      const client = createMockLobbyClient(server, player(1));

      let settled = false;
      const promise = client.create().then(() => {
        settled = true;
      });

      // Avant l'echeance, rien n'a eu lieu : une UI optimiste se trahirait ici.
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      expect(server.listLobbies()).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(200);
      await promise;
      expect(settled).toBe(true);
      expect(server.listLobbies()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("permet de s'abonner AVANT la connexion et recoit le premier state", async () => {
    const server = newServer();
    const client = createMockLobbyClient(server, player(1));
    const events: LobbyEvent[] = [];
    client.subscribe((e) => events.push(e));

    await client.create();
    expect(events.filter((e) => e.type === 'state')).toHaveLength(1);
  });

  it('normalise le code saisi', async () => {
    const server = newServer();
    const host = createMockLobbyClient(server, player(1));
    const lobby = await host.create();
    const guest = createMockLobbyClient(server, player(2));
    const res = await guest.join(` ${lobby.code.toLowerCase()}  `);
    expect(res.ok).toBe(true);
  });
});
