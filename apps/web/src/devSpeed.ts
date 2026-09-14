/**
 * Controles de vitesse (Pause/1x/2x/4x) : outil de test manuel — regarder une
 * vague au ralenti, avaler les premiers rounds en accelere — jamais une
 * mecanique de jeu.
 *
 * Le markup est CONSTRUIT ICI plutot que pose dans index.html puis masque.
 * Ce module n'est atteint que par l'import dynamique de main.ts, lui-meme
 * derriere `import.meta.env.DEV` (constante figee a la compilation) : Vite
 * l'elague donc entierement du bundle de prod. En partie normale les boutons
 * n'existent pas dans le DOM, aucun listener n'est attache, et le code capable
 * de les creer n'est pas livre — les faire reapparaitre depuis les outils du
 * navigateur ne donnerait au mieux que des boutons morts.
 *
 * C'est la difference avec un `hidden` sur du markup statique, qui laissait les
 * boutons cables : un attribut retire dans l'inspecteur suffisait a remettre le
 * jeu en pause ou en x4 au milieu d'une partie normale.
 */

/** Le bouton actif au montage doit correspondre a la vitesse de depart de la
 *  partie (`speed = 1` dans main.ts) : sinon le premier clic sur 1x n'aurait
 *  l'air de rien changer. */
const DEFAULT_SPEED = 1;

const SPEEDS: ReadonlyArray<{ label: string; value: number }> = [
  { label: 'Pause', value: 0 },
  { label: '1x', value: 1 },
  { label: '2x', value: 2 },
  { label: '4x', value: 4 },
];

export interface SpeedControlsDeps {
  /** Applique la vitesse choisie a la boucle de jeu. */
  setSpeed(value: number): void;
  /** Celui de la partie en cours (voir startGame dans main.ts) : a son
   *  abandon, les boutons quittent le DOM en meme temps que les listeners du
   *  jeu, sans avoir a retourner une fonction d'arret de plus. */
  signal: AbortSignal;
}

export function installSpeedControls(deps: SpeedControlsDeps): void {
  const topbar = document.getElementById('topbar');
  if (!topbar) {
    console.warn('[dev] #topbar introuvable : controles de vitesse non installes');
    return;
  }

  const box = document.createElement('div');
  box.id = 'speed-controls';

  const buttons = SPEEDS.map(({ label, value }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'speed-btn';
    btn.textContent = label;
    btn.classList.toggle('active', value === DEFAULT_SPEED);
    box.append(btn);
    return { btn, value };
  });

  for (const { btn, value } of buttons) {
    btn.addEventListener(
      'click',
      () => {
        deps.setSpeed(value);
        for (const other of buttons) other.btn.classList.toggle('active', other.btn === btn);
      },
      { signal: deps.signal },
    );
  }

  topbar.append(box);
  // Retire le bloc a la fin de la partie : revenir au menu puis relancer refait
  // un startGame(), donc un second appel ici — sans ca, la topbar accumulerait
  // un jeu de boutons par cycle.
  deps.signal.addEventListener('abort', () => box.remove());
}
