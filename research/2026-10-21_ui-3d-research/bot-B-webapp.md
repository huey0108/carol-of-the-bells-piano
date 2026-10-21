# Bot B — Web App, UI & Audio Research

Date: 2026-10-21 · Project: `carol-of-the-bells-piano` (single-file SVG keyboard + oscillator synth, on GitHub Pages)
Goal: installable PWA, realistic piano sound, polished top settings bar, MIDI/MusicXML import, learning features, CI/deploy.

---

## Recommendation summary (TL;DR)

1. **Audio**: Replace oscillators with **Tone.js v15 + `@tonejs/piano` (Salamander Grand Piano samples)**. `@tonejs/piano` wraps a `Tone.Sampler` with up to **16 velocity layers across 88 keys (sampled every 3rd note)** and gives **`pedalDown()/pedalUp()` for the sustain pedal** for free. Build a **custom `Tone.Sampler`** mapping instead of relying on `@tonejs/piano`'s CDN host: keep only the ~60 notes the piece actually uses, **1 velocity layer per key** (or 3 for quality) → **a few MB, not GB**. Cache them in the PWA's service worker so the *installed* app has sound offline.
   - Full library is 394 MB (16-bit/44.1k WAV) to 1.18 GB (24-bit) — do **not** self-host the whole thing. Select samples from `sfzinstruments/SalamanderGrandPiano` or the `@audio-samples/piano-*` npm/CDN packages (OGG/MP3, CC BY 3.0, ~5 MB per velocity set) and copy only the needed files into the repo.
