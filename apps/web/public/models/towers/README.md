# Modèles de tours

Un sous-dossier par **branche**, nommé d'après son `slug` — défini dans la
section `branches` de `packages/data/src/balance.json`, pas inventé ici :

| Dossier | Branche | Racine |
|---|---|---|
| `balistique/` | Balistique | `h000` |
| `acide/` | Acide | `o001` |
| `givre/` | Givre | `o003` |
| `anti-aerien/` | Anti-aérien | `h005` |
| `reacteur/` | Réacteur (2 paliers) | `h008` |
| `cadence/` | Cadence | `o008` |

Les ids racines (`h000`, `o001`…) sont hérités de la carte WC3 d'origine et
restent la clé interne — c'est le seul lien stable avec les données source
(voir `baseId` dans `map_data.json`). `name` et `slug` sont la couche lisible
par-dessus, même convention que pour les boutiques.

Dans chaque dossier, **un fichier par palier**, nommé `lv<palier>_<slug>.glb`
— même forme que les modèles de creeps (`lv1_trainard.glb`) :

```
balistique/
  lv1_balistique.glb   palier 1
  lv2_balistique.glb   palier 2
  ...
```

Le **numéro de palier** plutôt que l'id de la tour : c'est la clé qu'utilise
déjà le renderer (`makeCannonTower(tier)` prend un palier, pas un id), et les
ids/noms de tours changent au fil des rééquilibrages.

Le rattachement fichier → tour se fait dans `apps/web/src/towerModel.ts`
(`TOWER_MODEL_CONFIG`), une entrée par palier.

## Contraintes d'export

**La taille absolue du modèle n'a aucune importance** : il est automatiquement
normalisé sur la hauteur imposée par son palier, exactement comme les creeps.
Redimensionner le `.glb` n'a donc aucun effet.

**Ce qui compte, c'est la proportion.** La hauteur est imposée, et le rayon au
sol doit tenir dans `MAX_RADIUS`. Budget rayon/hauteur par palier :

| Palier | Hauteur imposée | Rapport rayon/hauteur max |
|---|---|---|
| 1 | ~2.2 | 0.55 |
| 2 | ~2.6 | 0.46 |
| 3 | ~3.0 | 0.40 |
| 4 | ~3.5 | 0.35 |
| 5 | ~3.8 | 0.31 |

Autrement dit **plus une tour est haute, plus elle doit être élancée** : au
palier 5, largeur totale ≤ 0.63 × hauteur. Un modèle trop large n'est jamais
laissé à déborder — il est réduit pour tenir dans sa case, et finit donc plus
petit que la hauteur prévue.

## Convention de hiérarchie

Reprise de `lv1_balistique.glb`, qui sert de référence :

| Nœud | Rôle |
|---|---|
| `Turret_Yaw` | pivote vers la cible (rotation Y). **Doit pointer vers +Z au repos.** |
| `Muzzle_01` | point de départ du tir |
| `Barrel_Recoil` | pièce reculant au tir |
| matériau `TeamColor` | remplacé par la couleur du joueur |
| matériau `FixedPalette` | couleurs de l'auteur, lues dans les `COLOR_0` |

Le modèle doit poser sa base à **Y = 0**. Un nœud absent n'est pas une erreur :
la tour se rend quand même, elle perd juste la capacité correspondante.

Les matériaux sont reconvertis en `MeshLambertMaterial` au chargement, pour
rester cohérents avec les cinq branches encore procédurales, qui sont éclairées
par la scène.

## État actuel

Une seule tour sur 27 a un modèle : `h000` (Balistique palier 1). Toutes les
autres restent **procédurales** — géométrie générée à partir des stats dans
`packages/renderer/src/towers/` (`cannon.ts` pour Balistique, `placeholder.ts`
pour les cinq autres branches).

Les deux coexistent sans cas particulier : `makeModelTower` produit exactement
le même contrat que les fabriques procédurales (mêmes enfants nommés, même
`userData`), donc l'animation de construction, la visée, les anneaux de portée
et la mesure d'emprise fonctionnent à l'identique. Une tour dont le modèle
n'est pas encore chargé — ou dont le fichier est illisible — retombe
silencieusement sur sa géométrie procédurale.

L'animation `Fire` est jouée à chaque tir. Le déclencheur ne demande aucune
modification de `packages/sim` : le `cooldown` d'une tour décroît d'un tick par
tick et n'est remis à sa valeur pleine qu'au moment où elle tire — une
**remontée** de cette valeur signale donc un tir. Un modèle sans clip `Fire` se
rend et vise normalement, il ne recule simplement pas.
