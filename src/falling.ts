// Falling-notes lane ("neon ocean"): glowing SDF note bars (one instanced draw), animated water caustics,
// rising bubbles, splash ripples on the hit line, and note-name labels on the notes + on the far rail.
import * as THREE from 'three';
import { EVENTS, isBlack, noteName, type LabelMode } from './score';
import { HAND_HEX, type Quality } from './types';

export type LaneLabels = 'both' | 'notes' | 'top' | 'off';
export type LaneStyle = 'neon' | 'classic';
export interface LaneDims { keyX: Map<number, number>; ww: number; bw: number; hitZ: number; lane: number; look: number; width: number }

const PAD = 0.007;        // glow margin around each note bar (m)
const NOTE_POOL = 40, TOP_POOL = 28, RIPPLES = 24;

const NOTE_VS = /* glsl */`
attribute vec3 aColor; attribute vec2 aSize; attribute float aGlow;
varying vec2 vP; varying vec2 vSize; varying vec3 vColor; varying float vGlow; varying float vZ;
void main() {
  vSize = aSize; vColor = aColor; vGlow = aGlow;
  vP = position.xz * (aSize + 2.0 * ${PAD.toFixed(4)});
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vZ = wp.z;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const NOTE_FS = /* glsl */`
uniform float uFar; uniform float uTime; uniform float uNeon;
varying vec2 vP; varying vec2 vSize; varying vec3 vColor; varying float vGlow; varying float vZ;
float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 h = vSize * 0.5;
  float r = min(0.0042, min(h.x, h.y));
  float d = sdRound(vP, h, r);
  float fill = 1.0 - smoothstep(-0.0005, 0.0005, d);
  float rim = (1.0 - smoothstep(0.0, 0.0012, abs(d + 0.0009))) * fill;
  float glow = exp(-max(d, 0.0) / ${(PAD * 0.32).toFixed(5)}) * (1.0 - fill);
  float along = clamp((vP.y + h.y) / max(vSize.y, 1e-4), 0.0, 1.0);      // 0 = tail, 1 = leading edge
  float center = 1.0 - smoothstep(0.0, h.x, abs(vP.x));
  float band = 0.5 + 0.5 * sin(vZ * 160.0 + uTime * 2.6);                  // light shimmering through water
  vec3 c = vColor;
  vec3 body = c * (0.22 + 0.45 * along + 0.3 * center) * (1.0 + 0.22 * band * uNeon) * (1.0 + 0.6 * vGlow);
  vec3 col = body * fill
           + mix(c, vec3(1.0), 0.5) * rim * (1.1 + 0.8 * vGlow)
           + c * glow * (0.35 + 1.1 * vGlow) * (0.25 + 0.75 * uNeon);
  col *= smoothstep(uFar, uFar + 0.05, vZ);                                // emerge from the deep
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const WATER_VS = /* glsl */`
varying vec3 vW;
void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const WATER_FS = /* glsl */`
uniform float uTime; uniform float uFar; uniform float uHit; uniform float uX0; uniform float uWW;
uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uLine; uniform float uCaustic; uniform float uPulse;
varying vec3 vW;
#define TAU 6.28318530718
float caustic(vec2 uv, float time) {
  vec2 p = mod(uv * TAU, TAU) - 250.0;
  vec2 i = p; float c = 1.0; float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 4.0; c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}
