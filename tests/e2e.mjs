// End-to-end test for Eye Catcher in Chrome on the synthetic match (npm run fixture makes it). Gemini and the Files API
// are intercepted and answered with TEST FIXTURES shaped like real responses, so this checks the app's wiring, the
// video pipeline, and the code checks, not the model's judgment. Mediabunny loads from jsDelivr, so it needs network.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startServer } from '../scripts/dev.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = createRequire(import.meta.url)('../core.js');
const truth = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/truth.json'), 'utf8'));
const fixture = path.join(root, 'tests/fixtures', truth.file);

// the app's own server, as the dev server and the desktop app run it: its security policy and headers are under test
// too. The key is a stand-in; Gemini is answered below.
const server = await startServer({ port: 0, reload: false, env: { GEMINI_API_KEY: 'TEST', GEMINI_API_KEY2: 'TEST2', THIRDEYE_BACKEND: '' } });
const base = `http://127.0.0.1:${server.port}/`;
const fail = [];
const check = (c, m) => { if (!c) { fail.push(m); console.log('  FAIL -', m); } else console.log('  ok -', m); };
// E2E_SHOTS=<dir>: screenshots of the main screens, to look at
const shot = async (page, name) => { if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, `${name}.png`) }); };

// ---- fixtures (test only) ----
const CROP = { x: 384, y: 158, w: 512, h: 403 }; // the Valorant profile's aim region on a 1280x720 frame
const headBox = (heads) => {
  const cx = 690, cy = truth.height / 2 - heads * truth.headPx, r = truth.headPx / 2;
  return [(cy - r - CROP.y) / CROP.h * 1000, (cx - r - CROP.x) / CROP.w * 1000, (cy + r - CROP.y) / CROP.h * 1000, (cx + r - CROP.x) / CROP.w * 1000];
};
const scanEvents = [
  ...truth.rounds.map((t) => ({ t: C.mmss(t), kind: 'round_start', text: 'Round starts' })),
  ...truth.duels.map((d) => ({ t: C.mmss(Math.round(d.t + 0.6)), kind: d.outcome, text: d.outcome === 'kill' ? `You killed ${d.enemy}` : `Killed by ${d.enemy}` })),
];
// each turn comes with a summary of the coach's thinking first, as Gemini gives one when asked (includeThoughts), and
// each answer says what it cost, as Gemini's usageMetadata does (the count line adds it up)
const USAGE = { promptTokenCount: 1200, candidatesTokenCount: 80, totalTokenCount: 1280 };
const call = (...calls) => ({ candidates: [{ content: { role: 'model', parts: [{ text: `Weighing what to look at next: ${calls.map(([name]) => name).join(' and ')}.`, thought: true }, ...calls.map(([name, args]) => ({ functionCall: { name, args } }))] } }], usageMetadata: USAGE });
const text = (s) => ({ candidates: [{ content: { role: 'model', parts: [{ text: typeof s === 'string' ? s : JSON.stringify(s) }] } }], usageMetadata: USAGE });
// the match record code reads before the coach's first turn, as the first prompt gives it
const firstRecord = (b) => { const t = b.contents[0].parts.map((p) => p.text || '').join(' '), m = t.match(/The match record, read before your first turn:\n(\{[\s\S]*?\})(\n\n|$)/); return m ? JSON.parse(m[1]) : null; };
const lastResults = (b) => [...b.contents].reverse().find((c) => c.parts?.some((p) => p.functionResponse))?.parts.filter((p) => p.functionResponse).map((p) => p.functionResponse) || [];
const ev = (t, what) => ({ t, what });

