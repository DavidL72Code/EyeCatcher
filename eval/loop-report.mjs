// A loop's eval report, for people to follow: per game, what each review run did, its time, model calls, and tokens,
// and whether its finding matched the coach baseline (eval/answer-keys/coach): which of the baseline's losses it cited,
// how many of the factor kinds that decided each it named, which of the baseline's numbers its cause names (numbers
// named), the deaths its record found, and cites at no real loss.
// Writes tests/evals/<name>.md (with the app's own screenshots of run 1, kept local) and <name>.json, and lists the
// loop in tests/evals/README.md.
//   node eval/loop-report.mjs <loop dir> <name> [notes.md]
// <loop dir> holds one folder per game (lol, rl, mr, val, cr, fn, bs, ch, r6) of run-N.json files from the consistency
// harness, and optionally shots/ (SHOTS). notes.md, if given, is put in as written: what the loop changed, and the
// evaluation in words.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const KEYS = path.join(ROOT, 'eval/answer-keys/coach'), OUT = path.join(ROOT, 'tests/evals');
const [dir, name, notesFile] = process.argv.slice(2);
if (!dir || !name) { console.error('usage: node eval/loop-report.mjs <loop dir> <name> [notes.md]'); process.exit(1); }

const base = JSON.parse(fs.readFileSync(path.join(KEYS, 'baseline.validated.json'), 'utf8'));
for (const f of fs.readdirSync(KEYS).filter((f) => /^validated-.*\.json$/.test(f))) { const c = JSON.parse(fs.readFileSync(path.join(KEYS, f), 'utf8')); if (!base.clips.some((x) => x.clip === c.clip)) base.clips.push(c); }
const GAMES = { lol: ['League of Legends', /league/i], rl: ['Rocket League', /rocket/i], mr: ['Marvel Rivals', /marvel/i], val: ['Valorant', /6\.13\.34|valorant/i], cr: ['Clash Royale', /clash/i], fn: ['Fortnite', /fortnite/i], bs: ['Brawl Stars', /brawl/i], ch: ['Chess', /chess/i], r6: ['Rainbow Six Siege', /rainbow/i] };
const sec = (s) => { const m = String(s ?? '').match(/^(\d+):(\d+(?:\.\d+)?)/); return m ? +m[1] * 60 + +m[2] : s !== '' && s != null && Number.isFinite(+s) ? +s : NaN; };
const mmss = (t) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}` : '?');
const k = (n) => `${Math.round((n || 0) / 1000)}k`;
// rough: the words a cause uses for each kind of factor; a cause naming none of a kind doesn't reach it
const KINDS = {
  position: /alone|ahead|forward|past (the|their)|behind|cover|tower|turret|wall|corner|back post|last man|out of position|isolated|deep|overextend|in the open|front of/i,
  information: /\bvision\b|\bwards?\b|\bwarded\b|\bping|missing|unseen|fog of war|nearsight|\bblind(ed)?\b|\bflashed\b|reveal|minimap|no one could see|couldn'?t see|\bwarn|already (set|inside|holding)/i,
  resources: /health|\bhp\b|\d+ ?%|cooldown|ult(imate)?\b|flash (was )?(down|on cooldown)|escape|dash|portal|boost|ammo|magazine|reload|gold|credits|mana|bonus health|elixir|super\b|gadget|heals?\b/i,
  numbers: /outnumbered|\d ?v ?\d|teammates? (were |was )?(dead|down|away|far)|two (teammates|enemies)|three enemies|numbers|alone against|double commit|both .* forward|\d enemies/i,
  map: /drake|dragon|herald|baron|objective|\bscore\b|\b\d-\d\b|time left|minute left|turret (was )?(down|destroyed)|\blead\b|up \d|circle|storm|zone|overtime|sudden death|crown/i,
  mechanics: /moving while|crosshair|spray|stop(ped)? to shoot|utility|peek|aim|tight angle|shot from|channel|root(ed|s)?\b|pistol|lowered|build(ing)?\b|placement|placed/i,
};
const kindsIn = (text) => Object.entries(KINDS).filter(([, re]) => re.test(text)).map(([x]) => x);
// Numbers named: the numbers a cause gives that match one in the baseline loss's factors, so the report shows depth,
// not only kinds. Each number is read with what it is: a share (42%), health or a resource as a fraction (631/1479, a
// range like 617-621 of 1479) or with its word (45 health, 42 boost), a cooldown or the clock left (3:55 left), a score
// (2-0), how many on each side (1 v 2), and a count of players (two teammates, 4 players). A bare time (at 1:40) is a
// timestamp, not a number that decided anything, and isn't read.
const WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const int = (x) => (WORD[String(x).toLowerCase()] ?? +String(x).replace(/,/g, ''));
const RES = 'health|hp|shields?|boost|elixir|ammo|gold|mana|credits';
function numbersIn(text) {
  let t = ` ${String(text || '')} `;
  const out = [], take = (re, f) => { t = t.replace(re, (...m) => { const x = f(m); if (x) out.push(x); return ' '; }); };
  take(/(\d+(?:\.\d+)?)\s*%/g, (m) => ({ k: 'pct', v: +m[1], said: `${m[1]}%` }));
  take(/(\d[\d,]*)(?:\s*[-–]\s*(\d[\d,]*))?\s*(?:\/|out of|of)\s*(\d[\d,]*)/gi, (m) => ({ k: 'frac', a: int(m[1]), a2: int(m[2] ?? m[1]), b: int(m[3]), said: m[0].trim() }));
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
function sameNumber(c, b) {
  if (c.k === 'pct' || b.k === 'pct') return share(c) != null && share(b) != null && Math.abs(share(c) - share(b)) <= 3;
  if (c.k === 'frac' && b.k === 'frac') return close(c.b, b.b, 0.02) && c.a2 >= b.a - Math.max(2, 0.03 * b.a) && c.a <= b.a2 + Math.max(2, 0.03 * b.a2);
  if ((c.k === 'frac' || c.k === 'res') && (b.k === 'frac' || b.k === 'res')) { const lo = (n) => (n.k === 'frac' ? n.a : n.v), hi = (n) => (n.k === 'frac' ? n.a2 : n.v); return (c.k !== 'res' || b.k !== 'res' || c.noun === b.noun) && hi(c) >= lo(b) - Math.max(1, 0.03 * lo(b)) && lo(c) <= hi(b) + Math.max(1, 0.03 * hi(b)); }
  if (c.k === 'clock' && b.k === 'clock') return Math.abs(c.v - b.v) <= 2;
  if ((c.k === 'score' && b.k === 'score') || (c.k === 'vs' && b.k === 'vs')) return (c.a === b.a && c.b === b.b) || (c.a === b.b && c.b === b.a);
  if (c.k === 'count' && b.k === 'count') return c.noun === b.noun && c.v === b.v;
  return false;
}
// the baseline's numbers a cause names: [what the cause said]
const numbersNamed = (cause, factors) => { const base = Object.values(factors || {}).flatMap((x) => numbersIn(x)); return [...new Set(numbersIn(cause).filter((c) => base.some((b) => sameNumber(c, b))).map((c) => c.said))]; };
// which model answered the calls, from the harness's timeline (the model each call asked for, status 200): an A/B whose
// arms ran on different models measures the model (loops 37 and 38 ran mostly on 3.1 Flash-Lite, Oct 25)
const modelsOf = (timeline) => { const n = {}; for (const x of timeline || []) if (x.status === 200 && x.model) n[x.model] = (n[x.model] || 0) + 1; return n; };
const shareLine = (n) => { const total = Object.values(n).reduce((a, b) => a + b, 0); return total ? Object.entries(n).sort((a, b) => b[1] - a[1]).map(([m, c]) => `${m.replace(/^gemini-/, '')} ${Math.round((100 * c) / total)}%`).join(', ') : '–'; };

const games = [];
for (const tag of Object.keys(GAMES)) {
  const gdir = path.join(dir, tag);
  if (!fs.existsSync(gdir)) continue;
  const clip = base.clips.find((c) => GAMES[tag][1].test(c.clip));
  const losses = (clip?.losses || []).map((l) => ({ t: l.t, at: sec(l.t), from: sec(String(l.decided || '').split('-')[0]), kind: l.kind, mistake: l.mistake, factors: Object.keys(l.factors || {}), said: l.factors || {} }));
  const deathsReal = losses.filter((l) => /death/.test(l.kind) && !/near/.test(l.kind));
  const runs = [];
  for (const f of fs.readdirSync(gdir).filter((f) => /^run-\d+\.json$/.test(f)).sort((a, b) => parseInt(a.slice(4)) - parseInt(b.slice(4)))) {
    const r = JSON.parse(fs.readFileSync(path.join(gdir, f), 'utf8')), fin = r.final || {}, u = r.usage || {};
    const ok = (u.timeline || []).filter((x) => x.status === 200).length, failed = (u.timeline || []).length - ok;
    // the result names them turning and ledTo (agent.js toMoments); turning_points and led_to are the finish call's
    // own names, read too. Until Oct 25 only those were read, so no turning point or led_to was ever counted
    const cites = [...(fin.evidence || []).map((e) => ['evidence', e]), ...(fin.fixes || []).map((e) => ['fix', e]), ...(fin.turning || fin.turning_points || []).map((e) => ['turning point', e])]
      .map(([kind, e]) => ({ kind, t: sec(e.t), to: sec(e.ledTo ?? e.led_to), what: String(e.what || ''), because: String(e.because || ''), better: String(e.better || ''), filled: e.filled || '', refsAdded: String(e.refsAdded || '') }));
    // what the coach said, apart from what code wrote: a turning point code filled in from a clip read (cover_losses,
    // filled) and the numbers written into a because by reference (factor_refs, refsAdded) are counted on their own
    const ownBecause = (c) => (c.refsAdded ? c.because.replace(`as read: ${c.refsAdded}`, '').replace(/;\s*$/, '') : c.because);
    const at = (l, c) => [c.t, c.to].some((x) => Number.isFinite(x) && x >= (Number.isFinite(l.from) ? l.from : l.at - 20) - 3 && x <= l.at + 4);
    const perLoss = losses.map((l) => {
      const all = cites.filter((c) => at(l, c)), here = all.filter((c) => !c.filled), code = all.filter((c) => c.filled);
      const named = [...new Set(here.flatMap((c) => kindsIn(`${c.what} ${ownBecause(c)}`)))];
      const numbers = [...new Set(here.flatMap((c) => numbersNamed(`${c.what} ${ownBecause(c)}`, l.said)))];
      const codeNumbers = [...new Set([...here.flatMap((c) => (c.refsAdded ? numbersNamed(c.refsAdded, l.said) : [])), ...code.flatMap((c) => numbersNamed(`${c.what} ${c.because}`, l.said))])].filter((n) => !numbers.includes(n));
      return { t: l.t, kind: l.kind, baseline: l.mistake, factors: l.factors, cited: here.length > 0, filledCited: !here.length && code.length > 0, said: here.map((c) => `${c.what}${c.because ? ` Because: ${c.because}` : ''}`).slice(0, 2), named, coverage: l.factors.length ? named.filter((x) => l.factors.includes(x)).length / l.factors.length : null, numbers, codeNumbers };
    });
    const loose = cites.filter((c) => !losses.some((l) => at(l, c))).map((c) => `${mmss(c.t)} ${c.what}`);
    const deathsAt = r.record?.deathsAt || [];
    runs.push({
      run: parseInt(f.slice(4)), relearned: parseInt(f.slice(4)) === 1,
      verdict: r.found ? 'habit' : (r.reason || fin.reason) ? 'one-off' : 'nothing named', named: r.found ? r.habit : r.reason || fin.reason || '', why: r.why || '',
      minutes: r.minutes ?? null, calls: { answered: ok, failed }, models: modelsOf(u.timeline), flags: r.flags?.review || r.final?.flags || r.flags?.asked || [], tokens: { prompt: u.prompt || 0, output: u.output || 0, text: u.TEXT || 0, image: u.IMAGE || 0, video: u.VIDEO || 0 },
      jobs: Object.fromEntries(Object.entries(u.jobs || {}).map(([j, v]) => [j, { calls: v.calls, prompt: v.prompt, output: v.output }])),
      record: { kills: r.record?.kills ?? null, deaths: r.record?.deaths ?? null, deathsFound: deathsReal.filter((l) => deathsAt.some((t) => Math.abs(t - l.at) <= 5)).length, deathsReal: deathsReal.length, invented: deathsAt.filter((t) => !deathsReal.some((l) => Math.abs(t - l.at) <= 5)).length },
      player: { learned: r.learned?.playerName || null, plays: r.character || r.learned?.character || null },
      losses: perLoss, cited: perLoss.filter((l) => l.cited).length, numbered: perLoss.filter((l) => l.cited && l.numbers.length).length, filled: perLoss.filter((l) => l.filledCited).length, codeNumbered: perLoss.filter((l) => (l.cited || l.filledCited) && l.codeNumbers.length).length, coverage: (() => { const xs = perLoss.filter((l) => l.cited && l.coverage != null).map((l) => l.coverage); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; })(),
      looseCites: loose, sentBack: (r.sent || []).length,
    });
  }
  // the app's own screens of run 1, copied beside the report (kept out of git: third-party footage)
  const shotsDir = path.join(gdir, 'shots'), shots = [];
  if (fs.existsSync(shotsDir)) {
    const dest = path.join(OUT, name, tag);
    fs.mkdirSync(dest, { recursive: true });
    const pick = [...fs.readdirSync(shotsDir).filter((f) => /^live-\d+\.png$/.test(f)).sort(), ...['after-top.png'].filter((f) => fs.existsSync(path.join(shotsDir, f)))];
    for (const f of pick) { fs.copyFileSync(path.join(shotsDir, f), path.join(dest, f)); shots.push(`${name}/${tag}/${f}`); }
  }
  games.push({ tag, game: GAMES[tag][0], losses: losses.length, runs, shots });
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const matches = (g) => { const rs = g.runs; if (!rs.length) return 'no runs'; const cited = mean(rs.map((r) => r.cited / Math.max(1, g.losses))), cov = mean(rs.map((r) => r.coverage ?? 0)); return cited >= 0.99 && (cov >= 0.6 || g.tag === 'ch') ? 'yes' : cited >= 0.5 ? 'partly' : 'no'; };
const L = [];
L.push(`# Eval: ${name}`, '', `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} from \`${path.basename(dir)}\` by \`eval/loop-report.mjs\`. Each game was reviewed ${games[0]?.runs.length ?? 0} times by the desktop app in a harness (\`consistency.mjs\`); run 1 learns the game afresh, later runs reuse what it learned. Graded against the frame-checked coach baselines in \`eval/answer-keys/coach/\`.`, '');
L.push('**How to read it.** *Losses cited*: of the baseline\'s losses (deaths, lost points, blunders, tower losses), how many the finding cites, at the loss or at the decision that led to it. *Factor coverage*: of the kinds of factor the baseline says decided each cited loss (position, information, resources, numbers, map, mechanics), the share the cited cause names, by its words (rough; not graded for chess). *Numbers named*: of the cited losses, how many have a cause that names a number matching one in the baseline\'s factors (health like 42% or 631/1479, a cooldown like 3:55 left, a score like 2-0, a count like 1 v 2), so depth shows, not only kinds. Cites, kinds, and numbers are the coach\'s own words; *By code* counts apart the losses only a turning point code filled in cites (cover_losses), and the losses where numbers code wrote match (factor_refs or a filled turning point). *Deaths found*: the record\'s deaths against the baseline\'s. *Matches the baseline*: every loss cited with at least 60% coverage (yes), at least half cited (partly), else no.', '');
L.push('## Summary', '', '| Game | Runs | Min/run | Calls answered / failed | Model share (answered) | Prompt / output tokens | Deaths found | Losses cited | Factor coverage | Matches the baseline | Numbers named | By code (cited, numbers) |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const g of games) {
  const rs = g.runs;
  const share = shareLine(rs.reduce((n, r) => { for (const [m, c] of Object.entries(r.models)) n[m] = (n[m] || 0) + c; return n; }, {}));
  L.push(`| ${g.game} | ${rs.length} | ${mean(rs.map((r) => +r.minutes || 0))?.toFixed(1)} | ${mean(rs.map((r) => r.calls.answered))?.toFixed(1)} / ${mean(rs.map((r) => r.calls.failed))?.toFixed(1)} | ${share} | ${k(mean(rs.map((r) => r.tokens.prompt)))} / ${k(mean(rs.map((r) => r.tokens.output)))} | ${rs.map((r) => (r.record.deathsReal ? `${r.record.deathsFound}/${r.record.deathsReal}${r.record.invented ? ` +${r.record.invented} invented` : ''}` : '–')).join(', ')} | ${rs.map((r) => `${r.cited}/${g.losses}`).join(', ')} | ${rs.map((r) => (g.tag === 'ch' ? 'n/a' : pct(r.coverage))).join(', ')} | ${matches(g)} | ${rs.map((r) => `${r.numbered}/${r.cited}`).join(', ')} | ${rs.map((r) => `+${r.filled}, ${r.codeNumbered}`).join('; ')} |`);
}
const all = games.flatMap((g) => g.runs);
L.push('', `Across ${all.length} runs: ${mean(all.map((r) => +r.minutes || 0))?.toFixed(1)} min, ${mean(all.map((r) => r.calls.answered))?.toFixed(1)} calls answered and ${mean(all.map((r) => r.calls.failed))?.toFixed(1)} failed (429/503, retried), ${k(mean(all.map((r) => r.tokens.prompt)))} prompt and ${k(mean(all.map((r) => r.tokens.output)))} output tokens a run, on average.`, '');
if (notesFile && fs.existsSync(notesFile)) L.push(fs.readFileSync(notesFile, 'utf8').trim(), '');
for (const g of games) {
  L.push(`## ${g.game}`, '');
  for (const r of g.runs) {
    L.push(`### Run ${r.run}${r.relearned ? ' (learned the game afresh)' : ''}: ${r.verdict}${r.named ? `, "${r.named}"` : ''}`, '');
    L.push(`${r.minutes ?? '?'} min · ${r.calls.answered} calls answered (${shareLine(r.models)}), ${r.calls.failed} failed${r.flags.length ? ` · flags: ${r.flags.join(', ')}` : ''} · ${k(r.tokens.prompt)} prompt tokens (text ${k(r.tokens.text)}, images ${k(r.tokens.image)}, video ${k(r.tokens.video)}), ${k(r.tokens.output)} output · finish sent back ${r.sentBack} time${r.sentBack === 1 ? '' : 's'} · player learned as ${r.player.learned ? `"${r.player.learned}"` : 'unknown'}${r.player.plays ? `, playing ${r.player.plays}` : ''} · record: ${r.record.kills ?? '?'} kills, ${r.record.deaths ?? '?'} deaths`, '');
    if (r.why) L.push(`> ${r.why.replace(/\n+/g, ' ').slice(0, 600)}`, '');
    L.push('| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline\'s) | Numbers named | By code |', '|---|---|---|---|---|---|---|');
    for (const l of r.losses) L.push(`| ${l.t} ${l.kind} | ${l.baseline.replace(/\|/g, '/').slice(0, 260)} | ${l.cited ? 'yes' : 'no'} | ${l.said.join(' / ').replace(/\|/g, '/').slice(0, 320) || '–'} | ${l.cited ? `${l.named.join(', ') || 'none'} (${l.factors.filter((x) => l.named.includes(x)).length} of ${l.factors.length}: ${l.factors.join(', ')})` : '–'} | ${l.cited ? l.numbers.join(', ').replace(/\|/g, '/') || 'none' : '–'} | ${[l.filledCited ? 'cited only by a filled turning point' : '', l.codeNumbers.length ? `numbers: ${l.codeNumbers.join(', ').replace(/\|/g, '/')}` : ''].filter(Boolean).join('; ') || '–'} |`);
    if (r.looseCites.length) L.push('', `Cited at no real loss: ${r.looseCites.join('; ').slice(0, 400)}`);
    L.push('');
  }
  if (g.shots.length) { L.push('Run 1 in the app, as it went (images kept on this machine only):', ''); for (const s of g.shots) L.push(`![${g.game}: ${path.basename(s, '.png')}](${s})`); L.push(''); }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `${name}.md`), L.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ name, generated: new Date().toISOString(), source: path.basename(dir), games }, null, 1));

