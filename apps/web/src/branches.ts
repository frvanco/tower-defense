import { towers, buildableTowers, branches } from '@tower-defense/data';

export interface BranchInfo {
  branch: number;
  tier: number;
}

/**
 * Tower branch/tier lookup, derived at runtime by walking TowerDef.upgradesTo
 * from each of the 6 directly-buildable roots. Nothing here is hardcoded
 * beyond "these are the roots" (which is itself `@tower-defense/data`'s own list) —
 * if the tower tree in the data ever changes shape, this just walks it again.
 */
const info = new Map<string, BranchInfo>();

buildableTowers.forEach((rootId, branch) => {
  let frontier: string[] = [rootId];
  let tier = 0;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      if (info.has(id)) continue;
      info.set(id, { branch, tier });
      const def = towers.get(id);
      if (def) next.push(...def.upgradesTo);
    }
    frontier = next;
    tier += 1;
  }
});

export function branchInfo(defId: string): BranchInfo {
  return info.get(defId) ?? { branch: 0, tier: 0 };
}

/** Nom affichable de la branche d'une tour — Balistique, Acide, Givre,
 * Anti-aerien, Reacteur, Cadence (voir la section `branches` de balance.json).
 * A preferer au nom de la tour racine pour designer la branche : ce dernier
 * change au fil des rebalances. */
export function branchName(defId: string): string {
  const branch = branchInfo(defId).branch;
  return branches[branch]?.name ?? '';
}

/**
 * Une teinte distincte par branche, indexee par l'ID DE SA RACINE et non par
 * sa position dans `buildableTowers`. Cette liste fixe aussi l'ordre de la
 * barre d'achat : indexer les couleurs dessus les faisait permuter des qu'on
 * reordonnait les tuiles, alors qu'une branche doit garder sa couleur quoi
 * qu'il arrive — c'est un reperage pour le joueur, pas une decoration.
 */
const BRANCH_HUES: Record<string, number> = {
  h000: 8, // Balistique — rouge
  o001: 265, // Acide — violet
  o003: 195, // Givre — cyan
  h005: 100, // Anti-aerien — vert
  h008: 48, // Reacteur — jaune
  o008: 322, // Cadence — rose
};

export function branchHue(defId: string): number {
  const rootId = buildableTowers[branchInfo(defId).branch];
  return (rootId !== undefined ? BRANCH_HUES[rootId] : undefined) ?? 0;
}

export function branchColor(defId: string, alpha = 1): string {
  const { tier } = branchInfo(defId);
  const hue = branchHue(defId);
  const light = Math.min(72, 40 + tier * 7);
  return alpha >= 1 ? `hsl(${hue} 65% ${light}%)` : `hsl(${hue} 65% ${light}% / ${alpha})`;
}
