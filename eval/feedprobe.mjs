// How many kill-feed calls a scan makes, measured from pixels alone (no Gemini calls), against the hand labels: each new
// row is cut out once (ThirdeyeAgent.feedStrips) and ROWS_PER_CALL strips go to a call. Saves the pictures Gemini would
// get, so they can be checked by eye. Before row strips (Oct 17), a scan sent whole kill-feed crops, 12 to a call:
// 9 calls on yt-vyse-ascent and 7 on the TenZ recording.
//   node eval/feedprobe.mjs [out dir]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.resolve(process.argv[2] || path.join(here, 'recordings', 'feedprobe'));
fs.mkdirSync(out, { recursive: true });
const recordings = [
  ['yt-vyse-ascent.mov', 'yt-vyse-ascent.truth.json'],
  ['Screen Recording 2026-10-17 at 6.13.34\u202fPM.mov', 'tenz-stream.truth.json'], // macOS puts a narrow space before PM
].map(([v, t]) => ({ video: path.join(here, 'recordings', v), truth: JSON.parse(fs.readFileSync(path.join(here, 'recordings', t), 'utf8')) }));

const round3 = (x) => Math.round(x * 1000) / 1000;
const learnedPath = (video) => path.join(path.dirname(video), `${path.basename(video, path.extname(video))}.learned.json`);
const PORT = 5198;
const dev = spawn(process.execPath, [path.join(root, 'scripts/dev.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${PORT}/`).then((r) => r.ok, () => false)) break; await new Promise((r) => setTimeout(r, 100)); }
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  for (const rec of recordings) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'f'; i.hidden = true; document.body.append(i); });
    await page.setInputFiles('#f', rec.video);
    // PROFILE=learned: the profile eval/learncheck.mjs learned from this recording, instead of the hand-made answer key
    if (process.env.PROFILE === 'learned') await page.evaluate((p) => { window.__profile = p; }, JSON.parse(fs.readFileSync(learnedPath(rec.video), 'utf8')));
    const r = await page.evaluate(async ({ to }) => {
      const V = window.ThirdeyeVideo, A = window.ThirdeyeAgent;
      const profile = window.__profile || (await (await fetch('games/valorant.json')).json());
      const video = await V.open(document.getElementById('f').files[0]);
      const end = Math.min(to, video.duration);
      const { strips, grid } = await A.feedStrips({ video, profile, from: 0, to: end });
      const sheets = [];
      for (let k = 0; k < strips.length; k += A.ROWS_PER_CALL) sheets.push((await A.feedSheet(strips.slice(k, k + A.ROWS_PER_CALL))).data);
      return { grid, strips: strips.map((s) => ({ t: s.t, left: s.row.left, right: s.row.right })), sheets, size: [video.width, video.height] };
    }, { to: rec.truth.killfeed.window[1] });
    // each labeled line should have a strip within a few seconds of its label, with the same teams
    const used = new Set();
    const missed = [], teamsWrong = [];
    for (const e of rec.truth.killfeed.events) {
      const k = r.strips.findIndex((s, i) => !used.has(i) && s.t >= e.t - 1 && s.t <= e.t + 3 && s.left === e.killerTeam && s.right === e.victimTeam);
      const loose = k < 0 ? r.strips.findIndex((s, i) => !used.has(i) && s.t >= e.t - 1 && s.t <= e.t + 3) : -1;
      if (k >= 0) used.add(k); else if (loose >= 0) { used.add(loose); teamsWrong.push(`${e.t} ${e.killer}>${e.victim} read ${r.strips[loose].left}>${r.strips[loose].right}`); } else missed.push(`${e.t} ${e.killer}>${e.victim}`);
    }
    const name = path.basename(rec.video, path.extname(rec.video));
    r.sheets.forEach((d, i) => fs.writeFileSync(path.join(out, `${name}-rows-${i + 1}.jpg`), Buffer.from(d, 'base64')));
    const n = rec.truth.killfeed.events.length;
    console.log(`${name} (${r.size.join('x')}, ${n} labeled lines, row grid top ${round3(r.grid?.top)})`);
    console.log(`  rows: ${r.strips.length} strips -> ${r.sheets.length} calls; labeled lines with a strip ${n - missed.length}/${n}, teams from pixels right ${n - missed.length - teamsWrong.length}/${n - missed.length}, extra strips ${r.strips.length - used.size}`);
    console.log(`  strip times: ${r.strips.map((x, i) => `${i + 1}@${x.t}`).join(' ')}`);
    if (missed.length) console.log(`  missed: ${missed.join('; ')}`);
    if (teamsWrong.length) console.log(`  teams: ${teamsWrong.join('; ')}`);
    await page.close();
  }
} finally { await browser.close(); dev.kill(); }
