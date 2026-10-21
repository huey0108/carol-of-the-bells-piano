import './style.css';
import { EVENTS, ONSETS, END, MEASURES, BEATS_PER_MEASURE, RANGE, noteName, type Hand, type LabelMode } from './score';
import { ctx, unlock, tone, audioState, setSoundEnabled } from './audio';
import { Keyboard2D } from './keyboard2d';
import type { CamPreset, KeyState, Quality, Range, Renderer } from './types';

type HandSel = 'both' | 'R' | 'L';
interface Settings { tempo: number; hands: HandSel; labels: LabelMode; cam: CamPreset; quality: Quality; view: '3d' | '2d'; sound: boolean; follow: boolean }
const DEF: Settings = { tempo: 80, hands: 'both', labels: 'pl', cam: 'learn', quality: 'medium', view: '3d', sound: true, follow: true };
const KEY = 'carol-piano-settings-v1';
const settings: Settings = { ...DEF, ...(() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })() };
const save = () => localStorage.setItem(KEY, JSON.stringify(settings));

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const stage = $('#stage');

// ---------- renderer ----------
let view: Renderer;
let scene3d: import('./scene3d').Scene3D | null = null;
async function makeRenderer(): Promise<void> {
  view?.dispose(); scene3d = null;
  if (settings.view === '3d') {
    const mod = await import('./scene3d');
    if (mod.webglAvailable()) {
      try { scene3d = new mod.Scene3D(stage, settings.quality); scene3d.setPreset(settings.cam); view = scene3d; }
      catch (e) { console.warn('3D failed, falling back to 2D', e); }
    }
  }
  if (!scene3d) view = new Keyboard2D(stage);
  document.body.dataset.view = view.kind;
  (window as unknown as Record<string, unknown>).__app = { get view() { return view; }, get cur() { return cur; }, get playing() { return playing; }, audioState };
  render(cur, true);
}

// ---------- transport ----------
let cur = 0, playing = false, startAc = 0, startBeat = 0, sched = 0;
const handOn = (h: Hand) => settings.hands === 'both' || settings.hands === h;
const spb = () => 60 / settings.tempo;

function activeAt(t: number) {
  const act = new Map<number, KeyState>(); const now: string[] = [];
  for (const e of EVENTS) {
    if (e.t > t + 1e-6) break;
    if (t < e.t + e.d - 1e-6) {
      const fresh = Math.abs(e.t - t) < 0.26;
      const prev = act.get(e.m);
      if (!prev || fresh) act.set(e.m, { hand: e.hand, fresh });
      if (fresh) now.push(`${e.hand === 'R' ? 'PR' : 'LR'} ${noteName(e.m, settings.labels === 'off' ? 'pl' : settings.labels)}`);
    }
  }
  return { act, now };
}

// Camera focus: notes sounding in the current measure ±1 (smooths jumps)
function focusFor(t: number): Range {
  if (!settings.follow) return { lo: 21, hi: 108 };
  const mi = Math.floor(t / BEATS_PER_MEASURE);
  let lo = 200, hi = 0;
  for (const e of EVENTS) if (e.mi >= mi - 1 && e.mi <= mi + 2) { lo = Math.min(lo, e.m); hi = Math.max(hi, e.m); }
  if (hi === 0) return { lo: RANGE.lo, hi: RANGE.hi };
  lo -= 2; hi += 2;
  if (hi - lo < 24) { const c = (lo + hi) / 2; lo = Math.round(c - 12); hi = Math.round(c + 12); }
  return { lo: Math.max(21, lo), hi: Math.min(108, hi) };
}
let lastFocus: Range = { lo: 0, hi: 0 };

function render(t: number, force = false): void {
  const { act, now } = activeAt(t);
  let f = focusFor(t);
  // hysteresis: only reframe on bar change
  if (!force && Math.floor(t / 3) === Math.floor(lastRenderT / 3)) f = lastFocus;
  lastFocus = f; lastRenderT = t;
  view?.update(act, settings.labels, f);
  const mi = Math.min(MEASURES - 1, Math.floor(t / BEATS_PER_MEASURE));
  $('#measure').textContent = `${mi + 1}`;
  $('#beat').textContent = (t - mi * 3 + 1).toFixed(1).replace('.0', '');
  ($('#seek') as HTMLInputElement).value = String(t);
  $('#now').textContent = now.length ? [...new Set(now)].sort().join('  ·  ') : '—';
}
let lastRenderT = -1;

function schedule(): void {
  if (!playing) return;
  const a = ctx(), s = spb();
  const t = startBeat + (a.currentTime - startAc) / s;
  const ahead = t + 0.25 / s;
  for (const e of EVENTS) {
    if (e.t > ahead) break;
    if (e.t > sched && handOn(e.hand)) tone(e.m, startAc + (e.t - startBeat) * s, e.d * s);
  }
  sched = Math.max(sched, ahead);
  cur = Math.max(startBeat, t);
  if (cur >= END) { stop(); cur = 0; render(0, true); }
}

async function play(): Promise<void> {
  const ok = await unlock();
  setAudioBadge();
  if (!ok) return;
  const a = ctx();
  playing = true; document.body.classList.add('playing');
  if (cur >= END - 0.01) cur = 0;
  startAc = a.currentTime + 0.06; startBeat = cur; sched = startBeat - 1e-9;
}
function stop(): void { playing = false; document.body.classList.remove('playing'); }
function restartClock(): void { if (playing) { const a = ctx(); startAc = a.currentTime + 0.03; startBeat = cur; sched = cur; } }

