// Thirdeye core: time, aim geometry, the budget, the evidence check, the theory board, events, and history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../core.js');

const FRAME = { w: 1920, h: 1080 };
const FULL = { x: 0, y: 0, w: 1920, h: 1080 };
// a head box in Gemini's 0-1000 format for a head centered at (cx, cy) frame pixels, size px tall, inside crop
const headBox = (cx, cy, px, crop = FULL) => [(cy - px / 2 - crop.y) / crop.h * 1000, (cx - px / 2 - crop.x) / crop.w * 1000, (cy + px / 2 - crop.y) / crop.h * 1000, (cx + px / 2 - crop.x) / crop.w * 1000];

test('times read and write as M:SS', () => {
  assert.equal(C.mmss(0), '0:00');
  assert.equal(C.mmss(761.9), '12:41');
  assert.equal(C.mmss(59.96, true), '1:00.0');
  assert.equal(C.mmss(5.25, true), '0:05.3');
  assert.equal(C.parseTime('12:41'), 761);
  assert.equal(C.parseTime('12:41.5'), 761.5);
  assert.equal(C.parseTime('1:02:03'), 3723);
  assert.equal(C.parseTime('42s'), 42);
  assert.equal(C.parseTime(7.5), 7.5);
  assert.ok(Number.isNaN(C.parseTime('12:75')));
  assert.ok(Number.isNaN(C.parseTime('soon')));
});

test('a head on the crosshair measures zero', () => {
  const a = C.aimOffset({ box: headBox(960, 540, 20), crop: FULL, frame: FRAME, fovH: 103 });
  assert.equal(a.heads, 0);
  assert.equal(a.dyDeg, 0);
  assert.equal(a.dxDeg, 0);
  assert.equal(a.band, 'head');
});

test('a head 40 px above the crosshair is two heads high and about 3 degrees at 103 FOV', () => {
  const a = C.aimOffset({ box: headBox(960, 500, 20), crop: FULL, frame: FRAME, fovH: 103 });
  assert.equal(a.heads, 2);
  assert.equal(a.band, 'chest');
  // focal length 960 / tan(51.5 deg) = 763.6 px, and atan(40 / 763.6) = 3.0 deg
  assert.ok(Math.abs(a.dyDeg - 3.0) < 0.01, `dyDeg ${a.dyDeg}`);
  assert.equal(a.headPx, 20);
});

test('a box drawn on a center crop gives the same answer as on the full frame', () => {
  const crop = { x: 576, y: 270, w: 768, h: 540 };
  const full = C.aimOffset({ box: headBox(1010, 470, 18), crop: FULL, frame: FRAME, fovH: 103 });
  const cropped = C.aimOffset({ box: headBox(1010, 470, 18, crop), crop, frame: FRAME, fovH: 103 });
  assert.deepEqual(cropped, full);
  assert.ok(full.dxDeg > 0, 'head right of the crosshair is positive');
  assert.equal(full.band, 'low');
});

test('a crosshair above the head is negative and banded above', () => {
  const a = C.aimOffset({ box: headBox(960, 600, 20), crop: FULL, frame: FRAME, fovH: 103 });
  assert.equal(a.heads, -3);
  assert.ok(a.dyDeg < 0);
  assert.equal(a.band, 'above');
});

test('bad head boxes are refused, tiny ones flagged', () => {
  assert.throws(() => C.aimOffset({ box: [1, 2, 3], crop: FULL, frame: FRAME, fovH: 103 }), /four numbers/);
  assert.throws(() => C.aimOffset({ box: [500, 500, 400, 600], crop: FULL, frame: FRAME, fovH: 103 }), /empty/);
  assert.equal(C.aimOffset({ box: headBox(960, 530, 4), crop: FULL, frame: FRAME, fovH: 103 }).small, true);
});

