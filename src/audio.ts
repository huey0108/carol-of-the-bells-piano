// WebAudio engine: context + iOS unlock, Salamander Grand Piano sampler (fallback: simple synth).
// Samples: Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0 (mp3 set from tonejs.github.io/audio/salamander).
let ac: AudioContext | null = null;
let out: GainNode | null = null;
let unlocked = false;
let enabled = true;
let volume = 0.8;

export type Instrument = 'piano' | 'synth';
let instrument: Instrument = 'piano';
export const setInstrument = (i: Instrument) => { instrument = i; };
export const setSoundEnabled = (on: boolean) => { enabled = on; };
export const soundEnabled = () => enabled;
export function setVolume(v: number): void { volume = v; if (out && ac) out.gain.setTargetAtTime(v, ac.currentTime, 0.02); }

export function ctx(): AudioContext {
  if (!ac) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ac = new C({ latencyHint: 'interactive' });
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
    out = ac.createGain(); out.gain.value = volume;
    out.connect(comp).connect(ac.destination);
  }
  return ac;
}
export const audioState = () => (ac ? ac.state : 'none');

function silentWavUrl(): string {
  const sr = 8000, n = 800, b = new ArrayBuffer(44 + n), v = new DataView(b);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}

/** Must be called from a user gesture. Resumes the context and works around the iOS mute switch. */
export async function unlock(): Promise<boolean> {
  const a = ctx();
  try { const s = (navigator as unknown as { audioSession?: { type: string } }).audioSession; if (s) s.type = 'playback'; } catch { /* ignore */ }
  if (!unlocked) {
    try { const el = new Audio(silentWavUrl()); el.loop = true; el.setAttribute('playsinline', ''); el.volume = 0.01; void el.play().catch(() => {}); } catch { /* ignore */ }
    try { const s = a.createBufferSource(); s.buffer = a.createBuffer(1, 1, 22050); s.connect(a.destination); s.start(0); } catch { /* ignore */ }
    unlocked = true;
  }
  if (a.state !== 'running') { try { await a.resume(); } catch { /* ignore */ } }
  return a.state === 'running';
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ac && ac.state !== 'running') ac.resume().catch(() => {});
});

// ---------- Salamander sampler ----------
// One sample every minor third (A1..D#6) covers the piece (B1..B5); playbackRate shifts ≤ ±1.5 semitones.
const SAMPLE_NOTES: [string, number][] = [
  ['A1', 33], ['C2', 36], ['Ds2', 39], ['Fs2', 42], ['A2', 45], ['C3', 48], ['Ds3', 51], ['Fs3', 54], ['A3', 57],
  ['C4', 60], ['Ds4', 63], ['Fs4', 66], ['A4', 69], ['C5', 72], ['Ds5', 75], ['Fs5', 78], ['A5', 81], ['C6', 84], ['Ds6', 87],
];
const buffers = new Map<number, AudioBuffer>();
let loadState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let loaded = 0;
export const pianoStatus = () => ({ state: loadState, loaded, total: SAMPLE_NOTES.length });
type Listener = (s: ReturnType<typeof pianoStatus>) => void;
const listeners: Listener[] = [];
export const onPianoStatus = (f: Listener) => { listeners.push(f); f(pianoStatus()); };
const emit = () => listeners.forEach(f => f(pianoStatus()));

const decode = (a: AudioContext, data: ArrayBuffer) => new Promise<AudioBuffer>((res, rej) => {
  const p = a.decodeAudioData(data, res, rej) as unknown as Promise<AudioBuffer> | undefined; // callback form for older Safari
  if (p && typeof p.then === 'function') p.then(res, rej);
});

