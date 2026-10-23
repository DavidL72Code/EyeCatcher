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
const HABITS = [{ id: 'crosshair_low', measuredBy: 'aim' }, { id: 'wide_peek' }];

const LOW = [{ t: 10.2, heads: 2.1 }, { t: 40.5, heads: 1.8 }, { t: 70.3, heads: 2.4 }];

test('finish stands when every moment was looked at', () => {
  assert.deepEqual(C.checkFinish(good, { ledger: looked(), duration: 120, habits: HABITS, measures: LOW }), []);
});

test('finish is sent back for unseen, repeated, too few, or made-up moments', () => {
  const p = C.checkFinish({ ...good, evidence: [{ t: '0:10', what: 'a' }, { t: '0:11', what: 'b' }, { t: '0:55', what: 'c' }, { t: '9:00', what: 'd' }] }, { ledger: looked(), duration: 120, habits: HABITS });
  assert.ok(p.some((x) => /same moment as other evidence/.test(x)));
  assert.ok(p.some((x) => /haven't looked closely at 0:55/.test(x)));
  assert.ok(p.some((x) => /9:00 isn't a time/.test(x)));
  assert.ok(p.some((x) => /at least 3 separate moments you looked at that show the habit \(you have 1\)\. Moments where they got it right go in contrast.*finish with found false/.test(x)));
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
  const ledger = C.recordLook(C.createLedger(), { from: 39, to: 41, kind: 'frames' });
  const hunch = C.applyNote([], { theory: 'Crosshair is low', status: 'supported', evidence: [{ t: '1:10', what: 'never looked' }] }, { ledger });
  assert.equal(hunch.theory.status, 'testing', 'a hunch is not supported');
  assert.match(hunch.problem, /stays testing: none of its moments were looked at closely/);
  const backed = C.applyNote(hunch.board, { id: 'T1', status: 'supported', evidence: [{ t: '0:40', what: 'chest height' }] }, { ledger });
  assert.equal(backed.theory.status, 'supported');
  assert.equal(backed.problem, undefined);
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

test('a clip look watches the run-up, inside the video, at least a second long', () => {
  // the coach's default: 6 s before to 1 s after at 6 frames a second (Apex at 4:30 is 4:24 to 4:31)
  assert.deepEqual(C.clipPlan({ t: 270, duration: 400 }), { t: 270, from: 264, to: 271, fps: 6 });
  // what the model asks for is held to the clip's limits; a missing value is the default, not 0
  // a long run-up (to see the decision a fight was lost on) is sampled thinly, a short look keeps its rate
  assert.deepEqual(C.clipPlan({ t: 60, before: 30, after: 9, fps: 30, duration: 400 }), { t: 60, from: 60 - C.CLIP_LOOK.maxBefore, to: 60 + C.CLIP_LOOK.maxAfter, fps: 3 });
  assert.deepEqual(C.clipPlan({ t: 60, before: 3, after: 1, fps: 30, duration: 400 }), { t: 60, from: 57, to: 61, fps: 8 });
  assert.deepEqual(C.clipPlan({ t: 60, before: undefined, after: null, fps: 'x', duration: 400 }), { t: 60, from: 54, to: 61, fps: 6 });
  // at the start and the end of the video
  assert.deepEqual(C.clipPlan({ t: 2, duration: 400 }), { t: 2, from: 0, to: 3, fps: 6 });
  assert.deepEqual(C.clipPlan({ t: 60, after: 7, maxAfter: 8, duration: 400 }), { t: 60, from: 54, to: 67, fps: 6 });
  // a claim's check runs to the end of the fight its moment falls in, 3 to 8 s after it
  const fights = [{ t: 103, kind: 'engagement', from: 103, to: 109 }, { t: 108, kind: 'death' }, { t: 300, kind: 'engagement', from: 290, to: 330 }];
  assert.equal(C.claimAfter(fights, 103), 7);
  assert.equal(C.claimAfter(fights, 108.5), 3);
  assert.equal(C.claimAfter(fights, 200), 3);
  assert.equal(C.claimAfter(fights, 295), 8);
  assert.deepEqual(C.clipPlan({ t: 399.5, before: 0, after: 0, duration: 400 }), { t: 399.5, from: 398.95, to: 399.95, fps: 6 });
});

test('regions come from the game profile in frame pixels', () => {
  const profile = { regions: { killfeed: [0.75, 0.08, 0.24, 0.22] } };
  assert.deepEqual(C.regionRect(profile, 'killfeed', FRAME), { x: 1440, y: 86, w: 461, h: 238 });
  assert.deepEqual(C.regionRect(profile, 'full', FRAME), FULL);
  assert.throws(() => C.regionRect(profile, 'radar', FRAME), /Use full or one of: killfeed/);
});

test('a readout box thin as a bar grows about its middle to hold the number above it', () => {
  // Marvel Rivals' health box held the bar (y 0.929-0.948), the 32/250 sat at y 0.90-0.925
  const [x, y, w, h] = C.readoutRegion([0.375, 0.929, 0.251, 0.019]);
  assert.deepEqual([x, w, h], [0.375, 0.251, C.READOUT_H]);
  assert.ok(y < 0.905 && y + h > 0.948);
  assert.deepEqual(C.readoutRegion([0.1, 0.02, 0.3, 0.09]), [0.1, 0.02, 0.3, 0.09]);
  assert.deepEqual(C.readoutRegion([0.4, 0.99, 0.1, 0.01]), [0.4, 0.93, 0.1, 0.07]);
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

test('an aim habit has to agree with the aim the coach measured, by where good players aim in the game', () => {
  const atHead = [{ t: 10.2, heads: 0.1 }, { t: 40.5, heads: -0.2 }, { t: 70.3, heads: 0.3 }];
  const p = C.checkFinish(good, { ledger: looked(), duration: 120, habits: HABITS, measures: atHead });
  assert.ok(p.some((x) => /put the crosshair on the head, where good players in this game aim \(median 0\.1 heads below the head over 3 fights\)/.test(x)));
  assert.ok(p.some((x) => /At 0:10 you measured the crosshair on the head \(0\.1 heads below the head\)/.test(x)));
  // where good players aim at the body (Apex), two heads down is the chest: right, not low
  const body = C.checkFinish(good, { ledger: looked(), duration: 120, habits: HABITS, measures: LOW, aimTarget: 'body' });
  assert.ok(body.some((x) => /on the body, where good players in this game aim \(median 2\.1 heads below the head/.test(x)), 'chest aim is right in a body-aim game');
  assert.deepEqual(C.checkFinish(good, { ledger: looked(), duration: 120, habits: HABITS, measures: LOW.map((m) => ({ ...m, heads: m.heads + 2.5 })), aimTarget: 'body' }), [], 'below the waist is low even there');
  assert.deepEqual(C.checkFinish(good, { ledger: looked(), duration: 120, habits: HABITS, measures: LOW }), []);
  const eyeballed = C.checkFinish(good, { ledger: looked(), duration: 120, habits: HABITS, measures: [{ t: 10.2, heads: 2.1 }] });
  assert.ok(eyeballed.some((x) => /at least 3 measure_aim readings where an enemy was in view \(you have 1\)/.test(x)), 'a measurable habit needs measurements');
  assert.deepEqual(C.checkFinish({ ...good, habit_id: 'wide_peek' }, { ledger: looked(), duration: 120, habits: HABITS, measures: atHead }), [], 'other habits are not judged by aim');
});

test('a head box has to sit at the top of a body box', () => {
  const body = [400, 450, 900, 550];
  assert.equal(C.headOnBody([400, 480, 460, 520], body), true);
  assert.equal(C.headOnBody([700, 480, 760, 520], body), false, 'a "head" at the waist');
  assert.equal(C.headOnBody([400, 700, 460, 740], body), false, 'a "head" beside the body');
  assert.equal(C.headOnBody([400, 480, 460, 520], undefined), false, 'no body, no head');
});

test('the aim is measured on an enemy: never a teammate under a name tag, nor a head whose tag would be out of view', () => {
  // Apex at 5:55.5 (Oct 22), as Gemini boxed it: O5HK with no name_tag and not called a teammate, under the tag "◆ O5HK",
  // and FYR_rLayze jumping into view, his tag above the top of the picture
  const o5hk = { head_2d: [222, 290, 277, 331], body_2d: [223, 279, 611, 440], name_tag: '', teammate: false };
  const fyr = { head_2d: [10, 545, 85, 615], body_2d: [0, 472, 584, 668], name_tag: '', teammate: false };
  const tags = [{ text: '◆ O5HK', box_2d: [158, 256, 187, 340] }];
  assert.equal(C.enemyHead([o5hk, fyr], tags), null, 'two teammates and no enemy: no head');
  assert.deepEqual(C.enemyHead([o5hk], []), o5hk.head_2d, 'without the tag box nothing marks O5HK');
  const enemy = { head_2d: [470, 600, 520, 640], body_2d: [460, 580, 800, 660], name_tag: '', teammate: false };
  assert.deepEqual(C.enemyHead([o5hk, fyr, enemy], tags), enemy.head_2d, 'the enemy is measured');
  assert.equal(C.enemyHead([{ ...enemy, name_tag: 'Teammate' }], []), null, 'a player read with a name tag is left out');
  assert.equal(C.enemyHead([{ ...enemy, teammate: true }], []), null, 'and one called a teammate, by an outline or an icon');
  assert.deepEqual(C.enemyHead([enemy], [{ text: '27', box_2d: [430, 600, 460, 630] }]), enemy.head_2d, 'a damage number over an enemy is no name tag');
  assert.deepEqual(C.enemyHead([{ ...enemy, name_tag: '42' }], []), enemy.head_2d, 'not even read as their name_tag');
  const nearer = { head_2d: [480, 490, 520, 520], body_2d: [470, 470, 800, 540], name_tag: '', teammate: false };
  assert.deepEqual(C.enemyHead([enemy, nearer], []), nearer.head_2d, 'the enemy nearest the crosshair');
});

test('moments they got right go in contrast, never in both lists', () => {
  const ledger = C.recordLook(looked(), { from: 100, to: 101, kind: 'frames' });
  const ok = C.checkFinish({ ...good, contrast: [{ t: '1:40.5', what: 'On the head and won' }] }, { ledger, duration: 120, habits: HABITS, measures: LOW });
  assert.deepEqual(ok, []);
  const both = C.checkFinish({ ...good, contrast: [{ t: '0:40.5', what: 'won this one' }, { t: '1:45', what: 'never looked' }] }, { ledger: looked(), duration: 120, habits: HABITS });
  assert.ok(both.some((x) => /0:40 is in both evidence and contrast/.test(x)));
  assert.ok(both.some((x) => /haven't looked closely at 1:45 \(in contrast\)/.test(x)));
});

// a fake kill-feed crop: rows of team-colored bars, killer side then victim side
// the team colors a learned profile would have for the synthetic rows below: teal for the player's team, red for the other
const TEST_COLORS = { ally: [140, 190], enemy: [340, 12] };
function feedImage(rows, w = 360, h = 120) {
  const data = new Uint8ClampedArray(w * h * 4).fill(60);
  const paint = (x0, x1, y0, y1, [r, g, b]) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; } };
  const TEAL = [80, 200, 170], RED = [225, 75, 85], YELLOW = [235, 205, 60];
  for (const { y, left, right, yellow, shade = 0, victim = 3 } of rows) {
    if (yellow) paint(96, 99, y - 2, y + 22, YELLOW);
    paint(100, 220, y, y + 20, left === 'ally' ? TEAL : RED);
    paint(221, 340, y, y + 20, right === 'ally' ? TEAL : RED);
    // names, drawn as thin strokes like text
    for (let x = 110; x <= 160; x += 3) paint(x, x, y + 6, y + 14, [225 + shade / 2, 225 + shade / 2, 225 + shade / 2]);
    for (let x = 270; x <= 330; x += victim) paint(x, x, y + 6, y + 14, [235, 235, 235]); // victim: the stroke spacing, a different name
  }
  return { data, width: w, height: h };
}

test('kill-feed rows and their team colors come from pixels', () => {
  const rows = C.killfeedRows(feedImage([{ y: 10, left: 'ally', right: 'enemy', yellow: true }, { y: 36, left: 'enemy', right: 'ally' }]), { colors: TEST_COLORS });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.left, r.right]), [['ally', 'enemy'], ['enemy', 'ally']]);
  assert.deepEqual(C.killfeedRows(feedImage([]), { colors: TEST_COLORS }), []);
  assert.deepEqual(C.killfeedRows(feedImage([{ y: 10, left: 'ally', right: 'enemy' }])), [], 'no colors learned, no rows');
  const touching = C.killfeedRows(feedImage([{ y: 10, left: 'ally', right: 'enemy' }, { y: 31, left: 'enemy', right: 'ally' }, { y: 60, left: 'ally', right: 'ally' }]), { colors: TEST_COLORS });
  assert.equal(touching.length, 3, 'two rows that touch are split apart');
});

test("on the game's grid, a row is a slot that's mostly team color", () => {
  const img = feedImage([{ y: 10, left: 'ally', right: 'enemy' }, { y: 36, left: 'enemy', right: 'ally' }]);
  const { data, width } = img;
  for (let y = 66; y <= 84; y++) for (let x = 20; x <= 160; x++) { const i = (y * width + x) * 4; data[i] = 225; data[i + 1] = 75; data[i + 2] = 85; } // a red wall at the left of slot 3
  for (let y = 88; y <= 108; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; data[i] = 80; data[i + 1] = 200; data[i + 2] = 170; } // a teal flash across slot 4
  for (const y0 of [10, 36]) for (let y = y0; y <= y0 + 20; y++) for (let x = 322; x <= 340; x++) { const i = (y * width + x) * 4; data[i] = 230; data[i + 1] = 80; data[i + 2] = 120; } // red-toned victim portraits
  const grid = { top: 10 / 120, pitch: 26 / 120, height: 21 / 120, portrait: 0.14 };
  const rows = C.killfeedRows(img, { colors: TEST_COLORS, grid });
  assert.deepEqual(rows.map((r) => [r.y0, r.left, r.right]), [[10, 'ally', 'enemy'], [36, 'enemy', 'ally']], 'portraits are skipped, and a red wall and a teal flash have no names, so they are no rows');
});

test('each kill-feed row is new once, wherever it moves', () => {
  const at = (t, rows) => C.killfeedRows(feedImage(rows), { colors: TEST_COLORS }).map((r) => ({ ...r, t }));
  let f = C.freshRows([], at(10, [{ y: 36, left: 'ally', right: 'enemy' }]), 10);
  assert.equal(f.fresh.length, 1);
  f = C.freshRows(f.recent, at(11, [{ y: 10, left: 'ally', right: 'enemy' }]), 11);
  assert.equal(f.fresh.length, 0, 'the same row moved up as the one above it left');
  const below = C.freshRows(f.recent, at(12, [{ y: 10, left: 'ally', right: 'enemy' }, { y: 36, left: 'ally', right: 'enemy' }]), 12);
  assert.equal(below.fresh.length, 1, 'a look-alike row below an old one is a new kill: new kills join at the bottom');
  const victim = C.freshRows(f.recent, at(12, [{ y: 10, left: 'ally', right: 'enemy', victim: 5 }]), 12);
  assert.equal(victim.fresh.length, 1, 'the same killer on another victim is a new row');
  assert.equal(C.freshRows(f.recent, at(16, [{ y: 10, left: 'ally', right: 'enemy' }]), 16).fresh.length, 1, 'a row gone for longer than a flash is not remembered');
  assert.ok(C.rowDistance([0, 4, 8, 4, 0], [0, 0, 4, 8, 4]) < 0.05, 'a shift of a pixel or two still matches');
  assert.equal(C.rowDistance([0, 0, 0], [0, 0, 0]), 1, 'two rows with no name to compare never match');
});

test("the row grid moves to where a recording draws its rows, ignoring an overlay bar", () => {
  const grid = { top: 0.106, pitch: 0.1376, height: 0.116, portrait: 0.14 }, h = 302;
  const bands = [{ y0: 0, y1: 13 }, { y0: 0, y1: 12 }, { y0: 44, y1: 80 }, { y0: 86, y1: 121 }, { y0: 45, y1: 81 }, { y0: 127, y1: 162 }];
  const fit = C.fitGrid(grid, bands, h);
  assert.ok(Math.abs(fit.top * h - 2.5) < 1.5, `rows at 44, 86, 127 px put the top at about 2.5 px, a pitch above (${fit.top * h})`);
  assert.ok(Math.abs(fit.height * h - 36.5) < 0.6, 'the row height becomes the bands\' median');
  assert.deepEqual(C.fitGrid(grid, bands.slice(0, 3), h), grid, 'too few rows to fit: the profile grid stands');
  const lines = Array(30).fill(0);
  for (let y = 5; y < 20; y++) lines[y] = 50;
  assert.deepEqual(C.colorBands(lines, 100), [{ y0: 5, y1: 19 }]);
});

test('names match despite one misread letter in a long name', () => {
  assert.equal(C.sameName('ZedCapetinha', 'ZedCapetlnha'), true);
  assert.equal(C.sameName('KAY/O', 'kayo'), true);
  assert.equal(C.sameName('Sage', 'Sova'), false);
});

test('sightings become one event per kill, with teams, the player, and trades', () => {
  const s = (t, killer, killerSide, victim, victimSide, mine = false) => ({ t, killer, killerSide, victim, victimSide, mine });
  const { player, events } = C.buildKillfeed([
    s(74, 'KAY/O', 'enemy', 'Omen', 'ally'), s(76, 'KAY/O', 'enemy', 'Omen', 'ally'),
    s(80, 'ZedCapetinha', 'ally', 'KAY/O', 'enemy'), s(80, 'Omen', 'enemy', 'ZedCapetinha', 'ally'),
    s(82, 'Im Muted', 'ally', 'Omen', 'enemy', true), s(84, 'Im Muted', null, 'Omen', null, true),
    s(85, 'Im Muted', 'ally', 'Killjoy', 'enemy', true),
    s(127, 'Sova', 'enemy', 'Im Muted', null, true),
  ]);
  assert.equal(player, 'Im Muted');
  assert.deepEqual(events.map((e) => [e.t, e.kind, e.killer, e.victim]), [
    [74, 'ally_death', 'KAY/O', 'Omen'], [80, 'ally_kill', 'ZedCapetinha', 'KAY/O'], [80, 'ally_death', 'Omen', 'ZedCapetinha'],
    [82, 'kill', 'Im Muted', 'Omen'], [85, 'kill', 'Im Muted', 'Killjoy'], [127, 'death', 'Sova', 'Im Muted'],
  ]);
  const zed = events[2], omenKill = events[3];
  assert.equal(zed.text, 'Omen (enemy) killed ZedCapetinha (teammate); traded by you 2 s later');
  assert.equal(omenKill.text, 'you killed Omen (enemy); trading ZedCapetinha');
  assert.equal(events[0].text, 'KAY/O (enemy) killed Omen (teammate); not traded', 'six seconds is too late to count as a trade');
  assert.equal(events[5].text, 'Sova (enemy) killed you'); // their own death untraded says nothing: often nobody was left to trade it
  assert.equal(events[1].seen, 1);
  assert.equal(events[0].seen, 2);
});

test("Gemini's numbered lines take their time and team colors from the strip they read", () => {
  const strips = [{ t: 81.75, after: 81.5, left: 'enemy', right: 'ally' }, { t: 82, left: 'ally', right: 'enemy' }];
  const read = [{ line: 2, killer: 'Im Muted', victim: 'Omen', players_own: true }, { line: 1, killer: 'Omen', victim: 'ZedCapetinha' }, { line: 3, killer: 'A', victim: 'B' }, { line: 1, killer: '', victim: 'C' }];
  assert.deepEqual(C.feedSightings(read, strips), [
    { t: 82, killer: 'Im Muted', victim: 'Omen', killerSide: 'ally', victimSide: 'enemy', mine: true },
    { t: 81.75, after: 81.5, killer: 'Omen', victim: 'ZedCapetinha', killerSide: 'enemy', victimSide: 'ally', mine: false },
  ], 'a line with no strip or no name is dropped');
});

test('the player is dead from just before their kill-feed line to the next round, kill, or 30 s', () => {
  const events = [{ t: 47.75, after: 47.5, kind: 'death' }, { t: 80, kind: 'round_start' }, { t: 100, kind: 'death' }, { t: 104, kind: 'kill' }, { t: 140, kind: 'death' }];
  const D = 30; // a round mode's deadFor
  assert.equal(C.deathAt(events, 47.4, D), null, 'before the frame the line first showed in, they were alive');
  assert.equal(C.deathAt(events, 47.6, D)?.t, 47.75);
  assert.equal(C.deathAt(events, 77, D)?.t, 47.75);
  assert.equal(C.deathAt(events, 78, D), null, '30 s on, before the next round start');
  assert.equal(C.deathAt(events, 99, D), null, 'no after: a second before the line still counts as alive');
  assert.equal(C.deathAt(events, 99.5, D)?.t, 100);
  assert.equal(C.deathAt(events, 100.5, D)?.t, 100);
  assert.equal(C.deathAt(events, 101, D), null, 'a kill means they were alive and fighting a few seconds before it');
  assert.equal(C.deathAt(events, 169, D)?.t, 140);
  assert.equal(C.deathAt(events, 171, D), null);
  assert.equal(C.deadForOf({ deadFor: { rounds: 30, respawn: 4 } }, events), 30, 'round starts: a round mode');
  assert.equal(C.deadForOf({ deadFor: { rounds: 30, respawn: 4 } }, events.filter((e) => e.kind !== 'round_start')), 4, 'no round starts: respawns');
  assert.equal(C.deadForOf({}, events), 5);
  assert.equal(C.deathAt([{ t: 10, kind: 'death' }], 15, 4), null, 'in deathmatch they are back in seconds');
});

test('finish refuses moments from after the player died, but not the death itself', () => {
  const ledger = C.recordLook(C.recordLook(looked(), { from: 49, to: 50, kind: 'frames' }), { from: 55, to: 56, kind: 'frames' });
  const events = [{ t: 48, after: 47.75, kind: 'death' }];
  const late = C.checkFinish({ ...good, habit_id: 'wide_peek', evidence: [...good.evidence.slice(0, 2), { t: '0:55', what: 'spectating a teammate' }] }, { ledger, duration: 120, habits: HABITS, events, deadFor: 30 });
  assert.ok(late.some((x) => /At 0:55 the player was dead \(they died about 0:48\)/.test(x)));
  const atDeath = C.checkFinish({ ...good, habit_id: 'wide_peek', evidence: [...good.evidence.slice(0, 2), { t: '0:49', what: 'dies alone' }] }, { ledger, duration: 120, habits: HABITS, events, deadFor: 30 });
  assert.ok(!atDeath.some((x) => /player was dead/.test(x)), 'the death itself can show a habit like dying alone');
});

test('a name seen on one team again and again corrects a tinted reading', () => {
  const s = (t, killer, killerSide, victim, victimSide, mine = false) => ({ t, killer, killerSide, victim, victimSide, mine });
  const { events } = C.buildKillfeed([
    s(10, 'Im Muted', 'ally', 'Sage', 'enemy', true),
    s(20, 'ZedCapetinha', 'ally', 'Sova', 'enemy'), s(30, 'Sova', 'enemy', 'ZedCapetinha', 'ally'), s(40, 'ZedCapetinha', 'ally', 'Sage', 'enemy'),
    s(50, 'KAY/O', 'enemy', 'Febera', 'ally'), s(60, 'Febera', 'ally', 'KAY/O', 'enemy'), s(70, 'KAY/O', 'enemy', 'Febera', 'ally'),
    s(80, 'ZedCapetinha', 'enemy', 'KAY/O', 'ally'), // a flash flipped both colors
    s(90, 'Omen', 'enemy', 'ZedCapetinha', 'enemy'), // one side tinted
    s(100, 'Omen', 'ally', 'Sage', 'enemy'), s(110, 'Omen', 'enemy', 'Febera', 'ally'), // an Omen on each team
  ]);
  const at = (t) => events.find((e) => e.t === t);
  assert.deepEqual([at(80).killerTeam, at(80).victimTeam, at(80).kind], ['ally', 'enemy', 'ally_kill']);
  assert.deepEqual([at(90).killerTeam, at(90).victimTeam, at(90).kind], ['enemy', 'ally', 'ally_death']);
  assert.deepEqual([at(100).killerTeam, at(110).killerTeam], ['ally', 'enemy'], 'Omen keeps the colors read for each kill');
});

test('the player is the teammate with the most yellow marks and deaths at their own death screens', () => {
  const ev = (t, killer, killerTeam, victim, victimTeam) => ({ t, killer, killerTeam, victim, victimTeam });
  const events = [ev(82, 'Im Muted', 'ally', 'Omen', 'enemy'), ev(85, 'Im Muted', 'ally', 'Killjoy', 'enemy'), ev(127, 'Sova', 'enemy', 'Im Muted', 'ally'),
    ev(74, 'KAY/O', 'enemy', 'Omen', 'ally'), ev(278, 'Sova', 'enemy', 'Omen', 'ally'), ev(479, 'Killjoy', 'enemy', 'Im Muted', 'ally'), ev(500, 'Killjoy', 'enemy', 'Febera', 'ally')];
  const mark = (killer, victim, mine) => ({ killer, victim, mine });
  const sightings = [mark('Im Muted', 'Omen', true), mark('Im Muted', 'Killjoy', true), mark('Killjoy', 'Febera', true), mark('Killjoy', 'Im Muted', true), mark('KAY/O', 'Omen', false)];
  assert.equal(C.choosePlayer(events, sightings, [127, 479]), 'Im Muted');
  assert.equal(C.choosePlayer(events, sightings.map((x) => ({ ...x, mine: false })), [74, 278]), 'Omen', 'deaths alone can decide');
  assert.equal(C.choosePlayer(events, [mark('Killjoy', 'Febera', true), mark('Killjoy', 'Sage', true), mark('Killjoy', 'Omen', true)], []), null, 'a yellow enemy portrait never makes the player');
  assert.equal(C.choosePlayer(events, [], []), null);
  // an Omen on each team: the player's kills of the enemy Omen don't mark the teammate Omen
  const sided = (killer, victim) => ({ killer, victim, killerSide: 'ally', victimSide: 'enemy', mine: true });
  assert.equal(C.choosePlayer(events, [sided('Im Muted', 'Omen'), sided('Im Muted', 'Omen'), sided('Im Muted', 'Omen'), sided('Im Muted', 'Killjoy')], []), 'Im Muted');
  // a name the feed shows on the other team again and again is never the player, however many rows are marked for it
  const both = [...events, ev(300, 'Im Muted', 'ally', 'Omen', 'enemy'), ev(310, 'Omen', 'enemy', 'Febera', 'ally'), ev(320, 'Omen', 'ally', 'Sage', 'enemy')];
  assert.equal(C.choosePlayer(both, [sided('Omen', 'Sage'), sided('Omen', 'Killjoy'), sided('Omen', 'Sova'), sided('Omen', 'KAY/O')], []), null);
  const { events: built } = C.buildKillfeed([{ t: 127, killer: 'Sova', victim: 'Im Muted', killerSide: 'enemy', victimSide: 'ally', mine: false }, { t: 400, killer: 'Killjoy', victim: 'Febera', killerSide: 'enemy', victimSide: 'ally', mine: true }], { player: 'Im Muted' });
  assert.deepEqual(built.map((x) => x.kind), ['death', 'ally_death'], 'a given name beats the yellow marks');
});

test("who the player is: their name for this game when the feed has it, the feed's own pick, or else ask them", () => {
  const ev = (t, killer, killerTeam, victim, victimTeam) => ({ t, killer, killerTeam, victim, victimTeam });
  const events = [ev(10, 'Im Muted', 'ally', 'Omen', 'enemy'), ev(20, 'Sova', 'enemy', 'Im Muted', 'ally'), ev(30, 'Febera', 'ally', 'Sage', 'enemy'), ev(40, 'Im Muted', 'ally', 'Sage', 'enemy')];
  const plain = events.map((e) => ({ killer: e.killer, victim: e.victim, mine: false }));
  assert.deepEqual(C.whoIsPlayer({ known: 'im muted', events, sightings: plain }), { player: 'im muted' }, 'a name they gave, found in the feed');
  assert.deepEqual(C.whoIsPlayer({ events, sightings: plain.map((x) => ({ ...x, mine: x.killer === 'Im Muted' || x.victim === 'Im Muted' })) }), { player: 'Im Muted' }, 'the marked rows decide when they can');
  assert.deepEqual(C.whoIsPlayer({ events, sightings: plain }), { ask: ['Im Muted', 'Febera'] }, 'otherwise ask, with teammates seen most first and no enemies');
  assert.deepEqual(C.whoIsPlayer({ known: 'OldAccount', events, sightings: plain }), { ask: ['Im Muted', 'Febera'] }, 'a name from before that is not in this feed is asked about again');
  assert.deepEqual(C.whoIsPlayer({ known: 'Im Muted', events: [], sightings: [] }), { player: 'Im Muted' }, 'with no kill feed there is nothing to ask');
});

// a fake ammo crop: tall white blocks for the magazine digits, shorter ones for the reserve, on a dark ground
function ammoImage(digits, { w = 120, h = 30, noise = null } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 40; data[i * 4 + 1] = 45; data[i * 4 + 2] = 50; data[i * 4 + 3] = 255; }
  const paint = (x0, x1, y0, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 245; } };
  // each digit: as many full-height strokes as its value plus one, so each has its own shape
  [...String(digits)].forEach((c, k) => { for (let s = 0; s <= +c; s++) paint(20 + k * 24 + s * 2, 20 + k * 24 + s * 2, 4, 23); });
  paint(76, 77, 12, 21); paint(80, 86, 12, 21); // a separator and the reserve, shorter
  if (noise) paint(noise, noise + 3, 2, 27); // something bright behind the HUD
  return { data, width: w, height: h };
}

test('the ammo reader finds the magazine digits and tells a shot from a steady count', () => {
  const r = C.ammoReading(ammoImage(25));
  assert.ok(r && r.x0 === 20 && r.x1 < 76, 'the reserve and separator are shorter, so only the magazine counts');
  assert.equal(C.ammoReading({ data: new Uint8ClampedArray(120 * 30 * 4), width: 120, height: 30 }), null, 'no digits: no reading');
  const run = (list) => list.map((d, i) => ({ t: i / 30, reading: d == null ? null : C.ammoReading(ammoImage(d)) }));
  assert.equal(C.shotsFired(run([...Array(30).fill(25)])).fired, false);
  assert.equal(C.shotsFired(run([...Array(10).fill(25), 24, 24, 24, 23, 23, 23, 22, 22, 22, ...Array(11).fill(21)])).fired, true);
  // a bright thing passing behind the digits changes their outline frame by frame; only steady readings count
  const noisy = Array.from({ length: 30 }, (_, i) => ({ t: i / 30, reading: C.ammoReading(ammoImage(25, { noise: i >= 10 && i < 20 ? 20 + i * 2 : null })) }));
  assert.equal(C.shotsFired(noisy)?.fired, false, 'background flicker is not a shot');
  assert.equal(C.shotsFired(run([...Array(20).fill(null), 25, 25, 25, 25, 25, 25, 25, 25, 25, 25])), null, 'steady over too little of the stretch: unclear');
});

// a fake Apex-like ammo crop: seven-segment digits for the magazine, smaller ones for the reserve, and optionally a
// white gun icon taller than the digits, a bright floor along the top and right edges, and a bright stripe running up
// from the bottom edge into the first digit
const SEGMENTS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];
function hudImage(count, { w = 200, h = 50, icon = false, reserve = null, floor = false, stripe = false } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 40; data[i * 4 + 1] = 45; data[i * 4 + 2] = 50; data[i * 4 + 3] = 255; }
  const paint = (x0, x1, y0, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 240; } };
  const number = (n, x, y, dh) => [...String(n)].forEach((c, k) => {
    const dw = Math.round(dh * 0.55), s = Math.max(2, Math.round(dh / 8)), m = y + Math.floor(dh / 2), l = x + k * (dw + 3), r = l + dw - 1;
    const seg = { a: [l, r, y, y + s - 1], b: [r - s + 1, r, y, m], c: [r - s + 1, r, m, y + dh - 1], d: [l, r, y + dh - s, y + dh - 1], e: [l, l + s - 1, m, y + dh - 1], f: [l, l + s - 1, y, m], g: [l, r, m - 1, m] };
    for (const g of SEGMENTS[+c]) paint(...seg[g]);
  });
  if (icon) paint(10, 80, 12, 37);
  if (count != null) number(count, 100, 15, 20);
  if (reserve != null) number(reserve, 150, 25, 10);
  if (floor) { paint(0, w - 1, 0, 6); paint(188, w - 1, 0, h - 1); }
  if (stripe) paint(100, 102, 25, h - 1);
  return { data, width: w, height: h };
}

test('the ammo reader reads the magazine digits, not a gun icon taller than them or a bright floor behind the HUD', () => {
  const r = C.ammoReading(hudImage(23, { icon: true, reserve: 187, floor: true }));
  assert.ok(r && r.x0 === 100 && r.digits.length === 2, `the two magazine digits (${r && `${r.x0}-${r.x1}, ${r.digits.length}`})`);
  assert.equal(C.ammoReading(hudImage(23, { icon: true, stripe: true })), null, 'background running into a digit leaves the frame unread');
  const run = (list, opts = { icon: true, reserve: 187, floor: true }) => list.map((n, i) => ({ t: i / 30, reading: C.ammoReading(hudImage(n, opts)) }));
  assert.equal(C.shotsFired(run([...Array(15).fill(23), ...Array(15).fill(22)])).fired, true, 'one shot, 23 to 22, changes one digit');
  assert.equal(C.shotsFired(run(Array(30).fill(23))).fired, false);
  // Apex at 0:46 (Oct 22): 23 down to 4 in bursts, then a reload back to 23, so the first and last readings match
  const burst = [23, 23, 23, 23, 23, 23, 19, 19, 19, 16, 16, 16, 13, 13, 13, 10, 10, 10, 6, 6, 6, 4, 4, 4, 4, 4, 23, 23, 23, 23, 23, 23];
  const fired = C.shotsFired(run(burst));
  assert.ok(fired.fired && fired.changes >= 6, `a magazine fired and reloaded to its count reads as fired (${JSON.stringify(fired)})`);
  // the scan reads at 4 fps: the same burst shows each count for a frame or two, and the count held at 4 for two
  const scan = [23, 23, 23, 23, 13, 8, 4, 4, null, 0, 23, 23, 23, 23].map((n, i) => ({ t: i / 4, reading: n == null ? null : C.ammoReading(hudImage(n, { icon: true, reserve: 187, floor: true })) }));
  assert.deepEqual(C.fireTimes(scan), [1.5, 2.5], 'the scan marks the burst, and the reload back to 23');
});

test('a reading off the magazine line, like the reserve count while the digits are hidden, is no change', () => {
  const list = [...Array(12).fill(23), ...Array(8).fill(null), ...Array(12).fill(23)];
  const readings = list.map((n, i) => ({ t: i / 30, reading: C.ammoReading(hudImage(n, { reserve: 187 })) }));
  assert.ok(readings[15].reading, 'the reserve count reads on its own');
  assert.equal(C.shotsFired(readings).fired, false);
  assert.deepEqual(C.fireTimes(readings), [], 'and marks no firing');
});

test('a habit about firing needs moments where the ammo counter moved', () => {
  const habits = [...HABITS, { id: 'long_spray', name: 'Spraying at long range', needsShots: true }];
  const spray = { ...good, habit_id: 'long_spray' };
  const ok = C.checkFinish(spray, { ledger: looked(), duration: 120, habits, shots: [{ t: 10, fired: true }, { t: 40.5, fired: null }, { t: 71, fired: true }] });
  assert.deepEqual(ok, [], 'fired or unclear stands');
  const none = C.checkFinish(spray, { ledger: looked(), duration: 120, habits, shots: [{ t: 10, fired: true }, { t: 40.5, fired: false }, { t: 71, fired: true }] });
  assert.ok(none.some((x) => /At 0:40 the ammo counter doesn't change, so the player didn't fire/.test(x)));
  assert.ok(none.some((x) => /at least 3 separate moments .* \(you have 2\)/.test(x)), 'a moment without shots no longer counts');
});

test('a fight can be measured twice, and a third try is refused', () => {
  const events = [{ t: 126.75, after: 126, kind: 'death' }, { t: 200, kind: 'kill' }];
  assert.equal(C.retryRefusal(events, [], 126.8), '');
  assert.equal(C.retryRefusal(events, [126.8], 126.2), '', 'a second try, earlier, is fair');
  assert.match(C.retryRefusal(events, [126.8, 126.2], 125.8), /measured the fight that ends at 2:06 \(their death\) 2 times already \(2:06\.8, 2:06\.2\)/);
  assert.equal(C.retryRefusal(events, [126.8, 126.2], 198.5), '', 'another fight is fine');
  assert.equal(C.retryRefusal(events, [50, 50.5], 52), '', 'outside a fight, only moments within 1.5 s count');
  assert.match(C.retryRefusal(events, [50, 50.5], 50.9), /around 0:50 2 times/);
});

test('finish sent back on the numbers says to drop the theory or find none', () => {
  const low = C.checkFinish(good, { ledger: looked(), duration: 120, habits: HABITS, measures: [{ t: 10.2, heads: 0.1 }, { t: 40.5, heads: 0.2 }, { t: 70.3, heads: 0 }] });
  assert.ok(low.some((x) => /so this isn't the habit\. Drop the theory .* or finish with found false/.test(x)));
  assert.ok(!low.some((x) => /Show measurements where it was low/.test(x)), 'never invites hunting for low readings');
});

// ---------- learning a game (learn.js) ----------
const L = createRequire(import.meta.url)('../learn.js');

test("the learn call's boxes become padded screen regions, one per element", () => {
  const r = L.mergeBoxes([
    { name: 'kill_feed', frame: 1, box: [100, 700, 200, 980] }, { name: 'kill_feed', frame: 3, box: [110, 690, 210, 990] }, { name: 'kill_feed', frame: 5, box: [90, 710, 400, 970] },
    { name: 'ammo', frame: 2, box: [930, 690, 960, 760] }, { name: 'nonsense', frame: 1, box: [0, 0, 10, 10] }, { name: 'minimap', frame: 1, box: [5, 5, 5, 300] },
  ], 0);
  assert.deepEqual(r.killfeed, [0.7, 0.1, 0.28, 0.11], 'the median of each edge, so one odd box doesn\'t move it');
  assert.deepEqual(r.ammo, [0.69, 0.93, 0.07, 0.03]);
  assert.equal(r.nonsense, undefined);
  assert.equal(r.minimap, undefined, 'a box with no height is dropped');
  const padded = L.mergeBoxes([{ name: 'ammo', frame: 1, box: [950, 980, 1000, 1000] }]);
  assert.ok(padded.ammo[0] + padded.ammo[2] <= 1 && padded.ammo[1] + padded.ammo[3] <= 1, 'padding stays on screen');
});

test('the profile comes from the learn call, with only the checks code can do', () => {
  const raw = {
    game: 'Some Shooter', genre: 'shooter', first_person: true, crosshair_center: true, fov_h: 103, team_game: true, rounds: false, respawn_seconds: 3,
    elements: [{ name: 'kill_feed', frame: 1, box: [60, 700, 320, 990] }, { name: 'ammo', frame: 1, box: [930, 690, 960, 760] }],
    ally_color: 'teal', enemy_color: 'red', ally_rgb: [80, 200, 170], enemy_rgb: [225, 75, 85], cues: ['A skull shows on a kill.'], key_moments: 'kills and deaths',
    habits: [
      { id: 'Crosshair Low', name: 'Crosshair below head level', signs: 's', drill: 'd', checked_by: 'aim' },
      { id: 'spray', name: 'Spraying', signs: 's', drill: 'd', checked_by: 'shots' },
      { id: 'spray', name: 'Again', signs: 's', drill: 'd', checked_by: 'none' },
      { id: 'peek', name: 'Wide peeks', signs: 's', drill: 'd', checked_by: 'telepathy' },
    ],
  };
  const p = L.toProfile(raw, undefined, { aimTarget: 'head', mistakes: raw.habits, priorities: ['aim'] });
  assert.equal(p.name, 'Some Shooter');
  assert.deepEqual(p.regions.aim, L.AIM, 'a first-person view with a center crosshair gets the aim area');
  assert.ok(p.regions.killfeed && p.regions.ammo);
  assert.deepEqual(p.habits.map((h) => [h.id, !!h.measuredBy, !!h.needsShots]), [['crosshair_low', true, false], ['spray', false, true], ['peek', false, false]], 'ids are cleaned and deduped, and an unknown check is ignored');
  assert.deepEqual(p.deadFor, { rounds: 30, respawn: 3 });
  assert.equal(p.fovH, 103);
  assert.deepEqual(p.colorHues, { ally: 165, enemy: 356 });
  assert.deepEqual(L.toProfile(raw).habits, [], "learned from the recording alone, a profile has no habits: they're the research's, which the coach asks for");
  const chess = L.toProfile({ game: 'Chess', genre: 'chess', first_person: false, crosshair_center: false, elements: [{ name: 'board', frame: 1, box: [100, 300, 900, 700] }] }, undefined, { mistakes: [{ id: 'x', name: 'Blunders', signs: 's', drill: 'd', checked_by: 'aim' }] });
  assert.equal(chess.regions.aim, undefined, 'no aim area outside first person');
  assert.equal(chess.habits[0].measuredBy, undefined, "aim can't check a habit when there's no aim area");
  assert.equal(chess.fovH, null);
  const tracking = L.toProfile(raw, undefined, { aimTarget: 'tracking', mistakes: raw.habits });
  assert.equal(tracking.habits[0].measuredBy, undefined, "where staying on target matters more than height, aim height can't check a habit");
});

test('research on what matters is cleaned, and code decides what each habit can be checked by', () => {
  const two = [{ title: 'ea.com', uri: 'https://ea.com/x' }, { title: 'reddit.com', uri: 'https://reddit.com/r/apexlegends' }];
  const r = L.cleanResearch({ rewards: 'Ranked points for placement and kills', systems: [{ name: 'Legend abilities', matters: 'Tacticals open fights.' }], priorities: ['Positioning', 'Picking fights', '', 'Third parties'], engagements: 'Take fights you can finish before a third party arrives.', aim_target: 'body', mistakes: [
    { name: 'Taking open fights', signs: 'Shooting from open ground', cost: 'Third-partied', drill: 'Fight from cover', checked_by: 'none' },
    { name: 'Spraying', signs: 's', cost: 'c', drill: 'd', checked_by: 'telepathy' },
    { name: 'Dry peeking', signs: 'Peeking alone with no utility', cost: 'c', drill: 'd', checked_by: 'aim' },
    { name: 'Low crosshair', signs: 'The crosshair sits at chest height', cost: 'c', drill: 'd', checked_by: 'aim' },
    { name: 'Running in solo', signs: 'Alone in the open', cost: 'c', drill: 'd', checked_by: 'engine' },
  ] }, ['aim', 'shots', 'engine'], { sources: two, researched: true, genre: 'shooter' });
  assert.deepEqual(r.priorities, ['Positioning', 'Picking fights', 'Third parties']);
  assert.deepEqual(r.systems, [{ name: 'Legend abilities', matters: 'Tacticals open fights.' }]);
  assert.equal(r.aimTarget, 'body');
  assert.deepEqual(r.mistakes.map((m) => m.checked_by), ['none', 'none', 'none', 'aim', 'none'], 'an unknown check, aim on a habit that is not about the crosshair, and the chess engine in a shooter are all dropped');
  assert.equal(r.researched, true);
  const one = L.cleanResearch({ priorities: ['Farming'], aim_target: 'tracking', mistakes: [] }, ['aim'], { sources: two.slice(0, 1), researched: true, genre: 'moba' });
  assert.equal(one.researched, false, 'one web page is not research');
  assert.equal(one.aimTarget, 'none', 'no aim target in a game with no aiming');
  assert.equal(L.cleanResearch({ priorities: [], mistakes: [] }, ['aim']), null, 'nothing usable');
  const kit = L.cleanCharacter({ role: 'Sentinel', abilities: [{ name: 'Razorvine', slot: 'C', does: 'a', use: 'b' }, { name: '', slot: 'Q' }], mistakes: [{ name: 'Wasting Steel Garden', signs: 'The ultimate goes out with no fight near', cost: 'c', drill: 'd', checked_by: 'engine' }] }, 'Vyse', ['aim', 'engine'], 'shooter', { sources: two, researched: true });
  assert.deepEqual(kit.abilities.map((a) => a.name), ['Razorvine']);
  assert.equal(kit.mistakes[0].checked_by, 'none');
  assert.equal(kit.researched, true);
  assert.equal(L.cleanCharacter({ abilities: [] }, 'Nobody', [], 'shooter'), null);
});

test('research is searched first and put in shape after, and without web search it falls back to the model and says so', async () => {
  const answer = { rewards: 'Rounds', systems: [], priorities: ['Trading'], engagements: '', aim_target: 'head', mistakes: [{ name: 'No trades', signs: 's', cost: 'c', drill: 'd', checked_by: 'none' }] };
  const asked = [];
  globalThis.Gemini = {
    grounded: async () => { throw Object.assign(new Error('not available'), { status: 404 }); },
    generate: async (body) => { asked.push(body); return {}; },
    textOf: () => JSON.stringify(answer),
    parseJSON: JSON.parse,
  };
  const r = await L.researchGame({ name: 'Test Game ' + Date.now(), genre: 'shooter' });
  assert.equal(r.researched, false);
  assert.deepEqual(r.sources, []);
  assert.equal(r.mistakes[0].name, 'No trades');
  assert.equal(asked.length, 5, "the model's own answer to each of the 4 questions (guides, community, meta, wiki), then the shaping");
  assert.ok(asked[4].generationConfig.responseSchema, 'the shaping call has the schema');
  assert.match(asked[4].contents[0].parts[0].text, /## guides[\s\S]*## community[\s\S]*## meta[\s\S]*## wiki/);
  // with search: a search citing one page is asked once more, to search first
  let n = 0;
  globalThis.Gemini.grounded = async (ask) => { n++; const pages = /Search the web for this first/.test(ask) ? 2 : 1; return { text: 'prose', sources: Array.from({ length: pages }, (_, i) => ({ title: `site${n}-${i}`, uri: `https://site${n}-${i}.com` })) }; };
  const web = await L.researchGame({ name: 'Web Game ' + Date.now(), genre: 'shooter' });
  assert.equal(n, 8, 'each of the 4 searches asked twice');
  assert.equal(web.researched, true);
  assert.deepEqual(web.facets, { guides: 2, community: 2, meta: 2, wiki: 2 });
  assert.ok(web.sources.every((x) => x.facet), 'each source says which search found it');
  delete globalThis.Gemini;
});

test("each ability the player used, as a clip read saw it, becomes an event in the match's time", () => {
  const w = { from: 100, to: 110, events: [], hits: [] };
  const out = C.fightsFromClips([w], [{ fight: 'enemy_engaged', story: 'Revealed, then rushed', abilities: [
    { t: '1:43', who: 'player', name: 'Arc Rose', what: 'flashed the corner' },
    { t: '1:44', who: 'enemy', name: 'Recon Bolt', what: 'revealed them' },
    { t: '1:43.5', who: 'player', name: 'Arc Rose', what: 'the same flash, seen twice' },
    { t: '1:45', who: 'nobody', name: 'Wind' },
  ] }], []);
  assert.deepEqual(out.filter((e) => e.kind === 'ability').map((e) => [e.t, e.who, e.name, e.text]), [[103, 'player', 'Arc Rose', 'they used an ability (the clip read calls it Arc Rose: flashed the corner)']], "others' abilities stay in the story, and one use seen twice is one");
  // timed from the clip's own start, it's shifted into the match
  assert.deepEqual(C.fightsFromClips([w], [{ fight: 'no_fight', abilities: [{ t: '0:03', who: 'player', name: 'Shear', what: 'walled the door' }] }], []).map((e) => [e.t, e.kind]), [[103, 'ability']]);
});

test('fights come from firing and from what the low-detail pass saw, with how each ended', () => {
  assert.deepEqual(C.groupFights([10, 11, 15, 40, 41.5]), [{ from: 8.5, to: 16.5, bursts: 3 }, { from: 38.5, to: 43, bursts: 2 }]);
  const events = [{ t: 16, kind: 'kill' }, { t: 90, kind: 'death' }];
  const firing = C.groupFights([10, 11, 15, 40, 41.5, 70, 71]);
  const fights = C.mergeFights(firing, [{ from: 39, to: 45, outcome: 'none', text: 'traded shots across the ridge' }, { from: 86, to: 91, text: '' }], events);
  assert.deepEqual(fights.map((f) => [f.from, f.to, f.outcome, f.seenBy]), [[8.5, 17, 'won', 'firing+kill'], [38.5, 45, 'none', 'firing+seen'], [86, 91, 'lost', 'death+seen']]);
  assert.ok(!fights.some((f) => f.from > 60 && f.from < 80), 'firing with nothing else (a reload, a swap) is no fight');
  assert.match(fights[1].text, /no one fell; fired in 2 bursts; traded shots across the ridge/);
  assert.deepEqual(C.mergeFights(firing, [], [], C.groupFights([69.5, 72])), [], 'counter changes alone, ammo or damage, are no fight');
  const hit = C.mergeFights([], [{ from: 68, to: 70, text: '' }], [], C.groupFights([69.5, 72]));
  assert.deepEqual(hit.map((f) => [f.from, f.to, f.hits, f.seenBy]), [[68, 73.5, 2, 'hits+seen']], 'landed hits extend a fight the pass saw');
  assert.match(C.eventsBrief([fights[0]]), /^0:08\.5–0:17 engagement: won; fired in 3 bursts$/);
});

// A kill-feed crop drawn in code: dark scenery with a red wall on the left; per frame, a teal-on-red row and a
// red-on-teal row ending at x 380 (names in white, shifted per frame so no row stays put), and a band of the wall
// beside a teal sky with no names.
function feedFrame(shift = 0) {
  const W = 400, H = 120, d = new Uint8ClampedArray(W * H * 4);
  const fill = (x0, y0, x1, y1, [r, g, b]) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * W + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; } };
  fill(0, 0, W - 1, H - 1, [40, 40, 40]);
  fill(0, 0, 120, H - 1, [210, 70, 60]); // the wall, red like a team
  fill(150 + shift, 10, 260, 29, [80, 190, 160]); fill(261, 10, 380, 29, [220, 80, 80]); // teal killer, red victim
  fill(200 + shift, 34, 290, 53, [220, 80, 80]); fill(291, 34, 380, 53, [80, 190, 160]); // red killer, teal victim
  for (const [x0, y0] of [[180 + shift, 16], [290, 16], [215 + shift, 40], [310, 40]]) fill(x0, y0, x0 + 40, y0 + 7, [255, 255, 255]);
  fill(130, 80, 250, 99, [80, 190, 160]); // the sky beside the wall: two colors, no names
  return { data: d, width: W, height: H };
}

test('kill-feed rows hold two team colors side by side and a name in white', () => {
  const rows = L.twoTeamRows(L.pixelHues(feedFrame()), { ally: [150, 180], enemy: [345, 15] });
  assert.deepEqual(rows.map((r) => [r.y0, r.y1, r.x0, r.x1, r.left, r.right]), [[10, 29, 150, 380, 'ally', 'enemy'], [34, 53, 200, 380, 'enemy', 'ally']], 'not the wall beside the sky');
  const still = L.pixelHues(feedFrame()), blank = L.pixelHues({ data: new Uint8ClampedArray(400 * 120 * 4), width: 400, height: 120 });
  assert.deepEqual(L.feedRows([still, still, still, still, still], { ally: [150, 180], enemy: [345, 15] }).flat(), [], 'what stays put is an overlay');
  assert.equal(L.feedRows([still, blank, blank, blank, blank], { ally: [150, 180], enemy: [345, 15] })[0].length, 2);
});

test('team colors are measured from the rows, and the reported colors only say which team is which', () => {
  const imgs = Array.from({ length: 12 }, (_, k) => feedFrame(k * 4)), px = imgs.map(L.pixelHues);
  const bins = new Array(36).fill(0);
  for (const img of imgs) L.hueHistogram(img).forEach((v, i) => { bins[i] += v; });
  // the model called the teal "blue": it's still the player's team, and the red wall, the biggest color, isn't a team
  const m = L.feedColors(px, bins, (b) => b.y0 < 60, 400, { ally: 215, enemy: 0 });
  const has = ([lo, hi], h) => (lo <= hi ? h >= lo && h <= hi : h >= lo || h <= hi);
  assert.ok(has(m.colors.ally, 164) && has(m.colors.enemy, 0), JSON.stringify(m.colors));
  assert.equal(m.found.height, 20);
  assert.equal(m.found.pitch, 24);
  const swapped = L.feedColors(px, bins, (b) => b.y0 < 60, 400, { ally: 0, enemy: 170 });
  assert.ok(has(swapped.colors.ally, 0) && has(swapped.colors.enemy, 164));
  assert.equal(L.rgbHue([80, 200, 170]), 165);
  assert.equal(L.rgbHue([128, 128, 130]), null, 'gray has no hue');
  assert.equal(L.nameHue('Teal green'), 170);
});

test("a box stays when its frames show what it claims, and health must be a bar or a number", () => {
  const frame = { w: 2170, h: 1162 }, pictures = 3, all = (box, outlines) => [1, 2, 3].map((image) => ({ image, box, outlines }));
  const regions = { health: [0.493, 0.817, 0.081, 0.148], ammo: [0.799, 0.863, 0.2, 0.094], minimap: [0.066, 0.019, 0.161, 0.296] };
  const none = new Map();
  // Apex: the learn call's "health" is the ultimate icon, and the check says so
  let r = L.judgeBoxes({ names: ['health', 'ammo', 'minimap'], said: [...all(1, 'abilities'), ...all(2, 'ammo'), ...all(3, 'minimap')], digits: none, pictures, regions, frame });
  assert.deepEqual(r.kept, ['ammo', 'minimap']);
  assert.deepEqual(r.dropped, [{ name: 'health', shows: 'abilities', box: regions.health }]);
  assert.ok(!r.regions.health);
  // the same square box goes even when the model agrees: it's neither a bar nor a number
  r = L.judgeBoxes({ names: ['health'], said: all(1, 'health'), digits: none, pictures, regions, frame });
  assert.deepEqual(r.dropped.map((d) => [d.name, d.shows]), [['health', 'other']]);
  // the real bars under the player's name are a bar; Valorant's health is a number whose digits read
  r = L.judgeBoxes({ names: ['health'], said: all(1, 'health'), digits: none, pictures, regions: { health: [0.14, 0.905, 0.13, 0.03] }, frame });
  assert.deepEqual(r.kept, ['health']);
  r = L.judgeBoxes({ names: ['health'], said: all(1, 'health'), digits: new Map([['health', 3]]), pictures, regions: { health: [0.19, 0.895, 0.13, 0.091] }, frame: { w: 1290, h: 726 } });
  assert.deepEqual(r.kept, ['health']);
  assert.equal(L.barShaped([0.293, 0.876, 0.104, 0.078], { w: 2170, h: 1162 }), true, "TenZ's \"100\" is long enough with no digits read");
  assert.equal(L.barShaped([0.493, 0.817, 0.081, 0.148], frame), false, 'the ultimate icon is square');
  // digits keep a number the model misnamed, and two boxes showing each other's element swap
  r = L.judgeBoxes({ names: ['ammo'], said: all(1, 'scoreboard'), digits: new Map([['ammo', 2]]), pictures, regions, frame });
  assert.deepEqual(r.kept, ['ammo']);
  r = L.judgeBoxes({ names: ['damage', 'kill_count'], said: [...all(1, 'kill_count'), ...all(2, 'damage')], digits: none, pictures, regions: { damage: [0.1, 0.1, 0.05, 0.03], kill_count: [0.2, 0.1, 0.05, 0.03] }, frame });
  assert.deepEqual(r.regions, { damage: [0.2, 0.1, 0.05, 0.03], kill_count: [0.1, 0.1, 0.05, 0.03] });
  assert.deepEqual(r.dropped, []);
});

test('kill-feed rows are the bands that share an edge and a height', () => {
  const row = (y0, x0, x1, h = 20) => ({ y0, y1: y0 + h - 1, x0, x1, cols: [] });
  const frames = [
    [row(10, 100, 380), row(34, 160, 380), row(200, 5, 300)], // two rows, and scenery
    [row(10, 120, 381), row(34, 90, 379), row(58, 140, 380)],
    [row(10, 110, 380), row(150, 20, 395, 60)], // a tall block of scenery
  ];
  const r = L.alignedRows(frames, (b) => b.y0 < 70, 400);
  assert.equal(r.height, 20);
  assert.equal(r.pitch, 24);
  assert.equal(r.rows.flat().length, 6, 'the scenery bands neither end on the shared edge nor have a row\'s height');
  assert.equal(r.top, 10);
  assert.equal(L.alignedRows([[row(10, 100, 380)]], () => true, 400), null, 'too few rows to say');
  assert.equal(L.portraitShare([Array(100).fill(0.9)], 100, 10), 0, 'rows ending in color have no portrait');
  assert.equal(L.portraitShare([[...Array(80).fill(0.9), ...Array(20).fill(0.1)], [...Array(80).fill(0.8), ...Array(20).fill(0.2)]], 100, 10), 0.2);
  assert.equal(L.portraitShare([[...Array(70).fill(0.9), ...Array(25).fill(0.1), ...Array(5).fill(0.9)]], 100, 10), 0.3, 'a strip of bar at the very edge');
});

test("a chess habit cites the player's own moves, each one the engine calls a mistake", () => {
  const habits = [{ id: 'time_blunders', name: 'Blunders under time pressure', measuredBy: 'engine' }];
  const events = [{ t: 10, kind: 'move', san: 'Nf3', loss: 20, grade: null }, { t: 40.5, kind: 'move', san: 'Qxb7', loss: 480, grade: 'blunder' }, { t: 70, kind: 'move', san: 'Bxa6', loss: 140, grade: 'mistake' }, { t: 72, kind: 'opponent_move', san: 'Qxa6', loss: 0, grade: null }];
  const args = { ...good, habit_id: 'time_blunders', habit: 'Blunders under time pressure', evidence: [{ t: '0:10', what: 'a' }, { t: '0:40.5', what: 'b' }, { t: '1:10', what: 'c' }] };
  const problems = C.checkFinish(args, { ledger: looked(), duration: 120, habits, events });
  assert.ok(problems.some((x) => /At 0:10 the engine scores Nf3 as fine \(it gave away 20 centipawns\)/.test(x)));
  assert.equal(problems.filter((x) => /engine/.test(x)).length, 1, 'the blunder and the mistake stand');
  const nothing = C.checkFinish({ ...args, evidence: [{ t: '1:11', what: 'c' }, ...args.evidence.slice(1)] }, { ledger: C.recordLook(looked(), { from: 110, to: 112, kind: 'frames' }), duration: 120, habits, events: events.filter((e) => e.t !== 70) });
  assert.ok(nothing.some((x) => /There's no move of theirs at 1:11/.test(x)));
});

test('a habit being worked on applies only to the game it came from', () => {
  let h = C.addMatch(C.emptyHistory(), { id: 'm1', game: 'Valorant', habit: 'Crosshair low' });
  h = C.acceptHabit(h, { id: 'm1', game: 'Valorant', habitId: 'crosshair_low', habit: 'Crosshair low', date: '2026-10-18' });
  h = C.addMatch(h, { id: 'm2', game: 'Chess', habit: 'Blunders' });
  assert.equal(C.historyFor(h, 'valorant').habit.id, 'crosshair_low');
  assert.equal(C.historyFor(h, 'Chess').habit, null, 'a chess review is not told about a shooter habit');
  assert.deepEqual(C.historyFor(h, 'Chess').matches.map((m) => m.id), ['m2']);
});

test('send-back reasons group by kind, whatever moment they name', () => {
  const twice = C.checkFinish({ ...good, habit_id: 'crosshair_low' }, { ledger: looked(), duration: 120, habits: HABITS, measures: LOW.slice(0, 2) });
  const thrice = C.checkFinish({ ...good, habit_id: 'crosshair_low' }, { ledger: looked(), duration: 120, habits: HABITS, measures: LOW.slice(0, 1) });
  assert.equal(C.problemKind(twice.find((x) => /measure_aim/.test(x))), 'aim_count');
  assert.equal(C.problemKind(thrice.find((x) => /measure_aim/.test(x))), 'aim_count', 'a different count is the same reason');
  assert.equal(C.problemKind("You haven't looked closely at 1:30. Look with frames or measure_aim, or cite a moment you did look at."), 'unseen');
  assert.equal(C.problemKind('At 0:34 the engine scores c3 as fine (it gave away 20 centipawns)'), 'engine');
  assert.equal(C.problemKind('Name the habit (habit).'), 'other');
});

// ---- the same answer every time: the losses looked at, the finding on the board ----
const DEATHS = [14, 47, 66, 101, 134].map((t) => ({ t, kind: 'death' }));
const lookedAt = (...ts) => { const l = C.createLedger(); for (const t of ts) C.recordLook(l, { from: t - 1, to: t }); return l; };

test('before deciding either way, the review looks at the losses: all of them, or 4 when there are more', () => {
  const few = C.checkFinish({ found: false, why: 'Each death had its own cause; none repeated.' }, { ledger: lookedAt(14, 47, 134), events: DEATHS, coverLosses: true });
  assert.equal(few.length, 1);
  assert.match(few[0], /fights they lost before deciding: 3 of 5 looked at, and a review needs 4\. Not looked at yet: 1:06 \(their death\), 1:41 \(their death\)/);
  assert.equal(C.problemKind(few[0]), 'losses');
  assert.deepEqual(C.checkFinish({ found: false, why: 'Each death had its own cause; none repeated.' }, { ledger: lookedAt(14, 47, 101, 134), events: DEATHS, coverLosses: true }), []);
  assert.deepEqual(C.checkFinish({ found: false, why: 'Each death had its own cause; none repeated.' }, { ledger: lookedAt(14), events: DEATHS }), [], 'only when asked for');
  // a death counts as looked at from the second before its kill-feed line, when the fight happened
  assert.equal(C.losses([{ t: 20, kind: 'death' }], lookedAt(19))[0].seen, true);
});

test("a lost fight with no death in it is a loss of its own; one with the player's death is that death", () => {
  const events = [{ t: 30, kind: 'death' }, { t: 26, kind: 'engagement', from: 26, to: 31, outcome: 'lost' }, { t: 80, kind: 'engagement', from: 80, to: 86, outcome: 'lost' }, { t: 120, kind: 'engagement', from: 120, to: 125, outcome: 'won' }];
  const l = C.losses(events, lookedAt(82));
  assert.deepEqual(l.map((x) => [x.t, x.what, x.seen]), [[30, 'their death', false], [80, 'a fight they lost', true]]);
});

test('a finding has to be a supported theory on the board, with the moments it cites', () => {
  const ledger = looked(), board = (status, ts) => [{ id: 'T1', theory: 'Crosshair low', status, evidence: ts.map((t) => ({ t })), history: [status] }];
  assert.deepEqual(C.checkFinish(good, { ledger, duration: 120, habits: HABITS, measures: LOW }), [], 'only when there is a board to check');
  assert.deepEqual(C.checkFinish(good, { ledger, duration: 120, habits: HABITS, measures: LOW, board: board('supported', [10, 40.5, 71]) }), []);
  const testing = C.checkFinish(good, { ledger, duration: 120, habits: HABITS, measures: LOW, board: board('testing', [10, 40.5, 71]) });
  assert.equal(testing.length, 1);
  assert.match(testing[0], /^Put the finding on the board first: .*Not on a supported theory yet: 0:10, 0:40, 1:11\. The board now: T1 testing: Crosshair low/);
  assert.equal(C.problemKind(testing[0]), 'board');
  const part = C.checkFinish(good, { ledger, duration: 120, habits: HABITS, measures: LOW, board: board('supported', [10]) });
  assert.match(part[0], /Not on a supported theory yet: 0:40, 1:11\./);
});

test('with the kill feed read, the feed says how a fight ended, over the low-detail pass', () => {
  const seenFights = [{ from: 250, to: 258, outcome: 'lost', text: 'Player gets caught and is knocked' }];
  const events = [{ t: 257, kind: 'kill' }];
  const [byPass] = C.mergeFights([], seenFights, events);
  assert.equal(byPass.outcome, 'lost', 'without the feed the pass decides');
  const [byFeed] = C.mergeFights([], seenFights, events, [], { fromFeed: true });
  assert.equal(byFeed.outcome, 'won');
  assert.doesNotMatch(byFeed.text, /knocked/, "and the pass's story that disagrees is left out");
});

test('in a feed with many teams, a kill between two others stays theirs, and a knock says so', () => {
  const sightings = [
    { t: 10, killer: 'Pathfinder5758', victim: 'Horizon2416', killerSide: 'enemy', victimSide: 'enemy' },
    { t: 12, killer: 'Silent Gaming', victim: 'Sparrow9617', killerSide: 'ally', victimSide: 'enemy', knock: true },
    { t: 30, killer: 'Ltr7', victim: 'Conduit5722', killerSide: null, victimSide: null },
  ];
  const { events } = C.buildKillfeed(sightings, { player: 'Silent Gaming', twoTeams: false });
  assert.deepEqual(events.map((e) => [e.kind, e.killerTeam, e.victimTeam]), [['other', 'enemy', 'enemy'], ['kill', 'ally', 'enemy'], ['other', null, null]]);
  assert.equal(events[1].text, 'you knocked down Sparrow9617 (enemy)');
  // with two teams, a side the feed didn't show is the other team; with many, it stays unknown
  const half = [{ t: 5, killer: 'Ltr7', victim: 'Conduit5722', killerSide: 'enemy', victimSide: null }];
  assert.equal(C.buildKillfeed(half, { twoTeams: true }).events[0].kind, 'ally_death');
  assert.equal(C.buildKillfeed(half, { twoTeams: false }).events[0].kind, 'other');
});

test("a plain feed's squad is the names in a color other than most names'", () => {
  const s = (killer, killerColor, victim, victimColor) => ({ t: 1, killer, victim, killerColor, victimColor });
  const out = C.teamsByColor([
    s('Silent Gaming', 'orange', 'Sparrow9617', 'white'), s('Sparrow9617', 'white', 'FYR_rLayze', 'teal'), s('Pathfinder5758', 'white', 'Horizon2416', 'white'),
    s('Silent Gaming', 'white', 'Raygebait', 'white'), // scenery behind one reading: the name keeps the color of most of its lines
    s('Ltr7', 'white', 'Silent Gaming', 'orange'), s('Bangalore3870', 'white', 'Bazhard', 'white'), s('FYR_rLayze', 'teal', 'Conan', 'white'),
  ]);
  const side = (n) => out.flatMap((x) => [[x.killer, x.killerSide], [x.victim, x.victimSide]]).find(([m]) => m === n)[1];
  assert.deepEqual(['Silent Gaming', 'FYR_rLayze', 'Sparrow9617', 'Horizon2416'].map(side), ['ally', 'ally', 'enemy', 'enemy']);
  assert.equal(out[3].killerSide, 'ally');
  const mixed = C.teamsByColor([s('A1234', 'blue', 'B1234', 'red'), s('C1234', 'red', 'D1234', 'blue')]);
  assert.equal(mixed[0].killerSide ?? null, null, "without one plain color the colors don't say teams");
});

test("the game's banner names the player only when every banner agrees", () => {
  const events = [
    { t: 20, killer: 'FYR_rLayze', victim: 'Raygebait', killerTeam: 'ally', victimTeam: 'enemy' },
    { t: 47, killer: 'Silent Gaming', victim: 'Ltr7', killerTeam: 'ally', victimTeam: 'enemy' },
    { t: 257, killer: 'Silent Gaming', victim: 'Sparrow9617', killerTeam: 'ally', victimTeam: 'enemy' },
  ];
  const sightings = events.map((e) => ({ ...e, mine: false }));
  assert.equal(C.choosePlayer(events, sightings, [], [{ t: 47, says: 'you_downed', name: 'LTR7' }, { t: 257, says: 'you_downed', name: 'Sparrow9617' }]), 'Silent Gaming');
  // an assist banner, or a name borrowed from the next picture, points at someone else: then nobody is picked
  assert.equal(C.choosePlayer(events, sightings, [], [{ t: 20, says: 'you_downed', name: 'Raygebait' }, { t: 47, says: 'you_downed', name: 'LTR7' }]), null);
  assert.equal(C.choosePlayer(events, sightings, [], [{ t: 47, says: 'none', name: '' }]), null);
  const mine = C.buildKillfeed(sightings, { player: 'Silent Gaming', twoTeams: false }).events;
  C.confirmByBanners(mine, [{ t: 257.5, says: 'you_downed', name: 'SPARROW9617' }]);
  assert.deepEqual(mine.map((e) => !!e.confirmed), [false, false, true]);
  assert.match(mine[2].text, /banner shows it too/);
});

// a strip of fake text: bright strokes 2 px wide with dark gaps, where `color` says what color, at [x0, x1)
function fakeText(w, h, runs) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 30; data[i * 4 + 1] = 30; data[i * 4 + 2] = 35; data[i * 4 + 3] = 255; }
  for (const { y0, y1, x0, x1, rgb } of runs) for (let y = y0; y <= y1; y++) for (let x = x0; x < x1; x++) if (x % 4 < 2) data.set([...rgb, 255], (y * w + x) * 4);
  return { data, width: w, height: h };
}
const WHITE = [235, 235, 235], TEAL = [70, 215, 195], GOLD = [235, 200, 90];

test('plain-text kill-feed lines are bands of text on a shared edge, with each name colored from its own pixels', () => {
  const img = fakeText(600, 120, [
    { y0: 10, y1: 25, x0: 300, x1: 420, rgb: WHITE }, { y0: 10, y1: 25, x0: 470, x1: 572, rgb: TEAL },
    { y0: 50, y1: 65, x0: 220, x1: 343, rgb: GOLD }, { y0: 53, y1: 62, x0: 362, x1: 402, rgb: WHITE }, { y0: 50, y1: 65, x0: 456, x1: 572, rgb: WHITE }, // killer, weapon icon, victim
    { y0: 90, y1: 104, x0: 100, x1: 300, rgb: WHITE }, // an overlay line that doesn't end on the edge
  ]);
  const rows = C.textRows(img);
  assert.equal(rows.length, 3);
  const edge = C.textEdge([rows, rows, rows], 600);
  assert.equal(edge.key, 'x1');
  assert.deepEqual(rows.map((r) => C.onEdge(r, edge)), [true, true, false]);
  const strip = (r) => ({ data: img.data.slice(r.y0 * 600 * 4, (r.y1 + 1) * 600 * 4), width: 600, height: r.y1 - r.y0 + 1 });
  const colors = rows.slice(0, 2).map((r) => { const c = C.nameColors(strip(r), r); return [c.left, c.right]; });
  assert.deepEqual(colors, [['white', 'teal'], ['yellow', 'white']]);
});

test('where a match was lost: deaths, lost fights, teammates down untraded, and moves the engine flags', () => {
  const events = [
    { t: 30, kind: 'death' },
    { t: 50, kind: 'ally_death', victim: 'FYR_rLayze', tradedBy: 'Silent Gaming' },
    { t: 90, kind: 'ally_death', victim: 'O5HK', near: true }, { t: 95, kind: 'ally_death', victim: 'O5HK', near: false },
    { t: 120, kind: 'engagement', from: 120, to: 126, outcome: 'lost' },
    { t: 150, kind: 'engagement', from: 150, to: 155, outcome: 'won' },
    { t: 200, kind: 'move', san: 'Nce5', grade: 'blunder' }, { t: 210, kind: 'move', san: 'c3' },
  ];
  assert.deepEqual(C.lossMoments(events).map((l) => [l.t, l.what]), [[30, 'their death'], [90, 'O5HK down near them, not traded'], [120, 'a fight they lost'], [200, 'Nce5 (blunder)']]);
  assert.equal(C.atLoss(events, 25), true, 'the seconds before a death show it');
  assert.equal(C.atLoss(events, 50), false, 'a traded teammate is no loss');
  assert.equal(C.atLoss(events, 152), false);
});

test('a finding has to cite two or more separate losses', () => {
  const ledger = lookedAt(11, 41, 71), finding = { ...good, habit_id: 'wide_peek', evidence: [{ t: '0:10', what: 'a' }, { t: '0:40', what: 'b' }, { t: '1:10', what: 'c' }] };
  const won = [{ t: 41, kind: 'kill' }, { t: 100, kind: 'death' }];
  const p = C.checkFinish(finding, { ledger, duration: 120, habits: HABITS, events: won, citeLoss: true });
  assert.equal(p.length, 1);
  assert.match(p[0], /has to show where they lost, at 2 or more separate losses: .*You cite 0 \(in this match: 1:40 their death\)\. If they don't show it, finish with found false\./);
  assert.equal(C.problemKind(p[0]), 'no_loss');
  const one = C.checkFinish(finding, { ledger, duration: 120, habits: HABITS, events: [...won, { t: 72, kind: 'death' }], citeLoss: true });
  assert.match(one[0], /You cite 1 /, 'one loss is an incident, not a habit');
  assert.deepEqual(C.checkFinish(finding, { ledger, duration: 120, habits: HABITS, events: [...won, { t: 72, kind: 'death' }, { t: 12, kind: 'death' }], citeLoss: true }), [], 'two separate losses');
  assert.deepEqual(C.checkFinish(finding, { ledger, duration: 120, habits: HABITS, events: won }), [], 'only when asked for');
});

test("one colored reading doesn't put a name in the squad", () => {
  const s = (killer, killerColor, victim, victimColor) => ({ t: 1, killer, victim, killerColor, victimColor });
  const out = C.teamsByColor([
    s('Silent Gaming', 'orange', 'Raygebait', 'white'), s('Ltr7', 'white', 'Silent Gaming', 'orange'), s('Catalyst8175', 'white', 'Twitch.tv/InFameX327', 'purple'),
    s('@RinxPrime', 'white', '11', 'teal'), s('11', 'teal', 'Bazhard', 'white'), s('Bangalore3870', 'white', 'Horizon2416', 'white'),
  ]);
  const side = (n) => out.flatMap((x) => [[x.killer, x.killerSide], [x.victim, x.victimSide]]).find(([m]) => m === n)[1];
  assert.deepEqual(['Silent Gaming', 'Twitch.tv/InFameX327', '11', 'Raygebait'].map(side), ['ally', null, null, 'enemy']);
});

// ---- every event read as video ----
test('a window around every kill, death, teammate down, and burst of firing, merged when they overlap', () => {
  const events = [
    { t: 0, kind: 'kill' }, // seen at the first sample: it happened before the recording
    { t: 25, kind: 'ally_death', victim: 'FYR_rLayze' }, { t: 47, kind: 'kill' }, { t: 53, kind: 'kill' },
    { t: 120, kind: 'other' }, { t: 257, kind: 'kill' }, { t: 256, kind: 'ally_death', victim: 'FYR_rLayze' },
  ];
  const firing = [{ from: 43.8, to: 46.8 }, { from: 277.5, to: 295 }];
  const w = C.eventWindows(events, firing, { duration: 369 });
  assert.deepEqual(w.map((x) => [x.from, x.to, x.events.map((e) => e.t), x.firing.length]), [
    [18, 28, [25], 0], [40, 50, [47], 1], [46, 56, [53], 0], [249, 260, [256, 257], 0], [275.5, 285.5, [], 1],
  ]);
  const few = C.eventWindows(events, firing, { duration: 369, max: 2 });
  assert.deepEqual(few.map((x) => x.from), [18, 249], 'with too many, teammates down and kills come before firing alone');
});

test('fights come from the clip reads; the kill feed says how they ended, the clip how they went', () => {
  const events = [{ t: 25, kind: 'ally_death', killer: 'Ltr7', victim: 'FYR_rLayze', victimTeam: 'ally', killerTeam: 'enemy' }, { t: 47, kind: 'kill', victim: 'Raygebait' }];
  const windows = [{ from: 18, to: 28, events: [events[0]], firing: [] }, { from: 40, to: 50, events: [events[1]], firing: [] }, { from: 100, to: 108, events: [], firing: [{ from: 102, to: 104 }] }];
  const readings = [
    { fight: 'enemy_engaged', story: 'An enemy pushed through the doorway.', downed: [{ name: 'FYR_rLayze', near: true, how_far: 'one doorway ahead' }] },
    { fight: 'player_engaged', story: 'They shot first down the hallway.', downed: [] },
    { fight: 'no_fight', story: 'They reloaded.', downed: [] },
  ];
  const fights = C.fightsFromClips(windows, readings, events);
  assert.deepEqual(fights.map((f) => [f.from, f.outcome, f.startedBy]), [[18, 'none', 'enemy_engaged'], [40, 'won', 'player_engaged']], 'a reload with nothing in the feed is no fight');
  assert.equal(events[0].near, true);
  assert.match(events[0].text, /near you/);
  assert.deepEqual(C.lossMoments(events).map((l) => l.what), ['FYR_rLayze down near them, not traded']);
  events[0].near = false;
  assert.deepEqual(C.lossMoments(events), [], 'a teammate down away from the player is not their loss');
});

test("a clip read's moments are put on the match's clock", () => {
  const w = { from: 249, to: 259 };
  assert.deepEqual(C.clipMoments([{ t: '4:16', what: 'opens fire' }, { t: '9:00', what: 'outside' }], w).map((m) => m.t), [256]);
  assert.deepEqual(C.clipMoments([{ t: '0:07', what: 'opens fire' }, { t: '0:09', what: 'knocks him' }], w).map((m) => m.t), [256, 258], 'timed from the clip start');
});

test('in a game played in rounds, a death lasts the round even with no round start seen', () => {
  assert.equal(C.deadForOf({ rounds: true, deadFor: { rounds: 30, respawn: 5 } }, []), 30);
  assert.equal(C.deadForOf({ rounds: false, deadFor: { rounds: 30, respawn: 5 } }, []), 5);
});

test("a counter's rises need a later reading to confirm them, so misreads drop out", () => {
  const r = [[0, 469], [8, 589], [10, 569], [20, 684], [30, 678], [32, 692], [44, null], [46, 759], [48, 835]].map(([t, value]) => ({ t, value }));
  assert.deepEqual(C.counterRises(r), [{ t: 10, by: 100 }, { t: 20, by: 115 }, { t: 32, by: 8 }, { t: 46, by: 67 }, { t: 48, by: 76 }]);
  const kills = C.hudKills([{ t: 32, by: 1 }, { t: 272, by: 1 }], [{ t: 33, kind: 'kill' }]);
  assert.deepEqual(kills.map((k) => [k.t, k.kind, k.seenBy]), [[272, 'kill', 'hud']], 'a rise the kill feed already has is not counted twice');
});

test('fights from the damage counter are read at high detail, ranked with kills', () => {
  const w = C.eventWindows([], [{ from: 180, to: 186 }], { duration: 369, hits: [{ from: 44, to: 55 }] });
  assert.deepEqual(w.map((x) => [x.from, x.to, x.hits.length, x.firing.length]), [[42, 52, 1, 0], [178, 188, 0, 1]]);
  const fights = C.fightsFromClips(w, [{ fight: 'no_fight', story: 'They looked around.' }, { fight: 'no_fight', story: 'They reloaded.' }], []);
  assert.deepEqual(fights.map((f) => f.from), [42], 'damage dealt is a fight whatever the clip says; firing alone can be a reload');
});

test('a name read short is the full name, and a kill inside the squad is a misread line', () => {
  const s = (t, killer, victim, kc, vc) => ({ t, killer, victim, killerColor: kc, victimColor: vc });
  const sightings = C.teamsByColor([
    s(10, 'FYR_rLayze', 'Raygebait', 'teal', 'white'), s(25, 'Ltr7', 'FYR_rLayze', 'white', 'teal'), s(40, 'Silent Gaming', 'Ltr7', 'orange', 'white'),
    s(47, 'Silent Gaming', 'Raygebait', 'orange', 'white'), s(60, 'Pathfinder5758', 'Horizon2416', 'white', 'white'), s(70, 'Swxxvy', 'Conan', 'white', 'white'),
    s(109, 'r_Layze', 'Silent Gaming', 'white', 'orange'), // "FYR_rLayze: Thanks Silent Gaming." read as a kill
  ]);
  assert.equal(sightings[6].killer, 'FYR_rLayze');
  const { events } = C.buildKillfeed(sightings, { player: 'Silent Gaming', twoTeams: false, window: 20 });
  assert.equal(events.some((e) => e.t === 109), false, 'no death of theirs at 1:49');
  assert.equal(events.filter((e) => e.kind === 'death').length, 0);
});

test("in a feed of many teams, a teammate's death is traded only by their own team", () => {
  const sightings = [
    { t: 25, killer: 'Ltr7', victim: 'FYR_rLayze', killerSide: 'enemy', victimSide: 'ally' },
    { t: 26, killer: 'LE KARNAGE', victim: 'Ltr7', killerSide: 'enemy', victimSide: 'enemy' },
    { t: 256, killer: 'Sparrow9617', victim: 'FYR_rLayze', killerSide: 'enemy', victimSide: 'ally' },
    { t: 257, killer: 'Silent Gaming', victim: 'Sparrow9617', killerSide: 'ally', victimSide: 'enemy' },
  ];
  const { events } = C.buildKillfeed(sightings, { player: 'Silent Gaming', twoTeams: false });
  assert.deepEqual(events.filter((e) => e.kind === 'ally_death').map((e) => [e.t, e.tradedBy || null]), [[25, null], [256, 'Silent Gaming']]);
});

test('two reads of a feed line: a kill either finds stays, and a line either calls a message goes', () => {
  const st = (id, t) => ({ id, t, after: t - 1, colors: { left: 'white', right: 'white' }, row: { fp: [1, 2] } });
  const rows = [
    { r: { kind: 'kill', text: 'Silent Gaming [Bleed Out] ArianaRei', killer: 'Silent Gaming', victim: 'ArianaRei' }, st: st(1, 32) },
    { r: { kind: 'other', text: '' }, st: st(1, 32) }, // the other read missed it
    { r: { kind: 'kill', text: 'r_Layze Silent Gaming', killer: 'r_Layze', victim: 'Silent Gaming' }, st: st(2, 109) },
    { r: { kind: 'message', text: 'FYR_rLayze: Thanks Silent Gaming.' }, st: st(2, 109) }, // the chat line, read right once
    { r: { kind: 'kill', text: 'r_Layze: Thanks Silent Gaming', killer: 'r_Layze: Thanks', victim: 'Silent Gaming' }, st: st(3, 140) }, // a colon: chat
    { r: { kind: 'knock', text: 'Silent Gaming Sparrow9617', killer: 'Silent Gaming', victim: 'Sparrow9617' }, st: st(4, 257) },
    { r: { kind: 'knock', text: 'Silent Gaming Sparrow9617', killer: 'Silent Gaming', victim: 'Sparrow9617' }, st: st(4, 257) },
  ];
  const out = C.textFeedReads(rows);
  assert.deepEqual(out.map((x) => [x.t, x.killer, x.victim, !!x.knock]), [[32, 'Silent Gaming', 'ArianaRei', false], [257, 'Silent Gaming', 'Sparrow9617', true], [257, 'Silent Gaming', 'Sparrow9617', true]]);
});

test("a teammate going down while the player is dead isn't the player's loss, and gets no clip", () => {
  const events = [{ t: 41, kind: 'death' }, { t: 48, kind: 'ally_death', victim: 'Chamber', near: true }, { t: 111, kind: 'ally_death', victim: 'Chamber', near: true }];
  assert.deepEqual(C.lossMoments(events, { deadFor: 30 }).map((l) => l.t), [41, 111]);
  assert.deepEqual(C.eventWindows(events, [], { duration: 388, deadFor: 30 }).map((w) => w.events.map((e) => e.t)), [[41], [111]]);
});

// ---------- footage of the whole match ----------
test('camera cuts are single samples of big change, not fast motion', () => {
  // a still pre-snap, a cut, a fast pan with high change throughout, then another cut
  const m = [1, 1.2, 0.9, 1.1, 40, 1.5, 12, 14, 13, 15, 14, 36, 0.8, 1];
  const diffs = m.map((x, i) => ({ t: i * 0.25, m: x }));
  assert.deepEqual(C.cutTimes(diffs), [1, 2.75]);
  assert.deepEqual(C.cutTimes([]), []);
});

test("units' edges move to the nearest cut, else are padded, and never overlap", () => {
  const units = [{ from: 12, to: 27, text: 'a' }, { from: 26, to: 40, text: 'b' }, { from: 60, to: 61, text: 'short' }];
  const out = C.snapUnits(units, [10.5, 28.5, 41], { tol: 4, pad: 1.5, duration: 100 });
  assert.deepEqual(out.map((u) => [u.from, u.to, u.text]), [[10.5, 28.5, 'a'], [28.5, 41, 'b'], [58.5, 62.5, 'short']]);
  // no cuts: padded, and two padded units that overlap meet halfway
  assert.deepEqual(C.snapUnits([{ from: 12, to: 27 }, { from: 24, to: 40 }], [], { pad: 1.5 }).map((u) => [u.from, u.to]), [[10.5, 25.5], [25.5, 41.5]]);
  assert.deepEqual(C.snapUnits([{ from: 1, to: 2.2 }], [], { pad: 0 }), []);
});

test('a read unit becomes a play with its outcome; an unread one waits, and blocks no ending once read', () => {
  const windows = [{ id: 'W1', from: 0, to: 12, unit: 'play', events: [], firing: [], hits: [] }, { id: 'W2', from: 12, to: 25, unit: 'play', events: [], firing: [], hits: [] }];
  const readings = [{ outcome: 'lost', outcome_why: 'The pass fell incomplete.', decided_by: 'player', player_seen: true, moments: [] }, null];
  const plays = C.fightsFromClips(windows, readings, []);
  assert.deepEqual(plays.map((e) => [e.kind, e.from, e.to, e.outcome, e.decidedBy]), [['play', 0, 12, 'lost', 'player']]);
  assert.match(plays[0].text, /^lost; decided by the player; The pass fell incomplete\./);
  assert.deepEqual(C.unreadUnits([{ ...windows[0], reading: readings[0] }, { ...windows[1], reading: null }]).map((u) => [u.t, u.window]), [[12, 'W2']]);
  // a lost play is a loss the review has to look at and a finding has to show
  assert.deepEqual(C.lossMoments(plays).map((l) => [l.t, l.what]), [[0, 'a play they lost']]);
  assert.deepEqual(C.losses(plays, C.createLedger()).map((l) => [l.t, l.what, l.seen]), [[0, 'a play they lost', false]]);
  // neither won nor lost: no loss
  const even = C.fightsFromClips([windows[0]], [{ outcome: 'neutral', outcome_why: 'A short gain.', decided_by: 'unclear' }], []);
  assert.equal(even[0].outcome, 'none');
  assert.deepEqual(C.lossMoments(even), []);
});

// ---------- the HUD's own record ----------
const series = (vals, step = 2) => vals.map((value, i) => ({ t: i * step, value }));
test("the HUD's K/D/A counter says when the player died and killed; a misread blip isn't a death", () => {
  const counts = { cells: 10, kills: series([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), deaths: series([4, 4, 4, 5, 5, 5, 4, 5, 6, 6]) };
  const hud = C.hudRecord(counts, {});
  assert.deepEqual(hud.deaths.map((d) => [d.t, d.kind]), [[6, 'death'], [16, 'death']]);
  assert.deepEqual(hud.kills, []);
  assert.deepEqual(hud.knows, { kills: true, deaths: true, health: false });
  // the HP number at 0: one death per stretch at 0, however long the death screen lasts
  const hp = C.hudRecord({ cells: 10, health: series([250, 120, 32, 0, 0, 250, 250, 0, 0, 0]) });
  assert.deepEqual(hp.downs.map((d) => d.t), [6, 14]);
  // a K/D/A read as 1/6/5 for a few moments, then 1/5/6 again: no death
  assert.deepEqual(C.hudRecord({ cells: 12, deaths: series([5, 5, 5, 6, 6, 5, 5, 5, 5, 5, 5, 5]) }).deaths, []);
  // one death per death: a second seen within seconds of the first is the same one
  assert.deepEqual(C.oneDeathEach([{ t: 267, kind: 'death' }, { t: 271, kind: 'death' }, { t: 290, kind: 'death' }, { t: 270, kind: 'kill' }]).map((e) => [e.t, e.kind]), [[267, 'death'], [290, 'death'], [270, 'kill']]);
  assert.equal(hp.knows.health, true);
  assert.deepEqual(C.hudRecord({ cells: 10, deaths: series([1, 2]) }).knows.deaths, false);
});

test("the pass's deaths the counter doesn't show are dropped, the ones it does take the counter's time, and missed ones are added", () => {
  const pass = [{ t: 5, kind: 'death', text: 'Player dies' }, { t: 40, kind: 'death', text: 'Player dies' }, { t: 41, kind: 'engagement', from: 36, to: 41, outcome: 'lost', text: 'lost' }];
  const r = C.trustCounter(pass, [{ t: 6, kind: 'death', seenBy: 'hud', text: 'you died' }, { t: 90, kind: 'death', seenBy: 'hud', text: 'you died' }], 'death');
  assert.deepEqual(r.events.filter((e) => e.kind === 'death').map((e) => [e.t, e.seenBy]), [[6, 'hud'], [90, 'hud']]);
  assert.deepEqual(r.dropped.map((d) => d.t), [40]);
  // the fight that "ended" in the dropped death has no death in it now
  assert.equal(C.settleFights(r.events).find((e) => e.kind === 'engagement').outcome, 'none');
});

test("a sports scoreboard's points are the player's side's or the other's, and a goal read as a death goes", () => {
  const counts = { cells: 8, scores: { orange: series([0, 1, 1, 2, 2, 2, 3, 3]), blue: series([0, 0, 0, 0, 1, 1, 1, 1]) } };
  const hud = C.hudRecord(counts, { side: 'orange' });
  assert.deepEqual(hud.points.map((p) => [p.t, p.kind]), [[2, 'point_won'], [6, 'point_won'], [8, 'point_lost'], [12, 'point_won']]);
  assert.ok(C.sameSide('orange team', 'Orange') && !C.sameSide('orange', 'blue') && !C.sameSide('', 'blue'));
  assert.deepEqual(C.pointsTaken([{ t: 3, kind: 'death' }, { t: 30, kind: 'death' }, { t: 9, kind: 'kill' }], hud.points).map((e) => e.t), [30]);
  // the other side's point is a loss the review has to look at; the player's side's isn't
  assert.deepEqual(C.lossMoments(hud.points).map((l) => [l.t, l.what]), [[8, 'a point the other side scored']]);
  assert.deepEqual(C.hudRecord(counts, {}).points.map((p) => p.kind), ['point', 'point', 'point', 'point']);
});

test("a counter judges only the deaths it was read around; the rest are left for a second look", () => {
  const readings = [...series([4, 4, 4, 4, 4]), ...series([5, 5, 5], 2).map((x) => ({ ...x, t: x.t + 100 }))]; // read 0-8 s and 100-104 s
  const pass = [{ t: 4, kind: 'death', text: 'dies' }, { t: 50, kind: 'death', text: 'dies' }];
  const r = C.trustCounter(pass, [], 'death', { readings });
  assert.deepEqual(r.dropped.map((d) => d.t), [4]); // read on both sides, and the count didn't move: no death
  assert.deepEqual(r.unjudged.map((d) => d.t), [50]); // nothing read near it: not the counter's to say
});

test("a kill feed's kills checked against the K/D/A keep the feed's own times", () => {
  // League's chat read as its kill feed: a kill at 59 s the K/D/A never counted, one at 120.4 s it did
  const feed = [{ t: 59, kind: 'kill', seenBy: 'feed', text: 'you killed A' }, { t: 120.4, kind: 'kill', seenBy: 'feed', text: 'you killed B' }];
  const r = C.trustCounter(feed, [{ t: 122, kind: 'kill', seenBy: 'hud', text: 'you got a kill' }], 'kill', { keepTime: true });
  assert.deepEqual(r.events.map((e) => [e.t, e.seenBy]), [[120.4, 'feed']]);
  assert.deepEqual(r.dropped.map((d) => d.t), [59]);
});

test("with the scoreboard's points, the pass's own goal guesses go", () => {
  const points = [{ t: 208, kind: 'point_won' }];
  const pass = [{ t: 207, kind: 'point_lost', text: 'Thesomey scored against player' }, { t: 120, kind: 'point_won' }, { t: 90, kind: 'kill' }];
  assert.deepEqual(C.pointsTaken(pass, points).map((e) => [e.t, e.kind]), [[90, 'kill']]);
});

test('the name the learn call read is offered first when the feed shows it', () => {
  const sightings = [{ killer: 'Punk10', victim: 'S' }, { killer: 'Punk10', victim: 'lu' }, { killer: 'Alejos2001', victim: 'M' }];
  const events = [{ killer: 'Punk10', killerTeam: 'enemy', victim: 'S', victimTeam: 'ally' }, { killer: 'Alejos2001', killerTeam: 'enemy', victim: 'M', victimTeam: 'ally' }, { killer: 'Punk10', killerTeam: 'enemy', victim: 'lu', victimTeam: 'ally' }];
  assert.equal(C.whoIsPlayer({ events, sightings, hint: 'PunK10' }).ask[0], 'Punk10');
  assert.ok(!C.whoIsPlayer({ events, sightings }).ask.includes('Punk10'));
});

test("the player's own rows fix which team color is theirs, and a feed of cut-off names is told apart", () => {
  // the learned colors are the wrong way round: the player's kills read as the 'enemy' color
  const sightings = [
    { t: 10, killer: 'PunK10', victim: 'VEN', killerSide: 'enemy', victimSide: 'ally' },
    { t: 30, killer: 'PunK10', victim: 'MR.ELK', killerSide: 'enemy', victimSide: 'ally' },
    { t: 50, killer: 'NaturalKickZ', victim: 'StarBoii', killerSide: 'enemy', victimSide: 'ally' },
    { t: 70, killer: 'VEN', victim: 'Alejos2001', killerSide: 'ally', victimSide: 'enemy' },
  ];
  const r = C.buildKillfeed(sightings, { player: 'PunK10' });
  assert.equal(r.flipped, true);
  assert.deepEqual(r.events.map((e) => [e.t, e.kind]), [[10, 'kill'], [30, 'kill'], [50, 'ally_kill'], [70, 'ally_death']]);
  assert.equal(C.cutNames([{ killer: 'PunK10', victim: 'S' }, { killer: 'VEN', victim: 'lu' }, { killer: 'A', victim: 'B' }, { killer: 'Alejos2001', victim: 'MR.ELK' }]), 0.75);
  assert.equal(C.cutNames([{ killer: 'PunK10', victim: 'VEN' }]), 0);
});

test('a sparse counter read through the match and a fine one around what happened read as one', () => {
  // the K/D/A every 6 s, its death rise at 108; the fine read around it, every 2 s, finds it at 104
  const coarse = { kills: [], deaths: [96, 102, 108, 114, 120, 126, 132, 138].map((t) => ({ t, value: t < 108 ? 4 : 5 })), assists: [], damage: [], health: [], healthMax: [], scores: { Blue: [{ t: 96, value: 1 }] }, cells: 8, times: [96, 102, 108, 114, 120, 126, 132, 138], asked: ['kill_count', 'scoreboard'], calls: 1 };
  const spans = C.riseSpans(coarse, 6);
  assert.deepEqual(spans, [[101, 109]]);
  const at = C.timesIn(spans, { from: 0, to: 600, step: 2 }).filter((t) => !coarse.times.includes(t));
  assert.deepEqual(at, [104, 106]);
  const fine = { kills: [], deaths: [{ t: 104, value: 5 }, { t: 106, value: 5 }], assists: [], damage: [], health: [{ t: 104, value: 0 }, { t: 106, value: 0 }], healthMax: [], scores: { 'blue team': [{ t: 104, value: 1 }] }, cells: 2, times: at, asked: ['health', 'kill_count', 'scoreboard'], calls: 1 };
  const m = C.mergeCounts(coarse, fine);
  assert.deepEqual(m.deaths.map((x) => x.t), [96, 102, 104, 106, 108, 114, 120, 126, 132, 138]);
  assert.deepEqual(C.counterRises(m.deaths), [{ t: 104, by: 1 }]);
  assert.deepEqual(Object.keys(m.scores), ['Blue']); // one side under one name
  assert.equal(m.cells, 10); assert.equal(m.calls, 2);
  // health was asked only around the death: it's known by those 2 moments, not all 10
  assert.deepEqual([m.cellsFor.health, m.cellsFor.kill_count], [2, 10]);
  assert.equal(C.hudRecord(m).knows.health, true);
  assert.equal(C.hudRecord({ ...m, cellsFor: undefined }).knows.health, false);
  assert.equal(C.mergeCounts(null, null), null);
  assert.equal(C.mergeCounts(coarse, null).deaths.length, 8);
});

test('the HP number under a quarter of full health, the reading next to it low too, is a near-death', () => {
  // Marvel Rivals, 1:17-1:21 and 4:26-4:31: 80 then 50 of 250 and healed (a near-death); 121 then 0 (the death itself)
  const hp = [[71, 250], [73, 250], [75, 250], [77, 80], [79, 50], [81, 139], [83, 250], [262, 250], [264, 250], [266, 121], [268, 0], [270, 0], [272, 250], [300, 250], [302, 40], [304, 250]].map(([t, value]) => ({ t, value }));
  const near = C.nearDeaths(hp, { maxes: [{ t: 71, value: 250 }], deaths: [{ t: 267.3 }] });
  // the lone 40 at 302 is as likely a misread as a dip read once: it's kept, marked for a second look
  assert.deepEqual(near.map((e) => [e.t, e.hp, e.of, e.sure]), [[79, 50, 250, true], [302, 40, 250, false]]);
  // a fall to near nothing just before a death is the death, not a near-death
  assert.deepEqual(C.nearDeaths([...series([100, 100, 30, 20, 100]), { t: 10, value: 100 }], { deaths: [{ t: 9 }] }), []);
  // with no full health written, the health read most often stands in
  assert.deepEqual(C.nearDeaths(series([100, 100, 100, 35, 20, 100])).map((e) => e.t), [8]);
  // full health is the one written nearest the moment: League's grows with each level (1373 at 1:22, 1589 at 4:30)
  const lol = [[80, 609], [82, 488], [84, 601], [266, 940], [268, 807], [270, 280], [272, 303]].map(([t, value]) => ({ t, value }));
  const tops = [[80, 1373], [82, 1373], [84, 1479], [266, 1589], [268, 1589], [270, 1589], [272, 1589]].map(([t, value]) => ({ t, value }));
  // 488 of 1373 (36%) is only a candidate for the second look; 280 of 1589, read low twice, is sure
  assert.deepEqual(C.nearDeaths(lol, { maxes: tops }).map((e) => [e.t, e.hp, e.of, e.sure]), [[82, 488, 1373, false], [270, 280, 1589, true]]);
  // a near-death is a loss a habit can show at, like a death
  assert.deepEqual(C.lossMoments(near.slice(0, 1)).map((l) => [l.t, l.what]), [[79, 'a near-death (health 50 of 250)']]);
  assert.equal(C.losses(near, C.createLedger())[0].what, 'a near-death (health 50 of 250)');
});

test('with no habit and a loss in the match, finish names the biggest reason, at a loss it looked at', () => {
  const ledger = C.createLedger();
  for (const t of [20, 60]) C.recordLook(ledger, { from: t - 1, to: t + 1, kind: 'frames' });
  const events = [{ t: 62, kind: 'death' }], opts = { ledger, duration: 120, events, citeLoss: true };
  const why = 'They pushed into two enemies alone and died before help came.';
  const bare = C.checkFinish({ found: false, why }, opts);
  assert.ok(bare.some((p) => /Name the biggest reason they lost in this match \(reason\), even if it happened once: what cost them the most at 1:02 their death/.test(p)));
  assert.equal(C.problemKind(bare.find((p) => /Name the biggest reason/.test(p))), 'no_reason');
  // its moments have to be looked at, and one of them where they lost
  const away = C.checkFinish({ found: false, why, reason: 'Pushing alone', fixes: [{ t: '0:20', what: 'walks out alone', better: 'wait for a teammate' }] }, opts);
  assert.deepEqual(away.map(C.problemKind), ['no_reason']);
  assert.deepEqual(C.checkFinish({ found: false, why, reason: 'Pushing alone', fixes: [{ t: '1:00', what: 'pushes two enemies alone', better: 'wait for a teammate' }] }, opts), []);
  // a match with nothing lost has nothing to explain
  assert.deepEqual(C.checkFinish({ found: false, why: 'Nothing was lost in this match.' }, { ...opts, events: [] }), []);
});

test('the claims planted for the checker are ones the record shows are false, near the finding\'s own moments', () => {
  const events = [{ t: 14.6, kind: 'death' }, { t: 120, kind: 'death' }, { t: 79, kind: 'near_death', hp: 50, of: 250 }, { t: 200, kind: 'point_lost' }];
  const moments = [{ t: 60 }, { t: 85 }];
  // a death at a quiet moment near a cited one (nothing in the record within 12 s, and not within a minute after a death
  // of theirs: 42 s is 27 s after the one at 14.6 s, and they may still be on its screen), and the near-death called full
  assert.deepEqual(C.controlClaims(events, moments, { duration: 300 }).map((c) => [c.t, c.what]), [[79, "The player's health is full here."], [103, 'The player dies here.']]);
  // one of the player's kills, with no death of theirs near it, called their death
  assert.deepEqual(C.controlClaims([{ t: 30, kind: 'kill' }, { t: 50, kind: 'kill' }, { t: 55, kind: 'death' }], [{ t: 40 }], { max: 1 }).map((c) => [c.t, c.what]), [[30, 'The player is killed here.']]);
  // with the record's deaths unchecked, no death is planted: it might be one
  assert.deepEqual(C.controlClaims(events, moments, { sure: false }).map((c) => c.what), ["The player's health is full here.", "The player's own side scores here."]);
  // one within 6 s of a cited moment would be judged on the same pictures as the claim: left out
  assert.deepEqual(C.controlClaims([{ t: 84, kind: 'near_death', hp: 50, of: 250 }], moments, { sure: false }), []);
});

test("a kill-feed name's character is kept only when two or more reads of it agree", () => {
  const sightings = [
    { t: 10, killer: 'VEÑ', victim: 'PunK10', killerChar: 'Hela' }, { t: 11, killer: 'VEN', victim: 'PunK10', killerChar: 'Hela' },
    { t: 40, killer: 'PunK10', victim: 'MR.ELK', victimChar: 'Rocket Raccoon' }, // one read: not enough
    { t: 70, killer: 'StarBoii', victim: 'PunK10', killerChar: 'Luna Snow' }, { t: 71, killer: 'StarBoii', victim: 'PunK10', killerChar: 'Hela' },
  ];
  const chars = C.feedCharacters(sightings);
  assert.equal(chars.get(C.nameKey('VEN')), undefined); // VEÑ and VEN are two keys; each has one read
  assert.equal(chars.get(C.nameKey('VEÑ')), undefined);
  assert.equal(C.feedCharacters([sightings[0], { ...sightings[0], t: 12 }]).get(C.nameKey('VEÑ')), 'Hela');
  assert.equal(chars.get(C.nameKey('MR.ELK')), undefined);
  assert.equal(chars.get(C.nameKey('StarBoii')), undefined); // the reads disagree
  assert.match(C.feedText({ kind: 'death', killer: 'VEÑ', victim: 'PunK10', killerTeam: 'enemy', victimIsPlayer: true, killerCharacter: 'Hela' }), /^VEÑ \(Hela, enemy\) killed you/);
});
