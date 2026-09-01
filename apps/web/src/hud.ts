import { towers } from '@tower-defense/data';
import { TICK_RATE, type GameState, type Arena } from '@tower-defense/sim';
import { branchInfo } from './branches.js';

export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- topbar ----------

/** Or/income/decompte ne sont PLUS ici (voir ResourcesRefs/updateResources
 * plus bas) — deplaces dans la console pour rester a portee d'oeil de la
 * grille d'achat (brief). Ne jamais les dupliquer aux deux endroits : une
 * seule source affichee pour chaque valeur. */
export interface TopbarRefs {
  lives: HTMLElement;
  round: HTMLElement;
  elapsed: HTMLElement;
}

export function updateTopbar(refs: TopbarRefs, state: GameState): void {
  const arena = state.arenas[0];
  if (!arena) return;
  refs.lives.textContent = arena.alive ? String(arena.lives) : 'dead';
  refs.round.textContent = String(state.round);
  // Temps de jeu (state.tick), jamais une horloge murale : reste correct sous
  // Pause/2x/4x, et le jour ou la partie sera pilotee par un serveur.
  refs.elapsed.textContent = fmtClock(state.tick / TICK_RATE);
}

// ---------- ressources (console — voir le brief "Ressources dans la console") ----------

export interface ResourcesRefs {
  gold: HTMLElement;
  income: HTMLElement;
  countdown: HTMLElement;
}

/** En dessous de 10 000 : valeur exacte, `toLocaleString('fr-FR')` (espace
 * fine insecable comme separateur de milliers — deja le format utilise pour
 * les couts de palier/tuiles ailleurs dans cette meme console). A partir de
 * 10 000 : format compact a 1 decimale ("105,5k") — au-dela de ce seuil le
 * joueur compare a des paliers de 10 000/100 000, la precision a l'unite
 * n'a plus d'usage (brief). TRONQUE (pas arrondi) a la decimale : 105 555
 * doit afficher "105,5k", pas "105,6k" que donnerait un arrondi standard
 * (verifie contre l'exemple explicite du brief). */
export function formatCompactNumber(n: number): string {
  const value = Math.max(0, Math.floor(n));
  if (value < 10000) return value.toLocaleString('fr-FR');
  const tenths = Math.floor(value / 100);
  return `${Math.floor(tenths / 10)},${tenths % 10}k`;
}

/** Palier de taille selon le nombre de caracteres AFFICHES (brief : "tres
 * grand pour trois ou quatre caracteres, grand pour cinq, moyen au-dela") —
 * jamais une taille fixe, sans quoi elle est soit trop petite en debut de
 * partie soit debordante en fin. Le CSS reserve deja la hauteur du plus
 * grand palier (voir .cmd-resource-value dans style.css), donc changer de
 * palier ne fait jamais varier la hauteur de la ligne. */
export function resourceSizeTier(text: string): 'xl' | 'lg' | 'md' {
  if (text.length <= 4) return 'xl';
  if (text.length === 5) return 'lg';
  return 'md';
}

function applySizeTier(el: HTMLElement, text: string): void {
  el.textContent = text;
  const tier = resourceSizeTier(text);
  el.classList.toggle('cmd-resource-value--xl', tier === 'xl');
  el.classList.toggle('cmd-resource-value--lg', tier === 'lg');
  el.classList.toggle('cmd-resource-value--md', tier === 'md');
}

/** Toujours l'arene du joueur HUMAIN (arena[0]) — jamais celle observee, meme
 * regle que updateTopbar : ces valeurs ne doivent exister qu'a un seul
 * endroit a l'ecran, et ne jamais se confondre avec l'income affiche dans
 * l'encart d'observation (voir main.ts, updateObservedPanel, arena distincte
 * — viewedPlayer — chantier separe). Or ET income passent par le format
 * compact/taille adaptative ci-dessus (les deux depassent leur plage
 * confortable en fin de partie, voir le brief) ; le decompte, lui, reste
 * TOUJOURS exact en m:ss (brief : "la lisibilite precise du temps restant a
 * une valeur de jeu") — jamais compacte, jamais redimensionne. */
export function updateResources(refs: ResourcesRefs, state: GameState): void {
  const arena = state.arenas[0];
  if (!arena) return;
  applySizeTier(refs.gold, formatCompactNumber(arena.gold));
  applySizeTier(refs.income, formatCompactNumber(arena.income));
  refs.countdown.textContent = fmtClock((state.nextRoundAt - state.tick) / TICK_RATE);
}

// ---------- panneau tour selectionnee (zone info de la barre de commandes) ----------

export interface SelectedRefs {
  section: HTMLElement;
  name: HTMLElement;
  info: HTMLElement;
  upgradeBtn: HTMLButtonElement;
  sellBtn: HTMLButtonElement;
}

export function updateSelectedPanel(refs: SelectedRefs, arena: Arena | undefined, eid: number | null): void {
  const tower = eid !== null ? arena?.towers.find((x) => x.eid === eid) : undefined;
  if (!tower || !arena) {
    refs.section.hidden = true;
    return;
  }
  const def = towers.get(tower.defId);
  if (!def) {
    refs.section.hidden = true;
    return;
  }
  refs.section.hidden = false;
  refs.name.textContent = `${def.name} (tier ${branchInfo(tower.defId).tier + 1})`;
  refs.info.textContent = `dmg ${def.damageBase}+${def.dice}d${def.sides} · range ${def.range} · cooldown ${def.cooldown}s`;

  const nextId = def.upgradesTo[0];
  const next = nextId ? towers.get(nextId) : undefined;
  if (next) {
    refs.upgradeBtn.hidden = false;
    refs.upgradeBtn.textContent = `Upgrade -> ${next.name} (${next.goldCost}g)`;
    refs.upgradeBtn.disabled = !arena.alive || arena.gold < next.goldCost;
  } else {
    refs.upgradeBtn.hidden = true;
  }

  refs.sellBtn.hidden = false;
  refs.sellBtn.textContent = `Sell (+${def.refund}g)`;
  refs.sellBtn.disabled = !arena.alive;
}
