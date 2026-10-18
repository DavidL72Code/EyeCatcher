// Makes two synthetic chess recordings for tests, from the player's side (White, at the bottom), with both clocks and
// a last-move highlight like a chess site:
//   chess-blunders.mp4  White plays Stockfish's move, except a planted blunder (250+ centipawns) on every other move
//                       once its clock is under 30 s: a "blunders under time pressure" habit.
//   chess-clean.mp4     the same setup with no blunders: a clean control.
// Black is Stockfish. Every move is scored at depth 12 for tests/fixtures/chess-truth.json, which also holds the
// board's rectangle and the clocks. Games come from Node (chess.js, stockfish@10.0.2); frames are drawn and encoded in
// Chrome with Mediabunny, like tests/make-fixture.mjs.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../chess-reader.js');
const { Chess } = require('chess.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'fixtures');
const W = 1280, H = 720, FPS = 30, PER_PLY = 2; // seconds each position is on screen
const BOARD = { x: 80, y: 40, size: 640 };
const START_CLOCK = 75, LOW = 30, MAX_PLIES = 64;

// a small seeded random, so the fixtures come out the same every time
function rng(seed) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function makeGame(engine, { blunders, seed }) {
  const random = rng(seed), game = new Chess(), plies = [], clock = { w: START_CLOCK, b: START_CLOCK };
  let lowMoves = 0;
  while (!game.isGameOver() && plies.length < MAX_PLIES) {
    const color = game.turn(), fen = game.fen();
    const think = color === 'w' ? 1.5 + random() * 2.5 : 0.8 + random() * 1.5;
    let move = null, planted = false;
    if (blunders && color === 'w' && clock.w < LOW && lowMoves++ % 2 === 0) {
      // the move that throws away 250 or more centipawns by the least: a hung piece rather than a random one
      const best = R.asCp(await engine.evaluate(fen, { depth: 8 }));
      const options = [];
      for (const m of game.moves({ verbose: true })) {
        game.move(m);
        options.push({ m, loss: best - R.asCp(await engine.evaluate(game.fen(), { depth: 8 })) });
        game.undo();
      }
      const bad = options.filter((o) => o.loss >= 250 && o.loss < 5000).sort((a, b) => a.loss - b.loss)[0] || options.sort((a, b) => b.loss - a.loss)[0];
      move = bad.m; planted = true;
    } else {
      const uci = (await engine.evaluate(fen, { depth: 8 })).best;
      move = { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] };
    }
    const m = game.move(move);
    clock[color] = Math.max(1, clock[color] - think);
    plies.push({ san: m.san, from: m.from, to: m.to, color, fen: game.fen(), clockWhite: +clock.w.toFixed(1), clockBlack: +clock.b.toFixed(1), planted });
  }
  const scored = await R.scoreGame(engine, new Chess().fen(), plies, { depth: 12 });
  // the position before ply k shows from k * PER_PLY; ply k lands at (k + 1) * PER_PLY
  return scored.map((p, k) => ({ ply: k + 1, t: (k + 1) * PER_PLY, ...p, before: p.before, after: p.after }));
}

