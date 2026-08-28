import { towers } from '@tower-defense/data';
import { TICK_RATE, type GameState, type Arena } from '@tower-defense/sim';
import { branchInfo } from './branches.js';

export function fmtClock(totalSeconds: number): string {
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
