// npm run scenes: encodes Home's scenario clips from recordings on this machine into assets/scenes/, one short silent
// clip and one poster frame (the frame the demo freezes on) each. What Home says over each clip is in app.js (SCENES)
// and was checked against these frames by eye; change a clip's times and those steps have to be checked again.
// Runs the dev server's page in Chrome, since the encoder (Mediabunny) is browser code. Needs the dev server running.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const rec = (name) => path.join(root, 'eval/recordings', name);
// each clip runs a little past its last step, and its poster is the frame of the step whose marks say the most
const SCENES = [
  { id: 'lol', file: () => rec('league-of-legends/lol-hacklet-mf.14-24.mp4'), from: 96, to: 107.6, poster: 100 },
  { id: 'rl', file: () => rec('rocket-league/rl-somey-gc2.match1.mp4'), from: 245.5, to: 256, poster: 247.5 },
  { id: 'r6', file: () => rec('rainbow-six/r6-fhx2tfA57ug.r2-4.mp4'), from: 512.5, to: 520, poster: 515.9 },
  { id: 'mr', file: () => rec('marvel-rivals/mr-punk-magik.attack.mp4'), from: 251, to: 259.6, poster: 258 },
];
const base = process.env.DEV_URL || 'http://localhost:5177';
const out = path.join(root, 'assets/scenes');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage();
  // writing a clip into assets/ would make the dev server reload this page mid-encode
  await page.route('**/__reload*', (r) => r.abort());
  await page.goto(`${base}/#coach`);
  for (const s of SCENES.filter((x) => !process.argv[2] || x.id === process.argv[2])) {
    await page.evaluate(() => { document.querySelector('#pick')?.remove(); const i = document.createElement('input'); i.type = 'file'; i.id = 'pick'; document.body.append(i); });
    await page.setInputFiles('#pick', s.file());
    const t0 = Date.now();
    const r = await page.evaluate(async ({ from, to, poster }) => {
      const V = window.ThirdeyeVideo, M = await import('./vendor/mediabunny.min.mjs');
      const file = document.querySelector('#pick').files[0], v = await V.open(file);
      const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
      const conv = await M.Conversion.init({ input: new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(file) }), output, trim: { start: v.start + from, end: v.start + to }, video: { width: 960, frameRate: 24, codec: 'avc', bitrate: 2_200_000 }, audio: { discard: true } });
      await conv.execute();
      const bytes = new Uint8Array(output.target.buffer);
      let bin = '';
      for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
      const [p] = await V.grab(v, [poster], { maxDim: 960, quality: 0.84 });
      return { clip: btoa(bin), poster: p.url.split(',')[1], w: v.width, h: v.height };
    }, { from: s.from, to: s.to, poster: s.poster });
    fs.writeFileSync(path.join(out, `${s.id}.mp4`), Buffer.from(r.clip, 'base64'));
    fs.writeFileSync(path.join(out, `${s.id}.jpg`), Buffer.from(r.poster, 'base64'));
    console.log(`${s.id}: ${s.to - s.from} s, ${Math.round(fs.statSync(path.join(out, `${s.id}.mp4`)).size / 1024)} KB, source ${r.w}x${r.h}, ${Math.round((Date.now() - t0) / 1000)} s to encode`);
  }
} finally {
  await browser.close();
}
