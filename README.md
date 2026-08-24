# Tower Defense

Reproduction web d'une map de tower defense multijoueur historique. Un moteur
de simulation pur et déterministe (`packages/sim`) tourne pour toutes les
arènes en permanence ; un client web en 3D (Three.js) permet de jouer contre
des bots et d'observer les arènes adverses, un serveur d'identification
(pseudo invité ou compte email) sert de porte d'entrée, et un runner headless
sert à mesurer l'équilibrage en accéléré, sans rendu.

## Démarrer

```bash
pnpm install

pnpm test           # tests de déterminisme et de règles
pnpm headless 200   # 200 parties bot contre bot, en accéléré (2e argument optionnel : easy|medium|hard, 3e : effectif, défaut 6)
pnpm typecheck

pnpm dev            # client web seul (proxy /api vers le serveur, voir plus bas)
pnpm dev:server     # serveur d'identification seul
pnpm dev:all        # les deux ensemble
```

Le serveur a besoin d'une base PostgreSQL. En local, `docker-compose.yml` à la
racine en démarre une (`docker compose up -d`) sur un port non-standard pour
ne pas entrer en conflit avec une instance déjà installée. Copier
`apps/server/.env.example` en `apps/server/.env` et ajuster `DATABASE_URL` si
besoin, puis :

```bash
pnpm --filter @tower-defense/server exec prisma migrate dev
```

## Structure

```
packages/data       données extraites de la map d'origine + surcharges d'équilibrage
packages/sim        moteur pur : tick(state, commands) -> events
packages/renderer   géométrie procédurale 3D des tours (Three.js), indépendante du DOM
apps/headless       runner de parties en accéléré, sans rendu
apps/web            client jouable (Three.js), launcher + partie solo contre des bots
apps/server         identification (invité ou email/mot de passe), NestJS + Prisma + PostgreSQL
```

`packages/data/src/map_data.json` est la **référence fidèle** de l'original et
n'est jamais modifié. Tout changement d'équilibrage passe par `balance.json`,
qui l'écrase à la volée — c'est le fichier à ajuster en jouant.

## Le contrat du moteur

```ts
const state = createGame(seed, playerCount);
const events = tick(state, commands);
```

- Timestep fixe à 20 Hz. Le temps est toujours un entier de ticks, jamais un
  delta flottant — c'est ce qui garantit le déterminisme.
- Aucun `Math.random` ni `Date.now` dans `packages/sim`. Le PRNG est seedé et
  son état vit dans le state, donc il se sérialise avec (le bot a son propre
  PRNG interne, jamais `Math.random` non plus).
- L'état est plat et sérialisable en JSON tel quel.
- `tick` mute l'état en place. Pour un snapshot : `structuredClone(state)`.
- **Toutes les arènes sont simulées à chaque tick, tout le temps** — que le
  client les affiche ou non. Le coût mesuré est négligeable (~0,03 ms/tick sur
  une partie à 6 joueurs avec 180 creeps et 109 tours). C'est ce qui permet au
  client de faire naviguer le joueur entre les arènes sans jamais mettre la
  simulation en pause.

Le déterminisme n'est **pas** nécessaire au netcode (pas de serveur de jeu
autoritaire pour l'instant, voir plus bas) — il sert à rendre les analyses
d'équilibrage reproductibles d'une exécution à l'autre.

## Client web (`apps/web`)

Écran d'accueil (pseudo ou connexion) puis menu (`apps/web/src/launcher.ts`) ;
`startGame()` (`main.ts`) lance une partie locale contre bots dans le markup
existant et peut être rappelée sans recharger la page (retour à l'accueil,
Rejouer) — elle libère alors proprement la scène 3D précédente
(`disposeScene3D`) avant d'en recréer une.

**Navigation entre arènes** : une barre de pastilles (une par joueur, couleur
+ libellé + vies restantes) permet d'observer n'importe quelle arène adverse
pendant que la sienne continue de tourner. Le rendu bascule sans recharger le
décor ni recréer de géométrie : chaque joueur a sa propre instance
`TowerEntities`/`CreepEntities` (son propre sous-groupe Three.js), synchronisée
à chaque frame que son arène soit affichée ou non — changer de vue n'est
qu'un changement de visibilité. Aucune action n'est possible sur une arène
qu'on ne contrôle pas ; le HUD continue d'afficher les valeurs de sa propre
arène en toutes circonstances.

L'interpolation entre deux ticks de simulation (20 Hz) n'existe pas encore
côté rendu (60 Hz) : le mouvement des creeps est donc discret, pas lissé.
Chantier séparé, pas encore traité.

## Serveur (`apps/server`)

NestJS + Prisma + PostgreSQL, monté à la main (pas de scaffold `nest new`) ;
`apps/server/tsconfig.json` est autonome, il n'étend pas `tsconfig.base.json`
(NestJS a besoin des décorateurs legacy et de CommonJS, incompatibles avec le
reste du monorepo). Routes sous `/api/auth` : création d'un compte invité par
pseudo, connexion email/mot de passe, rattachement d'un email à un compte
invité existant, déconnexion, profil courant. Session par cookie `httpOnly`
(90 jours), mot de passe haché en argon2id. Rate limiting par IP sur les
routes non authentifiées (`@nestjs/throttler`).

