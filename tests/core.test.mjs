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

test('moments they got right go in contrast, never in both lists', () => {
  const ledger = C.recordLook(looked(), { from: 100, to: 101, kind: 'frames' });
  const ok = C.checkFinish({ ...good, contrast: [{ t: '1:40.5', what: 'On the head and won' }] }, { ledger, duration: 120, habits: HABITS, measures: LOW });
  assert.deepEqual(ok, []);
  const both = C.checkFinish({ ...good, contrast: [{ t: '0:40.5', what: 'won this one' }, { t: '1:45', what: 'never looked' }] }, { ledger: looked(), duration: 120, habits: HABITS });
  assert.ok(both.some((x) => /0:40 is in both evidence and contrast/.test(x)));
  assert.ok(both.some((x) => /haven't looked closely at 1:45 \(in contrast\)/.test(x)));
});

// a fake kill-feed crop: rows of team-colored bars, killer side then victim side
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
  const rows = C.killfeedRows(feedImage([{ y: 10, left: 'ally', right: 'enemy', yellow: true }, { y: 36, left: 'enemy', right: 'ally' }]));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.left, r.right]), [['ally', 'enemy'], ['enemy', 'ally']]);
  assert.deepEqual(C.killfeedRows(feedImage([])), []);
  const touching = C.killfeedRows(feedImage([{ y: 10, left: 'ally', right: 'enemy' }, { y: 31, left: 'enemy', right: 'ally' }, { y: 60, left: 'ally', right: 'ally' }]));
  assert.equal(touching.length, 3, 'two rows that touch are split apart');
});

test("on the game's grid, a row is a slot that's mostly team color", () => {
  const img = feedImage([{ y: 10, left: 'ally', right: 'enemy' }, { y: 36, left: 'enemy', right: 'ally' }]);
  const { data, width } = img;
  for (let y = 66; y <= 84; y++) for (let x = 20; x <= 160; x++) { const i = (y * width + x) * 4; data[i] = 225; data[i + 1] = 75; data[i + 2] = 85; } // a red wall at the left of slot 3
  for (let y = 88; y <= 108; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; data[i] = 80; data[i + 1] = 200; data[i + 2] = 170; } // a teal flash across slot 4
  for (const y0 of [10, 36]) for (let y = y0; y <= y0 + 20; y++) for (let x = 322; x <= 340; x++) { const i = (y * width + x) * 4; data[i] = 230; data[i + 1] = 80; data[i + 2] = 120; } // red-toned victim portraits
  const grid = { top: 10 / 120, pitch: 26 / 120, height: 21 / 120, portrait: 0.14 };
  const rows = C.killfeedRows(img, { grid });
  assert.deepEqual(rows.map((r) => [r.y0, r.left, r.right]), [[10, 'ally', 'enemy'], [36, 'enemy', 'ally']], 'portraits are skipped, and a red wall and a teal flash have no names, so they are no rows');
});

test('each kill-feed row is new once, wherever it moves', () => {
  const at = (t, rows) => C.killfeedRows(feedImage(rows)).map((r) => ({ ...r, t }));
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
  assert.equal(events[5].text, 'Sova (enemy) killed you; not traded');
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
  const { events: built } = C.buildKillfeed([{ t: 127, killer: 'Sova', victim: 'Im Muted', killerSide: 'enemy', victimSide: 'ally', mine: false }, { t: 400, killer: 'Killjoy', victim: 'Febera', killerSide: 'enemy', victimSide: 'ally', mine: true }], { player: 'Im Muted' });
  assert.deepEqual(built.map((x) => x.kind), ['death', 'ally_death'], 'a given name beats the yellow marks');
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
  const chess = L.toProfile({ game: 'Chess', genre: 'chess', first_person: false, crosshair_center: false, elements: [{ name: 'board', frame: 1, box: [100, 300, 900, 700] }], habits: [{ id: 'x', name: 'Blunders', signs: 's', drill: 'd', checked_by: 'aim' }] });
  assert.equal(chess.regions.aim, undefined, 'no aim area outside first person');
  assert.equal(chess.habits[0].measuredBy, undefined, "aim can't check a habit when there's no aim area");
  assert.equal(chess.fovH, null);
  const tracking = L.toProfile(raw, undefined, { aimTarget: 'tracking', mistakes: raw.habits });
  assert.equal(tracking.habits[0].measuredBy, undefined, "where staying on target matters more than height, aim height can't check a habit");
});

test('research on what matters is cleaned, and says when it came without the web', () => {
  const r = L.cleanResearch({ rewards: 'Ranked points for placement and kills', priorities: ['Positioning', 'Picking fights', '', 'Third parties'], engagements: 'Take fights you can finish before a third party arrives.', aim_target: 'body', mistakes: [{ name: 'Taking open fights', signs: 'Shooting from open ground', cost: 'Third-partied', drill: 'Fight from cover', checked_by: 'none' }, { name: 'Spraying', signs: 's', cost: 'c', drill: 'd', checked_by: 'telepathy' }] }, ['aim', 'shots'], { sources: [{ title: 'ea.com', uri: 'https://ea.com/x' }], researched: true });
  assert.deepEqual(r.priorities, ['Positioning', 'Picking fights', 'Third parties']);
  assert.equal(r.aimTarget, 'body');
  assert.equal(r.mistakes[1].checked_by, 'none', 'an unknown check is dropped');
  assert.equal(r.researched, true);
  assert.equal(L.cleanResearch({ priorities: [], mistakes: [] }, ['aim']), null, 'nothing usable');
});

test('without web search, research falls back to the model and says so', async () => {
  globalThis.Gemini = {
    grounded: async () => { throw Object.assign(new Error('not available'), { status: 404 }); },
    generate: async () => ({}),
    textOf: () => JSON.stringify({ rewards: 'Rounds', priorities: ['Trading'], engagements: '', aim_target: 'head', mistakes: [{ name: 'No trades', signs: 's', cost: 'c', drill: 'd', checked_by: 'none' }] }),
    parseJSON: JSON.parse,
  };
  const r = await L.researchGame({ name: 'Test Game ' + Date.now(), genre: 'shooter' });
  assert.equal(r.researched, false);
  assert.deepEqual(r.sources, []);
  assert.equal(r.mistakes[0].name, 'No trades');
  delete globalThis.Gemini;
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

test('team colors are the hue peaks nearest the colors the learn call reported', () => {
  const bins = new Array(36).fill(0);
  bins[1] = 300; bins[2] = 900; bins[3] = 400; // an orange wall, the biggest thing on screen
  bins[16] = 500; bins[35] = 350; bins[0] = 300; // teal and red rows
  assert.deepEqual(L.teamHues(bins, {}, { ally: 160, enemy: 355 }), { ally: [140, 190], enemy: [330, 20] });
  assert.equal(L.teamHues(bins, { ally: 'purple', enemy: 'red' }), null, 'no peak near purple: the feed is not read');
  assert.equal(L.rgbHue([80, 200, 170]), 165);
  assert.equal(L.rgbHue([128, 128, 130]), null, 'gray has no hue');
  assert.equal(L.nameHue('Teal green'), 170);
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
  assert.equal(L.portraitShare([[...Array(80).fill(0.9), ...Array(20).fill(0.1)]], 100), 0, 'rows ending in color have no portrait');
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
