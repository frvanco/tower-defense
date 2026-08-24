import { towers, creeps, shops, buildableTowers, lanes, type Lane } from '@tower-defense/data';
import { TICK_RATE, type GameState, type Arena } from '@tower-defense/sim';
import { branchColor, branchInfo } from './branches.js';
import { ARMOR_COLORS, laneColor } from './colors.js';

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- topbar ----------

export interface TopbarRefs {
  gold: HTMLElement;
  income: HTMLElement;
  lives: HTMLElement;
  round: HTMLElement;
  countdown: HTMLElement;
  elapsed: HTMLElement;
}

export function updateTopbar(refs: TopbarRefs, state: GameState): void {
  const arena = state.arenas[0];
  if (!arena) return;
  refs.gold.textContent = String(Math.floor(arena.gold));
  refs.income.textContent = String(arena.income);
  refs.lives.textContent = arena.alive ? String(arena.lives) : 'dead';
  refs.round.textContent = String(state.round);
  refs.countdown.textContent = fmtClock((state.nextRoundAt - state.tick) / TICK_RATE);
  // Temps de jeu (state.tick), jamais une horloge murale : reste correct sous
  // Pause/2x/4x, et le jour ou la partie sera pilotee par un serveur.
  refs.elapsed.textContent = fmtClock(state.tick / TICK_RATE);
}

// ---------- build panel ----------

export interface BuildButton {
  defId: string;
  el: HTMLButtonElement;
}

export function buildBuildPanel(container: HTMLElement, onPick: (defId: string) => void): BuildButton[] {
  const out: BuildButton[] = [];
  for (const id of buildableTowers) {
    const def = towers.get(id);
    if (!def) continue;
    const btn = document.createElement('button');
    btn.className = 'build-btn';
    btn.style.setProperty('--branch-color', branchColor(id));
    btn.appendChild(h('span', 'name', def.name));
    btn.appendChild(h('span', 'cost', `${def.goldCost}g`));
    btn.addEventListener('click', () => onPick(id));
    container.appendChild(btn);
    out.push({ defId: id, el: btn });
  }
  return out;
}

export function updateBuildPanel(buttons: BuildButton[], arena: Arena, armedId: string | null): void {
  for (const b of buttons) {
    const def = towers.get(b.defId);
    if (!def) continue;
    b.el.disabled = !arena.alive || arena.gold < def.goldCost;
    b.el.classList.toggle('armed', b.defId === armedId);
  }
}

// ---------- shop / send-creep panel ----------

export interface ShopRow {
  defId: string;
  statusEl: HTMLElement;
  btn: HTMLButtonElement;
}

export function buildShopPanel(container: HTMLElement, onSend: (defId: string) => void): ShopRow[] {
  const out: ShopRow[] = [];
  const seen = new Set<string>();
  for (const shop of shops) {
    const ids = shop.sells.filter((id) => creeps.has(id) && !seen.has(id));
    if (ids.length === 0) continue;
    container.appendChild(h('h4', undefined, shop.name));
    container.appendChild(h('div', 'shop-world', shop.world));
    for (const id of ids) {
      seen.add(id);
      const def = creeps.get(id);
      if (!def) continue;

      const row = h('div', 'shop-row');
      const swatch = h('span', 'creep-swatch');
      swatch.style.background = ARMOR_COLORS[def.armorType];
      row.appendChild(swatch);

      const info = h('div', 'shop-info');
      info.appendChild(h('span', 'shop-name', def.name));
      const meta = h('span', 'shop-meta', `${def.goldCost}g · +${def.pointValue} income`);
      info.appendChild(meta);
      row.appendChild(info);

      const statusEl = h('span', 'shop-status', '');
      row.appendChild(statusEl);

      const btn = document.createElement('button');
      btn.className = 'shop-send-btn';
      btn.textContent = 'Send';
      btn.addEventListener('click', () => onSend(id));
      row.appendChild(btn);

      container.appendChild(row);
      out.push({ defId: id, statusEl, btn });
    }
  }
  return out;
}

export function updateShopPanel(rows: ShopRow[], state: GameState, arena: Arena): void {
  for (const r of rows) {
    const def = creeps.get(r.defId);
    const st = arena.stock[r.defId];
    if (!def || !st) continue;

    let sendable = arena.alive;
    let status: string;
    if (state.tick < st.availableAt) {
      status = `locked ${fmtClock((st.availableAt - state.tick) / TICK_RATE)}`;
      sendable = false;
    } else if (st.count < 1) {
      status = `restock ${fmtClock((st.nextReplenish - state.tick) / TICK_RATE)}`;
      sendable = false;
    } else {
      status = `x${st.count}`;
    }
    if (sendable && arena.gold < def.goldCost) sendable = false;

    r.statusEl.textContent = status;
    r.btn.disabled = !sendable;
  }
}

// ---------- other arenas panel ----------

export interface ArenaRow {
  player: number;
  el: HTMLElement;
  livesEl: HTMLElement;
  statusEl: HTMLElement;
}

export function buildArenasPanel(container: HTMLElement, playerCount: number): ArenaRow[] {
  const out: ArenaRow[] = [];
  for (let p = 1; p < playerCount; p++) {
    const lane: Lane | undefined = lanes.find((l) => l.player === p);
    const row = h('div', 'arena-row');
    const swatch = h('span', 'arena-swatch');
    swatch.style.background = laneColor(lane?.color);
    row.appendChild(swatch);
    row.appendChild(h('span', 'arena-label', `P${p}`));
    const livesEl = h('span', 'arena-lives', '-');
    const statusEl = h('span', 'arena-status', '');
    row.appendChild(livesEl);
    row.appendChild(statusEl);
    container.appendChild(row);
    out.push({ player: p, el: row, livesEl, statusEl });
  }
  return out;
}

export function updateArenasPanel(rows: ArenaRow[], state: GameState): void {
  for (const r of rows) {
    const arena = state.arenas[r.player];
    if (!arena) continue;
    r.el.classList.toggle('dead', !arena.alive);
    r.livesEl.textContent = arena.alive ? `${arena.lives} lives` : 'eliminated';
    r.statusEl.textContent = arena.alive ? `${arena.income}g/rd` : '';
  }
}

// ---------- selected tower panel ----------

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
