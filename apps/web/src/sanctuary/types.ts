import type * as THREE from 'three';

export type Point3 = [number, number, number];
export type DecorShape = 'box' | 'stone' | 'cylinder' | 'cone' | 'sphere' | 'rock' | 'torus';
export type DecorMaterial = 'stone' | 'ivory' | 'metal' | 'wood' | 'leaf' | 'moss' | 'water' | 'sand' | 'team' | 'energy' | 'roof';
export type SanctuaryPalette = Record<DecorMaterial, THREE.ColorRepresentation>;

export interface SanctuaryOptions {
  enabled?: boolean;
  /** Multiplie les bouquets de vegetation et debris, entre 0 et 2. */
  density?: number;
  colors?: Partial<SanctuaryPalette>;
}

export interface Sanctuary {
  group: THREE.Group;
  setEnabled(enabled: boolean): void;
  setPlayer(player: number): void;
  dispose(): void;
}
