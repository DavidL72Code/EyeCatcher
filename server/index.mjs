// Eye Catcher's backend: npm run backend, or a web service on Render (render.yaml). It is the only place the Gemini key
// lives. The app sends its Gemini requests here and this forwards them with the key, so the key never reaches a
// player's machine.
//
// Because anyone can find a public URL, it forwards only what the app itself sends (generateContent on an allowed
// model, the scan-copy upload, and checking on that upload), caps the size of each, and rate-limits each caller with a
// daily cap overall, so the key can't be used for anything else or run dry by one person. It keeps nothing: no
// request or reply is stored or logged, only its kind, status, and time.
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { Transform, pipeline } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnv } from '../scripts/dev.mjs';

const GOOGLE = 'https://generativelanguage.googleapis.com';
const MB = 1024 * 1024;
const DAY = 24 * 3600e3;

/** Settings from the environment, with .env beside the app as a fallback for running it locally. */
export function settings(env = { ...readEnv(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')), ...process.env }) {
  const list = (v, d) => String(v || d).split(',').map((s) => s.trim()).filter(Boolean);
  return {
    key: env.GEMINI_API_KEY || '',
    port: +(env.PORT || 8787),
    host: env.HOST || (env.RENDER ? '0.0.0.0' : '127.0.0.1'),
    // the desktop app's page and the local dev server
    origins: list(env.ALLOWED_ORIGINS, 'http://127.0.0.1:5170,http://127.0.0.1:5177,http://localhost:5177'),
    // the models the app asks for (gemini.js): Flash-Lite only, 2.5 Flash-Lite for search
    models: list(env.ALLOWED_MODELS, 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash-lite'),
    perMinute: +(env.RATE_PER_MINUTE || 30),
    perDay: +(env.CALLS_PER_DAY || 200), // one review is about 20 to 40 calls
    uploadsPerDay: +(env.UPLOADS_PER_DAY || 6),
    totalPerDay: +(env.TOTAL_PER_DAY || 2000),
    totalUploadsPerDay: +(env.TOTAL_UPLOADS_PER_DAY || 100), // Gemini keeps each upload 48 hours, in storage with a cap
    maxBody: +(env.MAX_REQUEST_MB || 12) * MB, // the biggest the app sends is about 3 MB of frames
    maxUpload: +(env.MAX_UPLOAD_MB || 256) * MB, // a 2-hour match makes a scan copy of about 230 MB
    // a reply's length, thinking included: the app's longest are a few thousand tokens, and a cap keeps each call's cost bounded
    maxOutputTokens: +(env.MAX_OUTPUT_TOKENS || 16384),
    // behind Render's proxy the caller's address is the last one it adds to X-Forwarded-For
    trustProxy: !!env.RENDER || env.TRUST_PROXY === '1',
    publicUrl: env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || '',
    timeoutMs: +(env.UPSTREAM_TIMEOUT_MS || 180000),
  };
}

// Replies in Gemini's own error shape, so the app's client handles them as it handles Gemini's: a short wait is
// retried, a used-up day isn't.
const geminiError = (status, message, extra = []) => JSON.stringify({ error: { code: status, message, status: { 400: 'INVALID_ARGUMENT', 403: 'PERMISSION_DENIED', 404: 'NOT_FOUND', 413: 'INVALID_ARGUMENT', 429: 'RESOURCE_EXHAUSTED', 502: 'UNAVAILABLE', 504: 'DEADLINE_EXCEEDED' }[status] || 'INTERNAL', details: extra } });
const UPLOAD_HEADERS = ['x-goog-upload-protocol', 'x-goog-upload-command', 'x-goog-upload-header-content-length', 'x-goog-upload-header-content-type', 'x-goog-upload-offset'];
// the request fields and tools the app uses; anything else is refused before it costs a call
const FIELDS = new Set(['contents', 'systemInstruction', 'system_instruction', 'tools', 'toolConfig', 'tool_config', 'generationConfig', 'generation_config', 'safetySettings', 'safety_settings']);
const TOOLS = new Set(['functionDeclarations', 'function_declarations', 'google_search', 'googleSearch']);

// The scan copy goes to Gemini as it arrives, never held whole in memory.
function streamUpload(url, headers, source, size, timeoutMs) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const count = new Transform({ transform(chunk, _, cb) { n += chunk.length; cb(n > size ? Object.assign(new Error('That upload is bigger than it said.'), { status: 413 }) : null, chunk); } });
    const out = https.request(url, { method: 'POST', headers: { ...headers, 'Content-Length': String(size) }, timeout: timeoutMs }, (r) => {
      let text = '';
      r.setEncoding('utf8');
      r.on('data', (d) => { text += d; });
      r.on('end', () => resolve({ status: r.statusCode, text }));
    });
    out.on('timeout', () => out.destroy(Object.assign(new Error('Gemini took too long to answer.'), { status: 504 })));
    pipeline(source, count, out, (e) => {
      if (e) return reject(e.status ? e : Object.assign(new Error("Couldn't reach Gemini."), { status: 502 }));
      if (n !== size) reject(Object.assign(new Error('The upload was cut short.'), { status: 400 }));
    });
  });
}

