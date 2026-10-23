// Model fallback in gemini.js when models are out or busy (fetch is stubbed, and waits are instant).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// answer(model, n, key): the HTTP status for the nth call to that model (from 1) with that key, 200 for a reply
function load(answer, env = {}) {
  const calls = [], notices = [];
  const ctx = {
    window: { __ENV__: env }, console, AbortController,
    localStorage: { store: new Map([['gemini_api_key', 'TEST']]), getItem(k) { return this.store.get(k) ?? null; }, setItem(k, v) { this.store.set(k, String(v)); } },
    setTimeout: (fn) => fn(), clearTimeout: () => {},
    fetch: async (url, opts) => {
      const model = decodeURIComponent(url.split('/models/')[1].split(':')[0]), key = opts?.headers?.['x-goog-api-key'];
      calls.push(model);
      const status = answer(model, calls.filter((m) => m === model).length, key);
      if (status === 200) return { ok: true, status, text: async () => JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }] }) };
      // 'minute': a per-minute limit, with the retry time Google sends
      if (status === 'minute') return { ok: false, status: 429, text: async () => JSON.stringify({ error: { code: 429, message: 'quota', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '20s' }] } }) };
      const quota = status === 429 ? [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] : [];
      return { ok: false, status, text: async () => JSON.stringify({ error: { code: status, message: status === 429 ? 'quota' : 'overloaded', details: quota } }) };
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../gemini.js', import.meta.url), 'utf8'), ctx);
  return { G: ctx.window.Gemini, calls, notices };
}
const ask = (G, notices) => G.generate({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }, { onNotice: (n) => notices.push(n) });

test('the main model out for the day and its fallback only busy: a minute later the fallback answers', async () => {
  const { G, calls, notices } = load((model, n) => (model === 'gemini-3.1-flash-lite' ? (n <= 2 ? 503 : 200) : 429));
  const resp = await ask(G, notices);
  assert.equal(G.textOf(resp), 'ok');
  assert.ok(notices.some((n) => /busy on every model it can use/.test(n)));
  assert.equal(calls.at(-1), 'gemini-3.1-flash-lite');
});

test("a fallback that stood in for a used-up daily quota isn't kept as the model; one for a missing model is", async () => {
  const out = load((model) => (model === 'gemini-3.5-flash-lite' ? 429 : 200));
  await ask(out.G, out.notices);
  assert.equal(out.G.getModel(), 'gemini-3.5-flash-lite'); // back tomorrow: the next day's reviews start on it again
  const gone = load((model) => (model === 'gemini-3.5-flash-lite' ? 404 : 200));
  await ask(gone.G, gone.notices);
  assert.equal(gone.G.getModel(), 'gemini-3.1-flash-lite');
});

test('every model out for the day ends at once, saying so', async () => {
  const { G, notices } = load(() => 429);
  await assert.rejects(ask(G, notices), /free limit is used up on every model/);
  assert.ok(!notices.some((n) => /Waiting a minute/.test(n)));
});

test('every model out for the day on the first key: the second key gets the whole list again', async () => {
  const { G, notices } = load((model, n, key) => (key === 'KEY2' && model === 'gemini-3.5-flash-lite' ? 200 : 429), { GEMINI_API_KEY: 'KEY1', GEMINI_API_KEY2: 'KEY2' });
  G.preferEnv = true;
  assert.equal(G.textOf(await ask(G, notices)), 'ok');
  assert.ok(notices.some((n) => /Switching to the second key/.test(n)));
  assert.equal(G.getKey(), 'KEY2'); // and stays on it
  // with no second key, it ends as before
  const one = load(() => 429, { GEMINI_API_KEY: 'KEY1' });
  one.G.preferEnv = true;
  await assert.rejects(ask(one.G, one.notices), /free limit is used up on every model/);
});

test('one model at its per-minute limit and the rest out for the day: a minute later it answers', async () => {
  const { G, notices } = load((model, n) => (model === 'gemini-3.5-flash-lite' ? (n <= 2 ? 'minute' : 200) : 429));
  assert.equal(G.textOf(await ask(G, notices)), 'ok');
  assert.ok(notices.some((n) => /per-minute limit\. Waiting a minute/.test(n)));
});
