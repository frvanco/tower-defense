# Rapport de performance — après optimisation (comparaison avant/après)

Généré le 2026-08-26, en suite directe de [`PERFORMANCE_REPORT.md`](./PERFORMANCE_REPORT.md)
(diagnostic initial, non modifié — conservé tel quel). Ce document ne remplace
rien : il ajoute la correction des causes identifiées, un nouveau test complet
dans les mêmes conditions, et la comparaison chiffrée.

**Fichiers produits par cette phase** :
- `PERFORMANCE_REPORT_OPTIMIZED.md` (ce fichier)
- `performance-report-optimized.json` — rapport brut complet du nouveau test
- `performance-report-optimized.csv` — série temporelle agrégée à la seconde

---

## 1. Causes corrigées

### A. Groupes de tours jamais libérés (upgrade / vente / fin de partie) — CONFIRMÉ, corrigé

`TowerEntities.sync()` (`apps/web/src/entities3d.ts`) remplaçait ou retirait
un groupe de tour (`this.layer.remove(tracked.group)`) sans jamais disposer
sa géométrie ni ses matériaux. Corrigé par une fonction générique
`disposeTowerGroup()` qui parcourt le groupe retiré et dispose chaque
géométrie et chaque matériau **qui n'est pas partagé** (voir §3 —
`isSharedTowerMaterial`), appelée avant chaque `layer.remove()` (upgrade,
vente, `clear()` en fin de partie).

### B. Chaque creep générique recréait géométrie/texture/matériau à chaque apparition — CONFIRMÉ, corrigé

`CreepEntities.spawn()` créait un `SphereGeometry`/`ConeGeometry`, un
`RingGeometry` et un `CanvasTexture` (barre de vie) **neufs** à chaque
creep, jamais libérés à sa mort. Corrigé en deux volets :
- géométrie de corps, d'anneau et d'éclats de givre déplacées vers un cache
  partagé par forme (`apps/web/src/creepVisualCache.ts`), jamais recréées ni
  disposées par instance ;
- le matériau du corps (teinté par instance pour le gel/poison, voir §3) et
  la texture de la barre de vie restent propres à l'instance et sont
  maintenant explicitement disposés à la mort du creep (`sync()`/`clear()`).

### C. Fuite supplémentaire trouvée pendant le retest (Phase 2) : particules de poussière de construction — CONFIRMÉ, corrigé