export function createServer(opts = settings(), { fetchImpl = fetch, uploadImpl = streamUpload, clock = Date.now, log = console.log } = {}) {
  if (!opts.key) throw new Error('Set GEMINI_API_KEY: the backend holds the only copy of the key.');
  const callers = new Map(); // address -> { minute: [times], day, calls, uploads }
  let total = { day: 0, calls: 0, uploads: 0 };
  const sessions = new Map(); // upload id -> { url, size, expires }
  const files = new Map(); // Gemini file name -> { expires, polls }: uploads made through here, the only ones it looks up
  const MAX_POLLS = 120; // the app checks every 2 s while Gemini processes a copy, for up to 3 minutes

  const dayOf = (t) => Math.floor(t / DAY);
  function caller(ip) {
    const t = clock();
    if (callers.size > 10000) for (const [k, v] of callers) if (v.day !== dayOf(t)) callers.delete(k);
    const c = callers.get(ip) || { minute: [], day: dayOf(t), calls: 0, uploads: 0 };
    if (c.day !== dayOf(t)) Object.assign(c, { day: dayOf(t), calls: 0, uploads: 0 });
    c.minute = c.minute.filter((x) => t - x < 60e3);
    callers.set(ip, c);
    if (total.day !== dayOf(t)) total = { day: dayOf(t), calls: 0, uploads: 0 };
    return c;
  }
  // a refusal, or null when the call may go ahead (and is counted)
  function admit(ip, kind) {
    const t = clock(), c = caller(ip);
    if (total.calls >= opts.totalPerDay) return [429, "Eye Catcher's server has used today's allowance. Try again tomorrow.", [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'ThirdeyeTotalPerDay' }] }]];
    if (c.calls >= opts.perDay) return [429, "You've used today's Eye Catcher allowance. Try again tomorrow.", [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'ThirdeyeCallsPerDay' }] }]];
    if (kind === 'upload' && total.uploads >= opts.totalUploadsPerDay) return [429, "Eye Catcher's server has taken today's uploads. Try again tomorrow.", [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'ThirdeyeTotalUploadsPerDay' }] }]];
    if (kind === 'upload' && c.uploads >= opts.uploadsPerDay) return [429, "You've uploaded today's limit of match copies. Try again tomorrow.", [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'ThirdeyeUploadsPerDay' }] }]];
    if (c.minute.length >= opts.perMinute) {
      const wait = Math.max(1, Math.ceil((60e3 - (t - c.minute[0])) / 1000));
      return [429, `Too many requests a minute. Try again in ${wait} s.`, [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: `${wait}s` }]];
    }
    c.minute.push(t);
    c.calls++;
    total.calls++;
    if (kind === 'upload') { c.uploads++; total.uploads++; }
    return null;
  }

  const addressOf = (req) => {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    return (opts.trustProxy && fwd.at(-1)) || req.socket.remoteAddress || 'unknown';
  };
  const baseOf = (req) => opts.publicUrl || `${opts.trustProxy && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`;

  async function body(req, limit) {
    const parts = [];
    let n = 0;
    for await (const chunk of req) {
      n += chunk.length;
      if (n > limit) throw Object.assign(new Error('too large'), { status: 413 });
      parts.push(chunk);
    }
    return Buffer.concat(parts);
  }

  async function upstream(url, init) {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs) });
    } catch (e) {
      throw Object.assign(new Error(e.name === 'TimeoutError' ? 'Gemini took too long to answer.' : "Couldn't reach Gemini."), { status: e.name === 'TimeoutError' ? 504 : 502 });
    }
  }

  function headersFor(req) {
    const origin = req.headers.origin;
    const h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin' };
    if (opts.trustProxy) h['Strict-Transport-Security'] = 'max-age=31536000';
    if (origin && opts.origins.includes(origin)) Object.assign(h, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'x-goog-upload-url, x-goog-upload-status', 'Access-Control-Allow-Headers': ['content-type', ...UPLOAD_HEADERS].join(', '), 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '600' });
    return h;
  }

  // ---------- the three requests the app makes ----------
  async function generate(req, res, model, h) {
    if (!opts.models.includes(model)) return [404, `Eye Catcher doesn't use ${model}.`];
    const raw = await body(req, opts.maxBody);
    let json;
    try { json = JSON.parse(raw); } catch { return [400, 'That request isn\'t JSON.']; }
    if (!json || typeof json !== 'object' || !Array.isArray(json.contents)) return [400, 'A request needs contents.'];
    const extra = Object.keys(json).find((k) => !FIELDS.has(k));
    if (extra) return [400, `Eye Catcher doesn't send ${extra}.`];
    const tool = (json.tools || []).flatMap((t) => Object.keys(t || {})).find((k) => !TOOLS.has(k));
    if (tool) return [400, `Eye Catcher doesn't use the ${tool} tool.`];
    const refused = admit(addressOf(req), 'call');
    if (refused) return refused;
    const config = json.generationConfig || json.generation_config || {};
    config.maxOutputTokens = Math.min(+config.maxOutputTokens || Infinity, opts.maxOutputTokens);
    delete json.generation_config;
    json.generationConfig = config;
    const r = await upstream(`${GOOGLE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.key }, body: JSON.stringify(json) });
    res.writeHead(r.status, h);
    res.end(Buffer.from(await r.arrayBuffer()));
  }

  // the scan copy: Gemini's resumable upload, started here with the key; the session it opens stays on this server
  async function uploadStart(req, res, h) {
    const size = +req.headers['x-goog-upload-header-content-length'], type = String(req.headers['x-goog-upload-header-content-type'] || '');
    if (req.headers['x-goog-upload-command'] !== 'start' || req.headers['x-goog-upload-protocol'] !== 'resumable') return [400, 'Start a resumable upload.'];
    if (!(size > 0 && size <= opts.maxUpload)) return [413, `A scan copy can be up to ${opts.maxUpload / MB} MB.`];
    if (!/^video\/(webm|mp4)$/.test(type)) return [400, 'The scan copy is a WebM or MP4 video.'];
    const raw = await body(req, 64 * 1024);
    let name = 'eye-catcher-scan';
    try { name = String(JSON.parse(raw)?.file?.display_name || name).slice(0, 80); } catch {}
    const refused = admit(addressOf(req), 'upload');
    if (refused) return refused;
    const r = await upstream(`${GOOGLE}/upload/v1beta/files`, {
      method: 'POST',
      headers: { 'x-goog-api-key': opts.key, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(size), 'X-Goog-Upload-Header-Content-Type': type, 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: { display_name: name } }),
    });
    const url = r.headers.get('x-goog-upload-url');
    if (!r.ok || !url) return [r.status >= 400 ? r.status : 502, 'Gemini refused the upload.'];
    const id = crypto.randomUUID();
    sessions.set(id, { url, size, expires: clock() + 3600e3 });
    res.writeHead(200, { ...h, 'x-goog-upload-url': `${baseOf(req)}/gemini/upload-session/${id}` });
    res.end('{}');
  }

  async function uploadBytes(req, res, id, h) {
    const s = sessions.get(id);
    if (!s || s.expires < clock()) return [404, 'That upload expired. Start it again.'];
    sessions.delete(id);
    if (+req.headers['content-length'] > s.size) return [413, 'That upload is bigger than it said.'];
    const r = await uploadImpl(s.url, { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, req, s.size, opts.timeoutMs);
    try { const f = JSON.parse(r.text)?.file?.name; if (f) files.set(f, { expires: clock() + 2 * DAY, polls: 0 }); } catch {}
    res.writeHead(r.status, h);
    res.end(r.text);
  }

  async function fileState(req, res, name, h) {
    const f = files.get(name);
    if (!(f?.expires > clock())) return [404, 'No upload by that name.'];
    if (++f.polls > MAX_POLLS) return [429, 'That upload has been checked too many times.'];
    const r = await upstream(`${GOOGLE}/v1beta/${name}`, { headers: { 'x-goog-api-key': opts.key } });
    res.writeHead(r.status, h);
    res.end(Buffer.from(await r.arrayBuffer()));
  }

  return http.createServer(async (req, res) => {
    const t0 = Date.now(), h = headersFor(req), url = req.url.split('?')[0];
    let kind = 'other';
    const done = (status) => log(`${req.method} ${kind} ${status} ${Date.now() - t0}ms`);
    try {
      // a page on another site can't spend the key through its visitors' browsers
      if (req.headers.origin && !opts.origins.includes(req.headers.origin)) { kind = 'origin'; res.writeHead(403, h); res.end(geminiError(403, 'This server only answers the Eye Catcher app.')); return done(403); }
      if (req.method === 'OPTIONS') { kind = 'preflight'; res.writeHead(204, h); res.end(); return done(204); }
      let m, out;
      if (req.method === 'GET' && url === '/health') { kind = 'health'; res.writeHead(200, h); res.end('{"ok":true}'); return done(200); }
      if (req.method === 'POST' && (m = /^\/gemini\/v1beta\/models\/([a-z0-9.-]+):generateContent$/.exec(url))) { kind = 'generate'; out = await generate(req, res, m[1], h); }
      else if (req.method === 'POST' && url === '/gemini/upload/v1beta/files') { kind = 'upload-start'; out = await uploadStart(req, res, h); }
      else if (req.method === 'POST' && (m = /^\/gemini\/upload-session\/([0-9a-f-]{36})$/.exec(url))) { kind = 'upload'; out = await uploadBytes(req, res, m[1], h); }
      else if (req.method === 'GET' && (m = /^\/gemini\/v1beta\/(files\/[a-z0-9-]{1,64})$/.exec(url))) { kind = 'file'; out = await fileState(req, res, m[1], h); }
      else out = [404, 'Not a Eye Catcher request.'];
      if (out) { res.writeHead(out[0], h); res.end(geminiError(...out)); return done(out[0]); }
      done(res.statusCode);
    } catch (e) {
      const status = e.status || 500;
      if (!res.headersSent) { res.writeHead(status, h); res.end(geminiError(status, status === 500 ? 'Something went wrong on the server.' : e.message)); }
      else res.destroy();
      done(status);
    }
  });
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  const opts = settings();
  createServer(opts).listen(opts.port, opts.host, () => console.log(`Eye Catcher backend: http://${opts.host}:${opts.port}/ (origins: ${opts.origins.join(', ')})`));
}
