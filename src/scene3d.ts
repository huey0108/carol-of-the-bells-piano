// 3D piano: procedural 88-key keyboard (real proportions, in metres), lacquered case,
// rear-hinge key press animation, per-hand emissive highlight, camera presets + auto-framing.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EVENTS, isBlack, noteName, type LabelMode } from './score';
import { HAND_HEX, type CamPreset, type KeyState, type Quality, type Range, type Renderer } from './types';

// Real dimensions (metres)
const WW = 0.0235, WGAP = 0.0009, WL = 0.15, WH = 0.022;
const BW = 0.0137, BL = 0.095, BH = 0.012;
// Falling-notes lane: LOOK beats ahead mapped onto LANE metres behind the keys
const LANE = 0.32, LOOK = 6, HIT_Z = -0.008;
const PRESS_W = THREE.MathUtils.degToRad(3.6), PRESS_B = THREE.MathUtils.degToRad(3.0);
// Black key offset from the gap between neighbouring whites (fraction of BW): C# D# | F# G# A#
const BOFF: Record<number, number> = { 1: -0.22, 3: 0.22, 6: -0.28, 8: 0, 10: 0.28 };

interface Key {
  m: number; black: boolean; pivot: THREE.Group; mesh: THREE.Mesh; mat: THREE.MeshPhysicalMaterial;
  x: number; press: number; target: number; glow: number; glowTarget: number; color: THREE.Color;
  label?: THREE.Sprite; labelText?: string; flashT: number; flashColor: THREE.Color;
}

