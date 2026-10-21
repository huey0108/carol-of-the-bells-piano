// WebAudio: context + iOS unlock + simple piano-like synth (stage 3 replaces it with Salamander samples).
let ac: AudioContext | null = null;
let out: GainNode | null = null;
let unlocked = false;
let enabled = true;

export const setSoundEnabled = (on: boolean) => { enabled = on; };
export const soundEnabled = () => enabled;

export function ctx(): AudioContext {
  if (!ac) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ac = new C({ latencyHint: 'interactive' });
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    out = ac.createGain(); out.gain.value = 0.9;
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

export let notesPlayed = 0;
export function tone(m: number, when: number, dur: number, vel = 0.8): void {
  if (!enabled || !ac || !out) return;
  const a = ac, f = 440 * 2 ** ((m - 69) / 12);
  const lp = a.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(14000, f * 9), when);
  lp.frequency.setTargetAtTime(Math.max(f * 2, 400), when + 0.01, 0.6);
  const g = a.createGain();
  lp.connect(g); g.connect(out);
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
  notesPlayed++;
}
