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

  /**
   * The enemy head nearest the crosshair in one aim picture, from the players Gemini boxed in it ([{ head_2d, body_2d,
   * name_tag, teammate }]) and the name tags it boxed on their own ([{ text, box_2d }]), all [ymin, xmin, ymax, xmax]
   * 0-1000 with the crosshair at the center; null when there's none. Games write a name over teammates, so a player
   * read with a name or called a teammate is left out, and so is one under a name it boxed, matched by position: Gemini
   * called Apex's O5HK an enemy under the tag "◆ O5HK" (Oct 22). So is a head so near the top that a name over it would
   * be out of the picture: there FYR_rLayze's tag was above the crop. A name needs two letters; damage numbers have none.
   */
  // how far above a head a name over it can sit, in head-heights or body-heights, whichever is more: Apex's sat 0.85 to
  // 3.8 head-heights and 0.15 to 0.26 body-heights above, as Gemini boxed them at 5:55 to 5:59 (Oct 22)
  const TAG_HEADS = 3, TAG_BODY = 0.35;
  function enemyHead(players, tags = []) {
    const boxed = (b) => Array.isArray(b) && b.length === 4 && b.every((v) => Number.isFinite(+v)) && b[2] > b[0] && b[3] > b[1];
    const named = (text) => (String(text || '').match(/\p{L}/gu) || []).length >= 2;
    const names = (Array.isArray(tags) ? tags : []).filter((t) => boxed(t?.box_2d) && named(t.text)).map((t) => t.box_2d.map(Number));
    const clear = (p) => {
      const [y0, x0, y1, x1] = p.head_2d.map(Number), hw = x1 - x0, above = Math.max(TAG_HEADS * (y1 - y0), TAG_BODY * (p.body_2d[2] - p.body_2d[0]));
      return y0 >= above && !names.some((t) => t[2] >= y0 - above && t[2] <= (y0 + y1) / 2 && t[1] <= x1 + hw && t[3] >= x0 - hw);
    };
    const off = (b) => Math.hypot((b[1] + b[3]) / 2 - 500, (b[0] + b[2]) / 2 - 500);
    const heads = (Array.isArray(players) ? players : []).filter((p) => !p?.teammate && !named(p?.name_tag) && headOnBody(p.head_2d, p.body_2d) && clear(p)).map((p) => p.head_2d.map(Number));
    return heads.sort((a, b) => off(a) - off(b))[0] || null;
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
  const createBudget = ({ looks = 24, turns = 14 } = {}) => ({ looks, turns, used: { looks: 0, turns: 0 } });
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
   * How long a death keeps the player out, from the game profile's deadFor: the rest of a round (rounds) in a game
   * played in rounds or when the scan found round starts, a respawn (respawn) otherwise, as in deathmatch. 5 s without a
   * profile value.
   */
  const deadForOf = (profile, events) => (profile?.rounds || (events || []).some((e) => e.kind === 'round_start') ? profile?.deadFor?.rounds : profile?.deadFor?.respawn) ?? 5;
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

  // ---------- the player's losses ----------
  // A match is lost in the player's deaths, the fights they lost, and the times they nearly died, so a review looks at
  // each before it decides either way, LOSS_LOOKS of them when there are more.
  const LOSS_LOOKS = 4;
  const nearWhat = (e) => `a near-death (health ${e.hp} of ${e.of})`;
  /**
   * The player's deaths, near-deaths, and the fights they lost with no death of theirs in them, in time order, each
   * { t, what, seen }. A death is seen when a look covers it or the second before it; a fight when a look overlaps it.
   */
  function losses(events, ledger) {
    const deaths = (events || []).filter((e) => e.kind === 'death');
    const out = deaths.map((e) => ({ t: e.t, what: 'their death', seen: seen(ledger, e.t) || seen(ledger, e.t - 1) }));
    for (const e of (events || []).filter((x) => x.kind === 'near_death')) out.push({ t: e.t, what: nearWhat(e), seen: seen(ledger, e.t) || seen(ledger, e.t - 1) || seen(ledger, e.t - 2) });
    for (const e of (events || []).filter((x) => x.kind === 'point_lost')) out.push({ t: e.t, what: 'a point the other side scored', seen: seen(ledger, e.t) || seen(ledger, e.t - 3) });
    for (const f of (events || []).filter((e) => (e.kind === 'engagement' || e.kind === 'play') && e.outcome === 'lost')) {
      if (deaths.some((d) => d.t >= f.from - 1 && d.t <= f.to + 3)) continue;
      out.push({ t: f.from, what: f.kind === 'play' ? `a ${f.unit || 'play'} they lost` : 'a fight they lost', seen: ledger.looks.some((l) => l.to >= f.from - 1 && l.from <= f.to + 1) });
    }
    return out.sort((a, b) => a.t - b.t);
  }
  /**
   * Where the match was lost, as a finding has to show it: the player's deaths and near-deaths, the fights they lost, a
   * teammate's death near them that nobody traded (near from the clip read of that moment), and in chess the player's
   * moves the engine calls a mistake or worse. Each { from, to, what } spans the moments that can show it: the 6 s before
   * a death, a near-death, or an untraded teammate death to 2 s after, a lost fight with 2 s to spare, a graded move
   * from 3 s before it lands.
   */
  // deadFor (deadForOf): a teammate going down while the player is dead is no loss of theirs; the screen shows someone else
  function lossMoments(events, { deadFor = 5 } = {}) {
    const out = [];
    for (const e of events || []) {
      if (e.kind === 'death') out.push({ t: e.t, from: e.t - 6, to: e.t + 2, what: 'their death' });
      else if (e.kind === 'near_death') out.push({ t: e.t, from: e.t - 6, to: e.t + 2, what: nearWhat(e) });
      else if (e.kind === 'ally_death' && !e.tradedBy && e.near === true && !deathAt(events, e.t, deadFor)) out.push({ t: e.t, from: e.t - 6, to: e.t + 2, what: `${e.victim || 'a teammate'} down near them, not traded` });
      else if (e.kind === 'engagement' && e.outcome === 'lost') out.push({ t: e.from, from: e.from - 2, to: e.to + 2, what: 'a fight they lost' });
      else if (e.kind === 'point_lost') out.push({ t: e.t, from: e.t - 8, to: e.t + 1, what: 'a point the other side scored' });
      else if (e.kind === 'play' && e.outcome === 'lost') out.push({ t: e.from, from: e.from - 1, to: e.to + 1, what: `a ${e.unit || 'play'} they lost` });
      else if (e.kind === 'move' && e.grade) out.push({ t: e.t, from: e.t - 3, to: e.t + 1, what: `${e.san || 'a move'} (${e.grade})` });
    }
    return out.sort((a, b) => a.t - b.t);
  }
  /**
   * Teammates down that nobody traded, while the player was alive, whose nearness no clip read has settled: each may be
   * one of the player's losses, and only a read of its window tells. windows: [{ id, from, to, reading }].
   */
  function unreadDowns(events, windows, { deadFor = 5 } = {}) {
    return (events || []).filter((e) => e.kind === 'ally_death' && !e.tradedBy && e.near == null && !deathAt(events, e.t, deadFor))
      .map((e) => ({ t: e.t, what: `${e.victim || 'a teammate'} down`, window: (windows || []).find((w) => e.t >= w.from && e.t <= w.to)?.id || null }));
  }
  /**
   * In footage of a whole match (a broadcast, coaching film), the units of play (plays, points, possessions) the scan
   * listed whose clip read hasn't said yet whether the player won or lost them: until it does, any of them may be a
   * loss. windows: [{ id, from, to, unit, reading }].
   */
  const unreadUnits = (windows) => (windows || []).filter((w) => w.unit && !w.reading).map((w) => ({ t: w.from, what: `a ${w.unit} not read yet`, window: w.id || null }));
  const atLoss = (events, t, deadFor) => lossMoments(events, { deadFor }).some((l) => t >= l.from && t <= l.to);
  const MIN_LOSSES = 2; // separate losses a habit has to show at; with fewer in the match, no habit can be named
  /** Why the review can't decide yet, or '': fewer of the player's losses looked at than LOSS_LOOKS (or all, when fewer). */
  function lossGap(events, ledger) {
    const all = losses(events, ledger), need = Math.min(LOSS_LOOKS, all.length), got = all.filter((l) => l.seen).length;
    if (got >= need) return '';
    const missing = all.filter((l) => !l.seen).slice(0, 6).map((l) => `${mmss(l.t)} (${l.what})`).join(', ');
    return `Look at the fights they lost before deciding: ${got} of ${all.length} looked at, and a review needs ${need}. Not looked at yet: ${missing}.`;
  }

  // ---------- why a finish was sent back ----------
  // Each send-back as a kind of reason, so the same reason counts again whatever moment or move it names.
  const PROBLEM_KINDS = [
    // a field to fill in, not a reason the finding is wrong: it never counts toward deciding now (agent.js)
    ['format', /Give one specific drill|Say what to check in the next match|must be one of/],
    ['unseen', /haven't looked closely/],
    ['too_few', /Cite at least \d+ separate moments/],
    ['aim_count', /at least \d+ measure_aim readings/],
    ['aim_level', /crosshair on the (head|body)/],
    ['engine', /the engine scores|no move of theirs/],
    ['no_shots', /ammo counter doesn't change/],
    ['after_death', /the player was dead/],
    ['won_fight', /haven't looked at a fight they won/],
    ['same_moment', /same moment as other evidence|in both evidence and contrast/],
    ['board', /Put the finding on the board first/],
    ['losses', /fights they lost before deciding/],
    ['no_loss', /losing them games has to show where they lost/],
    ['contradicts', /goes against what the record shows/],
    ['frames', /the frames don't fit your claim/],
    ['no_reason', /Name the biggest reason they lost|has to show where they lost: at least one/],
    ['unshown', /the video doesn't show/],
  ];
  const problemKind = (text) => PROBLEM_KINDS.find(([, re]) => re.test(text))?.[0] || 'other';

  // ---------- controls for the claim checker ----------
  /**
   * Claims the record shows are false, planted unmarked among a finding's claims for the agent that checks them against
   * the video (agent.js verifyClaims): one that agrees with a control isn't checking, it's agreeing. Each is false in a
   * way the video shows: one of the player's kills called their death (no death of theirs from 6 s before to 8 s after
   * it), a death at a quiet moment (no death, near-death, kill, or point within QUIET s), a near-death called full
   * health, a point the other side scored called their own.
   * "Alive a second after a death" was tried first and isn't one: Valorant then shows a teammate's view, alive and
   * moving. Deaths count only when the record's were checked (sure). Nearest the finding's own moments first, so the
   * checker looks at the same stretches, but never at one of them. Returns up to max [{ t, what, control }].
   */
  const QUIET = 12, DEAD_LONG = 60;
  function controlClaims(events, moments, { sure = true, max = 2, duration = Infinity } = {}) {
    const near = (t) => Math.min(...(moments || []).map((m) => Math.abs(m.t - t)), Infinity);
    const taken = (t) => (moments || []).some((m) => Math.abs(m.t - t) < 6);
    const marks = (events || []).filter((e) => ['death', 'near_death', 'kill', 'point_won', 'point_lost', 'point'].includes(e.kind));
    const out = [];
    const deaths = (events || []).filter((e) => e.kind === 'death');
    for (const e of events || []) {
      if (e.kind === 'near_death') out.push({ t: e.t, what: "The player's health is full here.", control: true });
      else if (e.kind === 'point_lost') out.push({ t: e.t, what: "The player's own side scores here.", control: true });
      else if (e.kind === 'kill' && sure && !deaths.some((d) => d.t >= e.t - 6 && d.t <= e.t + 8)) out.push({ t: e.t, what: 'The player is killed here.', control: true });
    }
    // quiet moments near each cited one, a death there being false
    if (sure && marks.some((e) => e.kind === 'death')) {
      for (const m of moments || []) for (const d of [-QUIET - 6, QUIET + 6, -2 * QUIET, 2 * QUIET]) {
        const t = round(m.t + d, 1);
        // and not while they may still be dead: a League respawn takes 30 s and more, and "dies here" planted on its
        // death screen wasn't false enough to plant (Oct 22)
        if (t > 8 && t < duration - 3 && !marks.some((e) => Math.abs(e.t - t) <= QUIET) && !marks.some((e) => e.kind === 'death' && t > e.t && t - e.t < DEAD_LONG)) { out.push({ t, what: 'The player dies here.', control: true }); break; }
      }
    }
    const kept = [];
    for (const c of out.filter((c) => !taken(c.t)).sort((a, b) => near(a.t) - near(b.t))) if (kept.length < max && !kept.some((k) => Math.abs(k.t - c.t) < 6)) kept.push(c);
    return kept.sort((a, b) => a.t - b.t);
  }

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
  // board: the theory board, when a finding has to be a supported theory on it. coverLosses: the review has to have
  // looked at the player's losses (lossGap) before it decides either way.
  // citeLoss: a finding has to cite at least one moment where the match was lost (lossMoments).
  // A moment the coach cites can be the one that decided a loss, before it (led_to: that loss's time): the mistake is
  // often made seconds before the death, once the fight can't be won (the user, Oct 23: "the mistake wasn't made when I
  // died, it was made before"). It counts at that loss when the loss comes within LEAD_MAX s after it.
  const LEAD_MAX = 30;
  const ledTo = (e, t) => { const to = parseTime(e?.led_to); return Number.isFinite(to) && to >= t && to - t <= LEAD_MAX ? to : t; };
  function checkFinish(args, { ledger, duration = Infinity, habits = [], measures = [], events = [], deadFor = 5, shots = [], aimTarget = 'head', board = null, coverLosses = false, citeLoss = false }) {
    const problems = [];
    const gap = coverLosses ? lossGap(events, ledger) : '';
    if (gap) problems.push(gap);
    // the death itself can be evidence (dying alone); seconds later the screen is a recap or a teammate's view
    const afterDeath = (t) => { const d = deathAt(events, t, deadFor); return d && t > d.t + 2 ? `At ${mmss(t)} the player was dead (they died about ${mmss(d.t)}), so the screen shows someone else. Cite moments from their own view.` : ''; };
    if (args?.found === false) {
      if (text(args.why).length < 20) problems.push('Say how that cost them (why, one or two sentences).');
      // No habit repeats, but something still cost them: with any loss in the match, the biggest reason is named, as a
      // one-off, at moments that were looked at, one of them where they lost
      const all = citeLoss ? lossMoments(events, { deadFor }) : [];
      if (!all.length) return problems;
      const where = all.slice(0, 6).map((l) => `${mmss(l.t)} ${l.what}`).join(', ');
      if (!text(args.reason)) problems.push(`No habit has to repeat for something to have cost them. Name the biggest reason they lost in this match (reason), even if it happened once: what cost them the most at ${where}.`);
      const shown = [];
      for (const e of Array.isArray(args.fixes) ? args.fixes : []) {
        const t = parseTime(e?.t);
        if (!Number.isFinite(t) || t < 0 || t > duration + 1) { problems.push(`${e?.t ?? '?'} isn't a time in this match.`); continue; }
        if (!text(e.what)) problems.push(`Say what happens at ${mmss(t)}.`);
        if (!seen(ledger, t)) { problems.push(`You haven't looked closely at ${mmss(t)}. Look with frames, or cite a moment you did look at.`); continue; }
        if (afterDeath(t)) { problems.push(afterDeath(t)); continue; }
        shown.push(ledTo(e, t));
      }
      if (!shown.length) problems.push('Cite the moments you looked at that show the reason (fixes), each with what they should have done instead (better).');
      else if (!shown.some((t) => all.some((l) => t >= l.from && t <= l.to))) problems.push(`The reason they lost has to show where they lost: at least one of its moments at ${where}.`);
      return problems;
    }
    const ids = [...habits.map((h) => h.id), 'other'];
    if (!text(args?.habit)) problems.push('Name the habit (habit).');
    if (!ids.includes(args?.habit_id)) problems.push(`habit_id must be one of: ${ids.join(', ')}.`);
    if (text(args?.why).length < 20) problems.push('Explain how this habit cost fights (why).');
    if (text(args?.drill).length < 20) problems.push('Give one specific drill (drill).');
    if (!text(args?.recheck)) problems.push('Say what to check in the next match (recheck).');
    const kept = [], at = []; // at: the loss each moment counts at, its led_to when it decided one
    for (const e of Array.isArray(args?.evidence) ? args.evidence : []) {
      const t = parseTime(e?.t);
      if (!Number.isFinite(t) || t < 0 || t > duration + 1) { problems.push(`${e?.t ?? '?'} isn't a time in this match.`); continue; }
      if (!text(e.what)) problems.push(`Say what happens at ${mmss(t)}.`);
      if (!seen(ledger, t)) { problems.push(`You haven't looked closely at ${mmss(t)}. Look with frames or measure_aim, or cite a moment you did look at.`); continue; }
      if (afterDeath(t)) { problems.push(afterDeath(t)); continue; }
      if (kept.some((x) => Math.abs(x - t) < MIN_GAP)) { problems.push(`${mmss(t)} is the same moment as other evidence.`); continue; }
      kept.push(t);
      at.push(ledTo(e, t));
    }
    // a habit about how they fire needs moments where they fired: an ammo counter that never moved says they didn't
    const habit = habits.find((h) => h.id === args?.habit_id);
    if (habit?.needsShots) {
      for (const t of [...kept]) {
        if (shots.find((x) => Math.abs(x.t - t) < 0.05)?.fired !== false) continue;
        problems.push(`At ${mmss(t)} the ammo counter doesn't change, so the player didn't fire and the moment can't show ${habit.name ? habit.name.toLowerCase() : habit.id}. If the moments you looked at don't show it, drop the theory (notes, status dropped) and name a habit they do show, or finish with found false.`);
        const k = kept.indexOf(t);
        kept.splice(k, 1); at.splice(k, 1);
      }
    }
    if (kept.length < MIN_EVIDENCE) problems.push(`Cite at least ${MIN_EVIDENCE} separate moments you looked at that show the habit (you have ${kept.length}). Moments where they got it right go in contrast, not evidence. If fewer than ${MIN_EVIDENCE} moments show it, finish with found false.`);
    // The habit that's losing them games has to show up where they lost, and more than once: one loss is an incident.
    if (citeLoss && kept.length) {
      const all = lossMoments(events, { deadFor }), hit = all.filter((l) => at.some((t) => t >= l.from && t <= l.to));
      if (hit.length < MIN_LOSSES) {
        const where = all.slice(0, 6).map((l) => `${mmss(l.t)} ${l.what}`).join(', ');
        problems.push(`A habit that's losing them games has to show where they lost, at ${MIN_LOSSES} or more separate losses: their deaths, fights they lost, or teammates down near them that nobody traded. You cite ${hit.length} (in this match: ${where || 'none'}). If they don't show it, finish with found false.`);
      }
    }
    // the finding is the theory the review tested: supported on the board by the moments it cites, so a habit can't be
    // named that the board never backed
    if (board) {
      const backed = (t) => board.some((x) => x.status === 'supported' && x.evidence.some((e) => Math.abs(e.t - t) < MIN_GAP && seen(ledger, e.t)));
      const loose = kept.filter((t) => !backed(t));
      if (loose.length) problems.push(`Put the finding on the board first: a theory at status supported, with the moments that show it (send the notes with this finish). Not on a supported theory yet: ${loose.map((t) => mmss(t)).join(', ')}.${board.length ? ` The board now: ${boardBrief(board).replace(/\n/g, '; ')}.` : ''}`);
    }
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
  const KINDS = ['kill', 'death', 'near_death', 'ally_death', 'ally_kill', 'round_start', 'round_end', 'engagement', 'play', 'point_won', 'point_lost', 'point', 'ability', 'move', 'opponent_move', 'other'];
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
  // Gemini reads kill-feed names well but mixes up the team colors behind them, so the colors come from pixels here:
  // hue ranges in degrees, { ally, enemy }, measured from each recording (learn.js learnLayout). No game's are built in.
  const TAIL = 0.35; // share of the kill feed's width that fingerprints a row's right end
  const inHue = (h, [a, b]) => (a <= b ? h >= a && h <= b : h >= a || h <= b);
  // 1 and 2: clearly ally or enemy. 3 and 4: the same hues, muted, as the game draws the ends of a row behind names
  // and portraits; trusted only inside a row already found from clear color.
  function pixelTeam(r, g, b, colors) {
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
  function killfeedRows(img, { colors, grid } = {}) {
    if (!colors) return [];
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
        // a real row carries names in white text, in the middle half of its lines; a flash or a wall of the same colors
        // doesn't
        const white = (a, b) => {
          let n = 0, tot = 0;
          const q = Math.floor((y1 - y0 + 1) / 4);
          for (let y = y0 + q; y <= y1 - q; y++) for (let x = Math.max(0, a); x <= b; x++) { const i = (y * w + x) * 4, mx = Math.max(d[i], d[i + 1], d[i + 2]); tot++; if (mx > 205 && (mx - Math.min(d[i], d[i + 1], d[i + 2])) / mx < 0.2) n++; }
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
  function teamLines(img, colors, { muted = false } = {}) {
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
  const BANNER_WINDOW = 2.5; // s between a kill-feed row and the banner for the same kill
  const mostCommon = (xs) => { const c = new Map(); for (const x of xs) if (x) c.set(x, (c.get(x) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };
  const other = (team) => (team === 'ally' ? 'enemy' : team === 'enemy' ? 'ally' : null);

  /**
   * Each name's character (agent, hero, legend), from the portrait the kill feed draws by it, read with the name: kept only
   * when two or more reads of the name agree on it and it's two thirds of the reads that name one, so one squinted
   * portrait names nobody. Returns Map nameKey to character.
   */
  function feedCharacters(sightings) {
    const said = new Map();
    for (const s of sightings || []) for (const [who, c] of [[s.killer, s.killerChar], [s.victim, s.victimChar]]) if (text(who) && text(c)) (said.get(nameKey(who)) || said.set(nameKey(who), []).get(nameKey(who))).push(text(c));
    const out = new Map();
    for (const [k, list] of said) {
      const top = mostCommon(list.map((c) => c.toLowerCase())), n = list.filter((c) => c.toLowerCase() === top).length;
      if (top && n >= 2 && n >= (2 / 3) * list.length) out.set(k, list.find((c) => c.toLowerCase() === top));
    }
    return out;
  }

  function feedText(e) {
    const you = (role) => e[role === 'killer' ? 'killerIsPlayer' : 'victimIsPlayer'];
    // the character once: a feed that writes characters for names read "Sova (Sova, enemy)"
    const tag = (role) => [!sameName(e[`${role}Character`] || '', e[role] || '') && e[`${role}Character`], e[`${role}Team`] === 'ally' ? 'teammate' : e[`${role}Team`] === 'enemy' ? 'enemy' : ''].filter(Boolean).join(', ');
    const name = (role) => (you(role) ? 'you' : `${e[role]}${tag(role) ? ` (${tag(role)})` : ''}`);
    const parts = [`${name('killer')} ${e.knock ? 'knocked down' : 'killed'} ${name('victim')}${e.confirmed ? " (the screen's banner shows it too)" : ''}`];
    if (e.trades) parts.push(`trading ${e.trades}`);
    // a teammate's death untraded is the player's to have traded; their own, untraded, says nothing: often nobody was
    // left alive to trade it (the user, Oct 23: "I was the only one alive, how were they supposed to trade")
    if (e.victimTeam === 'ally') { if (e.tradedBy) parts.push(`traded by ${sameName(e.tradedBy, e.player) ? 'you' : e.tradedBy} ${round(e.tradedAt - e.t, 1)} s later`); else if (!e.victimIsPlayer) parts.push('not traded'); }
    if (e.kind === 'ally_death' && e.near != null) parts.push(e.near ? 'near you' : 'away from you');
    return parts.join('; ');
  }

  // the characters a read named from the portraits by each name, when it named any
  const chars = (r) => ({ ...(text(r?.killer_character) ? { killerChar: text(r.killer_character).slice(0, 30) } : {}), ...(text(r?.victim_character) ? { victimChar: text(r.victim_character).slice(0, 30) } : {}) });
  /**
   * Sightings from one read of numbered row strips: Gemini's names for each line, with that row's team colors from
   * pixels. strips: [{ t, after, left, right }] in line order, line 1 first; after is the last time the row wasn't there.
   */
  function feedSightings(read, strips) {
    return (Array.isArray(read) ? read : [])
      .map((r) => ({ r, s: strips[r?.line - 1] }))
      .filter(({ r, s }) => s && text(r.killer) && text(r.victim))
      .map(({ r, s }) => ({ t: s.t, ...(Number.isFinite(s.after) ? { after: s.after } : {}), killer: text(r.killer), victim: text(r.victim), ...chars(r), killerSide: s.left ?? null, victimSide: s.right ?? null, mine: !!r.players_own, ...(s.fp ? { fp: s.fp } : {}) }));
  }

  /**
   * The player's name, when they didn't type it. Two signals, each fooled on its own: Gemini marks rows with a yellow
   * marker (and sometimes a yellow agent portrait), and the low-detail pass catches deaths (and sometimes a teammate's).
   * The player is on the ally team, so only teammates count; each yellow mark scores 1 and each of the player's deaths
   * where the name is the victim scores 2. null when nobody scores 3 or more.
   */
  // banners: what the game's own banner said at some rows' times ({ t, says, name }, agent.js readBanners): the player
  // downed or eliminated someone, or was. A row it matches names the player outright, so it scores 3.
  function choosePlayer(events, sightings, deathTimes = [], banners = []) {
    const team = new Map();
    for (const e of events) for (const [n, t] of [[e.killer, e.killerTeam], [e.victim, e.victimTeam]]) if (t) { const v = team.get(nameKey(n)) || { ally: 0, enemy: 0 }; v[t]++; team.set(nameKey(n), v); }
    // The player is always on their own team, so a name the feed puts on the other team more than once in a while (two
    // players on one agent, Valorant's Omen on each side) can't be theirs: picked, every line of the other one would be
    // read as the player's.
    const teammate = (n) => { const v = team.get(nameKey(n)); return !!v && v.ally > v.enemy && v.enemy <= Math.max(1, v.ally * 0.1); };
    const score = new Map(), add = (n, k) => { if (teammate(n)) score.set(nameKey(n), (score.get(nameKey(n)) || 0) + k); };
    // A marked row is the player's kill or death, so the mark goes to its name on the player's side: a name both teams
    // show (two players on one agent) doesn't take it from the other side, and a row with that name on both sides
    // can't say whose mark it is.
    for (const s of sightings) if (s.mine && !sameName(s.killer, s.victim)) {
      const sides = [[s.killer, s.killerSide], [s.victim, s.victimSide]], ours = sides.filter(([, side]) => side === 'ally');
      for (const n of new Set((ours.length ? ours : sides).map(([n]) => n))) add(n, 1);
    }
    for (const t of deathTimes) for (const n of new Set(events.filter((e) => Math.abs(e.t - t) <= 3 && e.victimTeam === 'ally').map((e) => e.victim))) add(n, 2);
    // A game can show the banner for an assist too, and a read can borrow a name from the next picture, so banners
    // name the player only when every one that fits a single row points at the same name.
    const told = new Map();
    for (const b of banners) {
      const won = /^you_(downed|eliminated)$/.test(b.says), lost = /^you_were_/.test(b.says);
      if (!won && !lost) continue;
      const rows = events.filter((e) => Math.abs(e.t - b.t) <= BANNER_WINDOW && (!b.name || sameName(won ? e.victim : e.killer, b.name)));
      // a knock and the finish that follows can name one victim with two killers: then the banner can't say whose it was
      const names = new Set(rows.map((e) => nameKey(won ? e.killer : e.victim)));
      if (names.size === 1) { const n = won ? rows[0].killer : rows[0].victim; told.set(nameKey(n), { n, k: (told.get(nameKey(n))?.k || 0) + 1 }); }
    }
    if (told.size === 1) for (const { n, k } of told.values()) add(n, 3 * k);
    const [[best, points] = [], [, next = 0] = []] = [...score].sort((a, b) => b[1] - a[1]);
    // two names about as likely is a guess either way, so the player is asked
    return best && points >= 3 && points - next >= 2 ? mostCommon(sightings.flatMap((x) => [x.killer, x.victim]).filter((n) => nameKey(n) === best)) : null;
  }

  /**
   * Who the player is in a kill feed: the name they gave for this game, when it's in this feed; else choosePlayer's
   * pick; else the names to ask them about, the most-seen non-enemies first. { player } (null when there's no feed to
   * tell from) or { ask: [names] }.
   */
  // hint: the name the learn call read as the player's, offered first when the feed shows it (a cropped feed once
  // offered only its cut-off names, and the player couldn't pick theirs)
  function whoIsPlayer({ known = null, hint = null, events = [], sightings = [], deathTimes = [], banners = [] } = {}) {
    if (!sightings.length) return { player: known };
    if (known && sightings.some((s) => sameName(s.killer, known) || sameName(s.victim, known))) return { player: known };
    const picked = choosePlayer(events, sightings, deathTimes, banners);
    if (picked) return { player: picked };
    // the names to ask about: teammates, most seen first, leaving out a name the feed also shows on the other team (as
    // choosePlayer does)
    const seen = new Map();
    for (const e of events) for (const [n, team] of [[e.killer, e.killerTeam], [e.victim, e.victimTeam]]) {
      if (!nameKey(n) || !team) continue;
      const k = nameKey(n), c = seen.get(k) || { name: n, n: 0, other: 0 };
      if (team === 'enemy') c.other++; else c.n++;
      seen.set(k, c);
    }
    let ask = [...seen.values()].filter((c) => c.n && c.other <= Math.max(1, c.n * 0.1)).sort((a, b) => b.n - a.n).map((c) => c.name);
    const hinted = hint && sightings.map((s) => [s.killer, s.victim]).flat().find((n) => sameName(n, hint));
    if (hinted) ask = [hinted, ...ask.filter((n) => !sameName(n, hinted))];
    ask = ask.slice(0, 4);
    return ask.length ? { ask } : { player: null };
  }

  /**
   * Turns kill-feed sightings into events. sighting: { t, killer, victim, killerSide, victimSide, mine }, with
   * sides from killfeedRows and mine from the yellow marker on the player's rows. player: the player's name when it's
   * known some other way; otherwise it's the name on the most marked rows. One kill seen in several crops becomes one event, timed at
   * its first sighting. A death is traded when its killer dies to the other team within `trade` seconds.
   */
  // twoTeams: every kill is between the player's team and one other, as in Valorant. A battle royale has many teams, so
  // most kills are between two others, and a side the feed didn't show stays unknown.
  function buildKillfeed(sightings, { window = 8, trade = 5, player: known = null, twoTeams = true } = {}) {
    const chars = feedCharacters(sightings);
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
    // The player's own rows say which color is theirs: when most of them put the player on the other team's color, the
    // learned colors are the wrong way round (Marvel Rivals, Oct 22: PunK10's teammates read as the enemy), and every
    // row's sides swap.
    let flip = false;
    if (player && twoTeams) {
      let same = 0, wrong = 0;
      for (const g of groups) {
        const side = sameName(g.killer, player) ? mostCommon(g.list.map((s) => s.killerSide)) : sameName(g.victim, player) ? mostCommon(g.list.map((s) => s.victimSide)) : null;
        if (side === 'ally') same++; else if (side === 'enemy') wrong++;
      }
      flip = wrong > same && wrong >= 2;
    }
    const sideOf = (x) => (flip ? other(x) : x);
    const events = groups.map((g) => {
      const killer = mostCommon(g.list.map((s) => s.killer)), victim = mostCommon(g.list.map((s) => s.victim));
      const killerIsPlayer = !!player && sameName(killer, player), victimIsPlayer = !!player && sameName(victim, player);
      // in a two-team game the player's victim, and the player's killer, are on the other team
      let killerTeam = killerIsPlayer ? 'ally' : victimIsPlayer && twoTeams ? 'enemy' : sideOf(mostCommon(g.list.map((s) => s.killerSide)));
      let victimTeam = victimIsPlayer ? 'ally' : killerIsPlayer && twoTeams ? 'enemy' : sideOf(mostCommon(g.list.map((s) => s.victimSide)));
      if (twoTeams && !killerTeam) killerTeam = other(victimTeam);
      if (twoTeams && !victimTeam) victimTeam = other(killerTeam);
      const kind = killerIsPlayer ? 'kill' : victimIsPlayer ? 'death' : victimTeam === 'ally' ? 'ally_death' : killerTeam === 'ally' ? 'ally_kill' : 'other';
      // Squadmates can't take each other out, so a "kill" inside the player's team is a misread line (a chat message,
      // "FYR_rLayze: Thanks Silent Gaming."), not a kill. In a two-team feed, the color fix-ups below settle it instead.
      if (!twoTeams && killerTeam === 'ally' && victimTeam === 'ally') return null;
      const killerCharacter = chars.get(nameKey(killer)), victimCharacter = chars.get(nameKey(victim));
      return { t: round(g.list[0].t, 2), ...(Number.isFinite(g.list[0].after) ? { after: g.list[0].after } : {}), kind, killer, victim, killerTeam, victimTeam, killerIsPlayer, victimIsPlayer, seen: g.list.length, player, ...(killerCharacter ? { killerCharacter } : {}), ...(victimCharacter ? { victimCharacter } : {}), ...(g.list.every((s) => s.knock) ? { knock: true } : {}), ...(g.list[0].fp ? { fp: g.list[0].fp } : {}) };
    }).filter(Boolean);
    // A flash or smoke over the kill feed can tint one reading. Names seen on one team again and again outvote it; a
    // name on both teams (both can pick the same agent) is never trusted this way.
    // Twice: fixing a flipped kill first makes the names' records cleaner for the kills read as one team.
    for (let pass = 0; pass < (twoTeams ? 2 : 0); pass++) {
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
      // the killer taken out within trade s by the victim's own team: someone else taking them out isn't the team's trade
      const revenge = events.find((x) => x.t >= e.t && x !== e && x.t - e.t <= trade && sameName(x.victim, e.killer) && x.victimTeam === e.killerTeam && x.killerTeam === e.victimTeam);
      if (revenge && e.victimTeam === 'ally') { e.tradedBy = revenge.killer; e.tradedAt = revenge.t; revenge.trades = e.victimIsPlayer ? 'your death' : e.victim; }
    }
    for (const e of events) e.text = feedText(e);
    return { player, events, ...(flip ? { flipped: true } : {}) };
  }

  /** The share of kill-feed sightings with a name cut down to a letter or two: a box drawn short of the names. */
  const cutNames = (sightings) => { const xs = (sightings || []).filter((s) => s?.killer || s?.victim); return xs.length ? xs.filter((s) => [s.killer, s.victim].some((n) => n && nameKey(n).length <= 2)).length / xs.length : 0; };

  /**
   * Marks the player's own kills and deaths that the game's banner showed too (confirmed), from the banners read at those
   * rows' times: a kill needs one saying the player downed or eliminated someone, a death one saying they were.
   */
  function confirmByBanners(events, banners = []) {
    for (const e of events) {
      if (e.kind !== 'kill' && e.kind !== 'death') continue;
      const want = e.kind === 'kill' ? /^you_(downed|eliminated)$/ : /^you_were_/;
      if (banners.some((b) => want.test(b.says) && Math.abs(b.t - e.t) <= BANNER_WINDOW && (!b.name || sameName(e.kind === 'kill' ? e.victim : e.killer, b.name)))) { e.confirmed = true; e.text = feedText(e); }
    }
    return events;
  }

  // ---------- a kill feed of plain text ----------
  // Some games write the kill feed as text, with no colored bars to find its rows by (Apex Legends does). Its lines are
  // found by their text instead: bright pixels beside much darker ones, in bands, all ending on one edge.
  const TEXT = { bright: 190, edge: 70 };
  /**
   * The text lines in one crop of a plain-text kill feed, top to bottom: { y0, y1, x0, x1, left, right, fp }, the shape
   * killfeedRows gives, with no team colors (left, right null). fp fingerprints a line's right end by its brightness.
   */
  function textRows({ data: d, width: w, height: h }) {
    const lum = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) lum[i] = Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    const isText = (x, y) => { const k = y * w + x, v = lum[k]; return v >= TEXT.bright && v - Math.min(lum[k - 2], lum[k + 2]) >= TEXT.edge; };
    const per = new Array(h).fill(0);
    for (let y = 0; y < h; y++) for (let x = 2; x < w - 2; x++) if (isText(x, y)) per[y]++;
    const bands = [], least = Math.max(3, w * 0.01);
    for (let y = 0; y < h; y++) {
      if (per[y] < least) continue;
      const last = bands.at(-1);
      if (last && y - last.y1 <= 2) last.y1 = y; else bands.push({ y0: y, y1: y });
    }
    return bands.filter((b) => b.y1 - b.y0 + 1 >= 6 && b.y1 - b.y0 + 1 <= h * 0.2).map(({ y0, y1 }) => {
      y0 = Math.max(0, y0 - 3); y1 = Math.min(h - 1, y1 + 3);
      // the line's ends: its right end is the outermost column with text close beside more text, so a stray bright
      // pixel isn't one; its left end is where the text stops, before a gap wider than the line could hold (scenery
      // beside the feed can be bright too)
      const col = new Uint8Array(w);
      for (let x = 2; x < w - 2; x++) for (let y = y0; y <= y1; y++) if (isText(x, y)) { col[x] = 1; break; }
      const dense = (x) => { let n = 0; for (let k = Math.max(0, x - 8); k <= Math.min(w - 1, x + 8); k++) n += col[k]; return n >= 4; };
      let x1 = w - 1;
      while (x1 >= 0 && !(col[x1] && dense(x1))) x1--;
      let x0 = x1;
      for (let x = x1, gap = (y1 - y0 + 1) * 2.5; x >= 0 && x0 - x <= gap; x--) if (col[x]) x0 = x;
      const fp = [];
      for (let x = Math.max(0, x1 - Math.round(w * TAIL)); x <= x1; x++) { let n = 0; for (let y = y0; y <= y1; y++) n += Math.max(0, lum[y * w + x] - 160); fp.push(n); }
      return { y0, y1, x0, x1, left: null, right: null, fp };
    }).filter((r) => r.x1 - r.x0 >= w * 0.1);
  }
  /**
   * The edge a plain-text feed's lines share, from textRows over many crops of width w: { key: 'x1' or 'x0', at, tol }.
   * Most feeds right-align their lines; an overlay or scenery inside the crop doesn't line up with them. null when fewer
   * than 5 lines share one.
   */
  function textEdge(frames, w) {
    const all = frames.flat(), tol = Math.max(4, w * 0.015), bin = (x) => Math.round(x / tol);
    const modeOf = (xs) => { const n = new Map(); for (const x of xs) n.set(bin(x), (n.get(bin(x)) || 0) + 1); return [...n].sort((a, b) => b[1] - a[1])[0] || [0, 0]; };
    const right = modeOf(all.map((r) => r.x1)), left = modeOf(all.map((r) => r.x0));
    const [key, [at, n]] = right[1] >= left[1] ? ['x1', right] : ['x0', left];
    return n >= 5 ? { key, at: at * tol, tol: tol * 1.5 } : null;
  }
  const onEdge = (r, edge) => Math.abs(r[edge.key] - edge.at) <= edge.tol;
  /**
   * The kill feed's own band in a crop that reaches past it: new lines join at one end of the feed (newRows), so most new
   * lines show at that slot, and the feed runs FEED_ROWS rows from it. Lines outside are HUD rows above it or text in the
   * world below (on the Apex recording, 100 of 359). fresh: [{ row }] as freshRows found them. Returns [y0, y1] in px.
   */
  const FEED_ROWS = 6;
  function feedBand(fresh, newRows = 'top') {
    if (!fresh.length) return [0, Infinity];
    const tall = median(fresh.map((f) => f.row.y1 - f.row.y0 + 1)) || 1, bins = new Map();
    for (const f of fresh) { const b = Math.round((f.row.y0 + f.row.y1) / 2 / tall); bins.set(b, (bins.get(b) || 0) + 1); }
    const peak = [...bins].sort((a, b) => b[1] - a[1])[0][0] * tall, pitch = tall * 1.6;
    return newRows === 'top' ? [peak - tall, peak + FEED_ROWS * pitch] : [peak - FEED_ROWS * pitch, peak + tall];
  }
  const HUE_FAMILIES = [['red', 0, 20], ['orange', 20, 45], ['yellow', 45, 75], ['green', 75, 150], ['teal', 150, 200], ['blue', 200, 260], ['purple', 260, 340], ['red', 340, 360]];
  /**
   * The colors of a text-feed line's two names, from its own pixels: 'white' for plain text, else the hue family of its
   * text pixels; null with too little text. The line splits into runs of text at gaps of half its height (the space in
   * a name is narrower; an icon's gap is wider). The victim's name is the run at the line's right end; the killer's the
   * first run from the left that is dense like letters and wider than an icon, since thin scenery beside the feed passes
   * the text test too. { left, right }. img: one line's strip; x0 and x1: the line's ends in it (textRows).
   */
  const WORD_FILL = 0.15;
  function nameColors({ data: d, width: w, height: h }, { x0: from = 2, x1: to = w - 3 } = {}) {
    const lum = (k) => Math.max(d[k * 4], d[k * 4 + 1], d[k * 4 + 2]);
    const isText = (x, y) => { const k = y * w + x, v = lum(k); return x >= 2 && x < w - 2 && v >= TEXT.bright && v - Math.min(lum(k - 2), lum(k + 2)) >= TEXT.edge; };
    const x0 = Math.max(2, from), x1 = Math.min(w - 3, to);
    // the text's own height: the strip has room above and below it
    const per = [];
    for (let y = 0; y < h; y++) { let n = 0; for (let x = x0; x <= x1; x++) if (isText(x, y)) n++; per.push(n); }
    const tall = per.filter((n) => n >= (x1 - x0 + 1) * 0.02).length || h;
    const runs = [];
    let last = -Infinity;
    for (let x = x0; x <= x1; x++) {
      let n = 0;
      for (let y = 0; y < h; y++) if (isText(x, y)) n++;
      if (!n) continue;
      if (x - last > Math.max(4, tall * 0.45)) runs.push({ x0: x, x1: x, n: 0 });
      const r = runs.at(-1);
      r.x1 = x; r.n += n;
      last = x;
    }
    // a name is wider than an icon, which is about as wide as the text is tall
    const word = (r) => r.x1 - r.x0 + 1 >= tall * 1.2 && r.n / ((r.x1 - r.x0 + 1) * tall) >= WORD_FILL;
    const colorOf = (run) => {
      if (!run) return null;
      let plain = 0, n = 0;
      const hues = [];
      for (let y = 0; y < h; y++) for (let x = run.x0; x <= run.x1; x++) {
        if (!isText(x, y)) continue;
        const k = (y * w + x) * 4, r = d[k], g = d[k + 1], b = d[k + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        n++;
        if ((mx - mn) / mx < 0.25) { plain++; continue; }
        hues.push(((mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn)) * 60 + 360) % 360);
      }
      if (n < 12) return null;
      if (plain / n >= 0.6) return 'white';
      const hue = median(hues);
      return HUE_FAMILIES.find(([, a, b]) => hue >= a && hue < b)?.[0] || null;
    };
    const right = runs.at(-1), left = runs.slice(0, -1).find(word);
    return { left: colorOf(left), right: runs.length > 1 ? colorOf(right) : null, runs: runs.map((r) => [r.x0, r.x1, +(r.n / ((r.x1 - r.x0 + 1) * tall)).toFixed(2)]), tall };
  }
  /**
   * The kill sightings from every read of a plain-text feed's lines: [{ r: { kind, text, killer, victim }, st: strip
   * { id, t, after, colors, row } }], a line read once or twice. A line goes when any read of it calls it a message or
   * reads it as a chat line (a colon in its text or a name), since a single read can take one for a kill; a kill either
   * read finds stays, since a single read can miss one. Each read of a kill is a sighting.
   */
  function textFeedReads(rows) {
    const chat = (x) => /:/.test(x || '');
    const byLine = new Map();
    for (const x of rows || []) (byLine.get(x.st.id) || byLine.set(x.st.id, []).get(x.st.id)).push(x);
    const out = [];
    for (const reads of byLine.values()) {
      if (reads.some(({ r }) => r.kind === 'message' || chat(r.text?.split(/\s+/).slice(0, 3).join(' ')) || chat(r.killer) || chat(r.victim))) continue;
      for (const { r, st } of reads) {
        if (!['kill', 'knock'].includes(r.kind) || !text(r.killer) || !text(r.victim)) continue;
        out.push({ t: st.t, ...(Number.isFinite(st.after) ? { after: st.after } : {}), killer: text(r.killer), victim: text(r.victim), ...chars(r), killerColor: st.colors?.left ?? null, victimColor: st.colors?.right ?? null, killerSide: null, victimSide: null, mine: false, ...(r.kind === 'knock' ? { knock: true } : {}), ...(st.row?.fp ? { fp: st.row.fp } : {}) });
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }

  /**
   * Sightings from one read of numbered text-feed lines: [{ line, killer, victim, knock }], strips [{ t, after, colors }]
   * in line order, colors from the line's pixels (nameColors). Teams come after, from the colors over the whole feed
   * (teamsByColor).
   */
  function textFeedSightings(read, strips) {
    return (Array.isArray(read) ? read : []).map((r) => ({ r, s: strips[r?.line - 1] })).filter(({ r, s }) => s && text(r.killer) && text(r.victim)).map(({ r, s }) => ({
      t: s.t, ...(Number.isFinite(s.after) ? { after: s.after } : {}), killer: text(r.killer), victim: text(r.victim), ...chars(r),
      killerColor: s.colors?.left ?? null, victimColor: s.colors?.right ?? null, killerSide: null, victimSide: null, mine: false, ...(r.knock ? { knock: true } : {}), ...(s.row?.fp ? { fp: s.row.fp } : {}),
    }));
  }
  /**
   * Sides for a plain-text feed's names from their colors. A feed like that draws everyone outside the player's team in
   * one plain color and the player's team in others, so the color most names have is the other side (enemy) and any
   * other color is the player's team (ally). One line's colors can be off (a badge, scenery behind a short name), so
   * each name takes the color of most of its lines, the victim's end counting twice: it sits on the feed's own edge,
   * away from the scenery. With no color on 60% or more of the names, the feed doesn't color by team this way, and
   * sides stay unknown.
   */
  /**
   * Names read short, as a piece of a name seen more often ("r_Layze" off a chat line, for FYR_rLayze), mapped to the
   * full name, so a misread can't pass for another player. Pieces of 5 letters or more only.
   */
  function aliasNames(sightings) {
    const count = new Map();
    for (const s of sightings) for (const n of [s.killer, s.victim]) count.set(n, (count.get(n) || 0) + 1);
    const full = new Map();
    for (const n of count.keys()) {
      const k = nameKey(n);
      if (k.length < 5) continue;
      const m = [...count.keys()].filter((o) => o !== n && nameKey(o).length > k.length && nameKey(o).includes(k) && count.get(o) >= count.get(n)).sort((a, b) => count.get(b) - count.get(a))[0];
      if (m) full.set(n, m);
    }
    return sightings.map((s) => ({ ...s, killer: full.get(s.killer) || s.killer, victim: full.get(s.victim) || s.victim }));
  }
  function teamsByColor(sightings) {
    sightings = aliasNames(sightings);
    const votes = new Map(), lines = new Map(), vote = (n, c, k) => { if (!c) return; const v = votes.get(nameKey(n)) || new Map(); v.set(c, (v.get(c) || 0) + k); votes.set(nameKey(n), v); };
    for (const s of sightings) { vote(s.killer, s.killerColor, 1); vote(s.victim, s.victimColor, 2); }
    const color = new Map([...votes].map(([n, v]) => [n, [...v].sort((a, b) => b[1] - a[1])[0][0]]));
    const plain = mostCommon([...color.values()]);
    if (!plain || [...color.values()].filter((c) => c === plain).length / color.size < 0.6) return sightings;
    // A squad is a few names seen again and again, so a name joins it only when it's colored on two lines or more and
    // reads as a name (a letter in it): one colored reading is as likely a misread or a stream overlay.
    for (const s of sightings) for (const [n, c] of [[s.killer, s.killerColor], [s.victim, s.victimColor]]) if (c && c !== plain) lines.set(nameKey(n), (lines.get(nameKey(n)) || 0) + 1);
    const side = (n) => { const c = color.get(nameKey(n)); return !c ? null : c === plain ? 'enemy' : (lines.get(nameKey(n)) || 0) >= 2 && /[a-z]/i.test(n) ? 'ally' : null; };
    return sightings.map((s) => ({ ...s, killerSide: side(s.killer), victimSide: side(s.victim) }));
  }

  // ---------- the HUD's own counters ----------
  /**
   * When a counter that only goes up (damage dealt, kills) went up, from readings in time order: [{ t, value }], value
   * null where unreadable. A higher reading counts once the next two readings confirm it: as high, or within 2% for a
   * big number, whose last digit can blur (one confirming reading let misreads through). A misread spike the next reading falls back from is left out, and so is any
   * lower reading. The start is the first reading the next one confirms. Returns [{ t, by }]: t the first reading at
   * the new value.
   */
  // A running count never goes down, so a rise is real only when the readings after it stay up: most of the next
  // HOLD_READS (a K/D/A misread as 1/6/5 for 1/5/6 held for two readings in League, Oct 22, and read as a death).
  const HOLD_READS = 6;
  function counterRises(readings) {
    const r = (readings || []).filter((x) => Number.isFinite(x?.value));
    // the very next reading has to hold too: a counter that keeps rising (damage) clears a one-off overread later
    const holds = (v, i) => { const ok = (y) => y.value >= v - Math.floor(v * 0.02), next = r.slice(i + 1, i + 1 + HOLD_READS); return (!next.length || ok(next[0])) && next.filter(ok).length >= Math.ceil(next.length * 0.8); };
    const start = r.findIndex((x, i) => holds(x.value, i));
    if (start < 0) return [];
    const out = [];
    let last = r[start].value;
    for (let i = start + 1; i < r.length; i++) {
      const v = r[i].value;
      if (v > last && holds(v, i)) { out.push({ t: r[i].t, by: v - last }); last = v; }
    }
    return out;
  }
  /**
   * The kills the HUD's kill count shows that the kill feed doesn't: a rise with none of the player's kills within
   * slack s. Each becomes a kill event, seen by the HUD, with no victim named.
   */
  function hudKills(rises, events, { slack = 6 } = {}) {
    return (rises || []).filter((k) => !(events || []).some((e) => e.kind === 'kill' && Math.abs(e.t - k.t) <= slack))
      .map((k) => ({ t: k.t, kind: 'kill', seenBy: 'hud', text: `you got ${k.by === 1 ? 'a kill' : `${k.by} kills`} (the HUD's kill count went up)` }));
  }

  // ---------- the HUD's own record ----------
  // A game that counts the player's kills and deaths on screen (a K/D/A counter) or each side's score has the record
  // already: read every few seconds (agent.js readCounters), it says when they died, killed, or a side scored, where a
  // low-detail look at the video can take a low-health tint for a death or a goal for the other team's.
  const KNOWN_SHARE = 0.6; // of the readings: a counter read this often is known, so no rise in it means nothing happened
  const sideWords = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !['team', 'side', 'the', 'and'].includes(w));
  /** Whether two names for a side (a color, a team name) are the same side: they share a word. */
  const sameSide = (a, b) => { const x = sideWords(a); return x.length > 0 && sideWords(b).some((w) => x.includes(w)); };
  /**
   * The record from the HUD's counters. counts: { kills, deaths, scores: { side: [{ t, value }] }, cells } (agent.js
   * readCounters); side: the player's own side as the learn call named it. A rise that holds is one event; a point is
   * the player's side's (point_won), the other side's (point_lost), or, with the player's side unknown, just a point.
   * downs: deaths off the HP number reading 0. Returns { kills, deaths, downs, points, knows: { kills, deaths, health } }.
   */
  function hudRecord(counts, { side = '' } = {}) {
    // a series read only around fights is known by its own cells (mergeCounts' cellsFor)
    const knows = (xs, part) => { const n = counts?.cellsFor?.[part] ?? counts?.cells ?? 0; return n > 0 && (xs || []).length >= KNOWN_SHARE * n; };
    const rises = (xs, kind, text) => counterRises(xs).map((r) => ({ t: r.t, kind, seenBy: 'hud', by: r.by, text: text(r.by) }));
    const kills = rises(counts?.kills, 'kill', (by) => `you got ${by === 1 ? 'a kill' : `${by} kills`} (the HUD's kill count went up)`);
    const deaths = rises(counts?.deaths, 'death', () => "you died (the HUD's death count went up)");
    const points = [];
    for (const [name, xs] of Object.entries(counts?.scores || {})) {
      const kind = !side ? 'point' : sameSide(name, side) ? 'point_won' : 'point_lost';
      for (const r of counterRises(xs)) points.push({ t: r.t, kind, side: name, seenBy: 'hud', text: kind === 'point_won' ? `your side (${name}) scored (the scoreboard went up)` : kind === 'point_lost' ? `the other side (${name}) scored (the scoreboard went up)` : `${name} scored (the scoreboard went up)` });
    }
    // the HP number at 0 after it wasn't: one death per stretch at 0, however long the death screen
    const hp = (counts?.health || []).filter((x) => Number.isFinite(x?.value)), downs = [];
    hp.forEach((x, i) => { if (x.value === 0 && (i === 0 ? false : hp[i - 1].value > 0)) downs.push({ t: x.t, kind: 'death', seenBy: 'hud', text: "you died (your health read 0)" }); });
    return { kills, deaths, downs, points: points.sort((a, b) => a.t - b.t), knows: { kills: knows(counts?.kills, 'kill_count'), deaths: knows(counts?.deaths, 'kill_count'), health: knows(counts?.health, 'health') } };
  }
  /**
   * Two counter reads of one match as one (agent.js passLog: a sparse read through it, a fine one around what happened):
   * each series' readings together in time order, the first read's kept where both read a moment, a side's score under
   * one name (sameSide), and cellsFor: how many moments each part was asked at, for hudRecord's known share.
   */
  const SERIES = { damage: 'damage', kills: 'kill_count', deaths: 'kill_count', assists: 'kill_count', health: 'health', healthMax: 'health' };
  function mergeCounts(a, b) {
    const reads = [a, b].filter(Boolean);
    if (!reads.length) return null;
    const join = (...xs) => { const m = new Map(); for (const r of xs.flat()) if (r && !m.has(r.t)) m.set(r.t, r); return [...m.values()].sort((p, q) => p.t - q.t); };
    const out = { cells: reads.reduce((n, r) => n + (r.cells || 0), 0), calls: reads.reduce((n, r) => n + (r.calls || 0), 0), times: join(...reads.map((r) => (r.times || []).map((t) => ({ t })))).map((x) => x.t), scores: {}, cellsFor: {} };
    for (const k of Object.keys(SERIES)) out[k] = join(...reads.map((r) => r[k] || []));
    for (const r of reads) for (const [side, xs] of Object.entries(r.scores || {})) { const name = Object.keys(out.scores).find((k) => k === side || sameSide(k, side)) || side; out.scores[name] = join(out.scores[name] || [], xs); }
    for (const part of new Set(Object.values(SERIES).concat('scoreboard'))) out.cellsFor[part] = reads.filter((r) => !r.asked || r.asked.includes(part)).reduce((n, r) => n + (r.cells || 0), 0);
    return out;
  }
  /** Around each rise of a running count the sparse read found: from the reading before it to just after, to time it. */
  function riseSpans(counts, step) {
    const series = [counts?.kills, counts?.deaths, counts?.assists, ...Object.values(counts?.scores || {})];
    return series.flatMap((xs) => counterRises(xs).map((r) => [r.t - step - 1, r.t + 1]));
  }
  /** Around each low of the HP number a sparse read found, to find how low it went. */
  const lowSpans = (counts) => (counts?.health?.length ? nearDeaths(counts.health, { maxes: counts.healthMax }).map((n) => [n.t - 5, n.t + 5]) : []);
  /** Every step s inside any of the spans ([from, to]), within from..to, on the step's own grid, each once, in order. */
  function timesIn(spans, { from = 0, to = Infinity, step = 2 } = {}) {
    const out = new Set();
    for (const [a, b] of spans || []) for (let t = Math.max(from, Math.ceil(a / step) * step); t <= Math.min(to, b); t += step) out.add(+t.toFixed(2));
    return [...out].sort((x, y) => x - y);
  }
  /**
   * Where the player may have nearly died, off the HUD's HP number: it fell under NEAR_LOW of full health, with no
   * death of theirs from 8 s after it back to 2 s before (that's the death itself). One per stretch of low readings, at
   * its lowest. sure: the reading next to it was low too; read every 2 s, most dips show once (Marvel Rivals' 30 of 250
   * at 5:10), and one low number alone can be a misread, so those get a second look (agent.js confirmNear). Full health
   * is the HUD's own maximum read nearest that moment where it writes one (250 of 120/250; League's grows with each
   * level, 1373 to 1589 in ten minutes), else the health it reads most often. health, maxes: [{ t, value }], deaths:
   * [{ t }]. Returns [{ t, kind: 'near_death', hp, of, sure, seenBy, text }].
   */
  // NEAR_GAP: lows this far apart with no reading between, none high, are one low stretch: a new near-death needs health
  // seen back up first. Read only around fights, the HP number has gaps, and League's one dip at 4:30, regenerating, read
  // as three (4:30, 4:43, 5:07; Oct 23)
  const NEAR_DEATH = 0.25, NEAR_LOW = 0.4, NEAR_GAP = 90, MAX_NEAR = 10;
  const modeOf = (xs) => { const n = new Map(); for (const x of xs) n.set(x, (n.get(x) || 0) + 1); return [...n].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null; };
  function nearDeaths(health, { maxes = [], deaths = [] } = {}) {
    const hp = (health || []).filter((x) => Number.isFinite(x?.value) && Number.isFinite(x?.t)).sort((a, b) => a.t - b.t);
    const tops = (maxes || []).filter((x) => Number.isFinite(x?.value) && x.value > 0 && Number.isFinite(x?.t));
    const usual = modeOf(tops.map((x) => x.value)) ?? modeOf(hp.map((x) => x.value).filter((v) => v > 0));
    const fullAt = (t) => tops.filter((x) => Math.abs(x.t - t) <= MAX_NEAR).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0]?.value ?? usual;
    if (!usual || hp.length < 3) return [];
    const out = [];
    let run = [];
    const close = () => {
      const low = run.length ? run.reduce((a, b) => (b.value < a.value ? b : a)) : null;
      const full = low && fullAt(low.t);
      // under NEAR_LOW is a candidate: read every 2 s, a dip to 50 of 250 showed as 80 (Rivals 1:18), and the second
      // look a second either side of it finds the low; sure, without one: under NEAR_DEATH, the next reading low too
      if (low && !(deaths || []).some((d) => d.t >= low.t - 2 && d.t <= low.t + 8)) out.push({ t: low.t, kind: 'near_death', hp: low.value, of: full, sure: run.length >= 2 && low.value <= NEAR_DEATH * full, seenBy: 'hud', text: `your health fell to ${low.value} of ${full} (the HUD's health number)` });
      run = [];
    };
    for (const x of hp) {
      if (run.length && x.t - run.at(-1).t > NEAR_GAP) close();
      if (x.value > 0 && x.value <= NEAR_LOW * fullAt(x.t)) run.push(x); else close();
    }
    close();
    return out;
  }
  /**
   * A low-detail pass's events of one kind checked against the counter's rises of it: one with a rise within slack s
   * stays, at the counter's time; one without goes (dropped lists them); a rise the pass missed is added. readings: the
   * counter's own readings, when it wasn't read throughout (a failed call, a hidden HUD): an event with no reading within
   * GAP s on both sides of it can't be judged by it, and comes back in unjudged instead. keepTime: one that stays keeps
   * its own time (a kill feed's, surer than a counter's every 2 s).
   */
  const COVER_GAP = 6;
  const covered = (readings, t) => !readings || (readings.some((x) => x.t < t && x.t >= t - COVER_GAP) && readings.some((x) => x.t > t && x.t <= t + COVER_GAP));
  function trustCounter(events, rises, kind, { slack = 5, readings = null, keepTime = false } = {}) {
    const used = new Set(), dropped = [], unjudged = [], out = [];
    for (const e of events || []) {
      if (e.kind !== kind) { out.push(e); continue; }
      if (!covered(readings, e.t) && !(rises || []).some((x) => Math.abs(x.t - e.t) <= slack)) { unjudged.push(e); continue; }
      const r = (rises || []).find((x, i) => !used.has(i) && Math.abs(x.t - e.t) <= slack);
      if (!r) { dropped.push(e); continue; }
      used.add(rises.indexOf(r));
      out.push({ ...e, ...(keepTime ? {} : { t: r.t, seenBy: 'hud' }), text: `${e.text || kind} (the HUD agrees)` });
    }
    (rises || []).forEach((r, i) => { if (!used.has(i)) out.push(r); });
    return { events: out.sort((a, b) => a.t - b.t), dropped, unjudged };
  }
  /**
   * Fights a low-detail pass called lost (the player downed or killed) with no death of theirs in them now: the death was
   * a misread, so how they ended isn't known (none).
   */
  const settleFights = (events) => (events || []).map((e) => (e.kind === 'engagement' && e.outcome === 'lost' && !events.some((d) => d.kind === 'death' && d.t >= e.from - 1 && d.t <= e.to + 3) ? { ...e, outcome: 'none', text: `no death of theirs here after all; ${e.text}` } : e));
  /**
   * The player's deaths, one per death: a second within gap s of the last is the same one seen again (a revive line in
   * Marvel Rivals' kill feed read as a death at 4:31, three seconds after the real one).
   */
  const ONE_DEATH = 6;
  function oneDeathEach(events, gap = ONE_DEATH) {
    let last = -Infinity;
    return (events || []).filter((e) => { if (e.kind !== 'death') return true; const keep = e.t - last > gap; if (keep) last = e.t; return keep; });
  }
  /**
   * A low-detail pass's events with the scoreboard's points in hand: its own guesses at goals and points go (it gave
   * Rocket League goals to the wrong side), and so does a kill or a death within slack s of a point, a goal read as one.
   */
  const POINT_KINDS = ['point_won', 'point_lost', 'point'];
  const pointsTaken = (events, points, slack = 4) => (events || []).filter((e) => !POINT_KINDS.includes(e.kind) && !((e.kind === 'kill' || e.kind === 'death') && (points || []).some((p) => Math.abs(p.t - e.t) <= slack)));

  // ---------- every event, read as video ----------
  /**
   * The stretches to read as video: before s before to after s after each of the player's kills and deaths and each
   * teammate down, and the first seconds of each burst of firing the ammo counter shows (a fight with no one falling,
   * or a reload: the clip says which). Windows overlapping by 2 s or more become one, up to 14 s long. With more than
   * max, the most telling are kept: deaths, teammates down, kills, then firing alone. A line seen in the very first
   * sample (t under 0.5) happened before the recording, so it has no window.
   * events: from the kill feed; firing: [{ from, to }]. Returns [{ from, to, events, firing }] in time order.
   */
  const CLIP_RANK = { death: 4, near_death: 3, ally_death: 3, kill: 2 };
  // hits: fights from the damage-dealt counter (the player hit someone), ranked with kills
  // deadFor: a teammate going down while the player is dead gets no window; the player wasn't there
  function eventWindows(events, firing = [], { duration = Infinity, before = 7, after = 3, max = 16, hits = [], deadFor = 5 } = {}) {
    const items = [
      ...(events || []).filter((e) => CLIP_RANK[e.kind] && e.t > 0.5 && !(e.kind === 'ally_death' && deathAt(events, e.t, deadFor))).map((e) => ({ from: e.t - before, to: e.t + after, rank: CLIP_RANK[e.kind], events: [e], firing: [], hits: [] })),
      ...(hits || []).map((f) => ({ from: f.from - 2, to: Math.min(f.to + 2, f.from - 2 + before + after), rank: 2, events: [], firing: [], hits: [f] })),
      ...(firing || []).map((f) => ({ from: f.from - 2, to: Math.min(f.to + 2, f.from - 2 + before + after), rank: 1, events: [], firing: [f], hits: [] })),
    ].map((w) => ({ ...w, from: Math.max(0, w.from), to: Math.min(duration, w.to) })).filter((w) => w.to - w.from >= 2).sort((a, b) => a.from - b.from);
    const out = [];
    for (const w of items) {
      const last = out.at(-1);
      if (last && w.from <= last.to - 2 && Math.max(last.to, w.to) - last.from <= 14) {
        last.to = Math.max(last.to, w.to); last.rank = Math.max(last.rank, w.rank); last.events.push(...w.events); last.firing.push(...w.firing); last.hits.push(...w.hits);
      } else out.push({ ...w, events: [...w.events], firing: [...w.firing], hits: [...w.hits] });
    }
    return [...out].sort((a, b) => b.rank - a.rank || a.from - b.from).slice(0, max).sort((a, b) => a.from - b.from)
      .map(({ rank, ...w }) => ({ ...w, from: round(w.from, 1), to: round(w.to, 1) }));
  }
  /**
   * The fights, from the clip read of each window: one engagement per window, unless the clip shows no fight there and
   * the kill feed has nothing in it (a reload or a weapon swap). Its outcome is the kill feed's (a death of theirs in
   * it: lost; a kill: won; else none); how it started and went is the clip's. Each teammate down in a window takes
   * near from the clip. readings: per window, in order (null where there's none).
   */
  function fightsFromClips(windows, readings, events) {
    const out = [];
    const inside = (w, kind) => (events || []).some((e) => e.kind === kind && e.t >= w.from && e.t <= w.to);
    windows.forEach((w, i) => {
      const r = readings[i];
      // A unit of play (footage of the whole match): once read, a play with the read's outcome for the player and who
      // decided it; unread, nothing is known about it yet (unreadUnits).
      if (w.unit) {
        if (!r) return;
        const outcome = ['won', 'lost'].includes(r.outcome) ? r.outcome : 'none', by = DECIDED[r.decided_by];
        out.push({ t: w.from, from: w.from, to: w.to, kind: 'play', unit: w.unit, outcome, decidedBy: r.decided_by || 'unclear', playerSeen: r.player_seen !== false, seenBy: 'clip', text: [outcome === 'none' ? 'neither won nor lost' : outcome, by, text(r.outcome_why)].filter(Boolean).join('; ').slice(0, 300) });
        return;
      }
      // A window no clip has read yet: a fight when the feed or the damage counter says one happened, with the feed's
      // outcome and no story; firing alone could be a reload, so it waits for a read.
      if (!r) {
        if (!w.events?.length && !w.hits?.length) return;
        const outcome = inside(w, 'death') ? 'lost' : inside(w, 'kill') ? 'won' : 'none';
        out.push({ t: w.from, from: w.from, to: w.to, kind: 'engagement', outcome, seenBy: 'feed', text: `${outcome === 'none' ? 'no one fell' : outcome}; not read as video yet` });
        return;
      }
      for (const e of w.events) {
        if (e.kind !== 'ally_death') continue;
        const d = (r.downed || []).find((x) => sameName(x.name, e.victim));
        if (d) { e.near = !!d.near; e.text = feedText(e); }
      }
      // Each ability the player used in the window, in the match's time. Checked against the frames (Oct 20), the clip
      // read's times were within 2 s, but it named the wrong ability once in two (Razorvine for the ult) and gave an
      // enemy's wall to a teammate, so only the player's own uses are kept, and the name is what the read says.
      for (const a of clipTimed((r.abilities || []).filter((x) => x?.who === 'player' && text(x?.name)), w)) {
        if (!out.some((o) => o.kind === 'ability' && Math.abs(o.t - a.t) < 2)) out.push({ t: a.t, kind: 'ability', who: 'player', name: text(a.name).slice(0, 60), seenBy: 'clip', text: `they used an ability (the clip read calls it ${text(a.name).slice(0, 60)}${a.what ? `: ${text(a.what).slice(0, 100)}` : ''})` });
      }
      // the damage counter rising is a fight whatever the clip says; firing alone can be a reload
      if (r.fight === 'no_fight' && !w.events.length && !w.hits?.length) return;
      const outcome = inside(w, 'death') ? 'lost' : inside(w, 'kill') ? 'won' : 'none';
      const how = { player_engaged: 'they engaged first', enemy_engaged: 'the enemy engaged first' }[r.fight];
      out.push({ t: w.from, from: w.from, to: w.to, kind: 'engagement', outcome, startedBy: r.fight, seenBy: 'clip', text: [outcome === 'none' ? 'no one fell' : outcome, how, text(r.story)].filter(Boolean).join('; ') });
    });
    return out;
  }
  const DECIDED = { player: 'decided by the player', teammates: "decided by the player's teammates", opponents: 'decided by the opponents', mixed: 'decided by the player and others', unclear: '' };

  // ---------- camera cuts ----------
  // Edited footage (a broadcast, coaching film) changes shot at a cut: one sample whose gray picture differs from the one
  // before far more than its neighbors do, whatever the sport. A play's start and end usually sit at cuts.
  /**
   * The cuts in [{ t, m }]: m is the mean gray change from the sample before (0-255). A cut is a sample with m over 10
   * that is 2.5 times the next one's (the new shot goes on smoothly), or a change of most of the picture (m over 25)
   * that is 3 times the median of the 4 before it (a cut into a moving shot). Play starting fast is neither: its change
   * goes on, and stays under 25. Returns the times of the first samples of the new shots.
   */
  function cutTimes(diffs) {
    const xs = Array.isArray(diffs) ? diffs : [], out = [];
    for (let i = 1; i < xs.length; i++) {
      const m = xs[i].m, next = xs[i + 1]?.m ?? 0, before = median(xs.slice(Math.max(1, i - 4), i).map((x) => x.m).concat([0.5]));
      if ((m > 10 && m > 2.5 * Math.max(next, 0.5)) || (m > 25 && m > 3 * before)) out.push(xs[i].t);
    }
    return out;
  }
  /**
   * Units of play as the low-detail pass timed them ([{ from, to, ... }]), each edge moved to the nearest cut within tol
   * seconds, or padded by pad where there's none: the pass sees two frames a second, so its times can be seconds off.
   * Units keep their order and don't overlap; ones shorter than 2 s are dropped.
   */
  function snapUnits(units, cuts = [], { tol = 4, pad = 1.5, duration = Infinity } = {}) {
    const near = (t) => (cuts || []).reduce((best, c) => (Math.abs(c - t) <= tol && (best == null || Math.abs(c - t) < Math.abs(best - t)) ? c : best), null);
    const out = (Array.isArray(units) ? units : []).filter((u) => Number.isFinite(u?.from) && Number.isFinite(u?.to) && u.to > u.from).sort((a, b) => a.from - b.from).map((u) => {
      const a = near(u.from), b = near(u.to);
      return { ...u, from: round(Math.max(0, a ?? u.from - pad), 1), to: round(Math.min(duration, b ?? u.to + pad), 1) };
    });
    for (let i = 1; i < out.length; i++) if (out[i].from < out[i - 1].to) { const mid = round((out[i].from + out[i - 1].to) / 2, 1); out[i - 1].to = mid; out[i].from = mid; }
    return out.filter((u) => u.to - u.from >= 2);
  }

  /**
   * One clip read's moments in the match's time. A read can come back timed from the clip's own start instead of the
   * match's: moments shift by the window's start when that puts more of them inside it.
   */
  function clipMoments(moments, w) {
    return clipTimed((Array.isArray(moments) ? moments : []).map((m) => ({ t: m?.t, what: text(m?.what).slice(0, 160) })).filter((m) => m.what), w);
  }
  /** Any list a clip read times in M:SS ([{ t, ...}]), in the match's time and inside the window, as clipMoments does. */
  function clipTimed(items, w) {
    const list = (Array.isArray(items) ? items : []).map((m) => ({ ...m, t: parseTime(m?.t) })).filter((m) => Number.isFinite(m.t));
    const inside = (xs) => xs.filter((m) => m.t >= w.from - 1 && m.t <= w.to + 1).length;
    const shifted = list.map((m) => ({ ...m, t: m.t + w.from }));
    return (w.from > 0 && inside(shifted) > inside(list) ? shifted : list).filter((m) => m.t >= w.from - 1 && m.t <= w.to + 1);
  }

  // ---------- shots, from the ammo counter ----------
  // The magazine count is the biggest number in the profile's ammo region, and it drops by one with every bullet. Code
  // finds its digits by the HUD's text color (the profile's hudText, white by default) and records their shape, so a
  // shot is a change of shape.
  const HUD_TEXT = { bright: 190, sat: 0.22 }; // white
  const AMMO_GRID = [4, 6]; // cells across and down a digit, for its shape
  /**
   * The magazine digits' shape in one ammo crop: { x0, x1, y0, y1, digits } (the count's box, and each digit's shape as
   * the share of each AMMO_GRID cell it fills), or null when no digits read. Each blob of HUD-colored pixels is a glyph;
   * a digit is one at least 12% of the crop tall and about as wide as it is tall or narrower, and the magazine is the
   * row of digits on the tallest one's line. Reading the crop's columns instead mixed in what isn't a digit: Apex's
   * R-301 icon beside the count is taller than its digits, and a bright floor behind the see-through HUD filled whole
   * columns, so a stretch where the count went 23 to 4 read as no shots (Oct 22).
   */
  function ammoReading({ data: d, width: w, height: h }, hud = HUD_TEXT) {
    const on = new Uint8Array(w * h), blob = new Int32Array(w * h).fill(-1), blobs = [];
    for (let p = 0; p < w * h; p++) { const i = p * 4, mx = Math.max(d[i], d[i + 1], d[i + 2]); on[p] = mx > hud.bright && (mx - Math.min(d[i], d[i + 1], d[i + 2])) / mx < hud.sat ? 1 : 0; }
    for (let p0 = 0; p0 < w * h; p0++) {
      if (!on[p0] || blob[p0] >= 0) continue;
      const b = { x0: w, x1: 0, y0: h, y1: 0 }, stack = [p0];
      blob[p0] = blobs.length;
      while (stack.length) {
        const p = stack.pop(), x = p % w, y = (p - x) / w;
        b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const q = p + dy * w + dx;
          if (x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h && on[q] && blob[q] < 0) { blob[q] = blobs.length; stack.push(q); }
        }
      }
      blobs.push({ ...b, id: blobs.length, tall: b.y1 - b.y0 + 1, wide: b.x1 - b.x0 + 1 });
    }
    // An icon is wider than it is tall. Background reaching past the crop's edge isn't a digit either, unless nothing
    // else is: a white gun skin behind Valorant's count streaks up from the bottom edge.
    const glyphs = blobs.filter((b) => b.tall >= Math.max(6, h * 0.12)), inner = (b) => b.x0 > 0 && b.y0 > 0 && b.x1 < w - 1 && b.y1 < h - 1;
    const digits = glyphs.filter((b) => b.tall <= h * 0.95 && b.wide <= b.tall * 1.2), inside = digits.filter(inner);
    if (!digits.length) return null;
    const top = (inside.length ? inside : digits).reduce((a, b) => (b.tall > a.tall ? b : a));
    // The row is the glyphs side by side that cover the tallest one's line, so the separator and the shorter reserve
    // count stay out. Where background ran into one of its digits, spilling past the line, the frame doesn't read: that
    // digit's outline is the background's, and leaving the digit out would read a different count. A digit the crop's
    // edge cuts stays on the line, and reads.
    const tol = top.tall * 0.2, spills = (b) => b.y0 < top.y0 - tol || b.y1 > top.y1 + tol;
    const line = glyphs.filter((b) => b.wide <= top.tall * 1.2 && b.y0 <= top.y0 + tol && b.y1 >= top.y1 - tol).sort((a, b) => a.x0 - b.x0);
    const row = [top];
    for (const dir of [-1, 1]) {
      for (let k = line.indexOf(top) + dir; k >= 0 && k < line.length; k += dir) {
        const edge = dir > 0 ? row.at(-1) : row[0], b = line[k];
        if ((dir > 0 ? b.x0 - edge.x1 : edge.x0 - b.x1) > top.tall) break;
        if (dir > 0) row.push(b); else row.unshift(b);
      }
    }
    if (row.some(spills)) return null;
    // each digit's shape: how much of each cell of an AMMO_GRID over its box it fills
    const digit = (b) => {
      const [gw, gh] = AMMO_GRID, cells = new Array(gw * gh).fill(0), area = cells.slice();
      for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
        const k = Math.min(gh - 1, Math.floor(((y - b.y0) * gh) / b.tall)) * gw + Math.min(gw - 1, Math.floor(((x - b.x0) * gw) / b.wide));
        area[k]++;
        if (blob[y * w + x] === b.id) cells[k]++;
      }
      return cells.map((v, k) => v / area[k]);
    };
    return { x0: row[0].x0, x1: Math.max(...row.map((b) => b.x1)), y0: top.y0, y1: top.y1, digits: row.map(digit) };
  }
  // A shot changes one digit, so each digit is compared on its own: a column profile of the whole count read 23 and 22
  // the same (Vyse's Vandal, Oct 22). A digit changed when its cells differ by AMMO_SAME of their sum, or when a stroke
  // moved, leaving one cell full in one and empty in the other. Over the labeled stretches the same digit differed by up
  // to 0.15 (a cell by up to 0.6) from frame to frame, except over a white gun skin, and a new digit by 0.25 to 0.5
  // (a cell by 0.9 to 1).
  const AMMO_SAME = 0.2, AMMO_CELL = 0.8;
  const digitChanged = (a, b) => {
    let diff = 0, sum = 0, most = 0;
    for (let k = 0; k < a.length; k++) { const d = Math.abs(a[k] - b[k]); diff += d; sum += a[k] + b[k]; most = Math.max(most, d); }
    return diff >= AMMO_SAME * sum || most >= AMMO_CELL;
  };
  const ammoChanged = (a, b) => a.digits.length !== b.digits.length || Math.abs(a.x0 - b.x0) > 2 || a.digits.some((g, k) => digitChanged(g, b.digits[k]));
  /**
   * The ammo readings that count, from [{ t, reading }] in time order: the ones on the magazine's line, and steady (the
   * next hold - 1 frames read the same). The magazine's digits sit on one line through a stretch, the line most readings
   * share; a reading on another is the reserve count or background, read while the digits ran into a bright wall behind
   * them (Valorant's Sheriff at 3, Oct 22). Background showing behind the digits changes their outline from frame to
   * frame, which steadiness leaves out.
   */
  function steadyReadings(readings, hold = 3) {
    const lines = [];
    for (const { reading: r } of readings) {
      if (!r) continue;
      const l = lines.find((x) => x.y0 === r.y0 && x.y1 === r.y1);
      if (l) l.n++; else lines.push({ y0: r.y0, y1: r.y1, n: 1 });
    }
    const near = (a, b) => Math.abs(a.y0 - b.y0) <= 2 && Math.abs(a.y1 - b.y1) <= 2;
    const line = lines.map((l) => ({ ...l, near: lines.filter((x) => near(x, l)).reduce((s, x) => s + x.n, 0) })).reduce((a, b) => (b.near > a.near ? b : a), { near: 0 });
    const on = readings.map((x) => (x.reading && near(x.reading, line) ? x.reading : null)), out = [];
    for (let i = 0; i + hold <= readings.length; i++) {
      const run = on.slice(i, i + hold);
      if (run.every((r, k) => r && (!k || !ammoChanged(run[k - 1], r)))) out.push(readings[i]);
    }
    return out;
  }
  /**
   * Whether the player fired over a stretch, from ammo readings [{ t, reading }] in time order, by the readings that
   * count (steadyReadings). A swap or reload also reads as a change, so a change is never proof of firing, while no
   * change at all is proof of not firing: fired is false only when no steady reading differs from the one before it.
   * The first against the last alone isn't enough, since a magazine fired from 23 and reloaded reads 23 again (Apex,
   * Oct 22). changes: the steady changes, roughly one a shot or burst. null when nothing changed but the steady
   * readings span less than 60% of the stretch, since a burst could hide in the part that never read steadily; a change
   * seen is enough for fired, however little read (a Vandal firing every third frame holds a count steady only briefly).
   */
  function shotsFired(readings) {
    const steady = steadyReadings(readings);
    if (steady.length < 2) return null;
    let changes = 0;
    for (let i = 1; i < steady.length; i++) if (ammoChanged(steady[i - 1].reading, steady[i].reading)) changes++;
    const fired = changes > 0 || ammoChanged(steady[0].reading, steady.at(-1).reading);
    if (!fired && steady.at(-1).t - steady[0].t < 0.6 * (readings.at(-1).t - readings[0].t)) return null;
    return { fired, changes, from: steady[0].t, to: steady.at(-1).t };
  }

  // ---------- engagements ----------
  // A fight is the unit a coach judges: taking it, its position and timing, breaking off. Kills and deaths alone miss
  // the fights no one fell in, which can still decide a match.
  /**
   * When the player fired, from ammo readings over a stretch: each change between two steady readings (steadyReadings).
   * Automatic fire changes the digits faster than they hold steady, so a burst shows as one change at its end: these
   * mark firing, not each round. Read at 4 fps, a count is steady when the next frame reads the same: held for three, a
   * magazine emptied and reloaded to its count never showed in between (Apex, Oct 22).
   */
  function fireTimes(readings, hold = 2) {
    const steady = steadyReadings(readings, hold), times = [];
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
   * player's kills and deaths inside it: a death means lost, a kill won, neither none. fromFeed: the kills and deaths
   * were read off the kill feed, which outranks the pass, so they decide the outcome and a pass that disagrees is left out.
   */
  function mergeFights(firing = [], seen = [], events = [], hits = [], { fromFeed = false } = {}) {
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
      const fed = inside('death') ? 'lost' : inside('kill') ? 'won' : 'none';
      const outcome = fromFeed ? fed : ['won', 'lost', 'none'].includes(f.outcome) ? f.outcome : fed;
      const note = fromFeed && f.outcome && f.outcome !== outcome ? null : f.text;
      const said = [outcome === 'none' ? 'no one fell' : outcome, f.hits ? `dealt damage ${f.hits} time${f.hits === 1 ? '' : 's'}` : null, f.bursts ? `fired in ${f.bursts} burst${f.bursts === 1 ? '' : 's'}` : null, note].filter(Boolean).join('; ');
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
  /**
   * The stretch one clip look watches: before to after seconds around t, inside the video, at fps frames a second, and
   * at least a second long. A clip's frames are low detail (about 76 tokens each, against about 1,090 for a still), so a
   * clip is for what happened and in what order, like the run-up to a moment, and stills are for detail. The coach's
   * clip is encoded from it, and the app plays the same stretch while the coach watches.
   */
  // maxBefore: far enough back to see the decision a fight was lost on, often 10 to 20 s before the death; a long clip is
  // sampled more thinly (MAX_CLIP_FRAMES): 14 s at 6 a second, so the check against the video keeps the rate it was
  // measured at and only a longer look back thins out
  const CLIP_LOOK = { before: 6, after: 1, fps: 6, maxBefore: 20, maxAfter: 4 }, MAX_CLIP_FRAMES = 84;
  function clipPlan({ t, before = CLIP_LOOK.before, after = CLIP_LOOK.after, fps = CLIP_LOOK.fps, duration = Infinity, maxAfter = CLIP_LOOK.maxAfter }) {
    const last = Math.max(0, duration - 0.05), num = (x, d) => (Number.isFinite(+x) && x !== null ? +x : d);
    const b = clamp(num(before, CLIP_LOOK.before), 0, CLIP_LOOK.maxBefore), a = clamp(num(after, CLIP_LOOK.after), 0, maxAfter);
    const at = clamp(t, 0, last);
    let from = clamp(at - b, 0, last), to = clamp(at + a, 0, last);
    if (to - from < 1) { to = Math.min(last, from + 1); from = Math.max(0, to - 1); }
    const want = clamp(Math.round(num(fps, CLIP_LOOK.fps)) || CLIP_LOOK.fps, 2, 8);
    return { t: round(at, 2), from: round(from, 2), to: round(to, 2), fps: Math.max(2, Math.min(want, Math.floor(MAX_CLIP_FRAMES / Math.max(1, to - from)))) };
  }
  /**
   * How long after a claimed moment the check of it looks: to the end of the record's fight or play the moment falls in,
   * since a claim cited at its start says how it ended (League, Oct 23: "caught, leading to a lost fight and death" at
   * the fight's 1:43, the death at 1:48, judged on a clip that stopped at 1:46), at least `least` and at most `most` s.
   */
  function claimAfter(events, t, { least = 3, most = 8 } = {}) {
    const ends = (events || []).filter((e) => Number.isFinite(e?.from) && Number.isFinite(e?.to) && e.from - 1 <= t && t <= e.to).map((e) => e.to + 1 - t);
    return round(clamp(ends.length ? Math.max(...ends) : least, least, most), 2);
  }
  /** A named screen region of the game profile, in frame pixels. */
  function regionRect(profile, name, frame) {
    const r = !name || name === 'full' ? [0, 0, 1, 1] : profile?.regions?.[name];
    if (!r) throw new Error(`Unknown region "${name}". Use full or one of: ${Object.keys(profile?.regions || {}).join(', ')}.`);
    return { x: Math.round(r[0] * frame.w), y: Math.round(r[1] * frame.h), w: Math.round(r[2] * frame.w), h: Math.round(r[3] * frame.h) };
  }
  /**
   * A HUD readout's box [x, y, w, h] grown to at least minH of the screen tall, about its middle, for reading its number:
   * a learned health box can hold only the bar under the number (Marvel Rivals' 32/250, Oct 22), and read off the bar
   * alone the HP never showed the 0 of a death.
   */
  const READOUT_H = 0.07;
  function readoutRegion([x, y, w, h], minH = READOUT_H) {
    if (h >= minH) return [x, y, w, h];
    return [x, round(clamp(y + h / 2 - minH / 2, 0, 1 - minH), 4), w, minH];
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
    const recent = (history?.matches || []).slice(-5).map((m) => `${m.date}: ${m.found ? m.habit : m.reason ? `no habit; cost them once: ${m.reason}` : 'no single habit'}${m.progress ? ` (${m.progress} than baseline)` : ''}`);
    if (recent.length) lines.push(`Recent reviews:\n${recent.join('\n')}`);
    return lines.join('\n') || 'First review for this player.';
  }

  const api = {
    mmss, parseTime, median, round, clamp, aimBand, aimOffset, headOnBody, enemyHead, summarizeAim, aimText,
    BudgetError, createBudget, left, spend, budgetLine,
    SLACK, MIN_EVIDENCE, LEAD_MAX, createLedger, recordLook, seen, deadForOf, deathAt, LOSS_LOOKS, losses, lossGap, lossMoments, atLoss, MIN_LOSSES, MAX_TRIES, fightOf, retryRefusal, problemKind, checkFinish,
    STATUSES, applyNote, boardBrief, unreadDowns, unreadUnits, cutTimes, snapUnits, KINDS, normalizeEvents, mergeEvents, eventsBrief,
    pixelTeam, killfeedRows, teamLines, colorBands, fitGrid, rowDistance, SAME_ROW, sameRow, freshRows, nameKey, sameName, feedSightings, choosePlayer, whoIsPlayer, buildKillfeed, confirmByBanners, cutNames, aliasNames, feedCharacters, counterRises, hudKills, hudRecord, mergeCounts, riseSpans, lowSpans, timesIn, nearDeaths, NEAR_DEATH, controlClaims, sameSide, trustCounter, settleFights, pointsTaken, oneDeathEach, eventWindows, fightsFromClips, clipMoments, feedText, textRows, textEdge, onEdge, feedBand, nameColors, textFeedReads, textFeedSightings, teamsByColor,
    ammoReading, shotsFired, fireTimes, groupFights, mergeFights, MAX_FRAMES, framePlan, CLIP_LOOK, clipPlan, claimAfter, regionRect, READOUT_H, readoutRegion,
    emptyHistory, addMatch, acceptHabit, historyFor, dropHabit, compareAim, historyBrief,
  };
  root.ThirdeyeCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
