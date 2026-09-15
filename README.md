# Tower Defense

Reproduction web d'une map de tower defense multijoueur historique. Un moteur
de simulation pur et déterministe (`packages/sim`) tourne pour toutes les
arènes en permanence ; un client web en 3D (Three.js) permet de jouer contre
des bots et d'observer les arènes adverses, un serveur d'identification
(pseudo invité ou compte email) sert de porte d'entrée, et un runner headless
sert à mesurer l'équilibrage en accéléré, sans rendu.

Ce fichier est la **référence d'architecture**. `CLAUDE.md` est la consigne de
travail courte ; celui-ci explique les contrats et les raisons.

## Démarrer

```bash
pnpm install

pnpm test          # tests de déterminisme et de règles
pnpm typecheck     # tsc --noEmit sur tout le monorepo
pnpm headless 20   # 20 parties bot contre bot (2e arg : easy|medium|hard, 3e : effectif)

pnpm dev           # client web seul   -> http://localhost:5173
pnpm dev:server    # serveur seul      -> http://localhost:3000 (routes sous /api)
pnpm dev:all       # les deux ensemble
```

Le client proxie `/api` vers `http://localhost:3000` (voir
`apps/web/vite.config.ts`) : lancer les deux, ou `pnpm dev:all`.

Le serveur a besoin d'une base PostgreSQL. En local, `docker-compose.yml` à la
racine en démarre une (`docker compose up -d`) sur un port non-standard pour
ne pas entrer en conflit avec une instance déjà installée. Copier
`apps/server/.env.example` en `apps/server/.env` et ajuster `DATABASE_URL` si
besoin, puis :

```bash
pnpm --filter @tower-defense/server exec prisma migrate dev
```

Outils de développement du client, tous opt-in par paramètre d'URL :

| Paramètre | Effet |
|---|---|
| `?dev=1` | outils console (`window.__dev`, `window.__lobbyDev`) et contrôles de vitesse Pause/1x/2x/4x |
| `?perf=1` | instrumentation ; rapport via `window.__perf.getReport()` |
| `?seed=N` | rejoue exactement la même partie d'un lancement à l'autre |

`?dev=1` n'a d'effet que sur un serveur de développement : les modules
concernés sont derrière `import.meta.env.DEV`, donc élagués du bundle de
production — ils n'y sont pas seulement inactifs, ils ne sont pas livrés.

## Structure

```
packages/data       données extraites de la map d'origine + surcharges d'équilibrage
packages/sim        moteur pur : tick(state, commands) -> events
packages/renderer   géométrie procédurale 3D des tours (Three.js), indépendante du DOM
packages/lobby      contrat du salon privé + implémentation en mémoire
apps/headless       runner de parties en accéléré, sans rendu
apps/web            client jouable (Three.js), launcher + partie solo contre des bots
apps/server         identification (invité ou email/mot de passe), NestJS + Prisma + PostgreSQL
```

`packages/data/src/map_data.json` est la **référence fidèle** de l'original et
n'est jamais modifié. Tout changement d'équilibrage passe par `balance.json`,
qui l'écrase à la volée — c'est le fichier à ajuster en jouant.

Les données source décrivent 8 arènes ; le format du jeu est verrouillé à
**6 joueurs** (`rules.maxPlayers`, surchargé dans `balance.json`). Les lanes 6
et 7 restent présentes, simplement inutilisées.

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
- L'état est plat et sérialisable en JSON tel quel. Conséquence pratique :
  `hashState()` couvre tout nouvel état ajouté à `GameState` sans code dédié,
  et le client qui observe une arène adverse lit cet état tel quel au lieu de
  le reconstruire.
- `tick` mute l'état en place. Pour un snapshot : `structuredClone(state)`.
- **Toutes les arènes sont simulées à chaque tick, tout le temps** — que le
  client les affiche ou non. Le coût mesuré est négligeable (~0,03 ms/tick sur
  une partie à 6 joueurs avec 180 creeps et 109 tours). C'est ce qui permet au
  client de faire naviguer le joueur entre les arènes sans jamais mettre la
  simulation en pause.

Le déterminisme n'est **pas** nécessaire au netcode (pas de serveur de jeu
autoritaire pour l'instant, voir plus bas) — il sert à rendre les analyses
d'équilibrage reproductibles d'une exécution à l'autre.

