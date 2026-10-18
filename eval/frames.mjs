// Frames from a recording, for checking a game profile's regions and for labeling ground truth by hand.
//   node eval/frames.mjs <video> info                        size and length, plus 4 frames with the profile's regions drawn on
//   node eval/frames.mjs <video> at 61.5,62 [region] [px]    single frames (full screen or a region), px wide
//   node eval/frames.mjs <video> sheet <from> <to> <every> [region] [px] [cols] [per]
//                                                             contact sheets: one tile every <every> s, <per> tiles a sheet (60)
// Images go to eval/recordings/<video name>-frames/ (git ignores eval/recordings/). Decoding runs in Chrome (Mediabunny).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const [file, mode = 'info', ...rest] = process.argv.slice(2);
if (!file || !fs.existsSync(file)) throw new Error('Usage: node eval/frames.mjs <video> info | at <t,t> [region] [px] | sheet <from> <to> <every> [region] [px] [cols]');
const out = path.join(here, 'recordings', `${path.basename(file, path.extname(file))}-frames`);
fs.mkdirSync(out, { recursive: true });
const PORT = 5197;
const dev = spawn(process.execPath, [path.join(root, 'scripts/dev.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${PORT}/`).then((r) => r.ok, () => false)) break; await new Promise((r) => setTimeout(r, 100)); }

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'f'; i.hidden = true; document.body.append(i); });
  await page.setInputFiles('#f', path.resolve(file));
  // PROFILE=learned: draw and crop by what learn.js learned from this recording (saved by eval/run.mjs or learncheck)
  if (process.env.PROFILE === 'learned') await page.evaluate((p) => { window.__profile = p; }, JSON.parse(fs.readFileSync(path.join(path.dirname(path.resolve(file)), `${path.basename(file, path.extname(file))}.learned.json`), 'utf8')));
  const images = await page.evaluate(async ({ mode, rest }) => {
    const C = window.ThirdeyeCore, V = window.ThirdeyeVideo;
    const profile = window.__profile || (await (await fetch('games/valorant.json')).json());
    const video = await V.open(document.getElementById('f').files[0]);
    const frame = { w: video.width, h: video.height };
    const jpeg = async (canvas) => (await V.toJpeg(canvas, 0.85)).data;
    // a region is a profile region name, or x,y,w,h as fractions of the screen
    const area = (region) => (/,/.test(region) ? (([x, y, w, h]) => ({ x: Math.round(x * frame.w), y: Math.round(y * frame.h), w: Math.round(w * frame.w), h: Math.round(h * frame.h) }))(region.split(',').map(Number)) : C.regionRect(profile, region, frame));
    const result = [];
    if (mode === 'info') {
      const times = [0.2, 0.4, 0.6, 0.8].map((f) => +(video.duration * f).toFixed(1));
      for (const shot of await V.grab(video, times, { maxDim: 1600 })) {
        const c = new OffscreenCanvas(shot.w, shot.h), g = c.getContext('2d'), s = shot.w / frame.w;
        g.drawImage(shot.canvas, 0, 0);
        g.lineWidth = 3; g.font = 'bold 22px sans-serif';
        for (const [name, r] of Object.entries(profile.regions)) {
          const x = r[0] * shot.w, y = r[1] * shot.h;
          g.strokeStyle = '#ffd23f'; g.strokeRect(x, y, r[2] * shot.w, r[3] * shot.h);
          g.fillStyle = '#ffd23f'; g.fillText(name, x + 6, y + 24);
        }
        g.strokeStyle = '#ff3b30'; g.beginPath(); g.moveTo(shot.w / 2 - 20, shot.h / 2); g.lineTo(shot.w / 2 + 20, shot.h / 2); g.moveTo(shot.w / 2, shot.h / 2 - 20); g.lineTo(shot.w / 2, shot.h / 2 + 20); g.stroke();
        result.push({ name: `info-${C.mmss(shot.t).replace(':', 'm')}s.jpg`, data: await jpeg(c), scale: s });
      }
      return { info: { width: video.width, height: video.height, duration: +video.duration.toFixed(2), codec: video.track.codec, sizeMb: +(video.size / 1e6).toFixed(1) }, result };
    }
    if (mode === 'at') {
      const [times, region = 'full', px = '1280'] = rest;
      const crop = area(region);
      for (const shot of await V.grab(video, times.split(',').map(Number), { crop, maxDim: +px, quality: 0.9 })) result.push({ name: `at-${shot.t.toFixed(1)}-${region.replace(/[^a-z0-9.]+/gi, '_')}.jpg`, data: shot.data });
      return { result };
    }
    const [from, to, every, region = 'full', px = '320', cols = '6', per = '60'] = rest;
    const crop = area(region);
    const times = [];
    for (let t = +from; t <= Math.min(+to, video.duration - 0.05); t += +every) times.push(+t.toFixed(2));
    const shots = await V.grab(video, times, { crop, maxDim: +px, quality: 0.85 });
    for (let s = 0; s < shots.length; s += +per) {
      const page = shots.slice(s, s + +per), w = page[0].w, h = page[0].h, n = +cols, rows = Math.ceil(page.length / n);
      const c = new OffscreenCanvas(n * w, rows * (h + 22)), g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.font = 'bold 16px monospace';
      page.forEach((shot, i) => {
        const x = (i % n) * w, y = Math.floor(i / n) * (h + 22);
        g.fillStyle = '#ffd23f'; g.fillText(C.mmss(shot.t, true), x + 4, y + 16);
        g.drawImage(shot.canvas, x, y + 22);
      });
      result.push({ name: `sheet-${region.replace(/[^a-z0-9.]+/gi, '_')}-${C.mmss(page[0].t).replace(':', 'm')}s.jpg`, data: await jpeg(c) });
    }
    return { result };
  }, { mode, rest });
  if (images.info) console.log(JSON.stringify(images.info));
  for (const im of images.result) { fs.writeFileSync(path.join(out, im.name), Buffer.from(im.data, 'base64')); console.log(path.relative(process.cwd(), path.join(out, im.name))); }
} finally {
  await browser.close();
  dev.kill();
}
