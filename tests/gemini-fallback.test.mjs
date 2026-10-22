// Model fallback in gemini.js when models are out or busy (fetch is stubbed, and waits are instant).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// answer(model, n): the HTTP status for the nth call to that model (from 1), 200 for a reply
function load(answer) {
  const calls = [], notices = [];
  const ctx = {
    window: {}, console, AbortController,
    localStorage: { store: new Map([['gemini_api_key', 'TEST']]), getItem(k) { return this.store.get(k) ?? null; }, setItem(k, v) { this.store.set(k, String(v)); } },
    setTimeout: (fn) => fn(), clearTimeout: () => {},
    fetch: async (url) => {
      const model = decodeURIComponent(url.split('/models/')[1].split(':')[0]);
      calls.push(model);
      const status = answer(model, calls.filter((m) => m === model).length);
      if (status === 200) return { ok: true, status, text: async () => JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }] }) };
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
