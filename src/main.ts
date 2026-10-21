import './style.css';
import { EVENTS, ONSETS, END, MEASURES, BEATS_PER_MEASURE, RANGE, noteName, velocity, type Hand, type LabelMode } from './score';
import { ctx, unlock, tone, click, audioState, setSoundEnabled, loadPiano, onPianoStatus, setInstrument, setVolume, pianoStatus, type Instrument } from './audio';
import * as audio from './audio';
import { Keyboard2D } from './keyboard2d';
import { connectMidi, midiSupported } from './midi';
import type { CamPreset, KeyState, Quality, Range, Renderer } from './types';

type HandSel = 'both' | 'R' | 'L';
interface Settings {
  tempo: number; hands: HandSel; labels: LabelMode; cam: CamPreset; quality: Quality; view: '3d' | '2d'; sound: boolean; follow: boolean;
  instrument: Instrument; volume: number; loop: boolean; loopA: number; loopB: number; wait: boolean; metro: boolean; tapPlays: boolean;
}
const DEF: Settings = {
  tempo: 80, hands: 'both', labels: 'pl', cam: 'learn', quality: 'medium', view: '3d', sound: true, follow: true,
  instrument: 'piano', volume: 80, loop: false, loopA: 1, loopB: 4, wait: false, metro: false, tapPlays: true,
};
const KEY = 'carol-piano-settings-v1';
const settings: Settings = { ...DEF, ...(() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })() };
const save = () => localStorage.setItem(KEY, JSON.stringify(settings));

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const stage = $('#stage');
const GOOD = '#22c55e', BAD = '#ef4444', NEUTRAL = '#a78bfa';

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
  render(cur, true);
}

// ---------- transport state ----------
let cur = 0, playing = false, startAc = 0, startBeat = 0, sched = 0, clickSched = 0;
// wait mode
let gate: number | null = null, waiting = false;
const pressed = new Set<number>();
let hits = 0, misses = 0, loopWraps = 0;

const handOn = (h: Hand) => settings.hands === 'both' || settings.hands === h;
const spb = () => 60 / settings.tempo;
const loopRange = (): [number, number] | null => {
  if (!settings.loop) return null;
  const a = Math.max(1, Math.min(settings.loopA, settings.loopB)), b = Math.min(MEASURES, Math.max(settings.loopA, settings.loopB));
  return [(a - 1) * BEATS_PER_MEASURE, b * BEATS_PER_MEASURE];
};
const playEnd = () => loopRange()?.[1] ?? END;

/** Notes the learner must press at onset t (selected hands). */
const required = (t: number) => EVENTS.filter(e => Math.abs(e.t - t) < 1e-6 && handOn(e.hand)).map(e => e.m);
/** Next onset ≥ from with required notes (within the play range). */
function nextGate(from: number): number | null {
  const end = playEnd();
  for (const o of ONSETS) if (o >= from - 1e-6 && o < end - 1e-6 && required(o).length) return o;
  return null;
}

(window as unknown as Record<string, unknown>).__app = {
  get view() { return view; }, get cur() { return cur; }, get playing() { return playing; }, get waiting() { return waiting; },
  get gate() { return gate; }, get stats() { return { hits, misses }; }, get loopWraps() { return loopWraps; }, get notes() { return audio.notesPlayed; },
  audioState, pianoStatus, input: (m: number) => noteInput(m, 'test'), settings,
};

// ---------- rendering ----------
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
let lastRenderT = -1;