export function loadPiano(): Promise<void> {
  if (loadState === 'loading' || loadState === 'ready') return Promise.resolve();
  loadState = 'loading'; loaded = 0; emit();
  const a = ctx(); // decoding works while the context is still suspended
  const base = `${import.meta.env.BASE_URL}samples/salamander/`;
  return Promise.allSettled(SAMPLE_NOTES.map(async ([name, m]) => {
    const r = await fetch(base + name + '.mp3');
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    buffers.set(m, await decode(a, await r.arrayBuffer()));
    loaded++; emit();
  })).then(rs => {
    const bad = rs.filter(r => r.status === 'rejected');
    if (bad.length) console.warn('piano samples failed', bad);
    loadState = buffers.size ? 'ready' : 'error'; emit();
  });
}

function nearest(m: number): [number, AudioBuffer] | null {
  let best: [number, AudioBuffer] | null = null;
  for (const [sm, b] of buffers) if (!best || Math.abs(sm - m) < Math.abs(best[0] - m)) best = [sm, b];
  return best;
}

export let notesPlayed = 0;

function pianoNote(a: AudioContext, dest: AudioNode, m: number, when: number, dur: number, vel: number): boolean {
  const s = nearest(m); if (!s) return false;
  const src = a.createBufferSource();
  src.buffer = s[1];
  const rate = 2 ** ((m - s[0]) / 12);
  src.playbackRate.value = rate;
  // brightness follows velocity (soft notes are darker), like a real hammer
  const lp = a.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.value = 1500 + vel * vel * 15000; lp.Q.value = 0.3;
  const g = a.createGain();
  const peak = 1.5 * vel ** 1.4;
  const off = when + Math.max(0.12, dur);
  const releaseT = m < 40 ? 0.4 : m < 60 ? 0.25 : 0.15; // dampers stop the bass more slowly
  g.gain.setValueAtTime(peak, when);
  g.gain.setValueAtTime(peak, off);
  g.gain.setTargetAtTime(0, off, releaseT / 3);
  src.connect(lp).connect(g).connect(dest);
  src.start(when, 0);
  src.stop(Math.min(when + s[1].duration / rate, off + releaseT * 3));
  return true;
}

function synthNote(a: AudioContext, dest: AudioNode, m: number, when: number, dur: number, vel: number): void {
  const f = 440 * 2 ** ((m - 69) / 12);
  const lp = a.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(14000, f * 9), when);
  lp.frequency.setTargetAtTime(Math.max(f * 2, 400), when + 0.01, 0.6);
  const g = a.createGain();
  lp.connect(g); g.connect(dest);
  const peak = (m < 48 ? 0.32 : 0.22) * vel;
  const rel = when + Math.max(0.2, dur);
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.006);
  g.gain.setTargetAtTime(peak * 0.18, when + 0.006, 0.55);
  g.gain.setTargetAtTime(0, rel, 0.09);
  for (const [h, amp, type, det] of [[1, 1, 'triangle', 0], [2, 0.35, 'sine', 2], [3, 0.12, 'sine', -3], [4, 0.05, 'sine', 4]] as const) {
    const o = a.createOscillator(), og = a.createGain();
    o.type = type; o.frequency.value = f * h; o.detune.value = det; og.gain.value = amp;
    o.connect(og).connect(lp); o.start(when); o.stop(rel + 0.7);
  }
}

/** Metronome tick (accent = downbeat). */
export function click(when: number, accent: boolean): void {
  if (!enabled || !ac || !out) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'square'; o.frequency.value = accent ? 1760 : 1175;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(accent ? 0.16 : 0.09, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  o.connect(g).connect(out); o.start(when); o.stop(when + 0.06);
}

/** Schedule a note. vel 0..1. Uses the synth until piano samples are decoded (or if synth is selected). */
export function tone(m: number, when: number, dur: number, vel = 0.8): void {
  if (!enabled || !ac || !out) return;
  const ok = instrument === 'piano' && pianoNote(ac, out, m, when, dur, vel);
  if (!ok) synthNote(ac, out, m, when, dur, vel);
  notesPlayed++;
}
