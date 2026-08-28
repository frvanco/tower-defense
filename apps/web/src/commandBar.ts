import { towers, buildableTowers, type TowerDef } from '@tower-defense/data';
import type { Arena } from '@tower-defense/sim';
import { branchInfo, branchColor } from './branches.js';
import { toast } from './toast.js';

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
      { id, name: def.name, cost: def.goldCost, color: branchColor(id) },
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
