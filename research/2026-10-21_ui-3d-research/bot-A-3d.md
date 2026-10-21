# 3D UI Research — Carol of the Bells Piano Visualizer (Bot A)

Date: 2026-10-21
Scope: realistic + performant 3D piano / 88-key keyboard for the existing `index.html` learning app (GitHub Pages, iPhone/iPad Safari + Android Chrome + desktop), WebAudio sound already working.

---

## 0. Recommendation summary (TL;DR)

1. **Library: vanilla Three.js** (current release line r186+), imported via importmap from jsDelivr for a no-build site — do **not** add React/react-three-fiber (bundle roughly doubles for no functional gain in a single-file app). Babylon.js is heavier by default and its ecosystem for "product/learning viz" is smaller; PlayCanvas is tuned for games/ads and its code-first story is weak. Three.js has the largest ecosystem (≈2.7M weekly npm downloads vs ≈10K Babylon, ≈8K PlayCanvas) and the smallest fastest-starting bundle. (Sources: [1][2][3][4])
2. **Geometry: hybrid** — a licensed glTF piano *body* (case, legs, lid, fallboard; the CC-BY or CC0 models below) + **procedural keys** (52 white + 36 black, real mm proportions). Per-key animation, per-hand colors, and exact MIDI mapping all demand procedural keys; no free model gives you 88 independently hinged keys at mobile poly budgets. (Sources: [5][6][7][8][9][10])
3. **Keys as two `InstancedMesh`** (52 white, 36 black) → 2 draw calls for the whole keyboard; `setColorAt` for hand colors; per-instance *emissive* via a small shader tweak or a lit-key overlay mesh (plain `instanceColor` only multiplies the base color, not emissive). (Source: [11])
4. **Key press**: rotate around the key's rear pivot; real pianos dip ~10 mm at the front edge. With a 150 mm white key hinged at its rear edge that's ≈4°; with a grand-style pivot behind the key it's ≈2°. Use 3–4° with a fast-attack/slow-release spring for readability. (Source: [12][13][14])
5. **Falling notes**: one `InstancedMesh` of boxes, x-position = key center, z (or y) = time→arrival mapping (classic Synthesia lookahead 1.5–2 s), color per hand. Existing open-source references listed in §4.
6. **Lighting**: `MeshStandardMaterial` PBR + one Poly Haven CC0 indoor HDRI (1–2 K) as environment; **disable dynamic shadow maps on mobile** (bake a contact shadow or skip); **UnrealBloomPass desktop-only / high tier only** — mobile cost is significant (mip-chain blur passes). (Sources: [15][16][17][18])
7. **Camera**: three presets (top-down learning, player POV, cinematic) as saved position+target pairs with tweened OrbitControls; on portrait phones run a **"focus range" camera** that tracks the active octave of the piece (E minor: mostly C3–E5), since 88 keys (~122 cm) can't fit a portrait FOA well. (Source: [19])
8. **Mobile budget**: pixel ratio capped at 1.5 (mobile) / 2 (desktop), draw calls < 100, KTX2 textures, Draco/Meshopt for any glTF, adaptive quality tiers, and **keep the existing 2D SVG as the fallback** when WebGL is unavailable or on a low-end device. (Sources: [20][21][22][23])
9. **Hosting**: for this project's stage, **no-build importmap from jsDelivr** is the lowest-risk upgrade (one `<script type="importmap">` in the existing `index.html`, pinned version); move to **Vite build + GitHub Actions** only if the module graph grows (KTX2/Draco loaders, postprocessing) — Vite's docs cover GitHub Pages deployment with `base` setting. (Sources: [24][25][26])

---

## 1. Library choice

| Engine | License | Minimal scene, gzipped (Sep 2026) | First frame / startup (bench) | Weekly npm DLs | WebGPU |
|---|---|---|---|---|---|
| Three.js r186 | MIT | ~139 KB | 166 KB brotli, ~100 ms to first frame | ~2.7 M | zero-config since r171, main path in r182+ |
| Babylon.js 9.x | Apache-2.0 | ~351 KB | 279 KB, ~330 ms | ~10 K | stable since v7 |
| PlayCanvas 2.x | MIT (engine) | ~517 KB | 202 KB, ~100 ms | ~8 K | engine-level support |

