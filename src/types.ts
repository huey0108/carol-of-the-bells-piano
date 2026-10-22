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
  /** MIDI note under a screen point, or null */
  pick(clientX: number, clientY: number): number | null;
  /** Brief press + colour flash for user input feedback */
  flash(m: number, hex: string): void;
  /** Current playback position in beats (for time-based visuals) */
  setTime?(beat: number): void;
}

export const HAND_HEX: Record<Hand, string> = { R: '#3b82f6', L: '#f97316' };
