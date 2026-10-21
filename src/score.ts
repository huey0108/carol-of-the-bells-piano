// Carol of the Bells (arr. Musicnotes MN0060566), transcribed from the PDF.
// Measure = list of voices per hand; voice = list of [notes[], beats]; "X~" = tied continuation.
export type Hand = 'R' | 'L';
export interface NoteEvent { t: number; d: number; m: number; hand: Hand; mi: number }
type Step = [string[], number];
type Voice = Step[];
interface Measure { rh: Voice[]; lh: Voice[] }

const N = (n: string[], d: number): Step => [n, d];
const ost4: Voice = [N(['G4'], 1), N(['F#4'], .5), N(['G4'], .5), N(['E4'], 1)];
const ost4t: Voice = [N(['G4', 'B4'], 1), N(['A4'], .5), N(['B4'], .5), N(['G4'], 1)];
const o5 = (l: string): Voice => [N([l, 'G5'], 1), N(['F#5'], .5), N(['G5'], .5), N(['E5'], 1)];
const o5top: Voice = [N(['G5'], 1), N(['F#5'], .5), N(['G5'], .5), N(['E5'], 1)];
const o5h: Voice = [N(['G5', 'B5'], 1), N(['A5'], .5), N(['B5'], .5), N(['G5'], 1)];
const mel1: Voice = [N(['E5'], 1), N(['E5'], .5), N(['E5'], .5), N(['D5'], .5), N(['C5'], .5)];
const mel2: Voice = [N(['B4'], 1), N(['B4'], .5), N(['B4'], .5), N(['A4'], .5), N(['G4'], .5)];
const mel3: Voice = [N(['A4'], 1), N(['A4'], .5), N(['A4'], .5), N(['B4'], .5), N(['A4'], .5)];
const run = (o: number): Voice => ['B', 'C#', 'D#', 'E', 'F#', 'G'].map((p, i) => N([p + (i === 0 ? o : o + 1)], .5));
const dh = (n: string[]): Voice[] => [[N(n, 3)]];
const lhOst: Voice[] = [[N(['G3'], 1), N(['F#3'], .5), N(['G3'], .5), N(['E3'], 1)]];
const Bped: Voice[] = [[N([], 1), N(['B2'], 2)], [N(['B1'], 3)]];
const climb: Voice = [N(['A5'], .5), N(['B5'], .5), N(['A5'], 1), N(['G5'], 1)];
const M = (rh: Voice[], lh: Voice[]): Measure => ({ rh, lh });

const S: Measure[] = [];
// page 1
for (let i = 0; i < 4; i++) S.push(M([ost4], []));
for (const b of ['E3', 'D3', 'C3', 'B2', 'E3', 'D3', 'C3', 'B2']) S.push(M([ost4], dh([b])));
for (const b of ['E2', 'D2', 'C2', 'B1']) S.push(M([ost4t], dh([b])));
S.push(M([mel1], dh(['E3'])), M([mel2], dh(['D3'])), M([mel3], dh(['C3'])), M([ost4], dh(['B2'])));
S.push(M([run(3)], Bped));
S.push(M([[N(['A4'], .5), N(['B4'], .5), N(['A4'], 1), N(['G4'], 1)]], dh(['B2~', 'B1~'])));
S.push(M([run(4)], Bped));
S.push(M([[N(['A5'], .5), N(['B5'], .5), N(['A5'], 1), N(['E5', 'G5'], 1)]], dh(['B2~', 'B1~'])));
S.push(M([o5('E5')], dh(['E3', 'G3'])), M([o5('D5')], dh(['D3', 'G3'])), M([o5('C5')], dh(['C3', 'E3'])), M([o5('B4')], dh(['B2', 'D#3'])));
// page 2
S.push(M([o5('E5')], dh(['E2', 'E3'])), M([o5('D5')], dh(['D2', 'D3'])), M([o5('C5')], dh(['C2', 'C3'])), M([o5('B4')], dh(['B1', 'B2'])));
for (const l of ['E5', 'D5', 'C5', 'B4']) S.push(M([o5(l)], lhOst));
S.push(M([mel1], dh(['E3', 'G3'])), M([mel2], dh(['D3', 'G3'])), M([mel3], dh(['C3', 'E3'])), M([ost4], dh(['B2', 'D#3'])));
S.push(M([run(4)], Bped), M([climb], [[N(['B2~', 'B1~'], 2), N(['E2'], 1)]]));
S.push(M([run(4)], Bped), M([climb], [[N(['B2~', 'B1~'], 2), N(['E2'], 1)]]));
S.push(M([o5('E5')], dh(['E3', 'G3'])), M([o5('D5')], dh(['D3', 'G3'])), M([o5('C5')], dh(['C3', 'E3'])), M([o5('B4')], dh(['B2', 'D#3'])));
S.push(M([o5h], dh(['E3'])), M([o5h], dh(['D3'])), M([o5h], dh(['C3'])), M([o5h], dh(['B2'])));
S.push(M([o5('E5')], dh(['B2~'])), M([o5('D5')], dh(['B2~'])));
S.push(M([o5top, [N(['C5'], 2)]], dh(['B2~'])), M([o5top, [N(['B4'], 2)]], dh(['B2'])));
S.push(M([o5top, [N(['B4'], 3)]], [[N([], 1), N(['E3'], 2)], [N(['E2'], 3)]]));
for (let i = 0; i < 3; i++) S.push(M([o5top, [N(['B4~'], 3)]], dh(['E3~', 'E2~'])));

