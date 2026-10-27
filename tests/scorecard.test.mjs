// The scorecard (eval/scorecard.mjs): each row's rule on small runs made up for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../eval/scorecard.mjs';

const ok = (n) => Array.from({ length: n }, () => ({ status: 200 }));
const clip = {
  clip: 'league-of-legends/x.mp4', ids: { player: ['xHACKLETx'], character: ['Miss Fortune'] },
  losses: [
    { t: '1:48', kind: 'death', decided: '1:36-1:44', factors: { resources: 'health 617-621 of 1479 (42%) at 1:43-1:45; Flash on cooldown (3:55 left at 1:40)' } },
    { t: '4:30', kind: 'near_death (280 of 1589)', decided: '4:21-4:27', factors: {} },
    { t: '8:56', kind: 'death', decided: '8:44-8:53', factors: {} },
  ],
};
const run = (over = {}) => ({
  usage: { timeline: ok(20), prompt: 200000, output: 30000 }, minutes: 5, why: 'done', finishes: [{}],
  player: 'xHACKLETx', character: 'Miss Fortune',
  events: [{ t: 108, kind: 'death' }, { t: 270.5, kind: 'near_death' }, { t: 400, kind: 'death' }, { t: 500, kind: 'point_lost' }],
  final: { evidence: [{ t: '1:45', what: 'stayed in lane after the retreat pings', because: 'health 271 of 1479 and Flash down, 3:55 left' }, { t: '6:00', what: 'farmed alone' }] },
  ...over,
});

test('who they are: a name the key accepts, its letters and digits, or one inside the other', () => {
  assert.ok(S.sameName('PANDA YT', 'PANDA YT™') && S.sameName('TheSomey', 'THESOMEY') && S.sameName('Me', 'me'));
  assert.ok(!S.sameName('TAVUKSEVEN', 'YOU') && !S.sameName('', 'YOU') && !S.sameName('Mel', 'Me'));
  // a teammate's name is named wrong; no name at all is not named, and counts in neither
  const r = S.scoreRun(run({ player: 'TAVUKSEVEN', character: null }), clip);
  assert.deepEqual([r.rows.player, r.rows.otherPlayer, r.rows.character], [{ n: 0, d: 1 }, { n: 1, d: 1 }, { n: 0, d: 1 }]);
  const none = S.scoreRun(run({ player: null, learned: {} }), clip);
  assert.deepEqual([none.rows.player, none.rows.otherPlayer], [{ n: 0, d: 1 }, { n: 0, d: 0 }]);
});

test('a run with more calls refused than answered, or no result, is void and counts nowhere', () => {
  assert.ok(S.isVoid(run({ usage: { timeline: [...ok(5), ...Array(6).fill({ status: 503 })] } })));
  assert.ok(S.isVoid(run({ why: '', finishes: [], final: {} })));
  assert.ok(!S.isVoid(run()));
  const r = S.scoreRun(run({ finishes: [], why: '' }), clip);
  assert.ok(r.void && Object.values(r.rows).every((x) => x.d === 0));
});

test('the record: a loss is found by an event of its kind within 5 s; a death or point with no loss there is invented', () => {
  const r = S.scoreRun(run(), clip);
  assert.deepEqual(r.losses.map((l) => l.found), [true, true, false]); // 8:56 has no death near it (400 s is 6:40)
  assert.deepEqual(r.rows.found, { n: 2, d: 3 });
  // the death at 6:40; the point lost at 8:20 isn't counted, since this key lists no points (a team's turret in League)
  assert.deepEqual(r.rows.invented, { n: 1, d: 2 });
  const goals = { ...clip, losses: [...clip.losses, { t: '9:30', kind: 'point_lost (a goal against)' }] };
  assert.deepEqual(S.scoreRun(run(), goals).rows.invented, { n: 2, d: 3 });
  // a near-death the record calls a death is an invented death, and doesn't find the near-death
  const d = S.scoreRun(run({ events: [{ t: 270, kind: 'death' }] }), clip);
  assert.deepEqual([d.rows.found, d.rows.invented], [{ n: 0, d: 3 }, { n: 1, d: 1 }]);
});

