// The backend (server/index.mjs): it forwards only the app's own Gemini requests, adds the key on its side and never
// lets it out, refuses other sites, and rate-limits. Gemini is replaced by a stand-in that records what reached it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, settings } from '../server/index.mjs';

const KEY = 'TEST-KEY-not-a-real-key';
const APP = 'http://127.0.0.1:5170';

async function serve(over = {}, { now = () => Date.now() } = {}) {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, init });
    if (url.endsWith('/upload/v1beta/files')) return new Response('{}', { status: 200, headers: { 'x-goog-upload-url': `https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=SECRET-SESSION&key=${KEY}` } });
    if (/\/v1beta\/files\//.test(url)) return Response.json({ name: 'files/abc123', state: 'ACTIVE', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc123', mimeType: 'video/webm' });
    return Response.json({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] });
  };
  const uploads = [];
  const uploadImpl = async (url, headers, source, size) => {
    let n = 0;
    for await (const c of source) n += c.length;
    uploads.push({ url, headers, n, size });
    return { status: 200, text: JSON.stringify({ file: { name: 'files/abc123', state: 'PROCESSING' } }) };
  };
  const opts = { ...settings({ GEMINI_API_KEY: KEY }), ...over };
  const server = createServer(opts, { fetchImpl, uploadImpl, clock: now, log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, init = {}) => fetch(base + path, { ...init, headers: { Origin: APP, ...init.headers } });
  return { base, call, seen, uploads, close: () => server.close() };
}
const ask = (s, model = 'gemini-3.5-flash-lite', body = { contents: [{ role: 'user', parts: [{ text: 'hello' }] }] }, headers = {}) =>
  s.call(`/gemini/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('refuses to start without the key', () => {
  assert.throws(() => createServer({ ...settings({}), key: '' }), /GEMINI_API_KEY/);
});

test('forwards a generateContent call with the key added on the server, and never sends the key back', async () => {
  const s = await serve();
  const r = await ask(s);
  const text = await r.text();
  assert.equal(r.status, 200);
  assert.equal(s.seen[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
  assert.equal(s.seen[0].init.headers['x-goog-api-key'], KEY);
  assert.ok(!text.includes(KEY) && ![...r.headers.values()].some((v) => v.includes(KEY)));
  assert.equal(r.headers.get('access-control-allow-origin'), APP);
  s.close();
});

test('caps how long a reply can be, whatever the request asks', async () => {
  const s = await serve({ maxOutputTokens: 1000 });
  await ask(s, undefined, { contents: [{ parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 999999, temperature: 0 } });
  await ask(s);
  const sent = s.seen.map((x) => JSON.parse(x.init.body).generationConfig);
  assert.deepEqual(sent, [{ maxOutputTokens: 1000, temperature: 0 }, { maxOutputTokens: 1000 }]);
  s.close();
});

test('caps uploads per day for the whole server', async () => {
  const s = await serve({ totalUploadsPerDay: 1 });
  const start = () => s.call('/gemini/upload/v1beta/files', { method: 'POST', headers: { 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': '10', 'X-Goog-Upload-Header-Content-Type': 'video/webm' }, body: '{}' });
  assert.equal((await start()).status, 200);
  assert.match((await (await start()).json()).error.message, /taken today's uploads/);
  s.close();
});

test('forwards only what the app sends', async () => {
  const s = await serve();
  assert.equal((await ask(s, 'gemini-ultra-9')).status, 404, 'a model the app never uses');
  assert.equal((await ask(s, undefined, { contents: [], cachedContent: 'x' })).status, 400, 'a field the app never sends');
  assert.equal((await ask(s, undefined, { contents: [], tools: [{ codeExecution: {} }] })).status, 400, 'a tool the app never uses');
  assert.equal((await s.call('/v1beta/models', { method: 'GET' })).status, 404, 'any other Gemini path');
  assert.equal((await s.call('/gemini/v1beta/files/someone-elses-file')).status, 404, 'an upload that did not come through here');
  assert.equal(s.seen.length, 0, 'none of them reached Gemini');
  s.close();
});

test('refuses a page on another site, and answers the app with CORS', async () => {
  const s = await serve();
  assert.equal((await ask(s, undefined, undefined, { Origin: 'https://evil.example' })).status, 403);
  const pre = await s.call('/gemini/upload/v1beta/files', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /x-goog-upload-command/);
  assert.equal(s.seen.length, 0);
  s.close();
});

test('caps the size of a request', async () => {
  const s = await serve({ maxBody: 1000 });
  assert.equal((await ask(s, undefined, { contents: [{ parts: [{ text: 'x'.repeat(5000) }] }] })).status, 413);
  s.close();
});

test('rate-limits each caller by the minute, with a wait Gemini clients understand, and by the day', async () => {
  let t = Date.UTC(2026, 9, 18, 12);
  const s = await serve({ perMinute: 2, perDay: 3 }, { now: () => t });
  assert.equal((await ask(s)).status, 200);
  assert.equal((await ask(s)).status, 200);
  const slow = await ask(s);
  assert.equal(slow.status, 429);
  assert.match(JSON.stringify(await slow.json()), /retryDelay/);
  t += 61e3;
  assert.equal((await ask(s)).status, 200);
  const day = await ask(s);
  assert.equal(day.status, 429);
  assert.match(JSON.stringify(await day.json()), /PerDay/);
  t += 24 * 3600e3;
  assert.equal((await ask(s)).status, 200, 'a new day starts over');
  s.close();
});

test('caps the whole server per day', async () => {
  const s = await serve({ totalPerDay: 1 });
  assert.equal((await ask(s)).status, 200);
  assert.match((await (await ask(s)).json()).error.message, /server has used today's allowance/);
  s.close();
});

test("an address in X-Forwarded-For counts only behind Render's proxy, and only the one the proxy added", async () => {
  const plain = await serve({ perMinute: 1 });
  assert.equal((await ask(plain, undefined, undefined, { 'X-Forwarded-For': '1.1.1.1' })).status, 200);
  assert.equal((await ask(plain, undefined, undefined, { 'X-Forwarded-For': '2.2.2.2' })).status, 429, 'a made-up header changes nothing');
  plain.close();
  const proxied = await serve({ perMinute: 1, trustProxy: true });
  assert.equal((await ask(proxied, undefined, undefined, { 'X-Forwarded-For': '9.9.9.9, 1.1.1.1' })).status, 200);
  assert.equal((await ask(proxied, undefined, undefined, { 'X-Forwarded-For': '8.8.8.8, 1.1.1.1' })).status, 429, 'the first entry is the caller\'s own claim');
  assert.equal((await ask(proxied, undefined, undefined, { 'X-Forwarded-For': '1.1.1.1, 3.3.3.3' })).status, 200);
  proxied.close();
});

test("uploads the scan copy through a session that stays on the server, then lets the app check only that upload", async () => {
  const s = await serve();
  const start = await s.call('/gemini/upload/v1beta/files', {
    method: 'POST',
    headers: { 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': '1000', 'X-Goog-Upload-Header-Content-Type': 'video/webm', 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: { display_name: 'scan' } }),
  });
  const target = start.headers.get('x-goog-upload-url');
  assert.equal(start.status, 200);
  assert.match(target, new RegExp(`^${s.base}/gemini/upload-session/[0-9a-f-]{36}$`));
  assert.ok(!target.includes('SECRET-SESSION') && !target.includes(KEY), "Gemini's session address never leaves the server");
  assert.equal(s.seen[0].init.headers['x-goog-api-key'], KEY);
  const path = new URL(target).pathname;
  const done = await s.call(path, { method: 'POST', headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body: new Uint8Array(1000) });
  assert.equal(done.status, 200);
  assert.equal(s.uploads[0].n, 1000);
  assert.match(s.uploads[0].url, /SECRET-SESSION/);
  assert.equal((await s.call(path, { method: 'POST', body: new Uint8Array(1000) })).status, 404, 'a session is used once');
  const state = await s.call('/gemini/v1beta/files/abc123');
  assert.equal(state.status, 200);
  assert.equal((await state.json()).state, 'ACTIVE');
  s.close();
});

test('refuses an upload that is too big or not a video', async () => {
  const s = await serve({ maxUpload: 500 });
  const startWith = (size, type) => s.call('/gemini/upload/v1beta/files', { method: 'POST', headers: { 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(size), 'X-Goog-Upload-Header-Content-Type': type }, body: '{}' });
  assert.equal((await startWith(1000, 'video/webm')).status, 413);
  assert.equal((await startWith(100, 'application/zip')).status, 400);
  assert.equal(s.seen.length, 0);
  s.close();
});
