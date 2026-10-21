import type { Hand, LabelMode } from './score';

export interface KeyState { hand: Hand; fresh: boolean }
export type CamPreset = 'learn' | 'player' | 'cinema';
export type Quality = 'high' | 'medium' | 'low';
export interface Range { lo: number; hi: number }

export interface Renderer {
  readonly kind: '3d' | '2d';
  readonly keyCount: number;
  update(active: Map<number, KeyState>, labels: LabelMode, focus: Range): void;
  frame(dt: number, time: number): void;
  resize(): void;
  dispose(): void;
}

export const HAND_HEX: Record<Hand, string> = { R: '#3b82f6', L: '#f97316' };