Sources: [1] size table, [7] startup bench, [2] npm-download + ecosystem analysis, [4] WebGPU maturity.

- **Per-draw-call CPU cost** (mvaligursky/web-engines-compare, 2026-10-01, Pixel 8 Pro): PlayCanvas 2.16 µs (Android WebGL2) < Three 2.43 µs < Babylon 5.93 µs — i.e. on mobile raw draw-call throughput PlayCanvas is slightly best, but with **<100 draw calls** our scene never reaches the regime where engine differences dominate. [8]
- **R3F penalty**: measured ~462 KB (vanilla three) vs ~1,035 KB (R3F) for the same feature — a ~2.2× bundle for declarative convenience, plus React runtime — unjustified for a single-file learning app with no existing React. [3]
- Ecosystem is the real tie-breaker: every problem in "3D piano learning UI" (OrbitControls, HDRI env, instanced colors, bloom, camera tweens) has mature three.js answers and the biggest pool of examples. The 2026 deep-dive conclusion: *"When in doubt, Three.js."* [2]

**Verdict: vanilla Three.js.** Babylon (batteries-included game engine) and PlayCanvas (game/ads, editor-driven) are for a different class of project. If we later want R3F's component model, its `drei` helpers (OrbitControls, Environment for HDRI, Instances) are a drop-in on top of the same three.js — the decision is reversible.

## 2. Piano / keyboard geometry

### Real dimensions (use these)

| Quantity | Value | Source |
|---|---|---|
| Keys | 88 total: 52 white, 36 black, A0 (MIDI 21) → C8 (MIDI 108) | [5][9] |
| White key front width | 23.5 mm | [5][6][10] |
| Black key width | 13.7 mm (avg) | [5][6][10] |
| Black key length | ~95 mm (3.75″) | [10] |
| White key length (action) | ~140–150 mm | [13][27] |
| Black key elevation | ~9.5–10 mm above white surface | [9] |
| Octave span (7 whites) | 164–165 mm | [5][6][10] |
| Full keyboard width | ~122 cm (48″) | [6][10] |
| Key dip (front travel) | ~10 mm | [12][13][14] |

**Black-key x placement (the subtle part):** black keys are *not* centered in the white-key gaps — the 12 notes are evenly spaced at the *back* of the keyboard while the 7 naturals are evenly spaced at the front, so C#/D# sit slightly off-center in their gaps. The standard construction: work in octave units; white keys occupy i/7 of the octave at the front; the five sharps sit at the 12-equal-spaced positions (5/12, 7/12, 10/12, 11/12, 13/12 of one octave) with a ~0.586-octave-width black key (≈13.7 mm if octave = 165 mm). The cmuse calculator and an HN analysis document exactly this fudge. [6][10] For a *visual* app an even-simpler approximation (sharps centered on gaps, with the well-known C# shifted ~15% left and A# ~15% right of center) is indistinguishable to a learner — but the 12-equal model above is cheap to implement and exact.

### Free/licensed 3D models (for the *body* only)

| Model | License | Tris / size | Notes |
|---|---|---|---|
| Sketchfab "Grand Piano" — Arch-Mania | CC-BY | 108.5 k tris | https://sketchfab.com/3d-models/grand-piano-7b45cc205916484d9fa34d2175977c06 — good candidate; Sketchfab exports glTF by default [28] |
| Sketchfab "Grand Piano" — richterbelmont26 | CC-BY | 613 k tris, 10.3 k downloads | https://sketchfab.com/3d-models/grand-piano-4ce9e8dbeb74425eb215e4168807dcb5 — too heavy for mobile without decimation |
| Sketchfab "Grand Piano" — Amatsukast (Yamaha C6X based) | **CC-BY-NC-SA** | 26.8 k downloads | https://sketchfab.com/3d-models/grand-piano-159b0bd1ef114b32888d9d39885cac68 — NC/SA: fine for a free personal site, but restricts any future commercial use |
| Sketchfab "Grand Piano" — rhcreations | CC-BY | (smaller, older Blender model) | https://sketchfab.com/3d-models/grand-piano-4b1c5558df8c4775bdf017baf7ad543d |
| Innerscene 3D parts library (CC0, no credit required): upright piano w/ bench (1.8 MB glb), 88-key keyboard block (1.6 MB glb), grand piano closed/open (3.7–3.8 MB glb) | **CC0** | real-world meter scale | https://www.innerscene.com/tools/library/3d-parts/tag/art |
| Poly Haven | CC0 | HDRIs + models, no attribution required | https://polyhaven.com/license [15] |

