// Whether the player fired, read from the HUD ammo counter (ThirdeyeAgent.shotsAround, no Gemini calls), against
// stretches labeled by eye from ammo contact sheets on Oct 18, 2026. The guard that uses it refuses a moment only on
// "no shots", so a wrong "no" is the costly mistake: it would throw out a real habit.
//   node eval/shotprobe.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const tenz = fs.readdirSync(path.join(here, 'recordings')).find((f) => /^Screen Recording 2026-10-17.*\.mov$/.test(f));
// from, to: the stretch; shots and bursts: what the magazine count shows frame by frame
const LABELS = [
  { file: 'yt-vyse-ascent.mov', from: 397, to: 398.5, shots: 4, bursts: [4], note: 'Vandal 25 to 21' },
  { file: 'yt-vyse-ascent.mov', from: 121, to: 126, shots: 0, bursts: [], note: 'Sheriff stays at 3; the HUD is hidden before 122.1' },
  { file: 'yt-vyse-ascent.mov', from: 597, to: 599.5, shots: 0, bursts: [], note: 'Vandal stays at 22' },
  { file: tenz, from: 225, to: 231, shots: 6, bursts: [5, 1], note: '22 to 17 in 0.45 s, then 16 at 230.9, white gun skin behind the digits' },
  { file: tenz, from: 94, to: 100, shots: 1, bursts: [1], note: '2 to 1 near 99.4, then a swap to 12 iii 36; a white swipe hides the digits 99.3 to 99.7' },
  { file: tenz, from: 225, to: 228.3, shots: 0, bursts: [], note: 'stays at 22 over the white gun skin' },
  { file: tenz, from: 229, to: 230.8, shots: 0, bursts: [], note: 'stays at 17' },
  { file: 'yt-vyse-ascent.mov', from: 397.6, to: 397.95, shots: 3, bursts: [3], note: '24 to 21, a short stretch' },
];

const learnedPath = (video) => path.join(path.dirname(video), `${path.basename(video, path.extname(video))}.learned.json`);
const PORT = 5194;
const dev = spawn(process.execPath, [path.join(root, 'scripts/dev.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${PORT}/`).then((r) => r.ok, () => false)) break; await new Promise((r) => setTimeout(r, 100)); }
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
let right = 0, wrongNo = 0;
try {
  for (const file of [...new Set(LABELS.map((l) => l.file))]) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'f'; i.hidden = true; document.body.append(i); });
    await page.setInputFiles('#f', path.join(here, 'recordings', file));
    // PROFILE=learned: the profile eval/learncheck.mjs learned from this recording, instead of the hand-made answer key
    if (process.env.PROFILE === 'learned') await page.evaluate((p) => { window.__profile = p; }, JSON.parse(fs.readFileSync(learnedPath(path.join(here, 'recordings', file)), 'utf8')));
    const labels = LABELS.filter((l) => l.file === file);
    const got = await page.evaluate(async (labels) => {
      const A = window.ThirdeyeAgent, V = window.ThirdeyeVideo;
      const profile = window.__profile || (await (await fetch('games/valorant.json')).json());
      const video = await V.open(document.getElementById('f').files[0]);
      const out = [];
      for (const l of labels) out.push(await A.shotsAround({ video, profile, events: [], t: l.from, before: 0, after: l.to - l.from }));
      return out;
    }, labels);
    labels.forEach((l, i) => {
      const g = got[i], ok = g && g.fired === l.shots > 0;
      if (ok) right++;
      if (g && g.fired === false && l.shots > 0) wrongNo++;
      console.log(`${ok ? 'ok  ' : 'MISS'} ${file.slice(0, 18)} ${l.from}-${l.to}: labeled ${l.shots} shots, read ${g ? `${g.fired ? 'fired' : 'no shots'} (${g.changes} steady changes, ${g.from.toFixed(2)}-${g.to.toFixed(2)})` : "can't tell"} (${l.note})`);
    });
    await page.close();
  }
  console.log(`${right}/${LABELS.length} stretches read right; ${wrongNo} wrongly read as no shots`);
} finally { await browser.close(); dev.kill(); }
