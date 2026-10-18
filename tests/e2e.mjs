// End-to-end test for Thirdeye in Chrome on the synthetic match (npm run fixture makes it). Gemini and the Files API
// are intercepted and answered with TEST FIXTURES shaped like real responses, so this checks the app's wiring, the
// video pipeline, and the code checks, not the model's judgment. Mediabunny loads from jsDelivr, so it needs network.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = createRequire(import.meta.url)('../core.js');
const truth = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/truth.json'), 'utf8'));
const fixture = path.join(root, 'tests/fixtures', truth.file);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp4': 'video/mp4' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/env.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end('window.__ENV__ = { GEMINI_API_KEY: "TEST" };'); }
  const p = path.join(root, u === '/' ? 'index.html' : u);
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  res.end(fs.readFileSync(p));
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const fail = [];
const check = (c, m) => { if (!c) { fail.push(m); console.log('  FAIL -', m); } else console.log('  ok -', m); };

// ---- fixtures (test only) ----
const CROP = { x: 384, y: 158, w: 512, h: 403 }; // the Valorant profile's aim region on a 1280x720 frame
const headBox = (heads) => {
  const cx = 690, cy = truth.height / 2 - heads * truth.headPx, r = truth.headPx / 2;
  return [(cy - r - CROP.y) / CROP.h * 1000, (cx - r - CROP.x) / CROP.w * 1000, (cy + r - CROP.y) / CROP.h * 1000, (cx + r - CROP.x) / CROP.w * 1000];
};
const scanEvents = [
  ...truth.rounds.map((t) => ({ t: C.mmss(t), kind: 'round_start', text: 'Round starts' })),
  ...truth.duels.map((d) => ({ t: C.mmss(Math.round(d.t + 0.6)), kind: d.outcome, text: d.outcome === 'kill' ? `You killed ${d.enemy}` : `Killed by ${d.enemy}` })),
];
const call = (...calls) => ({ candidates: [{ content: { role: 'model', parts: calls.map(([name, args]) => ({ functionCall: { name, args } })) } }] });
const text = (s) => ({ candidates: [{ content: { role: 'model', parts: [{ text: typeof s === 'string' ? s : JSON.stringify(s) }] } }] });
const lastResults = (b) => [...b.contents].reverse().find((c) => c.parts?.some((p) => p.functionResponse))?.parts.filter((p) => p.functionResponse).map((p) => p.functionResponse) || [];
const ev = (t, what) => ({ t, what });

// The coach's turns, in order. The run's heads differ so the second review can be compared with the first.
let heads = [];
const FINDING = { found: true, habit_id: 'crosshair_low', habit: 'Crosshair below head level', why: 'Your crosshair sat at chest height when enemies appeared, so they shot first.', drill: 'Ten minutes walking corners in a custom game with the crosshair at head height.', recheck: 'Measure first sight in five duels.' };
const EVIDENCE = [ev('0:13.8', 'Chest height as Enemy 1 appears'), ev('0:46.8', 'Same at the doorway'), ev('2:13.6', 'Again before the last death')];
const coach = [
  () => call(['scan', { from: '0:00', to: '2:30', why: 'every fight in the match' }]),
  () => call(['measure_aim', { at: '0:13.8', why: 'crosshair height before the first death' }]),
  () => call(['ask_player', { question: 'Did you expect someone at that corner?', at: '0:14', options: ['Yes', 'No'], why: 'whether that angle was a surprise', notes: [{ theory: 'Crosshair sits low', status: 'testing', evidence: [ev('0:13.8', 'chest height at first sight')] }] }]),
  () => call(['measure_aim', { at: '0:46.8', more: ['2:13.6', '2:15'], why: 'the same before the other deaths' }]),
  () => call(['finish', { ...FINDING, evidence: [...EVIDENCE.slice(0, 2), ev('1:30', 'never looked here')] }]),
  () => call(['finish', { ...FINDING, evidence: EVIDENCE }]),
  () => call(['frames', { at: '0:31', before: 1, after: 0.5, fps: 4, region: 'aim', why: 'a fight they won' }]),
  () => call(['measure_aim', { at: '0:30.6', why: 'aim in the fight they won', notes: [{ id: 'T1', status: 'supported', evidence: [ev('0:31', 'on the head in a fight they won')] }] }]),
  () => call(['finish', { ...FINDING, progress: 'unclear', evidence: EVIDENCE, contrast: [ev('0:31', 'On the head, and the fight was won')] }]),
];
const seen = { agentBodies: [], scans: 0, heads: 0, headCalls: [], feedCalls: 0, uploads: 0, starts: 0 };

