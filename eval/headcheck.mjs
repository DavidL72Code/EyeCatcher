// Head boxes one image per call against several images in one call (measure_aim batches up to 6), on the real Gemini API.
// The synthetic match has known head positions, so it gives an error in degrees; real footage has no head labels, so
// there the two ways are only compared with each other. About 22 model calls.
//   node eval/headcheck.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const synthetic = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/truth.json'), 'utf8'));
const realFile = fs.readdirSync(path.join(here, 'recordings')).find((f) => /^Screen Recording 2026-10-17.*\.mov$/.test(f));
const real = JSON.parse(fs.readFileSync(path.join(here, 'recordings/tenz-stream.truth.json'), 'utf8'));
const BATCH = 6;

const PORT = 5196;
const dev = spawn(process.execPath, [path.join(root, 'scripts/dev.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${PORT}/`).then((r) => r.ok, () => false)) break; await new Promise((r) => setTimeout(r, 100)); }
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage();
  let calls = 0;
  page.on('request', (r) => { if (/:generateContent$/.test(new URL(r.url()).pathname)) calls++; });
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'f'; i.hidden = true; document.body.append(i); });
  await page.setInputFiles('#f', path.join(here, 'recordings', realFile));
  const out = await page.evaluate(async ({ synthetic, real, BATCH }) => {
    const C = window.ThirdeyeCore, V = window.ThirdeyeVideo, A = window.ThirdeyeAgent;
    const profile = await (await fetch('games/valorant.json')).json();
    // both ways on the same crops: one call per image, then BATCH images to a call
    async function both(video, times) {
      const frame = { w: video.width, h: video.height }, crop = C.regionRect(profile, 'aim', frame);
      const shots = await V.grab(video, times, { crop, maxDim: 1024, quality: 0.9 });
      const heads = (box) => (box ? C.aimOffset({ box, crop, frame, fovH: profile.fovH, crosshair: profile.crosshair }) : null);
      const single = [];
      for (const s of shots) single.push(heads((await A.findHeads([s], {}))[0]));
      const batched = [];
      for (let k = 0; k < shots.length; k += BATCH) batched.push(...(await A.findHeads(shots.slice(k, k + BATCH), {})).map(heads));
      return times.map((t, i) => ({ t, single: single[i], batched: batched[i] }));
    }
    const blob = await (await fetch(`tests/fixtures/${synthetic.file}`)).blob();
    const fixture = await V.open(new File([blob], synthetic.file, { type: blob.type }));
    const f = fixture.width / 2 / Math.tan((profile.fovH * Math.PI) / 360);
    const degOf = (h) => (Math.atan((h * synthetic.headPx) / f) * 180) / Math.PI;
    const syn = (await both(fixture, synthetic.duels.map((d) => d.t + 0.3))).map((r, i) => ({ ...r, truthDeg: +degOf(synthetic.duels[i].heads).toFixed(2) }));
    const tenz = await V.open(document.getElementById('f').files[0]);
    const realRows = await both(tenz, real.duels.map((d) => d.t - 0.5));
    return { syn, realRows };
  }, { synthetic, real, BATCH });

  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
  const errs = (way) => out.syn.filter((r) => r[way]).map((r) => Math.abs(r[way].dyDeg - r.truthDeg));
  console.log(`Synthetic (${out.syn.length} duels, known heads):`);
  for (const way of ['single', 'batched']) { const e = errs(way); console.log(`  ${way.padEnd(8)} boxed ${e.length}/${out.syn.length}, median error ${median(e)?.toFixed(2)} deg, worst ${Math.max(...e).toFixed(2)} deg`); }
  console.log(`  per duel (truth deg: single, batched): ${out.syn.map((r) => `${r.truthDeg}: ${r.single?.dyDeg ?? '-'}, ${r.batched?.dyDeg ?? '-'}`).join(' | ')}`);
  const pairs = out.realRows.filter((r) => r.single && r.batched);
  console.log(`TenZ (${out.realRows.length} duel moments, no head labels):`);
  console.log(`  head found: single ${out.realRows.filter((r) => r.single).length}, batched ${out.realRows.filter((r) => r.batched).length}, both ${pairs.length}`);
  console.log(`  single vs batched on the same frame: median gap ${median(pairs.map((r) => Math.abs(r.single.heads - r.batched.heads)))?.toFixed(2)} heads, ${median(pairs.map((r) => Math.abs(r.single.dyDeg - r.batched.dyDeg)))?.toFixed(2)} deg; same band ${pairs.filter((r) => r.single.band === r.batched.band).length}/${pairs.length}`);
  console.log(`  per moment (heads single, batched): ${out.realRows.map((r) => `${r.t}: ${r.single?.heads ?? '-'}, ${r.batched?.heads ?? '-'}`).join(' | ')}`);
  console.log(`Model calls: ${calls}`);
  fs.writeFileSync(path.join(here, 'recordings', `headcheck-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify(out, null, 2));
} finally { await browser.close(); dev.kill(); }
