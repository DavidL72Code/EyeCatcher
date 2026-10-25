/* Eye Catcher core: time, aim math, the look budget, the evidence check, the theory board, and match history, as plain
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
  const deadForOf = (profile, events) => (playedInRounds(profile, events) ? profile?.deadFor?.rounds : profile?.deadFor?.respawn) ?? 5;
  /** Whether a game is played in rounds: the learn call says so, or the record has a round start. */
  // A lone round start at the recording's opening is no rounds: League's pass wrote "Game in progress" at 0:00, and its
  // 8:56 death was dropped as one while the player was dead from 1:48 "in that round" (loop 41 run 2, L8)
  const playedInRounds = (profile, events) => { const starts = (events || []).filter((e) => e.kind === 'round_start').map((e) => e.t); return !!(profile?.rounds || starts.length >= 2 || starts.some((t) => t > 15)); };
  /**
   * Played in rounds with no respawn in one, so a death lasts to the next round (roundDeath): not where the learn call
   * says a player respawns mid-round (respawns, learn.js), whose deaths in one round are each real. Unknown counts as no.
   */
  const noRespawnRounds = (profile, events) => playedInRounds(profile, events) && profile?.respawns !== true;
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
  /**
   * When each round started, in a game played in rounds: the record's round starts, or with none (a kill feed's record
   * has no low-detail pass to see them), the middle of each stretch of ROUND_GAP s or more with no kill-feed line, the
   * break between rounds. Valorant, Oct 24: 42 to 55 s between rounds, at most 21 s with no line inside one.
   */
  const ROUND_GAP = 30;
  function roundStarts(events) {
    const marked = (events || []).filter((e) => e.kind === 'round_start').map((e) => e.t);
    if (marked.length) return marked.sort((a, b) => a - b);
    const lines = (events || []).filter((e) => e.victimTeam === 'ally' || e.victimTeam === 'enemy').map((e) => e.t).sort((a, b) => a - b);
    return lines.slice(1).flatMap((t, i) => (t - lines[i] >= ROUND_GAP ? [round((t + lines[i]) / 2, 1)] : []));
  }
  /**
   * In a game played in rounds with no respawn in one, the player's death t falls after, up to the next round's start
   * (roundStarts) or their next kill, or null. deadForOf's 30 s ends too soon there: in Brawl Stars the screen followed
   * a teammate up to 50 s after each death, and his health, read as the player's, made five false near-deaths (Oct 25).
   * Only with round starts to end it: without them a death would last to the player's next kill, or the match's end.
   */
  const roundDeath = (events, t) => { const starts = roundStarts(events); return starts.length ? deathAt([...(events || []), ...starts.map((s) => ({ t: s, kind: 'round_start' }))], t, Infinity) : null; };
  /**
   * A record in a game played in rounds, without the deaths and near-deaths (kinds) that fall while the player was dead
   * from an earlier death of the same round (roundDeath), whatever a second look said of them: the HUD then shows the
   * teammate the screen follows. Brawl Stars, loop 39 (Oct 25): deaths at 1:11, 2:03, 2:59, and 3:30, the second and
   * fourth a teammate's health at 0 while the player watched, each confirmed by the second look; the rounds started at
   * 0:21 and 2:14.
   */
  // keep(e): a death the HUD's own death count rose at, which stays whatever the round says (L8)
  function aliveInRound(events, { kinds = ['death', 'near_death'], keep = () => false } = {}) {
    const list = [...(events || [])].sort((a, b) => a.t - b.t), rest = list.filter((e) => e.kind !== 'death' && e.kind !== 'near_death'), deaths = [], gone = new Set();
    for (const e of list) {
      if (e.kind !== 'death' && e.kind !== 'near_death') continue;
      if (kinds.includes(e.kind) && !keep(e) && roundDeath([...rest, ...deaths], e.t)) { gone.add(e); continue; }
      if (e.kind === 'death') deaths.push(e);
    }
    return list.filter((e) => !gone.has(e));
  }

  // ---------- the player's losses ----------
  // A match is lost in the player's deaths, the fights they lost, and the times they nearly died, so a review looks at
  // each before it decides either way, LOSS_LOOKS of them when there are more.
  const LOSS_LOOKS = 4;
  const nearWhat = (e) => `a near-death (health ${e.hp} of ${e.of})`;
  // objectives (structureEvents): a structure of theirs losing health, "their right tower, 3197 to 761"
  // a drop a clip read saw (readDrops) says so, and whether code could check it
  const seenWhat = (e) => (e.seenBy === 'clip' ? ` (seen by a clip read${e.checked ? `, and ${e.checked}` : ', not checked by code'})` : '');
  const dropWhat = (e) => `${e.structure ? `their ${e.structure}` : 'a structure of theirs'} losing health, ${e.was} to ${e.now}${seenWhat(e)}`;
  // hp_bar (barDamage): a drop of their health bar with no death or near-death in it, "health 97% to 72% of full"
  // and one a clip read saw, in the HUD's own numbers: "damage taken (their shield 98 to 24, seen by a clip read...)"
  const damageWhat = (e) => (e.seenBy === 'clip' ? `damage taken (their ${e.unit || 'health'} ${e.was} to ${e.now}${e.of ? ` of ${e.of}` : ''}${seenWhat(e).replace(/^ \(/, ', ').replace(/\)$/, '')})` : `damage taken (their ${e.unit || 'health'} bar ${e.was}% to ${e.now}% of full)`);
  // how much of full a damage event left (hp_bar's are in % of full; a clip read's in the HUD's numbers)
  const damageLeft = (e) => (e.seenBy === 'clip' ? e.now / (e.of || e.was || 1) : e.now / 100);
  /**
   * The player's deaths, near-deaths, and the fights they lost with no death of theirs in them, in time order, each
   * { t, what, seen }. A death is seen when a look covers it or the second before it; a fight when a look overlaps it.
   */
  function losses(events, ledger) {
    const deaths = (events || []).filter((e) => e.kind === 'death');
    const out = deaths.map((e) => ({ t: e.t, what: 'their death', seen: seen(ledger, e.t) || seen(ledger, e.t - 1) }));
    for (const e of (events || []).filter((x) => x.kind === 'near_death')) out.push({ t: e.t, what: nearWhat(e), seen: seen(ledger, e.t) || seen(ledger, e.t - 1) || seen(ledger, e.t - 2) });
    for (const e of (events || []).filter((x) => x.kind === 'point_lost')) out.push({ t: e.t, what: 'a point the other side scored', seen: seen(ledger, e.t) || seen(ledger, e.t - 3) });
    for (const e of (events || []).filter((x) => x.kind === 'objective_damage')) out.push({ t: e.t, what: dropWhat(e), seen: seen(ledger, e.t) || seen(ledger, e.t - 3) });
    for (const e of (events || []).filter((x) => x.kind === 'damage')) out.push({ t: e.t, what: damageWhat(e), seen: seen(ledger, e.t) || seen(ledger, e.t - 2) });
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
      if (e.kind === 'death') out.push({ t: e.t, from: e.t - 6, to: e.t + 2, what: 'their death', kind: e.kind });
      else if (e.kind === 'near_death') out.push({ t: e.t, from: e.t - 6, to: e.t + 2, what: nearWhat(e), kind: e.kind, size: e.of > 0 ? round(1 - e.hp / e.of, 3) : 0 });
      else if (e.kind === 'ally_death' && !e.tradedBy && e.near === true && !deathAt(events, e.t, deadFor)) out.push({ t: e.t, from: e.t - 6, to: e.t + 2, what: `${e.victim || 'a teammate'} down near them, not traded`, kind: e.kind });
      else if (e.kind === 'engagement' && e.outcome === 'lost') out.push({ t: e.from, from: e.from - 2, to: e.to + 2, what: 'a fight they lost', kind: e.kind });
      else if (e.kind === 'point_lost') out.push({ t: e.t, from: e.t - 8, to: e.t + 1, what: 'a point the other side scored', kind: e.kind });
      // from where the drops began: Clash Royale's 3197 to 761 came in six shots over about 10 s (Oct 25)
      else if (e.kind === 'objective_damage') out.push({ t: e.t, from: Math.min(e.start ?? e.t, e.t) - 6, to: e.t + 2, what: dropWhat(e), kind: e.kind, size: e.was > 0 ? round((e.was - e.now) / e.was, 3) : 0 });
      else if (e.kind === 'damage') out.push({ t: e.t, from: Math.min(e.start ?? e.t, e.t) - 6, to: e.t + 2, what: damageWhat(e), kind: e.kind, size: round(e.seenBy === 'clip' ? (e.was - e.now) / (e.of || e.was || 1) : (e.was - e.now) / 100, 3) });
      else if (e.kind === 'play' && e.outcome === 'lost') out.push({ t: e.from, from: e.from - 1, to: e.to + 1, what: `a ${e.unit || 'play'} they lost`, kind: e.kind });
      else if (e.kind === 'move' && e.grade) out.push({ t: e.t, from: e.t - 3, to: e.t + 1, what: `${e.san || 'a move'} (${e.grade}${e.loss ? `, ${(e.loss / 100).toFixed(1)} pawns` : ''})`, cost: e.loss || 0, kind: e.kind });
    }
    return out.sort((a, b) => a.t - b.t);
  }
  // The n losses that cost the most, in time order, to name where a finding has to show: chess's first six graded moves
  // were the opening's small mistakes, and its blunders from move 15 on, which decided the game, were never named (Oct 24)
  const costliest = (all, n = 6) => [...all].sort((a, b) => (b.cost || 0) - (a.cost || 0) || a.t - b.t).slice(0, n).sort((a, b) => a.t - b.t);
  // Where losses differ in cost (chess's moves, by the pawns they gave away), a finding has to show at least one of the
  // TOP_COST costliest: one chess review cited 2.f4 and three small opening mistakes, and none of the blunders from move
  // 15 on that decided the game (Oct 25). cites: [[t, led_to], ...]. Returns the problem, or ''.
  const TOP_COST = 4;
  function missesCostliest(all, cites) {
    if (!all.some((l) => l.cost)) return '';
    const top = costliest(all, TOP_COST);
    if (cites.some((ts) => ts.some((t) => top.some((l) => t >= l.from && t <= l.to)))) return '';
    return `The losses that cost them most were ${top.map((l) => `${mmss(l.t)} ${l.what}`).join(', ')}. What cost them the match has to show in at least one of these: look at them, and cite the ones that show it.`;
  }
  /**
   * cover_losses (agent.js): the costliest losses (costliest, up to n) that no cited moment is at or led to. The coach
   * stops at the minimum, a moment or three: Marvel Rivals cited 2 of its 4 losses, Valorant 3 of 5, chess 2 or 3 of 7
   * (loop 37-39). cites: [[t, led_to], ...], the evidence, fixes, and turning points.
   */
  // The ones cover_losses asks after: in chess the costliest by the engine; elsewhere, where only chess moves carry a
  // cost and costliest is the first six by time, by what they are (a death or a point against them, then a structure's
  // drop, then a teammate down or a fight lost, then near-deaths, then damage), then by how much where that's known
  const LOSS_RANK = { death: 0, point_lost: 0, objective_damage: 1, ally_death: 2, engagement: 2, play: 2, near_death: 3, damage: 4 };
  // the losses most costly first, by the same rule (rankedLosses keeps the first n of these, in time order)
  const lossOrder = (all) => { const costed = (all || []).some((l) => l.cost); return [...(all || [])].sort((a, b) => (costed ? (b.cost || 0) - (a.cost || 0) : (LOSS_RANK[a.kind] ?? 2) - (LOSS_RANK[b.kind] ?? 2) || (b.size || 0) - (a.size || 0)) || a.t - b.t); };
  const rankedLosses = (all, n = 6) => (all.some((l) => l.cost) ? costliest(all, n) : lossOrder(all).slice(0, n).sort((a, b) => a.t - b.t));
  // in chess, the eight costliest by the engine: 26.Rf1 was eighth (1.5 pawns) and never asked for (loop 41, H2)
  const COVER_N = 6, CHESS_COVER_N = 8;
  const uncoveredLosses = (all, cites, n = (all || []).some((l) => l.cost) ? CHESS_COVER_N : COVER_N) => rankedLosses(all, n).filter((l) => !(cites || []).some((ts) => ts.some((t) => t >= l.from && t <= l.to)));
  /**
   * cover_losses: a turning point for a loss still uncovered once the coach was asked, filled in by code from that
   * window's clip read (the decision it says lost it, last_choice, with the factors it read), said as the read's and led
   * to the loss, for both checks to judge like any claim; or, for a graded chess move (no clip), from the engine's line
   * in the record. loss: lossMoments' { t, what }; w: its window with reading; move: the record's move event. null when
   * neither says what decided it.
   */
  // rejected (cover_losses): the claims either check let go of, [{ t, text, to }], so code never fills a loss back in with
  // one: League's 1:44 fill was the read's "committed to using Bullet Time", which the frames check had rejected twice in
  // the coach's own words (loop 41)
  function coverFill(loss, { w = null, move = null, rejected = [] } = {}) {
    // chess: from the engine's line, all of it code's: the move's grade and what it cost, the reply it allows, and the
    // engine's move. Not the clock, which the board reader read and can misread (16.Qd3's 9:43, loop 41)
    if (move?.kind === 'move' && move.grade && (move.squares?.bestSan || move.allows)) {
      const no = /^(\d+\s*\.(?:\.\.)?)/.exec(text(move.text))?.[1]?.replace(/\s+/g, '') || '', reply = /;\s*it allows ([^;)]+)/.exec(text(move.text))?.[1] || move.allows || '';
      const best = move.squares?.bestSan || '', pawns = `${((move.loss || 0) / 100).toFixed(1)} pawns`;
      return { t: mmss(move.t, true), what: `From the engine: ${no ? `${no} ` : ''}${move.san} was a ${move.grade}, giving away ${pawns}`, because: [reply && `it allows ${reply.trim()}`, best && `the engine's move was ${best}`].filter(Boolean).join('; '), better: best ? `Play ${best}` : `Look for ${reply.split(',')[0].trim()} before playing ${move.san}`, led_to: mmss(move.t, true), filled: 'engine' };
    }
    const lc = w?.reading?.last_choice;
    // a fill needs what to do instead, as every moment the coach gives does: from the read, or none at all
    if (text(lc?.choice) && text(lc?.instead)) {
      const said = parseTime(lc.t), at = Number.isFinite(said) && said <= loss.t && said >= loss.t - LEAD_MAX ? said : loss.t;
      if (fillRejected(text(lc.choice), at, loss, rejected)) return null;
      const why = (Array.isArray(w.reading.factors) ? w.reading.factors : []).filter((f) => text(f?.what)).slice(0, 6).map((f) => `${f.kind} ${text(f.what).replace(/\.$/, '')}`);
      return { t: mmss(at, true), what: `From the clip read: ${text(lc.choice).replace(/\.$/, '')}`, because: [text(lc.cost) && `what it cost: ${text(lc.cost).replace(/\.$/, '')}`, ...why].filter(Boolean).join('; ') || 'the clip read gives no factors', better: text(lc.instead), led_to: mmss(loss.t, true), filled: 'clip' };
    }
    return null;
  }
  // the words a claim says something with: four letters or more, no filler
  const STOP = new Set(['that', 'this', 'with', 'from', 'into', 'their', 'them', 'they', 'then', 'than', 'while', 'when', 'were', 'was', 'have', 'been', 'being', 'player', 'players', 'enemy', 'enemies', 'which', 'there', 'where', 'what', 'after', 'before', 'still', 'only', 'also', 'just', 'over', 'under', 'toward', 'towards', 'clip', 'read', 'shows']);
  const sayWords = (s) => [...new Set((String(s || '').toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !STOP.has(w)))];
  /**
   * Whether a decision a clip read gives (choice, at t, for loss) says what a claim either check rejected said: near the
   * same moment (within 3 s of it, or of the loss it led to, or citing that loss), with half or more of the choice's
   * words. rejected: [{ t, text, to }].
   */
  function fillRejected(choice, t, loss, rejected = []) {
    const words = sayWords(choice);
    if (!words.length) return false;
    return (rejected || []).some((r) => {
      const near = Math.abs(r.t - t) <= 3 || (loss && ((r.t >= loss.from && r.t <= loss.to) || (Number.isFinite(r.to) && Math.abs(r.to - loss.t) <= 1)));
      if (!near) return false;
      const have = new Set(sayWords(r.text));
      return words.filter((w) => have.has(w)).length >= Math.max(1, words.length / 2);
    });
  }
  /**
   * The coach's turning points the checks judge, at most n: those at the costliest losses first (rankedLosses: in chess
   * the engine's costliest, elsewhere deaths before near-deaths), then the rest in time order, kept in time order. The
   * first n by time checked chess's opening mistakes and dropped 15.Bc3, 16.Qd3, and 18.Nf4, the moves that lost the
   * game, though the coach had given all twelve (loop 41). turns: [{ t, led_to }]; all: lossMoments.
   */
  function pickTurns(turns, all, n = 6) {
    const list = (turns || []).map((e, i) => ({ e, i, t: parseTime(e?.t), to: parseTime(e?.led_to) })).filter((x) => Number.isFinite(x.t));
    if (list.length <= n) return list.map((x) => x.e);
    const ranked = lossOrder(all || []), rank = (x) => { const k = ranked.findIndex((l) => (x.t >= l.from && x.t <= l.to) || (Number.isFinite(x.to) && x.to >= x.t && x.to - x.t <= LEAD_MAX && x.to >= l.from && x.to <= l.to)); return k < 0 ? Infinity : k; };
    return [...list].sort((a, b) => rank(a) - rank(b) || a.t - b.t).slice(0, n).sort((a, b) => a.t - b.t || a.i - b.i).map((x) => x.e);
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
    // (its words as agent.js and checkFinish send them: "which nothing in the record or the clip reads names" never
    // matched, so that send-back counted as 'other', and two different ones as the same reason, Oct 25)
    ['format', /Give one specific drill|Say what to check in the next match|must be one of|isn't in the match record or a name on screen|Each moment you cite is the loss itself|which nothing in the kill feed or the HUD names|Say how that cost them|isn't a time in this match|Say what happens at|Name the habit \(habit\)|Explain how this habit cost fights/],
    // where a finding has to show (the costliest losses), and a check that couldn't run: neither says the finding is
    // wrong, so neither counts toward deciding now
    ['costliest', /The losses that cost them most were/],
    // cover_losses: asked once, and what's still uncovered after it code fills in from the clip reads
    ['uncovered', /Cite each of the losses that cost them most/],
    ['check_failed', /The check against the video couldn't run/],
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
    ['no_reason', /Name the biggest reason they lost|has to show where they lost: at least one|Cite the moments you looked at that show the reason/],
    ['unshown', /the video doesn't show/],
  ];
  const problemKind = (text) => PROBLEM_KINDS.find(([, re]) => re.test(text))?.[0] || 'other';
  // the kinds that never count as "sent back twice for the same reason"
  const NOT_DECIDING = ['format', 'won_fight', 'costliest', 'uncovered', 'check_failed'];

  // ---------- controls for the claim checker ----------
  /**
   * Claims the record shows are false, planted unmarked among a finding's claims for the agent that checks them against
   * the video (agent.js verifyClaims): one that agrees with a control isn't checking, it's agreeing. Each is false in a
   * way the video shows: one of the player's kills called their death (no death of theirs from 6 s before to 8 s after
   * it), a death at a quiet moment (no death, near-death, kill, or point within QUIET s), a near-death called full
   * health, a point the other side scored called their own.
   * "Alive a second after a death" was tried first and isn't one: Valorant then shows a teammate's view, alive and
   * moving. Deaths count only when the record's were checked (sure). Nearest the finding's own moments first, so the
   * checker looks at the same stretches, but never at one of them. Returns up to max [{ t, what, control, reason, from }]:
   * reason, which kind of false claim it is (kill, quiet, near_death, point_lost), and from, the record's line it was made
   * from, for the report to say why it's false without reading the claim's words.
   */
  const QUIET = 12, DEAD_LONG = 60;
  function controlClaims(events, moments, { sure = true, max = 2, duration = Infinity } = {}) {
    const near = (t) => Math.min(...(moments || []).map((m) => Math.abs(m.t - t)), Infinity);
    const taken = (t) => (moments || []).some((m) => Math.abs(m.t - t) < 6);
    const marks = (events || []).filter((e) => ['death', 'near_death', 'kill', 'point_won', 'point_lost', 'point'].includes(e.kind));
    const out = [];
    const deaths = (events || []).filter((e) => e.kind === 'death');
    for (const e of events || []) {
      const line = `${mmss(e.t, true)} ${knownText(e) || e.kind.replace('_', ' ')}`;
      if (e.kind === 'near_death') out.push({ t: e.t, what: "The player's health is full here.", control: true, reason: 'near_death', from: line });
      else if (e.kind === 'point_lost') out.push({ t: e.t, what: "The player's own side scores here.", control: true, reason: 'point_lost', from: line });
      else if (e.kind === 'kill' && sure && !deaths.some((d) => d.t >= e.t - 6 && d.t <= e.t + 8)) out.push({ t: e.t, what: 'The player is killed here.', control: true, reason: 'kill', from: `${line}, with no death of theirs from 6 s before to 8 s after` });
    }
    // quiet moments near each cited one, a death there being false
    if (sure && marks.some((e) => e.kind === 'death')) {
      for (const m of moments || []) for (const d of [-QUIET - 6, QUIET + 6, -2 * QUIET, 2 * QUIET]) {
        const t = round(m.t + d, 1);
        // and not while they may still be dead: a League respawn takes 30 s and more, and "dies here" planted on its
        // death screen wasn't false enough to plant (Oct 22)
        if (t > 8 && t < duration - 3 && !marks.some((e) => Math.abs(e.t - t) <= QUIET) && !marks.some((e) => e.kind === 'death' && t > e.t && t - e.t < DEAD_LONG)) { out.push({ t, what: 'The player dies here.', control: true, reason: 'quiet', from: `no death, near-death, kill, or point in the record within ${QUIET} s of ${mmss(t, true)}, and no death of theirs in the ${DEAD_LONG} s before it` }); break; }
      }
    }
    const kept = [];
    for (const c of out.filter((c) => !taken(c.t)).sort((a, b) => near(a.t) - near(b.t))) if (kept.length < max && !kept.some((k) => Math.abs(k.t - c.t) < 6)) kept.push(c);
    return kept.sort((a, b) => a.t - b.t);
  }

  // ---------- a claim judged at its own moment ----------
  // Health and ammo change from one second to the next, so a number holds only at its own moment. Loop 40's checks sent
  // back right numbers against another second's: Marvel Rivals' "157/250" at 4:17 against a clip read's "70/250" at
  // 4:18 (the baseline: 157 at 4:17, 54 at 4:18), Siege's "13/64" at 8:59 against a read's "25/64" at 8:55, and League's
  // 1:41 health went back and forth between the two checks (661 at 1:40, 608 at 1:41), both right.
  // The recording times a text names (M:SS or M:SS.s), leaving out words read off the screen (<data>: a clock as written)
  // An M:SS beside a cooldown or timer word is the game's own count, never a time of the recording: "R on 1:24
  // cooldown", "Scoreboard clock 3:49", "Time left 1:32", "1:09 left" (the reviewer's probes, Oct 25). "On cooldown at
  // 1:40" is a time: at says so

  const TIME_RE = /(?<![\d:.])(\d{1,2}):([0-5]\d(?:\.\d+)?)(?![\d:])/g;
  const TIMER_BEFORE = /(?:cooldown|cool down|timer|clock|\bcd|charge|respawn(?:ing)?|time left|time remaining|countdown)\s*(?:of|is|was|reads?|read|shows?|showing|shown as|as|in|:)?\s*$/i;
  const TIMER_AFTER = /^\s*(?:s\b\s*)?(?:left|remaining|cooldown|cool down|\bcd\b|timer|to go|on the clock|until)/i;
  // A time written as one of the recording's: after at, by, from, since... ("at 1:46"), or opening the text ("4:28 Health
  // dropped"), never beside a timer word
  const AS_TIME = /(?:^[\s([]*|\b(?:at|by|from|since|until|till|around|after|before|between|to|then|and|through)\s+)$/i;
  const clockTimes = (s) => { const x = String(s || '').replace(/<data>[\s\S]*?<\/data>/g, (m) => ' '.repeat(m.length)), out = []; for (const m of x.matchAll(TIME_RE)) { const before = x.slice(Math.max(0, m.index - 28), m.index), after = x.slice(m.index + m[0].length, m.index + m[0].length + 18); if (TIMER_BEFORE.test(before) || TIMER_AFTER.test(after)) continue; out.push({ t: +m[1] * 60 + +m[2], at: m.index, len: m[0].length, written: AS_TIME.test(x.slice(0, m.index).slice(-28)) }); } return out; };
  // The recording times a text names (M:SS or M:SS.s), leaving out words read off the screen (<data>: a clock as written)
  // and the game's own timers
  const namedTimes = (s) => clockTimes(s).map((x) => x.t);
  // NEAR_TIME: a recording time a claim gives for its number is within this of its moment; farther, it's the game's
  const NEAR_TIME = 30;
  /** The times a text gives as moments of the recording: written as one (at 1:46), and within NEAR_TIME of t when t is given. */
  const recordingTimes = (s, t) => clockTimes(s).filter((x) => x.written && (!Number.isFinite(t) || Math.abs(x.t - t) <= NEAR_TIME)).map((x) => x.t);
  // A text's numbers as a HUD or a count gives them: without the recording's own times (recordingTimes), words read off
  // the screen (<data>), a chess move's number (10. Qb5+), and a word with digits in it, a name or a square (Capzl99,
  // xX_Sova99, Qe2, e4). Chess moves made every move fact "a number", and a kill-feed name the only digits in a quote
  // (the reviewer's probes)
  const numberText = (s, t) => {
    const x = String(s || '').replace(/<data>[\s\S]*?<\/data>/g, (m) => ' '.repeat(m.length)), drop = clockTimes(x).filter((y) => y.written && (!Number.isFinite(t) || Math.abs(y.t - t) <= NEAR_TIME));
    let out = x;
    for (const y of [...drop].reverse()) out = `${out.slice(0, y.at)}${' '.repeat(y.len)}${out.slice(y.at + y.len)}`;
    return out.replace(/\b\d+\s*\.(?:\.\.)?\s*(?=(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x?[a-h]?[1-8]|O-O))/g, ' ').replace(/[\p{L}_][\p{L}\p{N}_'’.-]*\p{N}[\p{L}\p{N}_'’.-]*|\p{N}+[\p{L}_][\p{L}\p{N}_'’.-]*/gu, ' ');
  };
  // whether a stated fact gives a number (health, ammo, a count, a score, players left, a cooldown or a game's clock).
  // t: the claim's moment: an M:SS written as a time near it is the recording's, any other one the game's (League's "R
  // on 1:48 cooldown" at 4:26 and Siege's scoreboard clock "at 1:13" at 8:59 are numbers, loop 41)
  const statesNumber = (s, t) => /\d/.test(numberText(s, t));
  const MOMENT_SLACK = 0.75; // s: a named time this far from the claim's is another moment to show the HUD at (verifyClaims)
  // at: the moments a fact holds for, each a time or a span { from, to }; own: the claim's. Compared at whole seconds:
  // "4:17" is the second from 257 to 258, and a number read at 257.8 is in it (the reviewer's probe: 0.75 s slack said no)
  const sec = (x) => Math.floor(x + 1e-6);
  const atMoment = (at, own) => (at || []).some((a) => own.some((o) => (typeof a === 'number' ? sec(a) === sec(o) : o >= a.from - 1 && o < a.to + 1)));
  // The moments a claim gives its numbers at: the times it writes as the recording's near its moment, never a timer's
  // ("health 271 of 1479 with R on 1:24 cooldown" at 1:45 is at 1:45), else the moment it's cited at
  const claimTimes = (said, t) => { const named = recordingTimes(said, t); return named.length ? named : [t]; };
  // the fact line a check quoted, by its words (80% of them in one line), the record's first where both fit
  const wordsOf = (s) => String(s || '').toLowerCase().replace(/<\/?data>/g, ' ').match(/[a-z0-9]+(?:[./][a-z0-9]+)*/g) || [];
  function quotedLine(quote, lines) {
    const q = wordsOf(quote);
    if (q.length < 2) return null;
    let best = null, score = 0;
    for (const l of lines || []) {
      const have = new Set(wordsOf(l.text)), k = q.filter((w) => have.has(w)).length / q.length;
      if (k > score || (k === score && best && best.from !== 'record' && l.from === 'record')) { score = k; best = l; }
    }
    return score >= 0.8 ? best : null;
  }
  /**
   * What a fact line is, for when it can go against a claim (kind, or by its words where it has none): 'hud', a number
   * or a look the HUD showed at an instant (health, ammo, a structure's number, an ability icon lit or dimmed, the
   * scoreboard's clock, anything the check against the video saw), true at its own second only; 'state', a standing
   * count (the score, the K/D/A, who is down), true from its last change on, over a span; 'event', something that
   * happened (a kill-feed line, a move, a fight), true whenever; 'reading', a model's reading of the clip.
   */
  const HUD_LINE = /\b(health|hp|ammo|magazine|shield|structures?|towers?|turrets?|icons?|lit|dimmed|clock read)\b/i, STATE_LINE = /scoreboard shows|K\/D\/A|the kill feed shows .* down|that leaves/i;
  const lineKind = (l) => l?.kind || (l?.from === 'video' ? 'hud' : l?.from === 'reading' ? 'reading' : HUD_LINE.test(l?.text || '') ? 'hud' : STATE_LINE.test(l?.text || '') ? 'state' : 'event');
  /**
   * Why a contradiction the claim check (agent.js checkClaims) found doesn't hold, or '': a fact a reading gives with a
   * number can't go against a claim (a moving clip's number can be a second off or another number: League's mana read
   * as health, "392 of 693", put back over the video check's "1730 of 1820", loop 41); a quote that is no line given
   * can't go against a number the claim gives (the check quoted the claim's own words back at it, "Player health is 392
   * o"); a momentary HUD line only at the claim's own second (an ability's look included: "lit" 6 s before the death says
   * nothing of the ult at it); a standing count only over its span; and something that happened (a kill-feed line, a
   * move) whenever. lines: the claim's fact lines, [{ text, from: 'record' | 'video' | 'reading', at, kind }].
   */
  function staleAgainst({ t, states, quote, lines }) {
    const said = statesNumber(states, t), line = quotedLine(quote, lines), kind = line ? lineKind(line) : null;
    if (!line) return said ? 'a number no line of the record gives' : '';
    if (kind === 'reading') return said || statesNumber(quote, t) ? "a reading's number, read off the clip" : '';
    if (kind === 'event') return '';
    // a standing count with no span to hold over says nothing of when it held: it stands
    if (kind === 'state' && !(line.at || []).some((a) => typeof a === 'object')) return '';
    const at = line.at?.length ? line.at : recordingTimes(quote, t);
    return at.length && !atMoment(at, claimTimes(states, t)) ? (kind === 'state' ? 'a count from another stretch' : 'a number read at another moment') : '';
  }
  /**
   * Whether the check against the video judged a claim's number (fact) by what it saw (saw) at another moment only: the
   * HUD a few seconds before or after, where health and ammo had changed. Then it can't tell, not "goes against". A
   * game's own clock in what it saw ("R on 1:48") is no moment of the recording.
   */
  const sawElsewhen = ({ t, fact, saw }) => { const seen = recordingTimes(saw, t); return statesNumber(fact, t) && seen.length > 0 && !atMoment(seen, claimTimes(fact, t)); };
  /**
   * What the check against the video saw of the numbers at each moment it judged, as fact lines for the claim check and
   * the closing call: a number it read off the HUD at a claim's moment holds over a clip read's (League, loop 41: it
   * fixed 1:45's health to "621 of 1479", and the record check put the read's "271" back). judged: its verdicts,
   * [{ t, facts: [{ fact, saw, verdict }] }]; wrap: its words as data for a prompt (a model's account of the screen,
   * which carries what the screen writes). Returns [{ t, text, from: 'video', kind: 'hud', at }], one a fact, up to max.
   */
  function videoSaw(judged, { max = 24, wrap = (x) => x } = {}) {
    const out = [];
    for (const x of judged || []) {
      if (!Number.isFinite(x?.t)) continue;
      for (const f of Array.isArray(x.facts) ? x.facts : []) {
        const saw = text(f?.saw).replace(/\.$/, '');
        if (!['shows', 'goes_against'].includes(f?.verdict) || !statesNumber(saw, x.t) || out.some((o) => o.saw === saw)) continue;
        const near = recordingTimes(saw, x.t);
        out.push({ t: x.t, saw, text: `the check against the video, looking at ${mmss(x.t, true)}, saw: ${wrap(saw)}`, from: 'video', kind: 'hud', at: near.length ? near : [x.t] });
      }
    }
    return out.slice(-max).map(({ saw, ...y }) => y);
  }

  // ---------- ammo, by weapon slot ----------
  // A HUD with two weapon slots shows each slot's magazine and reserve: Siege at 8:38 read rifle 0 / 89 and pistol
  // 21 / 100, the pistol highlighted as the weapon in hand, and the review said "ammo was at 21/89", the pistol's
  // magazine with the rifle's reserve (loop 40, the user). A pair holds only from one slot.
  const AMMO_WORDS = /\b(ammo|ammunition|magazine|mag|rounds?|bullets?|clip|reserve)\b/i;
  /** The magazine and reserve pairs a text gives for ammo ("ammo was at 21/89", "25 of 64 rounds"), each { mag, reserve }, from clauses that say ammo. */
  function ammoPairs(s) {
    const out = [];
    for (const clause of String(s || '').replace(/<data>[\s\S]*?<\/data>/g, ' ').split(/[;,.](?!\d)/)) {
      if (!AMMO_WORDS.test(clause)) continue;
      for (const m of clause.matchAll(/(?<![\d:])(\d{1,3})\s*(?:\/|of)\s*(\d{1,4})(?![\d:])/g)) out.push({ mag: +m[1], reserve: +m[2] });
    }
    return out;
  }
  /**
   * The slots a HUD reading gives, each { mag, reserve } (and inHand where it says which is highlighted or in hand):
   * every "M / R" pair in it, in order, two or more, e.g. the check against the video's "slot 1 0/89, slot 2 21/100
   * (highlighted)". Fewer than two: no slots, so nothing to tell a mix by.
   */
  function ammoSlots(s) {
    const x = String(s || '').replace(/<data>[\s\S]*?<\/data>/g, ' ');
    const pairs = [...x.matchAll(/(?<![\d:])(\d{1,3})\s*(?:\/|of)\s*(\d{1,4})(?![\d:])([^;,\d]{0,40})/g)].map((m) => ({ mag: +m[1], reserve: +m[2], ...(/\b(highlighted|in hand|equipped|selected|held|active)\b/i.test(m[3]) ? { inHand: true } : {}) }));
    return pairs.length >= 2 ? pairs : [];
  }
  /**
   * The ammo pairs a claim gives that mix slots: one slot's magazine with another slot's reserve, where no slot reads that
   * pair ("21/89" against slots 0/89 and 21/100). slots: ammoSlots of the HUD at the claim's moment. Returns
   * [{ said: '21/89', mag: { slot, ... }, reserve: { slot, ... } }].
   */
  function mixedAmmo(claim, slots = []) {
    if ((slots || []).length < 2) return [];
    return ammoPairs(claim).flatMap((p) => {
      if (slots.some((x) => x.mag === p.mag && x.reserve === p.reserve)) return [];
      const a = slots.findIndex((x) => x.mag === p.mag), b = slots.findIndex((x) => x.reserve === p.reserve);
      return a >= 0 && b >= 0 && a !== b ? [{ said: `${p.mag}/${p.reserve}`, mag: { slot: a + 1, ...slots[a] }, reserve: { slot: b + 1, ...slots[b] } }] : [];
    });
  }

  // ---------- the engine's lines, in chess ----------
  // A move the engine found (the best move, the reply a move allows) is a fact code computed, not one the video shows:
  // the check against the video sent back 16.Qd3 "allowing Bc4" because Black played ...Qa6, and "losing 5.0 pawns"
  // because no score is on screen (loop 40). The moves a fact names, in SAN: pieces, captures, castling, and pawn moves
  // written with a move number ("16. d5", "16...d5")
  const SAN = /(?:\b\d+\s*\.{1,3}\s*)?\b(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8]|O-O(?:-O)?)(?:=[QRBN])?[+#]?|\b\d+\s*\.{1,3}\s*[a-h][1-8](?:=[QRBN])?[+#]?/g;
  const sanKey = (s) => String(s || '').replace(/^\d+\s*\.{1,3}\s*/, '').replace(/[+#!?]/g, '').trim();
  const movesIn = (s) => (String(s || '').match(SAN) || []).map(sanKey).filter(Boolean);
  // what a fact says the engine computed: what a move allows or threatens, a better or best move, the pawns it cost.
  // Not "instead" alone: "played Qd3 instead of castling" says what was played, and they castled (the reviewer's probe)
  const ENGINE_WORDS = /\b(allow(s|ed|ing)?|permit(s|ted|ting)?|threat(s|en|ens|ened|ening)?|refut\w*|engine|best (move|reply|answer|line)|better (move|was|is|would)|should have|could have|centipawns?|evaluation|eval\b|(gave|giving|gives|give) away|(lost|losing|loses|lose|cost|costing|costs|dropp?(ed|ing|s)?) (about |nearly |over )?\d+(\.\d+)? pawns?|\d+(\.\d+)? pawns?)\b/i;
  /**
   * The engine's moves at a chess claim's moment t: the best move and the reply it allows, of each graded move of the
   * player's within 3 s, minus the moves played from 2 s before to 20 s after (a reply that was played the video shows).
   * events: the record (chess-reader's moves, with squares.bestSan and allows). Returns [san].
   */
  function engineMoves(events, t) {
    const played = new Set((events || []).filter((e) => (e.kind === 'move' || e.kind === 'opponent_move') && e.t >= t - 2 && e.t <= t + 20).map((e) => sanKey(e.san)));
    return [...new Set((events || []).filter((e) => e.kind === 'move' && e.grade && Math.abs(e.t - t) <= 3).flatMap((e) => [e.squares?.bestSan, e.allows]).map(sanKey).filter((s) => s && !played.has(s)))];
  }
  // a fact that says a move was played: the board shows whether it was
  const PLAYED = /\b(played|plays|playing|replied|replies|replying|responded|responds|answered|answers|moved|castled|castles|captured|captures|recaptured|took|takes)\b/gi;
  /** The moves a fact says were played: the move right after each played word ("Black replied Bc4", "played 16. d5"), castling for "castled". */
  const playedMoves = (s) => [...String(s || '').matchAll(PLAYED)].flatMap((m) => { const after = String(s).slice(m.index + m[0].length, m.index + m[0].length + 24); return [...(/castl/i.test(m[0]) ? ['O-O'] : []), ...movesIn(after).slice(0, 1)]; });
  /**
   * Whether a fact a chess claim states is the engine's, not judged by the video: it says what a move allows or cost, or
   * names one of the engine's moves (engineMoves) other than as a move played, and says no move was played that was the
   * engine's ("Black replied Bc4", "the player played 16. d5": the board shows those weren't). "Played 16. Qd3, allowing
   * Bc4" is the engine's; a played move alone ("The player played 16. Qe2", "moved the queen to d3 instead of
   * castling") is the board's, whatever the check labelled it.
   */
  // now: the moves the record has played at the claim's moment (movesAt): a fact naming one is about the board, engine
  // words or not. "Nd4 gives away a pawn and the attack with 17 s left" (the e2e's 1:30, Nd4 the player's real move) was
  // taken for the engine's by "gives away", and the claim, with no fact left to judge, came out can't tell (Oct 25)
  const engineFact = (fact, engine = [], now = []) => {
    const f = String(fact || ''), played = playedMoves(f), named = movesIn(f);
    if (played.some((m) => engine.includes(m) || (m === 'O-O' && engine.some((x) => x.startsWith('O-O'))))) return false;
    if (named.some((m) => now.includes(m))) return false;
    return ENGINE_WORDS.test(f) || named.some((m) => engine.includes(m) && !played.includes(m));
  };
  /** The moves the record has played at a chess claim's moment t, from 3 s before to 1 s after (a graded move's window), in SAN. */
  const movesAt = (events, t) => [...new Set((events || []).filter((e) => (e.kind === 'move' || e.kind === 'opponent_move') && e.t >= t - 3 && e.t <= t + 1).map((e) => sanKey(e.san)).filter(Boolean))];
  /**
   * A chess claim's material against the engine's line (chessLog's move.line, from lineGain): "losing the queen" where
   * the engine's line wins a pawn and the attack (16.Qd3, loop 41, H3) is false by code's own reading. Returns why, or ''.
   * line: { line (SAN), net: { piece: n } for the side that replies, pawns, text }.
   */
  const LOST_PIECE = /\b(?:los(?:e|es|ing|t)|drop(?:s|ped|ping)?|hang(?:s|ed|ing)?|gives? away|giving away|gave away|blunder(?:s|ed|ing)? away|sacrific\w*|throw(?:s|ing)? away|threw away)\s+(?:the |a |his |her |their |its |white's |black's |another |one )?(queen|rook|knight|bishop|minor piece|piece|exchange)\b/i;
  const PIECE_VALUE = { queen: 9, rook: 5, knight: 3, bishop: 3, 'minor piece': 3, piece: 3, exchange: 2 };
  function lineContradicts(fact, line) {
    const m = LOST_PIECE.exec(String(fact || ''));
    if (!m || !line || !Number.isFinite(line.pawns)) return '';
    const piece = m[1].toLowerCase(), key = { queen: 'q', rook: 'r', knight: 'n', bishop: 'b' }[piece];
    // the piece itself taken anywhere in the line (took: a line cut mid-exchange nets nothing, its first capture still
    // the piece the move hung), or won by its end, or its worth in material: the claim stands
    const took = Array.isArray(line.took) ? line.took : null, worth = { q: 9, r: 5, n: 3, b: 3, p: 1 };
    if (key ? (line.net?.[key] || 0) > 0 || took?.includes(key) : line.pawns >= PIECE_VALUE[piece] - 0.5 || took?.some((x) => worth[x] >= PIECE_VALUE[piece])) return '';
    return `the engine's line (${line.line}) loses no ${piece}: ${line.text}`;
  }
  /**
   * What to play instead at a graded chess move, as the engine says it: a cite whose better doesn't name the engine's
   * move gets it written in (2.f4's "Play d4 or e4 for classical center control": e4 was already played, and the engine's
   * move was exd5, loop 41, H4). move: the record's graded move ({ san, squares: { bestSan } }). Returns the lesson, with
   * betterBy 'engine' where code wrote it.
   */
  function chessBetter(lesson, move) {
    const best = sanKey(move?.squares?.bestSan || '');
    if (!lesson || !best || movesIn(lesson.better).includes(best)) return lesson;
    return { ...lesson, better: `Play ${move.squares.bestSan}, the engine's move`, betterBy: 'engine' };
  }
  /**
   * A player's clock as read at their graded moves, its misreads left out: a clock never rises (by more than the
   * increment a move) and never falls faster than the recording runs, so of the readings the longest run that keeps both
   * stands, and the rest were another clock or a misread digit. 9:43, 9:51, and 9:05 at moves 16-22 between 7:00 at
   * move 15 and 6:01 at move 26 (loop 41, H5). reads: [{ t, clock: 'M:SS', moves: the player's move count }]. Returns
   * the readings kept.
   */
  function steadyClocks(reads, { increment = 0, slack = 3 } = {}) {
    const xs = (reads || []).map((r) => ({ ...r, s: parseTime(r.clock) })).filter((r) => Number.isFinite(r.s) && Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
    const fits = (a, b) => b.s <= a.s + increment * Math.max(1, (b.moves ?? 1) - (a.moves ?? 0)) + 0.5 && a.s - b.s <= b.t - a.t + slack;
    const best = xs.map(() => 1), prev = xs.map(() => -1);
    for (let j = 0; j < xs.length; j++) for (let i = 0; i < j; i++) if (fits(xs[i], xs[j]) && best[i] + 1 > best[j]) { best[j] = best[i] + 1; prev[j] = i; }
    let k = best.indexOf(Math.max(0, ...best));
    const keep = new Set();
    for (; k >= 0; k = prev[k]) keep.add(k);
    return xs.filter((_, i) => keep.has(i)).map(({ s: _, ...r }) => r);
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
  // everyLoss (cover_losses): each of the costliest losses needs a cited moment at it or led to it (uncoveredLosses),
  // counting the turning points; asked once (agent.js), so it never decides a finding by itself
  function checkFinish(args, { ledger, duration = Infinity, habits = [], measures = [], events = [], deadFor = 5, shots = [], aimTarget = 'head', board = null, coverLosses = false, citeLoss = false, everyLoss = false }) {
    const problems = [];
    const gap = coverLosses ? lossGap(events, ledger) : '';
    if (gap) problems.push(gap);
    const turns = () => (Array.isArray(args?.turning_points) ? args.turning_points : []).map((e) => [parseTime(e?.t), e]).filter(([t]) => Number.isFinite(t) && seen(ledger, t)).map(([t, e]) => [t, ledTo(e, t)]);
    const cover = (cites) => {
      const missed = everyLoss ? uncoveredLosses(lossMoments(events, { deadFor }), [...cites, ...turns()]) : [];
      if (missed.length) problems.push(`Cite each of the losses that cost them most, at it or with led_to it: not cited yet, ${missed.map((l) => `${mmss(l.t)} ${l.what}`).join(', ')}. For each, the decision that lost it, from its clip read and run-up, as a turning point (or a fix or evidence where it shows the finding); or call finish again to keep these, and code adds each still uncovered: from its clip read, checked like your claims, or in chess from the engine's line.`);
    };
    // the death itself can be evidence (dying alone); seconds later the screen is a recap or a teammate's view
    const afterDeath = (t) => { const d = deathAt(events, t, deadFor); return d && t > d.t + 2 ? `At ${mmss(t)} the player was dead (they died about ${mmss(d.t)}), so the screen shows someone else. Cite moments from their own view.` : ''; };
    if (args?.found === false) {
      if (text(args.why).length < 20) problems.push('Say how that cost them (why, one or two sentences).');
      // No habit repeats, but something still cost them: with any loss in the match, the biggest reason is named, as a
      // one-off, at moments that were looked at, one of them where they lost
      const all = citeLoss ? lossMoments(events, { deadFor }) : [];
      if (!all.length) return problems;
      const where = costliest(all).map((l) => `${mmss(l.t)} ${l.what}`).join(', ');
      if (!text(args.reason)) problems.push(`No habit has to repeat for something to have cost them. Name the biggest reason they lost in this match (reason), even if it happened once: what cost them the most at ${where}.`);
      const shown = [];
      for (const e of Array.isArray(args.fixes) ? args.fixes : []) {
        const t = parseTime(e?.t);
        if (!Number.isFinite(t) || t < 0 || t > duration + 1) { problems.push(`${e?.t ?? '?'} isn't a time in this match.`); continue; }
        if (!text(e.what)) problems.push(`Say what happens at ${mmss(t)}.`);
        if (!seen(ledger, t)) { problems.push(`You haven't looked closely at ${mmss(t)}. Look with frames, or cite a moment you did look at.`); continue; }
        if (afterDeath(t)) { problems.push(afterDeath(t)); continue; }
        shown.push([t, ledTo(e, t)]);
      }
      if (!shown.length) problems.push('Cite the moments you looked at that show the reason (fixes), each with what they should have done instead (better).');
      else if (!shown.some((ts) => ts.some((t) => all.some((l) => t >= l.from && t <= l.to)))) problems.push(`The reason they lost has to show where they lost: at least one of its moments at ${where}.`);
      else { const top = missesCostliest(all, shown); if (top) problems.push(top); }
      if (!problems.length) cover(shown);
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
      at.push([t, ledTo(e, t)]);
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
      // a moment counts at a loss it's at, or one it led to: chess's blunders were cited with led_to the reply that
      // punished them, outside the move's own window, and none counted (Oct 24)
      // each moment at one loss, the one its led_to names when that's one, else its own: one moment at a death, with
      // led_to a teammate down 9 s later, counted at both and met the rule alone
      const all = lossMoments(events, { deadFor }), inside = (t) => all.find((l) => t >= l.from && t <= l.to);
      const hit = new Set(at.map(([t, to]) => (to !== t && inside(to)) || inside(t)).filter(Boolean));
      if (hit.size < MIN_LOSSES) {
        const where = costliest(all).map((l) => `${mmss(l.t)} ${l.what}`).join(', ');
        problems.push(`A habit that's losing them games has to show where they lost, at ${MIN_LOSSES} or more separate losses: their deaths, fights they lost, or teammates down near them that nobody traded. You cite ${hit.size} (in this match: ${where || 'none'}). If they don't show it, finish with found false.`);
      } else { const top = missesCostliest(all, at); if (top) problems.push(top); }
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
    if (!problems.length && citeLoss) cover(at);
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
    // and two structures' drops within 2 s are each their own (objectives)
    for (const e of [...a, ...b].sort((x, y) => x.t - y.t)) if (!out.some((o) => o.kind === e.kind && Math.abs(o.t - e.t) < 2 && nameKey(o.victim) === nameKey(e.victim) && o.ply === e.ply && o.structure === e.structure)) out.push(e);
    return out;
  }
  /** Cleans a scan's events: valid times inside the scanned stretch, known kinds, no repeats. */
  function normalizeEvents(raw, { from = 0, to = Infinity } = {}) {
    let list = (Array.isArray(raw) ? raw : [])
      .map((e) => ({ t: parseTime(e?.t), kind: KINDS.includes(e?.kind) ? e.kind : 'other', text: text(e?.text).slice(0, 160) }))
      .map((e) => (e.text ? { ...e, guess: e.text } : e))
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
  /**
   * What an event's text says that code knows (the kill feed, the HUD's numbers, the scoreboard), apart from what a
   * model's look at the video guessed (guess): a low-detail pass's "eliminated by Miss Fortune", the player's own
   * champion, went to the clip read and the claim check as fact, and both repeated it (League, Oct 23). sure: the known
   * part, where text holds both; an event with a guess and no sure is all guess.
   */
  const knownText = (e) => e?.sure ?? (e?.guess ? '' : e?.text || '');
  const eventLine = (e) => [knownText(e), e?.guess && `a look at the video guessed: ${e.guess} (it may be wrong)`].filter(Boolean).join('; ');
  /**
   * A line for a prompt with each player name an event carries (killer, victim, who traded whom) wrapped by wrap
   * (agent.js: G.untrusted): the names are other players' own words, off the kill feed, and the line around them is
   * code's. One pass, the longest name first, so a name inside another isn't wrapped twice. No wrap: the line as it is.
   */
  function wrapNames(line, e, wrap) {
    const names = [...new Set(['killer', 'victim', 'tradedBy', 'trades'].map((k) => text(e?.[k])).filter((n) => n.length >= 2 && n !== 'your death'))].sort((a, b) => b.length - a.length);
    if (!wrap || !line || !names.length) return line;
    const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return String(line).replace(new RegExp(`(^|[^\\p{L}\\p{N}_])(${alt})(?=$|[^\\p{L}\\p{N}_])`, 'gu'), (m, pre, n) => `${pre}${wrap(n)}`);
  }
  // wrap: the names in each line, for a prompt (wrapNames)
  const eventsBrief = (events, { wrap } = {}) => events.map((e) => { const line = wrapNames(eventLine(e), e, wrap); return `${mmss(e.t, !Number.isInteger(e.t))}${e.kind === 'engagement' ? `–${mmss(e.to, !Number.isInteger(e.to))}` : ''} ${e.kind}${line ? `: ${line}` : ''}`; }).join('\n');

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
  // a feed that writes the player as YOU or ME (Siege, Oct 24: "YOU" killed francomix; TenZ's streamer mode, "Me")
  const SELF_NAMES = /^(you|me)$/i;
  function whoIsPlayer({ known = null, hint = null, events = [], sightings = [], deathTimes = [], banners = [] } = {}) {
    if (!sightings.length) return { player: known };
    if (known && sightings.some((s) => sameName(s.killer, known) || sameName(s.victim, known))) return { player: known };
    const self = sightings.flatMap((s) => [s.killer, s.victim]).find((n) => SELF_NAMES.test(String(n || '').trim()));
    if (self) return { player: self };
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
    const steps = counterSteps(readings);
    return steps.slice(1).map((x, i) => ({ t: x.t, by: x.value - steps[i].value }));
  }
  /** The values a running count held, as counterRises reads them: [{ t, value }], its start and then each rise. */
  function counterSteps(readings) {
    const r = (readings || []).filter((x) => Number.isFinite(x?.value));
    // the very next reading has to hold too: a counter that keeps rising (damage) clears a one-off overread later
    const holds = (v, i) => { const ok = (y) => y.value >= v - Math.floor(v * 0.02), next = r.slice(i + 1, i + 1 + HOLD_READS); return (!next.length || ok(next[0])) && next.filter(ok).length >= Math.ceil(next.length * 0.8); };
    const start = r.findIndex((x, i) => holds(x.value, i));
    if (start < 0) return [];
    const out = [{ t: r[start].t, value: r[start].value }];
    for (let i = start + 1; i < r.length; i++) {
      const v = r[i].value;
      if (v > out.at(-1).value && holds(v, i)) out.push({ t: r[i].t, value: v });
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
   * Deaths a HUD shows by its health readout going away: read low, then not read at all at the next GONE_READS sampled
   * times, as when the HUD hides it while the player is dead or spectating (Brawl Stars, Oct 24: two deaths, the bar
   * gone and the screen "Following" a teammate, and no HP read 0). Candidates for the second look, like the HP at 0.
   */
  const GONE_READS = 2;
  function hpGone(health, times, { maxes = [] } = {}) {
    const read = new Map((health || []).map((x) => [x.t, x.value])), ts = [...new Set(times || [])].sort((a, b) => a - b), out = [];
    const full = Math.max(0, ...(maxes || []).map((x) => x.value).filter(Number.isFinite), ...(health || []).map((x) => x.value).filter(Number.isFinite));
    if (!full) return out;
    for (let i = 0; i + GONE_READS < ts.length; i++) {
      const v = read.get(ts[i]);
      if (!Number.isFinite(v) || v > NEAR_DEATH * full) continue;
      if (ts.slice(i + 1, i + 1 + GONE_READS).every((t) => !read.has(t))) { out.push({ t: ts[i + 1], kind: 'death', seenBy: 'hud', text: 'you died (your health readout went away after it read low)' }); i += GONE_READS; }
    }
    return out;
  }
  /**
   * Deaths a HUD shows by its health number at a sliver of full and then high again at the next read, within SLIVER_GAP
   * s: the player died, and the screen moved to a teammate they watch or to their respawn before it read 0 (Brawl
   * Stars, Oct 25: "1 of 11100" at 1:09, dead at 1:10, the screen following a teammate after). Timed between the two
   * reads. Candidates for the second look, like the HP at 0; a heal that fast is told apart there.
   */
  const SLIVER = 0.03, SLIVER_GAP = 8;
  function hpSliver(health, { maxes = [] } = {}) {
    const hp = (health || []).filter((x) => Number.isFinite(x?.value)), out = [];
    const full = Math.max(0, ...(maxes || []).map((x) => x.value).filter(Number.isFinite), ...hp.map((x) => x.value));
    if (!full) return out;
    for (let i = 0; i + 1 < hp.length; i++) {
      const a = hp[i], b = hp[i + 1];
      if (a.value > 0 && a.value <= SLIVER * full && b.t - a.t <= SLIVER_GAP && b.value > NEAR_DEATH * full) out.push({ t: round((a.t + b.t) / 2, 1), kind: 'death', seenBy: 'hud', text: 'you died (your health read nearly 0, then high again)' });
    }
    return out;
  }
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
    // gone only at the moments health was asked for (timesFor): a coarse read without it isn't the readout going away
    for (const d of [...hpGone(hp, counts?.timesFor?.health ?? counts?.times, { maxes: counts?.healthMax }), ...hpSliver(hp, { maxes: counts?.healthMax })]) if (!downs.some((x) => Math.abs(x.t - d.t) <= 5)) downs.push(d);
    downs.sort((a, b) => a.t - b.t);
    return { kills, deaths, downs, points: points.sort((a, b) => a.t - b.t), knows: { kills: knows(counts?.kills, 'kill_count'), deaths: knows(counts?.deaths, 'kill_count'), health: knows(counts?.health, 'health') } };
  }
  /**
   * Two counter reads of one match as one (agent.js passLog: a sparse read through it, a fine one around what happened):
   * each series' readings together in time order, the first read's kept where both read a moment, a side's score under
   * one name (sameSide), and cellsFor: how many moments each part was asked at, for hudRecord's known share.
   */
  // clock: the scoreboard's match clock as written ("1:18"), read under state_facts (agent.js readCounters)
  const SERIES = { damage: 'damage', kills: 'kill_count', deaths: 'kill_count', assists: 'kill_count', health: 'health', healthMax: 'health', clock: 'scoreboard' };
  function mergeCounts(a, b) {
    const reads = [a, b].filter(Boolean);
    if (!reads.length) return null;
    const join = (...xs) => { const m = new Map(); for (const r of xs.flat()) if (r && !m.has(r.t)) m.set(r.t, r); return [...m.values()].sort((p, q) => p.t - q.t); };
    const out = { cells: reads.reduce((n, r) => n + (r.cells || 0), 0), calls: reads.reduce((n, r) => n + (r.calls || 0), 0), times: join(...reads.map((r) => (r.times || []).map((t) => ({ t })))).map((x) => x.t), scores: {}, cellsFor: {} };
    for (const k of Object.keys(SERIES)) out[k] = join(...reads.map((r) => r[k] || []));
    for (const r of reads) for (const [side, xs] of Object.entries(r.scores || {})) { const name = Object.keys(out.scores).find((k) => k === side || sameSide(k, side)) || side; out.scores[name] = join(out.scores[name] || [], xs); }
    // objectives: each structure's health, by its id, where a read had them (structureEvents)
    if (reads.some((r) => r.objectives)) { out.objectives = {}; for (const r of reads) for (const [id, xs] of Object.entries(r.objectives || {})) out.objectives[id] = join(out.objectives[id] || [], xs); }
    // timesFor: the moments each part was asked at; the coarse read skips health where a K/D/A and a damage or ammo
    // counter show the deaths, and hpGone took its moments for health read and gone
    out.timesFor = {};
    for (const part of new Set([...Object.values(SERIES), 'scoreboard', ...(out.objectives ? ['objectives'] : [])])) {
      const asked = reads.filter((r) => !r.asked || r.asked.includes(part));
      out.cellsFor[part] = asked.reduce((n, r) => n + (r.cells || 0), 0);
      out.timesFor[part] = join(...asked.map((r) => (r.times || []).map((t) => ({ t })))).map((x) => x.t);
    }
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

  // ---------- structures' health, off the HUD (objectives) ----------
  // Clash Royale's losses are its towers' health: the right tower 3197 to 761 by 1:33, 761 to 384 by 2:36, and down at
  // 3:27 in sudden death, the match lost 0-1, where the low-detail pass invented the tower down at 0:44 and a win at
  // 3:28 (loop 38, Oct 25). Any game whose HUD writes a structure's health (a tower, a turret, a base) as a number:
  // read with the other counters (agent.js readCounters), each structure's side from the learn (learn.js structures).
  /**
   * The values a structure's health held, from readings in time order ([{ t, value }]): its start, then each drop that
   * holds. Health only falls, so a reading above the value held is a misread, and a lower one counts once the next
   * readings stay at or under it (the very next one, and most of the next HOLD_READS): a level badge read as "13" over
   * a 3197 tower doesn't. It needs 2 later readings or more, unless it's 0: a result screen's numbers read over the towers
   * in the last one or two cells made losses that weren't (the Oct 25 review). The start is the first reading that holds
   * with the next at 70% of it or more.
   */
  const near2 = (v) => Math.ceil(v * 0.02) + 1;
  function structureSteps(readings) {
    const r = (readings || []).filter((x) => Number.isFinite(x?.value) && x.value >= 0 && Number.isFinite(x?.t)).sort((a, b) => a.t - b.t);
    const under = (v) => (y) => y.value <= v + near2(v);
    const holds = (v, i) => { const next = r.slice(i + 1, i + 1 + HOLD_READS); return v === 0 ? next.every(under(0)) : next.length >= 2 && under(v)(next[0]) && next.filter(under(v)).length >= Math.ceil(next.length * 0.8); };
    const start = r.findIndex((x, i) => holds(x.value, i) && (i + 1 >= r.length || r[i + 1].value >= 0.7 * x.value));
    if (start < 0) return [];
    const out = [{ t: r[start].t, value: r[start].value }];
    for (let i = start + 1; i < r.length; i++) if (r[i].value < out.at(-1).value - near2(out.at(-1).value) && holds(r[i].value, i)) out.push({ t: r[i].t, value: r[i].value });
    return out;
  }
  /**
   * The losses and points a structure's health shows. A stretch of drops, each within STRUCTURE_GAP s of the last, that
   * took STRUCTURE_DROP of its full health or more (its first value) is one loss of the player's (objective_damage, at
   * its last drop, with was and now: "3197 to 761") for a structure of theirs. One that ends at 0, or whose number goes
   * (read under NEAR_DEATH of full, then missing at the next GONE_READS moments it was asked at while another structure
   * read), is the structure destroyed: a point against the player for their own (point_lost), for them for the other
   * side's (point_won). Damage to the other side's that leaves it standing is no event. structures: the profile's
   * [{ id, label, side: own | other }]; counts: readCounters' (mergeCounts), objectives: { id: [{ t, value }] }, with
   * timesFor.objectives the moments they were asked at. Returns the events in time order.
   */
  /**
   * The structures' readings without the moments a screen wrote over them all: two or more read at one moment, all the
   * same number, each lower than it last read, and the moments after while they stay all the same. Every tower falling
   * at once to one value is a result screen or an overlay, not damage. counts.objectives: { id: [{ t, value }] }.
   */
  function structureReads(counts) {
    const reads = counts?.objectives || {}, ids = Object.keys(reads), at = new Map(), last = new Map(), screen = new Set();
    if (ids.length < 2) return reads;
    for (const id of ids) for (const x of reads[id] || []) if (Number.isFinite(x?.value)) (at.get(x.t) || at.set(x.t, new Map()).get(x.t)).set(id, x.value);
    let after = false;
    for (const t of [...at.keys()].sort((a, b) => a - b)) {
      const vals = [...at.get(t)], same = vals.length >= 2 && vals.every(([, v]) => v === vals[0][1]);
      const falling = vals.every(([id, v]) => last.has(id) && v < last.get(id) - near2(last.get(id)));
      if (same && (falling || after)) { screen.add(t); after = true; continue; }
      after = false;
      for (const [id, v] of vals) last.set(id, v);
    }
    return screen.size ? Object.fromEntries(ids.map((id) => [id, (reads[id] || []).filter((x) => !screen.has(x.t))])) : reads;
  }
  const STRUCTURE_DROP = 0.1, STRUCTURE_GAP = 12;
  function structureEvents(counts, structures) {
    const reads = structureReads(counts), asked = [...new Set(counts?.timesFor?.objectives ?? counts?.times ?? [])].sort((a, b) => a - b), out = [];
    const readOther = (id, t) => Object.entries(reads).some(([k, xs]) => k !== id && xs.some((x) => x.t === t && Number.isFinite(x.value)));
    for (const s of structures || []) {
      const xs = (reads[s.id] || []).filter((x) => Number.isFinite(x?.value)), steps = structureSteps(xs);
      if (!steps.length) continue;
      const full = steps[0].value, own = s.side === 'own', label = text(s.label) || 'structure';
      // destroyed: a 0 that holds, or the number gone where the others still read
      const last = steps.at(-1), lastRead = Math.max(...xs.map((x) => x.t));
      let fell = last.value === 0 ? last.t : null;
      if (fell == null && full > 0 && last.value <= NEAR_DEATH * full) {
        const after = asked.filter((t) => t > lastRead).slice(0, GONE_READS);
        if (after.length === GONE_READS && after.every((t) => readOther(s.id, t))) fell = after[0];
      }
      const stretches = [];
      for (let i = 1; i < steps.length; i++) {
        const cur = stretches.at(-1);
        if (cur && steps[i].t - cur.t <= STRUCTURE_GAP) Object.assign(cur, { t: steps[i].t, now: steps[i].value });
        else stretches.push({ start: steps[i].t, t: steps[i].t, was: steps[i - 1].value, now: steps[i].value });
      }
      // a fall right after a stretch of drops is one loss, from where the stretch began
      const end = fell != null ? stretches.find((x) => x.now === 0 || (fell >= x.t && fell - x.t <= STRUCTURE_GAP)) : null;
      for (const x of stretches) {
        if (x === end || !own || x.was - x.now < STRUCTURE_DROP * full) continue;
        out.push({ t: x.t, kind: 'objective_damage', side: 'own', structure: label, was: x.was, now: x.now, start: x.start, seenBy: 'hud', text: `your ${label}'s health fell from ${x.was} to ${x.now} (the HUD's number over it)` });
      }
      if (fell != null) {
        const was = end ? end.was : last.value;
        out.push({ t: fell, kind: own ? 'point_lost' : 'point_won', side: own ? 'own' : 'other', structure: label, was, now: 0, ...(end ? { start: end.start } : {}), seenBy: 'hud', text: `${own ? 'your' : "the other side's"} ${label} was destroyed (the HUD's number over it fell from ${was}${last.value === 0 ? ' to 0' : ' and went'})` });
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }
  /** Around each drop of a structure's health the sparse read found, and after its last low reading, to time it (fine read). */
  function structureSpans(counts, step) {
    return Object.values(structureReads(counts)).flatMap((xs) => {
      const steps = structureSteps(xs), full = steps[0]?.value || 0, last = steps.at(-1), lastRead = Math.max(...xs.map((x) => x.t));
      return [...steps.slice(1).map((s) => [s.t - step - 1, s.t + 1]), ...(last && full && last.value <= NEAR_DEATH * full ? [[lastRead, lastRead + 3 * step]] : [])];
    });
  }
  /**
   * A one-on-one game's record with its structures' health in hand (structureEvents): the low-detail pass's structures
   * destroyed (point_lost for the player's, point_won for the other side's) yield to the HUD's numbers where they were
   * read. One near a fall the HUD shows (within slack s) is that fall, at the HUD's time and in its words. One with none
   * goes where the numbers rule it out: every structure of that side read on both sides of it (within COVER_GAP s), or
   * each read in the COVER_GAP s before it at half its full health or more, which no fall that fast leaves standing.
   * Else it stays: the structure it means may be the one whose number went. hud: structureEvents'. Returns { events,
   * dropped }.
   */
  function trustStructures(events, hud, { counts = null, structures = [], slack = 8 } = {}) {
    const reads = structureReads(counts), sideOf = { point_lost: 'own', point_won: 'other' }, out = [], dropped = [];
    const falls = (hud || []).filter((e) => e.kind === 'point_lost' || e.kind === 'point_won');
    const standing = (s, t) => { const xs = (reads[s.id] || []).filter((x) => Number.isFinite(x.value)), full = structureSteps(xs)[0]?.value; const before = xs.filter((x) => x.t < t && x.t >= t - COVER_GAP).at(-1); return !!full && !!before && before.value >= 0.5 * full; };
    for (const e of events || []) {
      const side = e.seenBy === 'hud' ? null : sideOf[e.kind], all = (structures || []).filter((s) => s.side === side);
      if (!side || !all.length) { out.push(e); continue; }
      if (falls.some((f) => f.kind === e.kind && Math.abs(f.t - e.t) <= slack)) continue;
      if (all.every((s) => covered((reads[s.id] || []).filter((x) => Number.isFinite(x.value)), e.t)) || all.every((s) => standing(s, e.t))) { dropped.push(e); continue; }
      out.push(e);
    }
    return { events: [...out, ...(hud || [])].sort((a, b) => a.t - b.t), dropped };
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
      // the HUD backs the death or kill, not the pass's words about it (who did it, where)
      out.push({ ...e, ...(keepTime ? {} : { t: r.t, seenBy: 'hud' }), text: `${e.text || kind} (the HUD agrees)`, ...(e.guess ? { sure: r.text } : {}) });
    }
    (rises || []).forEach((r, i) => { if (!used.has(i)) out.push(r); });
    return { events: out.sort((a, b) => a.t - b.t), dropped, unjudged };
  }
  /**
   * Fights a low-detail pass called lost (the player downed or killed) with no death of theirs in them now: the death was
   * a misread, so how they ended isn't known (none).
   */
  const settleFights = (events) => (events || []).map((e) => (e.kind === 'engagement' && e.outcome === 'lost' && !events.some((d) => d.kind === 'death' && d.t >= e.from - 1 && d.t <= e.to + 3) ? { ...e, outcome: 'none', text: `no death of theirs here after all; ${e.text}`, ...(e.sure !== undefined ? { sure: ['no death of theirs here after all', e.sure.replace(/^lost(; |$)/, '')].filter(Boolean).join('; ') } : {}) } : e));
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
  // objective_damage (objectives) ranks with a point against them, damage (hp_bar) with a near-death
  const CLIP_RANK = { death: 4, point_lost: 4, objective_damage: 4, near_death: 3, damage: 3, ally_death: 3, kill: 2, point_won: 2 };
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
   * Windows over the fights a low-detail pass listed, for a record whose deaths nothing could check (no kill feed, K/D/A,
   * or HP number, and no death the pass saw to look at again): each fight's last tail s to 2 s after it, where a death
   * that ended it shows (a death screen, the screen following a teammate), unread (unchecked), past the windows there are
   * and overlapping none, up to max in all, the ones the pass called lost first. Brawl Stars, loop 40 (Oct 25): with no
   * health box learned, the pass listed 9 fights and no deaths, no window was made, and the review ended "nothing lost"
   * after 3 calls; the match had 2 deaths. fights: [{ from, to, outcome }]. Returns the new windows, in time order.
   */
  function fightWindows(fights, windows = [], { duration = Infinity, tail = 8, max = 16 } = {}) {
    const rank = { lost: 0, none: 1, won: 2 }, out = [], free = Math.max(0, max - (windows || []).length);
    const list = (fights || []).filter((f) => Number.isFinite(f?.from) && Number.isFinite(f?.to) && f.to >= f.from).sort((a, b) => (rank[a.outcome] ?? 1) - (rank[b.outcome] ?? 1) || a.from - b.from);
    for (const f of list) {
      const w = { from: round(Math.max(0, f.from, f.to - tail), 1), to: round(Math.min(duration, f.to + 2), 1), events: [], firing: [], hits: [], unchecked: true };
      if (out.length >= free || w.to - w.from < 2 || [...(windows || []), ...out].some((x) => x.from < w.to && x.to > w.from)) continue;
      out.push(w);
    }
    return out.sort((a, b) => a.from - b.from);
  }
  // When a window holding a loss (their death, a point against) is read as video, it starts this far back, to show what
  // led to it: the decision that lost a fight is often well before the death (League, Oct 23: an overextension alone
  // and a Warwick ult, read off a few stills as "turret range"). The window itself, one fight, stays as it is.
  const RUN_UP = 18;
  // long_runup (agent.js): 30 s, for decisions made 18-30 s before the loss. Clash Royale's 3:27 was decided 3:01-3:15
  // with the clip starting 3:09; League's pings for the 1:48 death came at 1:16-1:32, the clip starting 1:30 (Oct 25)
  const LONG_RUN_UP = 30;
  // A window's losses, read as one: the player's death, a point against them, and a near-death the review reads as a
  // loss (nearLoss, set by agent.js under near_loss: read as now, none of the four near-deaths recorded in loops 37 and
  // 38 got a factor, Oct 25); a structure of theirs losing health (objectives) and damage taken (hp_bar, read as a
  // loss like a near-death, w.nearLoss) too
  const windowLosses = (w) => (w?.events || []).filter((e) => e.kind === 'death' || e.kind === 'point_lost' || e.kind === 'objective_damage' || (w.nearLoss && (e.kind === 'near_death' || e.kind === 'damage')));
  // runUp: how far back from the loss the read starts (RUN_UP, or LONG_RUN_UP under long_runup)
  const readFrom = (w, runUp = RUN_UP) => { const loss = windowLosses(w).map((e) => e.t); return loss.length ? Math.max(0, Math.min(w.from, Math.min(...loss) - runUp)) : w.from; };
  /**
   * The windows whose near-death is read like a death (run-up, the last seconds at the full rate, the HUD as it came, high
   * detail), up to max of them, the lowest by health share first: a false low costs high-detail tokens, and Brawl Stars'
   * record had seven, five of them a teammate's health while the screen followed him (Oct 25). A window with a death or
   * a point against them is read as that already. Returns their indices.
   */
  // damage taken off the health bar (hp_bar) is ranked with them, by the share of full health it left
  const lowShare = (e) => (e.kind === 'near_death' ? (e.of > 0 ? e.hp / e.of : 1) : e.kind === 'damage' ? (Number.isFinite(e.now) ? damageLeft(e) : 1) : Infinity);
  function nearLosses(windows, { max = 2 } = {}) {
    const share = (w) => Math.min(...(w.events || []).map(lowShare));
    return (windows || []).map((w, i) => ({ w, i })).filter(({ w }) => (w.events || []).some((e) => e.kind === 'near_death' || e.kind === 'damage') && !(w.events || []).some((e) => e.kind === 'death' || e.kind === 'point_lost' || e.kind === 'objective_damage'))
      .sort((a, b) => share(a.w) - share(b.w) || a.w.from - b.w.from).slice(0, max).map(({ i }) => i).sort((a, b) => a - b);
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
      // a window kept to be watched, over a record that has its fights already (no kill feed): no fight of its own
      if (w.watch) return;
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
        if (!out.some((o) => o.kind === 'ability' && Math.abs(o.t - a.t) < 2)) { const said = `they used an ability (the clip read calls it ${text(a.name).slice(0, 60)}${a.what ? `: ${text(a.what).slice(0, 100)}` : ''})`; out.push({ t: a.t, kind: 'ability', who: 'player', name: text(a.name).slice(0, 60), seenBy: 'clip', text: said, guess: said }); }
      }
      // the damage counter rising is a fight whatever the clip says; firing alone can be a reload
      if (r.fight === 'no_fight' && !w.events.length && !w.hits?.length) return;
      const outcome = inside(w, 'death') ? 'lost' : inside(w, 'kill') ? 'won' : 'none';
      const how = { player_engaged: 'they engaged first', enemy_engaged: 'the enemy engaged first' }[r.fight];
      // the outcome is the record's; who engaged and how it went are the clip read's
      const fell = outcome === 'none' ? 'no one fell' : outcome, story = [how, text(r.story)].filter(Boolean).join('; ');
      out.push({ t: w.from, from: w.from, to: w.to, kind: 'engagement', outcome, startedBy: r.fight, seenBy: 'clip', text: [fell, story].filter(Boolean).join('; '), ...(story ? { sure: fell, guess: story } : {}) });
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
   * One clip read's moments in the match's time (onClock), the ones no offset puts inside the clip left out. w: the
   * clip as read, { from, to }, with starts and loss for a loss's clip of two parts.
   */
  function clipMoments(moments, w) {
    return onClock((Array.isArray(moments) ? moments : []).map((m) => ({ t: m?.t, what: text(m?.what).slice(0, 160) })).filter((m) => m.what), w).filter((m) => Number.isFinite(m.t));
  }
  /**
   * A clip read's times on the recording's clock, item by item. A read is told every time is the recording's and still
   * gives some on a clip's own clock: from the clip's start, or, in a loss's clip of two parts, from the part's own
   * start, since each part is told its own 0:00 (Valorant, Oct 24: "0:17" in the clip of 0:22.5 to 0:43.5 was 0:39.5,
   * from its start; in the one of 1:59.75 to 2:20.8, "Player killed" at "0:08" was the death at 2:17.75, from the second
   * part's). Each offset is tried (none, the clip's start, each part's start), and one that puts the time inside the
   * clip, a second to spare, stands. Where more than one does: the one the list's other times settle, since a read times
   * one list on one clock, else none, else the one nearest the clip's loss, which its last part holds. A time no offset
   * puts inside it is a clock the game shows (League's 15:43 for 1:43, Oct 24) and comes back NaN. items: [{ t, ... }]
   * with t in M:SS; span: { from, to, starts: [each part's start], loss }.
   */
  function onClock(items, { from = 0, to = Infinity, starts = [], loss = null } = {}) {
    const inside = (x) => x >= from - 1 && x <= to + 1, offsets = [...new Set([0, from, ...(starts || [])].filter(Number.isFinite))];
    const list = (Array.isArray(items) ? items : []).map((m) => { const said = parseTime(m?.t); return { m, said, fits: Number.isFinite(said) ? offsets.filter((k) => inside(said + k)) : [] }; });
    const votes = new Map();
    for (const x of list) if (x.fits.length === 1) votes.set(x.fits[0], (votes.get(x.fits[0]) || 0) + 1);
    const settled = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
    const nearest = (said, fits) => fits.reduce((a, b) => (Math.abs(said + b - loss) < Math.abs(said + a - loss) ? b : a));
    const pick = ({ said, fits }) => (!fits.length ? NaN : fits.length === 1 ? fits[0] : fits.includes(settled) ? settled : fits.includes(0) ? 0 : Number.isFinite(loss) ? nearest(said, fits) : fits[0]);
    return list.map(({ m, said, fits }) => ({ ...m, t: round(said + pick({ said, fits }), 2) }));
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
  // times: when each steady reading differs from the one before it
  function shotsFired(readings) {
    const steady = steadyReadings(readings);
    if (steady.length < 2) return null;
    const times = changeTimes(steady), fired = times.length > 0 || ammoChanged(steady[0].reading, steady.at(-1).reading);
    if (!fired && steady.at(-1).t - steady[0].t < 0.6 * (readings.at(-1).t - readings[0].t)) return null;
    return { fired, changes: times.length, times, from: steady[0].t, to: steady.at(-1).t };
  }
  /** The times of the steady readings that differ from the one before: a shot, a burst, a reload, or a swap each. */
  function changeTimes(steady) {
    const times = [];
    for (let i = 1; i < steady.length; i++) if (ammoChanged(steady[i - 1].reading, steady[i].reading)) times.push(steady[i].t);
    return times;
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
  const fireTimes = (readings, hold = 2) => changeTimes(steadyReadings(readings, hold));
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
      const counted = [outcome === 'none' ? 'no one fell' : outcome, f.hits ? `dealt damage ${f.hits} time${f.hits === 1 ? '' : 's'}` : null, f.bursts ? `fired in ${f.bursts} burst${f.bursts === 1 ? '' : 's'}` : null].filter(Boolean).join('; ');
      // the pass's own words about the fight are its guess
      return { t: round(f.from, 1), from: round(f.from, 1), to: round(f.to, 1), kind: 'engagement', outcome, bursts: f.bursts, hits: f.hits, seenBy: [...f.sources].sort().join('+'), text: [counted, note].filter(Boolean).join('; '), ...(note ? { sure: counted, guess: note } : {}) };
    });
  }

  // ---------- what code read of the match at a moment ----------
  /**
   * The numbers code read at moment t (a loss), for that loss's clip read and the coach, as true facts: what reads leave
   * out or get wrong. Rocket League, Oct 24: "aerial car control failed" at 4:08, with the score 2-0 and 1:18 left;
   * Valorant 4:15: 1 against 2, which no read said; Siege 8:57: an empty magazine for 21 s, read as "engaged in a
   * gunfight with critical health". events: the record; counts: readCounters' (mergeCounts); ammo: ammo readings
   * [{ t, reading }] before t (agent.js ammoReads); rounds: a game played in rounds; side: the player's. Returns { score:
   * [{ side, value, mine }], clock: { t, value }, kda: [k, d, a], health: [{ t, before, value, of }], downs: { since,
   * marked, ally, enemy, allies, enemies }, shots: { from, to, at, changes, fired } }, each null or empty where nothing was read.
   */
  const HEALTH_AT = [10, 6, 2];
  // the record's kill-feed lines, by kind, sided or not (a plain-text feed's lines between two others are 'other')
  const FEED_KINDS = ['kill', 'death', 'ally_death', 'ally_kill', 'other'];
  /**
   * Each kill-feed name's team, for the lines the record left without one. A feed read as plain text (no team colors
   * measured) gets no sides on its rows in buildKillfeed, but the player's own: in Siege (loop 40) every line was
   * sideless but the player's death, so code told the 8:58 read "0 of the player's side and 0 of the other side down"
   * since 0:00, when it was 2 v 3. In a two-team game the two names on a line are on opposite teams, so the sides the
   * record has spread from name to name along the lines until nothing changes; a name the lines put on both teams (80%
   * or less one way) stays unknown. Names match as sameName does ("Capzi." and "Capzl." are one). lines: kill-feed
   * events { killer, victim, killerTeam, victimTeam }. Returns name => 'ally' | 'enemy' | null.
   */
  function feedTeams(lines) {
    const names = [], idOf = (n) => { if (!nameKey(n)) return -1; let i = names.findIndex((m) => sameName(m, n)); if (i < 0) i = names.push(n) - 1; return i; };
    const pairs = (lines || []).map((e) => ({ k: idOf(e.killer), v: idOf(e.victim), kt: e.killerTeam === 'ally' || e.killerTeam === 'enemy' ? e.killerTeam : null, vt: e.victimTeam === 'ally' || e.victimTeam === 'enemy' ? e.victimTeam : null }));
    const settle = (votes) => votes.map((v) => { const n = v.ally + v.enemy, top = v.ally >= v.enemy ? 'ally' : 'enemy'; return n && v[top] / n > 0.8 ? top : null; });
    const seeds = () => { const v = names.map(() => ({ ally: 0, enemy: 0 })); for (const p of pairs) { if (p.k >= 0 && p.kt) v[p.k][p.kt]++; if (p.v >= 0 && p.vt) v[p.v][p.vt]++; } return v; };
    let team = settle(seeds());
    for (let pass = 0; pass <= names.length; pass++) {
      const v = seeds();
      for (const p of pairs) {
        if (p.k < 0 || p.v < 0 || p.k === p.v) continue;
        if (!p.vt && team[p.k]) v[p.v][other(team[p.k])]++;
        if (!p.kt && team[p.v]) v[p.k][other(team[p.v])]++;
      }
      const next = settle(v);
      if (next.every((x, i) => x === team[i])) break;
      team = next;
    }
    return (n) => { const i = names.findIndex((m) => sameName(m, n)); return i < 0 ? null : team[i]; };
  }
  /**
   * When each round ended, by the scoreboard: in a game played in rounds, a side's score rises once a round, after its
   * last kill and before the next round's first. Siege's rounds run 3 minutes with a minute or more of quiet in them, so
   * the kill feed's breaks of ROUND_GAP s (roundStarts) put a start inside round 4, 6 s before its first line and after
   * two of its downs (loop 40). Rises closer than ROUND_GAP s apart aren't rounds (a kill score), so none count then.
   * Returns { ends: [t], from, to } (from/to: the stretch the score was read over), or null with no score read.
   */
  const POST_ROUND = 12; // s after the score changed in which a kill is still the round before's
  const ROUND_LULL = 15; // s with no kill-feed line after a round's end (and its POST_ROUND kill, if any)
  function scoreRounds(counts) {
    const series = Object.values(counts?.scores || {}).filter((xs) => Array.isArray(xs) && xs.length);
    if (!series.length) return null;
    const all = series.flat().filter((x) => Number.isFinite(x?.t)), ends = [...new Set(series.flatMap((xs) => counterRises(xs).map((r) => r.t)))].sort((a, b) => a - b);
    if (!all.length || ends.slice(1).some((x, i) => x - ends[i] < ROUND_GAP)) return null;
    return { ends, from: Math.min(...all.map((x) => x.t)), to: Math.max(...all.map((x) => x.t)) };
  }
  // structures (objectives): the profile's [{ id, label, side }], each one's health as it stood at t (structureSteps)
  function matchState(events, counts, t, { rounds = false, side = '', deadFor = 5, ammo = null, structures = null } = {}) {
    const held = (xs) => { const s = counterSteps(xs).filter((x) => x.t <= t); return s.length ? s.at(-1).value : null; };
    // when a standing count last changed (its step's time), so the claim check holds it over its span, not an instant
    const heldSince = (xs) => { const s = counterSteps(xs).filter((x) => x.t <= t); return s.length ? s.at(-1).t : null; };
    const score = Object.entries(counts?.scores || {}).map(([name, xs]) => ({ side: name, value: held(xs), mine: !!side && sameSide(name, side) })).filter((x) => x.value != null);
    const scoreSince = Math.max(...Object.values(counts?.scores || {}).map((xs) => heldSince(xs) ?? -Infinity));
    const clock = (counts?.clock || []).filter((x) => x.t <= t && x.t >= t - 8 && text(x.value)).at(-1) || null;
    const kda = ['kills', 'deaths', 'assists'].map((k) => held(counts?.[k])), kdaSince = Math.max(...['kills', 'deaths', 'assists'].map((k) => heldSince(counts?.[k]) ?? -Infinity));
    // health read while they were dead is a teammate's, on the screen they watch
    const tops = (counts?.healthMax || []).filter((x) => Number.isFinite(x?.value) && x.value > 0), hp = (counts?.health || []).filter((x) => Number.isFinite(x?.value) && x.t < t && !deathAt(events, x.t, deadFor));
    const full = (at) => tops.filter((x) => Math.abs(x.t - at) <= MAX_NEAR).sort((a, b) => Math.abs(a.t - at) - Math.abs(b.t - at))[0]?.value ?? modeOf(tops.map((x) => x.value));
    const health = [];
    for (const k of HEALTH_AT) {
      const x = hp.filter((y) => Math.abs(y.t - (t - k)) <= 1.5).sort((a, b) => Math.abs(a.t - (t - k)) - Math.abs(b.t - (t - k)))[0];
      if (x && !health.some((y) => y.t === x.t)) health.push({ t: x.t, before: round(t - x.t, 1), value: x.value, of: full(x.t) ?? null });
    }
    // In a round with no respawn, who is left on each side: the kill feed's downs since the round started, against the
    // names it showed on each side through the match (Valorant 4:15, Oct 24: four teammates and three enemies down, of
    // five a side: 1 v 2). A missed line makes it wrong, so it's said as what the kill feed shows.
    let downs = null;
    // every kill-feed line, each with its sides: the record's, else spread from the names' other lines (feedTeams)
    const feed = (events || []).filter((e) => !e.knock && ((e.victimTeam === 'ally' || e.victimTeam === 'enemy') || (FEED_KINDS.includes(e.kind) && nameKey(e.killer) && nameKey(e.victim))));
    const teamOf = feedTeams(feed);
    const lines = feed.map((e) => { const kt = e.killerTeam || teamOf(e.killer) || other(e.victimTeam || teamOf(e.victim)), vt = e.victimTeam || teamOf(e.victim) || other(kt); return { ...e, killerTeam: kt, victimTeam: vt }; });
    // the round's start: the record's round starts; else the scoreboard's rises where it was read (scoreRounds), and the
    // kill feed's breaks outside that stretch
    const marked = (events || []).some((e) => e.kind === 'round_start'), byScore = marked ? null : scoreRounds(counts);
    const sided = lines.filter((e) => e.victimTeam === 'ally' || e.victimTeam === 'enemy');
    // a kill in the seconds after the score changed (POST_ROUND: Valorant's hunt after a spike goes off) is the round
    // before's, so the round starts after it
    const after = (r) => Math.max(r, ...sided.filter((e) => e.t > r && e.t <= r + POST_ROUND).map((e) => round(e.t + 0.01, 2)));
    // A rise of the score ends a round only where the kill feed says so too: a lull after it (one kill at most in the
    // POST_ROUND s after, then none for ROUND_LULL s), or a side wiped since the round before. One rise misread inside a
    // round (Valorant's blue 2 to 3 at 3:44, with three kills in the 10 s after it) made 1 v 2 read 5 v 5 (the reviewer's
    // probe). A rise that isn't one leaves the feed's own breaks to say where rounds start.
    const roundEnd = (r, prev) => {
      const soon = sided.filter((e) => e.t > r && e.t <= r + POST_ROUND), last = soon.length ? soon.at(-1).t : r;
      const lull = soon.length <= 1 && !sided.some((e) => e.t > last && e.t <= last + ROUND_LULL);
      const team = (side) => sided.filter((e) => e.t > prev && e.t <= r + 1 && e.victimTeam === side).reduce((names, e) => (names.some((n) => sameName(n, e.victim)) ? names : [...names, e.victim]), []).length;
      const size = (side) => sided.flatMap((e) => [e.killerTeam === side ? e.killer : null, e.victimTeam === side ? e.victim : null]).filter((n) => nameKey(n).length).reduce((names, n) => (names.some((m) => sameName(m, n)) ? names : [...names, n]), []).length;
      return lull || ['ally', 'enemy'].some((side) => size(side) >= 3 && team(side) >= size(side));
    };
    // a side wiped since the round's start before it: the feed's last break, or the score's rise before
    const breaks = roundStarts(sided), ends = byScore ? byScore.ends.filter((r, i) => roundEnd(r, Math.max(-Infinity, ...breaks.filter((b) => b < r), ...(i ? [byScore.ends[i - 1]] : [])))) : [];
    // inside the stretch the score was read, its rises say where rounds start; where one of them wasn't a round's end,
    // the feed's breaks there do too (away from the rises that were)
    const doubted = byScore && ends.length < byScore.ends.length;
    const starts = marked ? roundStarts(events) : ends.length ? [...breaks.filter((s) => s < byScore.from || s > byScore.to || (doubted && !ends.some((r) => Math.abs(after(r) - s) < ROUND_GAP))), ...ends.map(after)].sort((a, b) => a - b) : breaks;
    // A death of the player's own since that start means a round start the record missed, so nothing is counted then.
    const since = Math.max(0, ...starts.filter((s) => s <= t)), now = lines.filter((e) => e.t >= since && e.t < t - 0.05);
    // and a line since then with no side either way can't be counted: nothing is said rather than a wrong count
    if (rounds && sided.length && !now.some((e) => e.kind === 'death') && now.every((e) => e.victimTeam === 'ally' || e.victimTeam === 'enemy')) {
      const roster = (team) => sided.flatMap((e) => [e.killerTeam === team ? e.killer : null, e.victimTeam === team ? e.victim : null]).filter((n) => nameKey(n).length).reduce((names, n) => (names.some((m) => sameName(m, n)) ? names : [...names, n]), []).length;
      const fromScore = !marked && ends.map(after).includes(since);
      downs = { since, marked, ...(fromScore ? { byScore: true } : {}), ally: now.filter((e) => e.victimTeam === 'ally').length, enemy: now.filter((e) => e.victimTeam === 'enemy').length, allies: roster('ally'), enemies: roster('enemy') };
      // the count's last change: its latest line (not in deepEqual's way, so as its own field, off the enumerable ones)
      Object.defineProperty(downs, 'last', { value: now.length ? now.at(-1).t : since, enumerable: false });
    }
    // the ammo counter, read at 30 fps: each change a shot, a burst, or a reload, and none at all, neither (shotsFired);
    // at: the loss, which its times are said against (the readings stop at the player's death, a second or so before)
    const reads = (ammo || []).filter((x) => x.t <= t + 0.05), fired = reads.length ? shotsFired(reads) : null;
    const shots = fired ? { from: reads[0].t, to: reads.at(-1).t, at: t, changes: fired.times, fired: fired.fired } : null;
    const towers = structures ? structures.map((s) => { const st = structureSteps(structureReads(counts)[s.id]), held = st.filter((x) => x.t <= t + 0.05).at(-1); return held ? { label: text(s.label) || 'structure', side: s.side, value: held.value, of: st[0].value, t: held.t } : null; }).filter(Boolean) : null;
    const out = { t, score, clock, kda: kda.every((x) => x != null) ? kda : null, health, downs, shots, ...(towers ? { structures: towers } : {}) };
    if (out.kda && Number.isFinite(kdaSince)) Object.defineProperty(out, 'kdaSince', { value: kdaSince, enumerable: false });
    if (score.length && Number.isFinite(scoreSince)) Object.defineProperty(out, 'scoreSince', { value: scoreSince, enumerable: false });
    return out;
  }
  /**
   * matchState as lines for a prompt, each said as what the HUD or the kill feed shows. what: the moment, "the death".
   * wrap: for the words read off the screen (a side's name, the clock as written), as data (agent.js: G.untrusted); the
   * numbers are code's. timed: each line as { text, at }, at the moments it holds for ([t], or [{ from, to }]), so a
   * claim is checked only against a number read at its own moment (claimSource).
   */
  function stateFacts(st, { what = 'the loss', wrap = (x) => x, timed = false } = {}) {
    if (!st) return [];
    // kind: 'hud' for a number or look at an instant (true at its second), 'state' for a standing count (true over its
    // span, from its last change to the loss): the claim check judges each by its own (C.staleAgainst)
    const out = [], now = Number.isFinite(st.t) ? [st.t] : [], held = (since) => (Number.isFinite(since) && Number.isFinite(st.t) ? [{ from: since, to: st.t }] : now);
    const push = (text, at = now, kind = 'hud') => out.push({ text, at, kind });
    if (st.score?.length) push(`the scoreboard shows ${st.score.map((x) => `${wrap(x.side)} ${x.value}${x.mine ? " (the player's side)" : ''}`).join(', ')}`, held(st.scoreSince), 'state');
    if (st.clock) push(`the scoreboard's clock read ${wrap(String(st.clock.value).slice(0, 12))} at ${mmss(st.clock.t, true)}`, [st.clock.t]);
    if (st.kda) push(`the HUD's K/D/A read ${st.kda.join('/')}`, held(st.kdaSince), 'state');
    if (st.health?.length) push(`the HUD's health number read ${st.health.map((x) => `${x.value}${x.of ? ` of ${x.of}` : ''} at ${mmss(x.t, true)} (${x.before} s before ${what})`).join(', ')}`, st.health.map((x) => x.t));
    const d = st.downs;
    if (d) out.push({ kind: 'state', at: held(d.last ?? d.since), text: `since ${mmss(d.since, true)}${d.marked ? ', the round\'s start' : d.byScore ? ', when the scoreboard last changed (the round before it ended)' : d.since === 0 ? ', the recording\'s start' : ', the round\'s start as far as the kill feed shows (after its last break of 30 s or more)'}, the kill feed shows ${d.ally} of the player's side and ${d.enemy} of the other side down${d.allies >= 3 && d.enemies >= 3 ? `; with ${d.allies} and ${d.enemies} names on the two sides in the feed through the match, that leaves ${Math.max(0, d.allies - d.ally)} v ${Math.max(0, d.enemies - d.enemy)}` : ''}` });
    const s = st.shots, span = s ? [{ from: s.from, to: s.at ?? s.to }] : [];
    // the counter code reads is the in-hand weapon's magazine (the HUD's largest digits), never a pair across slots
    if (s?.changes.length) push(`the ammo counter of the weapon in hand (its magazine, the HUD's largest digits) changed ${s.changes.length === 1 ? 'once' : `${s.changes.length} times`} from ${mmss(s.from, true)} to ${what} (each a shot, a burst, a reload, or a weapon swap), first at ${mmss(s.changes[0], true)}, ${round((s.at ?? s.to) - s.changes[0], 1)} s before it, last at ${mmss(s.changes.at(-1), true)}`, span);
    else if (s?.fired === false) push(`the ammo counter of the weapon in hand (its magazine) didn't change from ${mmss(s.from, true)} to ${what}: no shot, no reload, and no swap`, span);
    if (st.structures?.length) push(`the HUD's numbers over the structures read ${st.structures.map((x) => `${x.side === 'own' ? 'their' : "the other side's"} ${wrap(x.label)} ${x.value} of ${x.of}`).join(', ')}`, held(Math.max(...st.structures.map((x) => x.t))));
    return timed ? out : out.map((x) => x.text);
  }
  /**
   * Whether a clip read's factor names no condition, only that something happened: League's reads gave "Player is caught
   * out of position" as the mechanics and "Enemies present" as the numbers, where Flash's cooldown and two teammates dead
   * decided it (Oct 25). Said whole, these say nothing a coach could check on the screen.
   */
  const FILLER = /^(caught( out)?( of position)?|out of position|bad position(ing)?|poor position(ing)?|(was )?(in|engaged in) (a |the )?(fight|gunfight|combat|skirmish)|fighting|took damage|(was )?killed|died|(the )?enem(y|ies)( (was|were|are|is))? (present|nearby|around|close|there)|none|n\/?a)$/;
  const fillerFactor = (what) => FILLER.test(String(what || '').toLowerCase().replace(/^(the )?player('s| is| was)?\s+/, '').replace(/[.!]+$/, '').trim());
  /**
   * Deaths a clip read's screen text points to that the record doesn't have, for the second look: a line naming the
   * player defeated, eliminated, or killed, or one the player's own screen shows when they die ("KILLED BY FADE", "You
   * died"), at its time; or the screen following someone else ("Following: Mr.Zemo0"), at the lowest near-death in the
   * 30 s before it, since the death came first. Brawl Stars, Oct 25: "PANDA YT™ Defeated" at 2:58, and "Following" 20 s
   * after the 1:10 death, and neither became a death. One the record has already (within ONE_DEATH s, or one t falls
   * in) isn't asked about. texts: [{ t, text }] on the recording's clock; name: the player's. Returns death events.
   */
  // The player as the one who went down: "<you or their name> [was, were, has been...] defeated", with nothing after it
  // but who did it ("PANDA YT™ Defeated", "You were eliminated by X"), or the victim's own banner, opening with who did
  // it ("KILLED BY FADE"). The same words with the player as the killer ("YOU killed francomix", "PANDA YT eliminated
  // Mr.Zemo0"), someone else as the victim ("Mr.Zemo0 was eliminated by PANDA"), or "You were revived" aren't.
  const DOWN = /^(.*?)\s*\b(?:(?:was|were|got|has been|have been|is|are)\s+)?(defeated|eliminated|killed|knocked out|slain|died|dead)\b\s*(.*)$/i, BANNER = /^(killed|eliminated|defeated|slain|knocked out)\s+by\b/i, FOLLOWING = /\b(following|spectating)\b/i;
  const ownDeath = (said, name) => {
    if (BANNER.test(said)) return true;
    const m = DOWN.exec(said), who = nameKey(m?.[1]);
    return !!m && (/^(you|youre|youve|youhave)$/.test(who) || (nameKey(name).length >= 3 && who.includes(nameKey(name)))) && (!m[3] || /^(by\b|[!.]+$)/i.test(m[3]));
  };
  // A text marked loose comes from a window whose deaths nothing could check (no HP number to put a near-death before
  // it): the screen already following someone else there, the death is taken a second before, once in FOLLOW_GAP s
  const FOLLOW_GAP = 30;
  // A clip read's own words that the player died ("the player is eliminated by enemy fire", "Player goes down in the
  // enemy base"): Brawl Stars run 2's reads said both of its deaths so, and with no name learned, no screen text named
  // the player, so neither reached the record (loop 41). The player as the subject (by "the player", "you", or the
  // character they play), going down; not as the one who took someone down ("Player eliminates an enemy"), nor nearly.
  // The player themselves, not something of theirs: "The player's teammate is eliminated", "The player's shield is
  // down", and "Player's health is down to 20%" aren't their death (the reviewer's probes); "is down to" is a number
  const NARRATED_DOWN = /\b(?:(?:is|was|gets|got|has been|are|were)\s+(?:eliminated|killed|defeated|knocked out|slain|taken down|downed|knocked down)|dies|died|goes down|went down|is down(?!\s+to\b)|falls in battle)\b/i;
  const narratedDeath = (said, character = '') => {
    const first = String(said || '').split(/[;.]|,\s(?:and|but|then|while)\s/i)[0], who = nameKey(character);
    const subject = /^\s*(?:the\s+)?(?:player|you)\b(?!['’]s|s['’])/i.test(first) || (who.length >= 3 && nameKey(first.split(/\s+(?:is|was|gets|got|has|goes|went|dies|died|falls)\b/i)[0]) === who);
    return subject && NARRATED_DOWN.test(first) && !/\b(almost|nearly|barely|survives?|survived|avoids?|escapes?)\b/i.test(first);
  };
  // texts marked narrated are a read's own moments, not the screen's words: one counts where the player is its subject
  // going down (narratedDeath), and a screen's "Following" or name in it doesn't apply
  function deathCues(texts, { name = '', character = '', events = [], deadFor = 5, rounds = false, max = 10 } = {}) {
    const mine = (s) => nameKey(name).length >= 3 && nameKey(s).includes(nameKey(name)), out = [];
    for (const x of (texts || []).filter((y) => Number.isFinite(y?.t) && text(y?.text)).sort((a, b) => a.t - b.t)) {
      if (x.narrated) {
        const t = narratedDeath(text(x.text), character) ? x.t : null;
        if (t == null || (events || []).some((e) => e.kind === 'death' && Math.abs(e.t - t) <= ONE_DEATH) || deathAt(events, t, deadFor) || (rounds && roundDeath(events, t)) || out.some((d) => Math.abs(d.t - t) <= ONE_DEATH)) continue;
        out.push({ t: round(t, 2), kind: 'death', seenBy: 'screen', text: 'you died (a clip read saw you go down, and a second look shows it)' });
        continue;
      }
      const said = text(x.text), follows = FOLLOWING.test(said) && !mine(said);
      const anchor = follows ? (events || []).filter((e) => e.kind === 'near_death' && e.t < x.t && e.t >= x.t - 30).sort((a, b) => a.hp / a.of - b.hp / b.of)[0]?.t ?? null : null;
      const t = ownDeath(said, name) ? x.t : anchor ?? (follows && x.loose ? round(Math.max(0, x.t - 1), 2) : null);
      if (follows && anchor == null && x.loose && out.some((d) => t - d.t >= 0 && t - d.t <= FOLLOW_GAP)) continue;
      if (t == null || (events || []).some((e) => e.kind === 'death' && Math.abs(e.t - t) <= ONE_DEATH) || deathAt(events, t, deadFor) || (rounds && roundDeath(events, t)) || out.some((d) => Math.abs(d.t - t) <= ONE_DEATH)) continue;
      out.push({ t: round(t, 2), kind: 'death', seenBy: 'screen', text: 'you died (the screen wrote you defeated, or followed another player, and a second look shows it)' });
    }
    return out.slice(0, max);
  }

  // ---------- whether the view moved (first person) ----------
  // Valorant's 0:41 read said "Held a static angle" where he walked in and fired on the move (loop 40, V1). In first
  // person the view moves when the player walks or turns: the scene at the screen's sides changes from frame to frame,
  // and holds still when they hold an angle. Read in code off small frames, the HUD's middle and bottom left out.
  const VIEW_EDGES = { x: 0.15, y0: 0.2, y1: 0.7 };
  /** The gray pixels of a frame's side strips ({ data, width, height } RGBA), for viewMotion. */
  function viewEdges(img) {
    const { data: d, width: w, height: h } = img || {};
    if (!d || !w || !h) return null;
    const y0 = Math.floor(h * VIEW_EDGES.y0), y1 = Math.ceil(h * VIEW_EDGES.y1), xw = Math.max(1, Math.round(w * VIEW_EDGES.x)), out = [];
    for (let y = y0; y < y1; y++) for (const x0 of [0, w - xw]) for (let x = x0; x < x0 + xw; x++) { const k = (y * w + x) * 4; out.push((d[k] * 3 + d[k + 1] * 6 + d[k + 2]) / 10); }
    return Uint8Array.from(out);
  }
  /**
   * Whether the view moved over a stretch, from its frames' side strips in time order (viewEdges): the median change from
   * one frame to the next, over 0-255. Returns { state: 'moving' | 'still' | null, change }, null where it's between.
   */
  const VIEW_MOVING = 9, VIEW_STILL = 3.5;
  function viewMotion(strips) {
    const xs = (strips || []).filter((x) => x?.length), ch = [];
    for (let k = 1; k < xs.length; k++) { if (xs[k].length !== xs[k - 1].length) continue; let sum = 0; for (let i = 0; i < xs[k].length; i++) sum += Math.abs(xs[k][i] - xs[k - 1][i]); ch.push(sum / xs[k].length); }
    if (ch.length < 3) return { state: null, change: null };
    const m = round(median(ch), 1);
    return { state: m >= VIEW_MOVING ? 'moving' : m <= VIEW_STILL ? 'still' : null, change: m };
  }
  /** The view's motion as a code fact before a loss, or ''. */
  const viewFact = (motion, { from, to, what = 'the loss' } = {}) => (motion?.state ? `the view, read in code from ${mmss(from, true)} to ${mmss(to, true)} before ${what}, was ${motion.state === 'moving' ? 'moving (the scene at the screen\'s sides changed from frame to frame: walking or turning)' : 'still (the scene at the screen\'s sides held: holding an angle, not walking or turning)'}` : '');

  // ---------- what the player had, and who was left ----------
  // Fortnite's 7:43 fix said "Heal to full health and shield": they had no heals (loop 41, F4). A fix that rests on a
  // consumable (a heal, a potion, a med kit) has to have it shown at that loss, as the clip read saw the HUD.
  const CONSUMABLE = /\b(heal(?:s|ing|ed)?|bandages?|med\s?kits?|medpacks?|health\s?packs?|potions?|shield potions?|minis|splash(?:es)?|consumables?|stims?|syringes?|chug\w*)\b/i;
  const NOT_HELD = /\b(no|none|empty|without|out of|zero|0)\b[^,;.]{0,30}$|^[^,;.]{0,20}\b(none|empty|used up|out)\b/i;
  /**
   * The consumable a lesson's better relies on that nothing read at its loss shows the player had: its word, or ''.
   * seen: what was read there (the clip read's factors and moments, code's facts), as text.
   */
  function unheldResource(lesson, seen = []) {
    const m = CONSUMABLE.exec(String(lesson?.better || ''));
    if (!m) return '';
    // any consumable the reads saw them hold counts (a bandage for "heal"); one said as none, empty, or used doesn't
    const held = (seen || []).some((x) => [...String(x || '').matchAll(new RegExp(CONSUMABLE.source, 'gi'))].some((h) => { const before = String(x).slice(Math.max(0, h.index - 40), h.index), after = String(x).slice(h.index + h[0].length, h.index + h[0].length + 14); return !NOT_HELD.test(before) && !/^\W*(none|empty|used|gone)\b/i.test(after); }));
    return held ? '' : m[1].toLowerCase();
  }
  /** A better with the clauses that rest on that word taken out ("Heal to full health and shield, and take solid building cover" to "Take solid building cover"), or '' when nothing else is left. */
  function dropResourceClause(better) {
    // clauses with their separators kept, so what stays reads as it did ("before peeking or engaging" stays whole)
    const re = new RegExp(CONSUMABLE.source, 'i'), bits = String(better || '').replace(/\.$/, '').split(/(,\s*(?:and|or|then)\s+|;\s*|\s+(?:or|and)\s+(?=(?:attempt|try|use|heal|pop|drink|chug)\b))/i);
    const keep = [];
    for (let k = 0; k < bits.length; k += 2) if (bits[k].trim() && !re.test(bits[k])) keep.push(keep.length ? `${bits[k - 1] || ', '}${bits[k]}` : bits[k]);
    const out = keep.join('').trim();
    return out ? `${out[0].toUpperCase()}${out.slice(1)}.` : '';
  }
  // "the 1v1 fight" and "the final opponent" where four were left: the screen wrote YOU PLACED #4 as they died (F5)
  const SOLO = /\b(1\s*v\s*1|1-on-1|one[- ]on[- ]one|one v one|final opponent|last opponent|last enemy|final enemy|final two|last two|last player standing|final duel)\b/i;
  /**
   * How many players were left at t, as the screen wrote it: a placing written as they went out ("YOU PLACED #4", up to
   * 20 s after t: at least that many were in at t), or a count of players remaining before t ("35 PLAYERS REMAINING").
   * texts: [{ t, text }]. Returns { least, text, t } or null.
   */
  function playersLeft(texts, t) {
    let out = null;
    for (const x of (texts || []).filter((y) => Number.isFinite(y?.t))) {
      const placed = /\bplaced\s*#?\s*(\d{1,3})\b/i.exec(String(x.text || '')), left = /\b(\d{1,3})\s+(?:players?\s+)?(?:remaining|left|alive)\b/i.exec(String(x.text || ''));
      if (placed && x.t >= t - 1 && x.t <= t + 20 && (!out || +placed[1] > out.least)) out = { least: +placed[1], text: text(x.text), t: x.t };
      else if (left && x.t <= t && x.t >= t - 60 && !out) out = { least: Math.min(+left[1], 99), text: text(x.text), t: x.t, most: +left[1] };
    }
    return out;
  }
  /** Why a claim of a last duel goes against who was left (playersLeft), or ''. */
  function soloAgainst(claim, texts, t) {
    if (!SOLO.test(String(claim || ''))) return '';
    const left = playersLeft(texts, t);
    return left && left.least >= 3 && !left.most ? `the screen wrote "${left.text}" at ${mmss(left.t, true)}: ${left.least} players were left, the player one of them, so it was no last duel` : '';
  }

  // ---------- the match's result, off its end screen ----------
  // Clash Royale's final tower was recorded as "Enemy princess tower destroyed", a point won, in all four runs of loops
  // 40 and 41, and every review called the 0-1 loss a win: the low-detail pass took the player's own near-side tower for
  // the other side's. The result screen says it plainly: the crown banner by THE FRABET, -24 trophies by the player's
  // own name, "Crown Towers Defended: 2" (3:29.5, frame-checked). C3.
  const LOST_WORDS = /\b(defeat|defeated|you lose|you lost|loss|lost)\b/i, WON_WORDS = /\b(victory|you win|you won|winner|win|won)\b/i;
  /**
   * The result a look at the end screen gives, decided in code from what it copied, never its own verdict: the banner's
   * words (Victory, Defeat), the trophy change written by the player's own name (+30, -24), the name the winner's banner
   * sits by, and each side's crowns or score. look: { shown, banner_text, player_trophies, winner_name, player_score,
   * opponent_score }. Returns { outcome: 'won' | 'lost' | 'draw', score: { player, opponent } | null, why: [...] }, or
   * null where it shows none or its signs disagree.
   */
  function resultOf(look, { opponentName = '', playerName = '' } = {}) {
    if (!look || look.shown === false) return null;
    const votes = [], why = [], banner = text(look.banner_text);
    if (banner && !/defended|destroyed/i.test(banner)) { if (LOST_WORDS.test(banner)) { votes.push('lost'); why.push(`the banner reads ${banner}`); } else if (WON_WORDS.test(banner)) { votes.push('won'); why.push(`the banner reads ${banner}`); } }
    const num = (x) => (x == null || x === '' ? NaN : Number(x)), tr = num(look.player_trophies);
    if (Number.isFinite(tr) && tr !== 0) { votes.push(tr < 0 ? 'lost' : 'won'); why.push(`${tr > 0 ? '+' : ''}${tr} trophies by the player's own name`); }
    const winner = text(look.winner_name);
    if (winner && opponentName && sameName(winner, opponentName)) { votes.push('lost'); why.push(`the winner's banner by ${winner}, the opponent`); } else if (winner && playerName && sameName(winner, playerName)) { votes.push('won'); why.push(`the winner's banner by ${winner}, the player`); }
    const ps = num(look.player_score), os = num(look.opponent_score), score = Number.isFinite(ps) && Number.isFinite(os) && ps >= 0 && os >= 0 ? { player: ps, opponent: os } : null;
    if (score) { votes.push(ps > os ? 'won' : ps < os ? 'lost' : 'draw'); why.push(`${ps} to ${os} on the end screen`); }
    if (!votes.length || votes.some((v) => v !== votes[0])) return null;
    return { outcome: votes[0], score, why };
  }
  /**
   * The record made to fit the match's result: where the end screen says the player lost and the record has them scoring
   * more (a structure destroyed, a point) than that allows, its latest points won were the other side's, and are turned
   * over, the fight before each with them; a line that called the match the other way is said as the result. The same the
   * other way for a win. Each one turned keeps what was read before (was). result: resultOf's; t: when it showed.
   * Returns the events, with a 'result' event at t.
   */
  function settleResult(events, result, t) {
    if (!result) return events;
    const flip = result.outcome === 'lost' ? ['point_won', 'point_lost'] : result.outcome === 'won' ? ['point_lost', 'point_won'] : null;
    let out = (events || []).map((e) => ({ ...e }));
    if (flip) {
      const [from, to] = flip, mine = (k) => out.filter((e) => e.kind === k).length;
      const cap = result.score ? (result.outcome === 'lost' ? result.score.player : result.score.opponent) : null;
      const over = () => (cap != null ? mine(from) > cap : mine(from) >= mine(to) && mine(from) > 0);
      while (over()) {
        const e = out.filter((x) => x.kind === from).at(-1);
        const said = `${to === 'point_lost' ? 'a point the other side scored' : 'a point the player scored'} (the end screen: ${result.why.join('; ')})`;
        Object.assign(e, { kind: to, was: knownText(e) || e.guess || e.text, text: said, sure: said, guess: undefined });
        for (const f of out.filter((x) => x.kind === 'engagement' && x.to >= e.t - 20 && x.from <= e.t + 2 && x.outcome === (to === 'point_lost' ? 'won' : 'lost'))) Object.assign(f, { outcome: to === 'point_lost' ? 'lost' : 'won', text: `${to === 'point_lost' ? 'lost' : 'won'} (the end screen); the low-detail pass saw: ${f.guess || f.text}`, sure: to === 'point_lost' ? 'lost (the end screen)' : 'won (the end screen)' });
      }
    }
    const said = `the end screen: the player ${result.outcome === 'draw' ? 'drew' : result.outcome} the match${result.score ? `, ${result.score.player} to ${result.score.opponent}` : ''} (${result.why.join('; ')})`;
    out = out.map((e) => (e.kind === 'round_end' && ((result.outcome === 'lost' && WON_WORDS.test(e.text || '')) || (result.outcome === 'won' && LOST_WORDS.test(e.text || ''))) ? { ...e, was: e.text, text: said, sure: said, guess: undefined } : e));
    return [...out, { t: round(t, 2), kind: 'result', outcome: result.outcome, ...(result.score ? { score: result.score } : {}), text: said, sure: said }].sort((a, b) => a.t - b.t);
  }

  // ---------- losses a clip read saw that aren't deaths ----------
  // Clash Royale's princess tower 1979 to 761 and Fortnite's shield 98 to 24 were in the clip reads' own words, and no
  // loss of them reached the record: no structure was learned, and no box passed as a health bar (loop 41).
  const DROP_SHARE = 0.2; // of full (the "of N" the read gives, else the most it read of that thing in the clip)
  const STRUCT_WORDS = /\b(towers?|turrets?|bases?|inhibitors?|nexus|cores?|generators?|structures?|buildings?|safes?|forts?|castles?|barricades?)\b/i;
  const LIFE_WORDS = /\b(health|hp|shields?|armou?r|hit points)\b/i;
  // a clause about a timer, a score, or a resource that isn't health is no drop of theirs ("Time left 2:43 to 1:32",
  // "Elixir dropped from 10 to 2 while defending the tower", "Crowns 1 to 0"), nor one whose numbers are a clock's
  const NOT_LIFE = /\b(time|timer|clock|elixir|mana|energy|ammo|ammunition|magazine|charge|super|gold|credits|money|score|scores|crowns?|boost|stamina|rage|fuel|xp|level|kills?|points?|outnumbered)\b/i;
  // whose the thing is, from the words right before it (its own possessive, never another noun's: "The player's Hog
  // Rider damages the left princess tower" is the other side's tower): the player's, the other side's, or not said
  const OWN_MARK = /\b(the player's|player's|players'|your|my|our|own|ally|allied|friendly)\b/i, OTHER_MARK = /\b(enemy|enemy's|enemies'|opponent|opponent's|opponents'|opposing|rival|whose|his|her|its)\b/i;
  function ownerOf(clause, at) {
    const before = clause.slice(0, at), near = before.split(/\s+/).filter(Boolean).slice(-4).join(' ');
    if (/\b(on|at|of) the (enemy|opponent|other) side\b|\b(enemy|opponent)'s side\b|\bother side's\b/i.test(clause)) return 'other';
    if (OWN_MARK.test(near)) return 'own';
    if (OTHER_MARK.test(near)) return 'other';
    const named = /([\p{L}][\p{L}\p{N}._-]*)['’]s\s+(?:\S+\s+){0,2}$/u.exec(near);
    if (named && !/^(player|you)$/i.test(named[1])) return 'other';
    if (/\btheir\b/i.test(near) && !/\b(enemy|enemies|opponent)\b/i.test(before)) return 'own';
    return null;
  }
  // "from 1979 to 761", "1979 to 761", "98 -> 24", "98 → 24" (thousands written 1,979 are joined first)
  const DROP_RE = /(?:from\s+)?(\d{1,7})\s*(?:\/\s*\d+\s*)?(?:to|→|->|–>|=>)\s*(\d{1,7})(?:\s*(?:of|\/)\s*(\d{1,7}))?/gi;
  /**
   * Drops a clip read reports in its own words: a factor, a moment, or what its last choice cost saying the player's own
   * health, shield, or one of their structures went from one number to another, by DROP_SHARE of full or more, as loss
   * candidates the record didn't have. A drop with a death of theirs from 2 s before to 8 s after it is that death, and
   * one within 5 s of a near-death or damage the record has is that one. The other side's ("the enemy tower 2000 to 900")
   * isn't theirs; a structure with no side said is theirs only where the read's last choice says it cost them, or an enemy
   * did it. windows: [{ from, to, reading }]. Returns events: 'objective_damage' for a structure, 'damage' for health or
   * shield, each seenBy 'clip' with the words it came from (said), unchecked (dropChecked checks them).
   */
  function readDrops(windows, { events = [] } = {}) {
    const out = [];
    for (const w of windows || []) {
      const r = w?.reading;
      if (!r) continue;
      const lc = r.last_choice && typeof r.last_choice === 'object' ? r.last_choice : null;
      const said = [
        ...(Array.isArray(r.factors) ? r.factors : []).map((f) => ({ t: parseTime(f?.t), text: text(f?.what), kind: f?.kind })),
        ...(Array.isArray(r.moments) ? r.moments : []).map((m) => ({ t: parseTime(m?.t), text: text(m?.what), kind: 'moment' })),
        ...(lc && text(lc.cost) ? [{ t: parseTime(lc.t), text: text(lc.cost), kind: 'cost' }] : []),
      ].filter((x) => x.text).map((x) => ({ ...x, text: x.text.replace(/(\d),(\d{3})\b/g, '$1$2') }));
      const costs = said.filter((x) => x.kind === 'cost').map((x) => x.text).join(' ');
      // the most each thing read in the clip, for full where the read gives no "of N"
      const most = (re) => Math.max(0, ...said.filter((x) => re.test(x.text)).flatMap((x) => (x.text.match(/\b\d{2,7}\b/g) || []).map(Number)));
      const found = [];
      for (const x of said) {
        for (const clause of x.text.split(/;|\.(?:\s|$)|,\s(?=[a-z])/i)) {
          const struct = STRUCT_WORDS.exec(clause), life = LIFE_WORDS.exec(clause), noun = struct || life;
          if (!noun || NOT_LIFE.test(clause) || /\d:\d/.test(clause)) continue;
          for (const m of clause.matchAll(DROP_RE)) {
            const was = +m[1], now = +m[2], of = m[3] ? +m[3] : 0;
            // a two-digit number or more: "outnumbered 3 to 1" and "4 to 2 alive" are counts
            if (!(was > now) || was < 10 || now < 0 || (of && of < was)) continue;
            const kind = struct ? 'structure' : 'life', full = Math.max(was, of || 0, kind === 'structure' ? most(STRUCT_WORDS) : 0);
            if ((was - now) / full < DROP_SHARE - 1e-9) continue;
            // whose: by the thing's own possessive; with none said, a structure is theirs where it cost them or an enemy
            // did it, and health or a shield where the clause is about the player or the number itself ("Health dropped
            // from 1589 to 807"), never one about something they did to someone ("taking the Colt from 3000 to 500")
            const owner = ownerOf(clause, noun.index), cost = x.kind === 'cost' || (costs.includes(`${was}`) && costs.includes(`${now}`));
            if (owner === 'other') continue;
            if (!owner && kind === 'structure' && !cost && !/\b(enemy|enemies|opponent)\b/i.test(clause.slice(0, noun.index))) continue;
            if (!owner && kind === 'life' && !cost && !/^\s*(?:the\s+)?(?:player|you)\b(?!['’]s)|^\s*(?:their\s+)?(?:health|hp|shields?|armou?r)\b/i.test(clause)) continue;
            const unit = kind === 'life' ? (/shield/i.test(life[0]) ? 'shield' : /armou?r/i.test(life[0]) ? 'armor' : 'health') : null;
            const label = kind === 'structure' ? (clause.match(new RegExp(`((?:[a-z]+\\s+){0,2}${struct[0]})`, 'i'))?.[1] || struct[0]).toLowerCase().replace(/^(the|their|your|player's|players'|own|our|a|its)\s+/, '').replace(/[^a-z ]/g, '').trim().slice(0, 30) : null;
            found.push({ at: x.t, kind, was, now, of, unit, label, said: clause.trim().slice(0, 160), from: x.kind });
          }
        }
      }
      // one a thing a window: its biggest drop, timed where the read said it (a cost's time is the decision's: its
      // factor's or moment's time, where one gives the same numbers, else the decision's), and to the last moment of the
      // read that names that thing within 10 s
      for (const key of [...new Set(found.map((f) => `${f.kind}|${f.unit || f.label}`))]) {
        const same = found.filter((f) => `${f.kind}|${f.unit || f.label}` === key), best = same.reduce((a, b) => ((b.was - b.now) / Math.max(b.was, b.of || 0) > (a.was - a.now) / Math.max(a.was, a.of || 0) ? b : a));
        const timed = same.filter((f) => f.was === best.was && f.now === best.now && f.from !== 'cost' && Number.isFinite(f.at)).map((f) => f.at)[0] ?? best.at;
        const start = Number.isFinite(timed) ? timed : w.from, word = best.kind === 'structure' ? STRUCT_WORDS : LIFE_WORDS;
        const later = (Array.isArray(r.moments) ? r.moments : []).map((m) => ({ t: parseTime(m?.t), what: text(m?.what) })).filter((m) => Number.isFinite(m.t) && m.t >= start && m.t <= start + 10 && word.test(m.what)).map((m) => m.t);
        const t = round(Math.min(w.to ?? Infinity, Math.max(start, ...later)), 2);
        const deaths = (events || []).filter((e) => e.kind === 'death'), lows = (events || []).filter((e) => ['near_death', 'damage', 'objective_damage'].includes(e.kind));
        if (deaths.some((d) => d.t >= start - 2 && d.t <= t + 8) || lows.some((e) => Math.abs(e.t - t) <= 5 || Math.abs(e.t - start) <= 5) || out.some((o) => o.kind === (best.kind === 'structure' ? 'objective_damage' : 'damage') && Math.abs(o.t - t) <= 5)) continue;
        const e = best.kind === 'structure'
          ? { t, kind: 'objective_damage', structure: best.label || 'structure', side: 'own', was: best.was, now: best.now, start: round(start, 2), seenBy: 'clip', said: best.said }
          : { t, kind: 'damage', unit: best.unit, was: best.was, now: best.now, ...(best.of ? { of: best.of } : {}), start: round(start, 2), seenBy: 'clip', said: best.said };
        out.push(e);
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }
  /**
   * readDrops' drops checked where code read the thing itself, at no call: health against the HUD's health number
   * (counts.health), a structure against its number over it (counts.objectives, under objectives). One the number shows
   * falling by most of it is checked ("the HUD's health number agrees"); one the number read steady through, before and
   * after, is dropped; the rest stand as the read's, labelled so (seen by a clip read, not checked by code), their words
   * as a guess for every prompt. A shield has no number code reads, so it stays the read's.
   */
  function dropChecked(drops, counts = null, { structures = [] } = {}) {
    const out = [];
    for (const d of drops || []) {
      const lost = d.was - d.now, from = (d.start ?? d.t) - 6, to = d.t + 6;
      const series = d.kind === 'damage' ? (d.unit === 'health' ? [counts?.health || []] : []) : (structures || []).filter((x) => x.side === 'own').map((x) => counts?.objectives?.[x.id] || []);
      // by share of full, the HUD's against the read's: a read's "3 to 1" and a HUD wobbling 250 to 246 aren't one fall
      // (the reviewer's probe); it agrees where the HUD read near the read's own numbers, or fell the same share of full
      const readFull = Math.max(d.was, d.of || 0), readShare = lost / readFull;
      let verdict = null;
      for (const xs of series) {
        const before = xs.filter((x) => Number.isFinite(x?.value) && x.t >= from && x.t <= (d.start ?? d.t) + 1), after = xs.filter((x) => Number.isFinite(x?.value) && x.t >= (d.start ?? d.t) && x.t <= to);
        if (!before.length || !after.length) continue;
        const hi = Math.max(...before.map((x) => x.value)), lo = Math.min(...after.map((x) => x.value)), hudFull = Math.max(hi, ...(counts?.healthMax || []).filter((x) => d.kind === 'damage' && Number.isFinite(x?.value) && Math.abs(x.t - d.t) <= 30).map((x) => x.value));
        const hudShare = hudFull > 0 ? (hi - lo) / hudFull : 0, close = Math.abs(hi - d.was) <= 0.15 * readFull && Math.abs(lo - d.now) <= 0.15 * readFull;
        if (close || (hudShare >= 0.6 * readShare && Math.abs(hudShare - readShare) <= 0.15)) { verdict = 'checked'; break; }
        if (hudShare < 0.25 * readShare) verdict = verdict || 'steady';
      }
      if (verdict === 'steady') continue;
      const e = { ...d, ...(verdict === 'checked' ? { checked: d.kind === 'damage' ? "the HUD's health number agrees" : "the HUD's number over it agrees" } : {}) };
      const what = d.kind === 'damage' ? `their ${d.unit} fell from ${d.was} to ${d.now}${d.of ? ` of ${d.of}` : ''}` : `their ${d.structure}'s health fell from ${d.was} to ${d.now}`;
      e.text = `${what} (seen by a clip read${e.checked ? `, and ${e.checked}` : ', not checked by code'})`;
      if (!e.checked) e.guess = e.text;
      out.push(e);
    }
    return out;
  }

  // ---------- the health bar, read in code (hp_bar) ----------
  // Health is sampled, not watched: read every 2 s around fights, Marvel Rivals' dips at 4:18 (54 of 253) and 5:10 (30 of
  // 250) and League's 4:30 (280 of 1589) were caught by luck, and Fortnite's falls (97 to 72, 75 to 55 with the shield
  // untouched) had no event kind to hold them (loops 37 and 38). The bar's fill, read off its pixels every half second,
  // sees each one for no call; the HUD's number stays the check.
  const hsvOf = (r, g, b) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; }
    return [h, mx ? d / mx : 0, mx / 255];
  };
  const hueGap = (a, b) => { const x = Math.abs(a - b) % 360; return Math.min(x, 360 - x); };
  /**
   * The bar's own color, from crops of it at full health (ImageData-like { data, width, height }): the most common
   * bright color among their pixels, by 15° of hue for a colored bar (with the bins either side, so a hue on a bin's
   * edge isn't split) or by brightness for a white or gray one, when it covers BAR_COLOR of them or more; and the band
   * of lines across the crop the bar fills at full (half its length or more in that color), where barFill counts it,
   * so digits written over the bar (League's 631/1479) and the padding around it don't count against a column. Returns
   * { hue, s, v, gray, band: [from, to] as shares across }, or null.
   */
  const BAR_COLOR = 0.15;
  // not: a color already tried ({ hue, gray }), to find the next most common one (barRecord: a health bar beside a shield
  // bar, Fortnite's green under its blue, either can come first)
  function barColor(imgs, { not = null } = {}) {
    const bins = new Map();
    let all = 0;
    for (const im of imgs || []) {
      const d = im?.data;
      if (!d) continue;
      for (let p = 0; p < im.width * im.height; p++) {
        all++;
        const [h, s, v] = hsvOf(d[4 * p], d[4 * p + 1], d[4 * p + 2]);
        if (v < 0.35) continue;
        if (not && (not.gray ? s < 0.25 : s >= 0.25 && hueGap(h, not.hue) <= 30)) continue;
        const key = s >= 0.25 ? Math.floor(h / 15) : `g${v < 0.6 ? 0 : v < 0.8 ? 1 : 2}`, b = bins.get(key) || { n: 0, x: 0, y: 0, s: 0, v: 0 };
        b.n++; b.x += Math.cos((h * Math.PI) / 180); b.y += Math.sin((h * Math.PI) / 180); b.s += s; b.v += v;
        bins.set(key, b);
      }
    }
    const score = ([k, b]) => b.n + (typeof k === 'number' ? (bins.get((k + 23) % 24)?.n || 0) + (bins.get((k + 1) % 24)?.n || 0) : 0);
    const top = [...bins].sort((a, b) => score(b) - score(a))[0];
    if (!top || score(top) < BAR_COLOR * all) return null;
    const [k] = top, parts = typeof k === 'number' ? [k, (k + 23) % 24, (k + 1) % 24].map((j) => bins.get(j)).filter(Boolean) : [top[1]];
    const n = parts.reduce((m, b) => m + b.n, 0), sum = (f) => parts.reduce((m, b) => m + b[f], 0);
    const color = { hue: round(((Math.atan2(sum('y'), sum('x')) * 180) / Math.PI + 360) % 360, 1), s: round(sum('s') / n, 3), v: round(sum('v') / n, 3), gray: typeof k !== 'number' };
    // the band: the lines across (rows of a lying bar, columns of a standing one) half of whose length is the color
    const lines = [];
    for (const im of (imgs || []).filter((x) => x?.data)) {
      const up = im.height > im.width, along = up ? im.height : im.width, across = up ? im.width : im.height;
      for (let c = 0; c < across; c++) {
        let on = 0;
        for (let a = 0; a < along; a++) { const q = ((up ? a : c) * im.width + (up ? c : a)) * 4; if (barPixel(color, im.data[q], im.data[q + 1], im.data[q + 2])) on++; }
        (lines[c] ||= []).push({ share: on / along, across });
      }
    }
    const solid = lines.map((xs, c) => (xs && median(xs.map((x) => x.share)) >= 0.5 ? c : -1)).filter((c) => c >= 0), across = lines.length;
    return { ...color, band: solid.length ? [round(Math.min(...solid) / across, 3), round((Math.max(...solid) + 1) / across, 3)] : [0, 1] };
  }
  // A colored bar's pixel is near its brightness too: the drained part of a see-through bar shows the scenery behind it
  // darkened, and over Fortnite's grass, the bar's own green, it read as full until the scene went dark, a fall of a
  // quarter with no damage (loop 41's crops: the bar at v 0.75-0.80, its empty part over grass at 0.24-0.44)
  const barPixel = (c, r, g, b) => { const [h, s, v] = hsvOf(r, g, b); return c.gray ? s < 0.25 && Math.abs(v - c.v) <= 0.2 : s >= Math.max(0.2, c.s * 0.5) && v >= Math.max(0.25, c.v * 0.7) && hueGap(h, c.hue) <= 25; };
  /**
   * The share of a health bar filled with its color (barColor), in box [x, y, w, h] of the image (the whole image when
   * null): of the columns along it (rows, for a bar standing up), the ones a quarter or more of whose pixels inside the
   * bar's band (color.band) are its color. Counted, not measured from one end, so the end it drains from doesn't matter.
   */
  function barFill(img, box, color) {
    if (!img?.data || !color) return 0;
    const { data: d, width: W } = img, [x0, y0, w, h] = (box || [0, 0, img.width, img.height]).map((v) => Math.round(v));
    const up = h > w, along = up ? h : w, across = up ? w : h, [b0, b1] = color.band || [0, 1];
    const c0 = Math.min(across - 1, Math.floor(b0 * across)), c1 = Math.max(c0 + 1, Math.ceil(b1 * across));
    // span (barRecord, hp_bar): only along the bar itself, as it lay at full, so the scenery either side of a bar set
    // inside its box (Fortnite's grass, the bar's own green) isn't counted
    const [s0, s1] = color.span || [0, 1], a0 = Math.max(0, Math.round(s0 * along)), a1 = Math.min(along, Math.max(a0 + 1, Math.round(s1 * along)));
    let filled = 0;
    for (let a = a0; a < a1; a++) {
      let on = 0;
      for (let c = c0; c < c1; c++) { const k = ((y0 + (up ? a : c)) * W + x0 + (up ? c : a)) * 4; if (barPixel(color, d[k], d[k + 1], d[k + 2])) on++; }
      if (on >= (c1 - c0) / 4) filled++;
    }
    return a1 > a0 ? filled / (a1 - a0) : 0;
  }
  /**
   * Whether a crop at full health is a bar: long (BAR_LONG times as long as it is thick, in pixels) and filled with its
   * color in one run from one end, most of its length, with little of the color elsewhere. A box around the number alone
   * isn't one: on a tight "100" the white digits took the color, and 100 to 99 HP read as 100% to 67% (the Oct 25 review).
   */
  const BAR_LONG = 3;
  // The longest run of the bar's color along a crop (columns a quarter or more of whose band pixels are the color): its
  // start and length, how many columns of the color lie outside it, and how solid it is (the median share of its band in
  // the color), each in columns of along.
  function barRun(img, color) {
    const up = img.height > img.width, along = up ? img.height : img.width, across = up ? img.width : img.height;
    const [b0, b1] = color.band || [0, 1], c0 = Math.min(across - 1, Math.floor(b0 * across)), c1 = Math.max(c0 + 1, Math.ceil(b1 * across)), on = [], share = [];
    for (let a = 0; a < along; a++) {
      let n = 0;
      for (let c = c0; c < c1; c++) { const k = ((up ? along - 1 - a : c) * img.width + (up ? c : a)) * 4; if (barPixel(color, img.data[k], img.data[k + 1], img.data[k + 2])) n++; }
      on.push(n >= (c1 - c0) / 4); share.push(n / (c1 - c0));
    }
    let best = { from: 0, len: 0 };
    for (let a = 0, from = 0; a <= along; a++) { if (a < along && on[a]) continue; if (a - from > best.len) best = { from, len: a - from }; from = a + 1; }
    return { ...best, along, across, band: c1 - c0, outside: on.filter(Boolean).length - best.len, solid: best.len ? median(share.slice(best.from, best.from + best.len)) : 0, up };
  }
  /**
   * Whether a crop at full health is a bar: long (BAR_LONG times as long as it is thick, in pixels) and filled with its
   * color in one run, most of its length, with little of the color elsewhere: from one end of the box, or set inside it,
   * an icon on one side and its number on the other (Fortnite's health bar, from a fifth of the box to four fifths, was
   * turned away for not starting within 15% of an end, loop 41): then the run is solid, half the box or more and BAR_LONG
   * times its band's thickness, with other colors on both sides of it. A box around the number alone isn't one: on a tight
   * "100" the white digits took the color, and 100 to 99 HP read as 100% to 67% (the Oct 25 review); its strokes are no
   * long solid run.
   */
  function barLike(img, color) {
    if (!img?.data || !color) return false;
    const r = barRun(img, color), { along, across } = r;
    if (along < BAR_LONG * across) return false;
    const end = Math.min(r.from, along - (r.from + r.len));
    const fromEnd = r.len >= 0.6 * along && end <= 0.15 * along && r.outside <= 0.1 * along;
    const inset = r.len >= 0.5 * along && r.len >= BAR_LONG * r.band && r.from > 0 && r.from + r.len < along && r.outside <= 0.1 * along && r.solid >= 0.6;
    return fromEnd || inset;
  }
  /** Where the bar lies along its box at full health ([from, to] as shares), the median of its runs in crops that are a bar (barLike), or null. */
  function barSpan(imgs, color) {
    const runs = (imgs || []).filter((im) => barLike(im, color)).map((im) => barRun(im, color));
    if (!runs.length) return null;
    // a run drawn the other way up (a standing bar fills from its bottom) is measured from the bottom, as barFill counts
    return [round(median(runs.map((x) => (x.up ? x.along - x.from - x.len : x.from) / x.along)), 3), round(median(runs.map((x) => (x.up ? x.along - x.from : x.from + x.len) / x.along)), 3)];
  }
  /**
   * A second bar in the health box (a shield bar beside the health bar: Fortnite's blue over its green), read like the
   * first: its color the next most common at the health bar's full moments (barColor's not), its full fill where it fills
   * most through the match (its own top tenth, as it needn't be full where health is), a bar there (barLike), in rows of
   * its own, measured along itself. Fortnite's 7:30 shield, 98 to 24 in three hits, had no series to fall in (loop 41,
   * F3). frames: [{ t, img }]; calib: the health bar's full crops; first: its color. Returns { color, ref, series } or null.
   */
  function secondBar(frames, calib, first) {
    const c0 = first && barColor(calib, { not: first });
    if (!c0 || !(frames || []).length) return null;
    const [a0, a1] = first.band || [0, 1], [b0, b1] = c0.band || [0, 1];
    if (b0 < a1 && a0 < b1) return null; // the same rows as the health bar: no second bar
    // of the crops where it is a bar (scenery of its color round it is no bar), the fullest tenth
    const bars = frames.filter((f) => barLike(f.img, c0)).map((f) => ({ img: f.img, fill: barFill(f.img, null, c0) })).sort((x, y) => y.fill - x.fill);
    const top = bars.slice(0, Math.max(2, Math.min(12, Math.ceil(bars.length * 0.1)))).filter((x) => x.fill > 0.2).map((x) => x.img);
    if (bars.length < 4 || top.length < 2) return null;
    const span = barSpan(top, c0), color = span ? { ...c0, span } : c0, ref = median(top.map((im) => barFill(im, null, color)));
    if (!(ref > 0.2)) return null;
    return { color, ref, series: frames.map((f) => ({ t: f.t, share: Math.min(1, barFill(f.img, null, color) / ref) })) };
  }
  /**
   * How often the bar's series and the HUD's number disagree, where both were read within half a second of each other:
   * { pairs, off }, off the pairs whose shares differ by more than 0.15. readings: the number's [{ t, value }], counts for
   * full health (barReadings' rule); skip(t): moments not to compare (the player dead, the screen a teammate's).
   */
  // low and lowOff: the pairs where the number read under 80% of full, and how many of those the bar was off at: a box
  // on the scenery (Brawl Stars' box over the sand beside the player's name, loop 41's crops) reads full all match, and
  // the number is full most of the time, so only where it fell does the bar show it isn't one
  function barAgrees(series, counts, skip = () => false) {
    const full = barReadings([{ t: 0, share: 1 }], counts)[0]?.full ? (t) => barReadings([{ t, share: 1 }], counts)[0].full : null, out = { pairs: 0, off: 0, low: 0, lowOff: 0 };
    if (!full || !series?.length) return out;
    for (const x of (counts?.health || []).filter((y) => Number.isFinite(y?.value) && !skip(y.t))) {
      const b = series.reduce((m, y) => (Math.abs(y.t - x.t) < Math.abs(m.t - x.t) ? y : m), series[0]);
      if (Math.abs(b.t - x.t) > 0.5) continue;
      const want = Math.min(1, x.value / full(x.t)), off = Math.abs(b.share - want) > 0.15;
      out.pairs++;
      if (off) out.off++;
      if (want < 0.8) { out.low++; if (off) out.lowOff++; }
    }
    return out;
  }
  /**
   * Damage the bar shows (barDamage), checked against the HUD's number read first at or after the bar's lowest point,
   * within 6 s (one before it can be from before the fall): one the number puts well above where the bar fell (by more
   * than 0.15 of full) goes, and so does a fall to under 5% the number doesn't show at all, a screen that hid the HUD
   * (100% to 0%).
   */
  function damageChecked(hurt, counts) {
    const reads = (counts?.health || []).filter((x) => Number.isFinite(x?.value)), full = (t) => barReadings([{ t, share: 1 }], counts)[0]?.full;
    return (hurt || []).filter((d) => {
      const near = reads.filter((x) => x.t >= d.t && x.t <= d.t + 6).sort((a, b) => a.t - b.t)[0], f = near && full(near.t);
      if (!near || !f) return d.now >= 5;
      return near.value / f <= d.now / 100 + 0.15;
    });
  }
  /**
   * When the HUD's number read full health, to calibrate the bar on (barColor, and the fill that is full): readings at
   * 98% of the full health nearest them or more, the player not dead, up to max, spread through the match. counts:
   * readCounters' (mergeCounts).
   */
  function barFullTimes(counts, events = [], deadFor = 5, max = 8) {
    const tops = (counts?.healthMax || []).filter((x) => Number.isFinite(x?.value) && x.value > 0), hp = (counts?.health || []).filter((x) => Number.isFinite(x?.value) && x.value > 0);
    const usual = modeOf(tops.map((x) => x.value)) ?? modeOf(hp.map((x) => x.value));
    const fullAt = (t) => tops.filter((x) => Math.abs(x.t - t) <= MAX_NEAR).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0]?.value ?? usual;
    const full = hp.filter((x) => usual && x.value >= 0.98 * fullAt(x.t) && !deathAt(events, x.t, deadFor)).map((x) => x.t);
    return full.length <= max ? full : Array.from({ length: max }, (_, k) => full[Math.round((k * (full.length - 1)) / (max - 1))]);
  }
  /**
   * The bar's series as health readings in the number's own units ([{ t, value, full }]), for nearDeaths and the second
   * look, which reads the number: share times the full health the HUD wrote nearest then.
   */
  function barReadings(series, counts) {
    const tops = (counts?.healthMax || []).filter((x) => Number.isFinite(x?.value) && x.value > 0), usual = modeOf(tops.map((x) => x.value)) ?? modeOf((counts?.health || []).map((x) => x.value).filter((v) => Number.isFinite(v) && v > 0));
    if (!usual) return [];
    const fullAt = (t) => (tops.length ? tops.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a)).value : usual);
    return (series || []).filter((x) => Number.isFinite(x?.share)).map((x) => { const full = fullAt(x.t); return { t: x.t, value: Math.round(x.share * full), full }; });
  }
  /**
   * Damage taken off the bar's series ([{ t, share }]): the bar falling BAR_DROP of full or more within BAR_WINDOW s,
   * and staying down for BAR_HOLD s (a frame the bar flickered on isn't damage), while the player plays (not dead,
   * deathAt). A fall that goes on is one, from the highest reading before it to its lowest. One that ends in their death
   * (within 8 s) is that death, and one at a near-death of theirs (within 5 s) is that near-death. Fortnite's falls: 97
   * to 72 and 75 to 55 (loop 37). Returns damage events ({ t, kind: 'damage', was, now: % of full, start }).
   */
  // quiet(t): no fight near t (no shot fired, no hit, no kill or death of theirs): a fall off a ledge, where a smaller
  // share is still damage, QUIET_DROP of full: Fortnite's 6:59 drop, 55 to 45, was under the 20% line (loop 41, F2)
  const BAR_DROP = 0.2, QUIET_DROP = 0.08, BAR_WINDOW = 3, BAR_HOLD = 1;
  function barDamage(series, { events = [], deadFor = 5, quiet = null, unit = 'health' } = {}) {
    const xs = (series || []).filter((x) => Number.isFinite(x?.share) && Number.isFinite(x?.t) && !deathAt(events, x.t, deadFor)).sort((a, b) => a.t - b.t), found = [];
    const holds = (j) => xs.filter((y) => y.t > xs[j].t && y.t <= xs[j].t + BAR_HOLD).every((y) => y.share <= xs[j].share + 0.1) && xs.some((y) => y.t > xs[j].t);
    let cur = null;
    for (let j = 0; j < xs.length; j++) {
      // the level it fell from, held: a one-frame spike (scenery of the bar's color behind it for an instant) is no level
      const spike = (y) => y.share - median(xs.filter((z) => Math.abs(z.t - y.t) <= 1.5).map((z) => z.share)) > 0.1;
      const peak = xs.filter((y) => y.t >= xs[j].t - BAR_WINDOW && y.t < xs[j].t && !spike(y)).reduce((a, b) => (!a || b.share > a.share ? b : a), null);
      // a quiet drop under the 20% line counts only where it stays down 3 s, as a fall's does: a bar's wobble climbs back
      const quietHere = quiet && quiet(xs[j].t), big = peak && peak.share - xs[j].share >= BAR_DROP - 1e-9;
      const stays = (k) => { const next = xs.filter((y) => y.t > xs[k].t && y.t <= xs[k].t + 3); return next.every((y) => y.share <= xs[k].share + 0.05) && next.some((y) => y.t >= xs[k].t + 2.5); };
      if (peak && (big || (quietHere && peak.share - xs[j].share >= QUIET_DROP - 1e-9 && stays(j))) && holds(j)) {
        if (cur && peak.t <= cur.t + BAR_HOLD) { if (xs[j].share < cur.now) Object.assign(cur, { t: xs[j].t, now: xs[j].share }); } else { if (cur) found.push(cur); cur = { start: peak.t, was: peak.share, t: xs[j].t, now: xs[j].share }; }
      } else if (cur && xs[j].t - cur.t > BAR_HOLD) { found.push(cur); cur = null; }
    }
    if (cur) found.push(cur);
    // a fall that ran on past its window is one, from its first level to its lowest (Fortnite's shield, 98 to 24 in three
    // hits over 3.2 s)
    for (let k = found.length - 1; k > 0; k--) if (found[k].start <= found[k - 1].t + BAR_HOLD) { found[k - 1].t = found[k].t; found[k - 1].now = Math.min(found[k - 1].now, found[k].now); found.splice(k, 1); }
    const deaths = (events || []).filter((e) => e.kind === 'death'), lows = (events || []).filter((e) => e.kind === 'near_death');
    return found.filter((x) => !deaths.some((d) => d.t >= x.start - 2 && d.t <= x.t + 8) && !lows.some((n) => Math.abs(n.t - x.t) <= 5)).map((x) => {
      const was = Math.round(x.was * 100), now = Math.round(x.now * 100);
      return { t: round(x.t, 2), kind: 'damage', was, now, start: round(x.start, 2), seenBy: 'hud', ...(unit !== 'health' ? { unit } : {}), ...(quiet && quiet(x.t) && x.was - x.now < BAR_DROP ? { quiet: true } : {}), text: `your ${unit} bar fell from ${was}% to ${now}% of full (read off the bar${unit !== 'health' ? ', no number to check it by' : ''})` };
    });
  }

  // ---------- the ability row, read in code (ability_state) ----------
  // Whether the player's abilities and ult were ready decided many losses, and the reads got it wrong: all four Marvel
  // Rivals losses were stayed in with an ability ready, and the reviews said "on cooldown"; Valorant's ult was ready and
  // unused at 4:15, 4:57, and 6:15; League's Flash was down at 1:48 and spent at 8:56 (loop 40). An icon on cooldown is
  // drawn darker or grayer than when it's ready, so each icon is read against its own brightest over the match, in code.
  // A crop as its three color planes, a byte a pixel (an ImageData's RGBA kept small: 300 crops of a 240 px row)
  function iconPixels(img) {
    const w = img?.width | 0, h = img?.height | 0, d = img?.data;
    if (!d || !w || !h || d.length < w * h * 4) return null;
    const r = new Uint8Array(w * h), g = new Uint8Array(w * h), b = new Uint8Array(w * h);
    for (let p = 0, q = 0; p < w * h; p++, q += 4) { r[p] = d[q]; g[p] = d[q + 1]; b[p] = d[q + 2]; }
    return { w, h, r, g, b };
  }
  // brightness (the brightest channel) and chroma (brightest minus darkest) of a crop's pixel p
  const pxV = (f, p) => Math.max(f.r[p], f.g[p], f.b[p]), pxC = (f, p) => pxV(f, p) - Math.min(f.r[p], f.g[p], f.b[p]);
  // each pixel's value at fraction q of its values over the frames, by a histogram (planes: [Uint8Array])
  function planeQuantile(planes, q) {
    const n = planes.length, size = planes[0].length, out = new Uint8Array(size), hist = new Uint16Array(256), k = Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))));
    for (let p = 0; p < size; p++) {
      hist.fill(0);
      for (let f = 0; f < n; f++) hist[planes[f][p]]++;
      let seen = 0, x = 0;
      for (; x < 256; x++) { seen += hist[x]; if (seen > k) break; }
      out[p] = x;
    }
    return out;
  }
  const otsu = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    let best = s[0], score = -1;
    for (let i = 1; i < s.length; i++) {
      const lo = s.slice(0, i), hi = s.slice(i), m0 = lo.reduce((a, b) => a + b, 0) / lo.length, m1 = hi.reduce((a, b) => a + b, 0) / hi.length, v = lo.length * hi.length * (m1 - m0) ** 2;
      if (v > score) { score = v; best = (s[i - 1] + s[i]) / 2; }
    }
    return best;
  };
  const ICON = { hi: 0.95, lo: 0.05, held: 0.25, band: 0.6, minFrames: 8, minIcons: 2, maxIcons: 10, minWidth: 0.04, contrast: 0.6, still: 6, ref: 0.15, salientV: 60, salientC: 40, differ: 40, lit: 0.25, dim: 0.45, darker: 0.92, minPixels: 6 };
  // how vivid an icon looks in a crop: its pixels' brightness and chroma, and its texture (top to bottom), which a flat
  // cooldown cover takes away (League's blue one lights a dark icon's background while it hides the art)
  const vividOf = (f, area, w) => { let s = 0, t = 0; for (const p of area) { s += pxV(f, p) + pxC(f, p); if (p >= w) t += Math.abs(pxV(f, p) - pxV(f, p - w)); } return area.length ? (s + 4 * t) / area.length : 0; };
  /**
   * The ability row split into its icons, from crops of the learned box through the match (iconPixels, all one size).
   * Each pixel's brightest and darkest over the match (95th and 5th percentiles, so a flash or a death screen doesn't set
   * them), and how much it moves from one crop to the next (the median change: an icon holds still between its changes
   * of state, the game behind a see-through HUD doesn't), are taken on the rows that change most (the icons', not the
   * key letters, pips, or costs around them), and give each column how bright it gets, how much it changes, and how much
   * texture its brightest picture has, each against the row's most, times the share of its pixels that hold still. The
   * gaps between icons are low; an icon that's dark all match keeps its texture, so a gap (or an end of the row) as wide
   * as an icon, with an icon's texture across it, is an icon too (dark: nothing is said about it, and the icons keep
   * their numbers). The split is unsure, and nothing is said, when the columns don't fall into two clear groups, or the
   * icons come out fewer than 2, more than 10, or one more than twice as wide as the rest.
   * Each icon's own brightest look is its look in its most vivid crops (ICON.ref of them: brightness, chroma, and
   * texture), pixel by pixel, which is how it looks ready; its pixels bright or colorful there are the ones read. An icon
   * whose brightest is far under the others' never lit this match, and is dark too.
   * Returns { w, h, icons: [{ x0, x1, dark, px, ref: [r, g, b], area, vivid }] } or { why }.
   */
  function abilityIcons(frames) {
    const list = (frames || []).filter((f) => f?.r && f.w === frames[0]?.w && f.h === frames[0]?.h);
    if (list.length < ICON.minFrames) return { why: `${list.length} crops of the ability row, too few` };
    const { w, h } = list[0], size = w * h;
    const vs = list.map((f) => { const v = new Uint8Array(size); for (let p = 0; p < size; p++) v[p] = pxV(f, p); return v; });
    const cs = list.map((f) => { const c = new Uint8Array(size); for (let p = 0; p < size; p++) c[p] = pxC(f, p); return c; });
    const hi = planeQuantile(vs, ICON.hi), lo = planeQuantile(vs, ICON.lo), chi = planeQuantile(cs, ICON.hi), clo = planeQuantile(cs, ICON.lo);
    const moves = planeQuantile(vs.slice(1).map((v, f) => v.map((x, p) => Math.abs(x - vs[f][p]))), ICON.held), still = (p) => moves[p] <= ICON.still;
    // the icons' rows: those whose still pixels change most over the match, not the key letters, pips, or costs above and
    // below them, which run across the gaps too (League's row: the icons are its middle half), nor the game behind
    const rowChange = Array.from({ length: h }, (_, y) => { let s = 0; for (let x = 0; x < w; x++) { const p = y * w + x; if (still(p)) s += Math.max(hi[p] - lo[p], chi[p] - clo[p]); } return s / w; });
    const band = rowChange.map((c, y) => (c >= ICON.band * Math.max(...rowChange) ? y : -1)).filter((y) => y >= 0);
    const col = (fn) => Array.from({ length: w }, (_, x) => { let s = 0; for (const y of band) s += fn(y * w + x, y); return s / band.length; });
    // texture against brightness, so an icon dark all match has as much as a lit one, and a flat gap none
    const rel = (p) => Math.abs(hi[p] - hi[p - w]) / (Math.max(hi[p], hi[p - w]) + 8);
    const bright = col((p) => hi[p]), change = col((p) => Math.max(hi[p] - lo[p], chi[p] - clo[p])), texture = col((p, y) => (y ? rel(p) : 0)), steady = col((p) => (still(p) ? 1 : 0));
    const norm = (xs) => { const m = Math.max(...xs); return xs.map((x) => (m > 0 ? x / m : 0)); };
    const [b, d, g] = [norm(bright), norm(change), norm(texture)], score = b.map((x, i) => (x + d[i] + g[i]) * steady[i]);
    const th = otsu(score), on = score.map((s) => s > th), mean = (xs) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : 0);
    const iconMean = mean(score.filter((_, i) => on[i])), gapMean = mean(score.filter((_, i) => !on[i]));
    if (!(iconMean > 0) || gapMean > ICON.contrast * iconMean) return { why: "the ability row's columns don't split into icons and gaps" };
    let runs = [];
    for (let x = 0; x < w; x++) if (on[x]) { if (runs.length && runs.at(-1).x1 === x) runs.at(-1).x1 = x + 1; else runs.push({ x0: x, x1: x + 1 }); }
    const widthOf = (r) => r.x1 - r.x0, med = () => median(runs.filter((r) => widthOf(r) >= 3).map(widthOf)) || 0;
    // a dip of a column or so inside an icon's art isn't a gap: joined when the two together are no wider than an icon
    let m = med();
    runs = runs.reduce((out, r) => { const last = out.at(-1); if (last && r.x0 - last.x1 <= Math.max(1, Math.round(0.1 * m)) && r.x1 - last.x0 <= 1.6 * m) last.x1 = r.x1; else out.push({ ...r }); return out; }, []);
    m = med();
    runs = runs.filter((r) => widthOf(r) >= Math.max(2, 0.35 * m));
    if (!runs.length) return { why: 'no icons in the ability row' };
    // an icon dark all match: room for one, between two icons or at an end of the row, with an icon's texture (still)
    const tex = col((p, y) => (y && still(p) ? rel(p) : 0)), texOn = mean(tex.filter((_, i) => on[i]));
    // its middle, an icon wide, as textured as the icons are (a gap between icons is flat)
    const iconIn = (x0, x1) => { if (x1 - x0 < 0.8 * m) return false; const mid = (x0 + x1) / 2; return mean(tex.slice(Math.max(0, Math.round(mid - m / 2)), Math.min(w, Math.round(mid + m / 2)))) >= 0.4 * texOn; };
    const pitch = runs.length > 1 ? median(runs.slice(1).map((r, i) => r.x0 - runs[i].x0)) : m * 1.2;
    const found = [];
    if (iconIn(0, runs[0].x0) && runs[0].x0 >= pitch - m * 0.2) found.push({ x0: Math.round(runs[0].x0 - pitch), x1: Math.round(runs[0].x0 - pitch + m), dark: true });
    runs.forEach((r, i) => {
      const prev = runs[i - 1];
      if (prev && iconIn(prev.x1, r.x0)) { const mid = (prev.x1 + r.x0) / 2; found.push({ x0: Math.round(mid - m / 2), x1: Math.round(mid + m / 2), dark: true }); }
      found.push({ ...r, dark: false });
    });
    const last = runs.at(-1);
    if (iconIn(last.x1, w) && w - last.x0 >= pitch + m * 0.8) found.push({ x0: Math.round(last.x0 + pitch), x1: Math.round(last.x0 + pitch + m), dark: true });
    // and icons a few pixels wide are pieces of something else (Marvel Rivals' row, with the game showing through it)
    const wide = found.some((r) => widthOf(r) > 2.2 * m), thin = m < ICON.minWidth * w;
    if (found.length < ICON.minIcons || found.length > ICON.maxIcons || wide || thin) return { why: `the ability row split into ${found.length} icons${wide ? ', one far wider than the rest' : thin ? ', each a few pixels wide' : ''}, which isn't sure` };
    // each icon's ready look: pixel by pixel, the median of its most vivid crops; its bright or colorful pixels there
    const icons = found.map((r) => {
      const area = [];
      for (const y of band) for (let x = Math.max(0, r.x0); x < Math.min(w, r.x1); x++) if (still(y * w + x)) area.push(y * w + x);
      if (r.dark || area.length < ICON.minPixels) return { x0: r.x0, x1: r.x1, dark: true };
      const vivid = list.map((f, i) => ({ i, v: vividOf(f, area, w) })).sort((a, c) => c.v - a.v), top = vivid.slice(0, Math.max(3, Math.round(ICON.ref * list.length)));
      const pick = (plane, p) => median(top.map(({ i }) => list[i][plane][p]));
      const px = [], ref = [[], [], []];
      for (const p of area) { const rgb = ['r', 'g', 'b'].map((k) => pick(k, p)), v = Math.max(...rgb); if (v >= ICON.salientV || v - Math.min(...rgb) >= ICON.salientC) { px.push(p); rgb.forEach((x, k) => ref[k].push(x)); } }
      return { x0: r.x0, x1: r.x1, dark: px.length < ICON.minPixels, px, ref, area, vivid: median(top.map((x) => x.v)) };
    });
    // an icon whose brightest is far under the others' never lit up this match: dark too
    const top = median(icons.filter((ic) => !ic.dark).map((ic) => ic.vivid)) || 0;
    icons.forEach((ic) => { if (!ic.dark && ic.vivid < 0.5 * top) ic.dark = true; });
    return { w, h, icons };
  }
  /**
   * Each icon's state in one crop (iconPixels) against the track (abilityIcons): the share of its read pixels that look
   * unlike its ready look (a channel off by ICON.differ, or 30% of the pixel's brightness). Under ICON.lit it's lit
   * (ready); from ICON.dim, and less vivid than ready, it's dimmed (on cooldown, or unusable for now); between, or
   * changed but no dimmer, and for a dark icon, nothing is said (state null). League's cooldown covers the icon and
   * uncovers it in a sweep, so the share is about how much of the cooldown is left. Returns [{ icon, of, state, share }].
   */
  function abilityState(track, img) {
    if (!track?.icons || !img?.r || img.w !== track.w || img.h !== track.h) return [];
    return track.icons.map((ic, i) => {
      if (ic.dark) return { icon: i + 1, of: track.icons.length, state: null, share: null };
      let off = 0;
      ic.px.forEach((p, k) => { const rr = ic.ref[0][k], gg = ic.ref[1][k], bb = ic.ref[2][k], lim = Math.max(ICON.differ, 0.3 * Math.max(rr, gg, bb)); if (Math.max(Math.abs(img.r[p] - rr), Math.abs(img.g[p] - gg), Math.abs(img.b[p] - bb)) > lim) off++; });
      const share = off / ic.px.length, darker = vividOf(img, ic.area, track.w) < ICON.darker * ic.vivid;
      return { icon: i + 1, of: track.icons.length, state: share < ICON.lit ? 'lit' : share >= ICON.dim && darker ? 'dimmed' : null, share: round(share, 2) };
    });
  }
  /**
   * The states as a code fact for a prompt: "the HUD's ability row, read in code (4 icons, left to right), at 4:12.0, 6 s
   * before the death: lit (ready) icon 1 and icon 4 (the last); dimmed (on cooldown or unusable) icon 2 (91% unlike its
   * ready look)". A row can hold more than the abilities (League's: the portrait, the passive, the summoner spells, an
   * item), so icons go by their place in it. Dimmed isn't only a cooldown: stunned, League dims every icon (8:49). ''
   * when no icon's state is sure. what: the loss, "the death".
   */
  function abilityFact(states, { t, before, what = 'the loss' } = {}) {
    const sure = (states || []).filter((s) => s.state);
    if (!sure.length) return '';
    const n = states[0].of, name = (s) => `${s.icon}${s.icon === n ? ' (the last)' : ''}`, list = (xs) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')}, and ${xs.at(-1)}`);
    const lit = sure.filter((s) => s.state === 'lit'), dim = sure.filter((s) => s.state === 'dimmed');
    const said = [lit.length && `lit (ready) icon${lit.length > 1 ? 's' : ''} ${list(lit.map(name))}`, dim.length && `dimmed (on cooldown or unusable) icon${dim.length > 1 ? 's' : ''} ${list(dim.map((s, i) => `${s.icon} (${s.icon === n ? 'the last, ' : ''}${Math.round(s.share * 100)}%${i ? '' : ' unlike its ready look'})`))}`].filter(Boolean);
    return `the HUD's ability row, read in code (${n} icons, left to right), at ${mmss(t, true)}${Number.isFinite(before) ? `, ${round(before, 1)} s before ${what}` : ''}: ${said.join('; ')}`;
  }

  /**
   * What the read is told where code couldn't split the ability row (abilityIcons' why): that nothing is known of it, so
   * it says an ability ready or on cooldown only where the icon shows it plainly. Marvel Rivals' row, the game showing
   * through it and the ult icon twice as wide, split into one icon, and its reads said "abilities on cooldown" where one
   * was ready and one on 1 s (loop 40, M2).
   */
  const abilityUnknown = (why) => (why ? `the HUD's ability row couldn't be read in code (${String(why).replace(/\.$/, '')}): say an ability or the ult is ready or on cooldown only where its own icon shows it plainly (a cooldown number on it, or the icon greyed or dark), and otherwise that it can't be told` : '');

  // ---------- the HUD's digits, larger (hud_zoom) ----------
  // The cooldowns that decided losses are small digits on icons (League's Flash 3:55 and ult 1:30 at 1:40, Brawl Stars'
  // super, Valorant's ult READY), and the abilities crop went into the HUD sheet at about its own size (League's box
  // 0.195 of the screen wide, 374 px, scale 1), inside one tiled picture the model may shrink (Oct 25).
  const ZOOM = { abilities: 3, digitPx: 40, most: 4, maxW: 1600, maxH: 480 };
  /**
   * How much a HUD sheet row is scaled up under hud_zoom, at least: the abilities row ZOOM.abilities times, and a
   * number's readout (health, kill_count) until the learned box around its digits (digitPx tall in the frame) reaches
   * ZOOM.digitPx, up to ZOOM.most. 1 for anything else.
   */
  function digitZoom(region, digitPx = 0) {
    if (region === 'abilities') return ZOOM.abilities;
    if ((region === 'health' || region === 'kill_count') && digitPx > 0) return clamp(ZOOM.digitPx / digitPx, 1, ZOOM.most);
    return 1;
  }
  /** A row's scale k raised to want, within ZOOM's caps for a box b ({ w, h } px): a row never shrinks. */
  const zoomScale = (k, b, want) => Math.max(k, Math.min(want, ZOOM.maxW / b.w, ZOOM.maxH / b.h));
  /**
   * How many columns of moment blocks (each colW by colH px) make a sheet of n moments nearest square: a picture sent
   * at a fixed token budget keeps the most of its pixels that way, and a zoomed row three moments wide ran to 3.4k px.
   */
  function sheetCols(n, colW, colH) {
    let best = n, score = Infinity;
    for (let c = 1; c <= n; c++) { const s = Math.abs(Math.log((c * colW) / (Math.ceil(n / c) * colH))); if (s < score - 1e-9) { best = c; score = s; } }
    return best;
  }

  // ---------- causes by reference (factor_refs) ----------
  // Causes named about half of what the read had: League's reads filled 6 kinds and the causes named 2, with none of
  // the read's numbers (loops 37 and 38). A lesson can name the read's factors and code's facts by reference (W3.resources,
  // W3.fact2), and code writes their numbers into its because.
  /** The numbers a line says, as written: 631, 1479, 3:55, 42%, 2-0. */
  const numbersOf = (s) => String(s || '').match(/\d+(?:[:.,/-]\d+)*%?/g) || [];
  /** A reference to what a clip read found ({ window, kind } for W3.resources, { window, fact } for W3.fact2), or null. */
  // as clip lines tag them too, in brackets: [W3.resources]
  function parseRef(ref) {
    const m = /^\s*\[?\s*(W\d+)\s*[.:]\s*([a-z_]+?)(\d*)\s*\]?\s*$/i.exec(String(ref || ''));
    if (!m) return null;
    const key = m[2].toLowerCase();
    return key === 'fact' && m[3] ? { window: m[1].toUpperCase(), fact: +m[3] } : !m[3] ? { window: m[1].toUpperCase(), kind: key } : null;
  }
  /**
   * The lesson with the numbers of what it names by reference written into its because: each referenced factor or fact
   * (resolve(ref) gives { kind, what, checked? }, or null for one that doesn't exist) whose numbers the because doesn't
   * say yet, as "as read: resources 1:40 health 631 of 1479". One without numbers, or all of them said, adds nothing.
   * refsAdded: what code wrote, for the eval to tell from the coach's own words; checkBecause: the same with the
   * screen's words kept as data (checked: a fact's line as read, a side's name in <data>), for the claim checks' prompts.
   */
  // A reference written into the text itself, as the clip lines tag them ("[W1.position], [W1.information]"): League's
  // coach copied the tags into its because, and the player read them raw, with none of their numbers (loop 41).
  const REF_TAG = /\[\s*W\d+\s*[.:]\s*[a-z_]+\d*\s*\]|\bW\d+\.(?:fact\d+|position|information|resources|numbers|map|mechanics)\b/gi;
  /** The references a text names by tag, in order ("W1.position"). */
  const refsIn = (s) => [...String(s || '').matchAll(REF_TAG)].map((m) => m[0].replace(/[[\]\s]/g, ''));
  /** A text with every reference tag taken out, and the commas, brackets, and spaces they leave tidied. */
  const stripRefs = (s) => String(s || '').replace(REF_TAG, ' ').replace(/\(\s*[,;\s]*\)/g, ' ').replace(/\s*([,;])(?:\s*[,;])+/g, '$1').replace(/\s+([,;.!?])/g, '$1').replace(/([.!?])[,;]+/g, '$1').replace(/[,;](?=[.!?])/g, '').replace(/[\s,;]+$/, '').replace(/^[\s,;]+/, '').replace(/\s{2,}/g, ' ').trim();
  function withRefs(lesson, resolve) {
    // no reference tag reaches the player, or the claims: what, because, and better without them, and the ones the coach
    // wrote in its text resolved like those it named in factors
    const tagged = ['what', 'because', 'better'].flatMap((k) => refsIn(lesson?.[k])), clean = { ...lesson };
    for (const k of ['what', 'because', 'better']) if (typeof clean[k] === 'string' && refsIn(clean[k]).length) clean[k] = stripRefs(clean[k]);
    const said = text(clean.because), named = [...(Array.isArray(lesson?.factors) ? lesson.factors.map((f) => text(f?.ref)) : []), ...tagged];
    const refs = [...new Set(named)].map((r) => resolve(r)).filter((x) => x && text(x.what));
    const fresh = [...new Map(refs.filter((x) => numbersOf(x.what).some((n) => !numbersOf(said).includes(n))).map((x) => [`${x.kind} ${text(x.what)}`, x])).values()].slice(0, 6);
    if (!fresh.length) return clean;
    const line = (key) => fresh.map((x) => `${x.kind} ${text(x[key] || x.what).replace(/\.$/, '')}`).join('; '), head = `${said.replace(/\.$/, '')}${said ? '; ' : ''}as read: `;
    return { ...clean, because: `${head}${line('what')}`, checkBecause: `${head}${line('checked')}`, refsAdded: line('what') };
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
   * alone the HP never showed the 0 of a death. Not wider, by default: grown to 10% wide, League's kill-count box beside
   * its K/D/A read it, but one learned on the stats panel read attack damage and move speed rising as deaths (Oct 23).
   * A box in the wrong place is better read as nothing than as another number.
   */
  const READOUT_H = 0.07, READOUT_W = 0;
  function readoutRegion([x, y, w, h], minH = READOUT_H, minW = READOUT_W) {
    const ww = Math.max(w, minW), hh = Math.max(h, minH);
    return [ww === w ? x : round(clamp(x + w / 2 - ww / 2, 0, 1 - ww), 4), hh === h ? y : round(clamp(y + h / 2 - hh / 2, 0, 1 - hh), 4), ww, hh];
  }

  /**
   * The character the player plays, from the clip reads (each names the one the camera follows, off its portrait, its
   * ability icons, and what it casts): kept by feedCharacters' rule, two or more reads agreeing and two thirds of those
   * that name one, so one squinted read names nobody. Learning names it off a few stills and drops it when its two reads
   * disagree (League, Oct 22: Miss Fortune read as Samira), so a review often starts without it. Returns the name, or null.
   */
  // When the reads disagree, the character each says the camera keeps at the center (centered) decides by the same
  // rule: on the player's own screen that one is the player's. Brawl Stars' reads, with no name learned, named nine
  // brawlers in eight windows, each the one in the middle of the fight (loop 41).
  function characterFrom(readings) {
    const agreed = (key) => {
      const list = (readings || []).map((r) => text(r?.[key])).filter((c) => c && !/^(unknown|none|unclear|n\/?a)$/i.test(c));
      const top = mostCommon(list.map(nameKey)), n = list.filter((c) => nameKey(c) === top).length;
      return top && n >= 2 && n >= (2 / 3) * list.length ? list.find((c) => nameKey(c) === top).slice(0, 40) : null;
    };
    return agreed('player_character') || agreed('centered');
  }

  /**
   * The characters a claim names that nothing backs: names from the game's roster (research's reference) found in text
   * but not in what the record shows (its lines, kill-feed names and characters, the player's own). The clip reads
   * named a different champion for one death each run (Rengar, Syndra; Oct 23), none of them shown.
   */
  const asWord = (n) => new RegExp(`(^|[^a-z0-9])${String(n).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
  const namesIn = (text, roster) => { const t = String(text || '').toLowerCase(); return [...new Set((roster || []).filter((n) => String(n || '').length >= 3 && asWord(n).test(t)))]; };
  function unshownNames(text, roster, recordText) {
    const known = new Set(namesIn(recordText, roster).map((n) => n.toLowerCase()));
    return namesIn(text, roster).filter((n) => !known.has(n.toLowerCase()));
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
    SLACK, MIN_EVIDENCE, LEAD_MAX, createLedger, recordLook, seen, deadForOf, deathAt, playedInRounds, noRespawnRounds, roundStarts, roundDeath, aliveInRound, ROUND_GAP, LOSS_LOOKS, losses, lossGap, lossMoments, costliest, atLoss, MIN_LOSSES, MAX_TRIES, fightOf, retryRefusal, problemKind, NOT_DECIDING, checkFinish,
    STATUSES, applyNote, boardBrief, unreadDowns, unreadUnits, cutTimes, snapUnits, KINDS, normalizeEvents, mergeEvents, knownText, eventLine, eventsBrief, wrapNames,
    pixelTeam, killfeedRows, teamLines, colorBands, fitGrid, rowDistance, SAME_ROW, sameRow, freshRows, nameKey, sameName, feedSightings, choosePlayer, whoIsPlayer, buildKillfeed, confirmByBanners, cutNames, aliasNames, feedCharacters, counterRises, counterSteps, hudKills, hpGone, hpSliver, hudRecord, mergeCounts, riseSpans, lowSpans, timesIn, nearDeaths, NEAR_DEATH, controlClaims, ammoPairs, ammoSlots, mixedAmmo, namedTimes, recordingTimes, numberText, statesNumber, NEAR_TIME, MOMENT_SLACK, claimTimes, quotedLine, lineKind, staleAgainst, sawElsewhen, videoSaw, movesIn, playedMoves, engineMoves, engineFact, movesAt, lineContradicts, chessBetter, steadyClocks, iconPixels, abilityIcons, abilityState, abilityFact, abilityUnknown, sameSide, trustCounter, settleFights, pointsTaken, oneDeathEach, eventWindows, readFrom, windowLosses, nearLosses, RUN_UP, fightsFromClips, clipMoments, onClock, feedText, textRows, textEdge, onEdge, feedBand, nameColors, textFeedReads, textFeedSightings, teamsByColor,
    ammoReading, shotsFired, fireTimes, groupFights, mergeFights, feedTeams, scoreRounds, matchState, stateFacts, fillerFactor, deathCues, narratedDeath, viewEdges, viewMotion, viewFact, unheldResource, dropResourceClause, playersLeft, soloAgainst, resultOf, settleResult, readDrops, dropChecked, DROP_SHARE, MAX_FRAMES, framePlan, CLIP_LOOK, clipPlan, claimAfter, regionRect, READOUT_H, READOUT_W, readoutRegion, characterFrom, namesIn, unshownNames,
    uncoveredLosses, COVER_N, CHESS_COVER_N, rankedLosses, lossOrder, coverFill, fillRejected, pickTurns, structureSteps, structureEvents, structureSpans, trustStructures, STRUCTURE_DROP, LONG_RUN_UP, ZOOM, digitZoom, zoomScale, sheetCols, numbersOf, parseRef, refsIn, stripRefs, withRefs, barColor, barFill, barRun, barLike, barSpan, secondBar, barAgrees, damageChecked, barFullTimes, barReadings, barDamage, BAR_DROP, QUIET_DROP, BAR_WINDOW, fightWindows,
    emptyHistory, addMatch, acceptHabit, historyFor, dropHabit, compareAim, historyBrief,
  };
  root.ThirdeyeCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
