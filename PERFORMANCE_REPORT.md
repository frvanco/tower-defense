# Rapport de performance — partie complète (6 joueurs, difficulté Moyen)

Généré le 2026-08-26. Instrumentation : `apps/web/src/perfMonitor.ts` (nouveau,
opt-in via `?perf=1`, jamais actif par défaut). Capture automatisée via
Playwright (Chrome headless, rasterizer logiciel SwiftShader).

**Fichiers produits par ce diagnostic** (rien d'autre n'a été modifié en
dehors de l'instrumentation elle-même — voir "Fichiers touchés" en fin de
document) :
- `PERFORMANCE_REPORT.md` (ce fichier)
- `performance-report.json` — rapport brut complet (855 snapshots/s, 63
  marqueurs, résumé)
- `performance-report.csv` — série temporelle agrégée à la seconde (855
  lignes), pour tableur/graphe

---

## 1. Résumé général

La partie a été jouée par 6 bots (aucune action humaine — voir méthodologie)
jusqu'à un plafond de sécurité de 14 minutes réelles, sans jamais atteindre de
`gameOver` : **ce n'est pas une limitation de la mesure mais une propriété
déjà connue de l'équilibrage actuel** (le moteur de simulation
`packages/sim` n'a lui-même aucun timeout — seul l'outil `pnpm headless` en
impose un, à 25 minutes simulées, pour ses propres statistiques ; un
précédent chantier d'équilibrage sur ce même dépôt avait déjà mesuré 15/15
parties "sans vainqueur" à ce palier en difficulté Moyen). La capture couvre
donc **~30 minutes de temps de jeu simulé (60 manches), soit très largement
au-delà des premières minutes**, comme demandé.

**Verdict : la fluidité se dégrade de façon continue et sévère sur toute la
durée de la partie, sans jamais se stabiliser.** Le FPS moyen passe de ~20
en début de partie à un plancher de 4,0 dès la 20ᵉ minute simulée environ, et
y reste bloqué jusqu'à la fin de la capture. Deux causes distinctes et
également sévères ont été identifiées avec un haut niveau de confiance :

1. **Le nombre de tours ne redescend jamais** (0 → 1585 sur les 6 arènes
   cumulées, puis plateau) et le nombre d'appels de dessin/triangles suit la
   même courbe (corrélation FPS↔tours = 0,95, FPS↔draw calls = 0,96) — la
   scène devient de plus en plus coûteuse à dessiner à mesure que la partie
   dure, sans aucune limite naturelle en jeu.
2. **Fuite de ressources WebGL non disposées**, dans `apps/web/src/entities3d.ts` :
   chaque creep "générique" (sphère/cône, ~36 types sur 39 sans modèle 3D
   dédié) crée un `SphereGeometry`/`ConeGeometry`, un `CanvasTexture` (barre
   de vie) et un `RingGeometry` **neufs à chaque apparition**, jamais libérés
   à sa mort ; chaque upgrade de tour abandonne l'ancien groupe sans le
   disposer non plus. `renderer.info.memory.geometries` grimpe de 345 à
   **172 310** sur la partie, les textures de 2 à **2 468**, et la mémoire JS
   utilisée de 33 Mo à **873 Mo**, sans aucun signe de palier.

Ces deux causes sont indépendantes : le nombre de creeps *vivants* à un
instant donné ne corrèle quasiment pas avec le FPS (r = −0,01) — le système
d'instancing des creeps animés (`animatedCreepInstances.ts`) fait bien son
travail. Le problème est ailleurs : les tours qui s'accumulent sans limite,
et une fuite mémoire qui grossit avec le temps de jeu écoulé (r = 0,997)
plutôt qu'avec la population d'unités.

---

## 2. Métriques globales (fenêtre de mesure : après 8,7 s de préchauffage)

