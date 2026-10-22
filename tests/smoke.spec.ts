import { test, expect, type Page } from '@playwright/test';

type AppProbe = { view: { kind: string; keyCount: number }; cur: number; playing: boolean; audioState: () => string };
const app = (page: Page) => page.evaluate(() => {
  const a = (window as unknown as { __app?: AppProbe }).__app;
  return a ? { kind: a.view?.kind, keys: a.view?.keyCount, cur: a.cur, playing: a.playing, audio: a.audioState() } : null;
});

test('loads 3D keyboard with 88 keys, no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('./');
  await expect.poll(() => app(page).then(a => a?.kind), { timeout: 25_000 }).toBe('3d');
  expect((await app(page))!.keys).toBe(88);
  await expect(page.locator('#now')).toContainText('G4');
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('play advances the transport and starts audio', async ({ page }) => {
  await page.goto('./');
  await expect.poll(() => app(page).then(a => a?.kind), { timeout: 25_000 }).toBe('3d');
  await page.click('#play');
  await page.waitForTimeout(2500);
  const a = (await app(page))!;
  expect(a.playing).toBe(true);
  expect(a.audio).toBe('running');
  expect(a.cur).toBeGreaterThan(1.5);
  await page.click('#play');
  expect((await app(page))!.playing).toBe(false);
});

test('step, settings sheet, 2D fallback toggle', async ({ page }) => {
  await page.goto('./');
  await expect.poll(() => app(page).then(a => a?.kind), { timeout: 25_000 }).toBe('3d');
  await page.click('#next');
  await expect(page.locator('#now')).toContainText('F♯4');
  await page.click('#settingsBtn');
  await expect(page.locator('#sheet')).toHaveClass(/open/);
  await page.click('#sheet [data-seg="viewMode"] button[data-v="2d"]');
  await expect.poll(() => app(page).then(a => a?.kind), { timeout: 25_000 }).toBe('2d');
  expect((await app(page))!.keys).toBe(88);
  await page.click('#sheet [data-seg="viewMode"] button[data-v="3d"]');
  await expect.poll(() => app(page).then(a => a?.kind), { timeout: 25_000 }).toBe('3d');
});

test('piano samples load and are used for playback', async ({ page }) => {
  await page.goto('./');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __app: { pianoStatus: () => { state: string; loaded: number; total: number } } }).__app?.pianoStatus()), { timeout: 25_000 })
    .toMatchObject({ state: 'ready', loaded: 19, total: 19 });
  await page.click('#play');
  await page.waitForTimeout(1500);
  const n = await page.evaluate(() => (window as unknown as { __app: { notes: number } }).__app.notes);
  expect(n).toBeGreaterThan(2);
  await page.click('#settingsBtn');
  await expect(page.locator('#pianoStatus')).toHaveText('gotowy');
});

type W = { __app: { cur: number; playing: boolean; waiting: boolean; gate: number | null; stats: { hits: number; misses: number }; input: (m: number) => void } };
const st = (page: Page) => page.evaluate(() => { const a = (window as unknown as W).__app; return { cur: a.cur, playing: a.playing, waiting: a.waiting, gate: a.gate, stats: a.stats }; });

test('A–B loop wraps back to A', async ({ page }) => {
  await page.goto('./');
  await expect.poll(() => app(page).then(a => a?.kind), { timeout: 25_000 }).toBe('3d');
  await page.click('#settingsBtn');
  await page.fill('#loopA', '2'); await page.dispatchEvent('#loopA', 'change');
  await page.fill('#loopB', '2'); await page.dispatchEvent('#loopB', 'change');
  await page.click('#sheet [data-toggle="loop"]');
  await page.click('#sheetClose');
  await expect(page.locator('#loopLbl')).toHaveText('2–2');
  // 160 bpm → one 3/4 bar = 1.125 s
  await page.evaluate(() => { const i = document.querySelector('[data-tempo]') as HTMLInputElement; i.value = '160'; i.dispatchEvent(new Event('input')); });
  await page.click('#play');
  const wraps = () => page.evaluate(() => (window as unknown as { __app: { loopWraps: number } }).__app.loopWraps);
  await expect.poll(wraps, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < 5; i++) {
    const c = (await st(page)).cur;
    expect(c).toBeGreaterThanOrEqual(3 - 0.01);
    expect(c).toBeLessThan(6);
    await page.waitForTimeout(150);
  }
});

test('wait mode holds until the right key, counts hits/misses', async ({ page }) => {
  await page.goto('./');
  await expect.poll(() => app(page).then(a => a?.kind), { timeout: 25_000 }).toBe('3d');
  await page.click('#waitBtn');
  await page.click('#play');
  await page.waitForTimeout(900);
  let s = await st(page);
  expect(s.waiting).toBe(true);
  expect(s.gate).toBe(0);
  expect(s.cur).toBeLessThan(0.05);
  await expect(page.locator('#now')).toContainText('Czekam');
  await page.evaluate(() => (window as unknown as W).__app.input(61)); // wrong
  await page.evaluate(() => (window as unknown as W).__app.input(67)); // G4 ✓
  await page.waitForTimeout(300);
  s = await st(page);
  expect(s.stats).toEqual({ hits: 1, misses: 1 });
  expect(s.gate).toBe(1); // next onset F#4
  await expect(page.locator('#stats')).toContainText('50%');
});

test('tapping a key on screen registers the note', async ({ page }) => {
  await page.goto('./');
  await expect.poll(() => app(page).then(a => a?.kind), { timeout: 25_000 }).toBe('3d');
  await page.click('#waitBtn');
  // project G4 key centre to screen and tap it
  const pt = await page.evaluate(() => {
    const v = (window as unknown as { __app: { view: { pick: (x: number, y: number) => number | null } } }).__app.view;
    const r = document.querySelector('#stage')!.getBoundingClientRect();
    for (let y = r.top + 5; y < r.bottom; y += 6) for (let x = r.left; x < r.right; x += 3) if (v.pick(x, y) === 67) return { x, y };
    return null;
  });
  expect(pt).not.toBeNull();
  await page.mouse.click(pt!.x, pt!.y);
  await page.waitForTimeout(200);
  expect((await st(page)).stats.hits).toBe(1);
});

test('falling notes lane shows upcoming notes and can be toggled off', async ({ page }) => {
  await page.goto('./');
  await expect.poll(() => app(page).then(a => a?.kind), { timeout: 25_000 }).toBe('3d');
  const n = () => page.evaluate(() => (window as unknown as { __app: { falling: number } }).__app.falling);
  await expect.poll(n).toBeGreaterThan(3);
  const labels = () => page.evaluate(() => (window as unknown as { __app: { laneLabels: number } }).__app.laneLabels);
  await expect.poll(labels).toBeGreaterThan(3);
  await page.click('#settingsBtn');
  await page.click('#sheet [data-seg="laneLabels"] button[data-v="off"]');
  await expect.poll(labels).toBe(0);
  await page.click('#sheet [data-seg="laneLabels"] button[data-v="top"]');
  await expect.poll(labels).toBeGreaterThan(0);
  await page.click('#sheet [data-seg="laneStyle"] button[data-v="classic"]');
  await page.click('#sheet [data-toggle="notes"]');
  await expect.poll(n).toBe(0);
});
