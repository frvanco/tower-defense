import type { Difficulty } from '@tower-defense/sim';

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Facile',
  medium: 'Moyen',
  hard: 'Difficile',
};

/**
 * Une ligne par niveau, pour le panneau de choix du launcher. Verifiees
 * contre le comportement reel de Bot.decide() (packages/sim/src/bot.ts) :
 * la difficulte module uniquement la COMPETENCE du bot (vitesse de decision,
 * qualite du placement, reaction aux menaces), jamais sa personnalite ni le
 * nombre de bots. "Difficile" ne place pas mieux que "Moyen" (meme tri des
 * emplacements par distance au chemin) — sa distinction reelle est la
 * cadence de decision et l'agressivite qui suit la phase de partie.
 */
export const DIFFICULTY_DESCRIPTIONS: Record<Difficulty, string> = {
  easy: "Décident lentement, sautent une amélioration sur deux et placent leurs tours sans optimiser l'emplacement.",
  medium: 'Placent leurs tours en fonction du tracé du chemin et réagissent aux vagues aériennes.',
  hard: "Décident plus vite, et investissent d'abord dans leurs tours avant d'envoyer davantage de creeps en fin de partie.",
};

export const DEFAULT_DIFFICULTY: Difficulty = 'medium';

const STORAGE_KEY = 'td_difficulty';

/** Dernier niveau joue, ou le defaut si aucun (premier lancement) ou si
 * localStorage est indisponible (navigation privee stricte, etc.). */
export function loadStoredDifficulty(): Difficulty {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'easy' || v === 'medium' || v === 'hard') return v;
  } catch {
    // Ignore : persistance best-effort, jamais bloquante.
  }
  return DEFAULT_DIFFICULTY;
}

export function storeDifficulty(d: Difficulty): void {
  try {
    localStorage.setItem(STORAGE_KEY, d);
  } catch {
    // Ignore : persistance best-effort, jamais bloquante.
  }
}