void main() {
  float near = clamp((vW.z - uFar) / (uHit - uFar), 0.0, 1.0);             // 0 far .. 1 hit line
  vec3 col = mix(uDeep, uShallow, pow(near, 1.6));
  col += uShallow * 1.6 * caustic(vW.xz * vec2(3.2, 4.0), uTime * 0.45) * uCaustic * (0.25 + 0.75 * near);
  float k = (vW.x - uX0) / uWW;
  float dk = abs(fract(k) - 0.5);
  col += uLine * (1.0 - smoothstep(0.0, 0.025, dk)) * 0.035 * (0.3 + 0.7 * near); // faint key columns
  float oct = abs(fract((k + 2.0 - 0.5) / 7.0 + 0.5 / 7.0) - 0.5 / 7.0);   // octave guide just left of each C
  col += uLine * (1.0 - smoothstep(0.0, 0.006, oct)) * 0.22;
  col += uLine * exp(-(uHit - vW.z) / 0.018) * (0.25 + 0.35 * uPulse);   // glow where notes land
  col *= smoothstep(0.0, 0.12, near) * 0.85 + 0.15;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const HIT_FS = /* glsl */`
uniform vec3 uColor; uniform float uPulse; varying vec2 vUv;
void main() {
  float d = abs(vUv.y - 0.5) * 2.0;
  float a = exp(-d * 9.0) * (0.55 + 0.45 * uPulse) + exp(-d * 60.0) * 1.2;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <colorspace_fragment>
}`;

interface Ripple { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number }

export class FallingLane {
  readonly group = new THREE.Group();
  private notes: THREE.InstancedMesh;
  private aColor: THREE.InstancedBufferAttribute; private aSize: THREE.InstancedBufferAttribute; private aGlow: THREE.InstancedBufferAttribute;
  private noteMat: THREE.ShaderMaterial; private waterMat: THREE.ShaderMaterial; private hitMat: THREE.ShaderMaterial;
  private barLines: THREE.Mesh[] = [];
  private bubbles: THREE.Points; private bubblePos: Float32Array; private bubbleVel: Float32Array; private bubbleCount = 0;
  private ripples: Ripple[] = []; private rippleI = 0;
  private noteLabels: THREE.Sprite[] = []; private topLabels: THREE.Sprite[] = [];
  private texCache = new Map<string, THREE.CanvasTexture>();
  private beat = 0; private lastBeat = -1; private visible = 0; private labelsShown = 0;
  private hands: 'both' | 'R' | 'L' = 'both';
  private labelMode: LaneLabels = 'both'; private nameMode: LabelMode = 'pl';
  private style: LaneStyle = 'neon';
  private pulse = 0;
  private m4 = new THREE.Matrix4();
  private far: number;

  constructor(private d: LaneDims) {
    const g = this.group;
    this.far = d.hitZ - d.lane;
    const zc = d.hitZ - d.lane / 2;
    const x0 = Math.min(...[...d.keyX].filter(([m]) => !isBlack(m)).map(([, x]) => x));

    // water floor (slightly larger than the lane; fades into the deep)
    this.waterMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VS, fragmentShader: WATER_FS,
      uniforms: {
        uTime: { value: 0 }, uFar: { value: this.far - 0.03 }, uHit: { value: d.hitZ }, uX0: { value: x0 - d.ww / 2 }, uWW: { value: d.ww },
        uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uLine: { value: new THREE.Color() },
        uCaustic: { value: 1 }, uPulse: { value: 0 },
      },
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(d.width + 0.02, d.lane + 0.05), this.waterMat);
    water.rotation.x = -Math.PI / 2; water.position.set(0, -0.0012, zc - 0.025); g.add(water);

    // bar lines
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(d.width, 0.0012), new THREE.MeshBasicMaterial({ color: 0x3fd8ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
      b.rotation.x = -Math.PI / 2; b.position.y = 0.0003; b.visible = false; g.add(b); this.barLines.push(b);
    }

    // hit line glow
    this.hitMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: HIT_FS, uniforms: { uColor: { value: new THREE.Color(0x5ff5ff) }, uPulse: { value: 0 } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(d.width, 0.014), this.hitMat);
    hit.rotation.x = -Math.PI / 2; hit.position.set(0, 0.0065, d.hitZ); hit.renderOrder = 5; g.add(hit);

    // notes: one instanced quad per event, SDF-shaded
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const n = EVENTS.length;
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
    this.aGlow = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    for (const a of [this.aSize, this.aGlow]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aColor', this.aColor); geo.setAttribute('aSize', this.aSize); geo.setAttribute('aGlow', this.aGlow);
    this.noteMat = new THREE.ShaderMaterial({
      vertexShader: NOTE_VS, fragmentShader: NOTE_FS,
      uniforms: { uFar: { value: this.far }, uTime: { value: 0 }, uNeon: { value: 1 } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.notes = new THREE.InstancedMesh(geo, this.noteMat, n);
    this.notes.frustumCulled = false; this.notes.renderOrder = 6;
    g.add(this.notes);

    // bubbles
    const NB = 220;
    this.bubblePos = new Float32Array(NB * 3); this.bubbleVel = new Float32Array(NB);
    for (let i = 0; i < NB; i++) this.respawnBubble(i, true);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(this.bubblePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.bubbles = new THREE.Points(bg, new THREE.PointsMaterial({
      map: this.bubbleTex(), size: 0.0042, sizeAttenuation: true, transparent: true, opacity: 0.55,
      color: 0x9ff6ff, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.bubbles.frustumCulled = false; this.bubbles.renderOrder = 4;
    g.add(this.bubbles);

    // splash ripples
    const rg = new THREE.RingGeometry(0.72, 1, 48); rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < RIPPLES; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(rg, mat); mesh.visible = false; mesh.renderOrder = 7; g.add(mesh);
      this.ripples.push({ mesh, mat, t: 1 });
    }

    // label pools
    const mkSprite = () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, transparent: true }));
      s.visible = false; s.renderOrder = 20; g.add(s); return s;
    };
    for (let i = 0; i < NOTE_POOL; i++) this.noteLabels.push(mkSprite());
    for (let i = 0; i < TOP_POOL; i++) this.topLabels.push(mkSprite());

    this.setStyle('neon');
    this.setQuality('medium');
  }

  // ---------- configuration ----------
  setStyle(s: LaneStyle): void {
    this.style = s;
    const neon = s === 'neon';
    const u = this.waterMat.uniforms;
    (u.uDeep.value as THREE.Color).set(neon ? 0x01040c : 0x07090f);
    (u.uShallow.value as THREE.Color).set(neon ? 0x04313f : 0x10141d);
    (u.uLine.value as THREE.Color).set(neon ? 0x35e8ff : 0x3a4560);
    this.noteMat.uniforms.uNeon.value = neon ? 1 : 0;
    (this.hitMat.uniforms.uColor.value as THREE.Color).set(neon ? 0x5ff5ff : 0x5b8cff);
    this.barLines.forEach(b => ((b.material as THREE.MeshBasicMaterial).color.set(neon ? 0x3fd8ff : 0x4a5675)));
    this.bubbles.visible = neon && this.bubbleCount > 0;
    this.recolor(); this.texCache.clear(); this.lastBeat = -1;
  }
  setQuality(q: Quality): void {
    this.bubbleCount = q === 'low' ? 0 : q === 'medium' ? 120 : 220;
    this.bubbles.geometry.setDrawRange(0, this.bubbleCount);
    this.bubbles.visible = this.style === 'neon' && this.bubbleCount > 0;
    this.waterMat.uniforms.uCaustic.value = q === 'low' ? 0 : 1;
  }
  setHands(h: 'both' | 'R' | 'L'): void { if (h !== this.hands) { this.hands = h; this.recolor(); this.lastBeat = -1; } }
  setLabels(mode: LaneLabels): void { this.labelMode = mode; this.lastBeat = -1; }
  setNameMode(m: LabelMode): void { if (m !== this.nameMode) { this.nameMode = m; this.lastBeat = -1; } }
  setTime(beat: number): void { this.beat = beat; }
  count(): number { return this.visible; }
  labelCount(): number { return this.labelsShown; }

  private dimmed(hand: 'R' | 'L') { return this.hands !== 'both' && hand !== this.hands; }
  private recolor(): void {
    const c = new THREE.Color();
    EVENTS.forEach((e, i) => {
      c.set(HAND_HEX[e.hand]);
      if (isBlack(e.m)) c.offsetHSL(0, 0, -0.08);
      if (this.dimmed(e.hand)) c.multiplyScalar(0.28);
      this.aColor.setXYZ(i, c.r, c.g, c.b);
    });
    this.aColor.needsUpdate = true;
  }

  // ---------- per frame ----------
  frame(dt: number, time: number): void {
    const moved = this.beat !== this.lastBeat;
    if (moved) {
      // splash for every note that crossed the hit line since last frame (normal forward playback only)
      if (this.lastBeat >= 0 && this.beat > this.lastBeat && this.beat - this.lastBeat < 0.75) {
        for (const e of EVENTS) {
          if (e.t > this.beat) break;
          if (e.t > this.lastBeat && !this.dimmed(e.hand)) this.splash(this.d.keyX.get(e.m)!, HAND_HEX[e.hand]);
        }
        if (Math.floor(this.beat) > Math.floor(this.lastBeat)) this.pulse = Math.floor(this.beat) % 3 === 0 ? 1 : 0.55;
      }
      this.layout();
    }
    this.pulse = Math.max(0, this.pulse - dt * 2.2);
    this.noteMat.uniforms.uTime.value = time;
    this.waterMat.uniforms.uTime.value = time;
    this.waterMat.uniforms.uPulse.value = this.pulse;
    this.hitMat.uniforms.uPulse.value = this.pulse;
    if (this.bubbles.visible) this.animateBubbles(dt, time);
    for (const r of this.ripples) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / 0.65);
      const e = 1 - (1 - r.t) ** 3;
      const s = 0.004 + e * 0.024;
      r.mesh.scale.set(s, 1, s * 0.75);
      r.mat.opacity = (1 - r.t) * 0.9;
      r.mesh.visible = r.t < 1;
    }
  }

  private layout(): void {
    this.lastBeat = this.beat;
    const { hitZ, lane, look, keyX, ww, bw } = this.d;
    const S = lane / look, m4 = this.m4;
    let vis = 0;
    const upcoming: { i: number; s: number; zF: number }[] = [];
    const tops = new Map<number, { hand: 'R' | 'L'; fresh: number }>();
    EVENTS.forEach((e, i) => {
      const s = e.t - this.beat, en = e.t + e.d - this.beat;
      if (en <= 0 || s >= look) { m4.makeScale(0, 0, 0); this.notes.setMatrixAt(i, m4); this.aGlow.setX(i, 0); return; }
      const zF = hitZ - Math.max(0, s) * S, zB = hitZ - Math.min(look, en) * S;
      const depth = Math.max(0.0015, zF - zB - 0.0018);
      const black = isBlack(e.m);
      const w = black ? bw * 0.78 : ww * 0.7;
      m4.makeScale(w + 2 * PAD, 1, depth + 2 * PAD);
      m4.setPosition(keyX.get(e.m)!, black ? 0.0042 : 0.0028, zF - depth / 2);
      this.notes.setMatrixAt(i, m4);
      this.aSize.setXY(i, w, depth);
      // glow builds up as the note approaches, full while it sounds
      const glow = s <= 0 ? 1 : Math.max(0, 1 - s / 1.5) ** 2 * 0.7;
      this.aGlow.setX(i, this.dimmed(e.hand) ? glow * 0.3 : glow);
      vis++;
      if (s > 0.04) upcoming.push({ i, s, zF });
      const t = tops.get(e.m);
      const fresh = Math.max(0, 1 - (look - s) / 0.9); // 1 when just spawned at the far edge
      if (!t || fresh > t.fresh) tops.set(e.m, { hand: e.hand, fresh: Math.max(fresh, t?.fresh ?? 0) });
    });
    this.notes.instanceMatrix.needsUpdate = true; this.aSize.needsUpdate = true; this.aGlow.needsUpdate = true;
    this.visible = vis;

    const b0 = Math.ceil(this.beat / 3 - 1e-6) * 3;
    this.barLines.forEach((b, i) => { const rel = b0 + 3 * i - this.beat; b.visible = rel < look; b.position.z = hitZ - rel * S; });

    // ----- labels -----
    let shown = 0;
    const names = this.nameMode !== 'off' && this.labelMode !== 'off';
    const onNotes = names && (this.labelMode === 'both' || this.labelMode === 'notes');
    const onTop = names && (this.labelMode === 'both' || this.labelMode === 'top');
    upcoming.sort((a, b) => a.s - b.s);
    this.noteLabels.forEach((sp, k) => {
      const u = onNotes ? upcoming[k] : undefined;
      if (!u) { sp.visible = false; return; }
      const e = EVENTS[u.i], black = isBlack(e.m);
      this.setLabel(sp, noteName(e.m, this.nameMode, false), e.hand, 'note');
      const sz = black ? 0.017 : 0.0205;
      sp.scale.set(sz, sz, 1);
      sp.position.set(keyX.get(e.m)!, 0.012, u.zF - sz * 0.7);
      const fade = THREE.MathUtils.clamp((u.zF - this.far) / 0.05, 0, 1);
      (sp.material as THREE.SpriteMaterial).opacity = fade * (this.dimmed(e.hand) ? 0.45 : 1);
      sp.visible = fade > 0.01; if (sp.visible) shown++;
    });
    const topList = onTop ? [...tops.entries()].sort((a, b) => a[0] - b[0]) : [];
    this.topLabels.forEach((sp, k) => {
      const t = topList[k];
      if (!t) { sp.visible = false; return; }
      const [m, { hand, fresh }] = t;
      const black = isBlack(m);
      this.setLabel(sp, noteName(m, this.nameMode, true), hand, 'top');
      const sz = (black ? 0.021 : 0.024) * (1 + 0.2 * fresh);
      sp.scale.set(sz * 1.25, sz, 1);
      // black-key names one row further back so neighbours never overlap
      sp.position.set(keyX.get(m)!, 0.012, this.far + 0.004 - (black ? 0.024 : 0));
      (sp.material as THREE.SpriteMaterial).opacity = (this.dimmed(hand) ? 0.4 : 0.72) + 0.28 * fresh;
      sp.visible = true; shown++;
    });
    this.labelsShown = shown;
  }

  private setLabel(sp: THREE.Sprite, text: string, hand: 'R' | 'L', kind: 'note' | 'top'): void {
    const key = `${kind}|${text}|${HAND_HEX[hand]}|${this.style}`;
    if (sp.userData.key === key) return;
    let tex = this.texCache.get(key);
    if (!tex) { tex = this.labelTex(text, HAND_HEX[hand], kind); this.texCache.set(key, tex); }
    const mat = sp.material as THREE.SpriteMaterial;
    mat.map = tex; mat.needsUpdate = true; sp.userData.key = key;
  }

  private labelTex(text: string, hex: string, kind: 'note' | 'top'): THREE.CanvasTexture {
    const neon = this.style === 'neon';
    const W = kind === 'top' ? 160 : 128, H = 128;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    const r = kind === 'top' ? 46 : 50;
    g.save();
    if (neon) { g.shadowColor = hex; g.shadowBlur = 22; }
    g.beginPath();
    if (kind === 'top') g.roundRect(W / 2 - 66, H / 2 - r, 132, r * 2, r); else g.arc(W / 2, H / 2, r, 0, Math.PI * 2);
    g.fillStyle = neon ? 'rgba(2,10,22,.88)' : 'rgba(10,12,18,.85)'; g.fill();
    g.lineWidth = neon ? 7 : 5; g.strokeStyle = hex; g.stroke();
    g.restore();
    const fs = kind === 'top' ? (text.length > 4 ? 40 : text.length > 2 ? 48 : 56) : (text.length > 3 ? 36 : text.length > 1 ? 46 : 60);
    g.font = `800 ${fs}px system-ui, -apple-system, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (neon) { g.shadowColor = hex; g.shadowBlur = 14; }
    g.fillStyle = '#fff'; g.fillText(text, W / 2, H / 2 + 3);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    return tex;
  }

  private splash(x: number, hex: string): void {
    const r = this.ripples[this.rippleI++ % RIPPLES];
    r.t = 0; r.mat.color.set(hex); r.mesh.position.set(x, 0.007, this.d.hitZ); r.mesh.visible = true;
  }

  private respawnBubble(i: number, anywhere: boolean): void {
    const { width, hitZ, lane } = this.d;
    this.bubblePos[i * 3] = (Math.random() - 0.5) * width;
    this.bubblePos[i * 3 + 1] = 0.002 + Math.random() * 0.03;
    this.bubblePos[i * 3 + 2] = anywhere ? hitZ - Math.random() * lane : hitZ - Math.random() * 0.02;
    this.bubbleVel[i] = 0.006 + Math.random() * 0.016;
  }
  private animateBubbles(dt: number, time: number): void {
    const p = this.bubblePos;
    for (let i = 0; i < this.bubbleCount; i++) {
      p[i * 3 + 2] -= this.bubbleVel[i] * dt;                       // drift away from the keys, into the deep
      p[i * 3] += Math.sin(time * 1.7 + i * 1.3) * 0.0009 * dt;
      p[i * 3 + 1] += 0.004 * dt;
      if (p[i * 3 + 2] < this.far - 0.02 || p[i * 3 + 1] > 0.05) this.respawnBubble(i, false);
    }
    (this.bubbles.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
  private bubbleTex(): THREE.CanvasTexture {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 4, 32, 32, 30);
    grd.addColorStop(0, 'rgba(255,255,255,0.05)'); grd.addColorStop(0.7, 'rgba(255,255,255,0.25)');
    grd.addColorStop(0.9, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(24, 22, 5, 0, Math.PI * 2); g.fill();
    return new THREE.CanvasTexture(c);
  }
}
