// Unit tests for chess-reader.js: reading moves from board snapshots, and centipawn loss. Node's chess.js and Stockfish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../chess-reader.js');
const { Chess } = require('chess.js');

// what the screen shows for a position, square by square, as readBoard would read it
const screen = (game) => R.boardOf(game);
const play = (fen, ...sans) => { const g = new Chess(fen); for (const s of sans) g.move(s); return g; };
const START = new Chess().fen();

test('the squares of a board on screen, White at the bottom unless flipped', () => {
  const sq = R.boardSquares({ x: 100, y: 50, size: 400 });
  assert.deepEqual(sq.find((s) => s.sq === 'a8'), { sq: 'a8', x: 100, y: 50, s: 50 });
  assert.deepEqual(sq.find((s) => s.sq === 'h1'), { sq: 'h1', x: 450, y: 400, s: 50 });
  assert.deepEqual(R.boardSquares({ x: 0, y: 0, size: 80 }, { flipped: true }).find((s) => s.sq === 'h1'), { sq: 'h1', x: 0, y: 0, s: 10 });
});

test('a move is the legal move whose board explains what changed', () => {
  const cases = [
    [START, ['e4']], [play(START, 'e4', 'd5').fen(), ['exd5']], // a capture
    ['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['O-O']], ['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['O-O-O']], ['r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', ['O-O-O']],
    ['4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2', ['exd6']], // en passant
    ['8/4P3/8/8/8/8/k7/4K3 w - - 0 1', ['e8=Q']], // promotion
  ];
  for (const [fen, sans] of cases) {
    const before = new Chess(fen), after = play(fen, ...sans);
    const r = R.matchMove(Chess, fen, screen(before), screen(after));
    assert.equal(r.moves.map((m) => m.san).join(' '), after.history().join(' '), `${fen} ${sans}`);
    assert.equal(r.fit, 1);
  }
});

test('a highlight leaving the last move\'s squares and a reply between samples are read right', () => {
  const fen = play(START, 'e4').fen(), before = screen(new Chess(fen));
  const after = { ...screen(play(fen, 'e5')) };
  // the last move's highlight leaving e2 and e4 reads as a change there, though the pieces didn't move
  const prev = { ...before, e2: 'x', e4: 'x' };
  assert.equal(R.matchMove(Chess, fen, prev, after).moves[0].san, 'e5');
  const both = play(fen, 'e5', 'Nf3');
  assert.deepEqual(R.matchMove(Chess, fen, before, screen(both)).moves.map((m) => m.san), ['e5', 'Nf3']);
  assert.equal(R.matchMove(Chess, fen, before, before), null, 'nothing changed: no move');
});

test('centipawn loss is from the mover\'s side, and mates count as huge', () => {
  assert.equal(R.cpLoss({ cp: 50 }, { cp: -250 }, 'w'), 300);
  assert.equal(R.cpLoss({ cp: 50 }, { cp: -250 }, 'b'), 0, 'black gained');
  assert.equal(R.cpLoss({ cp: 0 }, { mate: -2 }, 'w'), R.MATE - 20, 'walking into mate in 2');
  assert.equal(R.cpLoss({ mate: 3 }, { cp: 400 }, 'w') > 9000, true, 'missing a mate');
  assert.equal(R.grade(300), 'blunder');
  assert.equal(R.grade(120), 'mistake');
  assert.equal(R.grade(40), null);
});

test('Stockfish scores positions from White\'s side', async () => {
  const engine = R.createNodeEngine();
  const up = await engine.evaluate('4k3/8/8/8/8/8/8/QQ2K3 w - - 0 1', { depth: 8 });
  assert.ok(up.mate > 0 || up.cp > 1000, `two queens up is winning for White (${JSON.stringify(up)})`);
  const mated = await engine.evaluate('R5k1/5ppp/8/8/8/8/8/4K3 b - - 0 1', { depth: 4 });
  assert.equal(R.asCp(mated), R.MATE, 'Black is mated');
  const plies = [{ fen: play(START, 'f3').fen(), color: 'w' }, { fen: play(START, 'f3', 'e5').fen(), color: 'b' }, { fen: play(START, 'f3', 'e5', 'g4').fen(), color: 'w' }];
  const scored = await R.scoreGame(engine, START, plies, { depth: 10 });
  assert.equal(scored[2].grade, 'blunder', `g4 allows Qh4 mate (${scored[2].loss})`);
  engine.quit();
});