**Hybrid recommendation (confirmed):** load one CC-BY/CC0 piano body as glTF (Draco/Meshopt-compressed, ≤ ~200 k tris after decimating the 613 k-tri candidates), keep its 88 key meshes **deleted or hidden**, and parent the procedural key `InstancedMesh`es into the body's keybed frame. This gives realism (case shape, legs, lid, fallboard, texture maps) without paying polycount for un-animatable model keys. If the model download budget is a concern on phones, the fully-procedural route (box-based body + keys, ~10 k tris total) is the safe floor.

## 3. Key-press animation, colors, instancing

- **Hinge/rotation:** real action = key pivots at a balance hole in its underside; front edge dips 10 mm. Grand: pivot ~300 mm behind the front edge → ≈ atan(10/300) ≈ 1.9°; upright-ish (pivot at rear of 140 mm key) → ≈ 4.1°. [13][14][27] **Use 3–4° for the visual** (readability beats accuracy at viewing distance), pivot placed at the key's rear top edge, with a fast-attack (≈60 ms) / slower-release (≈250 ms) tween.
- **Instancing:** two `InstancedMesh` (52 white, 36 black) share one geometry+material each → the entire keyboard = 2 draw calls + 1 for the body. Update the pressed key's matrix per frame (`dummy.rotation.x = -angle`, `setMatrixAt`, `instanceMatrix.needsUpdate = true`). [11]
- **Per-hand colors:** `InstancedMesh.setColorAt(i, color)` writes an `instanceColor` buffer — must set `instanceColor.needsUpdate = true` after mutations. [11] Blue = RH, orange = LH as in the current 2D UI. Caveat: `instanceColor` multiplies the **base/diffuse** color only; it does **not** drive `material.emissive`. For per-key *glow* (bloom picks it up), pick one of:
  - a second "lit-keys" `InstancedMesh` whose material has a strong emissive and whose `instanceColor` is modulated (emissive = baseColor × instanceColor in a tiny onBeforeCompile tweak), or
  - per-instance emissive via `@three.ez/instanced-mesh`, which adds per-instance uniforms (`emissive: vec3`) on top of stock `InstancedMesh`, [29] or
  - simply 88 separate `Mesh` objects (88 draw calls — still inside mobile budget, simplest code, and allows true per-key emissive materials). For ≤88 keys, plain meshes are defensible; instancing wins if falling notes + keys + particles all animate every frame.

## 4. Falling notes (Synthesia lanes in 3D)