Non identifiée dans le diagnostic initial (hors du périmètre A/B décrit).
En creusant un residu de croissance mémoire persistant après la Phase 1
(voir §12 pour la méthode), `packages/renderer/src/build.ts#spawnDust`
s'est révélé cloner `MAT.dust` pour **chaque particule** de poussière de
construction (14 au début d'un chantier, 10 à la fin, plus un filet continu
pendant les 2s d'animation) — `updateDust()` disposait bien la géométrie de
chaque particule expirée, jamais son matériau clone. Un chantier de tour se
répétant a chaque construction ET chaque upgrade, potentiellement des
milliers de fois sur une longue partie, c'est un troisième point de fuite
réel. Corrigé par un `.dispose()` du matériau au même endroit que la
géométrie.

### Vérifié mais écarté (pas une fuite)

- **Aucun `AnimationMixer` actif en jeu** (confirmé par grep — l'architecture
  des creeps animés pré-échantillonne les clips au chargement, voir
  `animatedCreepModel.ts` ; les seuls `AnimationMixer` créés sont temporaires,
  au chargement, puis jamais conservés).
- **Aucune référence obsolète** sur `selectedTowerEid`/`hoveredTowerEid` : la
  vente vide `selectedTowerEid` immédiatement ; un upgrade conserve le même
  `eid`, donc aucune désynchronisation possible.
- **La croissance résiduelle de `renderer.info.memory.geometries` après le
  plateau du nombre de tours n'est PAS une fuite** — voir §12, isolée par un
  test contrôlé dédié (construction + 5 upgrades d'une seule tour, hors fuite
  généralisée) : chaque tour a plus de sous-mesh à ses paliers supérieurs
  (bandes de renfort, blindage, plus de canons/merlons), donc son propre
  upgrade fait légitimement grossir son nombre de géométries — borné par le
  palier maximal, pas illimité.

---

## 2. Fichiers modifiés

| Fichier | Nature du changement |
|---|---|
| `apps/web/src/entities3d.ts` | `disposeTowerGroup()` (cause A) ; corps/anneau des creeps passés au cache partagé, dispose du matériau de corps et de la barre de vie à la mort (cause B) ; getter `counts` (perf, session précédente) |
| `apps/web/src/creepVisualCache.ts` | **Nouveau.** Cache partagé géométries/matériaux des creeps génériques (cause B) |
| `packages/renderer/src/materials.ts` | `isSharedTowerMaterial()` + `disposeSharedTowerMaterials()` — registre explicite d'ownership pour `MAT.*`/`teamMaterial()` |
| `packages/renderer/src/index.ts` | Export des deux fonctions ci-dessus |
| `packages/renderer/src/build.ts` | Dispose du matériau clone d'une particule de poussière à son expiration (cause C) |
| `apps/web/src/perfMonitor.ts` | `rawFrameTimeMs`/`simulationDtMs` séparés (voir §11) |
| `apps/web/src/main.ts` | Câblage de la mesure non plafonnée ; ajout d'une surcharge `?seed=` (voir §12) |
| `apps/web/src/animatedCreepInstances.ts`, `lightningEffects.ts`, `poisonEffects.ts` | Inchangés dans cette phase (getters `activeCount`/`counts` déjà ajoutés lors du diagnostic initial) |
| `apps/web/test/creepVisualCache.test.ts`, `towerEntities.test.ts`, `creepEntities.test.ts` | **Nouveaux** — voir §4 |

Aucun fichier de `packages/sim` touché. Aucune règle de jeu, animation,
couleur ou dimension modifiée.

---

## 3. Stratégie de cache et d'ownership

**Principe** : une ressource est soit *partagée* (jamais disposée tant que la
session tourne, disposée uniquement par une fonction de nettoyage explicite),
soit *propre à une instance* (toujours disposée à la disparition de cette
instance, jamais ailleurs). Aucune ressource n'appartient aux deux catégories
à la fois, et l'appartenance est déterminée au niveau du code qui la crée, pas
devinée au moment de la disposer.

**Tours** (`packages/renderer/src/materials.ts`) :
- Partagés, jamais disposés en cours de partie : `MAT.*` (pierre, métal,
  bois...) et `teamMaterial(color)` (un par couleur d'équipe, mis en cache
  — inchangé, préexistant). Un `Set<THREE.Material>` (`isSharedTowerMaterial`)
  fait référence explicitement à ces objets ; `disposeTowerGroup()` le
  consulte avant de disposer quoi que ce soit sur un groupe retiré.
- Propres à l'instance, toujours disposés à l'upgrade/vente : toutes les
  géométries (aucune n'est partagée entre deux tours dans le code actuel —
  chaque `new THREE.XxxGeometry(...)` de `cannon.ts`/`placeholder.ts` est un
  appel distinct) et les matériaux créés `new THREE.XxxMaterial(...)`
  directement dans ces deux fichiers (accent de palier, anneaux de
  portée/progression/emprise), qui ne passent PAS par `teamMaterial()`.
- Particules de poussière de construction : géométrie ET matériau propres à
  chaque particule (`MAT.dust.clone()`), disposés soit à leur expiration
  naturelle (`updateDust`), soit avec le reste du groupe si la tour est
  upgradée/vendue avant que la poussière ait fini de retomber (capturé
  génériquement par le parcours de `disposeTowerGroup()`, sans code
  particulier à écrire pour ce cas).

**Creeps génériques** (`apps/web/src/creepVisualCache.ts`) :
- Partagés, en cache par forme, jamais disposés en cours de partie : la
  géométrie du corps (clé : `isAir` + rayon), la géométrie ET le matériau de
  l'anneau au sol (clé : rayon ; clé couleur — la lane de l'expéditeur, pas
  une couleur d'équipe), la géométrie des éclats de givre (clé : rayon) et
  leur matériau (un seul, une teinte fixe dans tout le jeu). Cache au niveau
  du module (pas par arène/partie) : ces formes dépendent uniquement des
  données statiques de `@tower-defense/data`, identiques d'une partie à
  l'autre.
- Propres à l'instance, toujours disposés à la mort du creep : le matériau du
  CORPS (sa teinte change chaque frame pour le gel/le poison — impossible à
  partager sans faire déteindre un creep sur un autre) et la texture/le
  matériau de la barre de vie (peinte individuellement).
- `disposeCreepVisualCache()`/`disposeSharedTowerMaterials()` existent pour
  un nettoyage complet, mais **ne sont volontairement PAS appelés depuis
  `disposeScene3D()`** (rejoué à chaque retour au menu) : ce cache doit
  survivre aux redémarrages de partie (mêmes formes, coût de reconstruction
  évité) ; `disposeScene3D()` disposera de toute façon les instances encore
  attachées à la scène au moment de l'appel, sans casser le cache lui-même
  (comportement déjà existant avant ce chantier pour `MAT.*`/`teamMaterial`,
  vérifié compatible avec three.js — un objet disposé puis réutilisé sur un
  nouveau renderer se ré-uploade simplement). Elles restent exportées et
  couvertes par les tests (§4) pour un usage futur si l'application gagne un
  vrai point de fermeture définitive.

---

## 4. Tests du cycle de vie (nouveaux)

`apps/web/test/creepVisualCache.test.ts`, `towerEntities.test.ts`,
`creepEntities.test.ts` — 14 tests, exécutés en pur Node/vitest (aucun
contexte WebGL requis : `THREE.BufferGeometry`/`Material`/`Scene` fonctionnent
sans renderer, les assertions portent sur les appels `.dispose()` — espionnés
via `vi.spyOn` — et l'identité de référence des objets en cache).

Couverture demandée, ligne par ligne :
- **Construction puis suppression répétée de nombreuses tours** —
  `towerEntities.test.ts`, 30 cycles construction/vente : géométrie ET
  matériau propres disposés exactement une fois par cycle.
- **Création puis mort répétée de creeps génériques** —
  `creepEntities.test.ts`, 200 cycles spawn/mort : matériau de corps disposé
  une fois par mort.
- **Le nombre de géométries/textures atteint un palier** — vérifié
  indirectement (pas de `renderer.info` sans WebGL) : `creepVisualCache.test.ts`
  vérifie que 500 "spawns" du même type renvoient TOUJOURS le même objet
  geometrie (donc zéro création supplémentaire après la première).
- **Une ressource partagée n'est jamais détruite pendant qu'elle est encore
  utilisée** — les trois fichiers de test espionnent explicitement les
  ressources partagées (`MAT.stone`, `teamMaterial(color)`, géométrie/matériau
  d'anneau) et vérifient `not.toHaveBeenCalled()` sur leur `.dispose()`
  pendant tout le cycle de vie testé.
- **Une unité recréée après nettoyage s'affiche correctement** — vérifié pour
  les tours et les creeps : `clear()` puis re-`sync()` produit un nouveau
  groupe/mesh fonctionnel, avec une géométrie de cache neuve (pas un résidu
  disposé) pour les creeps.

---

## 5-9. Tableau avant/après

**⚠️ Comparabilité des mesures de queue de distribution (p95/p99/max/1%
low/0,1% low, ce tableau) : voir §11.** Le test AVANT a été mesuré avec une
instrumentation qui plafonnait chaque temps de frame à 250ms (bug corrigé
dans cette même phase, à la demande explicite du brief) — ses valeurs de
queue sont donc **artificiellement optimistes**, pas de vraies valeurs
brutes. Le test APRÈS utilise la mesure corrigée, non plafonnée. Les deux
runs utilisent aussi des seeds différentes (voir §12) — un nombre de tours
final différent (1585 vs 1268) explique une partie des écarts absolus.
Colonnes fiables pour la comparaison malgré ça : mémoire, géométries,
textures, draw calls/triangles, FPS moyen, frame time moyen — pas des
artefacts du clamp, pas de la seed (formes de courbes comparables).

| Métrique | AVANT (`PERFORMANCE_REPORT.md`) | APRÈS (ce rapport) | Évolution |
|---|---|---|---|
| FPS moyen | 8,85 | 9,30 | +5 % *(seeds différentes, prudence — voir §12)* |
| FPS minimum | 4,00 *(plafonné, §11)* | 2,07 *(brut, non plafonné)* | Pas comparable directement — voir §11 |
| 1 % low | 4,00 *(plafonné)* | 2,82 *(brut)* | Pas comparable directement — voir §11 |
| 0,1 % low | 4,00 *(plafonné)* | 2,32 *(brut)* | Pas comparable directement — voir §11 |
| Frame time moyen | 154,0 ms | 154,0 ms | ≈ inchangé *(cf. FPS moyen — attendu, voir §12 sur le plafond de draw calls/tours qui, lui, n'a pas bougé)* |
| Frame time p95 | 250,0 ms *(plafonné)* | 300,1 ms *(brut)* | Pas comparable — le "250" d'avant ne reflétait pas la réalité |
| Frame time p99 | 250,0 ms *(plafonné)* | 333,3 ms *(brut)* | Pas comparable |
| Frame time max brut | 250,0 ms *(plafonné, sous-estimé)* | 483,4 ms *(brut, réel)* | Le vrai pire cas d'avant était deja pire que 250ms — juste jamais mesuré |
| Mémoire au début | 33,3 Mo | 34,9 Mo | ≈ identique (attendu, aucune fuite n'a encore eu le temps d'agir) |
| Mémoire maximale | 873,0 Mo | 402 Mo | **−54 %** |
| Mémoire en fin de fenêtre | 873,0 Mo | 357,7 Mo | **−59 %** |
| Croissance mémoire | +839,8 Mo, **+65,4 Mo/min, sans palier** | +322,7 Mo, **+22,7 Mo/min** | **Pente divisée par ~2,9** — toujours pas un palier plat (voir §12), mais plus une fuite sans fin |
| Géométries WebGL (fin) | **172 310** | **36 743** | **−79 %** |
| Textures WebGL (fin) | **2 468** | **2** | **−99,9 %** (retour exact à la valeur de départ — fuite éliminée) |
| Draw calls max | 8 376 | 8 404 | ≈ inchangé (attendu — plafond structurel de l'arène à 317 emplacements, voir §12, PAS touché par un fix de fuite) |
| Triangles max | 340 526 | 340 428 | ≈ inchangé (même raison) |
| Tours max (6 arènes) | 1585 (seed différente) | 1268 (seed différente) | Non comparable en valeur absolue |

---

## 10. Les dix périodes les plus lentes (test optimisé)

| Moment (temps simulé) | FPS | Frame time (brut) | Creeps actifs | Tours (6 arènes) | Draw calls | Triangles | Mémoire |
|---|---|---|---|---|---|---|---|
| 28:33 (manche 58) | 2,60 | 400,0 ms | 21 | 1268 | 7642 | 304 704 | 332 Mo |
| 31:04 (manche 63) | 2,81 | 361,1 ms | 24 | 1268 | 7876 | 315 466 | 343 Mo |
| 31:48 (manche 64) | 2,84 | 355,5 ms | 0 | 1268 | 8360 | 338 418 | 352 Mo |
| 30:34 (manche 62) | 2,89 | 350,0 ms | 24 | 1268 | 8255 | 333 366 | 372 Mo |
| 29:22 (manche 59) | 2,91 | 344,4 ms | 1 | 1268 | 8127 | 327 384 | 357 Mo |
| 28:05 (manche 57) | 2,98 | 338,9 ms | 15 | 1268 | 7787 | 314 558 | 371 Mo |
| 31:35 (manche 64) | 3,00 | 333,3 ms | 37 | 1268 | 8392 | 339 390 | 402 Mo |
| 29:23 (manche 59) | 3,01 | 333,3 ms | 0 | 1268 | 8124 | 327 326 | 377 Mo |
| 28:23 (manche 57) | 3,02 | 338,9 ms | 0 | 1268 | 7434 | 296 446 | 316 Mo |
| 28:03 (manche 57) | 3,04 | 333,3 ms | 6 | 1268 | 7528 | 306 170 | 345 Mo |

Toutes en toute fin de partie, une fois l'arène affichée entièrement
construite à haut palier — cohérent avec la cause structurelle identifiée en
§12 (draw calls/triangles plafonnés par la taille de l'arène, pas par une
fuite). Contrairement au test AVANT, ces valeurs sont maintenant les VRAIES
pires frames (non plafonnées) — le plancher "plat à 4,00 fps" du rapport
initial a disparu, remplacé par des valeurs qui varient réellement.

---

## 11. Correction de l'instrumentation

**Clamp de simulation vs mesure de perf — séparés.** `apps/web/src/main.ts`
gardait déjà `Math.min(rawDt, 250)` pour la simulation (comportement de jeu
inchangé, toujours nécessaire pour qu'un onglet remis au premier plan ne
rejoue pas plusieurs minutes de simulation d'un coup). La mesure de perf,
elle, utilisait PAR ERREUR cette même valeur plafonnée. Corrigé :
`apps/web/src/perfMonitor.ts` reçoit maintenant deux valeurs distinctes à
chaque frame (`PerfSampleInput.rawFrameTimeMs` — brut, jamais plafonné, seul
utilisé pour tout calcul de FPS/percentile — et `simulationDtMs` — la valeur
plafonnée, gardée à part, à titre informatif, dans `PerfSecondSnapshot.simDtMsAvg`).
Conséquence directe : `frameMsP95`/`P99`/`max` et les 1%/0,1% low du rapport
optimisé sont maintenant des **vraies** valeurs brutes (voir §5, la comparaison
avant/après ne peut PAS traiter les deux runs comme s'ils avaient été mesurés
pareil sur ces colonnes précises).

**Corrélation FPS↔tours : le signe et le calcul, clarifiés.** Le rapport
initial affichait "corrélation FPS↔tours = 0,95" — un chiffre en réalité
correct dans sa valeur, mais **mal étiqueté** : 0,95 était la corrélation entre
le nombre de tours et le **frame time** (positive, attendu : plus de tours,
frames plus longues), pas entre le nombre de tours et le FPS. Recalculé
explicitement pour les deux :

| | AVANT | APRÈS |
|---|---|---|
| r(tours, **frame time**) | +0,950 | +0,878 |
| r(tours, **FPS**) | **−0,973** | **−0,973** |

La corrélation FPS↔tours est bien négative dans les deux cas, comme attendu
physiquement (plus de tours ⇒ moins de FPS) — la valeur "0,95" du rapport
initial n'était pas fausse en soi, juste rattachée à la mauvaise métrique
dans le texte. Corrigé ici en distinguant explicitement les deux, avec les
deux signes visibles.

---

## 12. Limites restantes

1. **Croissance mémoire résiduelle, mais bornée et non-exponentielle** — le
   test optimisé ne montre pas un plateau plat (+322,7 Mo sur la fenêtre de
   mesure, pente 22,7 Mo/min) ; le critère de succès "mémoire qui atteint un
   palier" n'est donc pas atteint à la lettre dans un test de ~14 minutes
   réelles (~32 minutes simulées). Isolé et expliqué par une expérience
   contrôlée dédiée (construction d'une tour puis 5 upgrades successifs, en
   dehors de toute autre activité) : le delta de géométries par upgrade
   (+2 à +9) correspond exactement à la richesse visuelle croissante des
   paliers supérieurs (bandes de renfort au palier 3, blindage au palier 5,
   plus de merlons/canons) — **pas** à une fuite. Tant que des tours
   existantes continuent de monter en palier (le nombre de tours, lui,
   plafonne bien plus tôt — voir tableau §5), la mémoire croît légitimement,
   bornée par le palier maximal (5-6 paliers par branche) une fois toutes les
   tours au maximum. Cette borne n'a pas été atteinte dans la fenêtre de
   test — un test encore plus long la montrerait probablement se stabiliser,
   mais ça n'a pas été vérifié empiriquement au-delà de ~32 minutes simulées.

2. **Draw calls/triangles au pic quasi inchangés (8404 vs 8376)** — attendu :
   Phase 1 corrige une fuite (ressources orphelines qui s'accumulent), pas le
   coût de rendu d'un contenu réellement affiché. Le plafond vient de la
   taille structurelle d'une arène pleine : 317 emplacements de construction
   par arène (`buildSlots(0).length`, confirmé), et SEULE l'arène actuellement
   observée est rendue (vérifié : `game.viewedTowers` reste à 317 même quand
   `game.allArenasTowers` monte à 1268 — les 5 autres arènes existent mais
   sont invisibles, donc hors budget de rendu). Avec ~25 sous-mesh par tour à
   palier maximal (mesuré), 317 × ~25 ≈ 7900-9000 draw calls — cohérent avec
   la mesure. **Phase 3 (instancing des tours) n'a pas été implémentée** :
   voir la justification détaillée ci-dessous.

3. **Seeds différentes entre les deux runs** — demandé explicitement "même
   seed si possible" dans le brief ; le paramètre de dev `?seed=N` (ajouté
   dans cette même phase, `apps/web/src/main.ts`) n'existait pas encore au
   moment du test AVANT, et refaire ce test AVANT avec le code déjà corrigé
   n'aurait plus rien mesuré d'utile (le bug n'existe plus). Les deux runs
   restent des parties à 6 bots, difficulté Moyen, même build/navigateur/
   résolution/vitesse — mais avec des trajectoires de partie différentes
   (1585 vs 1268 tours au pic). Les métriques comparées en confiance (§5)
   sont celles peu sensibles à ce nombre exact (mémoire/géométries/textures
   en tendance, pas en valeur ponctuelle). `?seed=42` est maintenant
   disponible pour une comparaison strictement contrôlée si souhaité.

4. **GPU timing toujours indisponible** dans cet environnement headless
   SwiftShader (`meta.gpuTimingAvailable: false`) — inchangé depuis le
   diagnostic initial, pour la même raison (pas de vrai GPU/extension côté
   rasterizer logiciel).

### Pourquoi l'instancing des tours (Phase 3) n'a pas été implémenté

Les mesures montrent un plafond de plusieurs milliers de draw calls (8404 au
pic) — le seuil que le brief donne comme déclencheur d'une étude
d'instancing est donc techniquement atteint. Décision prise malgré tout de
ne pas l'implémenter dans cette phase, pour les raisons suivantes :

- **Le plafond est structurel et déjà borné** (317 emplacements/arène, une
  seule arène rendue à la fois) — ce n'est pas une croissance sans fin comme
  l'était la fuite, donc l'urgence est différente.
- **Risque d'implémentation élevé au regard de ce qui doit être préservé à
  l'identique** (explicitement listé dans le brief) : visée de tourelle en
  temps réel par tour (`aimTurret`), sélection/survol individuels, anneaux de
  portée/emprise, fanion d'équipe coloré, animation de construction
  (échelle + poussière), système de vente — et surtout, un nombre de
  sous-mesh **variable par palier** (bandes de renfort, blindage, nombre de
  canons) qui rendrait un instancing par (branche, palier) correct mais
  demanderait de restructurer `packages/renderer/src/towers/*.ts` en
  profondeur (séparer génération de la géométrie vs. instanciation, gérer un
  pool par combinaison branche/palier/couleur d'équipe) — un chantier bien
  plus large que la correction de fuite elle-même.
- **Scénario extrême, pas le cas courant** : atteindre 1268-1585 tours
  simultanées sur 6 arènes suppose des parties qui durent ~30+ minutes
  simulées sans qu'aucun joueur ne l'emporte — déjà documenté comme un
  symptôme d'équilibrage (bot IA), pas le déroulé typique d'une partie.

Recommandation : si le jeu doit rester fluide dans CE scénario extrême
spécifiquement, l'instancing des tours par (branche, palier, couleur
d'équipe) — sur le modèle déjà validé trois fois pour les creeps animés
(`animatedCreepInstances.ts`) — est la bonne prochaine étape, mais mérite son
propre chantier dédié plutôt qu'un ajout de fin de phase.

---

## 13. Optimisations supplémentaires appliquées et bénéfice mesuré

Seule la correction C (§1, matériau de poussière de construction) sort du
périmètre strict "Phase 1" — trouvée en investiguant un résidu de croissance
mémoire après la Phase 1, comme demandé ("après le premier retest, analyse ce
qui reste réellement limitant"). Son bénéfice individuel n'a pas été isolé
par un test dédié séparé (aurait coûté un 4ᵉ run complet de ~14 minutes) — le
matériau clone étant un petit objet JS (pas un buffer GPU), sa contribution
propre à la mémoire totale est probablement modeste comparée aux causes A/B,
mais c'est une fuite réelle et confirmée (zéro risque à la corriger).

Aucune autre optimisation de la liste "pistes à évaluer" du brief n'a été
retenue :
- **Object pooling projectiles/effets** : sans objet — le jeu n'a pas de
  système de projectiles (combat hit-scan, voir le diagnostic initial) ; les
  pools d'effets existants (arcs d'éclair, bulles de poison) étaient déjà en
  place avant ce chantier.
- **Frustum culling** : déjà actif par défaut sur tout `THREE.Mesh` en
  three.js — rien à ajouter.
- **AnimationMixer** : déjà à zéro (architecture pré-échantillonnée) —
  confirmé, rien à réduire.
- **Ombres/LOD/mise à jour différée des éléments éloignés** : non
  implémentées — les mesures ne montrent pas qu'elles seraient le facteur
  limitant actuel (le CPU de sync/render suit les draw calls, pas un nombre
  d'objets ombrés ou éloignés en particulier), et le brief demande
  explicitement de ne pas faire de changement architectural sans bénéfice
  mesuré.

---

## 14. Vérifications

```
$ pnpm typecheck
tsc --noEmit
(aucune erreur)

$ pnpm test
Test Files  10 passed (10)
     Tests  85 passed (85)
```

Détail des 85 tests : 71 préexistants (inchangés, toujours au vert) + 14
nouveaux (`creepVisualCache.test.ts` ×6, `towerEntities.test.ts` ×4,
`creepEntities.test.ts` ×4 — voir §4).

---

## Méthodologie du nouveau test (identique au diagnostic initial sauf mention)

Chrome headless (SwiftShader), `pnpm dev`, résolution 960×696,
`devicePixelRatio`=1, three.js r160, 6 bots, difficulté Moyen, vitesse ×4,
caméra promenée automatiquement sur les 6 arènes toutes les ~8s réelles,
préchauffage 8,7s exclu des statistiques, plafond de sécurité 14 minutes
réelles (aucun `gameOver` naturel atteint — comportement déjà documenté dans
le rapport initial, le moteur n'a pas de timeout propre). Seule différence
matérielle avec le premier test : l'instrumentation elle-même (§11) et une
seed de partie différente (§12).
