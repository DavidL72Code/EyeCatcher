// Live check against the real Gemini API on the synthetic match (npm run fixture first). Spends about 25 requests:
// learning the game, one upload, one scan, one head box per duel, and one full review. Reports what each piece measured against the
// fixture's ground truth and saves the details to tests/out/. Synthetic footage, so it checks the pipeline, not
// accuracy on real game video.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const truth = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/truth.json'), 'utf8'));
const PORT = 5199;
const dev = spawn(process.execPath, [path.join(root, 'scripts/dev.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/`);
  if (!(await page.evaluate(() => window.Gemini.hasKey()))) throw new Error('No Gemini key: put GEMINI_API_KEY in thirdeye/.env');
  const report = await page.evaluate(async ({ truth }) => {
    const C = window.ThirdeyeCore, V = window.ThirdeyeVideo, A = window.ThirdeyeAgent;
    const clock = () => performance.now();
    const out = {};
    const blob = await (await fetch(`tests/fixtures/${truth.file}`)).blob();
    const video = await V.open(new File([blob], truth.file, { type: blob.type }));
    // the game is learned from the recording, as in the app
    const { profile } = await window.ThirdeyeLearn.learnGame({ video });
    out.learned = { game: profile.name, genre: profile.genre, regions: Object.keys(profile.regions), habits: profile.habits.map((h) => h.id) };

    let t0 = clock();
    const proxy = await V.makeProxy(video);
    out.proxy = { seconds: +((clock() - t0) / 1000).toFixed(1), mb: +(proxy.size / 1e6).toFixed(2) };
    t0 = clock();
    const file = await V.upload(proxy, { name: 'thirdeye-live-check' });
    out.upload = { seconds: +((clock() - t0) / 1000).toFixed(1) };

    t0 = clock();
    const events = await A.scanVideo({ file, profile, from: 0, to: video.duration });
    const real = truth.duels.map((d) => ({ t: d.t + 0.6, kind: d.outcome }));
    const hit = real.map((r) => events.find((e) => e.kind === r.kind && Math.abs(e.t - r.t) <= 2));
    out.scan = {
      seconds: +((clock() - t0) / 1000).toFixed(1),
      found: hit.filter(Boolean).length, of: real.length,
      timeErrors: hit.map((h, i) => (h ? +(h.t - real[i].t).toFixed(1) : null)),
      extra: events.filter((e) => (e.kind === 'kill' || e.kind === 'death') && !real.some((r) => r.kind === e.kind && Math.abs(e.t - r.t) <= 2)).map((e) => `${C.mmss(e.t)} ${e.kind}`),
    };

    const frame = { w: video.width, h: video.height }, crop = C.regionRect(profile, 'aim', frame);
    const f = frame.w / 2 / Math.tan((103 * Math.PI) / 360); // the fixture's FOV
    const degOf = (heads) => (Math.atan((heads * truth.headPx) / f) * 180) / Math.PI;
    out.aim = [];
    for (const d of truth.duels) {
      const [shot] = await V.grab(video, [d.t + 0.3], { crop, maxDim: 1024, quality: 0.9 });
      const box = await A.findHead(shot, {});
      const m = box ? C.aimOffset({ box, crop, frame, fovH: profile.fovH || 103 }) : null; // the fixture is drawn at 103°
      out.aim.push({ t: d.t, truth: d.heads, measured: m?.heads ?? null, errHeads: m ? +(m.heads - d.heads).toFixed(2) : null, errDeg: m ? +(m.dyDeg - degOf(d.heads)).toFixed(2) : null });
    }
    const errs = out.aim.filter((a) => a.errDeg != null).map((a) => Math.abs(a.errDeg)).sort((a, b) => a - b);
    out.aimSummary = { found: errs.length, of: truth.duels.length, medianAbsErrDeg: errs.length ? errs[errs.length >> 1] : null, maxAbsErrDeg: errs.at(-1) ?? null };

    t0 = clock();
    const steps = [];
    const r = await A.review({
      video, file, profile, history: C.emptyHistory(), budget: C.createBudget({ looks: 30, turns: 30 }),
      ask: async (q) => { steps.push(`asked: ${q.question}`); return q.options?.find((o) => /^no/i.test(o)) || 'No'; },
      onStep: (s) => { if (s.type === 'call') steps.push(`${s.name} ${JSON.stringify(s.args).slice(0, 120)}`); if (s.type === 'error') steps.push(`  error: ${s.error}`); },
      onEvent: (e) => { if (e.type === 'rejected') steps.push(`  sent back: ${e.problems.join(' ')}`); },
    });
    out.review = { seconds: +((clock() - t0) / 1000).toFixed(1), found: r.found, habitId: r.habitId, habit: r.habit, evidence: r.evidence?.map((e) => C.mmss(e.t)), aim: r.aim, stats: r.stats, theories: C.boardBrief(r.board), steps };
    return out;
  }, { truth });

  fs.mkdirSync(path.join(root, 'tests/out'), { recursive: true });
  const file = path.join(root, 'tests/out', `live-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  const { proxy, upload, scan, aimSummary, review } = report;
  console.log(`Scan copy: ${proxy.mb} MB in ${proxy.seconds} s; upload ${upload.seconds} s`);
  console.log(`Scan: found ${scan.found} of ${scan.of} kills and deaths within 2 s (time errors ${scan.timeErrors.join(', ')}); extra: ${scan.extra.join(', ') || 'none'}`);
  console.log(`Aim: boxed ${aimSummary.found} of ${aimSummary.of} heads; median error ${aimSummary.medianAbsErrDeg} deg, worst ${aimSummary.maxAbsErrDeg} deg`);
  console.log(`Review: ${review.found ? `${review.habitId} (${review.habit})` : 'no habit'}, ${review.stats.turns} calls, ${review.stats.looks} looks, ${review.seconds} s; planted habit ${review.habitId === 'crosshair_low' ? 'found' : 'MISSED'}`);
  console.log(review.steps.map((s) => `  ${s}`).join('\n'));
  console.log(`Details: ${path.relative(process.cwd(), file)}`);
} finally {
  await browser.close();
  dev.kill();
}