test('aim summaries use the median and describe it in words', () => {
  const s = C.summarizeAim([{ heads: 2, dyDeg: 3, band: 'chest' }, { heads: 2.4, dyDeg: 2, band: 'chest' }, { heads: 0.2, dyDeg: 0.3, band: 'head' }, { heads: NaN }]);
  assert.deepEqual(s, { n: 3, heads: 2, dyDeg: 2, atHead: 1, bands: { chest: 2, head: 1 } });
  assert.equal(C.aimText(s), 'Crosshair 2.0 heads below the head');
  assert.equal(C.aimText({ heads: -1 }), 'Crosshair 1.0 head above the head');
  assert.equal(C.aimText({ heads: 0.3 }), 'Crosshair at head level');
  assert.equal(C.summarizeAim([]), null);
});

test('the budget counts looks and refuses the one past the limit', () => {
  const b = C.createBudget({ looks: 2, turns: 5 });
  C.spend(b, 'looks'); C.spend(b, 'looks'); C.spend(b, 'turns');
  assert.throws(() => C.spend(b, 'looks'), C.BudgetError);
  assert.equal(C.budgetLine(b), '0 of 2 looks and 4 of 5 turns left');
});

const looked = () => {
  const l = C.createLedger();
  for (const t of [10, 40, 70]) C.recordLook(l, { from: t, to: t + 1, kind: 'frames' });
  return l;
};
const good = {
  habit: 'Crosshair low', habit_id: 'crosshair_low', why: 'You aimed at chest height when enemies appeared, so you lost the first shot.',
  drill: 'Ten minutes in the Range walking corners with the crosshair at head height.', recheck: 'Measure first sight in five duels.',
  evidence: [{ t: '0:10', what: 'Enemy appears above the crosshair' }, { t: '0:40.5', what: 'Same at B main' }, { t: '1:11', what: 'Lost to a head shot' }],
};
const HABITS = [{ id: 'crosshair_low' }, { id: 'wide_peek' }];

test('finish stands when every moment was looked at', () => {
  assert.deepEqual(C.checkFinish(good, { ledger: looked(), duration: 120, habits: HABITS }), []);
});