export class Scene3D implements Renderer {
  readonly kind = '3d' as const;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.01, 20);
  readonly controls: OrbitControls;
  private keys = new Map<number, Key>();
  private keyX = new Map<number, number>();
  private preset: CamPreset = 'learn';
  private userControlled = false;
  private focus: Range = { lo: 21, hi: 108 };
  private camGoal = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  private labelCache = new Map<string, THREE.SpriteMaterial>();
  private key = new THREE.DirectionalLight(0xffffff, 2.2);
  private quality: Quality = 'medium';
  private snapNext = true;
  private animating = true;
  private tmp = new THREE.Color();
  private falling = true; private beat = 0; private lastBeat = -1; private noteVisible = 0;
  private handSel: 'both' | 'R' | 'L' = 'both';
  private noteMesh!: THREE.InstancedMesh; private barLines: THREE.Mesh[] = [];
  private laneGroup = new THREE.Group(); private backParts: THREE.Object3D[] = [];
  private m4 = new THREE.Matrix4();
  private ray = new THREE.Raycaster();
  private meshes: THREE.Mesh[] = [];
  get keyCount() { return this.keys.size; }

  constructor(private host: HTMLElement, quality: Quality) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.classList.add('kb3d');
    host.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.75;
    pmrem.dispose();
    this.scene.background = new THREE.Color(0x0d0f14);
    this.scene.fog = new THREE.Fog(0x0d0f14, 2.2, 5);

    this.scene.add(new THREE.HemisphereLight(0xdde6ff, 0x1a1410, 0.35));
    this.key.position.set(-0.4, 1.2, 0.9);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 1024);
    const sc = this.key.shadow.camera; sc.left = -0.8; sc.right = 0.8; sc.top = 0.4; sc.bottom = -0.4; sc.near = 0.3; sc.far = 3;
    this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.002;
    this.scene.add(this.key, this.key.target);
    const rim = new THREE.DirectionalLight(0x9db4ff, 0.6); rim.position.set(0.8, 0.5, -1); this.scene.add(rim);

    this.buildKeys();
    this.buildCase();
    this.buildFalling();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.15; this.controls.maxDistance = 3;
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(88);
    this.controls.addEventListener('start', () => { this.userControlled = true; });

    this.setQuality(quality);
    this.resize();
  }

  // ---------- build ----------
  private buildKeys(): void {
    let wi = 0;
    for (let m = 21; m <= 108; m++) if (!isBlack(m)) this.keyX.set(m, (wi++) * WW);
    const total = (wi - 1) * WW;
    for (const [m, x] of this.keyX) this.keyX.set(m, x - total / 2);
    for (let m = 21; m <= 108; m++) if (isBlack(m)) this.keyX.set(m, (this.keyX.get(m - 1)! + this.keyX.get(m + 1)!) / 2 + BOFF[m % 12] * BW);

    const wGeo = new RoundedBoxGeometry(WW - WGAP, WH, WL, 2, 0.0018); wGeo.translate(0, -WH / 2, WL / 2);
    const bGeo = new RoundedBoxGeometry(BW, BH + 0.006, BL, 3, 0.0022); bGeo.translate(0, (BH + 0.006) / 2 - 0.006, BL / 2);
    // slightly taper black key top: scale top vertices inward
    const p = bGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > BH * 0.6) p.setX(i, p.getX(i) * 0.86);
    bGeo.computeVertexNormals();

    for (let m = 21; m <= 108; m++) {
      const black = isBlack(m);
      const color = new THREE.Color(black ? 0x0b0b0c : 0xf3efe6);
      const mat = new THREE.MeshPhysicalMaterial({
        color, roughness: black ? 0.28 : 0.38, metalness: 0,
        clearcoat: black ? 1 : 0.35, clearcoatRoughness: black ? 0.12 : 0.3,
        emissive: new THREE.Color(0x000000), envMapIntensity: black ? 1.1 : 0.9,
      });
      const mesh = new THREE.Mesh(black ? bGeo : wGeo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.m = m; this.meshes.push(mesh);
      const pivot = new THREE.Group();
      pivot.position.set(this.keyX.get(m)!, 0, black ? 0 : 0);
      pivot.add(mesh);
      this.scene.add(pivot);
      this.keys.set(m, { m, black, pivot, mesh, mat, x: this.keyX.get(m)!, press: 0, target: 0, glow: 0, glowTarget: 0, color: color.clone(), flashT: 0, flashColor: new THREE.Color() });
    }
  }

  private buildCase(): void {
    const width = 52 * WW + 0.04;
    const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x060607, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.35, metalness: 0, envMapIntensity: 0.12 });
    const add = (g: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const me = new THREE.Mesh(g, mat); me.position.set(x, y, z); me.castShadow = true; me.receiveShadow = true; this.scene.add(me); return me;
    };
    // key bed under keys
    add(new THREE.BoxGeometry(width, 0.03, WL + 0.03), lacquer, 0, -WH - 0.016, WL / 2 + 0.005);
    // front rail (key slip)
    add(new RoundedBoxGeometry(width, 0.028, 0.018, 2, 0.004), lacquer, 0, -WH - 0.006, WL + 0.012);
    // cheek blocks
    for (const s of [-1, 1]) add(new RoundedBoxGeometry(0.026, 0.06, WL + 0.07, 3, 0.006), lacquer, s * (width / 2 - 0.006), -0.005, WL / 2 - 0.012);
    // red felt strip behind keys
    add(new THREE.BoxGeometry(width - 0.04, 0.004, 0.01), new THREE.MeshStandardMaterial({ color: 0x7a0f17, roughness: 0.95 }), 0, 0.004, -0.004);
    // fallboard / back panel (angled)
    const fb = add(new RoundedBoxGeometry(width, 0.11, 0.02, 3, 0.006), lacquer, 0, 0.045, -0.035);
    fb.rotation.x = -0.32;
    // music desk / body behind (grand case suggestion)
    const body = add(new RoundedBoxGeometry(width + 0.06, 0.06, 0.9, 3, 0.02), lacquer, 0, -0.01, -0.53);
    const desk = add(new RoundedBoxGeometry(0.62, 0.24, 0.012, 2, 0.004), lacquer, 0, 0.17, -0.2);
    desk.rotation.x = -0.28;
    // brand line on fallboard
    const c = document.createElement('canvas'); c.width = 512; c.height = 64;
    const g = c.getContext('2d')!; g.fillStyle = '#d8c48a'; g.font = '600 38px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('C A R O L', 256, 34);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.015), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    logo.position.set(0, 0.035, -0.022); logo.rotation.x = -0.32; this.scene.add(logo);
    this.backParts.push(fb, body, desk, logo);
    // floor
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.75; floor.receiveShadow = true; this.scene.add(floor);
    this.key.target.position.set(0, 0, 0.06);
  }

  // ---------- labels ----------
  private labelMat(text: string, black: boolean): THREE.SpriteMaterial {
    const k = text + (black ? 'b' : 'w');
    let mat = this.labelCache.get(k);
    if (!mat) {
      const c = document.createElement('canvas'); c.width = 128; c.height = 128;
      const g = c.getContext('2d')!;
      g.fillStyle = 'rgba(10,12,18,.82)'; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
      g.font = `800 ${text.length > 3 ? 40 : text.length > 1 ? 52 : 66}px system-ui, -apple-system, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#fff'; g.fillText(text, 64, 68);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
      this.labelCache.set(k, mat);
    }
    return mat;
  }

  // ---------- Renderer API ----------
  update(active: Map<number, KeyState>, labels: LabelMode, focus: Range): void {
    if (focus.lo !== this.focus.lo || focus.hi !== this.focus.hi) { this.focus = { ...focus }; if (!this.userControlled) this.computeCamGoal(); }
    for (const k of this.keys.values()) {
      const s = active.get(k.m);
      if (!s) {
        k.target = 0; k.glowTarget = 0;
        if (k.label) k.label.visible = false;
        continue;
      }
      k.target = s.fresh ? 1 : 0.75;
      k.glowTarget = s.fresh ? 1 : 0.45;
      k.color.set(HAND_HEX[s.hand]);
      const txt = noteName(k.m, labels, false);
      if (txt) {
        if (!k.label) {
          k.label = new THREE.Sprite(this.labelMat(txt, k.black));
          k.label.scale.set(k.black ? 0.0125 : 0.0185, k.black ? 0.0125 : 0.0185, 1); k.label.renderOrder = 10;
          k.label.position.set(0, k.black ? BH + 0.004 : 0.004, k.black ? BL - 0.014 : WL - 0.024);
          k.pivot.add(k.label);
        }
        if (k.labelText !== txt) { k.label.material = this.labelMat(txt, k.black); k.labelText = txt; }
        k.label.visible = true;
      } else if (k.label) k.label.visible = false;
    }
  }

  frame(dt: number, time: number): void {
    if (this.falling && this.beat !== this.lastBeat) this.updateNotes();
    const a = 1 - Math.exp(-dt * 38), r = 1 - Math.exp(-dt * 14);
    for (const k of this.keys.values()) {
      const fl = k.flashT > 0; if (fl) k.flashT -= dt;
      const tgt = fl ? 1 : k.target, gT = fl ? 1 : k.glowTarget, col = fl ? k.flashColor : k.color;
      k.press += (tgt - k.press) * (tgt > k.press ? a : r);
      k.glow += (gT - k.glow) * (gT > k.glow ? a : r);
      k.pivot.rotation.x = k.press * (k.black ? PRESS_B : PRESS_W);
      const base = k.black ? 0x0b0b0c : 0xf3efe6;
      k.mat.color.set(base).lerp(this.tmp.copy(col).multiplyScalar(k.black ? 0.9 : 0.62), Math.min(1, k.glow));
      k.mat.emissive.copy(col).multiplyScalar(k.glow * (k.black ? 0.5 : 0.16));
    }
    if (this.preset === 'cinema' && !this.userControlled) this.computeCamGoal(time);
    if (!this.userControlled) {
      const f = this.snapNext ? 1 : 1 - Math.exp(-dt * 2.5);
      this.camera.position.lerp(this.camGoal.pos, f);
      this.controls.target.lerp(this.camGoal.tgt, f);
      this.snapNext = false;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  pick(cx: number, cy: number): number | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const hit = this.ray.intersectObjects(this.meshes, false)[0];
    return hit ? (hit.object.userData.m as number) : null;
  }
  flash(m: number, hex: string): void { const k = this.keys.get(m); if (k) { k.flashT = 0.32; k.flashColor.set(hex); } }

  // ---------- falling notes ----------
  private buildFalling(): void {
    const g = this.laneGroup; this.scene.add(g);
    const width = 52 * WW, zc = HIT_Z - LANE / 2;
    const flat = (w: number, d: number, color: number, x: number, y: number, z: number) => {
      const me = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color }));
      me.rotation.x = -Math.PI / 2; me.position.set(x, y, z); g.add(me); return me;
    };
    flat(width, LANE, 0x0b0e15, 0, -0.001, zc);
    for (let m = 24; m <= 108; m += 12) flat(0.0012, LANE, 0x232a3a, this.keyX.get(m)! - WW / 2, 0, zc); // octave guides (before each C)
    for (let i = 0; i < 4; i++) { const b = flat(width, 0.0016, 0x343c50, 0, 0.0004, 0); b.visible = false; this.barLines.push(b); }
    const hit = new THREE.Mesh(new THREE.BoxGeometry(width, 0.002, 0.003), new THREE.MeshBasicMaterial({ color: 0x5b8cff }));
    hit.position.set(0, 0.006, HIT_Z + 0.002); g.add(hit);
    this.noteMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), EVENTS.length);
    this.noteMesh.frustumCulled = false;
    this.recolorNotes();
    g.add(this.noteMesh);
  }
  private recolorNotes(): void {
    const c = new THREE.Color();
    EVENTS.forEach((e, i) => {
      c.set(HAND_HEX[e.hand]);
      if (isBlack(e.m)) c.multiplyScalar(0.68);
      if (this.handSel !== 'both' && e.hand !== this.handSel) c.multiplyScalar(0.3); // other hand is auto-played: dim it
      this.noteMesh.setColorAt(i, c);
    });
    if (this.noteMesh.instanceColor) this.noteMesh.instanceColor.needsUpdate = true;
  }
  private updateNotes(): void {
    this.lastBeat = this.beat;
    const S = LANE / LOOK, m4 = this.m4; let vis = 0;
    EVENTS.forEach((e, i) => {
      const s = e.t - this.beat, en = e.t + e.d - this.beat;
      if (en <= 0 || s >= LOOK) m4.makeScale(0, 0, 0);
      else {
        const zF = HIT_Z - Math.max(0, s) * S, zB = HIT_Z - Math.min(LOOK, en) * S;
        const depth = Math.max(0.001, zF - zB - 0.0016);
        const black = isBlack(e.m);
        m4.makeScale(black ? BW * 0.82 : WW * 0.72, 0.005, depth);
        m4.setPosition(this.keyX.get(e.m)!, black ? 0.0045 : 0.003, zF - depth / 2);
        vis++;
      }
      this.noteMesh.setMatrixAt(i, m4);
    });
    this.noteMesh.instanceMatrix.needsUpdate = true;
    this.noteVisible = vis;
    const b0 = Math.ceil(this.beat / 3 - 1e-6) * 3;
    this.barLines.forEach((b, i) => {
      const rel = b0 + 3 * i - this.beat;
      b.visible = rel < LOOK; b.position.z = HIT_Z - rel * S;
    });
  }
  setTime(beat: number): void { this.beat = beat; }
  setFalling(on: boolean, hands: 'both' | 'R' | 'L'): void {
    this.falling = on; this.laneGroup.visible = on;
    this.backParts.forEach(o => { o.visible = !on; });
    if (hands !== this.handSel) { this.handSel = hands; this.recolorNotes(); }
    this.lastBeat = -1; this.noteVisible = 0;
    this.computeCamGoal();
  }
  fallingCount(): number { return this.falling ? this.noteVisible : 0; }

  setPreset(p: CamPreset): void { this.preset = p; this.userControlled = false; this.computeCamGoal(); }
  getPreset(): CamPreset { return this.preset; }
  isUserControlled(): boolean { return this.userControlled; }

  private computeCamGoal(time = 0): void {
    const lo = this.keyX.get(this.focus.lo) ?? -0.6, hi = this.keyX.get(this.focus.hi) ?? 0.6;
    const portrait = this.camera.aspect < 1;
    const cx = (lo + hi) / 2, span = Math.max(portrait ? 0.14 : 0.2, hi - lo + (portrait ? 0.03 : 0.06));
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    let dist = (span / 2) / Math.tan(hfov / 2) * 1.04;
    const tgt = new THREE.Vector3(cx, 0, WL * 0.55);
    let dir: THREE.Vector3;
    if (this.preset === 'learn') dir = portrait ? new THREE.Vector3(0, 0.8, 0.6) : new THREE.Vector3(0, 0.9, 0.44);
    else if (this.preset === 'player') dir = new THREE.Vector3(0, 0.5, 0.87);
    else { const ang = Math.sin(time * 0.12) * 0.55; dir = new THREE.Vector3(Math.sin(ang), 0.42, Math.cos(ang)); }
    dir.normalize();
    if (this.falling) {
      if (this.preset === 'learn') {
        dir.set(0, 0.95, 0.31).normalize();
        tgt.z = (WL - LANE) / 2;
        dist = Math.max(dist, ((WL + LANE) * 1.06) / 2 / Math.tan(vfov / 2));
      } else if (this.preset === 'player') { tgt.z = WL * 0.1; tgt.y = 0.03; dist *= 1.1; }
    }
    this.camGoal.tgt.copy(tgt);
    this.camGoal.pos.copy(tgt).addScaledVector(dir, Math.max(0.25, dist));
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? Math.min(dpr, 1.5) : 1);
    const sh = q === 'high';
    this.renderer.shadowMap.enabled = sh;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.key.castShadow = sh;
    this.scene.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
    this.resize();
  }
  getQuality(): Quality { return this.quality; }

  resize(): void {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.computeCamGoal(); this.snapNext = !this.animating ? true : this.snapNext;
  }

  dispose(): void {
    this.controls.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}

let webglOk: boolean | null = null;
export function webglAvailable(): boolean {
  if (webglOk !== null) return webglOk;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    webglOk = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { webglOk = false; }
  return webglOk;
}
