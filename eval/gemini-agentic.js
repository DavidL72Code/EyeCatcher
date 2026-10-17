/* The "why not just ask Gemini?" baseline: one prompt on the same uploaded scan copy, with Gemini's agentic video
 * processing (Interactions API), which decides by itself where in the video to look. It gets the same background the
 * agent gets (the game's screen cues and habit list) and none of Thirdeye's tools or checks. Flash-Lite only: when the
 * model or the free tier refuses, the result says so with Gemini's own message instead of trying another model.
 * Loaded into the app page by eval/run.mjs as window.ThirdeyeGeminiAgentic. */
(function (root) {
  const G = root.Gemini, C = root.ThirdeyeCore;
  const API = 'https://generativelanguage.googleapis.com/v1beta/interactions';
  const MODEL = 'gemini-3.5-flash-lite';
  const RUNNING = ['in_progress', 'queued'];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // how long to wait before trying again: a busy model or a per-minute limit, never a daily quota (null: don't retry)
  function waitFor(r) {
    if ([500, 502, 503, 504].includes(r.status)) return 3000;
    if (r.status !== 429 || /PerDay/i.test(r.text)) return null;
    const d = (r.json?.error?.details || []).find((x) => x.retryDelay);
    const s = parseFloat(d?.retryDelay ?? /retry in ([\d.]+)\s*s/i.exec(r.text)?.[1]);
    return Number.isFinite(s) && s <= 60 ? s * 1000 + 1000 : null;
  }

  function prompt({ profile, duration }) {
    return `This is a recording of one ${profile.name} match from the player's own screen (a small silent copy), ${C.mmss(duration)} long. Find the one habit that cost this player the most fights, and prove it with moments from the video. If no single habit stands out, say so: a wrong diagnosis is worse than none.

How ${profile.name} looks on screen:
${profile.cues.map((c) => `- ${c}`).join('\n')}

Habits that often cost fights (background, not a checklist; use other for anything else):
${profile.habits.map((h) => `- ${h.id}, ${h.name}: ${h.signs}`).join('\n')}

Answer with only this JSON:
{"found": true or false, "habit_id": one of ${[...profile.habits.map((h) => h.id), 'other'].join(', ')}, or null when found is false, "habit": "a few words", "why": "one to three sentences", "evidence": [{"t": "M:SS", "what": "what happens then"}]}`;
  }

  async function call(url, init, signal) {
    const res = await fetch(url, { ...init, headers: { 'x-goog-api-key': G.getKey(), 'Content-Type': 'application/json' }, signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, json, text };
  }

  // output_text in the SDKs; model_output steps in REST; outputs in the older interaction shape
  const texts = (parts) => (parts || []).filter((c) => c?.type === 'text' && c.text).map((c) => c.text).join('\n');
  const outputText = (it) => it?.output_text
    || texts((it?.steps || []).filter((s) => s.type === 'model_output').flatMap((s) => s.content || []))
    || texts(it?.outputs)
    || '';

  // the steps without thought signatures or long text, for the eval log
  const brief = (steps) => (steps || []).map((s) => JSON.parse(JSON.stringify(s, (k, v) => (/signature/i.test(k) ? undefined : typeof v === 'string' && v.length > 400 ? `${v.slice(0, 400)}…` : v))));

  /** One agentic review. Resolves with the finding, or { refused } with Gemini's status and message. Never throws for an API refusal. */
  async function run({ file, profile, duration, model = MODEL, pollMs = 5000, maxWaitMs = 10 * 60000, signal }) {
    const requests = { create: 0, polls: 0 };
    const body = (background) => JSON.stringify({
      model,
      input: [{ type: 'video', uri: file.uri, mime_type: file.mimeType, processing: 'agentic' }, { type: 'text', text: prompt({ profile, duration }) }],
      ...(background ? { background: true } : {}),
    });
    const refused = (r, stage, id) => ({ found: false, refused: true, stage, status: r.status, error: r.json?.error?.message || r.text.slice(0, 500), model, id, requests });

    requests.create++;
    let r = await call(API, { method: 'POST', body: body(true) }, signal);
    // one retry for a busy model or a per-minute limit; a daily quota or a refusal is the answer
    const wait = waitFor(r);
    if (wait != null) { await sleep(wait); requests.create++; r = await call(API, { method: 'POST', body: body(true) }, signal); }
    // background runs may not be offered on every tier: try once in the foreground
    if (r.status === 400 && /background/i.test(r.text)) { requests.create++; r = await call(API, { method: 'POST', body: body(false) }, signal); }
    if (!r.ok) return refused(r, 'create');

    let it = r.json;
    const t0 = Date.now();
    while (RUNNING.includes(it?.status) && Date.now() - t0 < maxWaitMs) {
      await sleep(pollMs);
      requests.polls++;
      const p = await call(`${API}/${encodeURIComponent(it.id)}`, { method: 'GET' }, signal);
      // polls count against the per-minute limit too; the interaction keeps running meanwhile
      if (!p.ok && waitFor(p) != null) { await sleep(waitFor(p)); continue; }
      if (!p.ok) return refused(p, 'poll', it.id);
      it = p.json;
    }
    const steps = it?.steps || [];
    const base = { model, status: it?.status, id: it?.id, requests, tokens: it?.usage || null, looks: steps.filter((s) => s.type === 'processing_call').length, stepTypes: steps.map((s) => s.type), steps: brief(steps), errors: it?.errors || null };
    if (it?.status !== 'completed') return { ...base, found: false, refused: true, stage: RUNNING.includes(it?.status) ? 'timeout' : 'run', error: it?.errors?.map((e) => e.message).join(' ') || `The interaction ended as ${it?.status}.` };

    const text = outputText(it);
    let j;
    try { j = G.parseJSON(text); } catch (e) { return { ...base, found: false, unparsed: true, error: e.message, text: text.slice(0, 2000) }; }
    const ids = [...profile.habits.map((h) => h.id), 'other'];
    const found = j.found === true;
    return {
      ...base,
      found,
      habitId: found ? (ids.includes(j.habit_id) ? j.habit_id : 'other') : null,
      habit: j.habit || '',
      why: j.why || '',
      evidence: (Array.isArray(j.evidence) ? j.evidence : []).map((e) => ({ t: C.parseTime(e?.t), what: String(e?.what || '').slice(0, 200) })).filter((e) => Number.isFinite(e.t)),
      text: text.slice(0, 2000),
    };
  }

  root.ThirdeyeGeminiAgentic = { run, prompt, MODEL };
})(window);
