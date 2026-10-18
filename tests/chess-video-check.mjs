// Reads the moves of the synthetic chess recordings back from video (chess-reader.js: findBoard from a rough box,
// readMoves) and checks them against tests/fixtures/chess-truth.json; then scores a few positions with Stockfish in the
// browser. No model calls. npm run fixture:chess first.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const truth = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/chess-truth.json'), 'utf8'));
const PORT = 5187;
const dev = spawn(process.execPath, [path.join(root, 'scripts/dev.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${PORT}/`).then((r) => r.ok, () => false)) break; await new Promise((r) => setTimeout(r, 100)); }
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
let bad = 0;
try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'f'; i.hidden = true; document.body.append(i); });
  for (const [name, rec] of Object.entries(truth.recordings)) {
    await page.setInputFiles('#f', path.join(root, 'tests/fixtures', name));
    // a rough box, as the learn call might draw it: 3% off and 4% too big
    const b = truth.board, rough = { x: b.x - b.size * 0.03, y: b.y + b.size * 0.02, w: b.size * 1.04, h: b.size * 1.04 };
    const r = await page.evaluate(async ({ rough }) => {
      const X = window.ThirdeyeChess, V = window.ThirdeyeVideo, Chess = await X.loadChess();
      const video = await V.open(document.getElementById('f').files[0]);
      const [shot] = await V.grab(video, [0.5], { maxDim: 4096 });
      const img = await new Promise((res) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); res(c.getContext('2d').getImageData(0, 0, im.width, im.height)); }; im.src = shot.url; });
      const rect = X.findBoard(img, rough);
      const t0 = performance.now();
      const read = await X.readMoves({ video, rect, Chess });
      return { rect, seconds: +((performance.now() - t0) / 1000).toFixed(1), ...read };
    }, { rough });
    const want = rec.moves.map((m) => m.san), got = (r.moves || []).map((m) => m.san);
    const right = want.filter((s, i) => got[i] === s).length;
    const late = (r.moves || []).map((m, i) => (rec.moves[i] ? +(m.t - rec.moves[i].t).toFixed(2) : null)).filter((x) => x != null);
    if (right !== want.length) bad++;
    console.log(`${name}: board found at ${JSON.stringify(r.rect)} (truth ${JSON.stringify(b)}), ${r.flipped ? 'flipped' : 'White at the bottom'}; read ${right}/${want.length} moves in order${r.error ? `; error: ${r.error}` : ''}, ${r.unmatched} unmatched boards, ${r.seconds} s; time after the move landed: ${Math.min(...late)} to ${Math.max(...late)} s`);
    if (right !== want.length) console.log(`  first difference at ply ${want.findIndex((s, i) => got[i] !== s) + 1}: wanted ${want.slice(0, 40).join(' ')}\n  got ${got.slice(0, 40).join(' ')}`);
  }
  const scored = await page.evaluate(async () => {
    const X = window.ThirdeyeChess, engine = X.createEngine();
    const r = await X.scoreGame(engine, X.STANDARD, [{ fen: 'rnbqkbnr/pppppppp/8/8/8/5P2/PPPPP1PP/RNBQKBNR b KQkq - 0 1', color: 'w' }, { fen: 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2', color: 'b' }, { fen: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2', color: 'w' }], { depth: 10 });
    engine.quit();
    return r.map((p) => `${p.loss} ${p.grade}`);
  });
  console.log(`Stockfish in the browser, f3 e5 g4: ${scored.join(' | ')}`);
  if (!/blunder/.test(scored[2])) bad++;
} finally { await browser.close(); dev.kill(); }
console.log(bad ? `\n${bad} failed` : '\nall moves read and scored');
process.exit(bad ? 1 : 0);