| Métrique | Valeur |
|---|---|
| Durée de la fenêtre de mesure | 846,9 s réelles (≈ 30 min de jeu simulé, vitesse ×4) |
| Frames échantillonnées | 5043 |
| FPS moyen | **8,85** |
| FPS min / max | 4,00 / 30,03 *(voir plafond de mesure, méthodologie §7)* |
| 1% low | 4,00 fps |
| 0,1% low | 4,00 fps |
| Frame time moyen | 154,0 ms |
| Frame time médian | 133,4 ms |
| p95 / p99 | 250,0 ms / 250,0 ms *(plafonné, voir §7)* |
| Frame time max | 250,0 ms *(plafonné, voir §7)* |
| Frames > 16,67 ms (< 60 fps) | 5043 / 5043 (100 %) |
| Frames > 33,33 ms (< 30 fps) | 5041 / 5043 (99,96 %) |
| Frames > 50 ms (< 20 fps) | 4792 / 5043 (95,0 %) |
| Frames > 100 ms (< 10 fps) | 3025 / 5043 (60,0 %) |
| Max creeps vivants (arène affichée) | 32 |
| Max creeps vivants (6 arènes cumulées) | 131 |
| Max tours (6 arènes cumulées) | 1585 (plateau atteint ~min 20 simulée) |
| Max draw calls | 8376 |
| Max triangles | 340 526 |
| Mémoire JS (début → fin) | 33,3 Mo → 873,0 Mo (Δ +839,8 Mo) |
| Pente mémoire | +65,4 Mo/min réelle, linéaire, aucun palier |
| GPU timing | Non disponible (voir §7) |

