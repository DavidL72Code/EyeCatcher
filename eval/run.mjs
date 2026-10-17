// Evaluation (PLAN.md, Evaluation): for each recording in eval/recordings.json, runs the agent, the fixed pipeline
// (eval/pipeline.js), and Gemini's own agentic video mode (eval/gemini-agentic.js) on the same uploaded scan copy, and
// scores each against the planted habit, or against "no habit" on a clean control. Real Chrome, the real Gemini API,
// the key from thirdeye/.env. Writes eval/results-<date>.json and prints a table.
// About 27 requests per recording on the synthetic match; EVAL_MAX_CALLS (default 80) caps model calls per recording.
// npm run eval -- <text> runs only the recordings whose file name contains <text>; EVAL_SYSTEMS=pipeline,agent runs only those.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const PORT = 5198; // the live check uses 5199
const BUDGET = { looks: 30, turns: 30 }; // the agent's, and the pipeline gets the same looks
const MAX_CALLS = +(process.env.EVAL_MAX_CALLS || 80);
const SYSTEMS = ['agent', 'pipeline', 'gemini-agentic'].filter((s) => !process.env.EVAL_SYSTEMS || process.env.EVAL_SYSTEMS.split(',').includes(s));
const NEAR_DUEL = 2; // seconds: an evidence time this close to a real duel counts as on it

const only = process.argv.slice(2);
const recordings = JSON.parse(fs.readFileSync(path.join(here, 'recordings.json'), 'utf8'))
  .filter((r) => !only.length || only.some((o) => r.file.includes(o)));
if (!recordings.length) throw new Error('No recordings to run: check eval/recordings.json and the filter.');
if (!SYSTEMS.length) throw new Error('EVAL_SYSTEMS names none of: agent, pipeline, gemini-agentic.');