2. **PWA**: **Vite + `vite-plugin-pwa`** (Workbox under the hood), `manifest` + `injectManifest`/`generateSW` config, `registerSW()` from `virtual:pwa-register`. Set **`base: '/carol-of-the-bells-piano'`** (subpath!) and use `scope`/`start_url` prefixed with it. iOS: no install prompt exists — ship a **Share → "Add to Home Screen" hint** (detect via `navigator.standalone`), manifest `display: standalone`, 192/512 icons + `apple-touch-icon`. Since iOS 26 every home-screen-added site opens as a web app by default.
3. **Stack**: **vanilla TS + Vite** is the right move (keeps the existing single-file app's spirit, ~zero framework cost, easiest PWA + GitHub Pages path, and Bot A's Three.js scene slots in as one module). If you want component ergonomics, **SvelteKit + `@sveltejs/adapter-static`** is the lightest framework option (must set `kit.paths.base` for the subpath). Skip React for this scope. UI: hand-rolled Tailwind (or a vanilla port of shadcn/ui aesthetics) — shadcn/ui itself is React-only, but its design language is just Tailwind + CSS variables, trivially reproducible; lightweight vanilla options: **Basecoat** (shadcn/ui port to plain HTML/Tailwind, MIT), **Flowbite**, **Preline**, or **Headless UI**.
4. **Learning features**: Web MIDI is **not available in Safari / iOS Safari at all** (WebKit declined it; a third-party macOS Safari extension exists but nothing for iOS) — so for the Polish learner on iPhone, **mic pitch detection (YIN autocorrelation on `AnalyserNode` time-domain data, all client-side) is the only viable "wait mode" input**; Web MIDI stays a desktop-Chrome/Edge bonus. Wait mode = pause transport until detected note matches expected (Flowkey's signature feature; Simply Piano and Flowkey both do this via mic or MIDI, plus section loop + tempo slow-down + hand isolation — implement all four).
5. **Score data**: keep the piece as **MusicXML** (importable from MuseScore; `Carol of the Bells` arrangements exist freely), parse with **`@tonejs/midi`** (MIDI) or a **DOMParser on MusicXML** (notation semantics), and render synced notation with **OpenSheetMusicDisplay** (VexFlow-based, ~2k stars, SVG output, cursor options for a following playhead). OMR from PDF (**Audiveris**, free/open-source Java) is feasible for clean printed scores (~80–90% accuracy) but a detour — since the score is already digitized in JS arrays, skip OMR; just re-encode the 60 measures into MusicXML once (MuseScore export) and use that as the single source of truth.
6. **CI/deploy**: GitHub Actions workflow: `checkout → setup-node (lts) → npm ci → playwright install chromium → npm run build → test-serve → actions/upload-pages-artifact → actions/deploy-pages`, with repo **Settings → Pages source = GitHub Actions**, `base` env = `/` for a project page named after the repo, `permissions: pages: write, id-token: write`, concurrency group `pages`. Add `static/.nojekyll`. Playwright smoke test: page loads, manifest fetches, SW registers, keyboard renders 88 keys, play button starts transport.

---

## 1. Realistic piano sound

### Options compared

| Option | What it is | Size | License | Verdict |
|---|---|---|---|---|
| **Tone.js `Sampler`** + selected Salamander samples | You map note→URL yourself; Tone repitches nearest sample, handles velocity/attack/release | **Only what you include** — e.g. 60 notes × 1 layer MP3 ≈ 3–6 MB | Samples: CC BY 3.0 (Salamander, Alexander Holm) or Public Domain (Splendid Grand); Tone.js: MIT | ✅ **Primary recommendation** — full control over what's cached for PWA |
| **`@tonejs/piano`** (gameleaf) | Multi-sampled Yamaha C5: up to 16 velocity layers, 88 keys sampled every 3rd note; `pedalDown()/pedalUp()` API; `load({release})` promise | Loads from CDN by default (tonejs.github.io); full set is large — instantiate with `{velocities: 5}` or fewer to cap size | MIT (code), CC BY 3.0 (Salamander) | ✅ Easiest drop-in if you're OK with its sample host or re-mapping URLs to your repo |
| **`smplr`** (danigb) | Modern Web Audio sampler library: `Soundfont` (GM, loads Benjamin Gleitzman's pre-rendered soundfonts online), `SplendidGrandPiano` (Steinway, 4 velocity groups, **Public Domain**), mallets, drums; effects, sequencing, offline WAV render | Online samples by default (smpldsnds GitHub Pages); Splendid set ≈ tens of MB | MIT-ish (code), Public Domain (Splendid) / CC BY (Salamander) | ✅ Good alternative; ⚠️ "still under development, features unstable until v1.0" (per README); samples hosted off-repo hurts offline PWA unless you copy them |
| **`soundfont-player`** (danigb) | Quick SF2 loader/player for WebAudio; small (3.6 kB min) | SF2-dependent | — | ❌ **Archived** — author points to smplr |
| **Salamander Grand Piano source** | Yamaha C5, 16 velocity layers, 48k/24-bit, minor-thirds sampling, hammer/string release samples | **394 MB** (16-bit/44.1k) / **1.18 GB** (24-bit/48k) full | **CC BY 3.0** (author Alexander Holm; attribution required) | Source to cherry-pick from; full set too big for GitHub Pages |
| **Splendid Grand Piano** | Steinway, 4 velocity layers | 77 MB (full, sfz repo); per-note MP3/OGG copies in smpldsnds | **Public Domain** (AKAI) | Great fallback: zero attribution, 4 velocities is plenty for accompaniment |
| **GeneralUser GS / other GM soundfonts** | Full 128-instrument soundfonts | 10–100+ MB | varies | Overkill — one instrument only |

**License notes (Salamander)**: CC BY 3.0 — commercial use allowed, no royalty, requires attribution to Alexander Holm + link to source (archive.org/details/SalamanderGrandPianoV3). Put a `LICENSE`/credits note in the repo and in-app (an "About" sheet). The `@audio-samples/piano-mp3-*` npm packages document this exactly (per-velocity MP3 sets, ~5.3 MB each, CC BY 3.0, source archive.org) — they even include **pedal/sustain and hammer-noise** packages, which a hand-rolled Sampler won't have unless you add them.

### Practical audio architecture

- One `Tone.Sampler` for right hand, one for left (or one shared sampler + two `Gain`s) → keeps the existing blue/orange hand routing and per-hand volume.
- **Lazy loading**: load only the keys the piece uses. Carol of the Bells sits roughly in C2–E5; sample the ~40–60 keys in range. `Salamander` samples are "sampled in minor thirds from the lowest A" and Tone repitches to the nearest sample, so you can even load fewer (chromatic thirds) and repitch — but for a *learning* app exact-per-note is worth the extra 1–2 MB.
- **Velocity**: 1 layer is enough for a teaching tool (you're teaching rhythm/fingering); 3 layers (soft/med/fort) if the performance should respond to touch on a MIDI keyboard.
- **Sustain pedal**: with a custom `Sampler`, implement it by delaying `triggerRelease` while pedal state is on (or just use `@tonejs/piano`, which has `pedalDown()/pedalUp()` built in).
- **iOS unlock**: keep the existing silent-`<audio>` loop trick AND add `navigator.audioSession` (see §1b) — belt and suspenders.

### 1b. iOS Safari audio quirks (2025–2026 state)

Verified current behavior (sources: nattog.dev blog Nov 2025, MDN, samueleddy.com, feross/unmute-ios-audio):

1. **AudioContext must be created/resumed inside a real user gesture** — and iOS **suspends the context between gestures** (leave page / tab switch / screen off → state `interrupted` per MDN). Fix pattern: on the first tap (e.g. a "Start" overlay), `new AudioContext(); ctx.resume()`, store the single instance, and **before every play path check `ctx.state === 'suspended'` → `await ctx.resume()`**.
2. **Mute (ring/silent) switch**: Web Audio output is treated like ring/alert audio and is silenced when the hardware switch is on, while HTML `<audio>` is not. Two complementary fixes:
   - **`navigator.audioSession.type = 'playback'`** — the W3C Audio Session API, implemented **only in Safari, shipped iOS 17+** (Editor's Draft, still changing — guard with `if ('audioSession' in navigator)`). Setting `playback` tells WebKit not to route Web Audio through the ringer.
   - **Silent looping `<audio>` element** (`muted:false, loop, volume:0.0001`) started in the gesture — the classic `unmute-ios-audio` trick (feross). Keep it; it's the fallback for iOS < 17.
3. **`navigator.audioSession.statechange` events** let you pause your transport when the OS interrupts (phone call, AirPlay) and resume on release — wire the transport's pause/resume to this instead of guessing.
4. `play-and-record` (needed when the **mic** is used for wait mode) flips the session category; on iOS 17+ you can set it explicitly via `audioSession.type`, otherwise WebKit infers it from `getUserMedia`. Note: when mic is live, speaker output can be de-prioritized — for wait mode, consider ducking the accompaniment when the user is playing rather than fighting the OS routing.

---

## 2. PWA on GitHub Pages

### Manifest (what installers require)

Per MDN "Making PWAs installable": Chromium (Chrome, Edge, Samsung Internet) requires manifest members `name`/`short_name`, **`icons` with 192px and 512px**, `start_url`, `display`/`display_override`, and `prefer_related_applications: false` (or absent). HTTPS is required (Pages provides it). Note (HTTP Archive 2025): **service workers are no longer required for the Chromium install prompt** — manifest is enough — but you *want* the SW for offline samples, so keep it. `display: "standalone"` is the overwhelmingly common choice (78% of mobile PWA manifests per The Web Almanac 2025).

**Subpath gotcha**: your site lives at `https://huey0108.github.io/carol-of-the-bells-piano/`, so:

```jsonc
{
  "name": "Carol of the Bells — Piano Trainer",
  "short_name": "Carol Trainer",
  "start_url": "/carol-of-the-bells-piano/",
  "scope": "/carol-of-the-bells-piano/",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#0f1115",
  "theme_color": "#0f1115",
  "icons": [
    { "src": "/carol-of-the-bells-piano/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/carol-of-the-bells-piano/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/carol-of-the-bells-piano/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Plus in `<head>`: `<meta name="apple-touch-icon" href="…/icons/icon-180.png">` (180×180), `<meta name="apple-mobile-web-app-capable" content="yes">` (legacy, still respected by older iOS to force standalone), and `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">` if you paint under the notch. In `vite.config`, **`base: '/carol-of-the-bells-piano/'`** (or env `BASE_PATH=/${{ github.event.repository.name }}` in CI so it works for renames). vite-plugin-pwa picks up `base` for the SW registration scope automatically in most setups — verify after first build that `sw.js` sits under the subpath (scope must include the page URL, or registration silently fails).

### Service worker / offline

- **vite-plugin-pwa** (vite-pwa org, active in 2025–2026; requires Node 20.19+ for v2, Vite 5+): generates the SW via **Workbox**, injects the manifest, and handles update prompts via `import { registerSW } from 'virtual:pwa-register'` (`onNeedRefresh` / `onOfflineReady` callbacks — use them to show the "A new version is available — reload" and "Ready for offline" toasts).
- **Caching strategy**: app shell (JS/CSS/HTML) = precache, revisioned by Vite (Workbox `revision` from content hash) → cache-first. Audio samples = **runtime cache** (`CacheFirst`, `expiration` with e.g. 500 entries / 2 GB quota, `cleanupOutdatedCaches`) so a later song addition doesn't bloat the install. MP3/OGG in Cache Storage on iOS works once the app is installed.
- **iOS specifics**:
  - **No `beforeinstallprompt`, no install API of any kind** (MDN lists none for Safari; confirmed by OpenPWA's 2025/26 reference). The only route is **Share → "Add to Home Screen"** — teach it with an in-app illustrated hint (chevron pointing at the share button), shown only when `!navigator.standalone`.
  - Since **iOS 26**: every added-to-home-screen site opens as a web app by default (user can toggle "Open as Web App" off); 16.4–18: it opened standalone only when the manifest said `standalone`/`fullscreen` or the legacy meta tag was set → include both to cover the installed base.
  - **Storage**: 7-day inactivity cap applies to Safari *tabs*, not to the installed home-screen app (which has its own, resetting-on-open counter) → installed app keeps your caches; a plain tab link may lose cached samples after a week idle.
  - Web Push + Badging work only in the installed app (16.4+); not needed for this app but the manifest+SW prerequisites are the same.
- **Android**: `beforeinstallprompt` works in Chrome → you can show a real "Install app" button for Android while using the share-sheet hint on iOS.

### GitHub Pages + PWA checklist

HTTPS ✅ (automatic). SW + manifest under the subpath ✅ (§2 config). One caveat: GitHub Pages serves from `*.github.io` — no special config beyond base/scope. (No `Service-Worker-Allowed` header needed since SW is in-scope.)

---

## 3. Stack & UI

### Framework

| Option | Fit for this project |
|---|---|
| **Vanilla TS + Vite** | ✅ **Recommended.** App is one screen with a state machine (transport, settings, canvas). ~250 lines of settings UI, no routing, no SSR. Smallest bundle, trivially PWA-able, Bot A's Three.js drops in as a module, keeps migration of existing index.html logic cheap. |
| **Svelte / SvelteKit + `adapter-static`** | ✅ If you want reactivity ergonomies: `@sveltejs/adapter-static` + `paths.base = '/carol-of-the-bells-piano'` + `fallback: '404.html'` (official SvelteKit doc for Pages). Svelte's `svelte-transition`/`svelte/easing` help with the settings drawer. Slightly more setup (config, build env `BASE_PATH`). |
| **React + Vite** | ⚠️ Works fine, but you're adding the heaviest runtime for the least gain on a single-view app. shadcn/ui is React-native, which is the only reason to pick it. |

**UI kit**: shadcn/ui is a **React/Vue** component set (Tailwind + Radix). Without React:
- **Basecoat** (basecoatui.com, MIT) — shadcn/ui components in plain HTML+Tailwind, sliver of Alpine; drop-in `<button class="btn">` classes, fully theme-compatible with shadcn's design tokens.
- **Flowbite** / **Preline** — Tailwind component kits with vanilla JS.
- **Headless UI** (Tailwind, behavior-only, unstyled) + your own styling.
- Or just **Tailwind + CSS custom properties** (design tokens: `--accent`, `--surface`, dark/light theme via `prefers-color-scheme` + manual toggle) — honestly enough for a top bar + bottom sheet, and it's what shadcn/ui is *made of* under the hood, so you can copy its look (slate/zinc palettes, subtle borders, 8px radii) verbatim.

### What belongs in the top bar vs. a drawer

Design reference points (2025–26): **Flowkey** — compact persistent transport (play, **wait mode** toggle, hand selector, loop, tempo) + sheet video; **Simply Piano** — big play + wait/slow-modes, mic/MIDI input; **Synthesia** — tempo slider, section loop, falling-notes toggle, volume. Common denominator: *transport is always visible; everything else is one tap away*.

**Always visible (top bar, ~48–56 px, safe-area aware):**
- Play / pause (primary, large), **Wait mode** toggle (the app's signature feature — keep it visible)
- Hand selector: segmented **L / R / Both** (blue/orange = existing colors)
- Tempo: `♩ = 60` with a ± stepper (long-press or slider in drawer); 3/4 fixed
- Measure position `12 / 60` + jump
- ⚙︎ gear → **bottom sheet** (all the rest)

**Bottom sheet / drawer (one tap from gear):**
- Tempo **slider** (40–120) + "slow down" presets (50%, 75%, 100%)
- **Loop A–B**: tap to set loop start/end at current measure (Flowkey pattern: two-tap, shows a shaded region in the measure ruler)
- **Volume** (master + per-hand sliders), **metronome** toggle + accent strength, **sustain pedal** auto (on/off for the accompaniment)
- **Note labels**: `C D E…` vs `Do Re Mi…`, and **Polish `H` vs German `B`** for B-flat (default: Polish learner → `C, H, B` scheme, i.e. B = B-natural, H = B-flat; offer "Do-Re" solfège as an alternate label set)
- **Sound quality**: `Fast (1 layer) / Full (3 layers)` sample set (ties into §1 lazy loading; "Full" caches more)
- **Camera preset** (for Bot A's 3D): front / top-down / tilted / user-saved; "show falling notes" toggle (Synthesia mode)
- **Theme**: Light / Dark / Auto
- **Input source**: Mic (wait mode) / On-screen / MIDI (greyed on iOS with a tooltip explaining Web MIDI isn't in Safari)
- Install hint ("Add to Home Screen" card, iOS-only), About/attribution (Salamander CC BY 3.0 credit)
- Reset settings

### Proposed top-bar layout (ASCII mockup, mobile portrait)

```
┌──────────────────────────────────────────────────────────────┐
│ ♫ Carol of the Bells      12/60 ▾  ♩=60 −/+   [L|B|H]  [⏸]  [⚙] │  ← top bar, 56px
│                      (measure jump)  (hands L/R/both) (play)  (sheet)
├──────────────────────────────────────────────────────────────┤
│  ┌───┐┌───┐┌───┐        ▸ WAIT MODE: ON — play next note     │  ← status strip (wait
│  │ C ││ D#││ E │   ◄──  12 ▾ … 18 ▾  LOOP 12–18             │     prompt + loop region,
│  └───┘└───┘└───┘                                           │     collapses when idle)
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                    [ 3D keyboard / falling notes ]            │
│                                                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
   (bottom sheet slides up from ⚙, covers ~70%, drag-to-dismiss)
```

Landscape/iPad: top bar stays on top, status strip moves to the right edge or a thin left rail; loop region renders as a bracket over the score if notation is visible.

---

## 4. Learning features

### Input sources

| Source | iPhone/iPad | Android | Desktop | Notes |
|---|---|---|---|---|
| **Web MIDI API** | ❌ **not supported** (Safari/iOS, all versions incl. 27 — caniuse; WebKit explicitly won't ship it; iOS browsers are all WebKit) | ✅ Chrome (43+) — Bluetooth/USB keyboards work | ✅ Chrome 43+, Edge 79+, Firefox 108+ (Firefox desktop only, not Fennec/Android); macOS Safari only via third-party "Web MIDI for Safari" extension (Safari 18.4+, desktop) | Requires HTTPS + user gesture; use `navigator.requestMIDIAccess()` guarded by `'requestMIDIAccess' in navigator`. Ship it for Mac/Android users; hide it elsewhere. |
| **Mic pitch detection** | ✅ `getUserMedia` + Web Audio in all modern iOS Safari (needs one user-gesture tap; mic permission prompt) | ✅ | ✅ | Only cross-device option. |
| On-screen keys | ✅ | ✅ | ✅ | Already exists. |

**Mic pipeline (vanilla, all client-side)**: `getUserMedia({audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}})` → `AnalyserNode` (fftSize 2048, get time-domain) → **YIN** (de Cheveigné & Kawahara 2002) autocorrelation in an **AudioWorklet** (keep the render thread clean) → Hz → nearest MIDI note + cents → gate on RMS + cents window (±50¢) + octave disambiguation via expected-note context (you *know* which note comes next — use it to pick the octave and reject the piano's own audible output by ducking accompaniment during wait mode, à la Flowkey). Reference implementations: PitchTester-style YIN is a single dependency-free file (dev.to writeups, 2025); Google **SPICE** via TensorFlow.js is heavier (16 kHz streaming) and better for polyphony — overkill for a single next-note wait gate, but worth a spike if wait mode should accept the *whole next chord*. Simply Piano's "MusicSense" (their proprietary acoustic engine) is the benchmark to emulate in feel, not in code.

### Wait mode, loop, slow-down, isolation (the four pillars, all cheap once the score is data)

- **Wait mode**: transport scheduler pauses *before* the next note event of the selected hand; resumes (with a small metronome cue) when the detected/played note matches. Flowkey's most-praised feature; works identically for MIDI and mic input — abstract input behind `onNote(name, velocity)`.
- **Practice loop**: A–B at measure granularity (data-driven since measures are first-class); render the region in the measure ruler + dim non-looped keys.
- **Slow-down**: pure tempo scaling (`Tone.Transport` tempo or your scheduler BPM 40–120) — samples don't need time-stretching.
- **Hand isolation**: L/R/Both selector gates both audio and lighting (already the existing color model); add "play hand alone at 50%" quick presets.
- Nice-to-have: per-measure "difficulty heat" from the learner's own wait-mode stalls (how long each note took) — Flowkey-style practice insights, trivially derived from the wait timestamps.

---

## 5. Score data format

**Target state**: one `carol.musicxml` (MuseScore-exportable) as the single source of truth → build-time or fetch-time parse → a `NoteEvent[]` (`{time, duration, note, velocity, hand}`) consumed by scheduler, lighting, OSMD cursor, and loop/measure math. This replaces the hardcoded JS arrays with no feature loss (60 measures × 3/4 is small).

- **MIDI import**: **`@tonejs/midi`** — `Midi.fromUrl()` / `new Midi(arrayBuffer)`; tracks expose `notes` (`note.midi`, `.time`, `.duration`, `.name`, `.velocity`) and `controlChanges.sustain` (CC64) — the sustain pedal events in a MIDI file map straight onto `pedalDown/Up`. Good for "bring your own .mid".
- **MusicXML**: parse with `DOMParser` (no dependency needed) — carries ties/beams/voice/hand (2 `<part>`s for L/R) that MIDI loses. A proven pattern (dev.to 2025): both parsers normalize to the same `NoteEvent[]`.
- **Display**: **OpenSheetMusicDisplay** (OSMD, opensheetmusicdisplay.org, ~2k GitHub stars, VexFlow backend, TypeScript, MIT-ish) renders MusicXML to SVG in-page with `autoResize`, a **follow cursor** (`cursorsOptions: [{color, alpha, follow:true}]`) you advance with the transport — i.e. synced sheet music + keyboard for free. Renderer, not editor (don't try to edit notes in it). `react-opensheetmusicdisplay` exists if you ever pick React.
- **OMR (PDF → MusicXML)**: **Audiveris** — free, open-source (Java), runs Win/macOS/Linux, exports MusicXML 4.0, good for *clean printed* scores (~85% on a clean piano page; ~65% dense scores; <50% handwriting per their own accuracy write-ups), with a built-in OMR editor for fixing the rest; then MuseScore for cleanup/export. **Feasibility verdict: not worth it for this project** — the score already exists as data; OMR is a multi-hour detour with error-fixing overhead. Only do it if you later want to onboard *new* PDF scores.

---

## 6. Testing & deploy

### GitHub Actions → Pages (Vite)

Official pattern from Vite's static-deploy guide (2025): repo **Settings → Pages → Source: "GitHub Actions"**, then:

```yaml
# .github/workflows/deploy.yml
name: Deploy to GitHub Pages
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: false }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: lts, cache: npm }
      - run: npm ci
      - name: Build
        run: npm run build
        env: { BASE_PATH: /${{ github.event.repository.name }} }   # feeds vite base + vite-plugin-pwa
      - name: Test (smoke)
        run: npx playwright test
      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: ${{ steps.d.outputs.page_url }} }
    steps:
      - id: d
        uses: actions/deploy-pages@v4
```

Pitfalls: set `base` from env (repo rename safety); `.nojekyll` in `public/` (Pages skips Jekyll processing — matters for `sw.js` and dotfiles); the SW file must be emitted to `dist/` at the scope path; vite-plugin-pwa v2 needs **Node ≥ 20.19** (fine on `lts`). (SvelteKit variant is the same workflow with `BASE_PATH` → `kit.paths.base`, `path: build`, per SvelteKit adapter-static docs.)

### Playwright smoke test (headless, CI-friendly)

- `webServer: vite preview` (or `vite dev`); chromium only.
- Assert: page renders (88 keys in DOM/canvas), `manifest.webmanifest` fetches and parses with `start_url`/scope prefixed by BASE_PATH, **service worker registers** (`navigator.serviceWorker.ready` — works in headless Chromium), manifest link in head, play button toggles transport state, one measure jump works. Web Audio assertions are flaky in headless (no device) — assert `AudioContext.state` transitions and your own transport clock instead of sound.
- The same spec minus the SW asserts is reusable against the live Pages URL as a nightly e2e (a second workflow `schedule: cron`).

---

## Sources

- Tone.js / @tonejs/piano: https://www.npmjs.com/package/@tonejs/piano · https://github.com/gameleaf/tone-js-piano · https://github.com/ezpn/tonejs-piano · https://www.npmjs.com/package/tone · https://tonejs.github.io/examples/sampler
- Salamander Grand Piano: https://sfzinstruments.github.io/pianos/salamander/ (16 vel, 394 MB/1.18 GB, CC BY 3.0) · https://github.com/sfzinstruments/SalamanderGrandPiano · https://archive.org/details/SalamanderGrandPianoV3 · https://piano.org/credits/ (real-world CC BY usage) · https://deepwiki.com/sfzinstruments/SalamanderGrandPiano/6-license-and-credits
- Smaller/sample packaging: https://github.com/darosh/samples-piano · https://github.com/darosh/samples-piano-mp3 · https://www.npmjs.com/package/@audio-samples/piano-mp3-velocity7 (≈5.3 MB) · https://github.com/tonnetz/tonnetz/blob/master/assets/soundfonts/SalamanderGrandPiano-LICENSE.txt
- smplr / soundfont-player: https://github.com/danigb/smplr · https://github.com/danigb/soundfont-player (archived) · https://github.com/danigb/samples · https://github.com/smpldsnds
- Splendid Grand (Public Domain Steinway): https://sfzinstruments.github.io/pianos/splendid_grand_piano/ · https://github.com/sfzinstruments/SplendidGrandPiano
- iOS audio: https://nattog.dev/blog/web-audio-ios-unmute (AudioSession `playback`, Nov 2025) · https://samueleddy.com/writing/ios-safari-audio-sessions/ (suspend-between-gestures, iOS 17 AudioSession API) · https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state (`interrupted` on iOS) · https://github.com/feross/unmute-ios-audio (silent-audio trick) · https://developer.apple.com/documentation/avfaudio/avaudiosession.md · https://stackoverflow.com/questions/79375421 (silent-switch behavior)
- PWA: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable · https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/display · https://almanac.httparchive.org/en/2025/pwa (2025: manifest-only install prompt) · https://openpwa.net/reference/installation/ios-add-to-home-screen/ · https://openpwa.net/reference/platforms/ios-safari/ (iOS 26 "open as web app" default, 16.4 push/badging) · https://derkonline.com/blog/pwa-that-feels-native-on-ios (7-day storage cap nuance) · https://www.mobiloud.com/blog/progressive-web-apps-ios · https://brainhub.eu/library/pwa-on-ios · https://w3c.github.io/manifest/explainer.md
- vite-plugin-pwa: https://github.com/vite-pwa/vite-plugin-pwa · https://github.com/vite-pwa/vite-plugin-pwa/blob/main/docs/guide/inject-manifest.md · https://github.com/vite-pwa/vite-plugin-pwa/blob/main/docs/examples/index.md · https://app.unpkg.com/vite-plugin-pwa@0.9.1/files/README.md (registerSW / virtual:pwa-register)
- Vite deploy + CI: https://vite.dev/guide/static-deploy (Pages + workflow sample) · https://vitejs/vite/blob/main/.github/workflows/ci.yml (Playwright-in-CI pattern) · https://playwright.dev/docs/ci-intro · https://github.com/sagargupta16/deploy-guide/blob/main/frameworks/sveltekit.md (BASE_PATH/404/.nojekyll)
- SvelteKit on Pages: https://github.com/sveltejs/kit/blob/8826b0d6f6616ebe3c7b3a3db227e20c7858f456/documentation/docs/25-build-and-deploy/50-adapter-static.md
- UI: https://dev.to/shaahzaibrehman/top-10-react-nextjs-ui-libraries-to-use-in-2025-11j6 · https://stackshare.io/shadcn-ui/alternatives · https://news.ycombinator.com/item?id=43971688 (Basecoat) · https://github.com/htnanako/awesome-shadcn-ui-browser
- Web MIDI support: https://caniuse.com/midi (Safari + iOS: not supported, incl. 27) · https://github.com/web-platform-dx/developer-signals/issues/50 (Jul 2025: Safari not supported) · https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API · https://webmidijs.org/docs/getting-started/ · https://github.com/triglav-modular/Safari-WebMIDI (macOS-only extension, Safari 18.4+) · https://frontend-practical.dev/en/api/web-midi/
- Learning-app patterns: https://pianomode.com/explore/piano-accessories-setup/piano-apps-tools/best-piano-apps-for-learning-and-practicing/ · https://onlinecourseing.com/flowkey-vs-simply-piano/ · https://www.flowkey.com/en/discover (Wait Mode) · https://play.google.com/store/apps/details?id=com.flowkey.app (loop / hand select / wait mode / mic+MIDI) · https://americansongwriter.com/best-piano-learning-apps/ · https://www.guitarchalk.com/flowkey-vs-simply-piano/ · https://hackernoon.com/best-piano-learning-apps-in-2026 (2026 comparison) · https://www.reddit.com/r/simplypiano/comments/1q801zw/ (wait-mode feature wishlist)
- Mic pitch detection: https://dev.to/xiaolu/real-time-pitch-detection-in-the-browser-with-yin-and-the-web-audio-api-4o6b · https://dev.to/caron_446492a5d9c5adebd5f/real-time-pitch-detection-in-the-browser-how-it-works-and-a-free-tool-to-try-it-3bph · https://deepwiki.com/sonovice/pitch-detector (SPICE/TensorFlow.js option)
- Score data: https://www.npmjs.com/package/@tonejs/midi · https://github.com/opensheetmusicdisplay/opensheetmusicdisplay · https://opensheetmusicdisplay.org/ · https://opensheetmusicdisplay.github.io/classdoc/classes/OpenSheetMusicDisplay.html (cursors) · https://dev.to/linmingren/a-midi-player-that-shows-you-the-sheet-music-and-lets-you-play-along-on-a-virtual-piano-492m (MIDI+MusicXML→OSMD+keyboard pattern)
- OMR: https://audiveris.com/ · https://audiveris.com/how-accurate-is-audiveris-music-recognition/ (80–90% clean prints / <50% handwritten) · https://github.com/Joacop16/Audiveris_PDF_to_MXL (PDF→MXL→MuseScore) · https://freedom251.com/8-best-pdf-to-midi-converters-in-2025/

### Unverified / to confirm during build
- Exact live size of the Tone.js-hosted Salamander MP3 set (the `tonejs.github.io/audio/salamander/` root listing 404'd; individual `*.mp3` URLs are used in Tone's examples — confirm the per-file set before deciding CDN-vs-self-host).
- `@tonejs/piano` maintenance status (community fork; last npm metadata didn't show a recent publish date) — treat as "use, but pin the version and keep the URL map overridable so you can swap hosts".
- vite-plugin-pwa v2 + Vite 7 exact behavior for `scope`/`start_url` under `base` (the plugin usually derives them, but verify in the built `sw.js` + manifest).
- OSMD license file details (README says open source; check LICENSE for the exact terms before shipping).