test('finish is sent back for unseen, repeated, too few, or made-up moments', () => {
  const p = C.checkFinish({ ...good, evidence: [{ t: '0:10', what: 'a' }, { t: '0:11', what: 'b' }, { t: '0:55', what: 'c' }, { t: '9:00', what: 'd' }] }, { ledger: looked(), duration: 120, habits: HABITS });
  assert.ok(p.some((x) => /same moment as other evidence/.test(x)));
  assert.ok(p.some((x) => /haven't looked closely at 0:55/.test(x)));
  assert.ok(p.some((x) => /9:00 isn't a time/.test(x)));
  assert.ok(p.some((x) => /at least 3 separate moments you looked at \(you have 1\)/.test(x)));
});

test('finish needs a known habit id, a drill, and a recheck', () => {
  const p = C.checkFinish({ ...good, habit_id: 'made_up', drill: 'aim better', recheck: '' }, { ledger: looked(), duration: 120, habits: HABITS });
  assert.ok(p.some((x) => /habit_id must be one of: crosshair_low, wide_peek, other/.test(x)));
  assert.ok(p.some((x) => /drill/.test(x)));
  assert.ok(p.some((x) => /recheck/.test(x)));
});

test('finding no single habit is allowed with a reason', () => {
  assert.deepEqual(C.checkFinish({ found: false, why: 'Your deaths had different causes and none repeated.' }, { ledger: C.createLedger() }), []);
  assert.equal(C.checkFinish({ found: false, why: 'none' }, { ledger: C.createLedger() }).length, 1);
});

test('the theory board adds, updates by id or text, and records a change of mind', () => {
  let r = C.applyNote([], { theory: 'Crosshair is low', status: 'testing', evidence: [{ t: '0:10', what: 'chest height' }] });
  assert.equal(r.change, 'new');
  assert.equal(r.theory.id, 'T1');
  r = C.applyNote(r.board, { id: 'T1', status: 'dropped', evidence: [{ t: '0:40', what: 'head height here' }] });
  assert.equal(r.change, 'dropped');
  assert.deepEqual(r.theory.history, ['testing', 'dropped']);
  assert.equal(r.theory.evidence.length, 2);
  r = C.applyNote(r.board, { theory: 'crosshair IS low!', status: 'dropped' });
  assert.equal(r.change, 'updated');
  assert.equal(r.board.length, 1);
  assert.throws(() => C.applyNote([], { theory: 'x', status: 'maybe' }), /status must be one of/);
  assert.throws(() => C.applyNote([], { id: 'T9', status: 'testing' }), /No theory T9/);
  assert.equal(C.boardBrief(r.board), 'T1 dropped: Crosshair is low (0:10, 0:40)');
});

test('scan events are cleaned, deduped, and shifted when timed from the clip start', () => {
  const raw = [{ t: '0:12', kind: 'death', text: 'Killed by Jett' }, { t: '0:13', kind: 'death' }, { t: '1:40', kind: 'kill' }, { t: 'x', kind: 'kill' }, { t: '2:00', kind: 'party' }];
  const e = C.normalizeEvents(raw, { from: 600, to: 900 });
  assert.deepEqual(e.map((x) => [x.t, x.kind]), [[612, 'death'], [700, 'kill'], [720, 'other']]);
  const kept = C.normalizeEvents([{ t: '10:12', kind: 'death' }, { t: '20:00', kind: 'kill' }], { from: 600, to: 900 });
  assert.deepEqual(kept.map((x) => x.t), [612], 'already in match time, and out-of-range events dropped');
  assert.equal(C.eventsBrief(e.slice(0, 1)), '10:12 death: Killed by Jett');
});

test('a look spreads at most 12 frames inside the video', () => {
  assert.deepEqual(C.framePlan({ t: 10, before: 1, after: 0.5, fps: 6, duration: 100 }), [9, 9.167, 9.333, 9.5, 9.667, 9.833, 10, 10.167, 10.333, 10.5]);
  assert.equal(C.framePlan({ t: 50, before: 5, after: 5, fps: 30, duration: 100 }).length, C.MAX_FRAMES);
  assert.deepEqual(C.framePlan({ t: 0.5, before: 1, after: 0, fps: 4, duration: 100 }), [0, 0.25, 0.5]);
  assert.deepEqual(C.framePlan({ t: 100.5, before: 0, after: 0, duration: 100 }), [99.95]);
});

test('regions come from the game profile in frame pixels', () => {
  const profile = { regions: { killfeed: [0.75, 0.08, 0.24, 0.22] } };
  assert.deepEqual(C.regionRect(profile, 'killfeed', FRAME), { x: 1440, y: 86, w: 461, h: 238 });
  assert.deepEqual(C.regionRect(profile, 'full', FRAME), FULL);
  assert.throws(() => C.regionRect(profile, 'radar', FRAME), /Use full or one of: killfeed/);
});

test('history keeps the accepted habit and compares the next match to its baseline', () => {
  let h = C.emptyHistory();
  const m = { id: 'm1', date: '2026-10-16', found: true, habit: 'Crosshair low', habitId: 'crosshair_low', drill: 'd', recheck: 'r', aim: { n: 7, heads: 2.1 } };
  h = C.acceptHabit(C.addMatch(h, m), m);
  assert.equal(h.habit.baseline.heads, 2.1);
  assert.match(C.historyBrief(h), /Working on: Crosshair low \(habit_id crosshair_low\), since 2026-10-16\.\nBaseline: Crosshair 2\.1 heads below the head, median of 7 duels\./);
  assert.equal(C.compareAim(h.habit.baseline, { n: 5, heads: 1.2 }), 'better');
  assert.equal(C.compareAim(h.habit.baseline, { n: 5, heads: 2.3 }), 'same');
  assert.equal(C.compareAim(h.habit.baseline, { n: 5, heads: -2.8 }), 'worse');
  assert.equal(C.compareAim(h.habit.baseline, { n: 2, heads: 0 }), null);
  assert.equal(C.historyBrief(C.emptyHistory()), 'First review for this player.');
});
