// The answer key for learning a game: learns each real recording from scratch (ThirdeyeLearn.learnGame, one model call
// each), saves the profile next to the recording as <name>.learned.json, and compares it with the hand-made
// games/valorant.json, which the app never loads. Then run the probes on what was learned:
//   node eval/learncheck.mjs && PROFILE=learned node eval/feedprobe.mjs && PROFILE=learned node eval/shotprobe.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const hand = JSON.parse(fs.readFileSync(path.join(root, 'games/valorant.json'), 'utf8'));
const files = fs.readdirSync(path.join(here, 'recordings')).filter((f) => f === 'yt-vyse-ascent.mov' || /^Screen Recording 2026-10-17.*\.mov$/.test(f));
const only = process.argv.slice(2);

const PORT = 5189;
const dev = spawn(process.execPath, [path.join(root, 'scripts/dev.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${PORT}/`).then((r) => r.ok, () => false)) break; await new Promise((r) => setTimeout(r, 100)); }
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
// overlap of two [x, y, w, h] regions, 0 to 1
const iou = (a, b) => {
  if (!a || !b) return null;
  const x = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])), y = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  return +((x * y) / (a[2] * a[3] + b[2] * b[3] - x * y)).toFixed(2);
};
try {
  for (const name of files.filter((f) => !only.length || only.some((o) => f.includes(o)))) {
    const page = await browser.newPage();
    let calls = 0;
    page.on('request', (r) => { if (/:generateContent$/.test(new URL(r.url()).pathname)) calls++; });
    await page.goto(`http://localhost:${PORT}/`);
    await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'f'; i.hidden = true; document.body.append(i); });
    await page.setInputFiles('#f', path.join(here, 'recordings', name));
    const t0 = Date.now();
    // REUSE=1: the learn call's saved answer, so the pixel side can be tuned with no model calls
    const rawPath = path.join(here, 'recordings', `${path.basename(name, path.extname(name))}.learn-raw.json`);
    const saved = process.env.REUSE && fs.existsSync(rawPath) ? JSON.parse(fs.readFileSync(rawPath, 'utf8')) : null;
    const { profile, raw } = await page.evaluate(async (saved) => {
      const L = window.ThirdeyeLearn, video = await window.ThirdeyeVideo.open(document.getElementById('f').files[0]);
      if (saved) return { profile: await L.learnLayout({ video, profile: L.toProfile(saved) }), raw: saved };
      const r = await L.learnGame({ video });
      return { profile: r.profile, raw: r.raw };
    }, saved);
    const out = path.join(here, 'recordings', `${path.basename(name, path.extname(name))}.learned.json`);
    fs.writeFileSync(out, JSON.stringify(profile, null, 2));
    if (!saved) fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2)); // what the learn call said, for tuning the pixel side offline
    console.log(`\n${name}: learned "${profile.name}" (${profile.genre}${profile.firstPerson ? ', first person' : ''}${profile.teamGame ? ', team game' : ''}) in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${calls} model call${calls === 1 ? '' : 's'}`);
    console.log(`  elements boxed: ${(raw.elements || []).map((e) => e.name).join(', ')}; colors named ally "${profile.colorNames.ally}" ${JSON.stringify(raw.ally_rgb)}, enemy "${profile.colorNames.enemy}" ${JSON.stringify(raw.enemy_rgb)}`);
    console.log(`  kill_feed boxes: ${JSON.stringify((raw.elements || []).filter((e) => e.name === 'kill_feed').map((e) => [e.frame, e.box]))}`);
    for (const r of ['killfeed', 'minimap', 'ammo', 'scoreboard', 'health', 'aim']) console.log(`  ${r.padEnd(10)} overlap with the answer key ${iou(profile.regions[r], hand.regions[r]) ?? `- (${profile.regions[r] ? 'not in the key' : 'not learned'})`}`);
    const kf = profile.regions.killfeed, hk = hand.regions.killfeed, g = profile.killfeedGrid, hg = hand.killfeedGrid;
    if (g) {
      const f = (v) => v.toFixed(3);
      if (profile.layout?.rowHues) console.log(`  hues inside the rows (5° bins): ally ${profile.layout.rowHues.ally}; enemy ${profile.layout.rowHues.enemy}`);
      console.log(`  team hues: ally ${JSON.stringify(profile.killfeedColors.ally)} vs ${JSON.stringify(hand.killfeedColors.ally)}, enemy ${JSON.stringify(profile.killfeedColors.enemy)} vs ${JSON.stringify(hand.killfeedColors.enemy)}`);
      console.log(`  new rows a minute at the busiest stretch: ${profile.layout?.perMinute}; rows read as two teams: ${profile.layout?.twoTeams}`);
      console.log(`  rows (share of the screen height): height ${f(g.height * kf[3])} vs ${f(hg.height * hk[3])}, pitch ${f(g.pitch * kf[3])} vs ${f(hg.pitch * hk[3])}; portrait ${f(g.portrait * kf[2])} vs ${f(hg.portrait * hk[2])} of the width; new rows join at the ${g.newRows} (key: ${hg.newRows})`);
    } else console.log(`  kill feed: ${profile.layout?.killfeed || 'not boxed'}${profile.layout?.hues ? ` (biggest hues ${profile.layout.hues.join(', ')})` : ''}; scans would use the low-detail pass`);
    console.log(`  habits: ${profile.habits.map((h) => `${h.id}${h.measuredBy ? ' (aim)' : h.needsShots ? ' (shots)' : ''}`).join(', ')}`);
    console.log(`  saved ${path.relative(process.cwd(), out)}`);
    await page.close();
  }
} finally { await browser.close(); dev.kill(); }