test('chess: a mistake is found only as the same move, graded a mistake', () => {
  const chess = { clip: 'chess/x.mp4', ids: { player: ['VasuGmR'] }, losses: [{ t: '5:05', kind: 'mistake 15.Bc3 (211 at depth 20)' }] };
  const found = (events) => S.scoreRun(run({ player: 'VasuGmR', events }), chess).rows.found.n;
  assert.equal(found([{ t: 305, kind: 'move', text: '15. Bc3 (mistake: gave away 2.1 pawns)' }]), 1);
  assert.equal(found([{ t: 305, kind: 'move', text: '15. Bc3' }]), 0); // not graded a mistake
  assert.equal(found([{ t: 304, kind: 'move', text: '15... Nf6 (blunder: gave away 3 pawns)' }]), 0); // another move
});

test("numbers: code's parse is the grader's starting list; the row counts the grader's right and wrong", () => {
  const { right, wrong } = S.numbersChecked('health 271 of 1479, Flash on cooldown, 3:55 left, 2 enemies', clip.losses[0].factors);
  assert.deepEqual([right, wrong], [['3:55 left'], ['271 of 1479']]); // "2 enemies" has nothing in the baseline to hold it to
  assert.deepEqual(S.scoreRun(run(), clip).rows.numbers, { n: 0, d: 0 }); // not graded: empty
  const g = { losses: { '1:48': { grade: 'partly', numbers: { right: ['3:55 left'], wrong: ['271 of 1479'], unclear: ['2 enemies'] } } } };
  assert.deepEqual(S.scoreRun(run(), clip, g).rows.numbers, { n: 1, d: 2 });
});

test('claims: coverage of the losses, then right, partly, and wrong as shares of the losses cited', () => {
  const grade = { losses: { '1:48': { grade: 'partly' } }, outside: [{ t: '6:00', really: 'none' }], sent_back: [{ really: 'false' }, { really: 'true' }, { really: 'unclear' }] };
  const r = S.scoreRun(run(), clip, grade);
  assert.deepEqual(r.rows.cited, { n: 1, d: 3 });
  assert.deepEqual(['right', 'partly', 'wrong'].map((k) => r.rows[k]), [{ n: 0, d: 1 }, { n: 1, d: 1 }, { n: 0, d: 1 }]);
  assert.deepEqual(r.rows.nothing, { n: 1, d: 2 }); // 6:00, of the two cites
  // the checker: one false claim caught; with no loss graded wrong, none got past it; one true claim sent back of two judged
  assert.deepEqual([r.rows.caught, r.rows.wrongly], [{ n: 1, d: 1 }, { n: 1, d: 2 }]);
  // a cite outside the key at a real loss it doesn't list isn't counted against the finding
  assert.deepEqual(S.scoreRun(run(), clip, { ...grade, outside: [{ t: '6:00', really: 'loss' }] }).rows.nothing, { n: 0, d: 2 });
  // a cited loss or an outside cite with no grade is flagged, and counts in no graded row
  const u = S.scoreRun(run(), clip, { losses: {} });
  assert.equal(u.ungraded, 2);
  assert.deepEqual(u.rows.right, { n: 0, d: 1 });
  // a claim shown twice, as a fix and as a turning point, word for word, is one cite
  const twice = run({ final: { evidence: [{ t: '1:45', what: 'stayed in lane' }], turning: [{ t: '1:45', what: 'stayed in lane' }] } });
  assert.equal(S.citesOf(twice).length, 1);
});

test('comparing two loops counts only the games valid in both', () => {
  const card = (tag, n, valid = 1) => ({ name: tag, graded: true, games: [{ tag: 'lol', cost: { valid }, rows: { ...Object.fromEntries(S.ROWS.map(([, k]) => [k, { n: 0, d: 0 }])), found: { n, d: 3 } } }, { tag: 'rl', cost: { valid: tag === 'a' ? 1 : 0 }, rows: { ...Object.fromEntries(S.ROWS.map(([, k]) => [k, { n: 0, d: 0 }])), found: { n: 1, d: 1 } } }] });
  const md = S.compare(card('a', 1), card('b', 3));
  assert.match(md, /Same games in both: LoL\./);
  assert.match(md, /Losses found in the record ↑ \| 1\/3 \(33%\) \| 3\/3 \(100%\) \| \+67 pts better \|/);
});
