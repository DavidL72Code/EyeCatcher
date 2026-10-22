// Desktop app check (npm run test:desktop): Thirdeye in Electron remembers where a recording is on disk, across a
// restart, streams only recordings the player gave it, and asks again when one moves; it talks to Gemini only through
// the backend, with no key in the page; and with the player's yes it saves recordings in the Thirdeye folder. Makes no
// model calls: it opens past reviews it saves itself. Needs the synthetic match (npm run fixture).
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'tests/fixtures/match.mp4');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'thirdeye-desktop-'));
const library = path.join(scratch, 'Thirdeye');
const env = { ...process.env, THIRDEYE_USER_DATA: path.join(scratch, 'user-data'), THIRDEYE_PORT: '5171', THIRDEYE_NO_RELOAD: '1', THIRDEYE_BACKEND: 'http://127.0.0.1:8799', THIRDEYE_LIBRARY: 'off', THIRDEYE_LIBRARY_DIR: library };
const executablePath = createRequire(import.meta.url)('electron');
const fail = [];
const check = (c, m) => { if (!c) { fail.push(m); console.log('  FAIL -', m); } else console.log('  ok -', m); };

async function launch(extra = {}) {
  const app = await electron.launch({ executablePath, args: [path.join(root, 'desktop/main.mjs')], env: { ...env, ...extra } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

const moved = path.join(scratch, 'moved-match.mp4');
fs.copyFileSync(fixture, moved);
let app;
try {
  console.log('first launch');
  let page;
  ({ app, page } = await launch());
  check(await page.title() === 'Thirdeye', 'the window shows Thirdeye');
  check(await page.evaluate(() => typeof window.thirdeyeDesktop?.remember === 'function' && typeof window.require === 'undefined' && typeof window.process === 'undefined'), 'the page gets the recording bridge and nothing of Node');
  const gem = await page.evaluate(() => ({ env: { ...window.__ENV__ }, has: window.Gemini.hasKey(), via: window.Gemini.backendUrl(), keyBox: !document.querySelector('#keyBox').hidden }));
  check(gem.via === 'http://127.0.0.1:8799' && !('GEMINI_API_KEY' in gem.env) && gem.has && !gem.keyBox, 'Gemini goes through the backend: the page has its address and no key, and asks for none');
  const blocked = await page.evaluate(async () => {
    const seen = [];
    document.addEventListener('securitypolicyviolation', (e) => seen.push(new URL(e.blockedURI).host));
    await fetch('http://127.0.0.1:8799/health').catch(() => {});
    await fetch('https://example.com/').catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    return seen;
  });
  check(blocked.length === 1 && blocked[0] === 'example.com', `the page's policy lets it reach the backend and nothing else (blocked: ${blocked.join(', ') || 'none'})`);

  // a file input of its own, picked the way the player picks a recording
  const remember = async (id, file) => {
    await page.evaluate((id) => { const input = document.createElement('input'); input.type = 'file'; input.id = `pick-${id}`; document.body.append(input); }, id);
    await page.setInputFiles(`#pick-${id}`, file);
    return page.evaluate((id) => window.thirdeyeDesktop.remember(document.querySelector(`#pick-${id}`).files[0]), id);
  };
  const got = await remember('a', fixture);
  check(got?.path === fixture && got.size === fs.statSync(fixture).size, `a picked recording is remembered by its path (${got?.path})`);
  check(await page.evaluate(() => window.thirdeyeDesktop.remember(new File(['x'], 'made-up.mp4'))) === null, 'a File the page made itself has no path to remember');
  check((await page.evaluate(() => window.thirdeyeDesktop.open('/etc/hosts'))).missing === true, 'a file the player never gave the app is refused');

  const opened = await page.evaluate((p) => window.thirdeyeDesktop.open(p), fixture);
  const part = await page.evaluate(async (url) => { const r = await fetch(url, { headers: { Range: 'bytes=0-99' } }); return { status: r.status, type: r.headers.get('content-type'), n: (await r.arrayBuffer()).byteLength }; }, opened.url);
  check(part.status === 206 && part.n === 100 && part.type === 'video/mp4', `it streams the recording in parts, for seeking (${JSON.stringify(part)})`);
  check(await page.evaluate(async () => (await fetch('/recording/not-a-token')).status) === 404, 'an unknown stream is a 404');

  await remember('b', moved);
  // two past reviews: one of the fixture where it is, one of a copy that will be moved away
  await page.evaluate(async ({ fixture, moved, size, lastModified, movedModified }) => {
    const review = (id, p, mod) => ({
      id, date: '2026-10-18', calls: 0, game: null, workingOn: null, path: p, log: [], keys: [],
      video: { name: p.split('/').pop(), size, lastModified: mod, duration: 150 },
      result: { found: false, why: 'No single habit stood out in this test review.', evidence: [], contrast: [], fixes: [], board: [], stats: { looks: 0 } },
    });
    await window.ThirdeyeReviews.save(review('rev-here', fixture, lastModified));
    await window.ThirdeyeReviews.save(review('rev-moved', moved, movedModified));
    const match = (id, p) => ({ id, date: '2026-10-18', name: p.split('/').pop(), game: 'Synthetic test match', found: false, status: 'new' });
    localStorage.setItem('thirdeye.v1', JSON.stringify({ habit: null, matches: [match('rev-moved', moved), match('rev-here', fixture)] }));
  }, { fixture, moved, size: fs.statSync(fixture).size, lastModified: Math.floor(fs.statSync(fixture).mtimeMs), movedModified: Math.floor(fs.statSync(moved).mtimeMs) });
  await app.close();

  console.log('after a restart');
  fs.unlinkSync(moved);
  ({ app, page } = await launch());
  await page.evaluate(() => { location.hash = '#review/rev-here'; });
  await page.waitForSelector('#verdict:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#video').readyState >= 1, null, { timeout: 15000 });
  check(/^http:\/\/127\.0\.0\.1:5171\/recording\//.test(await page.locator('#video').getAttribute('src')) && await page.locator('#reattach').isHidden(), 'the past review streams the recording from where it is on disk, with no copy and no prompt');
  check(await page.evaluate(async () => { const d = await navigator.storage.getDirectory(); for await (const k of d.keys()) if (k === 'recordings') { for await (const _ of (await d.getDirectoryHandle('recordings')).keys()) return true; } return false; }) === false, 'nothing was copied into browser storage');
  check(await page.locator('#revealBtn').innerText() === 'Show in Finder' || process.platform !== 'darwin', 'the review offers to show the file');
  await page.evaluate(() => { location.hash = '#review/rev-moved'; });
  await page.waitForSelector('#reattach:not([hidden])');
  check(/moved or was renamed/.test(await page.locator('#reattach .r-err').innerText()), 'a recording that moved is asked for again');
  await page.setInputFiles('#reattachInput', fixture);
  check(await page.locator('#reattach').isHidden() && /^blob:/.test(await page.locator('#video').getAttribute('src')), 'the same recording found somewhere else loads');
  await page.waitForFunction(async () => (await window.ThirdeyeReviews.get('rev-moved')).path?.endsWith('/match.mp4'));
  check(true, 'and its new place is remembered');
  await app.close();

  console.log('the Thirdeye folder');
  ({ app, page } = await launch({ THIRDEYE_LIBRARY: '' }));
  // the native question, answered yes the way a player would
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
  const given = await remember('c', fixture);
  const kept = await page.evaluate((p) => window.thirdeyeDesktop.keep(p), given.path);
  check(kept?.path === path.join(library, 'match.mp4') && fs.existsSync(fixture), `with a yes, the recording is saved in the Thirdeye folder, and the original stays (${kept?.path})`);
  check(fs.statSync(kept.path).size === fs.statSync(fixture).size && Math.floor(fs.statSync(kept.path).mtimeMs) === Math.floor(fs.statSync(fixture).mtimeMs), 'the copy has the same size and date, so it is known as the same recording');
  check(JSON.parse(fs.readFileSync(path.join(env.THIRDEYE_USER_DATA, 'settings.json'), 'utf8')).library === 'on', 'the answer is remembered');
  check((await page.evaluate((p) => window.thirdeyeDesktop.keep(p), (await remember('d', fixture)).path))?.path === kept.path && fs.readdirSync(library).length === 1, 'adding it again makes no second copy');
  check(await page.evaluate(() => window.thirdeyeDesktop.keep('/etc/hosts')) === null, 'only a recording the player gave it can be saved there');
  await page.evaluate(() => { location.hash = '#coach'; });
  await page.reload();
  await page.waitForSelector('#libraryBtn:not([hidden])');
  check(true, 'the Coach page offers the recordings folder');
} finally {
  await app?.close().catch(() => {});
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log(fail.length ? `\n${fail.length} failed` : '\nall passed');
process.exit(fail.length ? 1 : 0);
