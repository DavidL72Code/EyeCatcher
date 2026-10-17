// Makes a synthetic match recording for tests: a shooter-like scene with a fixed center crosshair, a clock, a kill
// feed, and duels at known times where the enemy's head sits a known number of head-heights above the crosshair (a
// planted "crosshair low" habit). Writes tests/fixtures/match.mp4 (or .webm) and truth.json.
// It exercises the pipeline end to end; it says nothing about accuracy on real game footage.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'fixtures');
const TRUTH = {
  width: 1280, height: 720, fps: 30, duration: 150, headPx: 18, fovH: 103,
  // heads: head-heights from the head center down to the crosshair (2 = crosshair at chest height)
  duels: [
    { t: 14, heads: 2.2, outcome: 'death', enemy: 'Enemy 1' }, { t: 31, heads: 0.1, outcome: 'kill', enemy: 'Enemy 2' },
    { t: 47, heads: 2.0, outcome: 'death', enemy: 'Enemy 3' }, { t: 66, heads: 2.4, outcome: 'death', enemy: 'Enemy 4' },
    { t: 83, heads: 0.2, outcome: 'kill', enemy: 'Enemy 5' }, { t: 101, heads: 1.9, outcome: 'death', enemy: 'Enemy 1' },
    { t: 118, heads: 2.1, outcome: 'kill', enemy: 'Enemy 2' }, { t: 134, heads: 2.3, outcome: 'death', enemy: 'Enemy 3' },
  ],
  rounds: [0, 40, 80, 120],
};

