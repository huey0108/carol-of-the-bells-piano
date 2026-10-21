import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
// Records ~12 s of real app output (measures 13–17) to WAV and checks level/clipping. Run: REC=1 scripts/test.sh tests/record.spec.ts --project=desktop
test.skip(!process.env.REC, 'on demand');

test('record audio output', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    // tee everything that reaches the speakers into a recorder
    const orig = AudioNode.prototype.connect as (...a: unknown[]) => unknown;
    (AudioNode.prototype as unknown as { connect: unknown }).connect = function (this: AudioNode, dest: unknown, ...rest: unknown[]) {
      const r = orig.call(this, dest, ...rest);
      if (dest instanceof AudioDestinationNode) {
        const ctx = this.context as AudioContext;
        const w = window as unknown as { __rec?: { buf: Float32Array[]; sr: number } };
        if (!w.__rec) {
          w.__rec = { buf: [], sr: ctx.sampleRate };
          const sp = ctx.createScriptProcessor(4096, 1, 1);
          sp.onaudioprocess = e => { w.__rec!.buf.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
          orig.call(this, sp); orig.call(sp, ctx.destination);
        }
      }
      return r;
    };
  });
  await page.goto('./');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __app: { pianoStatus: () => { state: string } } }).__app?.pianoStatus().state), { timeout: 25_000 }).toBe('ready');
  await page.evaluate(() => { const s = document.querySelector('#seek') as HTMLInputElement; s.value = String(12 * 3); s.dispatchEvent(new Event('input')); });
  await page.click('#play');
  await page.waitForTimeout(12_000);
  await page.click('#play');
  await page.waitForTimeout(800);
  const { samples, sr } = await page.evaluate(() => {
    const r = (window as unknown as { __rec: { buf: Float32Array[]; sr: number } }).__rec;
    const all: number[] = []; for (const b of r.buf) for (const v of b) all.push(v);
    return { samples: all, sr: r.sr };
  });
  const peak = samples.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
  const rms = Math.sqrt(samples.reduce((a, v) => a + v * v, 0) / samples.length);
  const clipped = samples.filter(v => Math.abs(v) >= 0.999).length;
  console.log(JSON.stringify({ seconds: samples.length / sr, peak, rmsDb: 20 * Math.log10(rms), clipped }));
  // 16-bit mono WAV
  const n = samples.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  samples.forEach((v, i) => b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
  writeFileSync(process.env.REC_OUT ?? 'test-results/sample.wav', b);
  expect(peak).toBeGreaterThan(0.05);
  expect(clipped).toBe(0);
});
