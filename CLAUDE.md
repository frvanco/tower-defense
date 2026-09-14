# CLAUDE.md

Instructions pour Claude Code sur ce dépôt. `README.md` est la **référence
d'architecture** : le lire avant toute modification non triviale (contrat du
moteur, équilibrage, emplacements de construction, ce qui n'est pas encore
implémenté).

## Avant de commit

```bash
pnpm test        # vitest, à la racine uniquement (packages/*/test, apps/*/test)
pnpm typecheck   # tsc --noEmit sur tout le monorepo
```

Les deux doivent passer. Pour un changement d'équilibrage, mesurer aussi :

```bash
pnpm headless 200            # 200 parties bot vs bot
pnpm headless 200 hard 6     # [parties] [easy|medium|hard] [effectif]
```

Il n'y a ni ESLint ni Prettier, ni CI : rien ne rattrape une erreur de style
ou un test oublié. Se relire.

## Invariants à ne jamais casser

- **`packages/sim` est pur et déterministe.** Aucun `Math.random`, aucun
  `Date.now`. Le PRNG est seedé et son état vit dans le state (`rng.ts`). Le
  temps est toujours un entier de ticks (20 Hz), jamais un delta flottant.
  `packages/sim/test/determinism.test.ts` garde ce contrat.
- **`packages/data/src/map_data.json` n'est jamais modifié** — c'est la copie
  fidèle de la map d'origine. Tout ajustement de jeu passe par `balance.json`,
  qui l'écrase à la volée.
- **`buildTower` snap sur `nearestSlot()`**, jamais sur la position du clic :
  c'est ce qui garde la simulation déterministe. Les emplacements viennent de
  `build_slots.json` (régénérable via `packages/data/scripts/gen_slots.ts`).
- **`apps/server/tsconfig.json` est volontairement autonome** et n'étend pas
  `tsconfig.base.json` : NestJS exige les décorateurs legacy et CommonJS,
  incompatibles avec le reste du monorepo. Ne pas « corriger ».
- Le rendu 3D charge des `.glb` avec repli sur la géométrie procédurale de
  `packages/renderer`. Garder le repli fonctionnel.

## Style

- Code et commentaires en français, **sans accents** (le README, lui, en
  porte). Les commentaires expliquent le *pourquoi* d'un choix, pas ce que le
  code fait déjà lire — voir l'en-tête de `creepShopTier` dans `sim.ts`.
- Modules courts et à responsabilité unique, imports `.js` explicites (ESM),
  types exportés depuis `types.ts`.

## Commits

Conventional Commits, sujet en français sans accents :

```
feat(lobby): ecran de salon prive et controles de dev
fix: le bouton d'amelioration reste visible et grise au palier max
refactor: range les modeles de creeps dans models/creeps/
```

Le corps explique les décisions et les arbitrages (pourquoi cette approche,
ce qui a été écarté, quels effets de bord ont été traités), et se termine par
ce qui a été **vérifié** concrètement. Un commit par unité logique, sauf si
la séparation demanderait un découpage ligne à ligne sans gain d'historique.

Ne pas ouvrir de pull request sans demande explicite.
