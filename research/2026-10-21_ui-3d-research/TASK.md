# Research bot run: 3D UI + web app for the piano visualizer

- Date: 2026-10-21
- Requested by: user. Goal: better graphics, better UI, turn it into a web app, 3D piano and keyboard, settings in the top bar.
- Orchestrator: Hermes (claude-opus-5-5)
- Workers: delegate_task, model taken from config `delegation.model` (expected `qwen/qwen3.8-flash` on Nous Portal, fallback `lmstudio/qwen3.8-27b-splash`)
- Current app: single-file `index.html` (SVG 88 keys, WebAudio oscillators, 60 measures hardcoded), hosted on GitHub Pages: https://huey0108.github.io/carol-of-the-bells-piano/

## Bot A: 3D rendering
Research how to render a realistic 3D piano and 88-key keyboard in the browser, with keys pressed live and optional falling notes (Synthesia style). Cover the libraries, where to get models, materials and lighting, camera, mobile performance, and GitHub Pages hosting with no build step or with a Vite build.

## Bot B: web app, UI and audio
Research how to turn it into an installable PWA that works offline on iPhone, Android and desktop, with a top settings bar (tempo, hands, loop, labels, camera, sound, theme), realistic piano samples instead of oscillators, iOS audio pitfalls, and MIDI/MusicXML import.

Outputs: `bot-A-3d.md`, `bot-B-webapp.md`, then a synthesis in `PLAN.md`.
