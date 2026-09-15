# Ruines antiques / Sanctuaire des machines

Décor procédural du client Three.js, sans asset ajouté ni dépendance supplémentaire.

- `index.ts` : création, placement des ensembles et cycle de vie.
- `layout.ts` : bornes calculées depuis `zoneFootprints`, entrée/sortie depuis la lane et conversion `worldToScene`. Un court parvis en L raccorde le château à la véritable sortie ; sa façade regarde le premier plan.
- `structures.ts` : château, ateliers, robot immobile, arches, colonnes, statue et pont.
- `batch.ts` : géométries et matériaux partagés **dans une instance du décor** ; lots d'instances séparés par secteur pour le culling.
- `types.ts` : options et API publique.

Le terrain jouable et le dallage restent dans `terrain3d.ts` et `scene3d.ts`. Les contours, hauteurs et largeur du chemin sont conservés. Le cadrage initial couvre le plateau et le château ; les commandes et limites de caméra restent disponibles.

## Configuration

Le quatrième argument de `createScene3D(canvas, lane, frame, options)` accepte :

```ts
{ enabled: true, density: 1, colors: { stone: 0xc6bd99, leaf: 0x547f32 } }
```

`density` va de 0 à 2 et règle la végétation et les débris secondaires. Les monuments et la rivière restent présents. `colors` surcharge la palette de `batch.ts`. La couleur `team` suit ensuite `playerColor(player)`, comme les tours et l'interface.

Le décor reste entièrement visuel : aucun enregistrement dans la simulation, les collisions, le pathfinding ou la couche de tours. Ses meshes ignorent également le raycasting. Les arbres sont placés sur les côtés et au fond ; le premier plan contient seulement des bouquets bas.

## Comparaison en développement

Ouvrir `/?dev=1&perf=1&seed=42`. Pour démarrer avec le décor masqué : ajouter `&decor=0`.

Sur une partie mise en pause, à caméra et unités identiques :

```js
window.__dev.setSceneryEnabled(false);
window.__perf.getReport();
window.__dev.setSceneryEnabled(true);
window.__perf.getReport();
```

Attendre quelques secondes dans chaque état et utiliser les nouvelles entrées de `perSecond`, car le rapport cumule toute la session. Ce commutateur masque le module `sanctuary` ; les surfaces jouables et leur soutènement restent affichés. Il mesure donc le coût de l'environnement supplémentaire, pas celui de toute la nouvelle direction artistique.

## Ressources

Une arène observée réutilise le même décor recentré : changer de joueur ne fait que reteinter le matériau d'équipe. Rejouer dans la même session conserve les lots. Quitter appelle `sanctuary.dispose()`, qui détache le groupe, détruit les buffers d'instances, puis les géométries et matériaux dont il est propriétaire, une fois chacun. Les appels répétés sont sans effet. Aucune ressource de tour ou de creep n'est empruntée.

L'eau est opaque et statique, placée dans un lit bordé de roches et de talus, sous le plateau. Pas de réflexion, de transparence ni de lumière supplémentaire. Les ensembles bâtis et les bosquets partagent la lumière directionnelle existante pour leurs ombres. La pierre et le feuillage utilisent des matériaux Lambert.