// The frame for time t: the board after every ply that has landed, the last move highlighted, and both clocks running
// down for the side to move. Kept as plain code so the page can run it.
function drawScene(g, t, T) {
  const { board, plies, W, H, per, start } = T, s = board.size / 8;
  const k = Math.min(plies.length, Math.floor(t / per)); // plies on the board
  const fen = k ? plies[k - 1].fen : start, rows = fen.split(' ')[0].split('/');
  g.fillStyle = '#302e2b'; g.fillRect(0, 0, W, H);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    g.fillStyle = (r + c) % 2 ? '#769656' : '#eeeed2';
    g.fillRect(board.x + c * s, board.y + r * s, s, s);
  }
  const last = k ? plies[k - 1] : null, at = (sq) => [board.x + (sq.charCodeAt(0) - 97) * s, board.y + (8 - +sq[1]) * s];
  if (last) for (const sq of [last.from, last.to]) { const [x, y] = at(sq); g.fillStyle = 'rgba(255, 235, 59, 0.45)'; g.fillRect(x, y, s, s); }
  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `${Math.round(s * 0.78)}px "Apple Symbols", "Segoe UI Symbol", "DejaVu Sans", serif`;
  rows.forEach((row, r) => {
    let c = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { c += +ch; continue; }
      const x = board.x + c * s + s / 2, y = board.y + r * s + s * 0.53, white = ch === ch.toUpperCase();
      g.lineWidth = 3; g.strokeStyle = white ? '#1b1b1b' : '#000'; g.fillStyle = white ? '#fafafa' : '#141414';
      g.strokeText(GLYPH[ch.toLowerCase()], x, y); g.fillText(GLYPH[ch.toLowerCase()], x, y);
      c++;
    }
  });
  // clocks: the side to move runs down over this ply's time on screen
  const prev = k ? plies[k - 1] : { clockWhite: T.clock, clockBlack: T.clock }, next = plies[k];
  const frac = Math.min(1, (t - k * per) / per);
  const clockOf = (side) => { const a = side === 'w' ? prev.clockWhite : prev.clockBlack, b = next ? (side === 'w' ? next.clockWhite : next.clockBlack) : a; return a + (b - a) * frac; };
  const mmss = (v) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
  const panel = (y, name, v, toMove) => {
    g.fillStyle = toMove ? '#f0f0f0' : '#262421'; g.fillRect(780, y, 240, 72);
    g.fillStyle = toMove ? '#111' : '#bbb'; g.textAlign = 'left'; g.font = 'bold 44px "SF Mono", Menlo, monospace'; g.fillText(mmss(v), 800, y + 38);
    g.fillStyle = '#ddd'; g.font = '22px sans-serif'; g.fillText(name, 780, y - 18);
  };
  const turn = (k ? plies[k - 1].fen : start).split(' ')[1];
  panel(90, 'Opponent', clockOf('b'), turn === 'b' && !!next);
  panel(560, 'You', clockOf('w'), turn === 'w' && !!next);
}

const engine = R.createNodeEngine();
const games = { 'chess-blunders.mp4': await makeGame(engine, { blunders: true, seed: 7 }), 'chess-clean.mp4': await makeGame(engine, { blunders: false, seed: 7 }) };
engine.quit();

const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>fixture</title>'); }).listen(0);
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const truth = { board: BOARD, perPly: PER_PLY, startClock: START_CLOCK, lowClock: LOW, player: 'w', recordings: {} };
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  for (const [name, plies] of Object.entries(games)) {
    const T = { board: BOARD, plies: plies.map((p) => ({ fen: p.fen, from: p.from, to: p.to, clockWhite: p.clockWhite, clockBlack: p.clockBlack })), W, H, per: PER_PLY, start: new Chess().fen(), clock: START_CLOCK };
    const duration = (plies.length + 2) * PER_PLY;
    const made = await page.evaluate(async ({ T, scene, duration, FPS }) => {
      const M = await import('https://cdn.jsdelivr.net/npm/mediabunny@1.61.0/dist/bundles/mediabunny.min.mjs');
      const draw = new Function(`return (${scene})`)();
      const avc = await M.canEncodeVideo('avc', { width: T.W, height: T.H });
      const canvas = new OffscreenCanvas(T.W, T.H), g = canvas.getContext('2d');
      const output = new M.Output({ format: avc ? new M.Mp4OutputFormat() : new M.WebMOutputFormat(), target: new M.BufferTarget() });
      const source = new M.CanvasSource(canvas, { codec: avc ? 'avc' : 'vp8', quality: M.QUALITY_HIGH, keyFrameInterval: 2 });
      output.addVideoTrack(source, { frameRate: FPS });
      await output.start();
      for (let i = 0; i < duration * FPS; i++) { draw(g, i / FPS, T); await source.add(i / FPS, 1 / FPS); }
      await output.finalize();
      const bytes = new Uint8Array(output.target.buffer);
      let bin = '';
      for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
      return { ext: avc ? 'mp4' : 'webm', data: btoa(bin) };
    }, { T, scene: drawScene.toString(), duration, FPS });
    const file = path.join(out, name.replace(/\.mp4$/, `.${made.ext}`));
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(file, Buffer.from(made.data, 'base64'));
    truth.recordings[path.basename(file)] = { duration, moves: plies, planted: plies.filter((p) => p.planted).map((p) => ({ ply: p.ply, t: p.t, san: p.san, loss: p.loss, clockWhite: p.clockWhite })) };
    const own = plies.filter((p) => p.color === 'w');
    console.log(`${path.basename(file)}: ${plies.length} plies, ${duration} s; White's blunders ${own.filter((p) => p.grade === 'blunder').length}, mistakes ${own.filter((p) => p.grade === 'mistake').length}, planted ${own.filter((p) => p.planted).length}; ${plies.at(-1).san}`);
  }
  fs.writeFileSync(path.join(out, 'chess-truth.json'), JSON.stringify(truth, null, 2));
} finally {
  await browser.close();
  server.close();
}