export const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const midi = (s: string): number => {
  const m = s.replace('~', '').match(/^([A-G]#?)(\d)$/);
  if (!m) throw new Error('bad note ' + s);
  return 12 * (+m[2] + 1) + NAMES.indexOf(m[1]);
};

export const BEATS_PER_MEASURE = 3;
export const MEASURES = S.length;
export const END = MEASURES * BEATS_PER_MEASURE;

function flatten(): NoteEvent[] {
  const raw: (NoteEvent & { tie: boolean })[] = [];
  S.forEach((ms, mi) => {
    const t0 = mi * BEATS_PER_MEASURE;
    for (const [hand, vs] of [['R', ms.rh], ['L', ms.lh]] as const)
      for (const v of vs) {
        let t = t0;
        for (const [ns, d] of v) { for (const n of ns) raw.push({ t, d, m: midi(n), hand, mi, tie: n.endsWith('~') }); t += d; }
      }
  });
  raw.sort((a, b) => a.t - b.t || a.m - b.m);
  const out: NoteEvent[] = [];
  for (const e of raw) {
    if (e.tie) {
      const p = [...out].reverse().find(x => x.m === e.m && x.hand === e.hand && Math.abs(x.t + x.d - e.t) < 1e-6);
      if (p) { p.d += e.d; continue; }
    }
    out.push({ t: e.t, d: e.d, m: e.m, hand: e.hand, mi: e.mi });
  }
  return out;
}

export const EVENTS = flatten();
export const ONSETS = [...new Set(EVENTS.map(e => e.t))].sort((a, b) => a - b);
export const RANGE = { lo: Math.min(...EVENTS.map(e => e.m)), hi: Math.max(...EVENTS.map(e => e.m)) };

const PL: Record<string, string> = { C: 'C', 'C#': 'C♯', D: 'D', 'D#': 'D♯', E: 'E', F: 'F', 'F#': 'F♯', G: 'G', 'G#': 'G♯', A: 'A', 'A#': 'A♯', B: 'H' };
const SOLF: Record<string, string> = { C: 'Do', 'C#': 'Do♯', D: 'Re', 'D#': 'Re♯', E: 'Mi', F: 'Fa', 'F#': 'Fa♯', G: 'Sol', 'G#': 'Sol♯', A: 'La', 'A#': 'La♯', B: 'Si' };
export type LabelMode = 'pl' | 'solf' | 'off';
export const noteName = (m: number, mode: LabelMode = 'pl', octave = true): string => {
  if (mode === 'off') return '';
  const p = NAMES[m % 12];
  return (mode === 'solf' ? SOLF[p] : PL[p]) + (octave ? String(Math.floor(m / 12) - 1) : '');
};
export const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);
