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
  const createBudget = ({ looks = 24, turns = 12 } = {}) => ({ looks, turns, used: { looks: 0, turns: 0 } });
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

  // ---------- when the player is dead ----------
  // After the player dies the screen shows a death recap, then a teammate's view, until the next round: no crosshair of
  // the player's to measure, and nothing they did. Kill-feed deaths are timed to a quarter second (agent.js feedStrips),
  // deaths from the low-detail pass to the second.
  const KILL_LEAD = 3; // seconds: a kill means they were alive and fighting this long before its line
  /**
   * How long a death keeps the player out, from the game profile's deadFor: the rest of a round (rounds) when the scan
   * found round starts, a respawn (respawn) when it found none, as in deathmatch. 5 s without a profile value.
   */
  const deadForOf = (profile, events) => ((events || []).some((e) => e.kind === 'round_start') ? profile?.deadFor?.rounds : profile?.deadFor?.respawn) ?? 5;
  /**
   * The player's death that t falls after, or null. A death runs from the last moment its kill-feed line wasn't there
   * (after; 1 s before the line when that isn't known) to the next round start, KILL_LEAD s before the player's next
   * kill (a revive, or a death that was misread), or deadFor s (deadForOf).
   */
  function deathAt(events, t, deadFor = 5) {
    for (const d of events || []) {
      if (d.kind !== 'death' || t <= (Number.isFinite(d.after) ? d.after : d.t - 1)) continue;
      const until = Math.min(d.t + deadFor, ...events.filter((e) => e.t > d.t && (e.kind === 'round_start' || e.kind === 'kill')).map((e) => (e.kind === 'kill' ? e.t - KILL_LEAD : e.t)));
      if (t < until) return d;
    }
    return null;
  }

  // ---------- why a finish was sent back ----------
  // Each send-back as a kind of reason, so the same reason counts again whatever moment or move it names.
  const PROBLEM_KINDS = [
    ['unseen', /haven't looked closely/],
    ['too_few', /Cite at least \d+ separate moments/],
    ['aim_count', /at least \d+ measure_aim readings/],
    ['aim_level', /crosshair on the (head|body)/],
    ['engine', /the engine scores|no move of theirs/],
    ['no_shots', /ammo counter doesn't change/],
    ['after_death', /the player was dead/],
    ['won_fight', /haven't looked at a fight they won/],
    ['same_moment', /same moment as other evidence|in both evidence and contrast/],
  ];
  const problemKind = (text) => PROBLEM_KINDS.find(([, re]) => re.test(text))?.[0] || 'other';

  // ---------- retries ----------
  // Re-measuring a fight a moment earlier, again and again, hunts for the reading a theory wants. A second try is fair
  // (the first can land on the kill-feed line or the death), a third isn't.
  const MAX_TRIES = 2;
  /** The player's fight a moment belongs to: the first of their kills or deaths whose kill-feed line comes within 4 s after it. */
  const fightOf = (events, t) => (events || []).find((e) => (e.kind === 'kill' || e.kind === 'death') && e.t >= t - 0.5 && e.t - t <= 4) || null;
  /** Why measuring at t is refused, or '': MAX_TRIES tries in its fight already (within 1.5 s outside any fight). tried: earlier times. */
  function retryRefusal(events, tried, t) {
    const f = fightOf(events, t);
    const same = (tried || []).filter((x) => (f ? fightOf(events, x) === f : Math.abs(x - t) < 1.5));
    if (same.length < MAX_TRIES) return '';
    return `You've measured ${f ? `the fight that ends at ${mmss(f.t)} (${f.kind === 'kill' ? 'their kill' : 'their death'})` : `around ${mmss(t)}`} ${same.length} times already (${same.map((x) => mmss(x, true)).join(', ')}). Another try a moment earlier won't change what it shows: measure a different fight, or decide with what you have.`;
  }

  /**
   * The problems with a finish call, or [] when it can stand. Sent back to the agent to fix. shots: [{ t, fired }] from
   * the ammo counter for the cited moments, for a habit the profile marks needsShots.
   */
  // How far below the head center the crosshair can sit before it's low, by where good players aim in the game (the
  // research's aimTarget): at heads, past the head itself; at bodies, below the body (about the waist).
  const LOW_FROM = { head: 0.75, body: 3.5 };
  const TARGET_WORD = { head: 'the head', body: 'the body' };
  function checkFinish(args, { ledger, duration = Infinity, habits = [], measures = [], events = [], deadFor = 5, shots = [], aimTarget = 'head' }) {
    const problems = [];
    if (args?.found === false) {
      if (text(args.why).length < 20) problems.push('Say why no single habit stands out (why, one or two sentences).');
      return problems;
    }
    // the death itself can be evidence (dying alone); seconds later the screen is a recap or a teammate's view
    const afterDeath = (t) => { const d = deathAt(events, t, deadFor); return d && t > d.t + 2 ? `At ${mmss(t)} the player was dead (they died about ${mmss(d.t)}), so the screen shows someone else. Cite moments from their own view.` : ''; };
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
      if (afterDeath(t)) { problems.push(afterDeath(t)); continue; }
      if (kept.some((x) => Math.abs(x - t) < MIN_GAP)) { problems.push(`${mmss(t)} is the same moment as other evidence.`); continue; }
      kept.push(t);
    }
    // a habit about how they fire needs moments where they fired: an ammo counter that never moved says they didn't
    const habit = habits.find((h) => h.id === args?.habit_id);
    if (habit?.needsShots) {
      for (const t of [...kept]) {
        if (shots.find((x) => Math.abs(x.t - t) < 0.05)?.fired !== false) continue;
        problems.push(`At ${mmss(t)} the ammo counter doesn't change, so the player didn't fire and the moment can't show ${habit.name ? habit.name.toLowerCase() : habit.id}. If the moments you looked at don't show it, drop the theory (notes, status dropped) and name a habit they do show, or finish with found false.`);
        kept.splice(kept.indexOf(t), 1);
      }
    }
    if (kept.length < MIN_EVIDENCE) problems.push(`Cite at least ${MIN_EVIDENCE} separate moments you looked at that show the habit (you have ${kept.length}). Moments where they got it right go in contrast, not evidence. If fewer than ${MIN_EVIDENCE} moments show it, finish with found false.`);
    // a moment can show the habit or its opposite, not both
    for (const c of Array.isArray(args?.contrast) ? args.contrast : []) {
      const t = parseTime(c?.t);
      if (!Number.isFinite(t) || t < 0 || t > duration + 1) { problems.push(`${c?.t ?? '?'} in contrast isn't a time in this match.`); continue; }
      if (!seen(ledger, t)) problems.push(`You haven't looked closely at ${mmss(t)} (in contrast).`);
      else if (afterDeath(t)) problems.push(afterDeath(t));
      if (kept.some((x) => Math.abs(x - t) < MIN_GAP)) problems.push(`${mmss(t)} is in both evidence and contrast. Keep it where it belongs.`);
    }
    // a habit an engine checks (chess) cites the player's own moves, and the engine has to call each one a mistake
    if (habit?.measuredBy === 'engine') {
      for (const t of kept) {
        const m = events.filter((e) => e.kind === 'move' && Math.abs(e.t - t) <= 2).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
        if (!m) problems.push(`There's no move of theirs at ${mmss(t)}. Cite the moments their moves land.`);
        else if (!m.grade) problems.push(`At ${mmss(t)} the engine scores ${m.san} as fine (it gave away ${m.loss} centipawns), so that move doesn't show this habit. Drop the theory and name a habit the evidence shows, or finish with found false.`);
      }
    }
    // a habit the profile measures by aim has to agree with the aim the coach measured, judged against where good
    // players aim in this game
    if (habit?.measuredBy === 'aim') {
      const sum = summarizeAim(measures), low = LOW_FROM[aimTarget] ?? LOW_FROM.head, where = TARGET_WORD[aimTarget] ?? TARGET_WORD.head;
      if (!(sum?.n >= 3)) problems.push(`Crosshair height can be measured, so back this with at least 3 measure_aim readings where an enemy was in view (you have ${sum?.n || 0}). If the fights don't give 3, drop the theory and name a habit the evidence shows, or finish with found false.`);
      else if (sum.heads <= low) problems.push(`Your measurements put the crosshair on ${where}, where good players in this game aim (median ${sum.heads} heads below the head over ${sum.n} fights), so this isn't the habit. Drop the theory (notes, status dropped) and name a habit the evidence shows, or finish with found false.`);
      for (const t of kept) {
        const m = measures.find((x) => Math.abs(x.t - t) <= 1 && Number.isFinite(x.heads));
        if (m && m.heads <= low) problems.push(`At ${mmss(t)} you measured the crosshair on ${where} (${m.heads} heads below the head), so that moment doesn't show this habit.`);
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
  /**
   * Adds or updates a theory. Returns the new board and what changed: new, updated, or the status it moved to. With a
   * ledger, a theory is supported only once one of its moments was looked at closely; until then it stays testing, and
   * problem says why.
   */
  function applyNote(board, { id, theory, status, evidence }, { ledger } = {}) {
    if (!STATUSES.includes(status)) throw new Error(`status must be one of: ${STATUSES.join(', ')}.`);
    const next = board.map((x) => ({ ...x, evidence: [...x.evidence], history: [...x.history] }));
    const found = next.find((x) => (id && x.id === id) || (theory && norm(x.theory) === norm(theory)));
    const ev = cleanEvidence(evidence);
    const all = [...(found?.evidence || []), ...ev];
    let problem = '';
    if (status === 'supported' && ledger && !all.some((e) => seen(ledger, e.t))) {
      status = 'testing';
      problem = `${found?.id || 'The new theory'} stays testing: none of its moments were looked at closely yet. Mark it supported once a look shows it.`;
    }
    if (found) {
      const was = found.status;
      found.status = status;
      for (const e of ev) if (!found.evidence.some((o) => Math.abs(o.t - e.t) < 0.5)) found.evidence.push(e);
      if (was !== status) found.history.push(status);
      return { board: next, theory: found, change: was === status ? 'updated' : status, ...(problem ? { problem } : {}) };
    }
    if (!text(theory)) throw new Error(id ? `No theory ${id}. Give the theory text to add it.` : 'Name the theory.');
    const added = { id: `T${next.length + 1}`, theory: text(theory).slice(0, 160), status, evidence: ev, history: [status] };
    next.push(added);
    return { board: next, theory: added, change: 'new', ...(problem ? { problem } : {}) };
  }
  const boardBrief = (board) => board.map((x) => `${x.id} ${x.status}: ${x.theory}${x.evidence.length ? ` (${x.evidence.map((e) => mmss(e.t)).join(', ')})` : ''}`).join('\n');

  // ---------- events from a scan ----------
  // kill and death are the player's own; ally_death and ally_kill are teammates'
  // move and opponent_move are chess moves, each with the engine's grade for it
  const KINDS = ['kill', 'death', 'ally_death', 'ally_kill', 'round_start', 'round_end', 'engagement', 'move', 'opponent_move', 'other'];
  function mergeEvents(a, b) {
    const out = [];
    // two chess moves of one side can land within 2 s in a fast game, so a numbered ply is its own event
    for (const e of [...a, ...b].sort((x, y) => x.t - y.t)) if (!out.some((o) => o.kind === e.kind && Math.abs(o.t - e.t) < 2 && nameKey(o.victim) === nameKey(e.victim) && o.ply === e.ply)) out.push(e);
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
  const eventsBrief = (events) => events.map((e) => `${mmss(e.t, !Number.isInteger(e.t))}${e.kind === 'engagement' ? `–${mmss(e.to, !Number.isInteger(e.to))}` : ''} ${e.kind}${e.text ? `: ${e.text}` : ''}`).join('\n');

  // ---------- the kill feed ----------
  // Gemini reads kill-feed names well but mixes up the team colors behind them, so the colors come from pixels here.
  // Hues in degrees; Valorant draws your team teal and the enemy red.
  const FEED_COLORS = { ally: [140, 190], enemy: [340, 12] };
  const TAIL = 0.35; // share of the kill feed's width that fingerprints a row's right end
  const inHue = (h, [a, b]) => (a <= b ? h >= a && h <= b : h >= a || h <= b);
  // 1 and 2: clearly ally or enemy. 3 and 4: the same hues, muted, as the game draws the ends of a row behind names
  // and portraits; trusted only inside a row already found from clear color.
  function pixelTeam(r, g, b, colors = FEED_COLORS) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
    if (sat < 0.12 || mx < 85) return 0;
    const hue = ((mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn)) * 60 + 360) % 360;
    const team = inHue(hue, colors.ally) ? 1 : inHue(hue, colors.enemy) ? 2 : 0;
    return team && (sat < 0.35 || mx < 110) ? team + 2 : team;
  }

  /**
   * The kill-feed rows in one crop, top to bottom: { y0, y1, left, right, fp }. left and right are the team color behind
   * the killer and the victim ('ally', 'enemy', or null); fp fingerprints the row's right end, where the victim's name
   * and portrait are, so a row can be told apart from new ones. img is { data (RGBA), width, height }, like ImageData.
   * grid { top, pitch, height, portrait } places the rows as fractions of the crop height, as the game draws them, and
   * portrait is the share of the width at the right edge taken by the victim's portrait; a slot holds a
   * row when a quarter or more of its right three-quarters is team color. Without a grid, rows are found as bands of
   * team color. Either way a colorful background can pass for a row, so sides read as one team come back null.
   */
  function killfeedRows(img, { colors = FEED_COLORS, grid } = {}) {
    const { data: d, width: w, height: h } = img;
    const kind = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) kind[i] = pixelTeam(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], colors);
    const isTeam = (x, y) => kind[y * w + x] === 1 || kind[y * w + x] === 2;
    let slots;
    if (grid) {
      slots = [];
      for (let k = 0; ; k++) {
        const y0 = Math.round((grid.top + k * grid.pitch) * h), y1 = Math.round(y0 + grid.height * h) - 1;
        if (y1 >= h) break;
        // each column's team color down the slot: the color on 30% or more of its lines, or none
        const n = y1 - y0 + 1, clear = [], col = [];
        for (let x = 0; x < w; x++) {
          let ally = 0, enemy = 0, sure = 0;
          for (let y = y0; y <= y1; y++) { const t = kind[y * w + x]; if (t === 1 || t === 3) ally++; else if (t === 2 || t === 4) enemy++; if (t === 1 || t === 2) sure++; }
          clear.push(sure / n >= 0.3);
          col.push(ally >= enemy && ally / n >= 0.3 ? 'ally' : enemy / n >= 0.3 ? 'enemy' : null);
        }
        const from = Math.round(w * 0.25);
        if (clear.slice(from).filter(Boolean).length / (w - from) < 0.25) continue;
        // Read from the right edge, where every row ends: the first run of color is the victim's, and the next
        // different color, right beside it, is the killer's. Names and the weapon icon leave gaps; a longer gap is
        // past the row's left end.
        // The victim's portrait sits at the very end and can carry either color, so the reading starts past it.
        const runs = [];
        let gap = 0, x0 = -1, x1 = -1;
        for (let x = w - 1; x >= 0; x--) if (col[x]) { x1 = x; break; }
        for (let x = w - 1 - Math.round((grid.portrait || 0) * w); x >= 0; x--) {
          const c = col[x];
          if (!c) { if (x0 >= 0 && ++gap > 60) break; continue; }
          gap = 0;
          x0 = x;
          const last = runs.at(-1);
          if (last && last.c === c) last.n++; else runs.push({ c, n: 1 });
        }
        const solid = runs.filter((r) => r.n >= 10);
        const victim = solid[0]?.c ?? null, killer = solid.find((r) => r.c !== victim)?.c ?? null;
        // a real row carries names in white text; a flash or a wall of the same colors doesn't
        const white = (a, b) => {
          let n = 0, tot = 0;
          for (let y = y0; y <= y1; y++) for (let x = Math.max(0, a); x <= b; x++) { const i = (y * w + x) * 4, mx = Math.max(d[i], d[i + 1], d[i + 2]); tot++; if (mx > 205 && (mx - Math.min(d[i], d[i + 1], d[i + 2])) / mx < 0.2) n++; }
          return n / Math.max(1, tot);
        };
        const mid = Math.round((x0 + x1) / 2);
        if (x1 < 0 || Math.max(white(x0, mid), white(mid, x1)) < 0.03) continue;
        slots.push({ y0, y1, x0, x1, left: killer, right: victim });
      }
        } else {
      let bands = [];
      const team = (y) => { let n = 0; for (let x = 0; x < w; x++) if (isTeam(x, y)) n++; return n; };
      for (let y = 0; y < h; y++) {
        if (team(y) <= w * 0.18) continue;
        const last = bands.at(-1);
        if (last && y - last.y1 <= 4) last.y1 = y; else bands.push({ y0: y, y1: y });
      }
      bands = bands.filter((b) => b.y1 - b.y0 >= 9);
      // two rows can touch and read as one band: split a band about twice the usual height
      const heights = bands.map((b) => b.y1 - b.y0 + 1), mid = median(heights) || 0;
      const usual = Math.min(...heights.filter((x) => x >= mid * 0.6), Infinity); // the smallest full-size row
      slots = bands.flatMap((b) => {
        const n = Number.isFinite(usual) ? Math.max(1, Math.round((b.y1 - b.y0 + 1) / usual)) : 1, step = (b.y1 - b.y0 + 1) / n;
        return Array.from({ length: n }, (_, k) => ({ y0: Math.round(b.y0 + k * step), y1: Math.round(b.y0 + (k + 1) * step) - 1 }));
      }).map(({ y0, y1 }) => {
        let x0 = w, x1 = -1;
        for (let y = y0; y <= y1; y++) for (let x = 0; x < w; x++) if (isTeam(x, y)) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
        return { y0, y1, x0, x1 };
      });
    }
    return slots.map((slot) => {
      const { y0, y1, x0, x1 } = slot;
      const side = (a, b) => {
        let ally = 0, enemy = 0;
        for (let y = y0; y <= y1; y++) for (let x = a; x <= b; x++) { const k = kind[y * w + x]; if (k === 1) ally++; else if (k === 2) enemy++; }
        return ally > enemy * 1.5 ? 'ally' : enemy > ally * 1.5 ? 'enemy' : null;
      };
      const span = Math.max(1, x1 - x0), edge = Math.round(span * 0.3);
      // The victim's name as white text: for each column between the portrait and the weapon side of the right end, how
      // white it is (gray pixels past 160, weighted by how bright). Text keeps its shape whatever shows through behind
      // the feed; graded rather than all-or-nothing, so a small, soft recording still has a shape.
      const fp = [];
      for (let x = Math.max(0, x1 - Math.round(w * TAIL)); x < x1 - Math.round(w * (grid?.portrait || 0)); x++) {
        let n = 0;
        for (let y = y0; y <= y1; y++) { const i = (y * w + x) * 4, mx = Math.max(d[i], d[i + 1], d[i + 2]); if (mx > 160 && (mx - Math.min(d[i], d[i + 1], d[i + 2])) / mx < 0.25) n += mx - 160; }
        fp.push(n);
      }
      // a kill is always between the teams: one color at both ends means the background showed through, so neither
      // end can be trusted
      let left = slot.left !== undefined ? slot.left : side(x0, x0 + edge), right = slot.right !== undefined ? slot.right : side(x1 - edge, x1);
      if (left && left === right) left = right = null;
      return { y0, y1, x0, x1, left, right, fp };
    });
  }
  /** For each pixel line of a kill-feed crop, how many of its pixels are clearly one team's color (muted: or a muted shade). */
  function teamLines(img, colors = FEED_COLORS, { muted = false } = {}) {
    const { data: d, width: w, height: h } = img, lines = new Array(h).fill(0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, k = pixelTeam(d[i], d[i + 1], d[i + 2], colors); if (k && (muted || k <= 2)) lines[y]++; }
    return lines;
  }
  /** Runs of pixel lines that are mostly one team's color, as a kill-feed row is: [{ y0, y1 }]. lines from teamLines. */
  function colorBands(lines, w) {
    const bands = [];
    let y0 = -1;
    for (let y = 0; y <= lines.length; y++) {
      if (y < lines.length && lines[y] > w * 0.18) { if (y0 < 0) y0 = y; continue; }
      if (y0 >= 0 && y - y0 >= 9) bands.push({ y0, y1: y - 1 });
      y0 = -1;
    }
    return bands;
  }
  /**
   * The grid moved to where this recording draws its rows. A stream layout or a scaled HUD can shift the feed, and a
   * slot that misses part of its row reads the name columns as no color. bands: colorBands from frames spread over the
   * recording; h: the crop height. Only bands about a row tall count (an overlay bar doesn't), the row height becomes
   * theirs, and the top is the one that starts the most of them on a slot. Fewer than 3 such bands: the grid as it is.
   */
  function fitGrid(grid, bands, h) {
    const tall = grid.height * h, pitch = grid.pitch * h;
    const rows = bands.filter((b) => b.y1 - b.y0 + 1 >= tall * 0.75 && b.y1 - b.y0 + 1 <= tall * 1.35);
    if (rows.length < 3) return grid;
    let best = 0, score = -1;
    for (let top = 0; top < pitch; top += 0.5) {
      const s = rows.reduce((sum, b) => { const off = (((b.y0 - top) % pitch) + pitch) % pitch; return sum + Math.max(0, 3 - Math.min(off, pitch - off)); }, 0);
      if (s > score) { score = s; best = top; }
    }
    return { ...grid, top: best / h, height: median(rows.map((b) => b.y1 - b.y0 + 1)) / h };
  }
  /** How different two rows' name shapes are, 0 (the same) to 1, at the best shift of up to 3 pixels. */
  function rowDistance(a, b) {
    let best = 1;
    for (let s = -3; s <= 3; s++) {
      let diff = 0, sum = 0;
      for (let i = Math.max(0, -s); i < a.length && i + s < b.length; i++) { diff += Math.abs(a[i] - b[i + s]); sum += a[i] + b[i + s]; }
      if (sum) best = Math.min(best, diff / sum);
    }
    return best;
  }
  const SAME_ROW = 0.3;
  // Two readings of one row, p earlier than r: the same victim's name, no side read as the other team, and not moved
  // against the feed. newRows (the profile grid's) says where new kills join: at the bottom, older rows only move up as
  // rows above them leave; at the top, they only move down.
  function sameRow(p, r, newRows = 'bottom') {
    const tol = (r.y1 - r.y0) * 0.3, moved = newRows === 'top' ? r.y0 >= p.y0 - tol : r.y0 <= p.y0 + tol;
    return moved && rowDistance(p.fp, r.fp) < SAME_ROW && !(p.left && r.left && p.left !== r.left) && !(p.right && r.right && p.right !== r.right);
  }
  /**
   * The rows in one crop that weren't in the feed a moment ago, so each kill-feed line is read once. A row that left the
   * feed never comes back, so `keep` only bridges a second or two when a flash or smoke hides it.
   * recent: what an earlier call returned ([] to start). Returns { fresh, recent }.
   */
  function freshRows(recent, rows, t, { keep = 3, newRows = 'bottom' } = {}) {
    const live = recent.filter((r) => t - r.t <= keep), used = new Set(), fresh = [];
    for (const r of rows) {
      const k = live.findIndex((p, i) => !used.has(i) && sameRow(p, r, newRows));
      if (k >= 0) { used.add(k); live[k] = { ...r, t }; continue; }
      fresh.push(r);
      used.add(live.push({ ...r, t }) - 1);
    }
    return { fresh, recent: live };
  }

  const nameKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function editDistance(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) { const keep = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = keep; }
    }
    return row[b.length];
  }
  // one misread letter in a longer name is still the same player
  const sameName = (a, b) => { const x = nameKey(a), y = nameKey(b); return x === y || (Math.min(x.length, y.length) >= 5 && editDistance(x, y) <= 1); };
  const mostCommon = (xs) => { const c = new Map(); for (const x of xs) if (x) c.set(x, (c.get(x) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };
  const other = (team) => (team === 'ally' ? 'enemy' : team === 'enemy' ? 'ally' : null);

  function feedText(e) {
    const you = (role) => e[role === 'killer' ? 'killerIsPlayer' : 'victimIsPlayer'];
    const name = (role) => (you(role) ? 'you' : `${e[role]}${e[`${role}Team`] === 'ally' ? ' (teammate)' : e[`${role}Team`] === 'enemy' ? ' (enemy)' : ''}`);
    const parts = [`${name('killer')} killed ${name('victim')}`];
    if (e.trades) parts.push(`trading ${e.trades}`);
    if (e.victimTeam === 'ally') parts.push(e.tradedBy ? `traded by ${sameName(e.tradedBy, e.player) ? 'you' : e.tradedBy} ${round(e.tradedAt - e.t, 1)} s later` : 'not traded');
    return parts.join('; ');
  }

  /**
   * Sightings from one read of numbered row strips: Gemini's names for each line, with that row's team colors from
   * pixels. strips: [{ t, after, left, right }] in line order, line 1 first; after is the last time the row wasn't there.
   */
  function feedSightings(read, strips) {
    return (Array.isArray(read) ? read : [])
      .map((r) => ({ r, s: strips[r?.line - 1] }))
      .filter(({ r, s }) => s && text(r.killer) && text(r.victim))
      .map(({ r, s }) => ({ t: s.t, ...(Number.isFinite(s.after) ? { after: s.after } : {}), killer: text(r.killer), victim: text(r.victim), killerSide: s.left ?? null, victimSide: s.right ?? null, mine: !!r.players_own }));
  }

  /**
   * The player's name, when they didn't type it. Two signals, each fooled on its own: Gemini marks rows with a yellow
   * marker (and sometimes a yellow agent portrait), and the low-detail pass catches deaths (and sometimes a teammate's).
   * The player is on the teal team, so only teammates count; each yellow mark scores 1 and each of the player's deaths
   * where the name is the victim scores 2. null when nobody scores 3 or more.
   */
  function choosePlayer(events, sightings, deathTimes = []) {
    const team = new Map();
    for (const e of events) for (const [n, t] of [[e.killer, e.killerTeam], [e.victim, e.victimTeam]]) if (t) { const v = team.get(nameKey(n)) || { ally: 0, enemy: 0 }; v[t]++; team.set(nameKey(n), v); }
    const teammate = (n) => { const v = team.get(nameKey(n)); return !!v && v.ally > v.enemy; };
    const score = new Map(), add = (n, k) => { if (teammate(n)) score.set(nameKey(n), (score.get(nameKey(n)) || 0) + k); };
    for (const s of sightings) if (s.mine) for (const n of new Set([s.killer, s.victim])) add(n, 1);
    for (const t of deathTimes) for (const n of new Set(events.filter((e) => Math.abs(e.t - t) <= 3 && e.victimTeam === 'ally').map((e) => e.victim))) add(n, 2);
    const [best, points] = [...score].sort((a, b) => b[1] - a[1])[0] || [];
    return best && points >= 3 ? mostCommon(sightings.flatMap((x) => [x.killer, x.victim]).filter((n) => nameKey(n) === best)) : null;
  }

  /**
   * Turns kill-feed sightings into events. sighting: { t, killer, victim, killerSide, victimSide, mine }, with
   * sides from killfeedRows and mine from the yellow marker on the player's rows. player: the player's name when it's
   * known some other way; otherwise it's the name on the most marked rows. One kill seen in several crops becomes one event, timed at
   * its first sighting. A death is traded when its killer dies to the other team within `trade` seconds.
   */
  function buildKillfeed(sightings, { window = 8, trade = 5, player: known = null } = {}) {
    const groups = [];
    for (const s of [...sightings].filter((x) => x?.killer && x?.victim && Number.isFinite(x.t)).sort((a, b) => a.t - b.t)) {
      const g = groups.find((x) => s.t - x.last <= window && sameName(x.killer, s.killer) && sameName(x.victim, s.victim));
      if (g) { g.list.push(s); g.last = s.t; } else groups.push({ killer: s.killer, victim: s.victim, last: s.t, list: [s] });
    }
    // the player is the name in the most rows with the yellow outline
    const mine = new Map();
    for (const s of sightings) if (s?.mine) for (const n of new Set([nameKey(s.killer), nameKey(s.victim)])) mine.set(n, (mine.get(n) || 0) + 1);
    const playerKey = [...mine].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const player = known || (playerKey ? mostCommon(sightings.flatMap((s) => [s.killer, s.victim]).filter((n) => nameKey(n) === playerKey)) : null);
    const events = groups.map((g) => {
      const killer = mostCommon(g.list.map((s) => s.killer)), victim = mostCommon(g.list.map((s) => s.victim));
      const killerIsPlayer = !!player && sameName(killer, player), victimIsPlayer = !!player && sameName(victim, player);
      let killerTeam = killerIsPlayer ? 'ally' : mostCommon(g.list.map((s) => s.killerSide));
      let victimTeam = victimIsPlayer ? 'ally' : mostCommon(g.list.map((s) => s.victimSide));
      if (!killerTeam) killerTeam = other(victimTeam);
      if (!victimTeam) victimTeam = other(killerTeam);
      const kind = killerIsPlayer ? 'kill' : victimIsPlayer ? 'death' : victimTeam === 'ally' ? 'ally_death' : killerTeam === 'ally' ? 'ally_kill' : 'other';
      return { t: round(g.list[0].t, 2), ...(Number.isFinite(g.list[0].after) ? { after: g.list[0].after } : {}), kind, killer, victim, killerTeam, victimTeam, killerIsPlayer, victimIsPlayer, seen: g.list.length, player };
    });
    // A flash or smoke over the kill feed can tint one reading. Names seen on one team again and again outvote it; a
    // name on both teams (both can pick the same agent) is never trusted this way.
    // Twice: fixing a flipped kill first makes the names' records cleaner for the kills read as one team.
    for (let pass = 0; pass < 2; pass++) {
      const votes = new Map();
      for (const e of events) {
        if (!e.killerTeam || e.killerTeam === e.victimTeam) continue;
        for (const [n, team] of [[e.killer, e.killerTeam], [e.victim, e.victimTeam]]) { const v = votes.get(nameKey(n)) || { ally: 0, enemy: 0 }; v[team]++; votes.set(nameKey(n), v); }
      }
      // what the other kills say about a name, leaving out the kill being judged
      const roster = (n, e, role) => {
        const v = { ...(votes.get(nameKey(n)) || { ally: 0, enemy: 0 }) };
        if (e.killerTeam && e.killerTeam !== e.victimTeam) v[e[`${role}Team`]]--;
        const total = v.ally + v.enemy, top = v.ally >= v.enemy ? 'ally' : 'enemy';
        return total >= 2 && v[top] / total >= 0.8 ? top : null;
      };
      for (const e of events) {
        if (e.killerIsPlayer || e.victimIsPlayer) continue;
        const k = roster(e.killer, e, 'killer'), v = roster(e.victim, e, 'victim');
        if (!e.killerTeam || e.killerTeam === e.victimTeam) {
          // a kill can't be on one team: trust whichever name the other kills settle
          const killerTeam = v ? other(v) : k;
          if (killerTeam) { e.killerTeam = killerTeam; e.victimTeam = other(killerTeam); }
        } else if (k && v && k !== v && k !== e.killerTeam) {
          // both names say the colors were flipped
          e.killerTeam = k; e.victimTeam = v;
        }
        e.kind = e.victimTeam === 'ally' ? 'ally_death' : e.killerTeam === 'ally' ? 'ally_kill' : 'other';
      }
    }
    for (const e of events) {
      const revenge = events.find((x) => x.t >= e.t && x !== e && x.t - e.t <= trade && sameName(x.victim, e.killer) && x.victimTeam === e.killerTeam);
      if (revenge && e.victimTeam === 'ally') { e.tradedBy = revenge.killer; e.tradedAt = revenge.t; revenge.trades = e.victimIsPlayer ? 'your death' : e.victim; }
    }
    for (const e of events) e.text = feedText(e);
    return { player, events };
  }

  // ---------- shots, from the ammo counter ----------
  // The magazine count is the biggest number in the profile's ammo region, and it drops by one with every bullet. Code
  // finds its digits by the HUD's text color (the profile's hudText, white by default) and records their shape, so a
  // shot is a change of shape.
  const HUD_TEXT = { bright: 190, sat: 0.22 }; // white
  /** The magazine digits' shape in one ammo crop: { x0, x1, mag } (a column profile), or null with no digits. */
  function ammoReading({ data: d, width: w, height: h }, hud = HUD_TEXT) {
    const on = (i) => { const mx = Math.max(d[i], d[i + 1], d[i + 2]); return mx > hud.bright && (mx - Math.min(d[i], d[i + 1], d[i + 2])) / mx < hud.sat; };
    const top = new Array(w).fill(-1), bot = new Array(w).fill(-1);
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if (on((y * w + x) * 4)) { if (top[x] < 0) top[x] = y; bot[x] = y; }
    const tall = top.map((t, x) => (t < 0 ? 0 : bot[x] - t + 1)), max = Math.max(...tall);
    if (max < h * 0.2) return null;
    // the magazine digits are the tallest glyphs; separators and the reserve count are shorter
    const cols = tall.map((v, x) => (v >= max * 0.75 ? x : -1)).filter((x) => x >= 0);
    const x0 = cols[0], x1 = cols.at(-1), y0 = Math.min(...cols.map((x) => top[x])), y1 = Math.max(...cols.map((x) => bot[x]));
    const mag = [];
    for (let x = x0; x <= x1; x++) { let n = 0; for (let y = y0; y <= y1; y++) if (on((y * w + x) * 4)) n++; mag.push(n); }
    return { x0, x1, mag };
  }
  const AMMO_SAME = 0.2;
  const ammoChanged = (a, b) => Math.abs(a.mag.length - b.mag.length) > 2 || Math.abs(a.x0 - b.x0) > 2 || rowDistance(a.mag, b.mag) >= AMMO_SAME;
  /**
   * Whether the player fired over a stretch, from ammo readings [{ t, reading }] in time order. Background showing behind
   * the HUD digits (a bright gun skin, a wall) changes their outline from frame to frame, so only steady readings count:
   * ones the next two frames read the same. The magazine at the first steady reading against the last says whether any
   * bullet left it; a swap or reload also reads as a change, so a change is never proof of firing, while no change is
   * proof of not firing. changes: the steady changes in between, roughly one a shot. null when the steady readings
   * span less than 60% of the stretch, since a burst could hide in the part that never read steadily.
   */
  function shotsFired(readings) {
    const steady = [];
    for (let i = 0; i + 2 < readings.length; i++) {
      const [a, b, c] = [readings[i], readings[i + 1], readings[i + 2]].map((x) => x.reading);
      if (a && b && c && !ammoChanged(a, b) && !ammoChanged(b, c)) steady.push(readings[i]);
    }
    if (steady.length < 2 || steady.at(-1).t - steady[0].t < 0.6 * (readings.at(-1).t - readings[0].t)) return null;
    let changes = 0;
    for (let i = 1; i < steady.length; i++) if (ammoChanged(steady[i - 1].reading, steady[i].reading)) changes++;
    return { fired: ammoChanged(steady[0].reading, steady.at(-1).reading), changes, from: steady[0].t, to: steady.at(-1).t };
  }

  // ---------- engagements ----------
  // A fight is the unit a coach judges: taking it, its position and timing, breaking off. Kills and deaths alone miss
  // the fights no one fell in, which can still decide a match.
  /**
   * When the player fired, from ammo readings over a stretch: each change between two steady readings (the next two
   * frames read the same). Automatic fire changes the digits faster than they hold steady, so a burst shows as one
   * change at its end: these mark firing, not each round.
   */
  function fireTimes(readings) {
    const steady = [];
    for (let i = 0; i + 2 < readings.length; i++) {
      const [a, b, c] = [readings[i], readings[i + 1], readings[i + 2]].map((x) => x.reading);
      if (a && b && c && !ammoChanged(a, b) && !ammoChanged(b, c)) steady.push(readings[i]);
    }
    const times = [];
    for (let i = 1; i < steady.length; i++) if (ammoChanged(steady[i - 1].reading, steady[i].reading)) times.push(steady[i].t);
    return times;
  }
  /** Firing times grouped into fights: bursts less than `gap` s apart are one. [{ from, to, bursts }], `pad` s around each. */
  function groupFights(times, { gap = 8, pad = 1.5 } = {}) {
    const out = [];
    for (const t of [...times].sort((x, y) => x - y)) {
      const last = out.at(-1);
      if (last && t - last.to <= gap) { last.to = t; last.bursts++; } else out.push({ from: t, to: t, bursts: 1 });
    }
    return out.map((f) => ({ from: round(Math.max(0, f.from - pad), 1), to: round(f.to + pad, 1), bursts: f.bursts }));
  }
  /**
   * Fights as one list of engagement events, from what the low-detail pass saw (seen), the player's kills and deaths
   * (events), damage they dealt read off a damage counter (hits), and firing read off the ammo counter (firing).
   * Counter changes alone aren't a fight: a reload, a weapon swap, or picking up ammo changes the ammo counter, and a
   * learned "damage" box can hold another number that changes. So firing and hits only extend a fight that the pass, a
   * kill, or a death shows.
   * Overlapping ones become one, spanning all. Each takes its outcome (won, lost, none) from the pass, else from the
   * player's kills and deaths inside it: a death means lost, a kill won, neither none.
   */
  function mergeFights(firing = [], seen = [], events = [], hits = []) {
    const valid = (f) => Number.isFinite(f.from) && Number.isFinite(f.to) && f.to >= f.from;
    const anchors = [
      ...seen.filter(valid).map((f) => ({ ...f, source: 'seen' })),
      ...events.filter((e) => e.kind === 'kill' || e.kind === 'death').map((e) => ({ from: e.t - 4, to: e.t + 1, source: e.kind })),
    ];
    const near = (f, a) => f.from <= a.to + 3 && f.to >= a.from - 3;
    const backed = [...firing.filter(valid).map((f) => ({ ...f, source: 'firing' })), ...hits.filter(valid).map((f) => ({ from: f.from, to: f.to, source: 'hits', hits: f.bursts }))].filter((f) => anchors.some((a) => near(f, a)));
    const all = [...anchors, ...backed].sort((x, y) => x.from - y.from);
    const merged = [];
    for (const f of all) {
      const last = merged.at(-1);
      if (last && f.from <= last.to + 1) {
        last.to = Math.max(last.to, f.to); last.bursts += f.source === 'firing' ? f.bursts || 0 : 0; last.hits += f.hits || 0;
        if (f.outcome) last.outcome ||= f.outcome; if (f.text) last.text ||= f.text; last.sources.add(f.source);
      } else merged.push({ ...f, bursts: f.source === 'firing' ? f.bursts || 0 : 0, hits: f.hits || 0, sources: new Set([f.source]) });
    }
    return merged.map((f) => {
      const inside = (kind) => events.some((e) => e.kind === kind && e.t >= f.from - 1 && e.t <= f.to + 3);
      const outcome = ['won', 'lost', 'none'].includes(f.outcome) ? f.outcome : inside('death') ? 'lost' : inside('kill') ? 'won' : 'none';
      const said = [outcome === 'none' ? 'no one fell' : outcome, f.hits ? `dealt damage ${f.hits} time${f.hits === 1 ? '' : 's'}` : null, f.bursts ? `fired in ${f.bursts} burst${f.bursts === 1 ? '' : 's'}` : null, f.text].filter(Boolean).join('; ');
      return { t: round(f.from, 1), from: round(f.from, 1), to: round(f.to, 1), kind: 'engagement', outcome, bursts: f.bursts, hits: f.hits, seenBy: [...f.sources].sort().join('+'), text: said };
    });
  }

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
  const acceptHabit = (history, match) => ({ ...history, habit: { id: match.habitId, name: match.habit, game: match.game || null, drill: match.drill, recheck: match.recheck, since: match.date, matchId: match.id, baseline: match.aim || null } });
  /**
   * The history as one game sees it: the habit being worked on only when it came from this game, and only this game's
   * reviews. A chess review shouldn't be told about a shooter habit. Games compare by name, ignoring case.
   */
  function historyFor(history, game) {
    const same = (g) => String(g || '').toLowerCase() === String(game || '').toLowerCase();
    return { ...history, habit: history?.habit && same(history.habit.game ?? history.habit.gameId) ? history.habit : null, matches: (history?.matches || []).filter((m) => same(m.game)) };
  }
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
    SLACK, MIN_EVIDENCE, createLedger, recordLook, seen, deadForOf, deathAt, MAX_TRIES, fightOf, retryRefusal, problemKind, checkFinish,
    STATUSES, applyNote, boardBrief, KINDS, normalizeEvents, mergeEvents, eventsBrief,
    FEED_COLORS, pixelTeam, killfeedRows, teamLines, colorBands, fitGrid, rowDistance, sameRow, freshRows, nameKey, sameName, feedSightings, choosePlayer, buildKillfeed,
    ammoReading, shotsFired, fireTimes, groupFights, mergeFights, MAX_FRAMES, framePlan, regionRect,
    emptyHistory, addMatch, acceptHabit, historyFor, dropHabit, compareAim, historyBrief,
  };
  root.ThirdeyeCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