// the index: one line per loop
const idx = path.join(OUT, 'README.md'), head = '# Eye Catcher evals\n\nEach loop reviews the test recordings in the desktop app, several times each, and grades every finding against the frame-checked coach baselines (`eval/answer-keys/coach/`). One report per loop, as Markdown with the app\'s screens and as JSON; `ideas-*.md` are the experiments planned before a loop. Screenshots show third-party footage and stay on this machine (`.gitignore`).\n\n| Loop | Games | Runs | Min/run | Calls a run | Prompt tokens a run | Losses cited | Report |\n|---|---|---|---|---|---|---|---|\n';
const rows = (fs.existsSync(idx) ? fs.readFileSync(idx, 'utf8').split('\n').filter((l) => /^\| (?!Loop|---)/.test(l) && !l.includes(`](${name}.md)`)) : []);
const cited = all.reduce((n, r) => n + r.cited, 0), total = games.reduce((n, g) => n + g.losses * g.runs.length, 0);
rows.push(`| ${name} | ${games.map((g) => g.tag).join(' ')} | ${all.length} | ${mean(all.map((r) => +r.minutes || 0))?.toFixed(1)} | ${mean(all.map((r) => r.calls.answered))?.toFixed(1)} | ${k(mean(all.map((r) => r.tokens.prompt)))} | ${cited}/${total} | [${name}](${name}.md) |`);
fs.writeFileSync(idx, head + rows.sort().join('\n') + '\n');
console.log(`wrote tests/evals/${name}.md and .json (${games.length} games, ${all.length} runs)`);