**Lecture immédiate** : le jeu est déjà en dessous de 60 fps dès la première
frame mesurée, et sous les 20 fps sur 95 % de la durée de la partie. Le
plancher de 20 fps n'est PAS le point de départ normal — début de partie,
avec 19 tours et 0 creep, il tournait déjà à ~20 fps dans cet environnement
(voir §7, l'environnement de test lui-même a un plafond bas) ; ce qui compte
ici est la **dégradation continue** au-delà de ce point de départ, pas la
valeur absolue initiale.

---

## 3. Évolution par phase (tranches de 5 minutes simulées)

| Temps simulé | FPS moyen | Frame time moyen | Tours (6 arènes) | Draw calls | Mémoire |
|---|---|---|---|---|---|
| 0–5 min | 15,8 | 65 ms | 107 | 955 | 56 Mo |
| 5–10 min | 11,7 | 88 ms | 429 | 1822 | 135 Mo |
| 10–15 min | 7,4 | 141 ms | 1024 | 3239 | 335 Mo |
| 15–20 min | 5,0 | 202 ms | 1561 | 4762 | 465 Mo |
| 20–25 min | 4,0 | 248 ms | 1585 (plateau) | 6244 | 646 Mo |
| 25–30 min | 4,0 | 250 ms (plafond) | 1585 | 7734 | 847 Mo |

Le nombre de tours plafonne à 1585 vers la 20ᵉ minute simulée (les bots ont
apparemment épuisé leur budget/emplacements viables — sur 1902 emplacements
physiquement disponibles au total pour 6 arènes, 83 % sont occupés ; la
raison exacte de cet arrêt est une question de comportement de bot, hors
périmètre de ce diagnostic perf). **Le FPS, lui, continue de se dégrader
légèrement même après ce plateau** (draw calls 6244 → 7734 sans nouvelle
tour) : c'est la signature de la fuite mémoire (§1, §8) qui continue seule,
indépendamment du nombre de tours.

---

## 4-5. Les 10 périodes les plus lentes

Le tri strict par FPS croissant ne renvoie que des secondes au plancher
absolu de 4,00 fps (voir plafond de mesure, §7) — toutes tirées de la
seconde moitié de partie, une fois les tours au plateau :

| Moment (temps simulé) | FPS | Frame time | Creeps actifs | "Projectiles" | Animations | Draw calls | Triangles | Mémoire |
|---|---|---|---|---|---|---|---|---|
| 20:17 (manche 41) | 4,00 | 250,0 ms | 6 | 0 arc / 0 bulle | 0 | 5769 | 225 230 | 522 Mo |
| 20:34 (manche 42) | 4,00 | 250,0 ms | 21 | 0 / 0 | 0 | 5845 | 229 386 | 597 Mo |
| 20:35 (manche 42) | 4,00 | 250,0 ms | 23 | 0 / 0 | 0 | 5752 | 227 714 | 590 Mo |
| 20:48 (manche 42) | 4,00 | 250,0 ms | 0 | 0 / 0 | 0 | 5742 | 229 826 | 548 Mo |
| 21:04 (manche 43) | 4,00 | 250,0 ms | 18 | 0 / 0 | 0 | 5977 | 241 206 | 619 Mo |
| 21:05 (manche 43) | 4,00 | 250,0 ms | 35 | 0 / 0 | 0 | 6079 | 245 818 | 624 Mo |
| 21:07 (manche 43) | 4,00 | 250,0 ms | 57 | 0 / 0 | 0 | 6037 | 245 064 | 624 Mo |
| 21:10 (manche 43) | 4,00 | 250,0 ms | 66 | 0 / 0 | 0 | 6049 | 245 528 | 639 Mo |
| 21:11 (manche 43) | 4,00 | 250,0 ms | 52 | 0 / 0 | 0 | 6271 | 259 314 | 647 Mo |
| 21:12 (manche 43) | 4,00 | 250,0 ms | 51 | 0 / 0 | 0 | 6268 | 259 256 | 639 Mo |

*"Projectiles" : le jeu n'a pas de système de projectiles séparé — le combat
est résolu instantanément (hit-scan) dans `packages/sim/src/sim.ts`
(`fireTowers`). Les proxys visuels les plus proches (arcs d'éclair, bulles de
poison) sont à 0 dans ce court échantillon simplement parce qu'aucune tour
Lightning/Poison ne tirait à cet instant précis — sur l'ensemble de la
partie, jusqu'à plusieurs dizaines de bulles de poison actives simultanément
ont été observées ailleurs dans la série (voir CSV, colonne
`game.poisonBubblesActive`). "Animations" = instances de creeps animés
(Traînard/Conscrit/Sapeur) en train de jouer Walk ou Death — à 0 ici car,
comme pour les autres creeps du round, ce sont majoritairement des types
génériques (sphère/cône) qui dominent l'effectif à ces instants précis.*

**Point important** : ces 10 lignes sont interchangeables — le plancher est
atteint en continu sur la quasi-totalité de la seconde moitié de partie (voir
§3), pas seulement à ces 10 instants. Le tableau ci-dessus est représentatif
de "à quoi ressemble le pire régime observable", pas de 10 événements
isolés.

---

## 6. Comparaison début / milieu / fin

| | Début (t=9 s, manche 1) | Milieu (t=431 s, manche 41) | Fin (t=855 s, manche 60) |
|---|---|---|---|
| Temps simulé | 0:12 | 20:29 | 29:57 |
| FPS moyen | 19,75 | 4,14 | 4,00 |
| Frame time moyen | 50,8 ms | 241,7 ms | 250,0 ms (plafond) |
| Draw calls | 666 | 5447 | 7792 |
| Triangles | 37 766 | 210 238 | 313 122 |
| Tours (6 arènes) | 19 | 1585 | 1585 |
| Creeps (6 arènes) | 0 | 0 | 0 |
| Géométries WebGL allouées | 345 | 88 903 | **172 310** |
| Textures WebGL allouées | 2 | 1258 | **2468** |
| Objets dans la scène | 1116 | 67 822 | 80 676 |
| Mémoire JS utilisée | 33,3 Mo | 538,0 Mo | 873,0 Mo |
| CPU — sim (tick) | 0,08 ms | 0,85 ms | 1,07 ms |
| CPU — sync entités | 0,45 ms | 6,90 ms | 8,53 ms |
| CPU — render() | 7,11 ms | 77,60 ms | 98,43 ms |
| Temps "non comptabilisé" (§7) | 43,2 ms | 156,3 ms | 142,0 ms |

Le CPU de simulation (`packages/sim`) reste négligeable du début à la fin
(1 ms) — **la sim elle-même n'est jamais en cause**. Le coût de synchronisation
des entités (`sync entités`) et surtout le coût CPU de soumission au rendu
(`render()`) explosent (×14) en suivant fidèlement draw calls/triangles.

---

## 7. Méthodologie et limites de la mesure

- **Navigateur** : Chrome headless (`google-chrome`, `--use-gl=swiftshader`)
  piloté par Playwright — **rasterizer logiciel, pas de vrai GPU**. Les FPS
  absolus mesurés ici (plafond ~20-30 fps même à vide) ne sont donc **pas
  représentatifs d'un poste utilisateur réel avec GPU matériel** ; en
  revanche, la dégradation *relative* dans le temps (÷5 en FPS sur la durée
  de la partie) et les causes identifiées (comptage d'objets, fuite mémoire)
  sont indépendantes du rasterizer et pleinement valables.
- **Mode** : serveur de développement Vite (`pnpm dev`), pas un build de
  production. Le JS n'est ni minifié ni bundlé — le coût CPU pur peut donc
  être légèrement surestimé par rapport à `pnpm build && pnpm preview` ; les
  coûts de rendu WebGL (draw calls, triangles, mémoire GPU) sont, eux,
  identiques quel que soit le mode.
- **Résolution canvas** : 960×696 px, `devicePixelRatio` = 1 (headless).
- **Three.js** : r160 (`three@0.160.1`), confirmé via `THREE.REVISION` en
  direct.
- **Limite de FPS** : aucune côté jeu (`requestAnimationFrame` standard).
- **Joueurs** : 6 bots, **aucun humain actif** (le joueur 0 n'a ni construit
  ni envoyé — voir §9 pour ce que ça implique). La caméra a été
  automatiquement promenée sur les 6 arènes toutes les ~8 s réelles pour une
  charge de rendu représentative plutôt que de fixer une seule arène.
- **Vitesse de simulation** : ×4 pendant la majeure partie de la capture,
  pour compresser le temps réel nécessaire — **cela n'affecte que la cadence
  de la simulation, pas la boucle de rendu ni `requestAnimationFrame`** : les
  FPS/frame time mesurés restent des mesures réelles de rendu, pas mises à
  l'échelle.
- **Préchauffage** : 8,65 s avant `markWarmupEnd()` — le résumé (§2, §4-5,
  §6) exclut cette fenêtre (chargement des GLB, compilation des premiers
  shaders) ; `performance-report.csv`/`.json` contiennent, eux, tout depuis
  `t=0` par transparence.
- **Plafond de mesure à 250 ms** *(limite découverte pendant l'analyse, pas
  corrigée — diagnostic seulement)* : `apps/web/src/main.ts` limite déjà
  volontairement `rawDt` à 250 ms (`Math.min(now - last, 250)`) pour éviter
  qu'un onglet mis en arrière-plan ne fasse rattraper des minutes de
  simulation d'un coup. L'instrumentation perf réutilise cette même valeur
  comme temps de frame — ce qui est correct tant que les frames durent moins
  de 250 ms, mais **plafonne artificiellement le pire cas rapporté** une fois
  que ce n'est plus vrai (dès la 20ᵉ minute simulée ici). Le FPS/frame time
  minimum réel en fin de partie est donc **au moins aussi mauvais que
  4 fps/250 ms, probablement pire** — cette étude ne peut pas dire de combien.
  Une mesure non plafonnée nécessiterait un second point de repère temporel
  indépendant de `rawDt` ; non ajouté ici pour rester strictement dans le
  périmètre "collecte de données" demandé.
- **Temps GPU** : `EXT_disjoint_timer_query_webgl2` a été recherché
  (`apps/web/src/perfMonitor.ts`, classe `GpuTimer`) mais n'est **pas
  disponible** sous SwiftShader/Chrome headless dans cet environnement —
  `meta.gpuTimingAvailable: false` dans le JSON. Aucune valeur n'a été
  fabriquée à la place. Le code de mesure existe et s'activera de lui-même
  sur un navigateur/GPU qui supporte l'extension (voir §10 pour relancer la
  mesure vous-même).
- **CPU "non comptabilisé"** (`frame time − sim − sync − render()`) : croît
  de ~43 ms à ~140-165 ms sur la partie. `render()` mesure uniquement le
  temps CPU de *soumission* des commandes de dessin, pas le temps GPU de
  rastérisation ni l'attente de balayage d'écran (`vsync`) ni les pauses de
  garbage collection du JS — tout ça tombe dans ce reliquat. Sa croissance
  colle à celle de la mémoire JS et du nombre de géométries non libérées
  (voir §8) : une contribution significative de pauses GC est plausible,
  mais je n'ai pas de mesure directe du temps GC pour l'affirmer avec
  certitude (voir niveaux de confiance, §8).

---

## 8. Corrélations observées

Coefficients de corrélation de Pearson calculés sur les 846 échantillons/s de
la fenêtre de mesure (hors préchauffage) :

| Paire | r | Lecture |
|---|---|---|
| Tours (6 arènes) ↔ frame time | **0,950** | Très forte — le nombre de tours explique presque toute la variance du frame time |
| Draw calls ↔ frame time | **0,957** | Très forte — cohérent avec ce que draw calls mesure directement |
| Triangles ↔ frame time | 0,929 | Très forte |
| Géométries WebGL allouées ↔ frame time | 0,905 | Forte |
| **Creeps vivants ↔ frame time** | **−0,011** | **Nulle** — le nombre de creeps à l'instant T n'a quasiment aucun effet mesurable sur le FPS |
| Temps réel écoulé ↔ géométries allouées | 0,997 | Quasi parfaite — la fuite grossit avec le TEMPS de jeu, pas avec un pic de population |
| Géométries allouées ↔ mémoire JS | 0,968 | Très forte — cohérent avec une fuite d'objets WebGL non disposés |
| Tours ↔ géométries allouées | 0,790 | Forte mais nettement moins parfaite que ci-dessus → **la fuite a une deuxième source, indépendante du compte de tours** (voir §8, cause identifiée : creeps génériques) |

**La corrélation quasi nulle creeps↔frame time est le résultat le plus utile
de cette analyse** : elle disculpe le système d'instancing des creeps animés
(`animatedCreepInstances.ts`, déjà optimisé — un `InstancedMesh` par noeud
par modèle, indépendant du nombre de creeps vivants) et pointe sans ambiguïté
vers les tours et la fuite mémoire comme causes, pas vers le volume d'unités
en jeu.

---

## 9. Goulots d'étranglement, classés par niveau de confiance

### CONFIRMÉ (mesuré ET vérifié dans le code)

**A. Aucune tour n'est jamais réellement libérée côté rendu.**
`apps/web/src/entities3d.ts`, `TowerEntities.sync()` : à chaque upgrade
(`tracked.defId !== t.defId`) et à chaque suppression (vente, ou fin de
partie via `clear()`), le code appelle `this.layer.remove(tracked.group)`
puis reconstruit un groupe neuf (`makeCannonTower`/`makePlaceholderTower`,
~10-11 objets 3D chacun) — **mais ne dispose jamais ni la géométrie ni le
matériau de l'ancien groupe**. `grep -rn "\.dispose(" apps/web/src/entities3d.ts`
ne retourne rien. Preuve mesurée : `renderer.info.memory.geometries` ne
redescend jamais, même quand des tours sont vendues/upgradées en continu.

**B. Chaque creep "générique" (sphère/cône) fuit un jeu complet de ressources
GPU à chaque mort.** Même fichier, `CreepEntities.spawn()`/`sync()` : un
`SphereGeometry`/`ConeGeometry` NEUF, un `MeshLambertMaterial` NEUF, un
`RingGeometry` NEUF et un `CanvasTexture` NEUF (barre de vie, via
`makeHpBar()`) sont créés à **chaque apparition** de creep — sur les 39 types
de creeps du jeu, 36 n'ont pas de modèle 3D dédié et passent par ce chemin
générique. À la mort, seul `this.layer.remove(...)` est appelé, jamais
`.dispose()`. Sur 60 manches et 6 arènes, ça représente potentiellement des
milliers d'apparitions — cohérent avec les 2468 textures et 172 310
géométries jamais libérées mesurées en fin de partie (2 et 345 au début).
C'est la cause la plus probable de la deuxième source de fuite révélée par
la corrélation tours↔géométries plus faible que temps↔géométries (§8).

**C. Le nombre de tours ne diminue jamais naturellement au cours d'une
partie**, et les emplacements disponibles (317 par arène × 6 = 1902 au
total) sont largement suffisants pour que les bots en construisent des
centaines sans jamais être forcés de vendre. Le coût de rendu (draw
calls/triangles) suit ce nombre presque parfaitement (r = 0,95-0,96). Ce
n'est pas un bug — c'est le design actuel des bots — mais combiné à des
parties qui, comme mesuré ici et lors d'un précédent chantier
d'équilibrage, ne convergent pas vers un vainqueur avant 25-30+ minutes,
c'est un facteur de dégradation garanti sur toute partie longue.

### PLAUSIBLE (cohérent avec les données, non prouvé directement)

**D. Une part significative du temps de frame "non comptabilisé"
(jusqu'à ~165 ms/frame en fin de partie, §7) est probablement du temps de
garbage collection**, provoqué par le volume d'objets JS/WebGL orphelins
généré par B. Cohérent avec la croissance parallèle de ce reliquat et de la
mémoire JS, mais aucune mesure directe du temps GC n'a été prise (Chrome ne
l'expose pas facilement à une page web) — à vérifier via le profiler
Performance des DevTools si confirmation souhaitée.

**E. Le mode développement (Vite non bundlé) alourdit légèrement le coût
CPU pur** par rapport à un build de production — plausible en général,
mais rien dans les données ne permet de le quantifier ici (pas de run en
production effectué, voir §10).

---

## 10. Recommandations

Aucune de ces optimisations n'a été appliquée — diagnostic seul, comme
demandé.

| # | Recommandation | Impact attendu | Difficulté | Risque de régression |
|---|---|---|---|---|
| 1 | Disposer géométrie + matériau (+ `.map` du sprite) de l'ancien groupe de tour dans `TowerEntities.sync()`, avant de le remplacer/retirer | **Très élevé** — élimine la cause A, arrête la fuite liée aux upgrades/ventes | Faible — même patron que `disposeScene3D` (`scene3d.ts`) déjà présent dans le code, à réutiliser localement | Faible — code additif, ne change aucun comportement visible |
| 2 | Disposer géométrie/matériau/texture (`body`, `frost`, `ring`, `bar.material.map`) de chaque creep sphère/cône à sa suppression dans `CreepEntities.sync()` | **Très élevé** — élimine la cause B, la plus grosse part de la fuite mesurée | Faible — même patron, 4-5 objets à disposer par creep sortant | Faible |
| 3 | Partager les géométries `SphereGeometry`/`ConeGeometry`/`RingGeometry` entre tous les creeps d'un même `armorType`/taille au lieu d'en recréer une par instance (garder seulement la couleur par instance, déjà faite via `material.clone()`) | Moyen-élevé — réduit la pression de création/destruction en amont, complète les fix 1-2 plutôt que les remplacer | Moyen — nécessite de vérifier qu'aucun code ne mute la géométrie elle-même (seule la couleur du matériau change actuellement, donc a priori sûr) | Moyen — à valider avec les creeps volants (géométrie différente) et le halo de givre |
| 4 | Étendre le pipeline "modèle GLB + `InstancedMesh`" (déjà en place pour Traînard/Conscrit/Sapeur) à d'autres creeps fréquents, pour sortir davantage de types du chemin générique fuyant | Moyen — réduit le volume concerné par la cause B au fil du temps | Élevé — nécessite des assets GLB par type, hors du seul périmètre code | Faible sur le rendu (patron déjà validé 3 fois ce projet) |
| 5 | Envisager une limite de gameplay (temps ou tours construites) côté équilibrage pour que les parties très longues cessent de dégrader indéfiniment le rendu | Élevé sur la durée, mais **hors périmètre technique** — c'est une décision de design/équilibrage, pas un fix perf | — | — (nécessite une décision produit, pas un chantier renderer) |
| 6 | Re-mesurer en build de production (`pnpm build && pnpm preview`) et sur un vrai GPU pour confirmer les FPS absolus (le diagnostic de cause, lui, ne dépend pas de cet environnement) | Faible sur le diagnostic (déjà solide), utile pour des chiffres FPS "grand public" | Faible | Aucun |

**Ordre conseillé** : 1 et 2 d'abord (même patron de code, gain le plus
direct et le plus sûr, corrigent la totalité des causes CONFIRMÉES A et B) ;
3-4 ensuite si le gain de 1-2 ne suffit pas ; 5 est une conversation
d'équilibrage séparée ; 6 est une vérification, pas un fix.

---

## 11. Comment relancer cette mesure vous-même

1. `pnpm dev` (déjà lancé si vous lisez ceci en session).
2. Ouvrir `http://localhost:5173/?perf=1` — le paramètre `perf=1` active
   l'instrumentation (aucun effet si absent, aucun impact gameplay).
3. Lancer une partie normalement (Jouer → choisir une difficulté).
4. Après quelques secondes de jeu, dans la console DevTools :
   `window.__perf.markWarmupEnd()` — exclut le chargement initial du
   résumé final.
5. Jouer aussi longtemps que voulu (vitesse ×1/×2/×4 au choix, ça n'affecte
   que la cadence de la simulation).
6. À tout moment : `copy(JSON.stringify(window.__perf.getReport()))` dans la
   console colle le rapport JSON complet dans le presse-papier — collez-le
   dans un fichier pour le ré-analyser (le format est identique à
   `performance-report.json`).
7. Pour un test représentatif d'un poste utilisateur réel : utiliser un
   navigateur normal (pas headless) avec accélération GPU matérielle, et
   idéalement `pnpm build && pnpm preview` plutôt que `pnpm dev`.

---

## Fichiers touchés par cette instrumentation

Uniquement ce qui était strictement nécessaire pour collecter les données —
aucune optimisation, aucun changement de gameplay :

- **`apps/web/src/perfMonitor.ts`** (nouveau) — toute la logique de mesure
  (échantillonnage par frame, agrégation par seconde, percentiles, 1%/0,1%
  low, timer GPU optionnel, rapport JSON). Opt-in strict via `?perf=1`
  (`isPerfEnabled()`), zéro coût si absent.
- **`apps/web/src/main.ts`** — instancie `PerfMonitor` quand `?perf=1` est
  présent, expose `window.__perf`, chronomètre les 3 phases de la boucle de
  rendu (sim/sync/render) et appelle `perf.sample(...)`/`perf.markEvent(...)`.
  Tout est derrière `if (perf)` — code mort, donc sans coût, quand
  l'instrumentation est désactivée.
- **`apps/web/src/entities3d.ts`** — trois compteurs en lecture seule ajoutés
  (`CreepEntities.counts`, utilisés par le moniteur) : aucune logique de jeu
  modifiée, uniquement des getters.
- **`apps/web/src/animatedCreepInstances.ts`** — un getter
  `AnimatedCreepController.activeCount` (taille d'une Map déjà existante).
- **`apps/web/src/lightningEffects.ts`**, **`apps/web/src/poisonEffects.ts`** —
  un getter `activeCount` chacun (parcourt un pool déjà existant).

`pnpm typecheck` et `pnpm test` (71/71) passent après ces changements.