Toute égalité doit être départagée par une règle stable et explicite (index de
joueur, index d'emplacement), jamais par l'ordre d'itération d'une `Map`.

## L'ouvrier

Une tour n'apparaît pas au clic. Chaque arène a un **ouvrier**
(`packages/sim/src/builder.ts`), un par joueur et donc six, bots compris, qui
se rend sur place avant de construire. Le temps de trajet est une mécanique :
construire loin coûte du temps, et l'ordre dans lequel on construit devient un
moyen indirect de placer son ouvrier pour la suite.

- **Déplacement en ligne droite, aucun pathfinding.** Les tours ne bloquent
  pas : à l'échelle de rendu le recouvrement ne se voit pas, et les rendre
  bloquantes créerait une mécanique absurde où mieux on construit, plus son
  ouvrier est gêné.
- **Le seul obstacle est le couloir des creeps**, franchi en vol. Le test
  porte sur la géométrie *fixe* du chemin (`packages/data/src/builder.ts`,
  cinq rectangles dérivés des waypoints), jamais sur une notion de « bloqué »
  qui n'existe pas. Un trajet qui recoupe le couloir redécolle à chaque fois,
  sans état conservé entre les ticks.
- **L'or est débité au clic et l'emplacement réservé** dès la planification.
  Cette réservation est structurante : les bots choisissent leur case via
  `!arena.occupied`, ils héritent donc de la règle sans code dédié.
- **File de 5 constructions** au maximum (`rules.builderQueueMax`), celle en
  cours comprise. Un ordre au-delà est refusé sans rien débiter.
- **Annulation** (`cancelBuildQueue`) : rembourse à 100 % les ordres
  planifiés et libère leurs emplacements. Celle en cours va au bout et n'est
  pas remboursée — « en cours » signifie `mode === 'building'`, un ordre vers
  lequel l'ouvrier marche encore est annulable.
- **Il ne retourne nulle part** une fois la file vide : il reste exactement là
  où il a fini.
- Il ne combat pas, n'a pas de points de vie, ne peut pas être ciblé ni
  perturbé. Il n'apparaît dans aucune boucle de combat.

Un détail assumé : pour la rangée d'emplacements qui borde le chemin, la
distance d'arrêt (49,6) dépasse l'écart entre l'emplacement et le bord du
ruban (39). L'ouvrier construit donc ces cases en se tenant d'une dizaine
d'unités sur le couloir. `packages/sim/test/builder.test.ts` le documente pour
que ce ne soit pas pris pour un bug.

Réglages, tous dans `balance.json` :

| Clé | Valeur | Rôle |
|---|---|---|
| `builderGroundSpeed` | 192 | vitesse au sol, unités monde/s (≈ celle d'un creep) |
| `builderFlySpeed` | 320 | vitesse en survol du couloir |
| `builderBuildSec` | 3 | durée de construction, identique pour toutes les tours |
| `builderQueueMax` | 5 | taille de la file |
| `builderRadius` | 9,6 | recul par rapport au centre de l'emplacement |
| `builderFlyMargin` | 16 | piste de décollage avant le bord du couloir |

Les vitesses sont en **unités monde**, la seule unité que connaît la
simulation. Le rendu applique `WORLD_TO_SCENE = 2/64` par-dessus : 192 et 320
valent 6 et 10 unités de scène par seconde. Une durée de construction
proportionnelle au prix a été écartée — elle punirait deux fois les tours
chères.

## Client web (`apps/web`)

Écran d'accueil (pseudo ou connexion) puis menu (`launcher.ts`) ; `startGame()`
(`main.ts`) lance une partie locale contre bots dans le markup existant et peut
être rappelée sans recharger la page (retour à l'accueil, Rejouer) — elle
libère alors proprement la scène 3D précédente (`disposeScene3D`) avant d'en
recréer une.

**Choix de l'ouvrier** : un panneau accessible depuis l'accueil
(`renderBuilderScreen`) laisse choisir parmi le catalogue de
`apps/web/src/builders.ts`, vignette à l'appui. C'est une préférence qui vaut
pour toutes les parties — enregistrée dans `localStorage` au clic, sans étape
de validation, et relue au lancement de la partie suivante. Panneau à part et
non liste posée sur l'accueil : le catalogue est fait pour grandir, et une
liste qui s'allonge repousserait « Jouer » hors de l'écran. L'accueil affiche
le choix courant pour qu'il se lise sans ouvrir le panneau.

Ce panneau et celui de la difficulté partagent les mêmes règles CSS
(`.choice-*`) : même forme, une liste de radios décrites d'une ligne.

**Navigation entre arènes** : une barre de pastilles (une par joueur, couleur
+ libellé + vies restantes) permet d'observer n'importe quelle arène adverse
pendant que la sienne continue de tourner. Le rendu bascule sans recharger le
décor ni recréer de géométrie : chaque joueur a sa propre instance
`TowerEntities`/`CreepEntities` (son propre sous-groupe Three.js), synchronisée
à chaque frame que son arène soit affichée ou non — changer de vue n'est qu'un
changement de visibilité. Aucune action n'est possible sur une arène qu'on ne
contrôle pas ; le HUD continue d'afficher les valeurs de sa propre arène en
toutes circonstances.

L'ouvrier fait exception à ce schéma : **un seul objet pour toute la partie**,
puisqu'on n'en voit jamais qu'un à la fois. Changer d'arène le repositionne et
le reteint au lieu d'en créer un second.

**Barre de commandes** (bas de l'écran, hauteur fixe de 182 px) : trois modes
exclusifs — construction, envoi de creeps, abilités — un panneau d'information
à gauche, les ressources à droite, et la colonne de modes au centre droit. Le
compteur de la file de construction y est un badge sur le bouton Construction,
avec son bouton d'annulation juste en dessous. Convention du projet :
**jamais de rouge** pour signaler une indisponibilité, jaune et vert
uniquement.

**Lecture de la construction** : dès qu'un ordre est planifié, la tour visée
apparaît en translucide sur son emplacement (`buildPreview.ts`). Quand
l'ouvrier commence à bâtir, cet aperçu *devient* le chantier — couleurs
pleines, échafaudage, croissance, poussière — pendant exactement
`builderBuildSec`, et la tour réelle apparaît déjà finie. L'avancement est lu
sur la simulation (`buildTicksLeft`), pas accumulé image par image : arriver
en cours de chantier le reprend à son avancement réel, et rien ne dérive en
x2 ou x4. Les ordres *planifiés* ne sont montrés que sur sa propre arène (ils
révéleraient les intentions d'un adversaire) ; le chantier *en cours*, lui,
est visible partout.

L'interpolation entre deux ticks de simulation (20 Hz) n'existe pas encore
côté rendu (60 Hz) : le mouvement des creeps est donc discret, pas lissé.
Chantier séparé, pas encore traité.

## Assets 3D

| Dossier | Contenu |
|---|---|
| `public/models/towers/` | 27 `.glb`, un par palier, rangés par slug de branche |
| `public/models/creeps/` | 36 `.glb` |
| `public/models/builders/` | les `.glb` d'ouvriers ; **seuls ceux inscrits dans `builders.ts` sont jouables** |
| `public/icons/` | vignettes 128×128 correspondantes |

Un `.glb` déposé dans `models/builders/` sans entrée dans `builders.ts` est
simplement ignoré : le catalogue fait foi, pas le contenu du dossier.

Aucun de ces modèles n'a de squelette : ce sont des assemblages de pièces
rigides animés par transformations de nœuds. Il n'y a donc **jamais de
`SkinnedMesh`** dans ce projet, et `SkeletonUtils` n'est pas nécessaire —
`clone(true)` suffit.

Trois pipelines distincts, pour trois contraintes différentes :

- **Tours** (`towerModel.ts` + `packages/renderer/src/towers/fromModel.ts`) :
  un modèle chargé une fois, cloné par tour, matériaux et géométries partagés.
  Repli sur la géométrie procédurale de `packages/renderer` si le `.glb`
  manque ou est illisible — **garder ce repli fonctionnel**.
- **Creeps** (`animatedCreepModel.ts`, `animatedCreepInstances.ts`) : fusionnés
  et rendus en `InstancedMesh`, parce qu'il peut y en avoir des centaines.
- **Ouvriers** (`builderModel.ts`, `builderEntity.ts`) : ni l'un ni l'autre.
  Un seul est visible, donc aucune instanciation, aucun cache de géométrie,
  aucune fusion — un `AnimationMixer` standard sur une hiérarchie clonée.

La **couleur du joueur** suit la convention `TeamColor` : le matériau portant
ce nom est repeint par instance. Les modèles d'ouvrier peuvent aussi déclarer
leurs métadonnées dans les `extras` du `.glb` (`teamColorMaterial`,
`actionProps`, `heightMeters`) — le chargeur les lit et ne connaît alors aucun
modèle en particulier. Attention : Three.js ne recopie **pas** les extras de la
racine du fichier, il faut les lire sur `gltf.parser.json.extras`.

Ajouter un ouvrier : déposer le `.glb` dans `models/builders/`, sa vignette
`<id>_builder_mini.png` dans `icons/builders/`, et une entrée dans
`apps/web/src/builders.ts`.

Les vignettes sont des **visuels dessinés**, comme toutes les icônes du
projet. À défaut, un dépannage rend le modèle depuis le `.glb` :

```bash
pnpm --filter @tower-defense/web gen-builder-icons
```

Le script est autonome (il sert lui-même les fichiers, aucun `pnpm dev`
requis), reprend l'éclairage du jeu et **ne remplace jamais une vignette
existante** sans `--force`. Il joue une image du clip `Idle` avant de rendre :
sans cela la hiérarchie reste en pose de bind, où *tous* les accessoires sont
déployés.

Une vignette livrée doit porter une **vraie couche alpha**. Un export qui
aplatit le damier de transparence dans les pixels affiche un carré blanc
quadrillé sur le fond sombre du panneau — c'est un défaut déjà rencontré sur
les icônes de creeps.

## Serveur (`apps/server`)

NestJS + Prisma + PostgreSQL, monté à la main (pas de scaffold `nest new`) ;
`apps/server/tsconfig.json` est autonome, il n'étend pas `tsconfig.base.json`
(NestJS a besoin des décorateurs legacy et de CommonJS, incompatibles avec le
reste du monorepo). Routes sous `/api/auth` et **rien d'autre pour l'instant** :
création d'un compte invité par pseudo, connexion email/mot de passe,
rattachement d'un email à un compte invité existant, déconnexion, profil
courant. Session par cookie `httpOnly` (90 jours), mot de passe haché en
argon2id. Rate limiting par IP sur les routes non authentifiées
(`@nestjs/throttler`).

## Salon privé (`packages/lobby`)

Salons de 6 places avec code à 4 caractères. `contract.ts` définit l'interface
sans rien présumer de l'implémentation, et n'importe **ni `sim` ni `data`** :
ces types décrivent ce qui circulera un jour sur le fil, pas l'état interne du
moteur. `mock.ts` en fournit une implémentation **en mémoire, côté client** —
il n'existe aucune route serveur de salon, deux navigateurs ne peuvent pas se
rejoindre aujourd'hui. Le jour où un client réseau arrivera, il devra
satisfaire exactement le même contrat.

L'alphabet des codes exclut I, O, 0 et 1 : un code se lit à voix haute ou se
recopie depuis une capture d'écran, et ces confusions sont la première source
d'erreur.

## Équilibrage actuel

Tout dans `packages/data/src/balance.json`, jamais dans `map_data.json`.

**Règles** : 30 vies, revenu de départ 60 par round (toutes les 30 s), prime de
mise à mort 15 % du coût du creep tué, vitesse des creeps −30 % par rapport à
l'original.

**Six branches de tours**, 28 tours au total, dont 6 constructibles
directement (les racines) :

| Branche | Paliers | Chaîne |
|---|---|---|
| Balistique | 5 | Tourelle → Canon → Canon lourd → Obusier → Canon à rail |
| Acide | 5 | Acide → Corrosive → Dissolvante → Nécrose → Solvant |
| Givre | 5 | Givre → Gel → Blizzard → Cryogène → Zéro absolu |
| Anti-aérien | 5 | Flak → Arc → Foudre → Orage → Tempête |
| Cadence | 5 | Répétiteur → Mitrailleuse → Gatling → Fauchoir → Moissonneuse |
| Réacteur | 2 | Réacteur → Soleil artificiel |

Prix et DPS dérivent d'une règle uniforme : l'efficacité en DPS par or est
divisée par 1,5 chaque fois que le prix est multiplié par 6. Le Réacteur est la
seule branche de fin de partie (30 000 puis 180 000 or) et n'a que deux
paliers, alignés sur les paliers 4-5 des autres ; c'est pour cela qu'il est
placé en dernier dans la barre d'achat.

**Trois branches ont une ability** (`packages/sim/src/status.ts`) :
ralentissement de zone (Givre, deux sources s'additionnent jusqu'à
`SLOW_CAP`), poison mono-cible qui ignore l'armure (Acide), chaîne d'éclair à
rebonds décroissants sur cibles aériennes uniquement (Anti-aérien).

**Trois boutiques d'envoi**, 12 unités chacune. Enrôlés est acquise dès le
départ (`unlockedShopTier` vaut 0) ; les deux suivantes se débloquent
*séquentiellement*, jamais en visant un palier précis — Augmentés à 2 000 or,
Machines à 20 000. Un creep d'une boutique non débloquée n'est pas « en
rupture » : il est inaccessible, et la barrière est dans la simulation, pas
seulement dans l'interface.

**Bots** (`packages/sim/src/bot.ts`) : trois niveaux (`easy`/`medium`/`hard`,
défaut `medium`) qui ne changent que la *compétence* — vitesse de décision,
placement selon la longueur de chemin couverte à portée, réaction aux vagues
aériennes. La *personnalité* (agressivité, composition préférée) est tirée du
RNG propre du bot, indépendamment du niveau : un bot agressif n'est pas plus
fort, juste différent. Chaque bot est plafonné à 200 tours simultanées, puis
continue les améliorations et les envois.

Les bots sont soumis **exactement aux mêmes règles que le joueur humain** :
même ouvrier, même file de 5, même délai de construction. Ils respectent ces
plafonds *à l'émission* — la convention du dépôt est qu'un bot n'émet jamais
une commande qu'il sait vouée au rejet, sans quoi sa comptabilité interne se
débiterait d'achats qui n'ont jamais eu lieu.

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

Acheter un creep achète surtout du **revenu permanent** : `income` augmente du
`pointValue` de l'unité envoyée. Le creep part chez tous les autres joueurs
vivants, jamais chez l'acheteur.

## Emplacements de construction

Une tour ne se pose pas n'importe où dans la zone constructible : elle se pose
sur un **emplacement** précis, défini dans `packages/data/src/build_slots.json`
(**236 par arène**, regroupés en rangées/colonnes nommées — grille pleine à
l'intérieur du U, bandes collées au chemin sur les bras et le connecteur).

- `packages/data/scripts/gen_slots.ts` régénère le layout à partir de
  `packages/data/src/zoneFootprints.ts` (géométrie du couloir de la lane 0,
  les autres arènes sont des copies translatées) ; le JSON produit peut aussi
  être modifié à la main sans toucher au code. **Le régénérer après tout
  changement de `SLOT_SIZE`**, et mettre à jour le nombre attendu dans
  `packages/sim/test/slots.test.ts`.
- `SLOT_SIZE` vaut 80 (il valait 64, d'où les 317 emplacements d'avant) :
  moins d'emplacements par arène, mais 25 % de place en plus par tour — c'est
  ce qui les rend visiblement plus imposantes que les creeps.
- `packages/data/src/slots.ts` expose `buildSlots(player)` (emplacements d'une
  arène, coordonnées déjà translatées) et `nearestSlot(player, x, y)`
  (l'emplacement le plus proche d'un clic, ou `null` au-delà d'une case).
- Dans `packages/sim/src/sim.ts`, `buildTower` snap sur `nearestSlot()` : la
  tour prend la position exacte de l'emplacement, jamais celle du clic — ce
  qui garde la sim déterministe. L'occupation est suivie par `arena.occupied`,
  indexée par l'id stable de l'emplacement, **marquée dès la planification**
  et libérée à la vente ou à l'annulation.

## Ce qui n'est pas (encore) implémenté

- Les tours ne bloquent pas le passage (pas de maze dans l'original), et les
  prérequis entre tours ne sont pas vérifiés : un joueur avec assez d'or peut
  construire la tour la plus chère sans passer par les précédentes.
- Pas de serveur de jeu autoritaire ni de WebSocket : la partie tourne
  entièrement dans l'onglet du navigateur, contre des bots. Le salon privé
  n'existe qu'en mémoire côté client (voir plus haut).
- Aucune notion de joueur déconnecté dans `GameState` : seul `alive` est
  modélisé.
- Les abilités ont un panneau dans la barre de commandes, mais aucune commande
  d'abilité n'existe encore dans la simulation.
- Les améliorations de tours restent instantanées : l'ouvrier ne s'y déplace
  pas.
- Interpolation de rendu entre deux ticks (voir plus haut).

## Points d'équilibrage identifiés, pas encore traités

- **La Tourelle (racine Balistique) domine toujours.** Sur 20 parties, elle
  représente plus de la moitié de l'or investi dans les tours encore debout,
  loin devant l'Acide — malgré les rééquilibrages successifs.
- **Aucune partie ne se conclut.** Sur un run de 20 parties à 6 joueurs, les
  20 atteignent le plafond de sécurité du runner (25 minutes simulées) sans
  qu'aucun joueur ne perde ses 30 vies. Le délai de construction introduit
  avec l'ouvrier n'a pas été mesuré isolément contre l'état antérieur.
- **`h00T` (Soleil artificiel) a une portée de 2000**, la plus grande du jeu et
  largement au-dessus des 1500 des autres sommets de branche.

Le cooldown de 0,05 s d'`o006` signalé ici auparavant a été corrigé : il vaut
0,22 s depuis le rééquilibrage complet des six branches.