// The coach's turns, in order. The run's heads differ so the second review can be compared with the first.
let heads = [];
const FINDING = { found: true, habit_id: 'crosshair_below_head_level', habit: 'Crosshair below head level', why: 'Your crosshair sat at chest height when enemies appeared, so they shot first.', drill: 'Ten minutes walking corners in a custom game with the crosshair at head height.', recheck: 'Measure first sight in five duels.' };
const instead = (t, what, better) => ({ t, what, better });
const EVIDENCE = [instead('0:13.8', 'Chest height as Enemy 1 appears', 'Hold the crosshair at head height on that corner'), instead('0:46.8', 'Same at the doorway', 'Pre-aim the doorway at head height'), instead('2:13.6', 'Again before the last death', 'Raise the crosshair before swinging')];
const coach = [
  () => call(['research', { why: 'what matters in this game' }]),
  () => call(['measure_aim', { at: '0:13.8', why: 'crosshair height before the first death' }]),
  () => call(['ask_player', { question: 'Did you expect someone at that corner?', at: '0:14', options: ['Yes', 'No'], why: 'whether that angle was a surprise', notes: [{ theory: 'Crosshair sits low', status: 'testing', evidence: [ev('0:13.8', 'chest height at first sight')] }] }]),
  () => call(['measure_aim', { at: '0:46.8', more: ['1:40.6', '2:13.6', '2:15'], why: 'the same before the other deaths' }]),
  () => call(['finish', { ...FINDING, evidence: [...EVIDENCE.slice(0, 2), ev('1:30', 'never looked here')] }]),
  () => call(['finish', { ...FINDING, evidence: EVIDENCE, notes: [{ id: 'T1', status: 'supported', evidence: EVIDENCE.map((e) => ev(e.t, e.what)) }] }]),
  () => call(['frames', { at: '0:31', before: 1, after: 0.5, fps: 4, region: 'aim', why: 'a fight they won' }]),
  () => call(['measure_aim', { at: '0:30.6', why: 'aim in the fight they won', notes: [{ id: 'T1', status: 'supported', evidence: [ev('0:31', 'on the head in a fight they won')] }] }]),
  () => call(['finish', { ...FINDING, progress: 'unclear', evidence: EVIDENCE, contrast: [ev('0:31', 'On the head, and the fight was won')] }]),
];
const seen = { agentBodies: [], scans: 0, heads: 0, headCalls: [], markCalls: 0, claimChecks: 0, outside: [], feedCalls: 0, learns: 0, hudCalls: 0, uploads: 0, starts: 0, gameFiles: 0, chess: false };
// the chess review: the same app on a synthetic chess recording (npm run fixture:chess), learned as chess
const chessTruth = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/chess-truth.json'), 'utf8'));
const chessFile = path.join(root, 'tests/fixtures', Object.keys(chessTruth.recordings).find((f) => /blunders/.test(f)));
const B = chessTruth.board, box = (x, y, w, h) => [Math.round((y / 720) * 1000), Math.round((x / 1280) * 1000), Math.round(((y + h) / 720) * 1000), Math.round(((x + w) / 1280) * 1000)];
const LEARNED_CHESS = {
  game: 'Synthetic chess', genre: 'chess', first_person: false, crosshair_center: false, team_game: false, rounds: false,
  elements: [{ name: 'board', frame: 3, box: box(B.x - 20, B.y + 12, B.size + 25, B.size + 25) }, { name: 'player_clock', frame: 3, box: box(780, 560, 240, 72) }, { name: 'opponent_clock', frame: 3, box: box(780, 90, 240, 72) }],
  cues: ['The clocks on the right count down for the side to move.'], key_moments: 'moves that lose material or the game',
};
const CHESS_FINDING = { found: true, habit_id: 'blunders_when_the_clock_is_low', habit: 'Blunders when the clock is low', why: 'Once your clock fell under 30 seconds you started hanging pieces, and the game turned.', drill: 'Play 10 games of 3+2 and pre-plan two safe moves when under 30 s.', recheck: 'Count blunders made with under 30 s left.' };
const chessCoach = [
  () => call(['research', { why: 'what matters in chess' }]),
  () => call(['read_hud', { element: 'player_clock', at: '1:14', more: ['1:22', '0:34'], why: 'their clock at the blunders' }]),
  () => call(['frames', { at: '1:14', more: ['1:22', '0:34'], before: 1, after: 0.5, fps: 2, why: 'the blunders, and a quiet move' }]),
  () => call(['finish', { ...CHESS_FINDING, evidence: [ev('1:14', 'Nce5 hangs a knight'), ev('1:22', 'Bxa6 drops the bishop'), ev('0:34', 'c3')] }]),
  () => call(['frames', { at: '1:30', why: 'the third blunder', notes: [{ theory: 'Blunders when the clock is low', status: 'supported', evidence: [ev('1:14', 'Nce5 with 26 s left')] }] }]),
  () => call(['finish', { ...CHESS_FINDING, evidence: [ev('1:14', 'Nce5 hangs a knight with 26 s left'), ev('1:22', 'Bxa6 drops the bishop with 21 s left'), ev('1:30', 'Nd4 gives away a pawn and the attack with 17 s left')], notes: [{ id: 'T1', status: 'supported', evidence: [ev('1:22', 'Bxa6 with 21 s left'), ev('1:30', 'Nd4 with 17 s left')] }] }]),
];
// the same synthetic match learned as footage of a whole match (a broadcast), point by point: the player says who they
// are, the points are read as video one by one, and a finding has to show at points they lost
const LEARNED_SPEC = {
  game: 'Synthetic court match', genre: 'sports', view: 'spectator', unit: 'point', first_person: false, crosshair_center: false, team_game: true, rounds: false,
  sides: [{ name: 'Blue', look: 'blue shirts' }, { name: 'Red', look: 'red shirts' }], elements: [],
  cues: ['A point starts with a serve.'], key_moments: 'points won and lost',
};
const UNITS = [['0:05', '0:18', true], ['0:25', '0:40', false], ['0:45', '1:00', true], ['1:10', '1:25', false], ['1:30', '1:45', true], ['1:55', '2:10', false]].map(([from, to, maybe_lost]) => ({ from, to, text: maybe_lost ? 'Red wins the point' : 'Blue wins the point', maybe_lost }));
const ROLE = { role: 'setter', won_unit: 'The set lands where the hitter can attack it.', lost_unit: 'The set is off target, or the setter is late to the ball.', mistakes: [{ name: 'Late to the ball', signs: 'The setter arrives after the pass lands.', cost: 'Off-target sets.', drill: 'Footwork to the target on every pass in practice.', checked_by: 'none' }] };
const SPEC_FINDING = { found: true, habit_id: 'other', habit: 'Late to the ball on the set', why: 'You got to the ball late on the points you lost, so your sets came out off target and the hitter could not attack.', drill: 'Twenty passes a session where you are at the target before the pass lands.', recheck: 'Whether you are set before the pass arrives.' };
const SPEC_EVIDENCE = [instead('0:10', 'Arrives late, the set drifts', 'Move to the target as the serve is hit'), instead('0:50', 'Late again, off-target set', 'Beat the pass to the target'), instead('1:35', 'Late on the last lost point', 'Get there first, then set')];
const specCoach = [
  () => call(['research', { why: 'what matters, and what wins a point for a setter' }]),
  () => call(['finish', { found: false, why: 'Nothing looked lost in the quick pass, so no single habit stands out.' }]),
  () => call(['read_clips', { windows: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'], why: 'how each point went for them' }]),
  () => call(['frames', { at: '0:10', more: ['0:50', '1:35'], as: 'clip', why: 'their part in the points they lost', notes: [{ theory: 'Late to the ball', status: 'testing' }] }]),
  () => call(['finish', { ...SPEC_FINDING, evidence: SPEC_EVIDENCE, notes: [{ id: 'T1', status: 'supported', evidence: SPEC_EVIDENCE.map((e) => ev(e.t, e.what)) }] }]),
];
// no habit repeats across the deaths, but one thing cost them the most: ending with nothing named is sent back, and the
// biggest reason has to be named, at a death it looked at
const REASON = { found: false, reason: 'Peeking the same corner twice', why: 'After losing the duel at the corner, they peeked it again the same way and died to the same angle.', drill: 'After a death, take the next fight from a different angle.', recheck: 'Whether they re-peek a corner they just died at.' };
const oneOffCoach = [
  () => call(['finish', { found: false, why: 'The deaths had different causes, so no single habit stands out.' }]),
  () => call(['frames', { at: '0:13.8', more: ['0:46.8', '1:05.8'], why: 'the deaths' }]),
  () => call(['frames', { at: '1:40.6', why: 'the last death I have not seen' }]),
  () => call(['finish', { ...REASON, fixes: [instead('0:46.8', 'Peeks the corner they just lost at, the same way', 'Take the fight from the other side, or wait for a teammate')] }]),
];
// a finding whose one moment the video check keeps rejecting: sent back twice, then told to decide, it still cites it,
// and the review names what the moment that did hold up shows, with a note at each loss
const SALVAGE_FIXES = [instead('0:13.8', 'Holds a wide angle alone as the enemy swings', 'Hold a tighter angle, near a teammate'), instead('0:46.8', 'WRONG: peeks with the knife out', 'Peek with the rifle out')];
const LOSS_NOTES = [{ ...instead('1:05.8', 'Swings out a second time into the same enemy', 'Reset after the first contact'), because: 'the enemy had already seen them and held the angle' }, { ...instead('1:40.6', 'Takes the last duel on low health', 'Back off and heal first'), because: 'at 20 health, one shot from anyone ends it' }];
const salvageCoach = [
  () => call(['frames', { at: '0:13.8', more: ['0:46.8', '1:05.8'], why: 'the deaths' }]),
  () => call(['frames', { at: '1:40.6', more: ['2:13.6'], why: 'the last deaths' }]),
  () => call(['finish', { ...REASON, reason: 'Fighting wide angles alone', fixes: SALVAGE_FIXES, turning_points: LOSS_NOTES }]),
  () => call(['finish', { ...REASON, reason: 'Fighting wide angles alone', fixes: SALVAGE_FIXES, turning_points: LOSS_NOTES }]),
  () => call(['finish', { ...REASON, reason: 'Fighting wide angles alone', fixes: SALVAGE_FIXES, turning_points: LOSS_NOTES }]),
];
// what the learn call says about the synthetic match: where its HUD is, and the habits a coach would look for
const LEARNED = {
  game: 'Synthetic test match', genre: 'shooter', first_person: true, crosshair_center: true, fov_h: 103, team_game: false, rounds: true, respawn_seconds: 0,
  elements: [{ name: 'kill_feed', frame: 2, box: [70, 710, 200, 980] }, { name: 'minimap', frame: 1, box: [14, 8, 426, 262] }],
  cues: ['The kill feed at the top right lists who killed whom.', 'A grey screen with KILLED BY means the player died.'], key_moments: 'kills and deaths in duels',
};
// what the research call (web search) says matters, per game, with its sources
const RESEARCH = {
  'Synthetic test match': { rewards: 'Rounds won', priorities: ['Crosshair placement', 'Trading teammates'], engagements: 'Take duels you are set up for.', aim_target: 'head', mistakes: [
    { name: 'Crosshair below head level', signs: 'The crosshair sits at chest height when an enemy appears.', cost: 'The first shot misses the head.', drill: 'Walk corners with the crosshair at head height.', checked_by: 'aim' },
    { name: 'Peeking too wide', signs: 'Swinging far past a corner.', cost: 'More than one enemy sees you.', drill: 'Slice corners one angle at a time.', checked_by: 'none' }] },
  'Synthetic court match': { rewards: 'Points and sets won', priorities: ['Clean passing', 'Accurate sets'], engagements: '', aim_target: 'none', mistakes: [
    { name: 'Poor passing', signs: 'The pass lands far from the target.', cost: 'No attack.', drill: 'Passing reps to a target.', checked_by: 'none' }] },
  'Synthetic chess': { rewards: 'Winning the game', priorities: ['Clock management', 'Piece safety'], engagements: '', aim_target: 'none', mistakes: [
    { name: 'Blunders when the clock is low', signs: 'Hanging pieces with little time left.', cost: 'Material and the game.', drill: 'Play 10 games of 3+2 and pre-plan two safe moves when under 30 s.', checked_by: 'engine' }] },
};

function gemini(body) {
  const parts = body.contents?.[0]?.parts || [];
  const prompt = parts.map((p) => p.text || '').join(' ');
  // the critique's script: what a coach says over each moment, written from the finding's own words. Each moment says a
  // lead of its own and the first sentence of its text; the salvage review's adds a number no moment gives ("25 bullets"),
  // so code has to refuse it and say the finding's own lines
  if (!body.tools && /^You write what a coach says out loud/.test(prompt)) {
    seen.scriptCalls = (seen.scriptCalls || 0) + 1;
    const moments = [...prompt.matchAll(/Moment (\d+) \([^)]*\): <data>([^<]*)<\/data>/g)].map((m) => ({ moment: +m[1], text: m[2] }));
    const leads = ['Watch this first one.', 'Here it goes wrong.', 'Same story here.', 'Look at this one too.', 'And the last one.'];
    return text({
      open: `This one comes down to the same corner, twice. Let's go through the ${moments.length} moments that cost you.`,
      moments: moments.map((m, i) => ({ moment: m.moment, say: `${leads[i % leads.length]} ${m.text.split(/(?<=\.)\s/)[0]}${seen.salvage && i === 0 ? ' You had 25 bullets left.' : ''}` })),
      close: 'Next time you die, come back from a different angle.',
    });
  }
  // the check of a finding against the video: every claim in one call, each with its own pictures; the claims the record
  // shows are false (planted by code) go against the video, the coach's show
  if (!body.tools && /^Each claim below is about a moment of a recorded/.test(parts[0]?.text || '')) {
    seen.verifyBodies = [...(seen.verifyBodies || []), body];
    const claims = [...prompt.matchAll(/Claim (\d+), at [^:]+:[\d.]+: <data>([^<]*)<\/data>/g)].map((m) => ({ n: +m[1], what: m[2] }));
    // seen.fooled: a checker that agrees with everything, planted claims included
    const planted = /^The player (is killed|dies) here\.$|health is full here|own side scores here/, against = (c) => /^WRONG/.test(c.what) || (planted.test(c.what) && !seen.fooled);
    return text({ claims: claims.map((c) => ({ claim: c.n, facts: [{ fact: c.what, saw: against(c) ? 'the opposite' : 'just that', verdict: against(c) ? 'goes_against' : 'shows' }] })) });
  }
  if (parts.some((p) => p.fileData)) { seen.scans++; seen.scanBody = body; return text(seen.spectator ? { units: UNITS } : { events: scanEvents }); }
  if (!body.tools && /Identify the game/.test(prompt)) { seen.learns++; return text(seen.spectator ? LEARNED_SPEC : seen.chess ? LEARNED_CHESS : LEARNED); }
  // the role's research: a search, then put in shape
  if (/says they play as/.test(prompt)) { seen.roleSearch = (seen.roleSearch || 0) + 1; seen.roleAsk = prompt; return { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(ROLE) }] }, groundingMetadata: { groundingChunks: [{ web: { title: 'example.org', uri: 'https://example.org/setting' } }, { web: { title: 'reddit.com', uri: 'https://www.reddit.com/r/sport' } }] } }] }; }
  if (!body.tools && /^Put this research on playing/.test(prompt)) return text(ROLE);
  // each point read as video: the first, third, and fifth lost, the setter late
  if (!body.tools && /Each clip is one point from footage of the whole match/.test(prompt)) {
    seen.unitReads = (seen.unitReads || 0) + 1;
    seen.unitPrompt = prompt;
    const clips = [...prompt.matchAll(/Clip (\d+): (\d+:\d+\.\d)/g)].map((m) => ({ clip: +m[1], from: C.parseTime(m[2]) }));
    return text({ clips: clips.map(({ clip, from }) => { const lost = [5, 45, 90].some((t) => Math.abs(t - from) <= 4.5); return { clip, player_seen: true, moments: [{ t: C.mmss(from + 3), what: lost ? 'the setter arrives late' : 'a clean set' }], player_did: lost ? 'Got to the ball late and set it off target.' : 'Set it to the hitter.', others_did: lost ? 'Red attacked the loose ball.' : 'The hitter put it away.', outcome: lost ? 'lost' : 'won', outcome_why: lost ? 'The set was off target, so Red won the point.' : 'The set was on target and Blue won the point.', decided_by: lost ? 'player' : 'teammates' }; }) });
  }
  // the check of each learned box but the kill feed, on whole frames with the boxes numbered in the order the learn call
  // gave them: each box outlines what it claims
  if (!body.tools && /numbered yellow boxes/.test(prompt)) {
    seen.boxChecks = (seen.boxChecks || 0) + 1;
    const names = (seen.chess ? LEARNED_CHESS : LEARNED).elements.map((e) => e.name).filter((n) => n !== 'kill_feed'), pictures = parts.filter((p) => p.inlineData).length;
    return text({ boxes: Array.from({ length: pictures }, (_, i) => names.map((n, k) => ({ image: i + 1, box: k + 1, outlines: n }))).flat() });
  }
  // the ask again for boxes that went or weren't drawn: the synthetic HUD has nothing more to box
  if (!body.tools && /boxed at all|boxed in the wrong place/.test(prompt)) { seen.relocates = (seen.relocates || 0) + 1; return text({ found: [] }); }
  if (body.tools?.some((t) => t.google_search)) {
    seen.research = (seen.research || 0) + 1;
    const game = Object.keys(RESEARCH).find((g) => prompt.includes(g));
    return { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(RESEARCH[game]) }] }, groundingMetadata: { groundingChunks: [{ web: { title: 'example.org', uri: 'https://example.org/guide' } }, { web: { title: 'reddit.com', uri: 'https://www.reddit.com/r/games' } }] } }] };
  }
  // the research's prose put in shape, by a call without search
  if (!body.tools && /^Put this research on/.test(prompt)) {
    seen.researchSums = (seen.researchSums || 0) + 1;
    const game = Object.keys(RESEARCH).find((g) => prompt.includes(g));
    return text(RESEARCH[game]);
  }
  // the clock in each picture, as the fixture has it at that picture's time (each comes labelled "Image N, at M:SS.s"):
  // answered by the order the pictures came in, a clock rose between moves (19.Nce5 read 0:58 between 0:10 and 0:21)
  // and code's check for misread clocks dropped it, rightly
  if (!body.tools && /player clock of a/.test(prompt)) {
    seen.hudCalls++;
    const white = chessTruth.recordings[path.basename(chessFile)].moves.filter((m) => m.color === 'w');
    const clockAt = (t) => { const m = white.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a)), s = m.clockWhite; return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
    return text({ readings: [...prompt.matchAll(/Image (\d+), at (\d+:\d+(?:\.\d)?)/g)].map((m) => ({ image: +m[1], value: clockAt(C.parseTime(m[2])), readable: true })) });
  }
  // each death the low-detail pass saw, looked at again: the synthetic match's deaths are all real
  if (!body.tools && /a quick look took for their death/.test(prompt)) { seen.deathChecks = (seen.deathChecks || 0) + 1; return text({ deaths: [...prompt.matchAll(/Death (\d+),/g)].map((m) => ({ death: +m[1], dead: true, why: 'the death screen' })) }); }
  // each moment a finding cites, looked at again blind: the frames fit them all
  // the check of a finding's claims against the record: these all fit
  if (!body.tools && /A coach reviewing/.test(prompt)) { seen.claimChecks++; return text({ claims: [...prompt.matchAll(/Claim (\d+),/g)].map((m) => ({ claim: +m[1], facts: [{ states: 'what it says', verdict: 'agrees', fact: 'the record' }] })) }); }
  // the synthetic kill feed's names aren't known here, so the scan falls back to the low-detail pass
  if (!body.tools && /kill feed/.test(prompt)) { seen.feedCalls++; return text({ rows: [] }); }
  // the report's marks for moments no measurement covers
  if (!body.tools && /telestrator/.test(prompt)) { seen.markCalls++; return text({ images: parts.filter((p) => p.inlineData).map((_, i) => ({ image: i + 1, problem_box: [420, 300, 560, 380], problem: 'Knight left hanging', fix_box: [300, 420, 380, 480], fix: 'Guard it first' })) }); }
  if (!body.tools) {
    const n = parts.filter((p) => p.inlineData).length;
    seen.headCalls.push(n);
    // a teammate with a name tag stands right on the crosshair: code has to leave them out and measure the enemy
    return text({ images: Array.from({ length: n }, (_, i) => { const b = headBox(heads[seen.heads++ % heads.length]); return { image: i + 1, players: [{ head_2d: [470, 480, 530, 520], body_2d: [470, 470, 700, 530], name_tag: 'Teammate', teammate: true }, { head_2d: [0, 950, 40, 990], body_2d: [600, 0, 700, 20], name_tag: '', teammate: false }, { head_2d: b, body_2d: [b[0], b[1] - 10, b[2] + 200, b[3] + 10], name_tag: '', teammate: false }] }; }) });
  }
  seen.agentBodies.push(body);
  const turn = body.contents.filter((c) => c.role === 'model').length, list = seen.spectator ? specCoach : seen.chess ? chessCoach : seen.salvage ? salvageCoach : seen.oneOff ? oneOffCoach : coach;
  return (list[turn] || list.at(-1))();
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Expose-Headers': 'x-goog-upload-url' };
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); if (process.env.E2E_ERRORS) console.log('  PAGE ERROR -', e.message); });
  page.on('console', (m) => { if (process.env.E2E_ERRORS && /error|warn/.test(m.type())) console.log('  PAGE', m.type(), '-', m.text().slice(0, 300)); if (m.type() === 'error') errors.push(`${m.text()}${m.location()?.url ? ` (${m.location().url.slice(0, 60)})` : ''}`); });
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (/\/games\//.test(u.pathname)) seen.gameFiles++;
    // code from anywhere but the app itself; fonts and Gemini (answered below) are the only other hosts
    if (!['127.0.0.1', 'fonts.googleapis.com', 'fonts.gstatic.com', 'generativelanguage.googleapis.com'].includes(u.hostname) && !/^(data|blob):/.test(r.url())) seen.outside.push(u.host);
  });
  // the critique's voice (the local server's Kokoro, scripts/voice.mjs): a quarter second of silence for each line
  const silence = (() => { const n = 4000, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; })();
  await page.route('**/voice', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ voices: { am_michael: 'Michael', af_heart: 'Heart' } }) });
    seen.voiceLines = [...(seen.voiceLines || []), { ...JSON.parse(route.request().postData() || '{}'), at: Date.now() }];
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: silence });
  });
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const req = route.request(), url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.includes('/upload/v1beta/files')) {
      seen.starts++;
      return route.fulfill({ status: 200, headers: { ...cors, 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload-session/1' }, body: '{}' });
    }
    if (url.includes('/upload-session/')) {
      seen.uploads++;
      seen.uploadBytes = req.postDataBuffer()?.length || 0;
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ file: { name: 'files/test', uri: 'https://generativelanguage.googleapis.com/v1beta/files/test', mimeType: 'video/webm', state: 'ACTIVE' } }) });
    }
    if (url.includes(':generateContent')) {
      const body = JSON.parse(req.postData());
      // while seen.scriptBusy, the critique's script call is out of its daily quota on every key and model, as both keys
      // were on Oct 25: the call fails, so the review must keep nothing and ask again next time
      if (seen.scriptBusy && /^You write what a coach says out loud/.test(body.contents?.[0]?.parts?.[0]?.text || '')) {
        seen.scriptRefusals = (seen.scriptRefusals || 0) + 1;
        return route.fulfill({ status: 429, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota.', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }) });
      }
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(gemini(body)) });
    }
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });

  console.log('start screen');
  const first = await page.goto(base);
  check(/script-src 'self';/.test(first.headers()['content-security-policy']) && /connect-src 'self' https:\/\/generativelanguage\.googleapis\.com/.test(first.headers()['content-security-policy']), 'the page runs under a policy: only its own scripts, talking only to itself and Gemini');
  const fromElsewhere = await (await fetch(`${base}env.js`, { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'script' } })).text();
  const ownEnv = await page.evaluate(async () => (await fetch('/env.js')).text());
  check(!/GEMINI_API_KEY|TEST2/.test(fromElsewhere) && /"GEMINI_API_KEY":"TEST"/.test(ownEnv) && /"GEMINI_API_KEY2":"TEST2"/.test(ownEnv), "both keys go to Eye Catcher's own page and to no other site");
  check(await page.locator('#homeTitle').innerText() === "FIND THE HABIT THAT'S\nLOSING YOU GAMES." && await page.locator('#home').isVisible() && await page.locator('#tabs [aria-current]').innerText() === 'Home', 'Home opens first, in the sidebar, with the headline');
  check(/scenes\/lol\.mp4$/.test(await page.locator('#demoVideo').getAttribute('src')) && await page.locator('#demoHud .el').count() === 4 && /Reading the screen/i.test(await page.locator('#demoNow .now-kind').innerText()), "Home plays a real match with Eye Catcher's steps over it");
  const games = await page.locator('#scenes .sc-game').allInnerTexts();
  check(games.length === 4 && new Set(games).size === 4, `and offers four scenarios, each a different game (${games.join(', ')})`);
  await page.click('#scenes [data-scene="2"]');
  check(/scenes\/r6\.mp4$/.test(await page.locator('#demoVideo').getAttribute('src')) && /Reading the screen/i.test(await page.locator('#demoNow .now-kind').innerText()) && await page.locator('#scenes [aria-selected="true"]').getAttribute('data-scene') === '2', 'a scenario chip plays that scenario');
  await page.click('.hero-cta a[href="#coach"]');
  await page.waitForSelector('#start:not([hidden])');
  check(await page.locator('#tabs [aria-current]').innerText() === 'Coach' && await page.locator('#startTitle').innerText() === 'REVIEW A MATCH', 'Review a match goes to Coach');
  check(await page.locator('#playerName').count() === 0 && await page.locator('#goal').count() === 0, 'nobody fills in a form: no name, no goal');
  check(await page.locator('#keyBox').isHidden(), 'no key box when .env has a key');
  check(await page.locator('#working').isHidden(), 'no habit chip on a first visit');

  console.log('first review');
  heads = [2.2, 2.0, 2.3];
  await page.setInputFiles('#fileInput', fixture);
  await page.waitForSelector('#review:not([hidden])');
  await page.waitForSelector('.question:not([hidden])', { timeout: 60000 }).catch(async (e) => { if (process.env.E2E_ERRORS) console.log('  STUCK -', JSON.stringify(Object.fromEntries(Object.entries(seen).filter(([, v]) => typeof v === 'number'))), await page.locator('#statusText').innerText().catch(() => '?'), '|', (await page.locator('.beat').allInnerTexts().catch(() => [])).slice(-4).join(' || ').replace(/\s+/g, ' ').slice(0, 1500)); throw e; });
  check(await page.locator('#statusText').innerText() === 'Waiting for you', 'status line waits for the player');
  check(await page.locator('#now').isVisible() && /A question for you/i.test(await page.locator('#now .now-kind').innerText()) && +(await page.locator('#now .now-n').innerText()) > 2, 'over the video, the caption says which step the coach is on and what it is doing');
  check(await page.evaluate(() => document.body.classList.contains('live') && getComputedStyle(document.querySelector('#tabs a[data-tab="reviews"]')).pointerEvents === 'none'), "while a review runs, the header can't take you away from it");
  const counts = await page.locator('#counts').innerText();
  check(await page.locator('#counts').isVisible() && /^\d+ of 25 model calls · [\d.]+k tokens · \d+:\d\d$/.test(counts) && await page.evaluate(() => getComputedStyle(document.querySelector('.live-head')).position === 'sticky'), `while it runs, a line held at the top of the rail says the model calls used of the 25, the tokens so far, and the time (${counts})`);
  check(await page.locator('.question p').innerText() === 'Did you expect someone at that corner?', 'the question shows');
  await shot(page, 'live');
  check(seen.uploads === 1 && seen.uploadBytes > 50000 && seen.uploadBytes < 5e6, `the scan copy was uploaded once (${seen.uploadBytes} bytes)`);
  check(seen.scanBody?.contents[0].parts[0].videoMetadata?.startOffset === '0s' && seen.scanBody.generationConfig.mediaResolution === 'MEDIA_RESOLUTION_LOW', 'scan clips the copy and asks for low resolution');
  const ticks = await page.locator('.tick').count();
  check(ticks === truth.duels.length, `timeline shows every kill and death (${ticks})`);
  check(await page.locator('.round').count() === truth.rounds.length, 'timeline shows the rounds');
  check(await page.locator('.theory.testing').count() === 1, 'the board shows a theory being tested');
  check(seen.learns === 1 && seen.gameFiles === 0, `the game is learned from the recording in one call, and no profile file is fetched (${seen.learns} learn calls, ${seen.gameFiles} profile fetches)`);
  check(await page.locator('.beat.learn .beat-why').innerText() === 'Synthetic test match, shooter' && await page.locator('.beat.learn .screen-map .el').count() === 2, 'the first card shows the game and what was found on screen, boxed');
  check(seen.research === 4 && /What matters in Synthetic test match: Crosshair placement · Trading teammates/.test(await page.locator('.beat.research').innerText()) && await page.locator('.beat.research .matters a[href="https://example.org/guide"]').count() === 1, 'the coach researches what matters in the game (guides, community, meta, wiki), shown with its sources on its own card');
  const researched = lastResults(seen.agentBodies[1]).find((r) => r.name === 'research')?.response.result || {};
  check(new RegExp(`\\d+ of ${25 - (seen.learns + (seen.boxChecks || 0) + (seen.relocates || 0))} model calls`).test(researched.budget || ''), `every tool result tells the coach how many model calls are left of the 25 for the whole review, learning the game included (${researched.budget})`);
  check(researched.from === 'the web (2 sources)' && researched.rewards === 'Rounds won' && researched.habits?.some((h) => /^crosshair_below_head_level: /.test(h)) && !/What matters in Synthetic test match/.test(seen.agentBodies[0].systemInstruction.parts[0].text), "the coach learns what the game rewards, what matters, and the habits' ids when it calls research, not before");
  check(/Kill feed seen, with no colored rows to measure: it's read as plain text/.test(await page.locator('.beat.learn').innerText()), 'a kill feed with no team colors is said to be read as plain text');
  check(await page.locator('.beat').first().locator('.beat-kind').innerText() === 'Question' && await page.locator('.beat').count() === 5, 'the breakdown has a card per step, newest first');
  // the mock's kill feed reads no rows, so the low-detail pass's kills stand, with nothing to confirm them
  check(await page.locator('.beat.scan .beat-why').innerText() === 'the match record, read before the coach starts' && /^8 fights \(3 won, 5 lost, 0 no one fell\); 3 kills \(3 only guessed\), 5 deaths, 0 teammates down$/.test(await page.locator('.beat.scan .beat-out').innerText()), `the scan card says what it checked and what it found (${await page.locator('.beat.scan .beat-out').innerText()})`);
  check(/^2\.2 heads low$/.test(await page.locator('.beat.measure_aim figcaption').first().innerText()) && await page.locator('.beat.measure_aim .box').count() === 1, 'the aim card shows the measured frame, its box, and its number');
  check(/New theory Crosshair sits low\s*0:13 chest height at first sight/.test(await page.locator('.beat.measure_aim .beat-take').innerText()), "the coach's take lands on the card it was about");
  const firstAgent = seen.agentBodies[0];
  check(!/What they asked you to look at/.test(firstAgent.systemInstruction.parts[0].text), 'the coach decides what to look at: nobody tells it');
  check(!/First find|then measure|Step 1/i.test(firstAgent.systemInstruction.parts[0].text), 'the brief gives no order of steps');
  await page.click('.question .opts button:has-text("No")');

  await page.waitForSelector('#checkin:not([hidden])', { timeout: 60000 });
  check(await page.locator('#checkin h3').innerText() === 'CROSSHAIR BELOW HEAD LEVEL' && await page.locator('#checkin .ci-m').count() === 3 && await page.locator('#verdict').isHidden(), 'before the finding is final, it is put to the player with its moments');
  check(await page.locator('#statusText').innerText() === 'Waiting for you', 'and the coach waits for them');
  await page.click('#checkin [data-yes]');
  await page.waitForSelector('#verdict:not([hidden])', { timeout: 60000 });
  await page.waitForTimeout(1200); await shot(page, 'verdict-habit');
  check(await page.locator('.verdict .checked.yes').innerText() === 'You agreed this is it.', 'their yes makes it final, and the verdict says so');
  const after = (i) => lastResults(seen.agentBodies[i]);
  const askReply = seen.agentBodies.map(lastResults).flat().find((r) => r.name === 'ask_player');
  check(askReply?.response.result.answer === '<data>No</data>', "the player's answer goes back to the coach");
  const measured = seen.agentBodies.map(lastResults).flat().filter((r) => r.name === 'measure_aim').flatMap((r) => r.response.result.measured || [r.response.result]);
  check(/the player was dead then \(the kill feed shows their death at 2:15\)/.test(measured[4]?.skipped) && measured.filter((m) => m.found).length === 5, 'a moment after their death is skipped instead of measured');
  check(measured[0]?.heads_below_head === 2.2, `a tagged teammate on the crosshair is left out, and the enemy is measured (${measured[0]?.heads_below_head})`);
  check(JSON.stringify(seen.headCalls) === '[1,3,1]', `one head call per measure_aim, every moment in it (${JSON.stringify(seen.headCalls)})`);
  check(/before_finish/.test(JSON.stringify(after(4))) && /look at a fight they won \(at 0:28, 1:20, 1:55\)/.test(measured[1] && JSON.stringify(after(4))), 'every look says what finish will still ask for');
  const outs = await page.locator('.log .beat-out').evaluateAll((els) => els.map((e) => e.textContent).join(' | '));
  check(/2:15\.0 skipped: you were dead \(2:15\)/.test(outs), `the breakdown shows the skipped moment (${outs})`);
  const firstFinish = after(5).find((r) => r.name === 'finish')?.response.result;
  check(firstFinish?.ok === false && firstFinish.problems.some((p) => /haven't looked closely at 1:30/.test(p)), 'a finish citing an unseen moment is sent back');
  check(firstFinish.problems.some((p) => /Put the finding on the board first: .*Not on a supported theory yet: 0:13, 0:46/.test(p)), 'and one whose habit was never a supported theory on the board');
  const secondFinish = after(6).find((r) => r.name === 'finish')?.response.result;
  check(secondFinish?.ok === false && /haven't looked at a fight they won \(at 0:28, 1:20, 1:55\)/.test(secondFinish.problems[0]), 'a finish that never checked a won fight is sent back once');
  const framesTurn = seen.agentBodies[7].contents.at(-1).parts;
  check(framesTurn.filter((p) => p.inlineData).length === 7 && framesTurn[0].functionResponse.response.result.images === '7 attached', 'frames reach the coach as pictures, not JSON');
  const imgsLater = seen.agentBodies[8].contents.flatMap((c) => c.parts).filter((p) => p.inlineData).length;
  check(imgsLater === 0, 'old pictures are dropped from later turns');
  check(await page.locator('.verdict h2').innerText() === 'CROSSHAIR BELOW HEAD LEVEL', 'verdict names the habit');
  check(await page.locator('.metric b').innerText() === '2.2', 'the metric is the measured median (2.2 heads)');
  check(await page.locator('.keys .key').count() === 3 && await page.locator('.pin').count() === 3, 'three key moments, pinned on the timeline');
  check(await page.locator('.verdict h3', { hasText: 'What to do instead' }).count() === 1 && /^Fix Pre-aim the doorway at head height$/.test(await page.locator('.key:nth-child(2) .key-fix').innerText()), 'each moment says what to do instead');
  await page.waitForFunction(() => document.querySelectorAll('.key-frame img').length === 3);
  check(true, 'each key moment gets its frame from the recording');
  check(/^Crosshair on the upper body, left of them$/.test(await page.locator('.key:nth-child(1) .chip.bad').innerText()) && await page.locator('.key:nth-child(1) .chip.good').innerText() === 'Aim here', 'a measured moment is marked from the measurement: where the crosshair was, and the head to aim at');
  check(await page.locator('.key:nth-child(1) .marks circle.bad').count() === 1 && await page.locator('.key:nth-child(1) .marks path.good').count() === 1, 'the crosshair is ringed in red and the head circled in the pen color');
  check(/^How it knew Measured 2\.2 heads below the head in step 0\d/.test(await page.locator('.key:nth-child(1) .key-how').innerText()), 'each moment says how it was found, with the step');
  check(seen.markCalls === 0, 'measured moments cost no marking call');
  const openAtEnd = await page.locator('#logBox').evaluate((d) => d.open);
  const reasoned = await page.locator('.log .beat .beat-think').allInnerTexts(), checker = await page.locator('.log .checker').first().innerText();
  check(reasoned.length >= 5 && reasoned.some((t) => /How it reasoned\s*Weighing what to look at next: measure_aim/.test(t)) && !seen.agentBodies.some((b) => b.contents.some((c) => c.parts?.some((p) => p.thought))), `each step shows the coach's reasoning before it, and the reasoning isn't sent back to the model (${reasoned.length} steps)`);
  check(/never saw the coach's reasoning, judged each claim against the video\./.test(checker) && /Code wrote 2 false claims from the record and mixed them in; a checker that can't tell them apart isn't trusted\./.test(checker) && /It caught 2 of the 2\./.test(checker) && await page.locator('.log .checker .ck-planted li.caught').count() === 2 && await page.locator('.log .checker .ck-own li.caught').count() === 0 && (checker.match(/Holds/g) || []).length >= 3, `the check against the video shows each claim it judged, and, set apart under a line that says what planting is, the false ones planted to test it, caught (${checker.slice(0, 260).replace(/\s+/g, ' ')})`);
  check(/caught both false claims planted to test it/.test(await page.locator('.verdict .trust').innerText()), 'and the report says the checker caught the false claims planted to test it');
  // How it worked: the whole review in order, drawn from its log, the planted claims set apart
  const stages = (await page.locator('#traceBody .tr-stage h4').allInnerTexts()).map((x) => x.replace(/^\d+\s*/, ''));
  check(await page.locator('#trace').isVisible() && await page.locator('#traceBox').evaluate((d) => d.open) && stages.join(' | ') === "What it learned about the game | The match record | The coach's turns | Sent back | The claim checks | The finding", `after the verdict, How it worked lays out the review by stage, open (${stages.join(' | ')})`);
  check(await page.locator('#traceBody .tr-frame img').count() === 1 && await page.locator('#traceBody .tr-frame .el').count() === 2, 'it shows the frame the screen was learned from, with the boxes it kept');
  check(await page.locator('#traceBody .tr-ev.guess').count() >= 3 && await page.locator('#traceBody .tr-ev.known').count() >= 5, `the match record says what code knows apart from what a model guessed (${await page.locator('#traceBody .tr-ev.known').count()} known, ${await page.locator('#traceBody .tr-ev.guess').count()} guessed)`);
  // the turns fold: the live breakdown already showed them as they happened
  check(await page.locator('#traceBody .tr-turns-fold').evaluate((d) => !d.open), "the coach's turns are folded, since the live breakdown showed them");
  await page.locator('#traceBody .tr-turns-fold > summary').click();
  const turnsText = await page.locator('#traceBody ol.tr-turns').innerText();
  check(await page.locator('#traceBody .tr-turn').count() === 9 && await page.locator('#traceBody .tr-turn .tr-think').count() === 9 && /Measured the crosshair against the nearest enemy head at 0:46\.8, 1:40\.6, 2:13\.6, 2:15/.test(turnsText) && /Came back\s*answer: No/.test(turnsText), `each of the coach's turns shows its reasoning, the tool it called in plain words, and what came back (${await page.locator('#traceBody .tr-turn').count()} turns)`);
  const sentBack = await page.locator('#traceBody .tr-sent > li').allInnerTexts();
  check(sentBack.length === 2 && /haven't looked closely at 1:30/.test(sentBack[0]) && /haven't looked at a fight they won/.test(sentBack[1]), `each finish sent back is listed with exactly why (${sentBack.map((x) => x.replace(/\s+/g, ' ').slice(0, 70)).join(' | ')})`);
  const plantedRows = await page.locator('#traceBody .ck-planted li').allInnerTexts();
  check(/Planted to test the checker/.test(await page.locator('#traceBody .ck-plant-head').first().innerText()) && plantedRows.length === 2 && plantedRows.every((x) => /^Caught\s*\d+:\d\d\s*“The player (is killed|dies) here\.”/.test(x) && /False, since /.test(x)), `a block labelled "Planted to test the checker" lists the exact false claims code planted, each caught, with why it's false (${plantedRows.map((x) => x.replace(/\s+/g, ' ').slice(0, 90)).join(' | ')})`);
  check(/^\d+ model calls · [\d.]+k tokens · 6 looks · \d+:\d\d start to end$/.test(await page.locator('#traceBody .tr-total').innerText()), `and it ends with the finding and what the review cost (${await page.locator('#traceBody .tr-total').innerText()})`);
  // the log opens by default now: closed first, so the step link has to open it
  await page.locator('#logBox').evaluate((d) => { d.open = false; });
  await page.click('.key:nth-child(1) .step-link');
  check(await page.locator('#logBox').evaluate((d) => d.open) && await page.locator('.log .beat.flash').count() === 1, 'the step link opens the log at that step');
  await page.locator('#logSummary').click();
  check(await page.locator('#status').isHidden(), 'the spinner is gone when done');
  check(/0:31\s*On the head, and the fight was won/.test(await page.locator('.contrast').innerText()), 'moments they got right show apart from the evidence');
  check(await page.locator('.log .theory.supported').count() === 1, 'the board is kept under How it got here');
  const learning = seen.learns + (seen.boxChecks || 0) + (seen.relocates || 0), research = seen.research + (seen.researchSums || 0), calls = learning + 9 + 1 + seen.feedCalls + seen.deathChecks + 3 + seen.claimChecks + seen.verifyBodies.length + research;
  check(seen.claimChecks === 1, `the finding's claims are checked against the record once, when it passes the other checks (${seen.claimChecks})`);
  const vb = seen.verifyBodies[0], vText = vb.contents[0].parts.map((p) => p.text || '').join(' ');
  const vClaims = [...vText.matchAll(/Claim \d+, at [^:]+:[\d.]+: <data>([^<]*)/g)].map((m) => m[1]);
  check(seen.verifyBodies.length === 1 && vb.contents.length === 1 && !vb.tools && vb.contents[0].parts.filter((p) => /^video\//.test(p.inlineData?.mimeType || '')).length === vClaims.length, `the finding's claims are checked against the video in one call, each with its own run-up as video (${seen.verifyBodies.length} calls, ${vClaims.length} claims)`);
  check(!/Crosshair below head level|Crosshair sits low|theory|Crosshair placement|Trading teammates|They are working on/.test(vText) && !vb.systemInstruction, "the check starts in a context of its own: the claims and the video, none of the coach's reasoning, board, research, or history");
  check(vClaims.filter((x) => /^The player (is killed|dies) here\.$/.test(x)).length === 2 && vClaims.length === 5, `two claims the record shows are false are planted among the three, unmarked (${vClaims.join(' | ')})`);
  check(seen.deathChecks === 1, `each death the low-detail pass saw is looked at again, in one call (${seen.deathChecks})`);
  // the critique's script is written in the background as soon as the report shows, in one call counted with the review's
  await page.waitForSelector('#critique[data-ready]', { timeout: 60000 });
  check(seen.scriptCalls === 1, `as soon as the report shows, the critique's script is written in one call (${seen.scriptCalls})`);
  const summary = await page.locator('#logSummary').innerText();
  check(summary === `How it got here: ${calls + seen.scriptCalls} calls, 6 looks`, `the review counts its model calls (${calls}: learning the game in ${learning} (the learn call, the box check, and the ask again for a box), 9 turns, the scan's ${1 + seen.feedCalls + seen.deathChecks} with its look again at the deaths, 3 aim, 1 claim check, ${seen.verifyBodies.length} by the agent that checks the finding against the video, ${research} researching the game; the page says "${summary}")`);
  check(await page.locator('.log .beat').count() === 11 && openAtEnd, `the breakdown moves into How it got here, open when the verdict shows: how it got there is part of the result (${await page.locator('.log .beat').count()} cards)`);
  check(await page.locator('.log .beat-kind').first().evaluate((e) => e.textContent) === 'Reading the screen', 'the log reads in order, first step first');
  await page.click('.key:nth-child(2) .key-frame');
  await page.waitForFunction(() => document.querySelector('#video').currentTime > 44);
  await page.waitForSelector('#vmarks:not([hidden]) .chip.bad', { timeout: 10000 });
  check(Math.abs(await page.evaluate(() => document.querySelector('#video').currentTime) - 46.8) < 0.3 && await page.locator('.pin.on').count() === 1, 'watching a moment plays up to it, then holds there with the marks over the video');
  await page.click('#acceptBtn');
  check(/next review checks this habit/.test(await page.locator('.accepted').innerText()), 'accepting saves the habit');

  console.log('second review: the re-check');
  seen.agentBodies.length = 0;
  seen.heads = 0;
  heads = [1.0, 0.9, 1.1];
  await page.goto(`${base}#coach`);
  check(/Working on Crosshair below head level/.test(await page.locator('#working').innerText()), 'the start screen shows the habit being worked on');
  await page.setInputFiles('#fileInput', fixture);
  await page.waitForSelector('.question:not([hidden])', { timeout: 60000 });
  check(seen.uploads === 1 && seen.learns === 1, 'the same recording reuses its uploaded scan copy and what was learned about the game');
  check(/They are working on Crosshair below head level/.test(seen.agentBodies[0].systemInstruction.parts[0].text) && /Baseline: Crosshair 2\.2 heads below the head, median of 5 duels/.test(seen.agentBodies[0].systemInstruction.parts[0].text), 'the coach is told the habit and its baseline');
  await page.click('.question [data-skip]');
  await page.waitForSelector('#checkin:not([hidden])', { timeout: 60000 });
  await page.fill('#checkin form input', "My aim's fine, I just peek too wide");
  await page.click('#checkin form button');
  await page.waitForSelector('#verdict:not([hidden])', { timeout: 60000 });
  const doubted = seen.agentBodies.map(lastResults).flat().filter((r) => r.name === 'finish').map((r) => r.response.result).find((x) => x.player_says);
  check(doubted?.player_says === "<data>My aim's fine, I just peek too wide</data>" && /doesn't think Crosshair below head level is what's costing them/.test(doubted.problems[0]), "when they disagree, what they said goes back to the coach, as data, for one more look");
  check(await page.locator('.verdict .checked').innerText() === "You weren't sure. It looked again and kept it.", 'the verdict says it looked again');
  check(/Crosshair below head level: better than before \(2\.2 to 1\.0 heads\)/.test(await page.locator('.progress').innerText()), 'progress is measured against the baseline in code');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('thirdeye.v1')));
  check(stored.matches.length === 2 && stored.matches[1].progress === 'better', 'history keeps both reviews');
  check(/#review\/m/.test(page.url()), 'a finished review has its own address');
  await page.click('#rejectBtn');
  await page.click('#historyBtn');
  await page.waitForSelector('#reviews:not([hidden])');
  check(await page.locator('.cards li').count() === 2, 'past reviews list both matches');
  check(await page.locator('.shelf').count() === 1 && await page.locator('.shelf h2').innerText() === 'SYNTHETIC TEST MATCH' && /Working on Crosshair below head level/.test(await page.locator('.shelf-working').innerText()), "they sit on their game's shelf, which says what's being worked on");
  await page.waitForFunction(() => document.querySelectorAll('.c-shot img').length === 2);
  check(/WORKING ON/i.test(await page.locator('.cards li:nth-child(2) .c-tag').innerText()), 'each review shows a frame, and the one being worked on says so');

  console.log('a past review');
  await page.click('.cards li:nth-child(1) .card');
  await page.waitForSelector('#verdict:not([hidden])');
  check(await page.locator('#reattach').isHidden() && !!(await page.locator('#video').getAttribute('src')), 'a review from this visit has its recording');
  await page.goBack();
  await page.waitForSelector('#reviews:not([hidden])');
  await page.click('.cards li:nth-child(2) .card');
  await page.waitForSelector('#verdict:not([hidden])');
  check(await page.locator('.verdict h2').innerText() === 'CROSSHAIR BELOW HEAD LEVEL' && await page.locator('.key-fix').count() === 3 && await page.locator('.key .chip.bad').count() === 3, 'an older one opens with its marked-up moments and what to do instead');
  check(await page.locator('.log .beat').count() === 11 && await page.locator('#logBox').evaluate((d) => d.open), 'its log keeps every step, open under the verdict');
  check(await page.locator('#traceBody .tr-turn').count() === 9 && await page.locator('#traceBody .ck-planted li.caught').count() === 2 && await page.locator('#traceBody .tr-sent > li').count() === 2, 'and How it worked is drawn again from the saved log, the planted claims included');
  await page.click('#logSummary');
  check(await page.locator('#logBox').evaluate((d) => !d.open), 'and folds on a click');
  await page.click('#logSummary');
  check(await page.locator('.log .beat img').count() >= 4 && await page.locator('.log .beat.measure_aim .box').count() >= 1, 'the log keeps the frames and measured boxes');
  check(await page.locator('.tick').count() === truth.duels.length && await page.locator('.pin').count() === 3, 'the timeline is drawn again');
  await page.waitForFunction(() => !!document.querySelector('#video').getAttribute('src'));
  check(await page.locator('#reattach').isHidden(), "the recording plays from the saved copy, from a visit before this one");
  await page.click('.log .beat.measure_aim img');
  await page.waitForFunction(() => Math.abs(document.querySelector('#video').currentTime - 13.8) < 0.3);
  check(true, 'clicking a frame in the log shows that moment');
  await page.evaluate(async () => (await navigator.storage.getDirectory()).removeEntry('recordings', { recursive: true }));
  const pastUrl = page.url();
  await page.goto('about:blank');
  await page.goto(pastUrl);
  await page.waitForSelector('#verdict:not([hidden])');
  check(await page.locator('.log .beat').count() === 11 && await page.locator('.key-frame img').count() === 3 && await page.locator('#traceBody .ck-planted li').count() === 2, 'after a reload it is drawn from what was saved, How it worked too');
  await page.waitForSelector('#reattach:not([hidden])');
  check(true, 'with no saved copy, it asks for the recording');
  await page.setInputFiles('#reattachInput', chessFile);
  check(/different recording/.test(await page.locator('#reattach .r-err').innerText()), 'the wrong recording is refused');
  await page.setInputFiles('#reattachInput', fixture);
  check(await page.locator('#reattach').isHidden() && !!(await page.locator('#video').getAttribute('src')), 'the right recording loads');
  await page.waitForFunction(async () => { for await (const k of (await (await navigator.storage.getDirectory()).getDirectoryHandle('recordings')).keys()) return !!k; return false; });
  check(true, 'and is kept for next time');

  // A review saved before planted claims, tool answers, thoughts, and the review's totals were logged (agent.js before
  // Oct 25 kept only how many were planted, controls, and which fooled it, fooled): it opens with How it worked all the
  // same, the planted claims counted, in the trace and on the checker's card. It's the first review's log, cut back.
  const firstId = (await page.evaluate(() => JSON.parse(localStorage.getItem('thirdeye.v1')))).matches[0].id;
  const oldId = await page.evaluate(async (id) => {
    const R = window.ThirdeyeReviews, rec = await R.get(id), oldId = `${id}old`;
    const log = rec.log.filter(([kind, e]) => !(kind === 'step' && (e.type === 'result' || e.type === 'thought')) && !(kind === 'mark' && e.what === 'done')).map(([kind, e]) => [kind, e.type === 'frames_checked' ? (({ planted, ...kept }) => kept)(e) : e]);
    await R.save({ ...rec, id: oldId, log });
    const h = JSON.parse(localStorage.getItem('thirdeye.v1'));
    localStorage.setItem('thirdeye.v1.before', JSON.stringify(h));
    localStorage.setItem('thirdeye.v1', JSON.stringify({ ...h, matches: [...h.matches, { ...h.matches.find((m) => m.id === id), id: oldId, at: Date.now() - 1e9 }] }));
    return oldId;
  }, firstId);
  // the address set without a hash change, then a reload, so the page reads the history with the copy in it
  await page.evaluate((id) => window.history.replaceState(null, '', `#review/${id}`), oldId);
  await page.reload();
  await page.waitForSelector('#verdict:not([hidden])');
  const oldTrace = await page.locator('#traceBody .ck-planted').first().innerText(), oldCard = await page.locator('.log .checker .ck-planted').first().innerText();
  check(/Code wrote 2 false claims from the record/.test(oldTrace) && /It caught 2 of the 2\./.test(oldTrace) && /Saved before each planted claim was kept/.test(oldTrace) && /It caught 2 of the 2\./.test(oldCard) && await page.locator('#traceBody .tr-turn').count() === 9 && await page.locator('#traceBody .tr-think').count() === 0 && await page.locator('#traceBody .tr-total').count() === 0, `a review saved before planted claims were listed still says how many were planted and caught, in How it worked and on its card (${oldTrace.replace(/\s+/g, ' ').slice(0, 140)})`);
  // the history as it was, read again, so the reviews after this don't save the copy back
  await page.evaluate(() => { localStorage.setItem('thirdeye.v1', localStorage.getItem('thirdeye.v1.before')); localStorage.removeItem('thirdeye.v1.before'); });
  await page.reload();

  console.log('chess review: moves read off the board and scored by Stockfish in the browser');
  seen.agentBodies.length = 0;
  const feedBefore = seen.feedCalls;
  seen.chess = true;
  await page.goto(`${base}#coach`);
  await page.setInputFiles('#fileInput', chessFile);
  await page.waitForSelector('#checkin:not([hidden])', { timeout: 240000 });
  await page.click('#checkin [data-yes]');
  await page.waitForSelector('#verdict:not([hidden])', { timeout: 60000 });
  check(seen.learns === 2 && seen.gameFiles === 0 && seen.research === 8, 'a new game is learned from its own recording, with no profile file, and researched once (4 searches)');
  const chessScan = firstRecord(seen.agentBodies[0]);
  const want = chessTruth.recordings[path.basename(chessFile)].moves.filter((m) => m.color === 'w');
  check(chessScan?.counts.your_moves === want.length && chessScan.counts.your_blunders >= 5, `the scan reads every move of theirs and grades it (${JSON.stringify(chessScan?.counts)}; truth: ${want.length} moves, ${want.filter((m) => m.grade === 'blunder').length} blunders)`);
  check(/1\. e4/.test(chessScan?.events) && /19\. Nce5 \(blunder/.test(chessScan?.events), 'moves come out numbered, with the blunder named');
  check(seen.scans === 2 && seen.feedCalls === feedBefore, 'reading a chess game makes no video pass and reads no kill feed');
  check(/19\. Nce5 \(blunder: gave away [\d.]+ pawns, their clock 0:/.test(chessScan?.events), 'graded moves carry the clock, read in one call');
  const hud = lastResults(seen.agentBodies[2]).find((r) => r.name === 'read_hud')?.response.result;
  check(seen.hudCalls === 2 && /1:14\.0 0:25/.test(hud?.readings), 'read_hud reads the clock at three moments in one call');
  const chessFirst = lastResults(seen.agentBodies[4]).find((r) => r.name === 'finish')?.response.result;
  check(chessFirst?.ok === false && chessFirst.problems.some((p) => /At 0:34 the engine scores c3 as fine/.test(p)), 'a finish citing a move the engine calls fine is sent back');
  check(await page.locator('.verdict h2').innerText() === 'BLUNDERS WHEN THE CLOCK IS LOW', 'the verdict names the chess habit');
  // How it worked for chess: each graded move is known from the board and the engine, and the record gave nothing to plant
  const chessRows = await page.locator('#traceBody .tr-record .tr-ev').allInnerTexts();
  check(chessRows.filter((x) => /Your move, a blunder/.test(x) && /Code knows · the board and the engine/.test(x)).length >= 5 && await page.locator('#traceBody .tr-ev.guess').count() === 0 && await page.locator('#traceBody .tr-stage-checks .ck-planted.none').count() >= 1, `How it worked lists each graded move as known from the board and the engine, and says no false claim could be planted from a chess record (${chessRows.length} lines)`);
  await page.waitForFunction(() => document.querySelectorAll('.key .chip.bad').length === 3);
  check(seen.markCalls === 0 && await page.locator('.key .chip.bad', { hasText: /^Nce5 \(blunder\)$/ }).count() === 1 && await page.locator('.key .marks path.bad.arrow').count() === 3, `each blunder is drawn from the board itself: the move played, and the engine's (${await page.locator('.key .chip').evaluateAll((els) => els.map((e) => e.textContent).join(' | '))})`);
  check(await page.locator('.tick.death').count() >= 5 && /Your blunder/.test(await page.locator('#legend').innerText()), 'the timeline marks the blunders, and the legend says so');
  await page.click('#historyBtn');
  await page.waitForSelector('#reviews:not([hidden]) .shelf');
  const metas = await page.locator('.shelf .c-meta').allInnerTexts();
  check(await page.locator('.shelf').count() === 1 && await page.locator('.shelf h2').innerText() === 'ALL REVIEWS' && await page.locator('.shelf-nav button').count() === 3 && await page.locator('.shelf-nav button[aria-pressed="true"]').innerText().then((t) => /^All/.test(t)) && / · Synthetic chess$/.test(metas[0]), `past reviews are one list, newest first, each with its game, and a chip for all and for each game (${metas.join(' | ')})`);
  await page.click('.shelf-nav button:has-text("Synthetic test match")');
  await page.waitForFunction(() => document.querySelector('.shelf h2')?.textContent === 'Synthetic test match');
  check(await page.locator('.shelf h2').innerText() === 'SYNTHETIC TEST MATCH' && (await page.locator('.shelf .c-meta').allInnerTexts()).every((t) => !/·/.test(t)), "a game's chip shows that game's reviews alone");
  await page.click('.shelf-nav button:has-text("All")');
  await page.waitForFunction(() => /^All reviews$/i.test(document.querySelector('.shelf h2')?.textContent || ''));
  check((await page.locator('.shelf .c-meta').allInnerTexts()).every((t) => /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d\d\s?[AP]M( · .+)?$/.test(t)), `each past review says when it was made, the date and the time (${(await page.locator('.shelf .c-meta').allInnerTexts()).slice(0, 2).join(', ')})`);

  console.log('footage of a whole match: the player says who they are, and it is read point by point');
  seen.agentBodies.length = 0;
  seen.spectator = true;
  seen.chess = false;
  // its critique's script call is refused for the day (both keys out, as on Oct 25), from the background work its report starts
  seen.scriptBusy = true;
  const specScripts = seen.scriptCalls || 0, specVoices = (seen.voiceLines || []).length;
  await page.goto(`${base}#coach`);
  await page.evaluate(() => localStorage.removeItem('thirdeye.learned'));
  // every line the live caption shows, to see what the video played while the coach looked
  await page.evaluate(() => { window.nowLog = []; new MutationObserver(() => { const t = document.getElementById('now')?.innerText; if (t && t !== window.nowLog.at(-1)) window.nowLog.push(t); }).observe(document.getElementById('now'), { childList: true, subtree: true, characterData: true }); });
  await page.setInputFiles('#fileInput', fixture);
  await page.waitForSelector('.question:not([hidden])', { timeout: 60000 });
  check(/Which side are you on/.test(await page.locator('.question p').innerText()) && await page.locator('.question .opts [data-i]').allInnerTexts().then((x) => x.join(' | ')) === 'Blue (blue shirts) | Red (red shirts)', 'footage of the whole match asks which side they are on, with the sides it saw');
  check(seen.agentBodies.length === 0, 'before the coach starts');
  await page.click('.question .opts button:has-text("Blue")');
  await page.waitForFunction(() => /Which one is you/.test(document.querySelector('.question p')?.textContent || ''));
  check(await page.locator('.question .opts [data-i]').count() === 0, 'then which one they are, in their own words');
  await page.fill('.question form input', '#7, the setter');
  await page.click('.question form button');
  await page.waitForSelector('#checkin:not([hidden])', { timeout: 120000 });
  const specBrief = seen.agentBodies[0].systemInstruction.parts[0].text;
  check(/The player: <data>#7, the setter<\/data> on <data>Blue<\/data> \(<data>blue shirts<\/data>\)\. The sides: Blue \(blue shirts\); Red \(red shirts\)\. Judge the player, not their team\./.test(specBrief), 'the coach is told who the player is, as their words, and to judge them, not their team');
  check(!seen.agentBodies[0].tools[0].functionDeclarations.some((f) => f.name === 'measure_aim'), 'no aim to measure in footage of the whole match');
  check(/Synthetic court match, sports/.test(await page.locator('.beat.learn .beat-why').innerText()) && /Footage of the whole match, read point by point: Blue \(blue shirts\) vs Red \(red shirts\)/.test(await page.locator('.beat.learn').innerText()), 'the first card says how the footage is read');
  const specScan = firstRecord(seen.agentBodies[0]);
  check(specScan?.counts.units === 6 && specScan.counts.the_pass_thought_lost === 3 && /^W1 0:0\d\.\d–0:\d\d\.\d: a point, the low-detail pass saw: Red wins the point$/.test(specScan.windows[0]), `the scan lists each point as a window to read (${JSON.stringify(specScan?.counts)}; ${specScan?.windows?.[0]})`);
  const researchedSpec = lastResults(seen.agentBodies[1]).find((r) => r.name === 'research')?.response.result;
  check(seen.roleSearch === 1 && /<data>#7, the setter<\/data>/.test(seen.roleAsk) && /^setter: a point is won when The set lands/.test(researchedSpec?.their_role || ''), 'research looks up what wins and loses a point in their role, their words as data');
  const early = lastResults(seen.agentBodies[2]).find((r) => r.name === 'finish')?.response.result;
  check(early?.ok === false && /How these points went isn't read yet: W1, W2, W3, W4, W5, W6\. Read them \(read_clips\)/.test(early.problems[0]), 'ending before any point is read is sent back: the points could be losses');
  const unitsRead = lastResults(seen.agentBodies[3]).find((r) => r.name === 'read_clips')?.response.result;
  check(seen.unitReads === 3 && /Outcome for the player: lost \(The set was off target, so Red won the point\.\), decided by player\./.test(unitsRead?.clips[0]) && /a point they lost/.test(unitsRead?.where_they_lost), `each point is read as video, two to a call, and says how it went for the player (${seen.unitReads} calls)`);
  check(/For a player in their role \(setter\), a point counts as won when: The set lands/.test(seen.unitPrompt), "the reads judge a point by what research says wins and loses one in the player's role");
  check(await page.locator('#track .fight.lost').count() === 3 && await page.locator('#track .fight.won').count() === 3, 'the timeline shows the points, won and lost');
  // the run-up to each lost point, watched as video: one clip a moment, at the clip's own frame rate, for 1 look each
  const watched = seen.agentBodies[4].contents.at(-1).parts, clips = watched.filter((p) => /^video\//.test(p.inlineData?.mimeType || ''));
  const lookResult = lastResults(seen.agentBodies[4]).find((r) => r.name === 'frames')?.response.result, looksLeft = (r) => +String(r?.budget || '').match(/^(\d+) of/)?.[1];
  check(clips.length === 3 && clips.every((p) => p.videoMetadata?.fps === 6) && !watched.some((p) => p.inlineData?.mimeType === 'image/jpeg') && /^full from 0:04\.0 to 0:11\.0 as video, 6 frames a second/.test(watched.find((p) => p.text)?.text || '') && lookResult?.images === '3 attached' && looksLeft(unitsRead) - looksLeft(lookResult) === 3, `a clip look sends each run-up as video, not stills, for 1 look each (${clips.map((p) => p.inlineData.mimeType).join(', ')}; ${watched.find((p) => p.text)?.text})`);
  check(await page.locator('.shot-group.watched video[src^="blob:"]').count() === 3, 'the breakdown shows the very clips the coach watched');
  const nowLog = await page.evaluate(() => window.nowLog);
  check(nowLog.some((l) => /Watching 0:04\.0–0:11\.0, the stretch the coach watches/.test(l)), `the video plays the same stretch while the coach watches it (${nowLog.filter((l) => /Watching/.test(l)).slice(0, 2).join(' | ').replace(/\n/g, ' ')})`);
  await page.click('#checkin [data-yes]');
  await page.waitForSelector('#verdict:not([hidden])', { timeout: 60000 });
  check(await page.locator('.verdict h2').innerText() === 'LATE TO THE BALL ON THE SET', 'a finding at the points they lost passes the checks');
  // the call fails, so the critique says the finding's own lines and keeps nothing; the next play asks again, and says
  // and keeps the script it gets
  const specId = decodeURIComponent(new URL(page.url()).hash.slice(8)), keptScriptOf = (id) => page.evaluate(async (x) => (await window.ThirdeyeReviews.get(x))?.script ?? null, id);
  await page.waitForSelector('#critique[data-ready]', { timeout: 60000 });
  const busyLines = (seen.voiceLines || []).slice(specVoices).map((l) => l.text), afterBusy = await keptScriptOf(specId);
  check(seen.scriptRefusals > 0 && (seen.scriptCalls || 0) === specScripts && afterBusy === null && /^First, here's the habit\. Arrives late/.test(busyLines[1] || '') && /didn't answer its script call, so the next play asks again/.test(await page.locator('#trScript').innerText()), `when the script call fails (${seen.scriptRefusals} requests refused for the day), the critique makes the finding's own lines and keeps nothing (${busyLines[1]})`);
  seen.scriptBusy = false;
  const retryVoices = (seen.voiceLines || []).length;
  await page.click('#cqPlay');
  await page.waitForFunction(() => document.querySelector('#cqPlayText')?.textContent === 'Pause', null, { timeout: 60000 });
  await page.click('#cqStop');
  // its lines as the kept script has them: one the same as an earlier review's (every mocked script closes alike, and
  // two reviews with as many moments open alike) is made once and played from the page's cache, so it isn't asked again
  const afterRetry = await keptScriptOf(specId), retryFirst = afterRetry?.moments?.[0] || '';
  check(seen.scriptCalls === specScripts + 1 && afterRetry?.moments?.length === 3 && !afterRetry.failed && /^Watch this first one\. Arrives late/.test(retryFirst) && (seen.voiceLines || []).slice(retryVoices).some((l) => l.text === retryFirst) && /written from the finding in one call/.test(await page.locator('#trScript').innerText()), `and the next play asks again, and says and keeps the script it gets (${retryFirst})`);
  // How it worked for footage of the whole match: each point's outcome is a clip read's, so it's a model's guess
  const points = await page.locator('#traceBody .tr-ev').evaluateAll((els) => els.filter((el) => /^Point (won|lost)$/.test(el.querySelector('.tr-kind')?.textContent || '')).map((el) => el.className));
  check(points.length === 6 && points.every((c) => /\bguess\b/.test(c)), `How it worked lists each point, its outcome badged as a model's read of the clip, not code's (${points.length} points)`);
  check((await page.evaluate(() => JSON.parse(localStorage.getItem('thirdeye.players') || '{}')))['synthetic court match|spectator']?.who === '#7, the setter', 'who they are is kept for the next review of this game');
  seen.spectator = false;

  console.log('no habit repeats: the biggest reason they lost is named anyway');
  seen.agentBodies.length = 0;
  seen.oneOff = true;
  const checksBefore = { claims: seen.claimChecks, agents: seen.verifyBodies.length }, voicesBefore = (seen.voiceLines || []).length, oneOffScripts = seen.scriptCalls || 0;
  seen.fooled = true;
  await page.goto(`${base}#coach`);
  await page.evaluate(() => localStorage.removeItem('thirdeye.learned'));
  await page.setInputFiles('#fileInput', fixture);
  await page.waitForSelector('#verdict:not([hidden])', { timeout: 120000 });
  const record = firstRecord(seen.agentBodies[0]), offered = seen.agentBodies[0].tools[0].functionDeclarations.map((f) => f.name);
  check(record?.counts?.your_deaths === 5 && !offered.includes('scan'), `the coach starts with the match record, read before its first turn, so no turn goes on asking for it (${record?.counts?.your_deaths} deaths; tools: ${offered.join(', ')})`);
  check(offered.includes('read_clips') && (record?.windows || []).some((w) => /their death/.test(w)), `with no kill feed, each loss is a window the coach can watch as video, not stills alone (${(record?.windows || []).slice(0, 2).join(' | ')})`);
  const bare = lastResults(seen.agentBodies[1]).find((r) => r.name === 'finish')?.response.result;
  check(bare?.ok === false && bare.problems.some((x) => /Name the biggest reason they lost in this match \(reason\), even if it happened once: what cost them the most at 0:\d\d .*their death/.test(x)), `ending with nothing named, after five deaths, is sent back for the reason (${(bare?.problems || []).map((x) => x.slice(0, 60)).join(' | ')})`);
  check(/what cost you this match · once, not a habit/i.test(await page.locator('.verdict .kind').innerText()) && await page.locator('.verdict h2').innerText() === REASON.reason.toUpperCase() && await page.locator('.key-fix').count() === 1, 'the verdict names what cost them, once, with the moment and what to do instead');
  // the critique: the finding played back with a voice over the video, moment by moment
  check(await page.locator('#critique').isVisible() && await page.locator('#cqChapters .cq-ch').count() === 5 && await page.locator('#cqChapters .cq-ch.habit').count() === 1 && /^Narrated · 5 moments, 1 where it shows · about \d+:\d\d$/.test(await page.locator('#cqMeta').innerText()), `under the video, the critique lists every moment they lost as a chapter, the habit's flagged (${await page.locator('#cqMeta').innerText()})`);
  await shot(page, 'verdict-oneoff');
  const oneOffUrl = page.url();
  // every caption and title card shown over the video, in order
  await page.evaluate(() => { window.capLog = []; window.cardLog = []; window.capFirstAt = 0; const log = (id, into) => new MutationObserver(() => { const el = document.getElementById(id), t = el.hidden ? '' : el.innerText; if (t && id === 'caption' && !window.capFirstAt) window.capFirstAt = Date.now(); if (t && t !== into.at(-1)) into.push(t); }).observe(document.getElementById(id), { childList: true, subtree: true, characterData: true, attributes: true }); log('caption', window.capLog); log('cqCard', window.cardLog); });
  // made as soon as the report showed, in the background: the script in one call, then all 7 lines' voice
  await page.waitForSelector('#critique[data-ready]', { timeout: 60000 });
  // the critique's 7 lines, as the script kept with the review has them; each made by now, here or for an earlier review
  // that said the same words (every mocked script closes alike), since a line's voice is made once a page
  const oneOffId = decodeURIComponent(new URL(page.url()).hash.slice(8)), oneOffScript = await page.evaluate(async (id) => (await window.ThirdeyeReviews.get(id))?.script ?? null, oneOffId);
  const scriptLines = oneOffScript && !oneOffScript.failed ? [oneOffScript.open, ...oneOffScript.moments, oneOffScript.close] : [];
  const made = (t, by = Infinity) => (seen.voiceLines || []).some((l) => l.text === t && l.at <= by);
  check(seen.scriptCalls - oneOffScripts === 1 && scriptLines.length === 7 && scriptLines.every((t) => made(t)), `as soon as the report shows, the script is written and all 7 of its lines' voice made, before anyone presses play (${scriptLines.filter((t) => made(t)).length} of ${scriptLines.length} made, ${(seen.voiceLines || []).length - voicesBefore} of them for this review)`);
  await page.click('#cqPlay');
  await page.waitForFunction(() => document.querySelector('#cqPlayText')?.textContent === 'Pause');
  await shot(page, 'critique-intro');
  const said = () => (seen.voiceLines || []).map((l) => l.text), shownOver = () => page.evaluate(() => ({ caps: window.capLog, cards: window.cardLog }));
  await page.waitForFunction(() => window.capLog.some((c) => /moments that cost you/.test(c)), null, { timeout: 15000 }).catch(() => {});
  const opening = await shownOver(), firstCaption = await page.evaluate(() => window.capFirstAt);
  // made beforehand, it starts at once: no getting-ready card, no new call, no line made again
  check(!opening.cards.some((c) => /Getting the critique ready/.test(c)) && seen.scriptCalls - oneOffScripts === 1 && scriptLines.length === 7 && scriptLines.every((t) => made(t, firstCaption)), `pressed after it's made, the critique starts at once, with no getting-ready card and every line made before the first is said (${opening.cards.slice(0, 2).map((c) => c.replace(/\s+/g, ' ')).join(' / ')})`);
  check(scriptLines[0] === "This one comes down to the same corner, twice. Let's go through the 5 moments that cost you." && opening.caps[0] === 'This one comes down to the same corner, twice.' && opening.cards.some((c) => /What cost you this match\s*Peeking the same corner twice/i.test(c)), `watching it, the voice says the script's opening over the verdict's title card, its words as captions over the video (${opening.caps.join(' / ')})`);
  // a coach's words from the finding: each moment its own lead and the finding's words, in order, no time read out
  const leadsSaid = scriptLines.slice(1, 6).map((t) => t.split('. ')[0]);
  check(leadsSaid.join(' | ') === 'Watch this first one | Here it goes wrong | Same story here | Look at this one too | And the last one' && /^Here it goes wrong\. Peeks the corner they just lost at, the same way\.$/.test(scriptLines[2] || '') && scriptLines[6] === 'Next time you die, come back from a different angle.' && !scriptLines.some((t) => /\d:\d\d|seconds into|\b\d{1,2} [0-5]\d\b/.test(t)), `each moment is said as the script has it, in order, and no time is read out (${leadsSaid.join(' | ')})`);
  await page.waitForSelector('#cqChapters .cq-ch.on.habit', { timeout: 30000 });
  await page.waitForFunction(() => Math.abs(document.querySelector('#video').currentTime - 46.8) < 0.3, null, { timeout: 30000 });
  const atMoment = await shownOver();
  check(await page.locator('.key.playing').count() === 1 && /Peeks the corner they just lost at/.test(await page.locator('#cqChapters .cq-ch.on .cq-w').innerText()) && /^Moment \d of 5 · 0:46\.8$/.test(await page.locator('#cqTag').innerText()) && await page.locator('#cqCard').isHidden() && atMoment.caps.includes('Here it goes wrong.'), `then plays the moment the finding cites, tagged over the video, with captions of what is said, its chapter highlighted under it and its card marked (${atMoment.caps.slice(-3).join(' | ')})`);
  // the moment's span, on a loop: marked on the timeline, played again from before the mistake, slowed around it
  const span = await page.evaluate(() => { const s = document.querySelector('#track .cq-span'), tr = document.querySelector('#track').getBoundingClientRect(), r = s?.getBoundingClientRect(), d = document.querySelector('#video').duration; return s ? { from: ((r.left - tr.left) / tr.width) * d, to: ((r.right - tr.left) / tr.width) * d, mistake: !!s.querySelector('i') } : null; });
  check(span && span.from < 46.8 - 2 && span.to > 46.8 && span.mistake, `the timeline marks the span it plays, not one point, with the mistake in it (${span ? `${span.from.toFixed(1)}–${span.to.toFixed(1)} s` : 'none'})`);
  await page.waitForFunction(() => document.querySelector('#video').currentTime > 47.2, null, { timeout: 30000 });
  const looped = await page.waitForFunction(() => document.querySelector('#video').currentTime < 45.5, null, { timeout: 30000 }).then(() => true).catch(() => false);
  const slowed = looped && await page.waitForFunction(() => { const v = document.querySelector('#video'); return Math.abs(v.currentTime - 46.8) < 1.2 && v.playbackRate === 0.5; }, null, { timeout: 30000 }).then(() => true).catch(() => false);
  check(looped && slowed, `and plays it again from before the mistake, slowed around the mistake the second time (looped ${looped}, slowed ${slowed})`);
  check(scriptLines.some((t) => /Killed by Enemy 1\.$/.test(t)) && !said().some((t) => /This is it|Instead:|Where it shows|where it shows/.test(t)), `a review with no turning points says each loss as the record has it (${scriptLines.find((t) => /Enemy 1/.test(t))})`);
  await page.waitForTimeout(900); await shot(page, 'critique-moment');
  await page.click('#cqStop');
  check(await page.locator('#caption').isHidden() && await page.locator('#cqCard').isHidden() && await page.locator('#cqTag').isHidden() && await page.locator('#cqPlayText').innerText() === 'Watch the critique', 'and stops when asked, taking its captions and cards with it');
  // the script is kept with the review, its call counted with the review's, and playing again asks for none
  const kept1 = await page.evaluate(async (id) => { const r = await window.ThirdeyeReviews.get(id); return { script: r?.script, calls: r?.calls, review: r?.log?.find(([k, e]) => k === 'mark' && e.what === 'done')?.[1]?.calls }; }, oneOffId);
  const shownCalls = +(await page.locator('#logSummary').innerText()).match(/(\d+) calls/)[1];
  check(kept1.script?.moments?.length === 5 && !kept1.script.failed && kept1.calls === kept1.review + 1 && shownCalls === kept1.calls && /written from the finding in one call/.test(await page.locator('#trScript').innerText()), `the script is kept with the review, and its one call counted with the review's (${kept1.review} + 1 = ${shownCalls} calls)`);
  const voicesBeforeReplay = (seen.voiceLines || []).length;
  await page.click('#cqPlay');
  await page.waitForFunction(() => document.querySelector('#cqPlayText')?.textContent === 'Pause', null, { timeout: 30000 });
  await page.click('#cqStop');
  check(seen.scriptCalls - oneOffScripts === 1 && (seen.voiceLines || []).length === voicesBeforeReplay, `played again, it asks for no new script and makes no line again (${seen.scriptCalls - oneOffScripts} script calls, ${(seen.voiceLines || []).length - voicesBeforeReplay} lines made)`);
  check(await page.locator('#cqVoice optgroup').first().getAttribute('label') === 'Natural, made on this computer' && await page.locator('#cqVoice').inputValue() === 'kokoro:am_michael', 'the voice is Kokoro\'s Michael, made on this computer, unless they pick another');
  check((seen.voiceLines || []).some((l) => l.voice === 'am_michael' && /Peeks the corner/.test(l.text)), `each line is said by that voice (${(seen.voiceLines || []).length} lines asked for: ${(seen.voiceLines || []).slice(0, 4).map((l) => `${l.voice}: ${String(l.text).slice(0, 40)}`).join(' | ')})`);
  check(await page.locator('#acceptBtn').count() === 0, 'a one-off is not put to them as a habit to work on');
  const agents = seen.verifyBodies.slice(checksBefore.agents);
  check(seen.claimChecks - checksBefore.claims === 1 && agents.length === 2, `the reason's moments are checked against the record and the video, like a habit's; agreeing with a planted false claim, the check gets one fresh try (${agents.length} calls)`);
  check(/The check against the video didn't hold up this time/.test(await page.locator('.verdict .trust.warn').innerText()) && (await page.evaluate(() => JSON.parse(localStorage.getItem('thirdeye.v1')).matches.at(-1))).found === false, "and when it agrees with one again, the report says the video check doesn't count");
  seen.fooled = false;
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('thirdeye.v1')).matches.at(-1));
  check(kept.found === false && kept.reason === REASON.reason, 'history keeps the reason');
  seen.oneOff = false;

  console.log("a finding that doesn't hold up still names what cost them, from what did");
  seen.agentBodies.length = 0;
  seen.salvage = true;
  const salvageVoices = (seen.voiceLines || []).length, salvageScripts = seen.scriptCalls || 0;
  await page.goto(`${base}#coach`);
  await page.evaluate(() => localStorage.removeItem('thirdeye.learned'));
  await page.setInputFiles('#fileInput', fixture);
  await page.waitForSelector('#verdict:not([hidden])', { timeout: 120000 });
  const salvaged = await page.evaluate(() => JSON.parse(localStorage.getItem('thirdeye.v1')).matches.at(-1));
  check(seen.agentBodies.length === 5 && await page.locator('.verdict h2').innerText() === 'FIGHTING WIDE ANGLES ALONE' && salvaged.reason === 'Fighting wide angles alone', `sent back twice and told to decide, the finding still doesn't stand, and the review names it anyway from the moment that held up, never "nothing named" (${await page.locator('.verdict h2').innerText()})`);
  check(/didn't hold up after two send-backs, so this names what the moments both checks let stand \(1 of its moments were left out\)/.test(await page.locator('.verdict .trust.warn').innerText()) && await page.locator('.key-fix').count() === 1, `the report says so, and shows only the moment that held up (${await page.locator('.verdict .trust').innerText()})`);
  const chapters = await page.locator('#cqChapters .cq-ch .cq-w').allInnerTexts();
  check(chapters.length === 3 && chapters.some((t) => /Swings out a second time into the same enemy\. The enemy had already seen them and held the angle\. Reset after the first contact/.test(t)) && !chapters.some((t) => /Killed by/.test(t)), `the critique plays the moments that decided their losses, each with what made it lose and what to do instead, not every death (${chapters.length}: ${chapters.map((t) => t.slice(0, 40)).join(' | ')})`);
  // saved as a video: the same critique drawn with its marks, tag, cards, and captions onto a canvas as it plays,
  // recorded with the voice mixed in through WebAudio, and downloaded as one file: MP4 where the recorder makes it (a
  // Mac's QuickTime won't open WebM), else WebM. It records in real time.
  check(await page.locator('#cqSave').isVisible() && await page.locator('#cqSave').isEnabled(), 'the critique offers to be saved as a video');
  // when it starts recording, and every title card shown while it records
  await page.waitForSelector('#critique[data-ready]', { timeout: 60000 });
  await page.evaluate(() => { window.recLog = []; const box = document.getElementById('critique'), card = document.getElementById('cqCard'), note = () => window.recLog.push({ rec: box.classList.contains('recording'), card: card.hidden ? '' : card.innerText, at: Date.now() }); new MutationObserver(note).observe(box, { attributes: true, attributeFilter: ['class'] }); new MutationObserver(note).observe(card, { childList: true, subtree: true, characterData: true, attributes: true }); });
  const downloaded = page.waitForEvent('download', { timeout: 180000 });
  await page.click('#cqSave');
  await page.waitForFunction(() => document.querySelector('#critique')?.classList.contains('recording'), null, { timeout: 30000 });
  // the canvas the file is made from has the picture on it, not black: a share of its pixels lit
  // (counted in each page function itself: the page's policy refuses code made from a string)
  const drawn = await page.evaluate(() => { const c = document.querySelector('.rec-canvas'), d = c ? c.getContext('2d').getImageData(0, 0, c.width, c.height).data : []; let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) lit++; return d.length ? lit / (d.length / 4) : 0; });
  check(/^Recording the critique as it plays/.test(await page.locator('#cqNote').innerText()) && await page.locator('#cqSave').isDisabled() && await page.locator('#cqPlayText').innerText() === 'Pause' && drawn > 0.005, `saving plays the critique and records it as it plays, drawn onto its canvas (${(drawn * 100).toFixed(1)}% of the canvas lit; ${await page.locator('#cqNote').innerText()})`);
  const saved = await downloaded, file = fs.readFileSync(await saved.path()), mp4 = file.subarray(4, 8).toString() === 'ftyp';
  const tracks = (mp4 ? ['avc1', 'mp4a', 'Opus'] : ['V_VP8', 'V_VP9', 'A_OPUS']).filter((c) => file.includes(c));
  const picture = mp4 ? tracks.includes('avc1') : tracks.some((c) => c.startsWith('V_')), voice = mp4 ? tracks.includes('mp4a') || tracks.includes('Opus') : tracks.includes('A_OPUS');
  check(new RegExp(`^eye-catcher-critique-synthetic-test-match-\\d{4}-\\d\\d-\\d\\d\\.${mp4 ? 'mp4' : 'webm'}$`).test(saved.suggestedFilename()) && (mp4 || file.readUInt32BE(0) === 0x1a45dfa3) && picture && voice && file.length > 20000, `it ends as one ${mp4 ? 'MP4' : 'WebM'} file, named by its type, with the picture and the voice (${saved.suggestedFilename()}, ${file.length} bytes, ${tracks.join(', ')})`);
  // and a frame of that file, played back in the page, is the picture, not black
  await page.route('**/saved-critique', (route) => route.fulfill({ status: 200, contentType: mp4 ? 'video/mp4' : 'video/webm', body: file }));
  const played = await page.evaluate(async () => {
    const v = document.createElement('video');
    v.muted = true;
    v.src = '/saved-critique';
    await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = () => no(new Error("the file didn't decode")); setTimeout(() => no(new Error('it never loaded')), 15000); });
    await v.play().catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    v.pause();
    const c = document.createElement('canvas');
    c.width = 320; c.height = 180;
    const g = c.getContext('2d');
    g.drawImage(v, 0, 0, 320, 180);
    const d = g.getImageData(0, 0, 320, 180).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) lit++;
    return lit / (d.length / 4);
  }).catch((e) => e.message);
  check(typeof played === 'number' && played > 0.005, `a frame of the saved file, played back, shows the picture (${typeof played === 'number' ? `${(played * 100).toFixed(1)}% of pixels lit` : played})`);
  await page.waitForFunction(() => /^Saved /.test(document.querySelector('#cqNote')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
  // its script said a number no moment gives, so the critique said the finding's own lines, each brought in by how it
  // follows the last, with no lead twice running and no time read out
  const salvageLines = (seen.voiceLines || []).slice(salvageVoices).map((l) => l.text), salvageMoments = salvageLines.filter((t) => !/^(What cost you|The habit costing|The drill)/.test(t));
  const runs = (xs) => xs.every((x, i) => i === 0 || x !== xs[i - 1]), leads = salvageMoments.map((t) => t.split(',')[0]), segues = salvageMoments.map((t) => t.split('. ')[0]);
  check(seen.scriptCalls - salvageScripts === 1 && /didn't hold up, since moment 1 said 25, which its text doesn't/.test(await page.locator('#trScript').innerText()) && !salvageLines.some((t) => /25 bullets/.test(t)) && salvageMoments.length === 3 && /^First, here's what cost you\. /.test(salvageMoments[0]) && runs(leads) && runs(segues) && !salvageLines.some((t) => /\d:\d\d|seconds into|\b\d{1,2} [0-5]\d\b/.test(t)), `a script that says a number its moment doesn't is refused in code, and the critique says the finding's own lines, no time read out, no lead twice running (${segues.join(' | ')})`);
  // the file opens on the critique's own first card: every line made before it records, and the getting-ready card,
  // which a saved Siege critique (Oct 25) held for over a minute, is never in it
  const recLog = await page.evaluate(() => window.recLog), recStart = recLog.find((x) => x.rec), firstFrame = await page.locator('#critique').getAttribute('data-first-frame');
  check(firstFrame === 'What cost you this match' && recStart && /What cost you this match/i.test(recStart.card) && !recLog.some((x) => x.rec && /Getting the critique ready/.test(x.card)) && (seen.voiceLines || []).slice(salvageVoices).every((l) => l.at <= recStart.at), `the saved file opens on the verdict's card, with every line made before it starts recording and no getting-ready card in it (first frame: ${firstFrame}; cards while recording: ${[...new Set(recLog.filter((x) => x.rec).map((x) => x.card.replace(/\s+/g, ' ').slice(0, 30)))].join(' / ')})`);
  check(/^Saved eye-catcher-critique-.*\.(mp4|webm) · [\d.]+ MB$/.test(await page.locator('#cqNote').innerText()) && !(await page.evaluate(() => document.querySelector('#critique').classList.contains('recording'))), `and says it was saved (${await page.locator('#cqNote').innerText()})`);
  seen.salvage = false;

  if (process.env.E2E_SHOTS) { await page.goto(`${base}#reviews`); await page.waitForSelector('#reviews:not([hidden])'); await page.waitForTimeout(800); await shot(page, 'reviews'); }
  console.log('phone width');
  await page.setViewportSize({ width: 375, height: 812 });
  if (process.env.E2E_SHOTS) {
    await page.goto(oneOffUrl);
    await page.waitForSelector('#verdict:not([hidden])');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(process.env.E2E_SHOTS, 'phone-review.png'), fullPage: true });
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `no sideways scroll at 375 px (${overflow})`);
  await page.goto(base);
  check(await page.locator('.tabbar').isVisible() && await page.locator('.side').isHidden(), 'on a phone the sidebar becomes a tab bar');
  await page.click('.tabbar a[data-tab="reviews"]');
  await page.waitForSelector('#reviews:not([hidden])');
  check(await page.locator('.tabbar a[aria-current]').innerText() === 'Reviews', 'a tab goes there and is marked');
  check(seen.outside.length === 0, `no code loads from outside the app${seen.outside.length ? `: ${[...new Set(seen.outside)].join(', ')}` : ''}`);
  // the 429s the script-call case answers on purpose show as failed loads in the console; any other error counts
  const unexpected = errors.filter((e) => !(seen.scriptRefusals > 0 && /status of 429/.test(e) && /generativelanguage\.googleapis\.com/.test(e)));
  check(unexpected.length === 0, `no page errors${unexpected.length ? `: ${unexpected.join(' | ')}` : ''}`);
} finally {
  await browser.close();
  server.close();
}
console.log(fail.length ? `\n${fail.length} failed` : '\nall passed');
process.exit(fail.length ? 1 : 0);
