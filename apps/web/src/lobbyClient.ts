import {
  MockLobbyServer,
  createMockLobbyClient,
  type LobbyClient,
  type MockPlayer,
} from '@tower-defense/lobby';
import type { PublicUser } from './api.js';

/**
 * POINT D'INJECTION UNIQUE entre le salon et sa couche transport.
 *
 * Tout le reste du front ne connait que l'interface `LobbyClient`. Brancher le
 * vrai serveur le jour venu ne demande donc de toucher QUE ce fichier :
 * remplacer le corps de `createLobbyClient` par la construction du client
 * reseau (WebSocket ou autre), sans qu'une seule ligne d'UI ne change.
 *
 * Le serveur mock est un singleton de module : les controles de dev ont besoin
 * de piloter les MEMES salons que l'UI pour simuler les autres joueurs dans un
 * seul onglet. Avec un vrai serveur, ce singleton disparaitra avec le reste.
 */
const mockServer = new MockLobbyServer();

/** Nom affiche d'un joueur, seule mise en forme du pseudo dans le salon —
 * meme convention que l'ecran d'accueil (voir renderMenuScreen). */
export function displayNameOf(user: PublicUser): string {
  return `${user.pseudo}#${user.joinNumber}`;
}

function toMockPlayer(user: PublicUser): MockPlayer {
  return { id: user.id, displayName: displayNameOf(user) };
}

export function createLobbyClient(user: PublicUser): LobbyClient {
  return createMockLobbyClient(mockServer, toMockPlayer(user));
}

/**
 * Acces au serveur mock, POUR LES CONTROLES DE DEV UNIQUEMENT (voir
 * lobbyDev.ts). L'UI n'en a pas besoin et ne doit jamais s'en servir : elle
 * passe par `LobbyClient`, sans quoi elle ne serait plus portable vers le vrai
 * serveur. Disparaitra avec le mock.
 */
export function devOnlyMockServer(): MockLobbyServer {
  return mockServer;
}