const dev = spawn(process.execPath, [path.join(root, 'scripts/dev.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { if (await fetch(`http://localhost:${PORT}/`).then((r) => r.ok, () => false)) break; await new Promise((r) => setTimeout(r, 100)); }

// Every request to Gemini, by phase, so each system's model calls are counted from the network, retries included.
let phase = 'setup', calls = 0;
const traffic = new Map();
const kindOf = (u, method) => (/:generateContent$/.test(u.pathname) ? 'generate' : /\/interactions$/.test(u.pathname) && method === 'POST' ? 'interaction' : /\/interactions\//.test(u.pathname) ? 'poll' : /\/files/.test(u.pathname) ? 'files' : 'other');
const isModelCall = (u, method) => method === 'POST' && ['generate', 'interaction'].includes(kindOf(u, method));
function usage(p) {
  const all = [...traffic.values()].filter((x) => x.phase === p), list = all.filter((x) => !x.blocked);
  const models = {};
  for (const x of list) if (x.model) models[x.model] = (models[x.model] || 0) + 1;
  return {
    calls: list.filter((x) => ['generate', 'interaction'].includes(x.kind)).length,
    polls: list.filter((x) => x.kind === 'poll').length,
    files: list.filter((x) => x.kind === 'files').length,
    rateLimited: list.filter((x) => x.status === 429).length,
    failed: list.filter((x) => x.status >= 400 && x.status !== 429).length,
    blocked: all.filter((x) => x.blocked).length,
    models,
  };
}

const compact = (names) => names.reduce((out, n) => { const last = out.at(-1); if (last?.n === n) last.k++; else out.push({ n, k: 1 }); return out; }, []).map(({ n, k }) => (k > 1 ? `${n} x${k}` : n)).join(' > ');
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// The scan's kills and deaths against hand labels: found within NEAR_DUEL seconds, and ones with no real event near.
function scanRecall(events, truth) {
  const of = (kind, real) => {
    const got = events.filter((e) => e.kind === kind);
    const hit = real.filter((t) => got.some((e) => Math.abs(e.t - t) <= NEAR_DUEL)).length;
    const extra = got.filter((e) => !real.some((t) => Math.abs(e.t - t) <= NEAR_DUEL)).map((e) => mmss(e.t));
    return { found: `${hit}/${real.length}`, extra };
  };
  return { kills: of('kill', truth.kills), deaths: of('death', truth.deaths) };
}

function score(r, rec) {
  if (!r || r.error || r.refused || r.unparsed) return { verdict: r?.refused ? 'refused' : 'no result', counted: false };
  if (rec.plantedHabit) {
    const hit = r.found && r.habitId === rec.plantedHabit;
    return { verdict: hit ? 'found' : r.found ? `wrong: ${r.habitId}` : r.stopped ? 'missed (out of turns)' : 'missed', hit, counted: true };
  }
  return { verdict: r.found ? `false positive: ${r.habitId}` : 'clean', falsePositive: !!r.found, counted: true };
}

// how many cited moments sit on a real duel, when the recording comes with a truth file
function onDuels(evidence, truth) {
  if (!truth?.duels || !evidence?.length) return null;
  const near = evidence.filter((e) => truth.duels.some((d) => Math.abs(e.t - d.t) <= NEAR_DUEL)).length;
  return `${near}/${evidence.length}`;
}

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const started = new Date();
const out = { started: started.toISOString(), budget: BUDGET, maxCallsPerRecording: MAX_CALLS, recordings: [] };
try {
  const page = await browser.newPage();
  // a file saved in this folder mid-run (by this runner or anyone else) must not reload the page under a review
  await page.route('**/__reload', (r) => r.abort());
  // only model calls go through the cap; the scan copy's upload is never intercepted
  await page.route((u) => u.hostname === 'generativelanguage.googleapis.com' && /:generateContent$|\/interactions$/.test(u.pathname), (route) => {
    const req = route.request(), u = new URL(req.url());
    if (isModelCall(u, req.method()) && ++calls > MAX_CALLS) { traffic.set(req, { ...(traffic.get(req) || { phase, kind: kindOf(u, req.method()) }), blocked: true }); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.hostname !== 'generativelanguage.googleapis.com' || req.method() === 'OPTIONS' || traffic.has(req)) return;
    const kind = kindOf(u, req.method());
    const model = kind === 'generate' ? decodeURIComponent(/\/models\/([^/:]+):/.exec(u.pathname)[1]) : kind === 'interaction' ? JSON.parse(req.postData() || '{}').model : null;
    traffic.set(req, { phase, kind, model });
  });
  page.on('response', (res) => { const x = traffic.get(res.request()); if (x) x.status = res.status(); });

  await page.goto(`http://localhost:${PORT}/`);
  await page.addScriptTag({ url: '/eval/pipeline.js' });
  await page.addScriptTag({ url: '/eval/gemini-agentic.js' });
  if (!(await page.evaluate(() => window.Gemini.hasKey()))) throw new Error('No Gemini key: put GEMINI_API_KEY in thirdeye/.env');
  await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'eval-file'; i.hidden = true; document.body.append(i); });

  for (const [n, rec] of recordings.entries()) {
    const file = path.resolve(here, rec.file);
    const row = { file: rec.file, plantedHabit: rec.plantedHabit ?? null, systems: {} };
    out.recordings.push(row);
    console.log(`\n[${n + 1}/${recordings.length}] ${rec.file} (planted: ${rec.plantedHabit || 'none, clean control'})`);
    if (!fs.existsSync(file)) { row.skipped = `missing file ${file}${/fixtures/.test(file) ? ' (npm run fixture makes it)' : ''}`; console.log(`  skipped: ${row.skipped}`); continue; }
    const truth = rec.truth ? JSON.parse(fs.readFileSync(path.resolve(here, rec.truth), 'utf8')) : null;
    calls = 0;

    phase = `${n}:setup`;
    await page.setInputFiles('#eval-file', file);
    try {
      row.setup = await page.evaluate(async ({ game, name }) => {
        const V = window.ThirdeyeVideo, clock = () => performance.now();
        const profile = await (await fetch(`games/${game}.json`)).json();
        const video = await V.open(document.getElementById('eval-file').files[0]);
        let t0 = clock();
        const proxy = await V.makeProxy(video);
        const proxySeconds = (clock() - t0) / 1000;
        t0 = clock();
        const file = await V.upload(proxy, { name });
        window.__eval = { video, file, profile };
        return { duration: +video.duration.toFixed(1), size: `${video.width}x${video.height}`, proxyMb: +(proxy.size / 1e6).toFixed(2), proxySeconds: +proxySeconds.toFixed(1), uploadSeconds: +((clock() - t0) / 1000).toFixed(1) };
      }, { game: rec.game || 'valorant', name: `thirdeye-eval-${path.basename(file)}` });
    } catch (e) {
      row.setup = { error: e.message };
    }
    row.setup.usage = usage(phase);
    if (row.setup.error) { console.log(`  setup failed: ${row.setup.error}`); continue; }
    console.log(`  scan copy ${row.setup.proxyMb} MB in ${row.setup.proxySeconds} s, uploaded in ${row.setup.uploadSeconds} s`);

    const runs = {
      agent: () => page.evaluate(async (budget) => {
        const C = window.ThirdeyeCore, A = window.ThirdeyeAgent, { video, file, profile } = window.__eval;
        const steps = [], asks = [], rejected = [], t0 = performance.now();
        try {
          const r = await A.review({
            video, file, profile, history: C.emptyHistory(), budget: C.createBudget(budget),
            ask: async (q) => { asks.push(q.question); return ''; }, // no player in an eval: every question is skipped
            onStep: (s) => {
              if (s.type === 'call') steps.push({ name: s.name, args: JSON.stringify(s.args).slice(0, 160) });
              if (s.type === 'error') steps.push({ name: s.name, error: s.error });
            },
            onEvent: (e) => { if (e.type === 'rejected') rejected.push(e.problems); },
          });
          return {
            found: r.found, habitId: r.habitId ?? null, habit: r.habit || '', why: r.why, stopped: !!r.stopped, confidence: r.confidence,
            evidence: (r.evidence || []).map((e) => ({ t: e.t, what: e.what })), contrast: r.contrast || [], aim: r.aim, measures: r.measures.map((m) => ({ t: m.t, heads: m.heads, band: m.band, headPx: m.headPx, box: m.box })),
            looks: r.stats.looks, turns: r.stats.turns, events: (r.events || []).map((e) => ({ t: e.t, kind: e.kind })),
            theories: C.boardBrief(r.board), asks, rejected, steps, seconds: (performance.now() - t0) / 1000,
          };
        } catch (e) {
          return { error: String(e.message || e), asks, rejected, steps, seconds: (performance.now() - t0) / 1000 };
        }
      }, BUDGET),
      pipeline: () => page.evaluate(async (looks) => {
        const { video, file, profile } = window.__eval, steps = [], t0 = performance.now();
        try {
          const r = await window.ThirdeyePipeline.run({ video, file, profile, looks, onStep: (s) => steps.push({ name: s.name, args: JSON.stringify(s.args) }) });
          return { found: r.found, habitId: r.habitId, evidence: r.evidence, aim: r.aim, measures: r.measures, deaths: r.stats.deaths, looks: r.stats.looks, events: (r.events || []).map((e) => ({ t: e.t, kind: e.kind })), steps, seconds: (performance.now() - t0) / 1000 };
        } catch (e) {
          return { error: String(e.message || e), steps, seconds: (performance.now() - t0) / 1000 };
        }
      }, BUDGET.looks),
      'gemini-agentic': () => page.evaluate(async () => {
        const { video, file, profile } = window.__eval, t0 = performance.now();
        try {
          const r = await window.ThirdeyeGeminiAgentic.run({ file, profile, duration: video.duration });
          return { ...r, seconds: (performance.now() - t0) / 1000 };
        } catch (e) {
          return { error: String(e.message || e), seconds: (performance.now() - t0) / 1000 };
        }
      }),
    };

    for (const name of SYSTEMS) {
      phase = `${n}:${name}`;
      process.stdout.write(`  ${name}... `);
      const r = await runs[name]();
      r.seconds = +r.seconds.toFixed(1);
      r.usage = usage(phase);
      r.score = score(r, rec);
      if (truth) r.evidenceOnDuels = onDuels(r.evidence, truth);
      if (truth?.kills && r.events?.length) r.scanRecall = scanRecall(r.events, truth);
      row.systems[name] = r;
      console.log(`${r.score.verdict}${r.error ? ` (${r.error})` : r.refused ? ` (${r.status ?? r.stage}: ${r.error})` : ''}, ${r.usage.calls} calls${r.usage.blocked ? ` (${r.usage.blocked} more blocked by EVAL_MAX_CALLS)` : ''}, ${r.seconds} s`);
    }
  }
} finally {
  await browser.close();
  dev.kill();
}

// ---- summary, results file, table ----
out.finished = new Date().toISOString();
out.summary = {};
for (const name of SYSTEMS) {
  const rs = out.recordings.map((r) => ({ r: r.systems[name], rec: r })).filter((x) => x.r);
  const planted = rs.filter((x) => x.rec.plantedHabit && x.r.score.counted), controls = rs.filter((x) => !x.rec.plantedHabit && x.r.score.counted);
  out.summary[name] = {
    plantedFound: `${planted.filter((x) => x.r.score.hit).length}/${planted.length}`,
    falsePositives: `${controls.filter((x) => x.r.score.falsePositive).length}/${controls.length}`,
    noResult: rs.filter((x) => !x.r.score.counted).length,
    calls: rs.reduce((s, x) => s + x.r.usage.calls, 0),
    seconds: +rs.reduce((s, x) => s + x.r.seconds, 0).toFixed(1),
  };
}
const setupCalls = out.recordings.reduce((s, r) => s + (r.setup?.usage?.files || 0), 0);
out.totals = { modelCalls: Object.values(out.summary).reduce((s, x) => s + x.calls, 0), uploadRequests: setupCalls, models: {} };
for (const x of traffic.values()) if (x.model && !x.blocked) out.totals.models[x.model] = (out.totals.models[x.model] || 0) + 1;

const date = started.toLocaleDateString('en-CA'); // YYYY-MM-DD, local
let dest = path.join(here, `results-${date}.json`);
for (let k = 2; fs.existsSync(dest); k++) dest = path.join(here, `results-${date}-${k}.json`);
fs.writeFileSync(dest, JSON.stringify(out, null, 2));

const cols = [['Recording', 22], ['Planted', 14], ['System', 15], ['Habit found', 15], ['Score', 22], ['Calls', 6], ['Looks', 6], ['Secs', 6], ['On duels', 8]];
const line = (cells) => cells.map((c, i) => String(c ?? '').slice(0, cols[i][1]).padEnd(cols[i][1])).join(' ').trimEnd();
console.log(`\n${line(cols.map((c) => c[0]))}\n${'-'.repeat(cols.reduce((s, c) => s + c[1] + 1, 0))}`);
for (const r of out.recordings) {
  if (r.skipped || r.setup?.error) { console.log(line([path.basename(r.file), r.plantedHabit || 'none', '-', '-', r.skipped ? 'skipped' : 'setup failed'])); continue; }
  SYSTEMS.forEach((name, i) => {
    const s = r.systems[name];
    const looks = s.looks ?? '-';
    console.log(line([i ? '' : path.basename(r.file), i ? '' : r.plantedHabit || 'none', name, s.found ? s.habitId : s.score.counted ? 'none' : '-', s.score.verdict, s.usage.calls, looks, s.seconds, s.evidenceOnDuels ?? '-']));
  });
}
console.log('\nPer system: planted habits found, false positives on clean controls, model calls');
for (const [name, s] of Object.entries(out.summary)) console.log(`  ${name.padEnd(15)} found ${s.plantedFound}, false positives ${s.falsePositives}${s.noResult ? `, ${s.noResult} with no result` : ''}, ${s.calls} calls, ${s.seconds} s`);
for (const r of out.recordings) for (const [name, s] of Object.entries(r.systems)) if (s.scanRecall) console.log(`Scan vs hand labels (${name}, ${path.basename(r.file)}): kills ${s.scanRecall.kills.found}, deaths ${s.scanRecall.deaths.found}; not real: ${[...s.scanRecall.kills.extra.map((t) => `${t} kill`), ...s.scanRecall.deaths.extra.map((t) => `${t} death`)].join(', ') || 'none'}`);
if (SYSTEMS.includes('agent')) console.log('\nAgent tool sequences');
for (const r of out.recordings) if (r.systems.agent) console.log(`  ${path.basename(r.file)}: ${compact(r.systems.agent.steps.filter((s) => !s.error).map((s) => s.name)) || '(none)'}`);
const models = Object.entries(out.totals.models).map(([m, k]) => `${m} x${k}`).join(', ');
for (const r of out.recordings) { const g = r.systems['gemini-agentic']; if (g?.tokens) console.log(`Gemini agentic on ${path.basename(r.file)}: ${g.tokens.total_tokens ?? '?'} tokens, ${g.looks} processing calls`); }
console.log(`\nGemini: ${out.totals.modelCalls} model calls (${models || 'none'}), plus ${out.totals.uploadRequests} upload requests and ${out.recordings.reduce((s, r) => s + (r.systems['gemini-agentic']?.usage?.polls || 0), 0)} status polls`);
if (Object.keys(out.totals.models).some((m) => !/flash-lite/.test(m))) console.log('  Note: some calls fell back to a model that is not Flash-Lite.');
if (!out.recordings.some((r) => !r.plantedHabit)) console.log('  No clean controls in this set, so false positives are untested.');
console.log(`Results: ${path.relative(process.cwd(), dest)}`);
