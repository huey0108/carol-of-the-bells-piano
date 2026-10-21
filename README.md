# Carol of the Bells: wizualizacja na 3D fortepianie

**Otwórz:** https://huey0108.github.io/carol-of-the-bells-piano/

- Klawiatura 3D (Three.js): 88 klawiszy, prawa ręka na niebiesko, lewa na pomarańczowo, 3 widoki kamery
- Górny pasek: odtwarzanie, takt, tempo, wybór ręki, kamera, dźwięk, ⚙ ustawienia
- Zapasowy widok 2D i [stara wersja](https://huey0108.github.io/carol-of-the-bells-piano/legacy-2d.html)

## Dev
```sh
npm install
sh scripts/check.sh   # tsc + build
sh scripts/test.sh    # Playwright smoke testy (desktop + telefon)
npx vite              # serwer deweloperski
```
Każdy push na `main` buduje i publikuje stronę przez GitHub Actions (`.github/workflows/deploy.yml`).

Plan i research: `research/2026-10-21_ui-3d-research/`
