# Plan: Carol of the Bells, wersja 3D jako web-apka

Na podstawie: `bot-A-3d.md`, `bot-B-webapp.md` (boty działały na **lmstudio/qwen3.8-27b-splash**, czyli fallbacku, a nie na qwen3.8-flash). Linki sprawdzone w `link-check.txt`.

## Weryfikacja ustaleń botów (21.10.2026)
- 123 linki, z czego 107 odpowiada 2xx/3xx. Z pozostałych 16 większość to blokady botów (npm, reddit, SO, deepwiki: 403/429). Naprawdę martwe są 4: `tonnetz/...LICENSE.txt` (404), `w3c manifest explainer.md` (404), `noterain.app` (brak DNS) i `vitejs/vite/...ci.yml` (zepsuty URL).
- Wersje z npm registry: three 0.186.1 (MIT), tone 15.1.22 (MIT), @tonejs/midi 2.0.28, @tonejs/piano 0.2.1, **smplr 1.1.0** (bot B pisał „pre-1.0”, co jest **nieaktualne**), vite-plugin-pwa 2.0.0, opensheetmusicdisplay 2.2.1 (BSD-3).
- Sample Salamander na `tonejs.github.io/audio/salamander/` odpowiadają (200).

## Decyzje
| Obszar | Wybór | Dlaczego |
|---|---|---|
| 3D | **Vanilla Three.js** | lekki, największy ekosystem; R3F/Babylon to dla tej skali przerost |
| Klawiatura | **proceduralne 88 klawiszy** (2× InstancedMesh, realne wymiary 23,5/13,7 mm), obrót 3–4° na tylnym zawiasie | precyzyjny układ i tani render |
| Korpus fortepianu | opcjonalny glTF CC0/CC-BY (Draco), ładowany jako drugi | ładne, ale niekrytyczne |
| Spadające nuty | InstancedMesh, oś czasu → oś z, 2 s do przodu | tryb Synthesii |
| Światło | PBR + HDRI z Poly Haven (CC0); cienie i bloom tylko na desktopie | wydajność na iPhonie |
| Kamera | 3 presety (z góry do nauki, z perspektywy grającego, kinowa) + auto-follow zakresu C2–E5 | pionowy telefon |
| Dźwięk | **Tone.js Sampler + Salamander** (tylko używane klawisze, kilka MB, CC-BY 3.0) | realny fortepian, cache offline |
| Stack | **Vite + vanilla TS**, GitHub Actions → Pages | PWA, moduły, testy |
| PWA | vite-plugin-pwa, `scope=/carol-of-the-bells-piano/`, instrukcja „Dodaj do ekranu” dla iOS | offline na telefonie |
| Dane nut | **MusicXML** jako jedyne źródło (zamiast tablic w JS); później OSMD dla nut zsynchronizowanych z klawiszami | łatwe poprawki i kolejne utwory |
| Fallback | obecna klawiatura 2D SVG | słabe urządzenia, brak WebGL |

## Górny pasek
```
[▶] [⏸ czekaj] [L|Obie|P]  Tempo 80  Takt 12/60  [🎥 widok]  [⚙]
⚙ → panel: pętla A–B, metronom, głośność, nazwy nut (C/D ↔ Do/Re, H/B),
     jakość grafiki, motyw jasny/ciemny, wejście (MIDI / mikrofon)
```

## Etapy
1. **Szkielet**: Vite + TS, CI deploy na Pages, smoke test w Playwright. Wynik 1:1 z obecną wersją 2D.
2. **Scena 3D**: proceduralna klawiatura, podświetlenie i animacja per ręka, 3 kamery, adaptacyjna jakość, fallback 2D.
3. **Dźwięk**: Salamander Sampler i odblokowanie audio na iOS (już przetestowane).
4. **UI**: górny pasek, panel ustawień, ręce L/P, pętla A–B, tempo.
5. **Spadające nuty** i opcjonalny model fortepianu z HDRI.
6. **PWA/offline** i ikony.
7. (opcja) MusicXML + OSMD, tryb „czekaj na mnie”: Web MIDI (desktop/Android) lub mikrofon (iPhone, bo Safari nie ma Web MIDI).

## Ryzyka
- Moje odczytanie nut z PDF może mieć błędy, więc przed etapem 7 trzeba je sprawdzić ze słuchu albo z nutami.
- Atrybucja CC-BY (Salamander, ewentualnie model fortepianu) musi trafić do sekcji „O aplikacji”.
- Bloom i cienie na iOS kosztują dużo wydajności, dlatego jakość dobieramy na podstawie pomiaru FPS.