function render(t: number, force = false): void {
  const { act, now } = activeAt(t);
  let f = focusFor(t);
  if (!force && Math.floor(t / 3) === Math.floor(lastRenderT / 3)) f = lastFocus;
  lastFocus = f; lastRenderT = t;
  view?.update(act, settings.labels, f);
  const mi = Math.min(MEASURES - 1, Math.floor(t / BEATS_PER_MEASURE));
  $('#measure').textContent = `${mi + 1}`;
  $('#beat').textContent = (t - mi * 3 + 1).toFixed(1).replace('.0', '');
  ($('#seek') as HTMLInputElement).value = String(t);
  const nowEl = $('#now');
  if (waiting && gate !== null) {
    const need = required(gate).filter(m => !pressed.has(m));
    nowEl.innerHTML = `<span class="waitTag">⏳ Czekam na:</span> ${need.map(m => noteName(m, settings.labels === 'off' ? 'pl' : settings.labels)).join('  ·  ')}`;
  } else nowEl.textContent = now.length ? [...new Set(now)].sort().join('  ·  ') : '—';
  document.body.classList.toggle('is-waiting', waiting);
}

function updateStats(): void {
  const total = hits + misses;
  $('#stats').textContent = settings.wait && total ? `✓ ${hits}  ✗ ${misses}  ·  ${Math.round((hits / total) * 100)}%` : '';
}

// ---------- scheduler ----------
function resetClock(at: number, delay = 0.04): void {
  const a = ctx();
  startBeat = at; startAc = a.currentTime + delay; sched = at - 1e-9; clickSched = at - 1e-9;
}

function schedule(): void {
  if (!playing) return;
  const a = ctx(), s = spb();
  let t = startBeat + (a.currentTime - startAc) / s;
  const lr = loopRange();
  const end = playEnd();

  if (t >= end - 1e-6) {
    if (lr) { loopWraps++; resetClock(lr[0], 0); t = lr[0]; pressed.clear(); gate = settings.wait ? nextGate(lr[0]) : null; }
    else { stop(); cur = 0; gate = null; render(0, true); return; }
  }

  if (settings.wait) {
    // a gate is only passed via release(); never skip it because the clock ran past it in one frame
    if (gate === null || gate < startBeat - 1e-6) gate = nextGate(startBeat);
    if (gate !== null && t >= gate) {
      if (satisfied()) release();
      else { t = gate; startBeat = gate; startAc = a.currentTime; if (!waiting) { waiting = true; } }
    }
  }

  let ahead = Math.min(t + 0.25 / s, end);
  const limit = settings.wait && gate !== null ? gate : Infinity;
  for (const e of EVENTS) {
    if (e.t > ahead) break;
    if (e.t <= sched || e.t >= end - 1e-6) continue;
    if (e.t >= limit - 1e-6) break;
    const auto = settings.wait ? !handOn(e.hand) : handOn(e.hand);
    if (auto) tone(e.m, startAc + (e.t - startBeat) * s, e.d * s, velocity(e));
  }
  if (settings.wait && gate !== null) ahead = Math.min(ahead, gate - 1e-6);
  if (settings.metro) {
    for (let b = Math.ceil(clickSched + 1e-6); b <= ahead + 1e-9; b++) {
      if (b >= end) break;
      click(startAc + (b - startBeat) * s, b % BEATS_PER_MEASURE === 0);
    }
  }
  clickSched = Math.max(clickSched, ahead);
  sched = Math.max(sched, ahead);
  cur = Math.max(startBeat, t);
}

function satisfied(): boolean { return gate !== null && required(gate).every(m => pressed.has(m)); }

/** Gate passed: sound the accompaniment at the gate and restart the clock from it. */
function release(): void {
  if (gate === null) return;
  const g = gate, a = ctx();
  waiting = false; pressed.clear();
  if (playing) {
    for (const e of EVENTS) if (Math.abs(e.t - g) < 1e-6 && !handOn(e.hand)) tone(e.m, a.currentTime + 0.01, e.d * spb(), velocity(e));
    if (settings.metro && Math.abs(g - Math.round(g)) < 1e-6) click(a.currentTime + 0.01, Math.round(g) % BEATS_PER_MEASURE === 0);
    startBeat = g; startAc = a.currentTime; sched = g; clickSched = g;
    cur = g;
  }
  gate = nextGate(g + 1e-3);
}