// The scene, drawn in the page for frame time t. Kept as plain code so the page can run it.
function drawScene(g, t, T) {
  const { width: W, height: H, headPx } = T;
  const cx = W / 2, cy = H / 2, sway = Math.sin(t * 0.7) * 3;
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  // world
  const sky = g.createLinearGradient(0, 0, 0, cy); sky.addColorStop(0, '#6f8fa8'); sky.addColorStop(1, '#c9b8a0');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  g.fillStyle = '#8a7a66'; g.beginPath(); g.moveTo(0, H); g.lineTo(W, H); g.lineTo(cx + 260 + sway, cy + 40); g.lineTo(cx - 260 + sway, cy + 40); g.fill();
  g.fillStyle = '#b39c7d'; g.beginPath(); g.moveTo(0, 0); g.lineTo(cx - 260 + sway, cy - 170); g.lineTo(cx - 260 + sway, cy + 40); g.lineTo(0, H); g.fill();
  g.fillStyle = '#a08a6d'; g.beginPath(); g.moveTo(W, 0); g.lineTo(cx + 260 + sway, cy - 170); g.lineTo(cx + 260 + sway, cy + 40); g.lineTo(W, H); g.fill();
  g.fillStyle = '#5b4d3f'; g.fillRect(cx - 60 + sway, cy - 90, 120, 130); // a doorway down the corridor
  g.fillStyle = '#7d6a55'; g.fillRect(cx + 90 + sway, cy - 140, 60, 180); // the corner the enemy steps out from
  const dead = T.duels.find((d) => d.outcome === 'death' && t >= d.t + 0.6 && t < d.t + 3.6);
  for (const d of T.duels) {
    if (t < d.t || t >= d.t + 0.6 + (d.outcome === 'kill' ? 0 : 3)) continue;
    const slide = Math.min(1, (t - d.t) / 0.25), x = cx + 120 + sway - slide * 70, hy = cy - d.heads * headPx;
    g.fillStyle = '#2f3b52'; g.fillRect(x - 13, hy + headPx / 2 + 2, 26, 64); // body
    g.fillStyle = '#d8b48c'; g.beginPath(); g.arc(x, hy, headPx / 2, 0, Math.PI * 2); g.fill(); // head
    g.fillStyle = '#c4384a'; g.fillRect(x - 13, hy + headPx / 2 + 2, 26, 6); // red team band
  }
  if (dead) { g.fillStyle = 'rgba(30,30,30,0.55)'; g.fillRect(0, 0, W, H); }
  // HUD: minimap, clock, kill feed, health, crosshair
  g.fillStyle = 'rgba(10,12,16,0.7)'; g.fillRect(10, 10, W * 0.27 - 20, H * 0.44 - 20);
  g.strokeStyle = '#9fb3c8'; g.lineWidth = 2; g.strokeRect(40, 40, 150, 90); g.strokeRect(120, 130, 120, 110);
  g.fillStyle = '#5fd1b8'; g.beginPath(); g.arc(150 + Math.sin(t / 5) * 30, 180, 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(10,12,16,0.75)'; g.fillRect(cx - 70, 6, 140, 50);
  g.fillStyle = '#f2f2f2'; g.font = 'bold 28px sans-serif'; g.textAlign = 'center'; g.fillText(mmss(t), cx, 42);
  const round = T.rounds.filter((r) => t >= r).length;
  if (t - T.rounds[round - 1] < 3) { g.font = 'bold 44px sans-serif'; g.fillStyle = '#ffffff'; g.fillText(`ROUND ${round}`, cx, cy - 200); }
  g.textAlign = 'right'; g.font = 'bold 18px sans-serif';
  const feed = T.duels.filter((d) => t >= d.t + 0.6 && t < d.t + 5.6).slice(-4);
  feed.forEach((d, i) => {
    const y = H * 0.07 + i * 32, mine = true;
    g.fillStyle = 'rgba(10,12,16,0.75)'; g.fillRect(W * 0.71, y, W * 0.27, 26);
    if (mine) { g.strokeStyle = '#f5c542'; g.lineWidth = 2; g.strokeRect(W * 0.71, y, W * 0.27, 26); }
    g.fillStyle = '#f2f2f2';
    g.fillText(d.outcome === 'kill' ? `YOU  >  ${d.enemy.toUpperCase()}` : `${d.enemy.toUpperCase()}  >  YOU`, W * 0.97, y + 19);
  });
  g.textAlign = 'center'; g.fillStyle = 'rgba(10,12,16,0.75)'; g.fillRect(cx - 60, H - 64, 120, 46);
  g.fillStyle = dead ? '#c4384a' : '#f2f2f2'; g.font = 'bold 30px sans-serif'; g.fillText(dead ? '0' : '100', cx, H - 30);
  if (dead) { g.font = 'bold 26px sans-serif'; g.fillStyle = '#ffffff'; g.fillText(`KILLED BY ${dead.enemy.toUpperCase()}`, cx, H - 110); return; }
  g.strokeStyle = '#3cf2c8'; g.lineWidth = 2; g.beginPath();
  g.moveTo(cx - 9, cy); g.lineTo(cx - 3, cy); g.moveTo(cx + 3, cy); g.lineTo(cx + 9, cy); g.moveTo(cx, cy - 9); g.lineTo(cx, cy - 3); g.moveTo(cx, cy + 3); g.lineTo(cx, cy + 9); g.stroke();
}

const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>fixture</title>'); }).listen(0);
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const made = await page.evaluate(async ({ T, scene }) => {
    const M = await import('https://cdn.jsdelivr.net/npm/mediabunny@1.61.0/dist/bundles/mediabunny.min.mjs');
    const draw = new Function(`return (${scene})`)();
    const avc = await M.canEncodeVideo('avc', { width: T.width, height: T.height });
    const canvas = new OffscreenCanvas(T.width, T.height), g = canvas.getContext('2d');
    const output = new M.Output({ format: avc ? new M.Mp4OutputFormat() : new M.WebMOutputFormat(), target: new M.BufferTarget() });
    const source = new M.CanvasSource(canvas, { codec: avc ? 'avc' : 'vp8', quality: M.QUALITY_HIGH, keyFrameInterval: 2 });
    output.addVideoTrack(source, { frameRate: T.fps });
    await output.start();
    for (let i = 0; i < T.duration * T.fps; i++) { draw(g, i / T.fps, T); await source.add(i / T.fps, 1 / T.fps); }
    await output.finalize();
    const bytes = new Uint8Array(output.target.buffer);
    let bin = '';
    for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
    return { ext: avc ? 'mp4' : 'webm', data: btoa(bin) };
  }, { T: TRUTH, scene: drawScene.toString() });
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `match.${made.ext}`);
  fs.writeFileSync(file, Buffer.from(made.data, 'base64'));
  fs.writeFileSync(path.join(out, 'truth.json'), JSON.stringify({ ...TRUTH, file: path.basename(file) }, null, 2));
  console.log(`Wrote ${path.relative(process.cwd(), file)} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB) and truth.json`);
} finally {
  await browser.close();
  server.close();
}
