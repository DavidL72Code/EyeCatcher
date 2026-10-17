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

test('an aim habit has to agree with the aim the coach measured', () => {
  const atHead = [{ t: 10.2, heads: 0.1 }, { t: 40.5, heads: -0.2 }, { t: 70.3, heads: 0.3 }];
  const p = C.checkFinish(good, { ledger: looked(), duration: 120, habits: HABITS, measures: atHead });
  assert.ok(p.some((x) => /put the crosshair at head level \(median 0\.1 heads over 3 duels\)/.test(x)));
  assert.ok(p.some((x) => /At 0:10 you measured the crosshair at head level \(0\.1 heads\)/.test(x)));
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
  for (const { y, left, right, yellow, shade = 0, victimShade = 0 } of rows) {
    if (yellow) paint(96, 99, y - 2, y + 22, YELLOW);
    paint(100, 220, y, y + 20, left === 'ally' ? TEAL : RED);
    paint(221, 340, y, y + 20, right === 'ally' ? TEAL : RED);
    // names, drawn as thin strokes like text
    for (let x = 110; x <= 160; x += 3) paint(x, x, y + 6, y + 14, [225 + shade / 2, 225 + shade / 2, 225 + shade / 2]);
    for (let x = 270; x <= 330; x += 3) paint(x, x + 1, y + 6, y + 14, [150 + victimShade, 150 + victimShade, 150 + victimShade]);
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

test('only crops with a row not seen before count as new', () => {
  const a = C.killfeedRows(feedImage([{ y: 10, left: 'ally', right: 'enemy' }]));
  const moved = C.killfeedRows(feedImage([{ y: 40, left: 'ally', right: 'enemy' }]));
  const added = C.killfeedRows(feedImage([{ y: 10, left: 'ally', right: 'enemy' }, { y: 36, left: 'enemy', right: 'ally', shade: 40 }]));
  assert.equal(C.hasNewRow(a, moved), false, 'the same row moved up is not new');
  assert.equal(C.hasNewRow(a, added), true);
  assert.equal(C.hasNewRow([], a), true);
  const sameKiller = C.killfeedRows(feedImage([{ y: 10, left: 'ally', right: 'enemy' }, { y: 36, left: 'ally', right: 'enemy', victimShade: 105 }]));
  assert.equal(C.hasNewRow(a, sameKiller), true, 'the same killer on a new victim is a new row');
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

test("Gemini's rows take their team colors from the pixel rows, matched from the bottom", () => {
  const px = [{ left: 'ally', right: 'enemy' }, { left: 'enemy', right: 'ally' }, { left: 'ally', right: 'enemy' }];
  const read = [{ killer: 'Omen', victim: 'ZedCapetinha' }, { killer: 'Im Muted', victim: 'Omen', yellow_border: true }]; // the faded top row was skipped
  assert.deepEqual(C.feedSightings(82, read, px), [
    { t: 82, killer: 'Omen', victim: 'ZedCapetinha', killerSide: 'enemy', victimSide: 'ally', mine: false },
    { t: 82, killer: 'Im Muted', victim: 'Omen', killerSide: 'ally', victimSide: 'enemy', mine: true },
  ]);
  const unmatched = C.feedSightings(90, [{ killer: 'A', victim: 'B' }, { killer: 'C', victim: 'D' }], [{ left: 'ally', right: 'enemy' }]);
  assert.deepEqual(unmatched.map((x) => [x.killerSide, x.victimSide]), [[null, null], ['ally', 'enemy']]);
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
