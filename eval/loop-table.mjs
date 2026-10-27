// The loop-by-loop table in the README, from each loop's scorecard (tests/evals/loop-N.scorecard.json, written by
// eval/scorecard.mjs): what each loop found, critiqued, explained right, and invented, against the targets.
//   node eval/loop-table.mjs           prints the table
//   node eval/loop-table.mjs --write   writes it into README.md between its loop-table markers
//   --loops 40,41,46                    only those loops
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dir = path.join(root, 'tests/evals');
const cards = fs.readdirSync(dir).map((f) => /^loop-(\d+)\.scorecard\.json$/.exec(f)).filter(Boolean).map((m) => ({ n: +m[1], card: JSON.parse(fs.readFileSync(path.join(dir, m[0]), 'utf8')) })).sort((a, b) => a.n - b.n)
  .filter(({ n }) => { const i = process.argv.indexOf('--loops'); return i < 0 || String(process.argv[i + 1] || '').split(',').map(Number).includes(n); });

const pct = (n, d) => (d ? `${n} of ${d} (${Math.round((100 * n) / d)}%)` : '–');
const row = ({ n, card }) => {
  const r = card.all?.rows || {}, c = card.all?.cost || {}, games = Object.keys(card.games || {}).filter((g) => card.games[g]?.cost?.valid).length;
  const found = r.found || {}, missed = r.missed || {}, right = r.right || {}, inv = r.invented || {}, caught = r.caught || {};
  // the scorecard counts the losses cited (cited), or, in older cards, the ones not cited (missed)
  const critiqued = r.cited?.d ? r.cited : missed.d ? { n: missed.d - missed.n, d: missed.d } : null;
  // graded at all (older cards count right of every baseline loss, newer ones of the losses cited)
  const rightAll = right.d ? { n: right.n, d: Math.max(right.d, found.d || 0) } : null;
  // and of the losses it cited alone: how good the critiques it gave were, apart from how many it gave
  const ofCited = right.d && critiqued?.n ? pct(right.n, critiqued.n) : 'not graded';
  return `| ${n} | ${games} (${c.valid ?? '?'} runs) | ${pct(found.n, found.d)} | ${critiqued ? pct(critiqued.n, critiqued.d) : 'not counted'} | ${card.graded === false || !rightAll ? 'not graded' : ofCited} | ${pct(inv.n, inv.d)} | ${caught.d ? pct(caught.n, caught.d) : 'not graded'} | ${c.answered != null ? (+c.answered).toFixed(1) : '–'} | ${c.prompt ? `${Math.round(c.prompt / 1000)}k` : '–'} |`;
};
const table = [
  '| Loop | Games (valid runs) | Losses found in the record ↑ | Losses critiqued ↑ | Explained right, of those critiqued ↑ | Deaths and points invented ↓ | False claims caught ↑ | Calls a run | Prompt tokens a run |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  '| **Target** | all 9 | **80%+** | **every loss** | **80%+** | **0** | | | |',
  ...cards.map(row),
].join('\n');

if (process.argv.includes('--write')) {
  const file = path.join(root, 'README.md'), md = fs.readFileSync(file, 'utf8');
  const a = md.indexOf('<!-- loop-table -->'), b = md.indexOf('<!-- /loop-table -->');
  if (a < 0 || b < a) throw new Error('loop-table: README.md has no <!-- loop-table --> ... <!-- /loop-table --> markers');
  fs.writeFileSync(file, `${md.slice(0, a)}<!-- loop-table -->\n${table}\n${md.slice(b)}`);
  console.log(`README.md: ${cards.length} loops`);
} else console.log(table);