// ---------- input (tap / MIDI) ----------
function noteInput(m: number, src: 'tap' | 'midi' | 'test', vel = 0.7): void {
  if (src === 'tap' && settings.sound) { void unlock().then(ok => { if (ok) tone(m, ctx().currentTime + 0.005, 0.6, vel); }); }
  if (!settings.wait) { view?.flash(m, NEUTRAL); return; }
  const g = gate ?? nextGate(cur);
  if (g === null) { view?.flash(m, NEUTRAL); return; }
  gate = g;
  const req = required(g);
  if (req.includes(m)) {
    if (!pressed.has(m)) hits++;
    pressed.add(m); view?.flash(m, GOOD);
    if (satisfied()) {
      if (playing && waiting) release();
      else if (!playing) { release(); cur = g; void stepToQuiet(gate ?? g); }
    }
  } else { misses++; view?.flash(m, BAD); }
  updateStats(); render(cur, true);
}

function stepToQuiet(t: number): void { cur = Math.max(0, Math.min(END - 0.01, t)); render(cur, true); }

// ---------- transport controls ----------
async function play(): Promise<void> {
  const ok = await unlock();
  setAudioBadge();
  if (!ok) return;
  const lr = loopRange();
  if (cur >= END - 0.01) cur = 0;
  if (lr && (cur < lr[0] - 1e-6 || cur >= lr[1] - 1e-6)) cur = lr[0];
  playing = true; document.body.classList.add('playing');
  resetClock(cur, 0.06);
  gate = settings.wait ? nextGate(cur) : null; waiting = false;
}
function stop(): void { playing = false; waiting = false; document.body.classList.remove('playing', 'is-waiting'); }
function restartClock(): void { if (playing) { const a = ctx(); startAc = a.currentTime + 0.03; startBeat = cur; sched = cur; clickSched = cur; } }

