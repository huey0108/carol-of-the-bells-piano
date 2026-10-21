// 2D SVG fallback keyboard (no WebGL / low-end devices).
import { isBlack, noteName, type LabelMode } from './score';
import { HAND_HEX, type KeyState, type Renderer } from './types';

const SVGNS = 'http://www.w3.org/2000/svg';

export class Keyboard2D implements Renderer {
  readonly kind = '2d' as const;
  readonly keyCount: number;
  private keys = new Map<number, { r: SVGRectElement; black: boolean; label: SVGTextElement }>();
  private svg: SVGSVGElement;

  constructor(private host: HTMLElement) {
    const WW = 20, WH = 120, BW = 12, BH = 76;
    const svg = document.createElementNS(SVGNS, 'svg'); this.svg = svg;
    svg.classList.add('kb2d');
    const mk = <K extends keyof SVGElementTagNameMap>(t: K, a: Record<string, string | number>) => {
      const e = document.createElementNS(SVGNS, t); for (const k in a) e.setAttribute(k, String(a[k])); svg.appendChild(e); return e;
    };
    let x = 0; const whites: [number, number][] = [], blacks: [number, number][] = [];
    for (let m = 21; m <= 108; m++) { if (!isBlack(m)) { whites.push([m, x]); x += WW; } else blacks.push([m, x - BW / 2]); }
    svg.setAttribute('viewBox', `0 0 ${x} ${WH + 18}`);
    const pending: [number, number, boolean][] = [];
    for (const [m, wx] of whites) {
      const r = mk('rect', { x: wx, y: 0, width: WW, height: WH, fill: '#fff', stroke: '#555', 'stroke-width': .8, rx: 2 });
      this.keys.set(m, { r, black: false, label: null as unknown as SVGTextElement }); pending.push([m, wx + WW / 2, false]);
      if (m % 12 === 0) { const t = mk('text', { x: wx + WW / 2, y: WH + 14, 'text-anchor': 'middle', 'font-size': 10, fill: 'currentColor' }); t.textContent = 'C' + (m / 12 - 1); }
      if (m === 60) mk('circle', { cx: wx + WW / 2, cy: WH - 8, r: 2.5, fill: '#999' });
    }
    for (const [m, bx] of blacks) {
      const r = mk('rect', { x: bx, y: 0, width: BW, height: BH, fill: '#222', stroke: '#000', 'stroke-width': .8, rx: 1.5 });
      this.keys.set(m, { r, black: true, label: null as unknown as SVGTextElement }); pending.push([m, bx + BW / 2, true]);
    }
    for (const [m, cx, b] of pending) {
      const label = mk('text', { x: cx, y: b ? BH - 6 : WH - 16, 'text-anchor': 'middle', 'font-size': b ? 7.5 : 9, 'font-weight': 700, fill: '#fff' });
      label.style.display = 'none'; this.keys.get(m)!.label = label;
    }
    this.keyCount = this.keys.size;
    host.appendChild(svg);
  }

  update(active: Map<number, KeyState>, labels: LabelMode): void {
    for (const [m, k] of this.keys) {
      const s = active.get(m);
      if (!s) { k.r.setAttribute('fill', k.black ? '#222' : '#fff'); k.label.style.display = 'none'; continue; }
      k.r.setAttribute('fill', s.fresh ? HAND_HEX[s.hand] : (s.hand === 'R' ? '#93b8f5' : '#f8b98a'));
      const txt = noteName(m, labels, false);
      k.label.textContent = txt; k.label.style.display = txt ? '' : 'none';
    }
  }
  frame(): void { /* static */ }
  resize(): void { /* svg scales */ }
  dispose(): void { this.svg.remove(); }
}
