# CLAUDE.md

Instructions pour Claude Code sur ce dépôt.

## Carte du dépôt

```
packages/data/      map_data.json, balance.json, build_slots.json, scripts/gen_slots.ts
packages/sim/       moteur pur et déterministe (tick fixe 20 Hz)
packages/renderer/  meshes Three.js des tours (géométrie procédurale)
apps/web/           client Vite + Three.js
apps/headless/      runner bot vs bot
apps/server/        backend NestJS (launcher, comptes, salons)
```

`README.md` est la référence d'architecture détaillée. **Le lire avant toute
modification de `packages/sim`, `packages/data` ou `balance.json`**, ainsi
qu'avant d'ajouter une mécanique de jeu. Pour le reste, ce fichier suffit.

## Avant de déclarer une tâche terminée

Pas seulement avant un commit : **avant de rendre la main**, quelle que soit la
tâche.

```bash
pnpm test        # vitest, à lancer à la racine (packages/*/test, apps/*/test)
pnpm typecheck   # tsc --noEmit sur tout le monorepo
```

Les deux doivent passer. Il n'y a ni ESLint, ni Prettier, ni CI : rien d'autre
ne rattrape une erreur. La checklist minimale avant de rendre :

1. `pnpm test` et `pnpm typecheck` passent.
2. Aucun caractère accentué introduit dans le code (voir Style) :
   ```bash
   grep -rnP '[^\x00-\x7F]' --include='*.ts' packages/*/src apps/*/src
   ```
3. Aucune dépendance ajoutée sans accord explicite.
4. Aucun invariant ci-dessous contourné.

## Lancer le jeu

```bash
TODO: commande de dev (client), port
TODO: commande de dev (serveur), port
```

Instrumentation de performance du client : ajouter `?perf=1` à l'URL, puis
`window.__perf.getReport()` dans la console.

## Équilibrage

Tout ajustement de valeurs passe par `packages/data/src/balance.json`.

```bash
pnpm headless 20          # 20 parties bot vs bot, difficulté et effectif par défaut
pnpm headless 20 hard     # [parties] [easy|medium|hard]
```

**L'effectif est verrouillé à 6 joueurs partout** (données, headless, client).
Ne pas le paramétrer ni le faire varier.

Ce que le headless sert à détecter : une **régression grossière**, pas la
qualité de l'équilibrage. Le ressenti de jeu se juge en jouant, pas ici.
Signaux à regarder, et à comparer à la baseline avant modification :

| Métrique | Attendu |
|---|---|
| Parties terminées par une victoire | TODO % |
| Vague médiane atteinte | TODO |
| Durée médiane de partie | TODO |

Le runner coupe les parties à **25 minutes**. Une partie sans vainqueur signifie
qu'elle a atteint ce plafond, pas nécessairement qu'elle est bloquée. Ne pas
conclure à un blocage sans autre élément.

Ne jamais annoncer un changement d'équilibrage comme validé sur la seule sortie
du headless : donner les chiffres avant/après et laisser l'arbitrage à Antoine.

## Invariants à ne jamais casser

Si une tâche semble exiger d'en casser un : **s'arrêter et demander**. Ne pas
contourner, ne pas « adapter » l'invariant.

- **`packages/sim` est pur et déterministe.** Aucun `Math.random`, aucun
  `Date.now`. Le PRNG est seedé et son état vit dans le state (`rng.ts`). Le
  temps est toujours un entier de ticks (20 Hz), jamais un delta flottant.
  `packages/sim/test/determinism.test.ts` garde ce contrat.
- **`packages/data/src/map_data.json` n'est jamais modifié** — c'est la copie
  fidèle de la map d'origine. Tout ajustement de jeu passe par `balance.json`,
  qui l'écrase à la volée.
- **`buildTower` snap sur `nearestSlot()`**, jamais sur la position du clic :
  c'est ce qui garde la simulation déterministe. Les emplacements viennent de
  `build_slots.json`. Ne pas régénérer ce fichier
  (`packages/data/scripts/gen_slots.ts`) sans demande explicite : cela change la
  carte.
- **`apps/server/tsconfig.json` est volontairement autonome** et n'étend pas
  `tsconfig.base.json` : NestJS exige les décorateurs legacy et CommonJS,
  incompatibles avec le reste du monorepo. Ne pas « corriger ».
- Le rendu 3D charge des `.glb` avec repli sur la géométrie procédurale de
  `packages/renderer`. Garder le repli fonctionnel.
- Ne pas modifier ni régénérer les assets livrés (`apps/web/public/models/`,
  `apps/web/public/icons/`) : ils sont produits hors du dépôt.

## Périmètre

- **Ne jamais inventer de mécanique de jeu.** Beaucoup de décisions de design ne
  sont pas encore tranchées. Devant un trou — règle manquante, valeur non
  spécifiée, comportement ambigu — poser la question au lieu de choisir. Une
  mécanique inventée en silence coûte plus cher à défaire qu'à discuter.
- Ne pas ajouter, mettre à jour ou remplacer une dépendance sans accord.
- Ne pas ouvrir de pull request sans demande explicite.

## Style

- Code et commentaires **en français sans accents** (README et CLAUDE.md, eux,
  en portent). Les commentaires expliquent le *pourquoi* d'un choix, pas ce que
  le code donne déjà à lire — voir l'en-tête de `creepShopTier` dans `sim.ts`.
- Modules courts et à responsabilité unique, imports `.js` explicites (ESM),
  types exportés depuis `types.ts`.
- Nomenclature : le constructeur s'appelle **builder** (plus « peon »).

## Commits

Conventional Commits, **sujet et corps en français sans accents**.

```
feat(lobby): ecran de salon prive et controles de dev
fix: le bouton d'amelioration reste visible et grise au palier max
refactor: range les modeles de creeps dans models/creeps/
```

Corps : **10 lignes maximum**, sur les décisions et arbitrages (pourquoi cette
approche, ce qui a été écarté, quels effets de bord ont été traités). Se termine
toujours par une ligne de vérification au format exact :

```
Verifie: pnpm test, pnpm typecheck[, pnpm headless 20]
```

N'y lister que ce qui a réellement été lancé. Un commit par unité logique, sauf
si la séparation demanderait un découpage ligne à ligne sans gain d'historique.