## Équilibrage actuel

Tout dans `packages/data/src/balance.json`, jamais dans `map_data.json`.

- **Bots** (`packages/sim/src/bot.ts`) : trois niveaux de difficulté
  (`easy`/`medium`/`hard`, défaut `medium`) qui ne changent que la
  *compétence* — vitesse de décision, tri des emplacements de construction
  par distance au chemin, réaction aux vagues aériennes. La *personnalité*
  (agressivité, branche de tour préférée) est tirée du RNG propre du bot,
  indépendamment du niveau : un bot agressif n'est pas plus fort, juste
  différent. `pnpm headless [parties] [difficulté] [effectif]` mesure
  l'effet (effectif par défaut : 6, la taille de lobby retenue pour le jeu).
- **Règles** : vies de départ 30, revenu de départ 60/round, prime de mise à
  mort 15 % du coût du creep tué, vitesse des creeps -30 % par rapport à
  l'original.
- **Tours** : branche Cannon (Arrow Tower → … → Mega Cannon Tower) +15 % de
  dégâts. Branche `o008`-`o00B`, renommée (Répétiteur, Baliste double, Orgue
  de tir, Fauchoir — les anciens noms venaient de la map d'origine et
  n'avaient plus de rapport avec ce que la tour est devenue), ne cible plus
  l'air (c'est la branche Lightning qui répond à l'aérien, accessible dès
  60 or) et fait +40 % de dégâts par rapport à son rééquilibrage précédent —
  environ 2,4× le DPS du Cannon à palier comparable, volontaire : elle est
  mono-cible là où le Cannon frappe en zone.
- Trois branches sur six ont une ability (`packages/sim/src/status.ts`) :
  ralentissement de zone (Ice, deux sources s'additionnent jusqu'à
  `SLOW_CAP`), poison mono-cible qui ignore l'armure (Poison), chaîne
  d'éclair à rebonds décroissants sur cibles aériennes uniquement (Lightning).

### Économie

Le revenu d'un joueur a deux sources : l'income versé à chaque round (le gros
du revenu), et la prime de mise à mort — quand un creep meurt dans l'arène
d'un joueur, ce joueur reçoit `rules.bountyPct` de son coût en or (arrondi au
supérieur, minimum 1). C'est le propriétaire de l'arène qui est payé, jamais
l'envoyeur ; un creep qui leak, ou qui est engendré par la mort d'un autre
(Porte-essaim), ne rapporte rien. `arena.goldFromBounty` et
`arena.goldFromIncome` cumulent chaque source séparément — c'est ce que
`pnpm headless` utilise pour afficher la part du revenu qui vient de la
défense plutôt que de l'income pur.

## Emplacements de construction

Une tour ne se pose pas n'importe où dans la zone constructible : elle se
pose sur un **emplacement** précis, défini dans
`packages/data/src/build_slots.json` (317 par arène, regroupés en
rangées/colonnes nommées — grille pleine à l'intérieur du U, bandes collées
au chemin sur les bras et le connecteur).

- `packages/data/scripts/gen_slots.ts` régénère le layout à partir de
  `packages/data/src/zoneFootprints.ts` (géométrie du couloir de la lane 0,
  les 8 arènes sont des copies translatées) ; le JSON produit peut aussi être
  modifié à la main sans toucher au code.
- `packages/data/src/slots.ts` expose `buildSlots(player)` (emplacements
  d'une arène, coordonnées déjà translatées) et `nearestSlot(player, x, y)`
  (l'emplacement le plus proche d'un clic, ou `null` au-delà d'une case de
  distance).
- Dans `packages/sim/src/sim.ts`, `buildTower` snap sur `nearestSlot()` : la
  tour prend la position exacte de l'emplacement, jamais celle du clic — ce
  qui garde la sim déterministe. L'occupation est suivie par
  `arena.occupied`, indexée par l'id stable de l'emplacement, libérée à la
  vente.

## Ce qui n'est pas (encore) implémenté

- Les tours ne bloquent pas le passage (pas de maze dans l'original), le
  Peasant n'est pas modélisé (la construction est directe), et les
  prérequis entre tours ne sont pas vérifiés (un joueur avec assez d'or peut
  construire la tour la plus chère sans passer par les précédentes).
- Pas de serveur de jeu autoritaire ni de WebSocket : la partie tourne
  entièrement dans l'onglet du navigateur, contre des bots.
- Interpolation de rendu entre deux ticks (voir plus haut).

## Points d'équilibrage identifiés, pas encore traités

- L'Arrow Tower (racine de la branche Cannon) domine largement les
  statistiques de victoire de `pnpm headless` malgré les rééquilibrages
  successifs des autres branches.
- `o006` (Ultra Disease Tower, sommet de la branche Poison) a un cooldown de
  0,05 s — potentiellement aussi disproportionné que ne l'était la branche
  mitrailleuse avant son rééquilibrage, jamais mesuré isolément.
- `h00T` (Hydrogen Fusion Tower, palier suivant de la Nuclear Tower) a une
  portée de 2000, largement au-dessus de la borne visée ailleurs (900 max
  sur les autres branches).

