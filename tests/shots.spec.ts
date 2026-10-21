import { test } from '@playwright/test';
// Visual snapshots for manual review (not asserted). Run: SHOTS=1 scripts/test.sh tests/shots.spec.ts
const dir = process.env.SHOT_DIR ?? 'test-results/shots';
test.skip(!process.env.SHOTS, 'screenshots only on demand');

test('screenshots', async ({ page }, info) => {
  const p = info.project.name;
  await page.goto('./');
  await page.waitForFunction(() => (window as unknown as { __app?: { view?: { kind: string } } }).__app?.view?.kind === '3d');
  // jump to measure 25 (forte, both hands)
  await page.evaluate(() => { const s = document.querySelector('#seek') as HTMLInputElement; s.value = '72'; s.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${dir}/${p}-learn.png` });
  for (const v of ['player', 'cinema']) {
    const btn = page.locator(`[data-seg="cam"] button[data-v="${v}"]`).first();
    if (await btn.isVisible()) await btn.click();
    else { await page.click('#settingsBtn'); await page.click(`#sheet [data-seg="cam"] button[data-v="${v}"]`); await page.click('#sheetClose'); }
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${dir}/${p}-${v}.png` });
  }
  await page.click('#settingsBtn'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/${p}-settings.png` });
});