async function stepTo(t: number): Promise<void> {
  stop(); cur = Math.max(0, Math.min(END - 0.01, t)); gate = null; pressed.clear(); render(cur, true);
  if (!settings.sound) return;
  if (await unlock()) {
    const a = ctx();
    for (const e of EVENTS) if (Math.abs(e.t - cur) < 1e-6 && handOn(e.hand)) tone(e.m, a.currentTime + 0.02, Math.min(e.d, 2) * spb(), velocity(e));
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
let fpsAcc = 0, fpsN = 0;
function loop(now: number): void {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (playing) { schedule(); render(cur); }
  view?.frame(dt, now / 1000);
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1) { $('#fps').textContent = view?.kind === '3d' ? `${Math.round(fpsN / fpsAcc)} fps` : ''; fpsAcc = 0; fpsN = 0; }
  requestAnimationFrame(loop);
}

// ---------- UI ----------
function seg(name: string, value: string, onPick: (v: string) => void): void {
  const all = () => document.querySelectorAll<HTMLButtonElement>(`[data-seg="${name}"] button`);
  const mark = (v: string) => all().forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  mark(value);
  all().forEach(b => { b.onclick = () => { mark(b.dataset.v!); onPick(b.dataset.v!); }; });
}
/** Bind a boolean setting to every [data-toggle=name] (top-bar buttons + sheet switches). */
function toggle(name: keyof Settings, after?: () => void): (v?: boolean) => void {
  const els = [...document.querySelectorAll<HTMLElement>(`[data-toggle="${name}"]`)];
  const show = () => els.forEach(el => {
    const on = settings[name] as boolean;
    if (el instanceof HTMLInputElement) el.checked = on; else el.setAttribute('aria-pressed', String(on));
  });
  const set = (v?: boolean) => { (settings[name] as boolean) = v ?? !(settings[name] as boolean); show(); save(); after?.(); };
  els.forEach(el => {
    if (el instanceof HTMLInputElement) el.onchange = () => set(el.checked);
    else el.onclick = () => set();
  });
  show();
  return set;
}

function showLoop(): void {
  const lr = loopRange();
  $('#loopLbl').textContent = settings.loop ? `${Math.min(settings.loopA, settings.loopB)}–${Math.max(settings.loopA, settings.loopB)}` : 'A–B';
  (document.querySelector('#loopA') as HTMLInputElement).value = String(settings.loopA);
  (document.querySelector('#loopB') as HTMLInputElement).value = String(settings.loopB);
  const seek = $('#seek');
  if (lr) {
    const a = (lr[0] / END) * 100, b = (lr[1] / END) * 100;
    seek.style.setProperty('--la', `${a}%`); seek.style.setProperty('--lb', `${b}%`);
    seek.classList.add('has-loop');
  } else seek.classList.remove('has-loop');
}

function initUI(): void {
  $('#play').onclick = () => { if (playing) stop(); else void play(); };
  $('#prev').onclick = prev; $('#next').onclick = next;
  $('#restart').onclick = () => { stop(); const lr = loopRange(); void stepTo(lr ? lr[0] : 0); };

  const tempos = [...document.querySelectorAll<HTMLInputElement>('[data-tempo]')];
  const showTempo = () => { tempos.forEach(i => { i.value = String(settings.tempo); }); document.querySelectorAll('.tempoVal').forEach(e => { e.textContent = String(settings.tempo); }); };
  showTempo();
  tempos.forEach(i => { i.oninput = () => { settings.tempo = +i.value; showTempo(); restartClock(); save(); }; });
  document.querySelectorAll<HTMLButtonElement>('[data-tempo-step]').forEach(b => {
    b.onclick = () => { settings.tempo = Math.max(30, Math.min(160, settings.tempo + +b.dataset.tempoStep!)); showTempo(); restartClock(); save(); };
  });

  const seek = $('#seek') as HTMLInputElement; seek.max = String(END - 0.01);
  seek.oninput = () => { cur = +seek.value; gate = null; pressed.clear(); waiting = false; restartClock(); render(cur, true); };
  $('#measureTotal').textContent = String(MEASURES);
  $('#measureBtn').onclick = () => {
    const v = prompt(`Przejdź do taktu (1–${MEASURES})`, $('#measure').textContent || '1');
    const n = v ? parseInt(v, 10) : NaN; if (n >= 1 && n <= MEASURES) void stepTo((n - 1) * BEATS_PER_MEASURE);
  };

  seg('hands', settings.hands, v => { settings.hands = v as HandSel; gate = null; save(); render(cur, true); });
  seg('cam', settings.cam, v => { settings.cam = v as CamPreset; scene3d?.setPreset(settings.cam); save(); });
  seg('labels', settings.labels, v => { settings.labels = v as LabelMode; render(cur, true); save(); });
  seg('quality', settings.quality, v => { settings.quality = v as Quality; scene3d?.setQuality(settings.quality); save(); });
  seg('viewMode', settings.view, v => { settings.view = v as '3d' | '2d'; save(); void makeRenderer(); });

  // --- practice: loop / wait / metronome
  const setLoop = toggle('loop', () => {
    if (settings.loop && !document.querySelector('#sheet.open')) {
      // first enable from the bar: loop the current 4-bar phrase
      const mi = Math.floor(cur / BEATS_PER_MEASURE);
      settings.loopA = Math.floor(mi / 4) * 4 + 1; settings.loopB = Math.min(MEASURES, settings.loopA + 3); save();
    }
    showLoop(); restartClock();
  });
  const loopA = $('#loopA') as HTMLInputElement, loopB = $('#loopB') as HTMLInputElement;
  loopA.max = loopB.max = String(MEASURES);
  const readLoop = () => { settings.loopA = Math.max(1, Math.min(MEASURES, +loopA.value || 1)); settings.loopB = Math.max(1, Math.min(MEASURES, +loopB.value || 1)); save(); showLoop(); };
  loopA.onchange = readLoop; loopB.onchange = readLoop;
  $('#loopHere').onclick = () => {
    const mi = Math.floor(cur / BEATS_PER_MEASURE) + 1;
    settings.loopA = mi; settings.loopB = Math.min(MEASURES, mi + 3); setLoop(true); showLoop();
  };
  toggle('wait', () => { gate = null; pressed.clear(); waiting = false; hits = misses = 0; updateStats(); document.body.classList.toggle('wait-on', settings.wait); render(cur, true); });
  document.body.classList.toggle('wait-on', settings.wait);
  toggle('metro', () => { clickSched = Math.max(clickSched, cur); });
  toggle('tapPlays');
  showLoop();

  // --- sound
  const snd = $('#sound') as HTMLInputElement; snd.checked = settings.sound; setSoundEnabled(settings.sound);
  snd.onchange = () => { settings.sound = snd.checked; setSoundEnabled(snd.checked); setAudioBadge(); save(); };
  setInstrument(settings.instrument); setVolume(settings.volume / 100);
  seg('instrument', settings.instrument, v => { settings.instrument = v as Instrument; setInstrument(settings.instrument); if (v === 'piano') void loadPiano(); save(); });
  const vol = $('#volume') as HTMLInputElement; vol.value = String(settings.volume); $('#volVal').textContent = String(settings.volume);
  vol.oninput = () => { settings.volume = +vol.value; $('#volVal').textContent = vol.value; setVolume(settings.volume / 100); save(); };
  onPianoStatus(st => {
    $('#pianoStatus').textContent = st.state === 'ready' ? (st.loaded === st.total ? 'gotowy' : `gotowy (${st.loaded}/${st.total})`) : st.state === 'loading' ? `ładowanie ${st.loaded}/${st.total}…` : st.state === 'error' ? 'błąd: używam syntezatora' : '';
    document.body.classList.toggle('piano-loading', st.state === 'loading');
  });
  const fol = $('#follow') as HTMLInputElement; fol.checked = settings.follow;
  fol.onchange = () => { settings.follow = fol.checked; render(cur, true); save(); };
  $('#audio').onclick = async () => { await unlock(); setAudioBadge(); };

  // --- MIDI
  const midiBtn = $('#midiBtn'), midiSt = $('#midiStatus');
  if (!midiSupported()) { midiBtn.setAttribute('disabled', ''); midiSt.textContent = 'niedostępne w tej przeglądarce (np. Safari / iPhone)'; }
  midiBtn.onclick = async () => {
    midiSt.textContent = 'łączenie…';
    const r = await connectMidi((m, v) => noteInput(m, 'midi', v), names => { midiSt.textContent = names.length ? `połączono: ${names.join(', ')}` : 'brak urządzeń: podłącz klawiaturę'; });
    if (!r.ok) midiSt.textContent = r.error;
  };

  // --- tap keys on screen
  let downAt: { x: number; y: number } | null = null;
  stage.addEventListener('pointerdown', e => {
    if (!settings.tapPlays && !settings.wait) return;
    const m = view?.pick(e.clientX, e.clientY);
    downAt = { x: e.clientX, y: e.clientY };
    if (m != null) noteInput(m, 'tap');
  });
  stage.addEventListener('pointerup', () => { downAt = null; });
  void downAt;

  // --- sheet
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
    else if (e.key === 'l' || e.key === 'L') ($('#loopBtn') as HTMLButtonElement).click();
    else if (e.key === 'w' || e.key === 'W') ($('#waitBtn') as HTMLButtonElement).click();
    else if (e.key === 'm' || e.key === 'M') ($('#metroBtn') as HTMLButtonElement).click();
    else if (e.key === 'Escape') toggleSheet(false);
  });
  new ResizeObserver(() => view?.resize()).observe(stage);
  setAudioBadge(); updateStats();
}

initUI();
if (settings.instrument === 'piano') void loadPiano();
void makeRenderer().then(() => requestAnimationFrame(loop));
