// The scorecard: every loop scored on one card, the same rows in the same order, so one loop can be held against
// another. Each review run is held against the frame-checked coach baseline of its clip (eval/answer-keys/coach). What
// each row counts, and how a grader fills in the rows code can't, is in eval/SCORECARD.md.
//   node eval/scorecard.mjs <loop dir> <name> [grades.json]
//     scores the run-N.json files in <loop dir>/<game>/ and writes tests/evals/<name>.scorecard.json and .md; the
//     grades default to tests/evals/<name>.grades.json, and without them the Claims and Checker rows stay empty
//   node eval/scorecard.mjs compare <a> <b>
//     loop a against loop b (their scorecards in tests/evals), on the games with valid runs in both
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const KEYS = path.join(ROOT, 'eval/answer-keys/coach'), OUT = path.join(ROOT, 'tests/evals');
export const GAMES = { lol: ['League of Legends', /league/i], rl: ['Rocket League', /rocket/i], mr: ['Marvel Rivals', /marvel/i], val: ['Valorant', /6\.13\.34|valorant/i], cr: ['Clash Royale', /clash/i], fn: ['Fortnite', /fortnite/i], bs: ['Brawl Stars', /brawl/i], ch: ['Chess', /chess/i], r6: ['Rainbow Six Siege', /rainbow/i] };
export const SHORT = { lol: 'LoL', rl: 'RL', mr: 'Rivals', val: 'Val', cr: 'CR', fn: 'FN', bs: 'BS', ch: 'Chess', r6: 'R6' };
export const sec = (s) => { const m = String(s ?? '').match(/^(\d+):(\d+(?:\.\d+)?)/); return m ? +m[1] * 60 + +m[2] : s !== '' && s != null && Number.isFinite(+s) ? +s : NaN; };
export const mmss = (t) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}` : '?');

/** Every validated baseline clip: the four in baseline.validated.json, and one per validated-*.json. */
export function loadBaselines(dir = KEYS) {
  const clips = [...JSON.parse(fs.readFileSync(path.join(dir, 'baseline.validated.json'), 'utf8')).clips];
  for (const f of fs.readdirSync(dir).filter((f) => /^validated-.*\.json$/.test(f)).sort()) {
    const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!clips.some((x) => x.clip === c.clip)) clips.push(c);
  }
  return clips;
}

// ---------- numbers in words ----------
// The numbers a cause gives, each read with what it is: a share (42%), health or a resource as a fraction (631/1479, a
// range like 617-621 of 1479) or with its word (45 health, 42 boost), a cooldown or the clock left (3:55 left), a score
// (2-0), how many on each side (1 v 2), and a count of players (two teammates, 4 players). A bare time (at 1:40) is a
// timestamp, not a number that decided anything, and isn't read.
const WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const int = (x) => (WORD[String(x).toLowerCase()] ?? +String(x).replace(/,/g, ''));
const RES = 'health|hp|shields?|boost|elixir|ammo|gold|mana|credits';
export function numbersIn(text) {
  let t = ` ${String(text || '')} `;
  const out = [], take = (re, f) => { t = t.replace(re, (...m) => { const x = f(m); if (x) out.push(x); return ' '; }); };
  take(/(\d+(?:\.\d+)?)\s*%/g, (m) => ({ k: 'pct', v: +m[1], said: `${m[1]}%` }));
  take(/(\d[\d,]*)(?:\s*[-–]\s*(\d[\d,]*))?\s*(?:\/|out of|of)\s*(\d[\d,]*)/gi, (m) => ({ k: 'frac', a: int(m[1]), a2: int(m[2] ?? m[1]), b: int(m[3]), said: m[0].trim().replace(/,+$/, '') }));
  // "45 health" first, then "health at 45" with only a linking word between (never "shield and 45 health"), and "boost
  // 65 to 42" as both
  const noun = (x) => x.toLowerCase().replace(/^hp$/, 'health').replace(/s$/, '');
  take(new RegExp(`(\\d[\\d,]*)\\s*(${RES})\\b`, 'gi'), (m) => ({ k: 'res', noun: noun(m[2]), v: int(m[1]), said: m[0].trim() }));
  take(new RegExp(`\\b(${RES})\\b\\s*(?:(?:was|is|at|of|now|left|read|reads|fell from|fell to|from|down to|went from)\\s*)?[:=]?\\s*(\\d[\\d,]*)(?:\\s*(?:to|->|→)\\s*(\\d[\\d,]*))?`, 'gi'), (m) => { if (m[3]) out.push({ k: 'res', noun: noun(m[1]), v: int(m[3]), said: `${m[1]} ${m[3]}` }); return { k: 'res', noun: noun(m[1]), v: int(m[2]), said: m[0].trim() }; });
  take(/(\d{1,2}):(\d{2})\s*(?:left|remaining|to go|on (?:the )?clock)/gi, (m) => ({ k: 'clock', v: +m[1] * 60 + +m[2], said: m[0].trim() }));
  take(/(?:cooldown|clock)\s*(?:of|read|reads|showed|[:(,])?\s*(\d{1,2}):(\d{2})/gi, (m) => ({ k: 'clock', v: +m[1] * 60 + +m[2], said: `${m[1]}:${m[2]}` }));
  t = t.replace(/\d+:\d+(?:\.\d+)?/g, ' '); // timestamps
  take(/\b(\d|one|two|three|four|five|six)\s*(?:-?v-?|vs\.?|versus|against)\s*(\d|one|two|three|four|five|six)\b/gi, (m) => ({ k: 'vs', a: int(m[1]), b: int(m[2]), said: m[0].trim() }));
  take(/\b(1?\d|20)\s*(?:-|–|to)\s*(1?\d|20)\b(?!\s*(?:s\b|sec|seconds|m\b|met|min|percent))/gi, (m) => ({ k: 'score', a: +m[1], b: +m[2], said: m[0].trim() }));
  take(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:[a-z]+\s+)?(teammates?|allies|ally|enemies|enemy|opponents?|players?)\b/gi, (m) => ({ k: 'count', v: int(m[1]), noun: m[2].toLowerCase().replace(/^(teammates?|allies|ally)$/, 'teammate').replace(/^(enemies|enemy|opponents?)$/, 'enemy').replace(/s$/, ''), said: m[0].trim() }));
  return out;
}
const close = (x, y, rel = 0.03, abs = 1) => Math.abs(x - y) <= Math.max(abs, rel * Math.abs(y));
const share = (n) => (n.k === 'pct' ? n.v : n.k === 'frac' && n.b ? (100 * (n.a + n.a2)) / 2 / n.b : null);
/** Whether number c (said in a review) is number b (in the baseline). */
export function sameNumber(c, b) {
  if (c.k === 'pct' || b.k === 'pct') return share(c) != null && share(b) != null && Math.abs(share(c) - share(b)) <= 3;
  if (c.k === 'frac' && b.k === 'frac') return close(c.b, b.b, 0.02) && c.a2 >= b.a - Math.max(2, 0.03 * b.a) && c.a <= b.a2 + Math.max(2, 0.03 * b.a2);
  if ((c.k === 'frac' || c.k === 'res') && (b.k === 'frac' || b.k === 'res')) { const lo = (n) => (n.k === 'frac' ? n.a : n.v), hi = (n) => (n.k === 'frac' ? n.a2 : n.v); return (c.k !== 'res' || b.k !== 'res' || c.noun === b.noun) && hi(c) >= lo(b) - Math.max(1, 0.03 * lo(b)) && lo(c) <= hi(b) + Math.max(1, 0.03 * hi(b)); }
  if (c.k === 'clock' && b.k === 'clock') return Math.abs(c.v - b.v) <= 2;
  if ((c.k === 'score' && b.k === 'score') || (c.k === 'vs' && b.k === 'vs')) return (c.a === b.a && c.b === b.b) || (c.a === b.b && c.b === b.a);
  if (c.k === 'count' && b.k === 'count') return c.noun === b.noun && c.v === b.v;
  return false;
}
/**
 * Whether the baseline has a number of the same kind as c to hold it to: health against health, a score against a
 * score. A share and a fraction of something health-sized (out of 50 or more) are the same kind; a fraction is held to
 * another only of the same whole.
 */
export function sameKind(c, b) {
  const big = (n) => n.k === 'pct' || (n.k === 'frac' && n.b >= 50);
  if (c.k !== b.k) return (c.k === 'pct' || c.k === 'frac') && (b.k === 'pct' || b.k === 'frac') && big(c) && big(b);
  if (c.k === 'res' || c.k === 'count') return c.noun === b.noun;
  if (c.k === 'frac') return close(c.b, b.b, 0.02);
  return true;
}
/** The baseline's numbers a cause names: [what the cause said]. */
export const numbersNamed = (cause, factors) => { const base = Object.values(factors || {}).flatMap((x) => numbersIn(x)); return [...new Set(numbersIn(cause).filter((c) => base.some((b) => sameNumber(c, b))).map((c) => c.said))]; };
/** The numbers a cause gives that the baseline loss can check: { right: [said], wrong: [said] }. */
export function numbersChecked(cause, factors) {
  const base = Object.values(factors || {}).flatMap((x) => numbersIn(x)), right = [], wrong = [];
  for (const c of numbersIn(cause)) {
    if (!base.some((b) => sameKind(c, b))) continue;
    (base.some((b) => sameNumber(c, b)) ? right : wrong).push(c.said);
  }
  return { right: [...new Set(right)], wrong: [...new Set(wrong)] };
}

// ---------- one run ----------
/** A name the review gave against the ones a key accepts: the same letters and digits, or one inside the other. */
export const nameKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const sameName = (a, b) => { const x = nameKey(a), y = nameKey(b); return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 3 && (x.includes(y) || y.includes(x)))); };
/**
 * Why a run says nothing about the code, or '': it ended with no result; the API refused or dropped calls (busy, a 503,
 * a 429 over quota) API_FAILS times or more, as retries, model fallbacks, and lost minutes then decide what it does; or
 * a call failed and was never answered on a retry. Such a run is left out, not scored as the code's failure: loop 49's
 * first Marvel Rivals and Fortnite runs had 8 and 15 refused calls and were counted (the user, Oct 26).
 */
export const API_FAILS = 3;
export function voidWhy(run) {
  const t = run.usage?.timeline || [], ok = t.filter((x) => x.status === 200).length, failed = t.length - ok;
  if (!(run.finishes?.length || run.why || run.final?.why)) return 'no result';
  if (failed >= API_FAILS) return `${failed} calls refused or dropped by the API`;
  const lost = t.map((x, i) => ({ ...x, i })).filter((x) => x.status !== 200 && !t.slice(x.i + 1).some((y) => y.job === x.job && y.status === 200));
  return lost.length ? `${lost.length} call${lost.length === 1 ? '' : 's'} the API failed and no retry answered (${lost.map((x) => `${x.job} ${x.status}`).join(', ')})` : '';
}
export const isVoid = (run) => !!voidWhy(run);
/** What the finding shows at moments: its evidence, fixes, and turning points, the coach's and code's alike, each claim once. */
export function citesOf(run) {
  const fin = run.final || {};
  return [...(fin.evidence || []).map((e) => ['evidence', e]), ...(fin.fixes || []).map((e) => ['fix', e]), ...(fin.turning || fin.turning_points || []).map((e) => ['turning point', e])]
    .map(([kind, e]) => ({ kind, t: sec(e.t), to: sec(e.ledTo ?? e.led_to), what: String(e.what || ''), because: String(e.because || ''), better: String(e.better || ''), filled: e.filled || '' }))
    .filter((c, i, all) => all.findIndex((x) => x.t === c.t && x.what === c.what) === i); // the same claim shown as a fix and a turning point is one
}
/** A baseline loss with its times in seconds; from: when the decision that lost it began. */
export const lossOf = (l) => ({ t: l.t, at: sec(l.t), from: sec(String(l.decided || '').split('-')[0]), kind: String(l.kind || ''), factors: l.factors || {} });
/** Whether a cite is at a loss: at it or the decision that led to it, from the decision's start (3 s early) to 4 s after. */
export const atLoss = (l, c) => [c.t, c.to].some((x) => Number.isFinite(x) && x >= (Number.isFinite(l.from) ? l.from : l.at - 20) - 3 && x <= l.at + 4);
// the record's events that can hold a baseline loss of each kind
// a structure losing health is the record's objective_damage: left out, no Clash Royale tower drop the record found was
// ever counted as found (Oct 26)
const holds = (kind) => (/^death/.test(kind) ? ['death'] : /near_death|damage/.test(kind) ? ['near_death', 'damage', 'objective_damage', 'point_lost'] : /point_lost|destroyed|goal/.test(kind) ? ['point_lost'] : /blunder|mistake|inaccuracy/.test(kind) ? ['move'] : []);
const ply = (s) => { const m = String(s || '').match(/(\d+)\.\s*(?:\.\.\.\s*)?([KQRBNa-hO][\w+#=-]*)/); return m ? `${m[1]}.${m[2].replace(/[+#]/g, '')}` : null; };
const graded = (e) => e.kind !== 'move' || /\((mistake|blunder|inaccuracy)/i.test(e.text || '');
/** The record's event that holds baseline loss l (a chess move must be the same move), or null. */
export function foundIn(l, events) {
  const kinds = holds(l.kind), move = ply(l.kind);
  return (events || []).find((e) => kinds.includes(e.kind) && graded(e) && Math.abs(e.t - l.at) <= 5 && (e.kind !== 'move' || !move || ply(e.text) === move)) || null;
}
// the record's events a baseline lists in full: every death and every point or structure lost (not every near-death or
// damage, which a baseline lists only where it decided something)
const hard = (e) => e.kind === 'death' || e.kind === 'point_lost';
const holdsHard = (l, e) => (e.kind === 'death' ? /^death/.test(l.kind) : /point_lost|destroyed|goal/.test(l.kind));

// [group, key, label, better ('up', 'down', or '' for neither), scored by ('code' or 'grader')]. Coverage (was a loss
// cited at all) is its own row; right, partly, and wrong are shares of the losses cited, so a finding that names one
// habit at three losses isn't marked wrong for the losses it never claimed anything about
export const ROWS = [
  ['Seeing', 'player', 'Player named right', 'up', 'code'],
  ['Seeing', 'otherPlayer', 'Player named as someone else', 'down', 'code'],
  ['Seeing', 'character', 'Character named right', 'up', 'code'],
  ['Seeing', 'found', 'Losses found in the record', 'up', 'code'],
  ['Seeing', 'invented', 'Deaths and points invented', 'down', 'code'],
  ['Seeing', 'numbers', 'Numbers read right', 'up', 'grader'],
  ['Claims', 'cited', 'Losses cited', 'up', 'code'],
  ['Claims', 'right', 'Cited losses explained right', 'up', 'grader'],
  ['Claims', 'partly', 'Cited losses partly right', '', 'grader'],
  ['Claims', 'wrong', 'Cited losses explained wrong', 'down', 'grader'],
  ['Claims', 'nothing', 'Cites at nothing real', 'down', 'grader'],
  ['Checker', 'caught', 'False claims caught', 'up', 'grader'],
  ['Checker', 'wrongly', 'True claims sent back', 'down', 'grader'],
];
export const graderRow = (key) => ROWS.find((r) => r[1] === key)?.[4] === 'grader';
const GRADES = ['right', 'partly', 'wrong'];

/**
 * One run held against its clip's baseline. grade: this run's grades ({ losses: { [baseline t]: { grade, numbers: {
 * right, wrong, unclear } } }, outside: [{ t, really }], sent_back: [{ really }] }), or null. Returns { void, rows: {
 * [row]: { n, d } }, cost, losses: [per baseline loss], outside: [cites at no baseline loss], ungraded }.
 */
export function scoreRun(run, clip, grade = null) {
  const v = isVoid(run), t = run.usage?.timeline || [], ok = t.filter((x) => x.status === 200).length;
  const cost = { minutes: +run.minutes || 0, answered: ok, failed: t.length - ok, prompt: run.usage?.prompt || 0, output: run.usage?.output || 0 };
  const rows = Object.fromEntries(ROWS.map(([, k]) => [k, { n: 0, d: 0 }]));
  if (v || !clip) return { void: v, ...(v ? { voidWhy: voidWhy(run) } : {}), rows, cost, losses: [], outside: [], ungraded: 0 };
  const ids = clip.ids || {};
  // who and what they play: a name the key accepts, someone else's name, or none
  const who = run.player || run.learned?.playerName || '', plays = run.character || run.learned?.character || '';
  if (ids.player?.length) {
    const right = ids.player.some((x) => sameName(who, x));
    rows.player = { n: right ? 1 : 0, d: 1 };
    if (who) rows.otherPlayer = { n: right ? 0 : 1, d: 1 };
  }
  if (ids.character?.length) rows.character = { n: ids.character.some((x) => sameName(plays, x)) ? 1 : 0, d: 1 };
  // the record against the baseline's losses, and the deaths and points it holds that aren't one: points and
  // structures only where the key lists that kind of loss (League's key lists her deaths, not the team's turrets)
  const losses = (clip.losses || []).map(lossOf), events = run.events || [];
  const keyPoints = losses.some((l) => /point_lost|destroyed|goal/.test(l.kind));
  const record = events.filter((e) => e.kind === 'death' || (e.kind === 'point_lost' && keyPoints));
  rows.invented = { n: record.filter((e) => !losses.some((l) => holdsHard(l, e) && Math.abs(e.t - l.at) <= 5)).length, d: record.length };
  // the finding, loss by loss
  const cites = citesOf(run), per = [];
  for (const l of losses) {
    const here = cites.filter((c) => atLoss(l, c)), g = grade?.losses?.[l.t];
    const status = !here.length ? 'missed' : GRADES.includes(g?.grade) ? g.grade : 'ungraded';
    per.push({ t: l.t, kind: l.kind, found: !!foundIn(l, events), cited: here.length > 0, status, numbers: g?.numbers || null });
  }
  const cited = per.filter((x) => x.cited);
  rows.found = { n: per.filter((x) => x.found).length, d: per.length };
  rows.cited = { n: cited.length, d: per.length };
  // the cites at no baseline loss: a real loss the key doesn't list (a soft chess mistake, a team's objective) or nothing
  const outside = cites.filter((c) => !losses.some((l) => atLoss(l, c)));
  if (grade) {
    for (const k of GRADES) rows[k] = { n: cited.filter((x) => x.status === k).length, d: cited.length };
    const nums = cited.map((x) => x.numbers || {});
    rows.numbers = { n: nums.reduce((s, x) => s + (x.right?.length || 0), 0), d: nums.reduce((s, x) => s + (x.right?.length || 0) + (x.wrong?.length || 0), 0) };
    const judged = (grade.outside || []).filter((x) => x.really === 'loss' || x.really === 'none');
    rows.nothing = { n: judged.filter((x) => x.really === 'none').length, d: cites.length };
    // the checker: what it sent back, as the grader judged it, against the false claims that got past it
    const sent = (grade.sent_back || []).filter((x) => x.really === 'false' || x.really === 'true'), lies = sent.filter((x) => x.really === 'false').length;
    rows.caught = { n: lies, d: lies + rows.wrong.n };
    rows.wrongly = { n: sent.length - lies, d: sent.length };
  }
  const ungraded = grade ? cited.filter((x) => x.status === 'ungraded').length + Math.max(0, outside.length - (grade.outside || []).length) : 0;
  return { void: false, rows, cost, losses: per, outside: outside.map((c) => `${mmss(c.t)} ${c.what}`.slice(0, 160)), ungraded };
}

const add = (a, b) => Object.fromEntries(ROWS.map(([, k]) => [k, { n: (a[k]?.n || 0) + (b[k]?.n || 0), d: (a[k]?.d || 0) + (b[k]?.d || 0) }]));
const empty = () => Object.fromEntries(ROWS.map(([, k]) => [k, { n: 0, d: 0 }]));
/** The runs' rows summed, and their cost averaged over the valid runs. */
export function sumRuns(runs) {
  const valid = runs.filter((r) => !r.void), mean = (f) => (valid.length ? valid.reduce((s, r) => s + f(r), 0) / valid.length : null);
  return {
    rows: valid.reduce((s, r) => add(s, r.rows), empty()),
    cost: { runs: runs.length, valid: valid.length, minutes: mean((r) => r.cost.minutes), answered: mean((r) => r.cost.answered), failed: mean((r) => r.cost.failed), prompt: mean((r) => r.cost.prompt), output: mean((r) => r.cost.output) },
    ungraded: valid.reduce((s, r) => s + r.ungraded, 0),
  };
}

/** Every game's runs in a loop dir, scored. grades: the loop's grades file's contents, or null. */
export function scoreLoop(dir, { name = path.basename(dir), grades = null, clips = loadBaselines() } = {}) {
  const games = [];
  for (const [tag, [game, re]] of Object.entries(GAMES)) {
    const gdir = path.join(dir, tag);
    if (!fs.existsSync(gdir)) continue;
    const clip = clips.find((c) => re.test(c.clip));
    const files = fs.readdirSync(gdir).filter((f) => /^run-\d+\.json$/.test(f)).sort((a, b) => parseInt(a.slice(4)) - parseInt(b.slice(4)));
    const runs = files.map((f) => ({ run: parseInt(f.slice(4)), ...scoreRun(JSON.parse(fs.readFileSync(path.join(gdir, f), 'utf8')), clip, grades?.games?.[tag]?.[parseInt(f.slice(4))] || null) }));
    games.push({ tag, game, losses: clip?.losses?.length || 0, runs, ...sumRuns(runs) });
  }
  const all = games.reduce((s, g) => ({ rows: add(s.rows, g.rows), ungraded: s.ungraded + g.ungraded }), { rows: empty(), ungraded: 0 });
  return { name, source: dir, generated: new Date().toISOString(), graded: !!grades, gradedBy: grades?.by || null, games, all: { ...all, cost: sumRuns(games.flatMap((g) => g.runs)).cost } };
}

// ---------- the table ----------
const pct = (x) => (x.d ? ` (${Math.round((100 * x.n) / x.d)}%)` : '');
const cell = (x) => (x.d ? `${x.n}/${x.d}` : '–');
const k = (n) => (n == null ? '–' : `${Math.round(n / 1000)}k`);
const f1 = (n) => (n == null ? '–' : n.toFixed(1));
const costCells = (c) => ({ runs: `${c.valid}/${c.runs}`, minutes: f1(c.minutes), calls: c.valid ? `${f1(c.answered)} / ${f1(c.failed)}` : '–', tokens: c.valid ? `${k(c.prompt)} / ${k(c.output)}` : '–' });
const COST = [['runs', 'Runs (valid of all)'], ['minutes', 'Minutes a run'], ['calls', 'Calls a run (answered / failed)'], ['tokens', 'Tokens a run (prompt / output)']];
const arrow = (better) => (better === 'up' ? ' ↑' : better === 'down' ? ' ↓' : '');
/** The card as a Markdown table: one row per measure, one column per game, and all games together. */
export function table(card) {
  const gs = card.games, L = [];
  L.push(`| Group | Measure | ${gs.map((g) => SHORT[g.tag]).join(' | ')} | All |`, `|---|---|${gs.map(() => '---|').join('')}---|`);
  for (const [group, key, label, better] of ROWS) {
    const graderOnly = graderRow(key);
    const show = (x, g) => (g && !g.cost.valid ? 'void' : graderOnly && !card.graded ? 'not graded' : cell(x));
    L.push(`| ${group} | ${label}${arrow(better)} | ${gs.map((g) => show(g.rows[key], g)).join(' | ')} | ${graderOnly && !card.graded ? 'not graded' : `${cell(card.all.rows[key])}${pct(card.all.rows[key])}`} |`);
  }
  const cc = costCells(card.all.cost);
  for (const [key, label] of COST) L.push(`| Cost | ${label} | ${gs.map((g) => costCells(g.cost)[key]).join(' | ')} | ${cc[key]} |`);
  return L.join('\n');
}
/** The notes a card's table needs: what's left out, and what isn't graded. */
export function tableNotes(card) {
  const notes = [];
  const voided = card.games.flatMap((g) => g.runs.filter((r) => r.void).map((r) => `${SHORT[g.tag]} run ${r.run}${r.voidWhy ? ` (${r.voidWhy})` : ''}`));
  if (voided.length) notes.push(`Void, left out of every row (the API refused or dropped calls, or no result): ${voided.join(', ')}.`);
  if (card.graded && card.all.ungraded) notes.push(`${card.all.ungraded} cited loss${card.all.ungraded === 1 ? '' : 'es'} or cites outside the key not graded yet.`);
  if (!card.graded) notes.push('No grades file: the rows a grader fills in are empty.');
  else notes.push(`Graded by ${card.gradedBy || 'a grader'}, by eval/SCORECARD.md.`);
  return notes;
}

/**
 * The evals index (tests/evals/README.md): one line per scored loop, from every <name>.scorecard.json there, all with
 * the same columns.
 */
export function writeIndex(dir = OUT) {
  const cards = fs.readdirSync(dir).filter((f) => /\.scorecard\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  // a card from before a row existed shows it as empty
  const show = (card, key) => { const x = card.all.rows[key] || { n: 0, d: 0 }; return graderRow(key) && !card.graded ? 'not graded' : `${cell(x)}${pct(x)}`; };
  const L = ['# Eye Catcher evals', '', 'Each loop reviews the test recordings in the desktop app, several times each, and every run is scored on one card against the frame-checked coach baselines (`eval/answer-keys/coach/`): the rows and how they are graded are in `eval/SCORECARD.md`. Each loop has its card (`<loop>.scorecard.md`), its full report (`<loop>.md`, with the app\'s screens, and `.json`), and, where graded, its grades (`<loop>.grades.json`). `ideas-*.md` are the experiments planned before a loop. Screenshots show third-party footage and stay on this machine (`.gitignore`). Compare two loops with `node eval/scorecard.mjs compare <a> <b>`: it counts only the games valid in both.', '',
    '| Loop | Games (valid runs) | Losses found ↑ | Losses cited ↑ | Cited, explained right ↑ | Invented ↓ | False claims caught ↑ | Calls a run | Prompt tokens a run | Card |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const c of cards) {
    const games = c.games.map((g) => `${SHORT[g.tag]} ${g.cost.valid}`).join(', ');
    L.push(`| ${c.name} | ${games} | ${show(c, 'found')} | ${show(c, 'cited')} | ${show(c, 'right')} | ${show(c, 'invented')} | ${show(c, 'caught')} | ${f1(c.all.cost.answered)} | ${k(c.all.cost.prompt)} | [card](${c.name}.scorecard.md)${fs.existsSync(path.join(dir, `${c.name}.md`)) ? ` · [report](${c.name}.md)` : ''} |`);
  }
  fs.writeFileSync(path.join(dir, 'README.md'), L.join('\n') + '\n');
}

/** Loop a against loop b, on the games with valid runs in both: one row per measure, with the change. */
export function compare(a, b) {
  const both = a.games.filter((g) => g.cost.valid && b.games.some((h) => h.tag === g.tag && h.cost.valid)).map((g) => g.tag);
  const sum = (card) => card.games.filter((g) => both.includes(g.tag)).reduce((s, g) => add(s, g.rows), empty());
  const ra = sum(a), rb = sum(b), share = (x) => (x.d ? x.n / x.d : null), L = [];
  L.push(`Same games in both: ${both.map((t) => SHORT[t]).join(', ') || 'none'}.`, '', `| Group | Measure | ${a.name} | ${b.name} | Change |`, '|---|---|---|---|---|');
  for (const [group, key, label, better] of ROWS) {
    const graderOnly = graderRow(key);
    const shown = (card, x) => (graderOnly && !card.graded ? 'not graded' : `${cell(x)}${pct(x)}`);
    const sa = share(ra[key]), sb = share(rb[key]), can = sa != null && sb != null && !(graderOnly && (!a.graded || !b.graded));
    const d = can ? Math.round(100 * (sb - sa)) : null, word = d == null || d === 0 || !better ? '' : (d > 0) === (better === 'up') ? ' better' : ' worse';
    L.push(`| ${group} | ${label}${arrow(better)} | ${shown(a, ra[key])} | ${shown(b, rb[key])} | ${d == null ? '–' : `${d > 0 ? '+' : ''}${d} pts${word}`} |`);
  }
  return L.join('\n');
}

/**
 * What a grader has to judge in a loop, by eval/SCORECARD.md: for each valid run, every cited baseline loss with what
 * the baseline says of it, the cites at it, and the numbers they give; the cites at no baseline loss, with what the
 * record holds there; and everything the checker sent back.
 */
export function worksheet(dir, { name = path.basename(dir), clips = loadBaselines() } = {}) {
  const out = { loop: name, rules: 'eval/SCORECARD.md', games: {} };
  for (const [tag, [game, re]] of Object.entries(GAMES)) {
    const gdir = path.join(dir, tag);
    if (!fs.existsSync(gdir)) continue;
    const clip = clips.find((c) => re.test(c.clip)), runs = {};
    for (const f of fs.readdirSync(gdir).filter((f) => /^run-\d+\.json$/.test(f))) {
      const run = JSON.parse(fs.readFileSync(path.join(gdir, f), 'utf8'));
      if (isVoid(run)) { runs[parseInt(f.slice(4))] = { void: true }; continue; }
      const cites = citesOf(run), shown = (c) => ({ kind: c.kind, t: mmss(c.t), ...(Number.isFinite(c.to) ? { led_to: mmss(c.to) } : {}), what: c.what, because: c.because, better: c.better, ...(c.filled ? { by: 'code' } : {}) });
      runs[parseInt(f.slice(4))] = {
        named: run.found ? run.habit : run.reason || run.final?.reason || '',
        losses: (clip?.losses || []).map((l) => ({ l, at: lossOf(l) })).filter(({ at }) => cites.some((c) => atLoss(at, c))).map(({ l, at }) => ({
          t: l.t, kind: l.kind, decided: l.decided, happened: l.happened, factors: l.factors, mistake: l.mistake, better: l.better,
          cites: cites.filter((c) => atLoss(at, c)).map(shown),
          // every number the cites give, for the grader to judge against the key (code's parse, a starting list)
          numbers_given: [...new Set(cites.filter((c) => atLoss(at, c)).flatMap((c) => numbersIn(`${c.what} ${c.because} ${c.better}`).map((n) => n.said)))],
        })),
        // cites at no baseline loss, with what the record holds within 6 s: a real loss the key doesn't list, or nothing
        outside: cites.filter((c) => !(clip?.losses || []).some((l) => atLoss(lossOf(l), c))).map((c) => ({ ...shown(c), record: (run.events || []).filter((e) => Math.abs(e.t - c.t) <= 6 && !['round_start', 'round_end', 'opponent_move'].includes(e.kind)).map((e) => `${mmss(e.t)} ${e.kind}${e.outcome ? ` (${e.outcome})` : ''}: ${String(e.text || '').slice(0, 120)}`) })),
        sent_back: (run.sent || []).flatMap((problems, attempt) => (Array.isArray(problems) ? problems : [problems]).map((p) => ({ attempt: attempt + 1, problem: String(p) }))),
      };
    }
    out.games[tag] = { game, clip: clip?.clip, not_true: clip?.not_true || [], runs };
  }
  return out;
}

// ---------- the command line ----------
if (process.argv[1] && process.argv[1].endsWith('scorecard.mjs')) {
  const [a, b, c] = process.argv.slice(2);
  if (a === 'worksheet' && b) {
    console.log(JSON.stringify(worksheet(b, { name: c || path.basename(b) }), null, 1));
  } else if (a === 'compare' && b && c) {
    const load = (n) => JSON.parse(fs.readFileSync(path.join(OUT, `${n}.scorecard.json`), 'utf8'));
    console.log(compare(load(b), load(c)));
  } else if (a && b) {
    const gradesFile = c || path.join(OUT, `${b}.grades.json`);
    const grades = fs.existsSync(gradesFile) ? JSON.parse(fs.readFileSync(gradesFile, 'utf8')) : null;
    const card = scoreLoop(a, { name: b, grades });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${b}.scorecard.json`), JSON.stringify(card, null, 1) + '\n');
    const md = [`# Scorecard: ${b}`, '', `Every run held against the coach baselines (\`eval/answer-keys/coach\`), on the card in \`eval/SCORECARD.md\`. Cells are counts over the valid runs: n of N. ↑ higher is better, ↓ lower is better.`, '', table(card), '', ...tableNotes(card).map((x) => `- ${x}`), ''].join('\n');
    fs.writeFileSync(path.join(OUT, `${b}.scorecard.md`), md);
    writeIndex();
    console.log(md);
  } else {
    console.error('usage: node eval/scorecard.mjs <loop dir> <name> [grades.json] | compare <a> <b>');
    process.exit(1);
  }
}