async function stepTo(t: number): Promise<void> {
  stop(); cur = Math.max(0, Math.min(END - 0.01, t)); render(cur, true);
  if (!settings.sound) return;
  if (await unlock()) {
    const a = ctx();
    for (const e of EVENTS) if (Math.abs(e.t - cur) < 1e-6 && handOn(e.hand)) tone(e.m, a.currentTime + 0.02, Math.min(e.d, 2) * spb());
  }
  setAudioBadge();
}
const next = () => { const n = ONSETS.find(o => o > cur + 1e-6); if (n !== undefined) void stepTo(n); };
const prev = () => { const p = [...ONSETS].reverse().find(o => o < cur - 1e-6); void stepTo(p ?? 0); };

function setAudioBadge(): void {
  const st = audioState();
  const b = $('#audio');
  b.dataset.state = !settings.sound ? 'off' : st;
  b.title = !settings.sound ? 'Dźwięk wyłączony' : st === 'running' ? 'Dźwięk działa' : 'Dotknij ▶, aby włączyć dźwięk';
  b.textContent = !settings.sound ? '🔇' : st === 'running' ? '🔊' : '🔈';
}

// ---------- main loop ----------
let lastT = performance.now();
let fpsAcc = 0, fpsN = 0, fps = 60;
function loop(now: number): void {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (playing) { schedule(); render(cur); }
  view?.frame(dt, now / 1000);
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; $('#fps').textContent = view?.kind === '3d' ? `${Math.round(fps)} fps` : ''; }
  requestAnimationFrame(loop);
}

// ---------- UI wiring ----------
function seg(name: string, value: string, onPick: (v: string) => void): void {
  const all = () => document.querySelectorAll<HTMLButtonElement>(`[data-seg="${name}"] button`);
  const mark = (v: string) => all().forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  mark(value);
  all().forEach(b => { b.onclick = () => { mark(b.dataset.v!); onPick(b.dataset.v!); }; });
}

function initUI(): void {
  $('#play').onclick = () => { if (playing) stop(); else void play(); };
  $('#prev').onclick = prev; $('#next').onclick = next;
  $('#restart').onclick = () => { stop(); void stepTo(0); };

  const tempos = [...document.querySelectorAll<HTMLInputElement>('[data-tempo]')];
  const showTempo = () => { tempos.forEach(i => { i.value = String(settings.tempo); }); document.querySelectorAll('.tempoVal').forEach(e => { e.textContent = String(settings.tempo); }); };
  showTempo();
  tempos.forEach(i => { i.oninput = () => { settings.tempo = +i.value; showTempo(); restartClock(); save(); }; });

  const seek = $('#seek') as HTMLInputElement; seek.max = String(END - 0.01);
  seek.oninput = () => { cur = +seek.value; restartClock(); render(cur, true); };
  $('#measureTotal').textContent = String(MEASURES);
  $('#measureBtn').onclick = () => {
    const v = prompt(`Przejdź do taktu (1–${MEASURES})`, $('#measure').textContent || '1');
    const n = v ? parseInt(v, 10) : NaN; if (n >= 1 && n <= MEASURES) void stepTo((n - 1) * BEATS_PER_MEASURE);
  };

  seg('hands', settings.hands, v => { settings.hands = v as HandSel; save(); });
  seg('cam', settings.cam, v => { settings.cam = v as CamPreset; scene3d?.setPreset(settings.cam); save(); });
  seg('labels', settings.labels, v => { settings.labels = v as LabelMode; render(cur, true); save(); });
  seg('quality', settings.quality, v => { settings.quality = v as Quality; scene3d?.setQuality(settings.quality); save(); });
  seg('viewMode', settings.view, v => { settings.view = v as '3d' | '2d'; save(); void makeRenderer(); });

  const snd = $('#sound') as HTMLInputElement; snd.checked = settings.sound; setSoundEnabled(settings.sound);
  snd.onchange = () => { settings.sound = snd.checked; setSoundEnabled(snd.checked); setAudioBadge(); save(); };
  const fol = $('#follow') as HTMLInputElement; fol.checked = settings.follow;
  fol.onchange = () => { settings.follow = fol.checked; render(cur, true); save(); };
  $('#audio').onclick = async () => { await unlock(); setAudioBadge(); };

  const sheet = $('#sheet');
  const toggleSheet = (open?: boolean) => { const o = open ?? !sheet.classList.contains('open'); sheet.classList.toggle('open', o); $('#settingsBtn').setAttribute('aria-expanded', String(o)); };
  $('#settingsBtn').onclick = () => toggleSheet();
  $('#sheetClose').onclick = () => toggleSheet(false);
  ($('#rotateHint button') as HTMLButtonElement).onclick = () => document.body.classList.add('hint-off');
  $('#recenter').onclick = () => scene3d?.setPreset(settings.cam);

  document.addEventListener('keydown', e => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); $('#play').click(); }
    else if (e.code === 'ArrowRight') next();
    else if (e.code === 'ArrowLeft') prev();
    else if (e.key === 'Escape') toggleSheet(false);
  });
  new ResizeObserver(() => view?.resize()).observe(stage);
  setAudioBadge();
}

initUI();
void makeRenderer().then(() => requestAnimationFrame(loop));
