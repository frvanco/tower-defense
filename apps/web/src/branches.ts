import { towers, buildableTowers } from '@tower-defense/data';

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

/** One distinct hue per buildable root branch (Cannon, Poison, Ice, Lightning, Nuclear, Water — in `buildableTowers` order). */
const BRANCH_HUES = [8, 265, 195, 100, 48, 322];

export function branchHue(defId: string): number {
  const branch = branchInfo(defId).branch;
  return BRANCH_HUES[branch % BRANCH_HUES.length] ?? 0;
}

export function branchColor(defId: string, alpha = 1): string {
  const { tier } = branchInfo(defId);
  const hue = branchHue(defId);
  const light = Math.min(72, 40 + tier * 7);
  return alpha >= 1 ? `hsl(${hue} 65% ${light}%)` : `hsl(${hue} 65% ${light}% / ${alpha})`;
}