function gemini(body) {
  const parts = body.contents?.[0]?.parts || [];
  if (parts.some((p) => p.fileData)) { seen.scans++; seen.scanBody = body; return text({ events: scanEvents }); }
  const prompt = parts.map((p) => p.text || '').join(' ');
  // the synthetic kill feed's names aren't known here, so the scan falls back to the low-detail pass
  if (!body.tools && /kill feed/.test(prompt)) { seen.feedCalls++; return text({ rows: [] }); }
  if (!body.tools) {
    const n = parts.filter((p) => p.inlineData).length;
    seen.headCalls.push(n);
    return text({ images: Array.from({ length: n }, (_, i) => { const b = headBox(heads[seen.heads++ % heads.length]); return { image: i + 1, enemies: [{ head_2d: [0, 950, 40, 990], body_2d: [600, 0, 700, 20] }, { head_2d: b, body_2d: [b[0], b[1] - 10, b[2] + 200, b[3] + 10] }] }; }) });
  }
  seen.agentBodies.push(body);
  const turn = body.contents.filter((c) => c.role === 'model').length;
  return (coach[turn] || coach.at(-1))();
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Expose-Headers': 'x-goog-upload-url' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const req = route.request(), url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.includes('/upload/v1beta/files')) {
      seen.starts++;
      return route.fulfill({ status: 200, headers: { ...cors, 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload-session/1' }, body: '{}' });
    }
    if (url.includes('/upload-session/')) {
      seen.uploads++;
      seen.uploadBytes = req.postDataBuffer()?.length || 0;
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ file: { name: 'files/test', uri: 'https://generativelanguage.googleapis.com/v1beta/files/test', mimeType: 'video/webm', state: 'ACTIVE' } }) });
    }
    if (url.includes(':generateContent')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(gemini(JSON.parse(req.postData()))) });
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });

  console.log('start screen');
  await page.goto(base);
  check(await page.locator('h1').innerText() === "FIND THE HABIT THAT'S\nLOSING YOU FIGHTS.", 'headline renders');
  check(await page.locator('#keyBox').isHidden(), 'no key box when .env has a key');
  check(await page.locator('#working').isHidden(), 'no habit chip on a first visit');

  console.log('first review');
  heads = [2.2, 2.0, 2.3];
  await page.fill('#goal', 'I lose the first duel a lot');
  await page.setInputFiles('#fileInput', fixture);
  await page.waitForSelector('#review:not([hidden])');
  await page.waitForSelector('.question:not([hidden])', { timeout: 60000 });
  check(await page.locator('#statusText').innerText() === 'Waiting for you', 'status line waits for the player');
  check(await page.locator('.question p').innerText() === 'Did you expect someone at that corner?', 'the question shows');
  check(seen.uploads === 1 && seen.uploadBytes > 50000 && seen.uploadBytes < 5e6, `the scan copy was uploaded once (${seen.uploadBytes} bytes)`);
  check(seen.scanBody?.contents[0].parts[0].videoMetadata?.startOffset === '0s' && seen.scanBody.generationConfig.mediaResolution === 'MEDIA_RESOLUTION_LOW', 'scan clips the copy and asks for low resolution');
  const ticks = await page.locator('.tick').count();
  check(ticks === truth.duels.length, `timeline shows every kill and death (${ticks})`);
  check(await page.locator('.round').count() === truth.rounds.length, 'timeline shows the rounds');
  check(await page.locator('.theory.testing').count() === 1, 'the board shows a theory being tested');
  check(await page.locator('.beat').first().locator('.beat-kind').innerText() === 'Question' && await page.locator('.beat').count() === 3, 'the breakdown has a card per step, newest first');
  check(await page.locator('.beat.scan .beat-why').innerText() === 'every fight in the match' && /^3 kills, 5 deaths, 0 teammates down$/.test(await page.locator('.beat.scan .beat-out').innerText()), "the scan card says what it checked and what it found");
  check(/^2\.2 heads low$/.test(await page.locator('.beat.measure_aim figcaption').first().innerText()) && await page.locator('.beat.measure_aim .box').count() === 1, 'the aim card shows the measured frame, its box, and its number');
  check(/New theory Crosshair sits low\s*0:13 chest height at first sight/.test(await page.locator('.beat.measure_aim .beat-take').innerText()), "the coach's take lands on the card it was about");
  const firstAgent = seen.agentBodies[0];
  check(/<data>I lose the first duel a lot<\/data>/.test(firstAgent.systemInstruction.parts[0].text), "the player's note reaches the coach as data");
  check(!/First find|then measure|Step 1/i.test(firstAgent.systemInstruction.parts[0].text), 'the brief gives no order of steps');
  await page.click('.question .opts button:has-text("No")');

  await page.waitForSelector('#verdict:not([hidden])', { timeout: 60000 });
  const after = (i) => lastResults(seen.agentBodies[i]);
  const askReply = seen.agentBodies.map(lastResults).flat().find((r) => r.name === 'ask_player');
  check(askReply?.response.result.answer === '<data>No</data>', "the player's answer goes back to the coach");
  const measured = seen.agentBodies.map(lastResults).flat().filter((r) => r.name === 'measure_aim').flatMap((r) => r.response.result.measured || [r.response.result]);
  check(/the player was dead then \(the kill feed shows their death at 2:15\)/.test(measured[3]?.skipped) && measured.filter((m) => m.found).length === 4, 'a moment after their death is skipped instead of measured');
  check(JSON.stringify(seen.headCalls) === '[1,2,1]', `one head call per measure_aim, every moment in it (${JSON.stringify(seen.headCalls)})`);
  check(/before_finish/.test(JSON.stringify(after(4))) && /look at a fight they won \(kills at 0:32, 1:24, 1:59\)/.test(measured[1] && JSON.stringify(after(4))), 'every look says what finish will still ask for');
  const outs = await page.locator('.how .beat-out').evaluateAll((els) => els.map((e) => e.textContent).join(' | '));
  check(/2:15\.0 skipped: you were dead \(2:15\)/.test(outs), `the breakdown shows the skipped moment (${outs})`);
  const firstFinish = after(5).find((r) => r.name === 'finish')?.response.result;
  check(firstFinish?.ok === false && firstFinish.problems.some((p) => /haven't looked closely at 1:30/.test(p)), 'a finish citing an unseen moment is sent back');
  const secondFinish = after(6).find((r) => r.name === 'finish')?.response.result;
  check(secondFinish?.ok === false && /haven't looked at a fight they won \(kills at 0:32, 1:24, 1:59\)/.test(secondFinish.problems[0]), 'a finish that never checked a won fight is sent back once');
  const framesTurn = seen.agentBodies[7].contents.at(-1).parts;
  check(framesTurn.filter((p) => p.inlineData).length === 7 && framesTurn[0].functionResponse.response.result.images === '7 attached', 'frames reach the coach as pictures, not JSON');
  const imgsLater = seen.agentBodies[8].contents.flatMap((c) => c.parts).filter((p) => p.inlineData).length;
  check(imgsLater === 0, 'old pictures are dropped from later turns');
  check(await page.locator('.verdict h2').innerText() === 'CROSSHAIR BELOW HEAD LEVEL', 'verdict names the habit');
  check(await page.locator('.metric b').innerText() === '2.2', 'the metric is the measured median (2.2 heads)');
  check(await page.locator('.evidence li').count() === 3 && await page.locator('.pin').count() === 3, 'three evidence moments, pinned on the timeline');
  await page.waitForFunction(() => [...document.querySelectorAll('.evidence .thumb')].every((t) => t.style.backgroundImage.startsWith('url')));
  check(true, 'each evidence moment gets a frame from the recording');
  check(await page.locator('#status').isHidden(), 'the spinner is gone when done');
  check(/0:31\s*On the head, and the fight was won/.test(await page.locator('.contrast').innerText()), 'moments they got right show apart from the evidence');
  check(await page.locator('.how .theory.supported').count() === 1, 'the board is kept under How it got here');
  const calls = 9 + 1 + seen.feedCalls + 3;
  check(await page.locator('.how summary').innerText() === `How it got here: ${calls} calls, 5 looks`, `the review counts its model calls (${calls}: 9 turns, the scan's ${1 + seen.feedCalls}, 3 aim)`);
  check(await page.locator('.how .beat').count() === 9, 'the breakdown folds into How it got here');
  await page.click('.evidence li:nth-child(2) button');
  await page.waitForFunction(() => document.querySelector('#video').currentTime > 44);
  check(true, 'clicking evidence plays that moment');
  await page.click('#acceptBtn');
  check(/next review checks this habit/.test(await page.locator('.accepted').innerText()), 'accepting saves the habit');

  console.log('second review: the re-check');
  seen.agentBodies.length = 0;
  seen.heads = 0;
  heads = [1.0, 0.9, 1.1];
  await page.goto(base);
  check(/Working on Crosshair below head level/.test(await page.locator('#working').innerText()), 'the start screen shows the habit being worked on');
  await page.setInputFiles('#fileInput', fixture);
  await page.waitForSelector('.question:not([hidden])', { timeout: 60000 });
  check(seen.uploads === 1, 'the same recording reuses its uploaded scan copy');
  check(/They are working on Crosshair below head level/.test(seen.agentBodies[0].systemInstruction.parts[0].text) && /Baseline: Crosshair 2\.2 heads below the head, median of 4 duels/.test(seen.agentBodies[0].systemInstruction.parts[0].text), 'the coach is told the habit and its baseline');
  await page.click('.question [data-skip]');
  await page.waitForSelector('#verdict:not([hidden])', { timeout: 60000 });
  check(/Crosshair below head level: better than before \(2\.2 to 1\.0 heads\)/.test(await page.locator('.progress').innerText()), 'progress is measured against the baseline in code');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('thirdeye.v1')));
  check(stored.matches.length === 2 && stored.matches[1].progress === 'better', 'history keeps both reviews');
  await page.click('#rejectBtn');
  await page.click('#historyBtn');
  check(await page.locator('.history li').count() === 2, 'past reviews list both matches');

  console.log('phone width');
  await page.setViewportSize({ width: 375, height: 812 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `no sideways scroll at 375 px (${overflow})`);
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} finally {
  await browser.close();
  server.close();
}
console.log(fail.length ? `\n${fail.length} failed` : '\nall passed');
process.exit(fail.length ? 1 : 0);