- **Mapping:** x = key center (same table as §2), depth/y = `(tNoteStart − tNow) / lookahead` × laneDepth. Lookahead 1.5–2 s (noterain makes it configurable). [30] One `InstancedMesh` of boxes (or a thin extruded box per octave-group) sized to key width × 13.7 mm black lane etc.; color per hand; scale/fade the last 20 % of travel for a "hit" feel.
- **Existing open-source examples to crib from** (links verified via GitHub search; star counts as reported):
  - **ekkx/notefall** — React + **three.js** (webgl) falling-notes visualizer, live play, MIDI editing, video export; no install needed; ~28 ★, updated Sep 2026. Closest web/3D match. https://github.com/ekkx/notefall
  - **RasikhAli/Falling-Notes** — React 19 + **R3F + drei + @react-three/postprocessing** + Tone.js; instanced note bars falling onto a reactive 88-key piano, bloom, Web MIDI, file upload; 2 ★ but structurally the most complete. https://github.com/RasikhAli/Falling-Notes
  - **0xsimsch/noterain** (noterain.app) — web Synthesia: falling notes, glow on active notes, grid aligned to keys, VexFlow sheet music, wait mode, loop; GPL-3.0; 14 ★. https://github.com/0xsimsch/noterain
  - **rodydavis/lit-3d-piano** — 3D piano, **Lit + Three.js + Tone.js**; 21 ★; archived May 2026, consolidated into the lit-examples monorepo (demo still live at rodydavis.github.io/lit-3d-piano). https://github.com/rodydavis/lit-3d-piano
  - **PolyMeilex/Neothesia** — 1.6 k ★, GPL-3.0, Rust *desktop* (not web): the de-facto reference for falling-note *behavior* (color coding, hand separation, hit feedback). https://github.com/PolyMeilex/Neothesia
  - **sjcobb/webxr-threejs-midi-visualizer** — 16 ★, Three.js + Tone.js, AR MIDI visualization. https://github.com/sjcobb/webxr-threejs-midi-visualizer
  - **MengLinMaker/Midi-Virtual-Piano** — R3F 3D MIDI piano visualizer with recording, 6 ★, updated Apr 2025. https://github.com/MengLinMaker/Midi-Virtual-Piano
  - Also: GitHub topic `synthesia` (52 repos) and `piano-visualizer`; a community 3D-Synthesia prototype at https://piano3d.pages.dev (Reddit r/synthesia). https://github.com/topics/synthesia
