import { towers, buildableTowers, creeps, type TowerDef, type CreepDef, type Shop } from '@tower-defense/data';
import { TICK_RATE, type Arena, type GameState } from '@tower-defense/sim';
import { branchInfo, branchColor } from './branches.js';
import { ARMOR_COLORS } from './colors.js';
import { toast } from './toast.js';
import { fmtClock } from './hud.js';

/**
 * `description`/`iconUrl` n'existent pas encore dans `@tower-defense/data`
 * (packages/data reste intouchable pour ce chantier — voir le brief). Lus
 * ici via un accesseur defensif plutot qu'en elargissant TowerDef/CreepDef :
 * tant qu'aucune donnee ne les fournit, ils renvoient toujours `undefined`
 * (repli sur la tuile textuelle / pas de ligne de description — jamais
 * d'invention de contenu), et le jour ou `balance.json` les fournira, il n'y
 * a rien d'autre a changer ici.
 */
function descriptionOf(def: object): string | undefined {
  const v = (def as { description?: unknown }).description;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function iconUrlOf(def: object): string | undefined {
  const v = (def as { iconUrl?: unknown }).iconUrl;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Repli textuel provisoire (voir brief : "deux ou trois lettres du nom",
 * jamais codees en dur — toujours derivees du nom reel de l'element). */
function abbreviate(name: string): string {
  const letters = name.replace(/[^\p{L}]/gu, '').toUpperCase();
  return letters.slice(0, 3) || '?';
}

// ---------------------------------------------------------------------------
// Tuile generique — icone 40px (image si iconUrl, sinon tuile de couleur +
// lettres), badge de stock, voile de rechargement, cout affiche sous la tuile.
// Reutilisee par tous les modes (build aujourd'hui, send au prochain commit).
// ---------------------------------------------------------------------------

export interface TileRefs {
  id: string;
  wrap: HTMLDivElement;
  button: HTMLButtonElement;
  icon: HTMLDivElement;
  costEl: HTMLElement;
  stockEl: HTMLElement;
  veilEl: HTMLElement;
  countdownEl: HTMLElement;
}

interface TileSpec {
  id: string;
  name: string;
  cost: number;
  color?: string;
  iconUrl?: string;
}

function buildTile(spec: TileSpec, onClick: () => void, onHoverChange: (hovering: boolean) => void): TileRefs {
  const wrap = document.createElement('div');
  wrap.className = 'cmd-tile-wrap';

  const button = document.createElement('button');
  button.className = 'cmd-tile';
  button.type = 'button';
  if (spec.color) button.style.setProperty('--tile-color', spec.color);

  const icon = document.createElement('div');
  icon.className = 'cmd-tile-icon';
  if (spec.iconUrl) {
    icon.style.backgroundImage = `url(${spec.iconUrl})`;
    icon.classList.add('cmd-tile-icon-image');
  } else {
    icon.textContent = abbreviate(spec.name);
    icon.classList.add('cmd-tile-icon-text');
  }
  button.appendChild(icon);

  const stockEl = document.createElement('span');
  stockEl.className = 'cmd-tile-stock';
  button.appendChild(stockEl);

  const veilEl = document.createElement('div');
  veilEl.className = 'cmd-tile-veil';
  button.appendChild(veilEl);

  const countdownEl = document.createElement('span');
  countdownEl.className = 'cmd-tile-countdown';
  button.appendChild(countdownEl);

  wrap.appendChild(button);

  const costEl = document.createElement('span');
  costEl.className = 'cmd-tile-cost';
  costEl.textContent = `${spec.cost}g`;
  wrap.appendChild(costEl);

  button.addEventListener('click', onClick);
  button.addEventListener('mouseenter', () => onHoverChange(true));
  button.addEventListener('mouseleave', () => onHoverChange(false));

  return { id: spec.id, wrap, button, icon, costEl, stockEl, veilEl, countdownEl };
}

// ---------------------------------------------------------------------------
// Infobulle (zone info, priorite 1) — nom/palier, cout, lignes de stats,
// description optionnelle.
// ---------------------------------------------------------------------------

export interface TooltipInfo {
  name: string;
  tier?: number;
  cost: number;
  lines: string[];
  description?: string;
}

export interface TooltipRefs {
  nameEl: HTMLElement;
  linesEl: HTMLElement;
  descEl: HTMLElement;
}

export function renderTooltip(refs: TooltipRefs, info: TooltipInfo): void {
  refs.nameEl.textContent = info.tier !== undefined ? `${info.name} (palier ${info.tier})` : info.name;
  refs.linesEl.innerHTML = '';
  const costLine = document.createElement('div');
  costLine.textContent = `Coût : ${info.cost}g`;
  refs.linesEl.appendChild(costLine);
  for (const line of info.lines) {
    const el = document.createElement('div');
    el.textContent = line;
    refs.linesEl.appendChild(el);
  }
  // Jamais de texte invente : ce champ n'existe encore dans aucune donnee
  // (voir descriptionOf) — la ligne reste simplement absente tant que
  // balance.json ne fournit rien.
  refs.descEl.textContent = info.description ?? '';
}

function towerTooltip(defId: string): TooltipInfo | null {
  const def = towers.get(defId);
  if (!def) return null;
  return {
    name: def.name,
    tier: branchInfo(defId).tier + 1,
    cost: def.goldCost,
    lines: [`Dégâts ${def.damageBase}+${def.dice}d${def.sides}`, `Portée ${def.range}`, `Cadence ${def.cooldown}s`],
    description: descriptionOf(def),
  };
}

// ---------------------------------------------------------------------------
// Mode build — reprend le contenu de l'ancien #panel-build, en tuiles.
// ---------------------------------------------------------------------------

export interface BuildTile extends TileRefs {
  defId: string;
}

export function buildBuildGrid(
  container: HTMLElement,
  onPick: (defId: string) => void,
  onHover: (defId: string | null) => void,
): BuildTile[] {
  const out: BuildTile[] = [];
  for (const id of buildableTowers) {
    const def: TowerDef | undefined = towers.get(id);
    if (!def) continue;
    const tile = buildTile(
      { id, name: def.name, cost: def.goldCost, color: branchColor(id), iconUrl: iconUrlOf(def) },
      () => onPick(id),
      (hovering) => onHover(hovering ? id : null),
    );
    // Les tours n'ont ni stock ni rechargement — ces elements de la tuile
    // generique restent simplement vides/masques pour ce mode.
    tile.stockEl.hidden = true;
    tile.veilEl.hidden = true;
    tile.countdownEl.hidden = true;
    container.appendChild(tile.wrap);
    out.push({ ...tile, defId: id });
  }
  return out;
}

export function updateBuildGrid(tiles: BuildTile[], armedId: string | null): void {
  for (const t of tiles) {
    t.button.classList.toggle('armed', t.defId === armedId);
  }
}

export function buildTooltipForBuildTile(defId: string): TooltipInfo | null {
  return towerTooltip(defId);
}

/** Verifie l'or AVANT toute action (armement) — pas de tuile grisee/desactivee,
 * juste un toast si les fonds manquent, et rien ne se passe. */
export function canAffordOrToast(arena: Arena, cost: number): boolean {
  if (arena.gold < cost) {
    toast('Or insuffisant', 'warn');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Mode send — reprend le contenu de l'ancien #panel-shop. Une boutique a la
// fois est affichee (voir main.ts, palier CONSULTE = etat d'UI local, jamais
// stocke dans GameState) ; `buildSendGrid` prend le `Shop` a afficher en
// parametre plutot que de lire `shops[0]`/un id en dur, donc naviguer entre
// plusieurs boutiques n'est qu'un appel supplementaire cote appelant.
// ---------------------------------------------------------------------------

export interface SendTile extends TileRefs {
  defId: string;
}

export function buildSendGrid(
  shop: Shop,
  container: HTMLElement,
  onSend: (defId: string) => void,
  onHover: (defId: string | null) => void,
): SendTile[] {
  const out: SendTile[] = [];
  for (const id of shop.sells) {
    const def: CreepDef | undefined = creeps.get(id);
    if (!def) continue;
    const tile = buildTile(
      { id, name: def.name, cost: def.goldCost, color: ARMOR_COLORS[def.armorType], iconUrl: iconUrlOf(def) },
      () => onSend(id),
      (hovering) => onHover(hovering ? id : null),
    );
    container.appendChild(tile.wrap);
    out.push({ ...tile, defId: id });
  }
  return out;
}

/** Duree totale (secondes) de l'etat "indisponible" en cours — le denominateur
 * du voile qui se vide (voir updateSendGrid) : le delai de deblocage initial
 * avant que ce creep ne soit jamais vendu, ou l'intervalle de reappro une
 * fois le stock a zero. */
function unavailableWindowSec(def: CreepDef, state: GameState, st: { availableAt: number; count: number }): number | null {
  if (state.tick < st.availableAt) return def.stockStartDelay;
  if (st.count < 1) return def.stockReplenishInterval;
  return null;
}

export function updateSendGrid(tiles: SendTile[], state: GameState, arena: Arena): void {
  for (const t of tiles) {
    const def = creeps.get(t.defId);
    const st = arena.stock[t.defId];
    if (!def || !st) continue;

    const readyAtTick = state.tick < st.availableAt ? st.availableAt : st.count < 1 ? st.nextReplenish : null;
    const totalSec = unavailableWindowSec(def, state, st);
    if (readyAtTick !== null && totalSec !== null && totalSec > 0) {
      const remainingSec = Math.max(0, (readyAtTick - state.tick) / TICK_RATE);
      const pct = Math.max(0, Math.min(100, (remainingSec / totalSec) * 100));
      t.veilEl.hidden = false;
      t.veilEl.style.setProperty('--veil-pct', `${pct}%`);
      t.countdownEl.hidden = false;
      t.countdownEl.textContent = `${Math.ceil(remainingSec)}s`;
      t.stockEl.hidden = true;
    } else {
      t.veilEl.hidden = true;
      t.countdownEl.hidden = true;
      t.stockEl.hidden = false;
      t.stockEl.textContent = `×${st.count}`;
    }
  }
}

export function sendTooltipForTile(defId: string, state: GameState, arena: Arena): TooltipInfo | null {
  const def = creeps.get(defId);
  if (!def) return null;
  const st = arena.stock[defId];
  const lines = [`Revenu +${def.pointValue}/manche`];
  if (st) {
    if (state.tick < st.availableAt) {
      lines.push(`Verrouillé — ${fmtClock((st.availableAt - state.tick) / TICK_RATE)}`);
    } else if (st.count < 1) {
      lines.push(`Recharge — ${fmtClock((st.nextReplenish - state.tick) / TICK_RATE)}`);
    } else {
      lines.push(`Stock : ×${st.count}`);
    }
  }
  return {
    name: def.name,
    cost: def.goldCost,
    lines,
    description: descriptionOf(def),
  };
}

// ---------------------------------------------------------------------------
// Bouton de deblocage — sous la grille du mode send. Cible TOUJOURS le
// palier immediatement APRES arena.unlockedShopTier (jamais le palier
// consulte a l'ecran, voir main.ts) : c'est ce que la commande unlockShop
// (packages/sim) fait elle-meme, ce bouton n'en est qu'une facade.
// ---------------------------------------------------------------------------

/** Ce qu'il y a a debloquer ensuite, ou null si le dernier palier est deja
 * acquis (le bouton doit alors disparaitre — voir updateUnlockButton). */
export function nextShopToUnlock(arena: Arena, allShops: readonly Shop[]): Shop | null {
  return allShops[arena.unlockedShopTier + 1] ?? null;
}

export function buildUnlockButton(container: HTMLButtonElement, onClick: () => void): void {
  container.addEventListener('click', onClick);
}

/** Met a jour le libelle et la visibilite du bouton — jamais son etat
 * disabled : un or insuffisant se traite au clic (toast), pas par un bouton
 * grise (brief, meme regle que les tuiles). */
export function updateUnlockButton(btn: HTMLButtonElement, arena: Arena, allShops: readonly Shop[]): void {
  const next = nextShopToUnlock(arena, allShops);
  if (!next) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  btn.textContent = `Débloquer la ${next.name} — ${next.goldCost.toLocaleString('fr-FR')} or`;
}

// ---------------------------------------------------------------------------
// Modale de confirmation — un achat de plusieurs milliers d'or ne doit
// jamais partir d'un simple clic malheureux (brief).
// ---------------------------------------------------------------------------

export interface UnlockConfirmRefs {
  root: HTMLElement;
  title: HTMLElement;
  detail: HTMLElement;
  cost: HTMLElement;
  before: HTMLElement;
  after: HTMLElement;
  confirmBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
}

export function showUnlockConfirm(refs: UnlockConfirmRefs, shop: Shop, arena: Arena): void {
  refs.title.textContent = `Débloquer la ${shop.name}`;
  refs.detail.textContent = `Donne accès aux créatures de ${shop.name} pour tous vos envois futurs.`;
  refs.cost.textContent = `${shop.goldCost.toLocaleString('fr-FR')} or`;
  refs.before.textContent = `${Math.floor(arena.gold).toLocaleString('fr-FR')} or`;
  refs.after.textContent = `${Math.floor(arena.gold - shop.goldCost).toLocaleString('fr-FR')} or`;
  refs.root.hidden = false;
}

export function hideUnlockConfirm(refs: UnlockConfirmRefs): void {
  refs.root.hidden = true;
}