test("a board's own dark share tells its black pieces from its white ones", () => {
  // chess.com on a phone, Oct 24: black pawns with 8-11% dark pixels, white pieces with none, under a fixed 12%
  const s = 20, w = s * 8, data = new Uint8ClampedArray(w * w * 4).fill(200);
  const paint = (file, rank, dark, mid = 0) => {
    const x0 = file * s, y0 = (8 - rank) * s;
    let k = 0;
    for (let y = y0 + 4; y < y0 + s - 4; y++) for (let x = x0 + 4; x < x0 + s - 4; x++, k++) { const v = k % 100 < dark * 100 ? 40 : k % 100 < (dark + mid) * 100 ? 120 : 250; const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; }
  };
  for (let f = 0; f < 8; f++) { paint(f, 1, 0.0, 0.3); paint(f, 2, 0.0, 0.3); paint(f, 7, 0.07, 0.4); paint(f, 8, 0.2, 0.4); }
  const img = { data, width: w, height: w }, squares = R.boardSquares({ x: 0, y: 0, size: w });
  const split = R.darkSplit(img, squares);
  assert.ok(split > 0.01 && split < 0.08, `the split falls between the white pieces' share and the black pawns' (${split})`);
  const read = R.readBoard(img, squares, { darkShare: split });
  assert.equal(read.a7, 'b'); assert.equal(read.a2, 'w'); assert.equal(read.a8, 'b'); assert.equal(read.a4, '.');
  // with the fixed share the pawns read white
  assert.equal(R.readBoard(img, squares).a7, 'w');
});

test("a move's threat, in code: what it takes and what the moved piece attacks after", () => {
  // a knight takes on f7 and forks the queen and the rook
  const fork = R.moveThreat(Chess, 'rnbqk2r/pppp1ppp/5n2/2b1N3/4P3/8/PPPP1PPP/RNBQKB1R w KQkq - 0 4', 'e5f7');
  assert.deepEqual(fork, { san: 'Nxf7', captured: 'pawn', check: false, attacks: ['queen on d8', 'rook on h8'] });
  // the game graded on Oct 25: after 16.Qd3, ...Bc4 hits the queen, with the knight on e2 behind it
  const game = play(new Chess().fen(), ...'e4 d5 f4 dxe4 Nc3 e6 Nxe4 Nf6 Nxf6+ Qxf6 Ne2 e5 fxe5 Qxe5 d4 Qe6 Qd3 Qg6 Qb5+ Qc6 Qe5+ Be6 Bd2 Nd7 Qe3 O-O-O O-O-O Bd6 Bc3 Rde8 Qd3'.split(' '));
  assert.deepEqual(R.moveThreat(Chess, game.fen(), 'e6c4').attacks, ['queen on d3 with the knight on e2 behind it']);
  game.move('Qa6'); game.move('Qxa6'); game.move('bxa6'); game.move('Nf4');
  assert.deepEqual(R.moveThreat(Chess, game.fen(), 'd6f4'), { san: 'Bxf4+', captured: 'knight', check: true, attacks: [] }, 'a check is said as one, not as the king attacked');
  assert.equal(R.moveThreat(Chess, new Chess().fen(), 'e2e5'), null, 'a move that can\'t be played there');
  assert.equal(R.moveThreat(Chess, new Chess().fen(), ''), null);
});

test("the engine's own move loses nothing, whatever the next search scores", async () => {
  // a shallow search sees further from the next position: 13.Qe3 was graded a mistake while being the engine's best
  const scores = [{ cp: 100, best: 'e2e4' }, { cp: -20, best: 'e7e5' }, { cp: 160, best: 'g1f3' }]; // from White's side
  const engine = { evaluate: async (fen) => scores.shift() };
  const g = new Chess(), a = g.move('e4'), fenA = g.fen(), b = g.move('d5'), fenB = g.fen();
  const out = await R.scoreGame(engine, new Chess().fen(), [{ ...a, fen: fenA }, { ...b, fen: fenB }], { depth: 1 });
  assert.deepEqual(out.map((m) => [m.san, m.loss, m.grade]), [['e4', 0, null], ['d5', 180, 'mistake']]);
});

test("what the engine's line wins, in code: 16.Qd3 costs a pawn, not the queen", () => {
  // the engine's line after 16.Qd3 in the Oct 24 game, as Stockfish gave it at depth 10
  const game = play(new Chess().fen(), ...'e4 d5 f4 dxe4 Nc3 e6 Nxe4 Nf6 Nxf6+ Qxf6 Ne2 e5 fxe5 Qxe5 d4 Qe6 Qd3 Qg6 Qb5+ Qc6 Qe5+ Be6 Bd2 Nd7 Qe3 O-O-O O-O-O Bd6 Bc3 Rde8 Qd3'.split(' '));
  const gain = R.lineGain(Chess, game.fen(), ['e6c4', 'd3d2', 'c6a6', 'e2g3', 'a6a2']);
  assert.equal(gain.line, 'Bc4 17. Qd2 Qa6 18. Ng3 Qxa2');
  assert.equal(gain.pawns, 1);
  assert.match(gain.text, /^Black comes out 1 pawn of material up \(a pawn\)$/);
  // a line that captures nothing gains position, said as such
  assert.match(R.lineGain(Chess, new Chess().fen(), ['e2e4', 'e7e5']).text, /no material changes hands/);
  assert.equal(R.lineGain(Chess, new Chess().fen(), []), null);
});
