import { LOBBY_SIZE, type BotDifficulty, type Lobby, type MockPlayer } from '@tower-defense/lobby';
import { devOnlyMockServer } from './lobbyClient.js';

/**
 * Controles de dev du salon (console navigateur). Ils pilotent le MEME serveur
 * mock que l'UI, ce qui permet de simuler les autres joueurs sans ouvrir
 * plusieurs onglets ni monter un vrai back.
 *
 * Chargement dynamique derriere `import.meta.env.DEV` cote appelant (voir
 * launcher.ts), meme motif que dev.ts : ce module est absent du bundle de prod.
 *
 * Ces controles court-circuitent volontairement `LobbyClient` et parlent au
 * serveur directement — c'est le seul endroit du front autorise a le faire,
 * justement parce qu'ils jouent le role des AUTRES clients.
 */

declare global {
  interface Window {
    __lobbyDev?: {
      createFakeLobby(guests?: number, bots?: number): string;
      joinFake(code: string, n?: number): string;
      leaveSlot(code: string, slotIndex: number): void;
      kickSlot(code: string, slotIndex: number): void;
      startAsHost(code: string): void;
      list(): Lobby[];
    };
  }
}

/** Faux joueurs : ids stables et lisibles, pour qu'un test manuel puisse
 * raisonner sur « qui est en place 3 » sans rien noter. */
function fake(n: number): MockPlayer {
  return { id: `fake-${n}`, displayName: `Bot_Humain${n}#${900 + n}` };
}

export function installLobbyDevTools(): void {
  const server = devOnlyMockServer();

  window.__lobbyDev = {
    /**
     * Cree un salon tenu par un FAUX hote, avec N faux invites et M bots. Le
     * vrai joueur rejoint ensuite par le code, en INVITE — c'est le seul moyen
     * de tester la vue invite, l'exclusion et la dissolution, puisque « Créer
     * un salon » fait toujours de toi l'hote.
     */
    createFakeLobby(guests = 0, bots = 0) {
      const host = fake(0);
      const lobby = server.create(host);
      for (let i = 1; i <= guests; i++) server.join(fake(i), lobby.code);
      let placed = 0;
      for (const slot of server.getLobby(lobby.code)?.slots ?? []) {
        if (placed >= bots) break;
        if (slot.occupant.kind !== 'empty') continue;
        const difficulty: BotDifficulty = 'medium';
        server.addBot(host.id, slot.index, difficulty);
        placed++;
      }
      console.log(`[lobbyDev] salon ${lobby.code} — hote ${host.displayName}, ${guests} invite(s), ${placed} bot(s)`);
      return lobby.code;
    },

    joinFake(code, n = Math.floor(Math.random() * 1000)) {
      const p = fake(n);
      const res = server.join(p, code);
      console.log(`[lobbyDev] ${p.displayName} rejoint ${code} :`, res.ok ? 'ok' : res.error);
      return p.id;
    },

    /** Fait partir l'occupant de la place i. i = 0 est l'hote, donc dissout le
     * salon — il n'y a pas de delai de grace dans le mock. */
    leaveSlot(code, slotIndex) {
      const lobby = server.getLobby(code);
      const occupant = lobby?.slots[slotIndex]?.occupant;
      if (!occupant || occupant.kind !== 'human') {
        console.warn(`[lobbyDev] place ${slotIndex} de ${code} : aucun humain`);
        return;
      }
      server.leave(occupant.playerId);
      console.log(
        `[lobbyDev] ${occupant.displayName} quitte ${code}` +
          (slotIndex === 0 ? ' — hote parti, salon dissous' : ''),
      );
    },

    kickSlot(code, slotIndex) {
      const lobby = server.getLobby(code);
      if (!lobby) {
        console.warn(`[lobbyDev] salon ${code} introuvable`);
        return;
      }
      const res = server.kick(lobby.hostId, slotIndex);
      console.log(`[lobbyDev] exclusion place ${slotIndex} :`, res.ok ? 'ok' : res.error);
    },

    startAsHost(code) {
      const lobby = server.getLobby(code);
      if (!lobby) {
        console.warn(`[lobbyDev] salon ${code} introuvable`);
        return;
      }
      const res = server.start(lobby.hostId);
      console.log(`[lobbyDev] lancement :`, res.ok ? 'ok' : res.error);
    },

    list() {
      const all = server.listLobbies();
      for (const l of all) {
        const occupied = l.slots.filter((s) => s.occupant.kind !== 'empty').length;
        console.log(`[lobbyDev] ${l.code} — ${occupied}/${LOBBY_SIZE}, hote ${l.hostId}`);
      }
      return all;
    },
  };

  console.log(
    '[lobbyDev] window.__lobbyDev pret : createFakeLobby(invites, bots), joinFake(code), ' +
      'leaveSlot(code, i), kickSlot(code, i), startAsHost(code), list()',
  );
}
