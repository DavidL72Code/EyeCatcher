/* Thirdeye core: time, aim math, the look budget, the evidence check, the theory board, and match history, as plain
 * functions with no DOM. The agent decides where to look; this code measures and checks what it claims.
 * Loaded in the browser as window.ThirdeyeCore and in Node tests through require(). */
(function (root) {
  const pad = (n) => String(n).padStart(2, '0');
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
  const median = (xs) => {
    const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
    if (!s.length) return null;
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const text = (v) => (typeof v === 'string' ? v.trim() : '');

  // ---------- time ----------
  // Seconds in code; M:SS on screen and in prompts, which is how Gemini reads and writes video times.
  function mmss(sec, tenths = false) {
    const t = tenths ? Math.round(Math.max(0, +sec || 0) * 10) / 10 : Math.floor(Math.max(0, +sec || 0));
    const m = Math.floor(t / 60), s = t - m * 60;
    return tenths ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${m}:${pad(s)}`;
  }
  function parseTime(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    const s = String(v ?? '').trim();
    if (/^\d+(?:\.\d+)?s?$/.test(s)) return parseFloat(s);
    const m = /^(?:(\d+):)?(\d{1,3}):(\d{1,2}(?:\.\d+)?)$/.exec(s);
    if (!m || +m[3] >= 60) return NaN;
    return (m[1] ? +m[1] * 3600 : 0) + +m[2] * 60 + +m[3];
  }

  // ---------- aim ----------
  // Head-heights from the head center to the crosshair, positive when the crosshair sits below. The chest center is
  // about two head-heights below the head center on a human-proportioned model, so the bands hold at any distance.
  const aimBand = (h) => (h < -0.75 ? 'above' : h <= 0.75 ? 'head' : h <= 2.5 ? 'chest' : 'low');

  /**
   * Where the crosshair was against an enemy head. Gemini draws the head box on a crop of the frame; this does the
   * geometry. box: [ymin, xmin, ymax, xmax] in 0-1000 of the crop (Gemini's box format). crop {x, y, w, h} and
   * frame {w, h} in pixels. fovH: the game's horizontal field of view in degrees. crosshair: a fraction of the frame.
   */
  function aimOffset({ box, crop, frame, fovH, crosshair = [0.5, 0.5] }) {
    if (!Array.isArray(box) || box.length !== 4 || box.some((v) => !Number.isFinite(+v))) throw new Error('A head box needs four numbers.');
    const [y0, x0, y1, x1] = box.map((v) => clamp(+v, 0, 1000));
    if (y1 <= y0 || x1 <= x0) throw new Error('That head box is empty.');
    const hx = crop.x + ((x0 + x1) / 2000) * crop.w, hy = crop.y + ((y0 + y1) / 2000) * crop.h;
    const headPx = ((y1 - y0) / 1000) * crop.h;
    const cx = crosshair[0] * frame.w, cy = crosshair[1] * frame.h;
    const f = frame.w / 2 / Math.tan((fovH * Math.PI) / 360); // focal length in pixels, for a rectilinear projection
    const dir = (x, y) => { const dx = x - frame.w / 2; return [Math.atan2(dx, f), Math.atan2(y - frame.h / 2, Math.hypot(f, dx))]; };
    const [hYaw, hPitch] = dir(hx, hy), [cYaw, cPitch] = dir(cx, cy);
    const deg = (r) => (r * 180) / Math.PI;
    const heads = (cy - hy) / headPx;
    return {
      heads: round(heads, 2),
      dyDeg: round(deg(cPitch - hPitch), 2), // positive: the crosshair was below the head
      dxDeg: round(deg(hYaw - cYaw), 2), // positive: the head was right of the crosshair
      headPx: round(headPx, 1),
      band: aimBand(heads),
      small: headPx < 6, // a head this small on screen makes the box, and the number, rough
    };
  }

  // Gemini sometimes boxes a "head" on a wall mark. A real head sits near the top of a body, so both boxes are asked
  // for and a head outside the top of its body is refused.
  function headOnBody(head, body) {
    if (![head, body].every((b) => Array.isArray(b) && b.length === 4 && b.every((v) => Number.isFinite(+v)) && b[2] > b[0] && b[3] > b[1])) return false;
    const cx = (head[1] + head[3]) / 2, cy = (head[0] + head[2]) / 2, top = body[0] + (body[2] - body[0]) * 0.4;
    return cx >= body[1] && cx <= body[3] && cy >= body[0] - (head[2] - head[0]) && cy <= top && head[3] - head[1] <= (body[3] - body[1]) * 1.1;
  }

  function summarizeAim(measures) {
    const ok = (measures || []).filter((m) => Number.isFinite(m?.heads));
    if (!ok.length) return null;
    const bands = {};
    for (const m of ok) bands[m.band] = (bands[m.band] || 0) + 1;
    return { n: ok.length, heads: round(median(ok.map((m) => m.heads)), 2), dyDeg: round(median(ok.map((m) => m.dyDeg)), 2), atHead: bands.head || 0, bands };
  }

  function aimText(sum) {
    if (!sum) return '';
    const h = Math.abs(sum.heads), where = sum.heads > 0.75 ? 'below' : sum.heads < -0.75 ? 'above' : null;
    const amount = `${h.toFixed(1)} head${h.toFixed(1) === '1.0' ? '' : 's'}`;
    return where ? `Crosshair ${amount} ${where} the head` : 'Crosshair at head level';
  }

  // ---------- budget ----------
  // A look is one close look: frames or a measurement. A turn is one model call, from a small daily allowance.
  class BudgetError extends Error {}
  const createBudget = ({ looks = 40, turns = 30 } = {}) => ({ looks, turns, used: { looks: 0, turns: 0 } });
  const left = (b) => ({ looks: b.looks - b.used.looks, turns: b.turns - b.used.turns });
  function spend(b, kind, n = 1) {
    if (left(b)[kind] < n) throw new BudgetError(kind === 'looks' ? 'No looks left. Finish with what you have seen.' : 'No turns left.');
    b.used[kind] += n;
    return b;
  }
  const budgetLine = (b) => { const l = left(b); return `${l.looks} of ${b.looks} looks and ${l.turns} of ${b.turns} turns left`; };

  // ---------- evidence ----------
  // Every close look the agent took, so a claim can only cite moments it actually saw.
  const SLACK = 1.5; // seconds: a moment cited just outside a look still counts
  const MIN_EVIDENCE = 3, MIN_GAP = 2;
  const createLedger = () => ({ looks: [] });
  function recordLook(ledger, { from, to, kind, region = 'full' }) {
    ledger.looks.push({ from: round(from, 2), to: round(to, 2), kind, region });
    return ledger;
  }
  const seen = (ledger, t) => ledger.looks.some((l) => t >= l.from - SLACK && t <= l.to + SLACK);

  /** The problems with a finish call, or [] when it can stand. Sent back to the agent to fix. */
  function checkFinish(args, { ledger, duration = Infinity, habits = [], measures = [] }) {
    const problems = [];
    if (args?.found === false) {
      if (text(args.why).length < 20) problems.push('Say why no single habit stands out (why, one or two sentences).');
      return problems;
    }
    const ids = [...habits.map((h) => h.id), 'other'];
    if (!text(args?.habit)) problems.push('Name the habit (habit).');
    if (!ids.includes(args?.habit_id)) problems.push(`habit_id must be one of: ${ids.join(', ')}.`);
    if (text(args?.why).length < 20) problems.push('Explain how this habit cost fights (why).');
    if (text(args?.drill).length < 20) problems.push('Give one specific drill (drill).');
    if (!text(args?.recheck)) problems.push('Say what to check in the next match (recheck).');
    const kept = [];
    for (const e of Array.isArray(args?.evidence) ? args.evidence : []) {
      const t = parseTime(e?.t);
      if (!Number.isFinite(t) || t < 0 || t > duration + 1) { problems.push(`${e?.t ?? '?'} isn't a time in this match.`); continue; }
      if (!text(e.what)) problems.push(`Say what happens at ${mmss(t)}.`);
      if (!seen(ledger, t)) { problems.push(`You haven't looked closely at ${mmss(t)}. Look with frames or measure_aim, or cite a moment you did look at.`); continue; }
      if (kept.some((x) => Math.abs(x - t) < MIN_GAP)) { problems.push(`${mmss(t)} is the same moment as other evidence.`); continue; }
      kept.push(t);
    }
    if (kept.length < MIN_EVIDENCE) problems.push(`Cite at least ${MIN_EVIDENCE} separate moments you looked at that show the habit (you have ${kept.length}). Moments where they got it right go in contrast, not evidence. If fewer than ${MIN_EVIDENCE} moments show it, finish with found false.`);
    // a moment can show the habit or its opposite, not both
    for (const c of Array.isArray(args?.contrast) ? args.contrast : []) {
      const t = parseTime(c?.t);
      if (!Number.isFinite(t) || t < 0 || t > duration + 1) { problems.push(`${c?.t ?? '?'} in contrast isn't a time in this match.`); continue; }
      if (!seen(ledger, t)) problems.push(`You haven't looked closely at ${mmss(t)} (in contrast).`);
      if (kept.some((x) => Math.abs(x - t) < MIN_GAP)) problems.push(`${mmss(t)} is in both evidence and contrast. Keep it where it belongs.`);
    }
    // a habit the profile measures by aim has to agree with the aim the coach measured
    if (habits.find((h) => h.id === args?.habit_id)?.measuredBy === 'aim') {
      const sum = summarizeAim(measures);
      if (!(sum?.n >= 3)) problems.push(`Crosshair height can be measured, so back this with at least 3 measure_aim readings where an enemy was in view (you have ${sum?.n || 0}). Or name a different habit, or none.`);
      else if (sum.heads <= 0.75) problems.push(`Your measurements put the crosshair at head level (median ${sum.heads} heads over ${sum.n} duels). Show measurements where it was low, or name a different habit, or none.`);
      for (const t of kept) {
        const m = measures.find((x) => Math.abs(x.t - t) <= 1 && Number.isFinite(x.heads));
        if (m && m.heads <= 0.75) problems.push(`At ${mmss(t)} you measured the crosshair at head level (${m.heads} heads), so that moment doesn't show this habit.`);
      }
    }
    return problems;
  }

  // ---------- theory board ----------
  const STATUSES = ['testing', 'supported', 'dropped'];
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function cleanEvidence(list) {
    return (Array.isArray(list) ? list : []).map((e) => ({ t: parseTime(e?.t), what: text(e?.what).slice(0, 200) })).filter((e) => Number.isFinite(e.t));
  }
  /** Adds or updates a theory. Returns the new board and what changed: new, updated, or the status it moved to. */
  function applyNote(board, { id, theory, status, evidence }) {
    if (!STATUSES.includes(status)) throw new Error(`status must be one of: ${STATUSES.join(', ')}.`);
    const next = board.map((x) => ({ ...x, evidence: [...x.evidence], history: [...x.history] }));
    const found = next.find((x) => (id && x.id === id) || (theory && norm(x.theory) === norm(theory)));
    const ev = cleanEvidence(evidence);
    if (found) {
      const was = found.status;
      found.status = status;
      for (const e of ev) if (!found.evidence.some((o) => Math.abs(o.t - e.t) < 0.5)) found.evidence.push(e);
      if (was !== status) found.history.push(status);
      return { board: next, theory: found, change: was === status ? 'updated' : status };
    }
    if (!text(theory)) throw new Error(id ? `No theory ${id}. Give the theory text to add it.` : 'Name the theory.');
    const added = { id: `T${next.length + 1}`, theory: text(theory).slice(0, 160), status, evidence: ev, history: [status] };
    next.push(added);
    return { board: next, theory: added, change: 'new' };
  }
  const boardBrief = (board) => board.map((x) => `${x.id} ${x.status}: ${x.theory}${x.evidence.length ? ` (${x.evidence.map((e) => mmss(e.t)).join(', ')})` : ''}`).join('\n');

  // ---------- events from a scan ----------
  const KINDS = ['kill', 'death', 'round_start', 'round_end', 'other'];
  function mergeEvents(a, b) {
    const out = [];
    for (const e of [...a, ...b].sort((x, y) => x.t - y.t)) if (!out.some((o) => o.kind === e.kind && Math.abs(o.t - e.t) < 2)) out.push(e);
    return out;
  }
  /** Cleans a scan's events: valid times inside the scanned stretch, known kinds, no repeats. */
  function normalizeEvents(raw, { from = 0, to = Infinity } = {}) {
    let list = (Array.isArray(raw) ? raw : [])
      .map((e) => ({ t: parseTime(e?.t), kind: KINDS.includes(e?.kind) ? e.kind : 'other', text: text(e?.text).slice(0, 160) }))
      .filter((e) => Number.isFinite(e.t));
    const inside = (xs) => xs.filter((e) => e.t >= from - 3 && e.t <= to + 3).length;
    // a scan of a clip can come back timed from the clip's start instead of the match's: shift it when that fits better
    if (from > 0 && list.length) {
      const shifted = list.map((e) => ({ ...e, t: e.t + from }));
      if (inside(shifted) > inside(list)) list = shifted;
    }
    list = list.filter((e) => e.t >= from - 3 && e.t <= to + 3).map((e) => ({ ...e, t: round(Math.max(0, e.t), 1) }));
    return mergeEvents([], list);
  }
  const eventsBrief = (events) => events.map((e) => `${mmss(e.t)} ${e.kind}${e.text ? `: ${e.text}` : ''}`).join('\n');

  // ---------- looks ----------
  const MAX_FRAMES = 12;
  /** The frame times for one look: up to MAX_FRAMES spread over [t - before, t + after], inside the video. */
  function framePlan({ t, before = 1, after = 0.5, fps = 6, duration = Infinity }) {
    const last = Math.max(0, duration - 0.05);
    const b = clamp(+before || 0, 0, 5), a = clamp(+after || 0, 0, 5), rate = clamp(+fps || 6, 0.5, 30);
    const start = clamp(t - b, 0, last), end = clamp(t + a, 0, last);
    const n = Math.min(MAX_FRAMES, Math.floor((end - start) * rate) + 1);
    if (n <= 1 || end <= start) return [round(clamp(t, 0, last), 3)];
    return Array.from({ length: n }, (_, i) => round(start + ((end - start) * i) / (n - 1), 3));
  }
  /** A named screen region of the game profile, in frame pixels. */
  function regionRect(profile, name, frame) {
    const r = !name || name === 'full' ? [0, 0, 1, 1] : profile?.regions?.[name];
    if (!r) throw new Error(`Unknown region "${name}". Use full or one of: ${Object.keys(profile?.regions || {}).join(', ')}.`);
    return { x: Math.round(r[0] * frame.w), y: Math.round(r[1] * frame.h), w: Math.round(r[2] * frame.w), h: Math.round(r[3] * frame.h) };
  }

  // ---------- history across matches ----------
  const emptyHistory = () => ({ habit: null, matches: [] });
  const addMatch = (history, match) => ({ ...history, matches: [...(history.matches || []), match].slice(-30) });
  // The player decides which habit to work on. An aim habit's baseline is that match's aim numbers.
  const acceptHabit = (history, match) => ({ ...history, habit: { id: match.habitId, name: match.habit, drill: match.drill, recheck: match.recheck, since: match.date, matchId: match.id, baseline: match.aim || null } });
  const dropHabit = (history) => ({ ...history, habit: null });
  /** better, same, or worse against the baseline: half a head of change over 3 or more duels each counts. */
  function compareAim(baseline, now) {
    if (!(baseline?.n >= 3) || !(now?.n >= 3)) return null;
    const d = Math.abs(now.heads) - Math.abs(baseline.heads);
    return Math.abs(d) < 0.5 ? 'same' : d < 0 ? 'better' : 'worse';
  }
  function historyBrief(history) {
    const h = history?.habit, lines = [];
    if (h) {
      lines.push(`Working on: ${h.name} (habit_id ${h.id}), since ${h.since}.`);
      if (h.baseline) lines.push(`Baseline: ${aimText(h.baseline)}, median of ${h.baseline.n} duels.`);
      if (h.drill) lines.push(`Their drill: ${h.drill}`);
      if (h.recheck) lines.push(`What to recheck: ${h.recheck}`);
    }
    const recent = (history?.matches || []).slice(-5).map((m) => `${m.date}: ${m.found ? m.habit : 'no single habit'}${m.progress ? ` (${m.progress} than baseline)` : ''}`);
    if (recent.length) lines.push(`Recent reviews:\n${recent.join('\n')}`);
    return lines.join('\n') || 'First review for this player.';
  }

  const api = {
    mmss, parseTime, median, round, clamp, aimBand, aimOffset, headOnBody, summarizeAim, aimText,
    BudgetError, createBudget, left, spend, budgetLine,
    SLACK, MIN_EVIDENCE, createLedger, recordLook, seen, checkFinish,
    STATUSES, applyNote, boardBrief, KINDS, normalizeEvents, mergeEvents, eventsBrief,
    MAX_FRAMES, framePlan, regionRect,
    emptyHistory, addMatch, acceptHabit, dropHabit, compareAim, historyBrief,
  };
  root.ThirdeyeCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
