# Tower Defense — moteur de simulation

Reproduction web d'une map de tower defense multijoueur historique. Le moteur
est pur et déterministe ; un client web basique (`apps/web`) et un runner
headless (`apps/headless`) tournent dessus.

## Démarrer

```bash
pnpm install       # ou npm install
pnpm test          # tests de déterminisme et de règles
pnpm headless 50   # lance 50 parties bot contre bot
pnpm dev           # client web jouable, solo contre des bots
```

## Structure

```
packages/data   données extraites de la map d'origine + surcharges d'équilibrage
packages/sim    moteur pur : tick(state, commands) -> state
apps/headless   runner de parties en accéléré, sans rendu
apps/web        client jouable (canvas 2D), solo contre des bots
```

`packages/data/src/map_data.json` est la **référence fidèle** de l'original
et ne doit jamais être modifié. Tout changement d'équilibrage passe par
`balance.json`, qui l'écrase à la volée. On garde ainsi la comparaison avec
l'original à tout moment.

## Le contrat du moteur

```ts
const state = createGame(seed, playerCount);
const events = tick(state, commands);
```

- Timestep fixe à 20 Hz. Le temps est toujours un entier de ticks, jamais un
  delta flottant — c'est ce qui garantit le déterminisme.
- Aucun `Math.random` ni `Date.now` dans `packages/sim`. Le PRNG est seedé et
  son état vit dans le state, donc il se sérialise avec.
- L'état est plat et sérialisable en JSON tel quel : c'est directement ce qui
  partira sur le WebSocket.
- `tick` mute l'état en place (copier 8 arènes 20 fois par seconde coûterait
  plus que ça ne rapporte). Pour un snapshot : `structuredClone(state)`.

Le déterminisme n'est **pas** nécessaire au netcode — on est serveur-autoritaire,
on diffuse l'état, pas les inputs. Il sert uniquement à rendre les analyses
d'équilibrage reproductibles.

## Ce qui est implémenté

Boucle de round et versement d'income, envoi de creeps vers toutes les lanes
adverses, gain d'income à l'envoi, système de stock (déblocage progressif,
réapprovisionnement, plafond), déplacement par waypoints, ciblage des tours,
dégâts de zone à trois paliers, table de dégâts (type d'attaque × type
d'armure + réduction par armure), leaks, défaite, victoire, construction /
upgrade / vente de tours, et un bot heuristique.

Les abilities de trois branches sur six sont implémentées (`packages/sim/src/status.ts`) :
ralentissement de zone (Ice, deux sources différentes s'additionnent, plafond
nommé `SLOW_CAP`), poison mono-cible à dégâts sur la durée qui ignore
l'armure (Poison), chaîne d'éclair à rebonds décroissants sur cibles
aériennes uniquement (Lightning). Valeurs par palier dans `balance.json`.

### Économie

Le revenu d'un joueur a deux sources : l'income versé à chaque round (le
gros du revenu), et une **prime de mise à mort** — quand un creep meurt dans
l'arène d'un joueur, ce joueur reçoit 5 % du coût en or du creep (arrondi au
supérieur, minimum 1 ; taux dans `balance.json`, `rules.bountyPct`). C'est le
propriétaire de l'arène qui est payé, jamais l'envoyeur du creep ; un creep
qui leak, ou qui est engendré par la mort d'un autre (Goblin Zeppelin), ne
rapporte rien. `arena.goldFromBounty` et `arena.goldFromIncome` cumulent
chaque source séparément — c'est ce que `pnpm headless` utilise pour afficher
la part du revenu qui vient de la défense plutôt que de l'income pur.

## Emplacements de construction

Une tour ne se pose pas n'importe où dans la zone constructible : elle se
pose sur un **emplacement** précis, défini dans
`packages/data/src/build_slots.json` (plus de 300 par arène, regroupés en
rangées/colonnes nommées — grille pleine à l'intérieur du U, bandes collées
au chemin sur les bras et le connecteur).

- `packages/data/scripts/gen_slots.ts` régénère le layout à partir de
  `packages/data/src/zoneFootprints.ts` (géométrie du couloir de la lane 0,
  les 8 arènes sont des copies translatées) ; le JSON produit peut aussi être
  modifié à la main sans toucher au code.
- `packages/data/src/slots.ts` expose `buildSlots(player)` (emplacements
  d'une arène, coordonnées déjà translatées — les 8 arènes du jeu d'origine
  sont des copies congruentes du même couloir) et `nearestSlot(player, x, y)`
  (l'emplacement le plus proche d'un clic, ou `null` au-delà d'une case de
  distance).
- Dans `packages/sim/src/sim.ts`, `buildTower` snap sur `nearestSlot()` : la
  tour prend la position exacte de l'emplacement, jamais celle du clic — ce
  qui garde la sim déterministe. L'occupation est suivie par
  `arena.occupied`, indexée par l'id stable de l'emplacement (ex.
  `"milieu-gauche-r1-3"`), libérée à la vente.

## Ce qui ne l'est pas

Les tours ne bloquent pas le passage (pas de maze dans l'original), le Peasant
n'est pas modélisé (la construction est directe), et les prérequis de Keep /
Castle ne sont pas encore vérifiés.

## Valeurs héritées du jeu d'origine, à vérifier

Certaines unités ne redéfinissent pas tous leurs champs dans la map : elles
héritent de l'unité de base du jeu d'origine, qui n'est pas dans le fichier.
Ces valeurs sont dans `BASE_DEFAULTS` (`packages/data/src/index.ts`) et le
runner headless liste à chaque exécution ce qui est retombé dessus. Les plus
importantes :

- `attackType` pour 18 tours sur 24 — impacte directement l'équilibrage via la
  table de dégâts.
- `range` pour 5 tours.
- `moveSpeed` pour 10 creeps.

Tant qu'elles ne sont pas vérifiées contre les données d'origine, toute
conclusion d'équilibrage est à prendre avec des pincettes.
