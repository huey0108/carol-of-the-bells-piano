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
