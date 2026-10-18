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
