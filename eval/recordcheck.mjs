// How true a review's record is, against a ground-truth file written off the frames (eval/answer-keys/games): the
// player's deaths and kills found and invented, each goal or point given to the right side and scorer, the losses the
// record holds that really happened, and the finding's evidence moments that sit at a real loss.
//   node eval/recordcheck.mjs <truth.json> <run.json> [more run.json...]
// A run.json is what the review harness saves: { events, evidence, habit, found, finishes }.
import fs from 'node:fs';

const SLACK = 3; // s between a recorded event and the true one
const mmss = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const near = (list, t, slack = SLACK) => list.find((x) => Math.abs(x.t - t) <= slack);

// truth times may be written as M:SS.s
const secs = (v) => { if (typeof v === 'number') return v; const m = String(v).match(/^(\d+):(\d+(?:\.\d+)?)$/); return m ? +m[1] * 60 + +m[2] : +v; };
const timed = (list) => (Array.isArray(list) ? list : []).map((x) => ({ ...x, t: secs(x.t) }));

export function check(truthIn, run) {
  const truth = { ...truthIn, deaths: timed(truthIn.deaths), kills: timed(truthIn.kills), points: timed(truthIn.points) };
  const ev = run.events || [];
  const at = (e) => e.t ?? e.from;
  const out = {};
  // deaths and kills, found and invented
  for (const [key, kind] of [['deaths', 'death'], ['kills', 'kill']]) {
    const said = ev.filter((e) => e.kind === kind), real = truth[key] || [];
    const found = real.filter((r) => said.some((e) => Math.abs(at(e) - r.t) <= SLACK));
    const invented = said.filter((e) => !real.some((r) => Math.abs(at(e) - r.t) <= SLACK) && !(truth.points || []).some((p) => Math.abs(at(e) - p.t) <= 4));
    out[key] = { real: real.length, found: found.length, invented: invented.map((e) => mmss(at(e))) };
  }
  // goals and points: the right side, and whether the player scored it
  if (truth.points.length) {
    const ours = (p) => p.side === truth.side;
    const rows = truth.points.map((p) => {
      const e = ev.filter((x) => ['point_won', 'point_lost', 'kill', 'death'].includes(x.kind) && Math.abs(at(x) - p.t) <= 4).sort((a, b) => Math.abs(at(a) - p.t) - Math.abs(at(b) - p.t))[0];
      const said = !e ? null : e.kind === 'point_won' || e.kind === 'kill' ? 'ours' : 'theirs';
      const scorerRight = e && (p.by_player ? !!e.byPlayer || /you scored/i.test(e.text || '') : !e.byPlayer && !/you scored/i.test(e.text || ''));
      return { t: mmss(p.t), truth: ours(p) ? 'ours' : 'theirs', said, sideRight: said === (ours(p) ? 'ours' : 'theirs'), scorerRight: !!scorerRight };
    });
    out.points = { real: rows.length, recorded: rows.filter((r) => r.said).length, sideRight: rows.filter((r) => r.sideRight).length, scorerRight: rows.filter((r) => r.scorerRight).length, rows };
  }
  // the losses the record holds: real when a true death or a point the other side scored is there
  const trueLosses = [...(truth.deaths || []), ...(truth.points || []).filter((p) => p.side !== truth.side)];
  const lossEvents = ev.filter((e) => e.kind === 'death' || e.kind === 'point_lost' || ((e.kind === 'engagement' || e.kind === 'play') && e.outcome === 'lost'));
  const realAt = (t, from = t, to = t) => trueLosses.some((l) => l.t >= from - 4 && l.t <= to + 4);
  out.losses = { recorded: lossEvents.length, real: lossEvents.filter((e) => realAt(at(e), e.from ?? at(e), e.to ?? at(e))).length, invented: lossEvents.filter((e) => !realAt(at(e), e.from ?? at(e), e.to ?? at(e))).map((e) => `${mmss(at(e))} ${e.kind}`) };
  // the finding's evidence moments at a real loss (6 s before it to 2 s after)
  const evidence = run.found ? run.evidence || [] : [];
  out.evidence = { cited: evidence.length, atRealLoss: evidence.filter((t) => trueLosses.some((l) => t >= l.t - 8 && t <= l.t + 2)).length, away: evidence.filter((t) => !trueLosses.some((l) => t >= l.t - 8 && t <= l.t + 2)).map(mmss) };
  out.habit = run.found ? run.habit : 'none';
  return out;
}

export function line(name, r) {
  const parts = [`${name}: habit ${r.habit}`];
  for (const k of ['deaths', 'kills']) if (r[k].real || r[k].invented.length) parts.push(`${k} ${r[k].found}/${r[k].real} found${r[k].invented.length ? `, invented ${r[k].invented.join(' ')}` : ''}`);
  if (r.points) parts.push(`points ${r.points.recorded}/${r.points.real} recorded, side right ${r.points.sideRight}, scorer right ${r.points.scorerRight}`);
  parts.push(`losses ${r.losses.real}/${r.losses.recorded} real${r.losses.invented.length ? ` (invented ${r.losses.invented.join(', ')})` : ''}`);
  if (r.evidence.cited) parts.push(`evidence at a real loss ${r.evidence.atRealLoss}/${r.evidence.cited}${r.evidence.away.length ? ` (away: ${r.evidence.away.join(' ')})` : ''}`);
  return parts.join(' | ');
}

if (process.argv[1] && process.argv[1].endsWith('recordcheck.mjs')) {
  const [truthFile, ...runs] = process.argv.slice(2);
  const truth = JSON.parse(fs.readFileSync(truthFile, 'utf8'));
  for (const f of runs) console.log(line(f.split('/').slice(-2).join('/'), check(truth, JSON.parse(fs.readFileSync(f, 'utf8')))));
}
