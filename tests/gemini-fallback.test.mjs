// Model fallback in gemini.js when models are out or busy (fetch is stubbed, and waits are instant).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// answer(model, n, key): the HTTP status for the nth call to that model (from 1) with that key, 200 for a reply
function load(answer, env = {}) {
  const calls = [], notices = [], bodies = [];
  const ctx = {
    window: { __ENV__: env }, console, AbortController,
    localStorage: { store: new Map([['gemini_api_key', 'TEST']]), getItem(k) { return this.store.get(k) ?? null; }, setItem(k, v) { this.store.set(k, String(v)); } },
    setTimeout: (fn) => fn(), clearTimeout: () => {},
    fetch: async (url, opts) => {
      const model = decodeURIComponent(url.split('/models/')[1].split(':')[0]), key = opts?.headers?.['x-goog-api-key'];
      calls.push(model); bodies.push(JSON.parse(opts.body));
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
  return { G: ctx.window.Gemini, calls, notices, bodies };
}
const ask = (G, notices, generationConfig) => G.generate({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }], ...(generationConfig ? { generationConfig } : {}) }, { onNotice: (n) => notices.push(n) });

test("3.1 Flash-Lite thinks at medium at most; 3.5 Flash-Lite thinks as asked", async () => {
  // at high, 3.1 Flash-Lite thought 62,911 tokens and 250 to 352 s on one claim check (Oct 23)
  const { G, calls, notices, bodies } = load((model) => (model === 'gemini-3.5-flash-lite' ? 429 : 200));
  await ask(G, notices, { temperature: 0, thinkingConfig: { thinkingLevel: 'high' } });
  assert.deepEqual(calls, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  assert.deepEqual(bodies.map((b) => b.generationConfig.thinkingConfig.thinkingLevel), ['high', 'medium']);
  assert.equal(bodies[1].generationConfig.temperature, 0, 'the rest of the request as asked');
  // asked for less, it gets what it asked for
  const low = load(() => 200);
  low.G.setModel('gemini-3.1-flash-lite');
  await ask(low.G, low.notices, { thinkingConfig: { thinkingLevel: 'low' } });
  assert.equal(low.bodies[0].generationConfig.thinkingConfig.thinkingLevel, 'low');
});

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

test('the main model out for the day on the first key: the same model on the second key, before the next model', async () => {
  // Oct 23: 3.5 Flash-Lite out on the first key, nearly every call fell to 3.1 Flash-Lite, whose high thinking ran to
  // 63k tokens a call, while the second key's 3.5 Flash-Lite answered in seconds
  const { G, calls, notices } = load((model, n, key) => (key === 'KEY2' && model === 'gemini-3.5-flash-lite' ? 200 : 429), { GEMINI_API_KEY: 'KEY1', GEMINI_API_KEY2: 'KEY2' });
  G.preferEnv = true;
  assert.equal(G.textOf(await ask(G, notices)), 'ok');
  assert.ok(notices.some((n) => /Switching to the second key/.test(n)));
  assert.deepEqual(calls, ['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite']);
  assert.equal(G.getKey(), 'KEY2'); // and stays on it
  // out on both keys, the next model answers on the second
  const both = load((model, n, key) => (key === 'KEY2' && model === 'gemini-3.1-flash-lite' ? 200 : 429), { GEMINI_API_KEY: 'KEY1', GEMINI_API_KEY2: 'KEY2' });
  both.G.preferEnv = true;
  assert.equal(both.G.textOf(await ask(both.G, both.notices)), 'ok');
  assert.deepEqual(both.calls, ['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  // with no second key, it ends as before
  const one = load(() => 429, { GEMINI_API_KEY: 'KEY1' });
  one.G.preferEnv = true;
  await assert.rejects(ask(one.G, one.notices), /free limit is used up on every model/);
});

test('the second key out of every model and the first still has one: the first takes over again, and neither loops', async () => {
  // Oct 24: the second key ran out of 3.1 Flash-Lite while the first still had it, and three reviews ended
  const { G, calls, notices } = load((model, n, key) => (key === 'KEY1' && model === 'gemini-3.1-flash-lite' ? 200 : 429), { GEMINI_API_KEY: 'KEY1', GEMINI_API_KEY2: 'KEY2' });
  G.preferEnv = true;
  assert.equal(G.textOf(await ask(G, notices)), 'ok');
  assert.deepEqual(calls, ['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite']);
  assert.ok(notices.some((n) => /Switching to the first key/.test(n)));
  assert.equal(G.getKey(), 'KEY1');
  // the next call goes straight to what's left, asking no spent model again
  await ask(G, notices);
  assert.deepEqual(calls.slice(4), ['gemini-3.1-flash-lite']);
  // both keys out of everything: it ends, without handing the call back and forth
  const none = load(() => 429, { GEMINI_API_KEY: 'KEY1', GEMINI_API_KEY2: 'KEY2' });
  none.G.preferEnv = true;
  await assert.rejects(ask(none.G, none.notices), /free limit is used up on every model/);
  assert.ok(none.calls.length <= 6, `${none.calls.length} calls`);
});

test('one model at its per-minute limit and the rest out for the day: a minute later it answers', async () => {
  const { G, notices } = load((model, n) => (model === 'gemini-3.5-flash-lite' ? (n <= 2 ? 'minute' : 200) : 429));
  assert.equal(G.textOf(await ask(G, notices)), 'ok');
  assert.ok(notices.some((n) => /per-minute limit\. Waiting a minute/.test(n)));
});

test('the one model left sits out its per-minute limit and the rest are out for the day: the next call waits for it', async () => {
  // Vyse, Oct 23: 3.1 Flash-Lite hit its per-minute limit twice and another model answered; on the next call only that
  // one was left to try, out for the day, and the review ended on "used up on every model"
  const { G, calls, notices } = load((model, n) => (model === 'gemini-3.1-flash-lite' ? (n <= 2 ? 'minute' : 200) : n === 1 ? 200 : 429));
  G.setModel('gemini-3.1-flash-lite');
  assert.equal(G.textOf(await ask(G, notices)), 'ok');
  assert.equal(calls.at(-1), 'gemini-3.5-flash-lite');
  assert.equal(G.textOf(await ask(G, notices)), 'ok');
  assert.ok(notices.some((n) => /per-minute limit\. Waiting a minute/.test(n)));
});
