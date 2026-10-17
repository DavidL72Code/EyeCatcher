// The shared agent loop's picture handling: a tool's images reach the model once, then make way (fetch is stubbed).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load(turns) {
  const bodies = [];
  const ctx = {
    window: {}, console, JSON, Promise, Error, Math, Number, String, Array, Object, RegExp, encodeURIComponent, AbortController,
    localStorage: { getItem: (k) => (k === 'gemini_api_key' ? 'TEST' : null), setItem: () => {} },
    setTimeout: (fn) => fn(), clearTimeout: () => {},
    fetch: async (url, opts) => {
      bodies.push(JSON.parse(opts.body));
      const parts = turns.shift() ?? [{ text: 'done' }];
      return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] }) };
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../gemini.js', import.meta.url), 'utf8'), ctx);
  return { G: ctx.window.Gemini, bodies };
}
const look = (t) => [{ functionCall: { name: 'look', args: { t } } }];
const tool = { name: 'look', description: 'x', execute: async ({ t }) => ({ t, images: [{ mimeType: 'image/jpeg', data: `PIX${t}`, label: `Frame at ${t}` }] }) };
const pictures = (body) => body.contents.flatMap((c) => c.parts.filter((p) => p.inlineData).map((p) => p.inlineData.data));

test('a tool result with images sends them after the answer, without base64 in the JSON', async () => {
  const { G, bodies } = load([look(1)]);
  await G.runAgent({ system: 's', prompt: 'p', tools: [tool] });
  const turn = bodies[1].contents.at(-1);
  assert.deepEqual(turn.parts[0].functionResponse.response.result, { t: 1, images: '1 attached' });
  assert.deepEqual(turn.parts.slice(1), [{ text: 'Frame at 1' }, { inlineData: { mimeType: 'image/jpeg', data: 'PIX1' } }]);
});

test('keepImages keeps only the latest pictures and leaves a note in their place', async () => {
  const { G, bodies } = load([look(1), look(2), look(3)]);
  await G.runAgent({ system: 's', prompt: 'p', tools: [tool], keepImages: 1 });
  assert.deepEqual(pictures(bodies[2]), ['PIX2']);
  assert.deepEqual(pictures(bodies[3]), ['PIX3']);
  const old = bodies[3].contents.find((c) => c.parts.some((p) => p.functionResponse?.response.result.t === 1));
  assert.match(old.parts.at(-1).text, /removed to save space/);
});

test('keepImages counts every tool turn, not only turns with pictures', async () => {
  const { G, bodies } = load([look(1), [{ functionCall: { name: 'note', args: {} } }], [{ functionCall: { name: 'note', args: {} } }]]);
  const note = { name: 'note', description: 'x', execute: async () => ({ ok: true }) };
  await G.runAgent({ system: 's', prompt: 'p', tools: [tool, note], keepImages: 1 });
  assert.deepEqual(pictures(bodies[1]), ['PIX1'], 'seen on the turn right after the look');
  assert.deepEqual(pictures(bodies[2]), [], 'gone once another tool turn follows');
});

test('without keepImages every picture stays, and config reaches generationConfig', async () => {
  const { G, bodies } = load([look(1), look(2)]);
  await G.runAgent({ system: 's', prompt: 'p', tools: [tool], config: { mediaResolution: 'MEDIA_RESOLUTION_LOW' } });
  assert.deepEqual(pictures(bodies[2]), ['PIX1', 'PIX2']);
  assert.deepEqual(bodies[0].generationConfig, { temperature: 0.3, mediaResolution: 'MEDIA_RESOLUTION_LOW' });
});
