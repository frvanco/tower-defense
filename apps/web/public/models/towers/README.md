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

Dans chaque dossier, **un fichier par palier**, nommé `p<n>_<nom>.glb` :

```
balistique/
  p1_tourelle.glb
  p2_canon.glb
  p3_canon_lourd.glb
  p4_obusier.glb
  p5_canon_a_rail.glb
```

Le **numéro de palier** plutôt que l'id de la tour, parce que c'est la clé
qu'utilise déjà le renderer : `makeCannonTower(tier)` et
`makePlaceholderTower(rootId, tier, …)` prennent un palier, pas un id. Un
futur chargeur cherchera donc `(slug de branche, palier)`, ce que ce nommage
donne directement. Le nom qui suit est purement indicatif.

## État actuel : aucun de ces modèles n'est chargé

Les tours sont **entièrement procédurales** — géométrie générée à partir des
stats dans `packages/renderer/src/towers/` (`cannon.ts` pour Balistique,
`placeholder.ts` pour les cinq autres). Il n'existe pas d'équivalent de
`HUMANOID_MODEL_CONFIG` pour les tours.

Déposer un `.glb` ici ne suffira donc pas à l'afficher : il faut d'abord
écrire le chargement côté renderer, et ce n'est pas un branchement de deux
lignes — la géométrie actuelle porte aussi l'animation de construction, la
tourelle qui pivote, les anneaux de portée et la mesure d'emprise au sol
(`measureSweptRadius`, qui garantit qu'une tour ne déborde pas de sa case).
Ces dossiers ne sont là que pour accueillir les fichiers en attendant.