- No dominant "definitive" open web+3D clone exists yet — the above are all small; expect to write the falling-note logic ourselves (it's ~100 lines of time mapping on an `InstancedMesh`) and borrow *behavior* ideas, not code.

## 5. Lighting, materials, post-processing

- **Materials:** `MeshStandardMaterial` (PBR). Ebony case: near-black base, metalness 0.0–0.3, roughness 0.15–0.3 for lacquer + a low-intensity clearcoat look (or `MeshPhysicalMaterial.clearcoat 0.5` on desktop only — physical material is pricier). Ivory/white keys: base #f5f2ea-ish, roughness ~0.35, metalness 0. Black keys: roughness ~0.2.
- **Environment:** one **Poly Haven CC0** HDRI as `scene.environment` via `RGBELoader`/`Environment` — all assets CC0, no credit required, works in any project. [15] Use a 1K–2K indoor HDRI (~1–3 MB .hdr) for mobile, 4K on desktop; this alone (image-based lighting) makes PBR surfaces look "real" without any shadow maps.
- **Shadows:** off by default on mobile. Dynamic shadow maps are a full extra scene pass per shadow-casting light (PointLight = 6 passes!) and shadow-map resolution quadruples GPU memory with mapSize. [18] Plan: **baked contact shadow** (a transparent radial-gradient plane under the piano) on all tiers; one 1024² directional shadow map desktop-only.
- **Bloom (lit keys / falling notes):** `UnrealBloomPass` builds a mip chain of downsampled blurs — multiple full-screen passes per frame, and every extra pass is a framebuffer switch; on iOS, post-processing + high fill-rate is where 60→15 FPS drops happen (Phong-level shaders alone have been measured dropping 60→15 on some iOS devices). [17][18] Rule: bloom **desktop/high tier only**, strength ~0.8–1.2, threshold ~0.85; on mobile fake the glow with a slightly larger additive-blended quad behind lit keys (1 draw call, negligible cost).
- **Tonemapping:** required for correct UnrealBloomPass output; ACESFilmic is the safe default. [31]

## 6. Camera

- **Presets** as saved `{position, target, fov}` triples tweened with damping (`OrbitControls` + `controls.target` lerp, or a 500 ms ease on both): (a) **Top-down learning** (near-orthographic feel: high above, looking straight down — keys + falling lanes legible, best for the lesson), (b) **Player POV** (low, at the fallboard, looking along the keyboard — immersion), (c) **Cinematic** (3/4 front, slightly low, slow auto-orbit for the "wow" intro). OrbitControls: orbit = 1 finger, zoom = pinch, pan = 2 fingers; `enableDamping = true`. [19][32]
- **The portrait problem:** the keyboard is ~1.22 m wide; in portrait an iPhone landscape-FOV sees maybe 2–3 octaves. Options, in preference order:
  1. **"Focus range" mode (recommended):** compute the min/max MIDI notes of the piece (Carol of the Bells: E minor, melody mostly C3–E5, chords within roughly C2–E5) and frame exactly that span with margin — the camera *follows the active passage* by sliding `controls.target` along x each measure. Full 88 keys stay in the scene; you just never show all of them at once on a phone. (noterain does exactly this in 2D with a "fit to song" option. [30])
  2. Rotation-prompt overlay: suggest landscape for the full view (cheap, but users ignore prompts).
  3. Manual pan with a mini-map / octave-ruler scrollbar at the top.
- Constrain `minPolarAngle/maxPolarAngle` so users can't go under the floor, and `minDistance/maxDistance` so they can't clip through keys.

## 7. Mobile performance budget

Consensus numbers across four independent 2025–2026 sources: [20][21][22][23]

| Knob | Mobile target | Desktop |
|---|---|---|
| Draw calls (`renderer.info.render.calls`) | **< 100** (aggressive sources say < 50) | < 500 |
| Pixel ratio | `Math.min(devicePixelRatio, 1.5)` (drop to 1.0 on low-end) | `Math.min(devicePixelRatio, 2)` |
| Textures | ≤ 1024 px, KTX2/Basis (ASTC on iOS, ETC2 on Android) — 4–8× VRAM savings vs PNG/JPG | ≤ 2048 px |
| Geometry (glTF body) | Draco or Meshopt (80–90% size cut; ~50–200 ms decode cost — fine for a one-time load) | same |
| Shadows | off (baked contact shadow) | 1 directional, ≤ 1024² |
| Post-processing | none, or 1 cheap pass | bloom OK, ≤ 2 passes |
| Antialiasing | off + FXAA if needed | MSAA |

- **Adaptive quality:** ship the three-tier profile pattern (high/medium/low: pixelRatio 2/1.5/1, shadows on/off, post on/off, texture 2048/1024/512) [23], picked at init from device heuristics + a short FPS probe (e.g. measure 60 frames; if < 45 fps, step down one tier).
- **WebGL fill-rate warning:** mid-range phones thermally throttle under sustained load — a scene at 60 fps can sag to ~20 fps after 30 s unless pixel ratio/post-processing are cut. [21]
- **Fallback:** keep the current SVG 2D keyboard as the guaranteed-working path — detect `!window.WebGLRenderingContext` or context-loss, or the low tier, and render 2D. This preserves the existing app's universality (the whole reason it works today everywhere).
- WebGPU is now in all four major browsers (Safari 26, Sep 2025) and helps particle-heavy scenes, but **WebGL2 remains the safe baseline** for a public Pages site; three.js r171+ auto-selects WebGPU when available — no extra work needed. [4]

## 8. Hosting

| Path | Pros | Cons |
|---|---|---|
| **No-build importmap** (jsDelivr, pinned version) [24][25] | Zero toolchain change to the existing single `index.html`; GitHub Pages serves as-is; three.js manual endorses it as a first-class option; import maps supported in Safari 16.4+ / all current targets | three.js + addons load over CDN at runtime (~150–200 KB extra fetch); CDN availability dependency; every addon is a separate network request; no tree-shaking |
| **Vite build → dist, GitHub Actions deploy** [26] | One optimized bundle in the repo (works offline-CDN-free, single request, tree-shaken); Vite docs document GitHub Pages exactly (set `base` to the project path, deploy via Actions) | adds a build step + workflow to a currently build-free site; node required to iterate |

**Recommendation:** start with **no-build importmap** (three + `three/addons/` from jsDelivr, pinned to a specific 0.x version — the three.js manual warns never to mix versions/CDNs [24]) because the upgrade is one script tag in `index.html`. Add `OrbitControls`, `RGBELoader`/`GLTFLoader` (+`DRACOLoader`), `EffectComposer`/`UnrealBloomPass` via the same importmap. **Switch to Vite** when: the module count gets unwieldy, we add KTX2 transcoder WASM files that need local hosting paths, or we want the bundle in-repo for reliability. GitHub Pages path note: repo `carol-of-the-bells-piano` → `base: '/carol-of-the-bells-piano/'` for a Vite build. [26]

## 9. Suggested build plan (derived)

1. Scaffold `scene.js` as an ES module imported from `index.html` (importmap); keep 2D UI untouched behind a "3D view" toggle.
2. Procedural keyboard group: exact §2 table, two `InstancedMesh`es, rear-pivot hinge, 3–4° press tween, per-hand `instanceColor`.
3. Piano body: pick the Arch-Mania CC-BY grand (108 k tris) or Innerscene CC0 glb; strip model keys; Draco-compress.
4. Falling notes: `InstancedMesh` boxes + lookahead mapping + per-hand colors, driven by the existing note timeline (Carol of the Bells, E minor, 3/4, 60 measures).
5. Lighting: Poly Haven indoor 1K/2K HDRI, ACES tone mapping, baked contact shadow; bloom desktop-only.
6. Camera presets + focus-range follow; quality tiers + 2D fallback.
7. Ship on Pages via importmap; instrument `renderer.info.render.calls` + fps for the tier probe.

---

## Sources

1. Web Coding Center — Babylon/Three/PlayCanvas licensing & bundle sizes (Sep 2026): https://webcodingcenter.com/babylon-js/babylon-js-and-its-alternatives--licensing-bundle-size-and-long-term-support.html
2. TT Lab — "3D Development for the Web in 2026" deep-dive (npm downloads, engine comparison, WebGPU): https://ttlab.hopto.org/blog/culture/2026-05-14-3d-development-for-web-three-js-react-three-fiber-webgpu-gaussian-splatting-deep-dive-2026?lang=en
3. iDigital Tech Hub — R3F vs vanilla three.js bundle size: https://techhub.iodigital.com/articles/react-three-fiber-3d-for-the-web
4. Natecue — "What Is Three.js?" (WebGPU maturity incl. Safari 26, mobile budgeting): https://www.natecue.com/en/learn/tech/what-is-threejs/
5. Wikipedia — Musical keyboard (octave span 164–165 mm, 13.7 mm / 23.5 mm): https://en.wikipedia.org/wiki/Musical_keyboard
6. piano.org — "100 Did-You-Knows" (88 keys, 23.5 mm front, 9.5 mm black elevation): https://piano.org/blog/100-did-you-knows-about-the-piano/
7. endel/webgpu-webgl-benchmarks (startup/bundle/first-frame): https://github.com/endel/webgpu-webgl-benchmarks
8. mvaligursky/web-engines-compare (per-draw-call CPU, Oct 2026): https://github.com/mvaligursky/web-engines-compare
9. CMUSE piano key border calculator (56.9/27.9 mm front dims, 95.25 mm black length, black-key offset note): https://www.cmuse.org/piano-key-border-calculator/ — *note: this source gives inflated "front" widths (2.24″/1.10″); its ratio column and key counts are the useful part. Standard 23.5/13.7 mm values from [5][6] used instead.*
10. Matt Stillwell — full-size keyboard sizes (122 cm, 164–165 mm octave): https://mattstillwell.net/how-big-is-a-full-size-piano-keyboard/
11. three.js docs — InstancedMesh (`setColorAt`, `instanceColor.needsUpdate`): https://threejs.org/docs/pages/InstancedMesh.html (per-instance-color usage also at https://www.ramijames.com/learn-threejs/building-blocks/instanced-mesh)
12. BYU Design Review — grand piano action ratios (10 mm key dip, 8.5 mm input, pivots): https://www.designreview.byu.edu/collections/meeting-the-pianists-expectations-the-grand-piano-action-ratio
13. World Piano News — key dip ~10 mm, key dip block: https://www.worldpianonews.com/new-product/piano-key-measurements-and-renners-kmd/
14. Jupiter Vintage Pianos — key dip 10 mm / 3-8″: https://www.jupitervintagepianos.com/encyclopedia/key-dip/
15. Poly Haven — license (all assets CC0, no attribution, commercial OK): https://polyhaven.com/license
16. Poly Haven — HDRIs: https://polyhaven.com/hdris?environment=indoor
17. Dodatech Tutorials — Three.js deep dive (bloom cost, mobile, `EffectComposer` halving): https://tutorials.dodatech.com/design/threejs-deep/
18. FireTable project-xiaochun — POSTFX.md (iOS FPS drops, per-pass FBO cost, mobile bloom input scale): https://github.com/FireTable/project-xiaochun/blob/main/docs/POSTFX.md
19. three.js docs — OrbitControls: https://threejs.org/docs/pages/OrbitControls.html
20. Marcela Retana — "Three.js Performance Checklist: 24 Essential Steps" (KTX2 4–6×, DPR cap, Draco, draw calls): https://marceloretana.com/checklist/threejs-performance-checklist
21. F9XR — "Add Three.js 3D Models to Your Landing Page" (mobile budgets, thermal throttling): https://f9xr.org/dev9b/p/setup-threejs-models-landing-page/
22. hontran.dev — "Three.js Performance Optimization: 7 Fixes for Low FPS" (~100–150 draw call budget, KTX2/Draco): https://www.hontran.dev/blog/three-js-performance-optimization
23. emalorenzo/three-agent-skills — mobile-optimization rules (tier profiles, DPR ≤ 1.5 mobile, no shadows, combined passes): https://github.com/emalorenzo/three-agent-skills/blob/main/skills/three-best-practices/rules/mobile-optimization.md
24. three.js manual — Installation (Vite option; CDN importmap option incl. jsDelivr; version-mixing warning): https://threejs.org/manual/pages/installation.html (mirror: https://github.com/mrdoob/three.js/blob/r186/manual/pages/installation.html)
25. three.js forum — why import maps are needed for CDN: https://discourse.threejs.org/t/why-does-three-js-require-a-import-map/40308
26. Vite — static deploy (GitHub Pages: `base`, GitHub Actions source): https://vite.dev/guide/static-deploy
27. Randy Hoexter — keyboard dip measurements (grand: 10 mm front, ~5 mm rear, ~300 mm pivot): https://www.randyhoexter.com/bad-digital-keyboard-actions-why-does-it-hurt-when-i-play/
28. Sketchfab — glTF export / free CC models: https://sketchfab.com/features/gltf (models: https://sketchfab.com/3d-models/grand-piano-7b45cc205916484d9fa34d2175977c06 , https://sketchfab.com/3d-models/grand-piano-4ce9e8dbeb74425eb215e4168807dcb5 , https://sketchfab.com/3d-models/grand-piano-159b0bd1ef114b32888d9d39885cac68 , https://sketchfab.com/3d-models/grand-piano-4b1c5558df8c4775bdf017baf7ad543d , tag page https://sketchfab.com/tags/grand-piano)
29. @three.ez/instanced-mesh — per-instance uniforms (emissive): https://www.npmjs.com/package/@three.ez/instanced-mesh
30. 0xsimsch/noterain — web Synthesia (falling notes, configurable lookahead, fit-to-song): https://github.com/0xsimsch/noterain (live: https://noterain.app)
31. three.js docs — UnrealBloomPass (requires tone mapping): https://threejs.org/docs/pages/UnrealBloomPass.html
32. Fall-back / additional examples: https://github.com/ekkx/notefall · https://github.com/RasikhAli/Falling-Notes · https://github.com/rodydavis/lit-3d-piano · https://github.com/PolyMeilex/Neothesia · https://github.com/sjcobb/webxr-threejs-midi-visualizer · https://github.com/MengLinMaker/Midi-Virtual-Piano · https://github.com/topics/synthesia · https://piano3d.pages.dev · black-key placement fudge: https://news.ycombinator.com/item?id=29941801 · Innerscene CC0 models: https://www.innerscene.com/tools/library/3d-parts/tag/art

Unverified / caveat: the [9] cmuse "front width" table values conflict with the standard 23.5/13.7 mm consensus and appear to measure a different reference plane — flagged inline, not relied upon. Star counts and model polycounts were read from search snippets (GitHub/Sketchfab listing pages) and may be off by a little.
