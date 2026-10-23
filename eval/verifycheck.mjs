// How well the agent that checks a finding against the video (agent.js verifyClaims) tells true claims from false, on
// claims labeled off the frames (eval/answer-keys/claims.json): the true ones it lets stand, the false ones it stops
// (against the video, or not shown by it), and the planted false claims it agrees with. Live: it calls Gemini.
//   node eval/verifycheck.mjs [runs] [out.json]   (CLAIMS=other.json for another set; APART=1 for an agent per claim)
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const req = createRequire(path.join(root, 'package.json'));
const { chromium } = req('playwright');
const { startServer } = await import(path.join(root, 'scripts/dev.mjs'));
const [runs = '1', outFile] = process.argv.slice(2);
const key = JSON.parse(fs.readFileSync(process.env.CLAIMS || path.join(root, 'eval/answer-keys/claims.json'), 'utf8'));
const BATCH = 4; // claims per check, as many as a finding cites

const server = await startServer({ port: 0, reload: false, env: { THIRDEYE_BACKEND: '' } });
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const rows = [], checks = [];
try {
  for (let n = 1; n <= +runs; n++) {
    for (const rec of key.recordings) {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/#coach`);
      await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'pick'; document.body.append(i); });
      await page.setInputFiles('#pick', path.join(root, 'eval/recordings', rec.file));
      for (let k = 0; k < rec.claims.length; k += BATCH) {
        const batch = rec.claims.slice(k, k + BATCH);
        const out = await page.evaluate(async ({ profile, events, claims, apart }) => {
          const V = window.ThirdeyeVideo, video = await V.open(document.querySelector('#pick').files[0]);
          return window.ThirdeyeAgent.verifyClaims({ video, profile, claims: claims.map((c) => ({ t: c.t, what: c.claim })), events, player, apart });
        }, { profile: rec.profile, events: rec.events, player: rec.player || {}, claims: batch, apart: !!process.env.APART });
        checks.push({ run: n, file: rec.file, calls: out.calls, controls: out.controls, fooled: out.fooled, unreliable: out.unreliable });
        batch.forEach((c, i) => {
          const got = out.checked[i];
          rows.push({ run: n, file: rec.file, t: c.t, claim: c.claim, truth: c.truth, verdict: got?.verdict || 'none', facts: got?.facts || [], ...(got?.why ? { why: got.why } : {}), unreliable: out.unreliable });
        });
        console.log(`run ${n} ${rec.file} ${batch.map((c) => c.t).join(' ')}: ${out.checked.map((x) => x.verdict).join(', ')} | planted ${out.controls}, fooled by ${out.fooled.length}${out.unreliable ? ', UNRELIABLE' : ''} | ${out.calls} calls`);
      }
      await page.close();
    }
  }
} finally { await browser.close(); server.close(); }

const real = rows.filter((r) => r.truth), fake = rows.filter((r) => !r.truth);
const stood = real.filter((r) => r.verdict === 'shows'), stopped = fake.filter((r) => r.verdict !== 'shows');
console.log(`\ntrue claims that stood: ${stood.length}/${real.length}`);
for (const r of real.filter((x) => x.verdict !== 'shows')) console.log(`  stopped a true one: ${r.file} ${r.t} "${r.claim}" (${r.verdict}: ${(r.facts.find((f) => f.verdict !== 'shows') || {}).saw || `no verdict: ${r.why || '?'}`})`);
console.log(`false claims stopped: ${stopped.length}/${fake.length} (against the video ${fake.filter((r) => r.verdict === 'goes_against').length}, not shown ${fake.filter((r) => r.verdict === 'cant_tell').length})`);
for (const r of fake.filter((x) => x.verdict === 'shows')) console.log(`  let a false one stand: ${r.file} ${r.t} "${r.claim}" (${r.facts.map((f) => f.saw).join('; ')})`);
console.log(`planted false claims agreed with: ${checks.reduce((n, c) => n + c.fooled.length, 0)} of ${checks.reduce((n, c) => n + c.controls, 0)}; unreliable checks ${checks.filter((c) => c.unreliable).length} of ${checks.length}; ${checks.reduce((n, c) => n + c.calls, 0)} calls`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ about: 'eval/verifycheck.mjs on eval/answer-keys/claims.json', rows, checks }, null, 1));
