# Herbe des zones constructibles

[Vue en jeu](herbe.png) · [Vue rapprochée](herbe-detail.png)

La texture lisse est remplacée par des nuances irrégulières à plusieurs échelles et de petites touffes peintes. Les motifs se raccordent aux bords ; les mipmaps atténuent les détails à distance. Les marqueurs de construction restent lisibles.

## Budget de rendu

- Une seule texture partagée entre les plateaux, générée à la création de scène.
- Même matériau Lambert, sans changement de shader, d'anisotropie ni de géométrie.
- Texture 512² au lieu de 256² : environ **+1 Mio GPU** en RGBA8 avec mipmaps, et **+0,75 Mio** pour le canvas conservé en mémoire CPU. Estimations de stockage, pas des mesures de mémoire du pilote.
- Génération observée : **49,7 ms une fois** sur l'environnement de test ; aucun calcul de bruit ou dessin Canvas dans la boucle de rendu.

Comparaison en alternance sur la même scène en pause : seed 42, tick 412, 4 tours et 1 creep visibles, 24 tours et 5 creeps dans les arènes. Canvas 1672 × 936, Chrome avec SwiftShader logiciel. Chaque passage suit 1,8 s de stabilisation puis 8,5 s de mesure. La signature complète de la simulation et de la caméra reste identique.

| Texture | Passage | Temps moyen/image | Appels | Triangles |
| --- | ---: | ---: | ---: | ---: |
| Ancienne | 1 | 306,8 ms | 221 | 221 812 |
| Nouvelle | 1 | 346,5 ms | 221 | 221 812 |
| Ancienne | 2 | 328,2 ms | 221 | 221 812 |
| Nouvelle | 2 | 310,5 ms | 221 | 221 812 |

Les temps fluctuent et ne montrent pas un écart reproductible dans cet environnement logiciel. Les appels, triangles et programmes sont inchangés. Les deux textures sont conservées seulement pendant ce test pour les échanger sans recharger la scène ; le jeu utilise uniquement la nouvelle.

[Mesures brutes](herbe-mesures.json)

## Vérifications et fichiers

- `pnpm test` : 228 tests réussis.
- `pnpm typecheck` et build web : réussis. Avertissement Vite existant sur la taille du chunk principal.
- Inspection au cadrage de jeu, en vue rapprochée et avec les marqueurs de construction.
- `apps/web/src/terrainGrass.ts` : génération de la texture.
- `apps/web/src/terrain3d.ts` : utilisation de cette texture partagée.
- Ce document, les captures `herbe.png` / `herbe-detail.png` et `herbe-mesures.json` : résultat et mesures.
