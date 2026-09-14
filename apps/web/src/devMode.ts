/**
 * Le mode dev de ce projet, c'est `?dev=1` sur une build de developpement —
 * les deux, jamais l'un sans l'autre.
 *
 * Cette fonction ne teste QUE le parametre d'URL. La moitie `import.meta.env.DEV`
 * reste ecrite litteralement sur chaque site d'appel, et c'est volontaire :
 * c'est une constante figee a la compilation, et Vite ne peut elaguer un
 * `import()` dynamique de son bundle de prod que s'il voit ce litteral dans la
 * condition. La deplacer ici rendrait `dev.ts` et `lobbyDev.ts` a nouveau
 * embarques en production.
 */
export function isDevRequested(): boolean {
  if (typeof location === 'undefined') return false;
  try {
    return new URLSearchParams(location.search).get('dev') === '1';
  } catch {
    // URL illisible : on reste en mode normal plutot que de planter.
    return false;
  }
}
