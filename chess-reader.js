/* Eye Catcher reads a chess game from video in code, with no model calls: it finds the board's 64 squares on screen,
 * reads each square as empty, a white piece, or a black piece, and takes each move as the legal move (chess.js) whose
 * resulting board best explains the squares that changed. Stockfish scores every position, which gives each of the
 * player's moves an exact centipawn loss: the ground truth a chess coach is checked against. Loaded in the browser
 * as window.ThirdeyeChess and in Node through require(). */
(function (root) {
  const FILES = 'abcdefgh';
  // shipped with the app (npm run vendor): chess.js@1.4.0, and Stockfish 10.0.2's asm.js build, which has no wasm to locate
  const CHESS_URL = './vendor/chess.js';
  const ENGINE_URL = 'vendor/stockfish.asm.js';
  const MATE = 10000;

  // ---------- the board on screen ----------
  /** The 64 squares of a board { x, y, size } in pixels: { sq: 'e4', x, y, s }, White at the bottom unless flipped. */
  function boardSquares({ x, y, size }, { flipped = false } = {}) {
    const s = size / 8, out = [];
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const file = flipped ? 7 - col : col, rank = flipped ? row + 1 : 8 - row;
      out.push({ sq: FILES[file] + rank, x: x + col * s, y: y + row * s, s });
    }
    return out;
  }

  const lum = (d, i) => d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
  /**
   * What one square shows, from the middle of it (a margin off each edge, where highlights and coordinates sit): the
   * luminance spread (a piece has edges; an empty square, highlighted or not, is flat), and the shares of very dark
   * and very bright pixels, which tell a black piece from a white one.
   */
  function squareLook({ data: d, width: w }, sq, margin = 0.18) {
    const x0 = Math.round(sq.x + sq.s * margin), x1 = Math.round(sq.x + sq.s * (1 - margin));
    const y0 = Math.round(sq.y + sq.s * margin), y1 = Math.round(sq.y + sq.s * (1 - margin));
    let n = 0, sum = 0, sum2 = 0, dark = 0, bright = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const v = lum(d, (y * w + x) * 4);
      n++; sum += v; sum2 += v * v;
      if (v < 70) dark++; else if (v > 225) bright++;
    }
    const mean = sum / Math.max(1, n);
    return { mean, std: Math.sqrt(Math.max(0, sum2 / Math.max(1, n) - mean * mean)), dark: dark / Math.max(1, n), bright: bright / Math.max(1, n) };
  }

  /**
   * The dark share that tells this board's black pieces from its white ones, from a board near the start: one side's
   * pieces on the two rows at the bottom of the screen, the other's on the two at the top. Halfway between the paler
   * side's darkest square and the darker side's palest, when the two don't overlap; else null. A set's own: chess.com's
   * black pawns on a phone recording had 0.08 to 0.11 against the white pieces' 0.005 at most, under the fixed 0.12
   * (Oct 24). squares: as boardSquares gives them, unflipped.
   */
  function darkSplit(img, squares, { spread = 18 } = {}) {
    const share = (rows) => squares.filter((q) => rows.includes(+q.sq[1])).map((q) => squareLook(img, q)).filter((l) => l.std >= spread).map((l) => l.dark);
    const bottom = share([1, 2]), top = share([7, 8]);
    if (bottom.length < 8 || top.length < 8) return null;
    const [pale, dark] = Math.max(...bottom) < Math.min(...top) ? [bottom, top] : Math.max(...top) < Math.min(...bottom) ? [top, bottom] : [null, null];
    return pale ? (Math.max(...pale) + Math.min(...dark)) / 2 : null;
  }
  /** Each square read as '.' (empty), 'w' (a white piece), or 'b' (a black piece): { e4: 'w', ... }. */
  function readBoard(img, squares, { spread = 18, darkShare = 0.12 } = {}) {
    const out = {};
    for (const sq of squares) {
      const l = squareLook(img, sq);
      out[sq.sq] = l.std < spread ? '.' : l.dark >= darkShare ? 'b' : 'w';
    }
    return out;
  }

  /** The same, from a position: { e4: 'w', ... } for every square. Chess is chess.js's Chess. */
  function boardOf(game) {
    const out = {};
    for (const row of game.board()) for (const cell of row) if (cell) out[cell.square] = cell.color;
    for (const f of FILES) for (let r = 1; r <= 8; r++) out[f + r] ??= '.';
    return out;
  }

  /**
   * The move from fen that the screen shows, given the board read before (prev) and after (now) it. Every legal move
   * is played out and scored by how many squares its board gets right, counted over the squares that changed on
   * screen and the squares the move touches: the last move's highlight leaving its squares changes them too, but no
   * candidate is helped by that. With no single move fitting, pairs are tried (a fast reply between two samples).
   * Returns { moves: [{ san, from, to, color, fen }], fit } or null.
   */
  function matchMove(Chess, fen, prev, now) {
    const changed = Object.keys(now).filter((k) => now[k] !== prev[k]);
    if (!changed.length) return null;
    const score = (board, squares) => squares.reduce((n, k) => n + (board[k] === now[k] ? 1 : 0), 0);
    const touched = (m) => [m.from, m.to, ...(m.flags.includes('k') ? rookSquares(m, 'k') : m.flags.includes('q') ? rookSquares(m, 'q') : []), ...(m.flags.includes('e') ? [m.to[0] + m.from[1]] : [])];
    const game = new Chess(fen);
    let best = null;
    for (const m of game.moves({ verbose: true })) {
      game.move(m);
      const board = boardOf(game), squares = [...new Set([...changed, ...touched(m)])];
      const fit = score(board, squares) / squares.length;
      // empty, white, or black can't tell a queen from a knight: a promotion is taken as a queen
      if (!best || fit > best.fit || (fit === best.fit && m.promotion === 'q')) best = { moves: [{ san: m.san, from: m.from, to: m.to, color: m.color, fen: game.fen() }], fit };
      game.undo();
    }
    if (best && best.fit >= 0.99) return best;
    // two moves between samples
    for (const m of game.moves({ verbose: true })) {
      game.move(m);
      for (const r of game.moves({ verbose: true })) {
        game.move(r);
        const board = boardOf(game), squares = [...new Set([...changed, ...touched(m), ...touched(r)])];
        const fit = score(board, squares) / squares.length;
        if (fit > best.fit) best = { moves: [{ san: m.san, from: m.from, to: m.to, color: m.color, fen: afterOne(Chess, fen, m) }, { san: r.san, from: r.from, to: r.to, color: r.color, fen: game.fen() }], fit };
        game.undo();
      }
      game.undo();
    }
    return best;
  }
  const afterOne = (Chess, fen, m) => { const g = new Chess(fen); g.move(m); return g.fen(); };
  const rookSquares = (m, side) => { const r = m.from[1]; return side === 'k' ? ['h' + r, 'f' + r] : ['a' + r, 'd' + r]; };

  // ---------- finding the board and following the game ----------
  /**
   * The board's exact square on screen near a rough box (the learn call's): of the squares around it, the one whose
   * 8x8 grid alternates light and dark most strongly between neighboring squares; half a square off, every square mixes
   * light and dark and the contrast is gone. img: a frame; box { x, y, w, h } in its pixels. Returns { x, y, size }.
   */
  function findBoard(img, box) {
    const { data: d, width: w, height: h } = img;
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += lum(d, (y * w + x) * 4); I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
    const mean = (x0, y0, x1, y1) => { x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0)); x1 = Math.min(w, Math.round(x1)); y1 = Math.min(h, Math.round(y1)); return x1 > x0 && y1 > y0 ? (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0)) : 0; };
    const score = (x, y, size) => {
      const s = size / 8, m = [];
      // most of each square, so a grid even a tenth of a square off mixes light and dark and loses contrast
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) m.push(mean(x + c * s + s * 0.08, y + r * s + s * 0.08, x + (c + 1) * s - s * 0.08, y + (r + 1) * s - s * 0.08));
      let n = 0;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { if (c < 7) n += Math.abs(m[r * 8 + c] - m[r * 8 + c + 1]); if (r < 7) n += Math.abs(m[r * 8 + c] - m[(r + 1) * 8 + c]); }
      return n;
    };
    const side = Math.min(box.w, box.h);
    let best = { x: box.x, y: box.y, size: side, v: -1 };
    const search = (cx, cy, cs, reach, step) => {
      for (let size = cs - reach; size <= cs + reach; size += step) for (let y = cy - reach; y <= cy + reach; y += step) for (let x = cx - reach; x <= cx + reach; x += step) {
        if (x < 0 || y < 0 || x + size > w || y + size > h) continue;
        const v = score(x, y, size);
        if (v > best.v) best = { x, y, size, v };
      }
    };
    search(box.x, box.y, side, side * 0.15, side / 48);
    search(best.x, best.y, best.size, side / 48, side / 256);
    return { x: Math.round(best.x), y: Math.round(best.y), size: Math.round(best.size), score: best.v };
  }

  const STANDARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const same = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);
  /**
   * Follows a game on screen: the board region sampled `fps` times a second, each square read (readBoard), and each
   * board that held for two samples matched to the legal move that explains it (matchMove). White is at the bottom
   * unless more white pieces sit in the top half of the first frame. The first board in view has to be the starting
   * position or a move or two into it. Returns { moves: [{ t, san, from, to, color, fen }], flipped, start, unmatched } or { error }.
   */
  async function readMoves({ video, rect, Chess, fps = 4, from = 0, to = video.duration, signal, onProgress }) {
    const V = root.ThirdeyeVideo, pad = Math.round(rect.size * 0.02);
    const crop = { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), w: rect.size + pad * 2, h: rect.size + pad * 2 };
    const local = { x: rect.x - crop.x, y: rect.y - crop.y, size: rect.size };
    const times = [];
    for (let t = from; t <= Math.min(to, video.duration - 0.05); t += 1 / fps) times.push(+t.toFixed(3));
    let squares = null, flipped = false, fen = STANDARD, stable = null, pending = null, unmatched = 0, error = null, k = 0, tuned = {};
    const moves = [];
    await V.each(video, times, { crop, maxDim: 4096, signal }, ({ t, canvas, w, h }) => {
      onProgress?.(++k / times.length);
      if (error) return;
      const img = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
      if (!squares) {
        // the board's dark-square split, measured once a frame: it was measured three times
        const up = boardSquares(local), split = darkSplit(img, up), look = split != null ? { darkShare: split } : {}, first = readBoard(img, up, look);
        const top = Object.keys(first).filter((sq) => +sq[1] >= 5 && first[sq] === 'w').length, bottom = Object.keys(first).filter((sq) => +sq[1] <= 4 && first[sq] === 'w').length;
        const flip = top > bottom, sq = boardSquares(local, { flipped: flip }), read = readBoard(img, sq, look), start = boardOf(new Chess(STANDARD));
        // The first board in view: the starting position, or a move or two into it (the first moves came before the
        // board was in view). Anything else isn't a board yet, until a third of the recording has gone by: chess.com
        // was still searching for a game in the first frames, and no move was read (Oct 24).
        const opening = same(read, start) ? { moves: [] } : matchMove(Chess, STANDARD, start, read);
        if (opening && (!opening.moves.length || opening.fit >= 0.85)) {
          squares = sq; flipped = flip; stable = read; tuned = look;
          for (const mv of opening.moves) moves.push({ t, ...mv });
          if (opening.moves.length) fen = opening.moves.at(-1).fen;
        } else if (t > from + Math.max(20, (to - from) / 3)) error = "the recording doesn't start from the starting position";
        return;
      }
      const now = readBoard(img, squares, tuned);
      if (same(now, stable)) { pending = null; return; }
      if (!pending || !same(now, pending.board)) { pending = { board: now, t }; return; }
      const m = matchMove(Chess, fen, stable, now);
      if (m && m.fit >= 0.85) { for (const mv of m.moves) moves.push({ t: pending.t, ...mv }); fen = m.moves.at(-1).fen; stable = now; } else unmatched++;
      pending = null;
    });
    return error ? { error } : { moves, flipped, start: STANDARD, unmatched };
  }

  // ---------- engine scores ----------
  /** A score { cp } or { mate } from White's side, as a number of centipawns: a mate is MATE less its distance. */
  const asCp = (e) => (e?.mate != null ? Math.sign(e.mate || 1) * (MATE - Math.abs(e.mate) * 10) : e?.cp ?? 0);
  /** How many centipawns a move gave away, for the side that made it: before and after are scores from White's side. */
  const cpLoss = (before, after, side) => Math.max(0, side === 'w' ? asCp(before) - asCp(after) : asCp(after) - asCp(before));
  /** A mistake or a blunder by centipawn loss, as chess sites grade them; null for anything smaller. */
  const grade = (loss) => (loss >= 250 ? 'blunder' : loss >= 100 ? 'mistake' : null);

  /**
   * A Stockfish engine speaking UCI: evaluate(fen, { depth }) resolves { cp | mate, best } from White's side. make
   * returns the raw engine (its postMessage and an onmessage hook): a Web Worker in the browser, the npm package in
   * Node. One position at a time.
   */
  function uciEngine(raw) {
    let queue = Promise.resolve(), listener = null;
    raw.onmessage = (e) => listener?.(typeof e === 'string' ? e : e?.data ?? '');
    const send = (cmd) => raw.postMessage(cmd);
    const ready = new Promise((resolve) => { listener = (line) => { if (line === 'uciok') resolve(); }; send('uci'); });
    function evaluate(fen, { depth = 12 } = {}) {
      const run = async () => {
        await ready;
        return new Promise((resolve) => {
          let last = {};
          const white = fen.split(' ')[1] === 'w';
          listener = (line) => {
            const m = /score (cp|mate) (-?\d+)/.exec(line);
            // mate 0: the side to move is already mated
            if (m && / depth \d+/.test(line)) last = m[1] === 'cp' ? { cp: (white ? 1 : -1) * +m[2] } : +m[2] === 0 ? { cp: white ? -MATE : MATE } : { mate: (white ? 1 : -1) * +m[2] };
            // and the line it expects, so code can say what that line wins (lineGain) instead of the coach guessing
            const pv = / pv ((?:[a-h][1-8][a-h][1-8][qrbn]? ?)+)/.exec(line);
            if (m && pv) last.pv = pv[1].trim().split(' ').slice(0, 8);
            const b = /^bestmove (\S+)/.exec(line);
            if (b) resolve({ ...last, best: b[1] === '(none)' ? null : b[1] });
          };
          send(`position fen ${fen}`);
          send(`go depth ${depth}`);
        });
      };
      queue = queue.then(run, run);
      return queue;
    }
    return { evaluate, quit: () => send('quit') };
  }
  /** Stockfish in the browser: the asm.js build, run as its own Web Worker. */
  const createEngine = () => uciEngine(new Worker(ENGINE_URL));
  /** Stockfish in Node, from the npm package (stockfish@10.0.2), for building fixtures and tests. */
  const createNodeEngine = () => uciEngine(require('stockfish')());

  /** chess.js's Chess class: the npm package in Node, the same version from vendor/ in the browser. */
  async function loadChess() {
    if (typeof window === 'undefined') return require('chess.js').Chess;
    return (root.__chessLib ||= await import(CHESS_URL)).Chess;
  }

  /**
   * The score of every position in a game and each move's loss: plies [{ fen, color }] in order after start. Returns
   * the plies with before, after (scores from White's side), loss (centipawns for the side that moved), and grade.
   */
  async function scoreGame(engine, start, plies, { depth = 12, onProgress } = {}) {
    const fens = [start, ...plies.map((p) => p.fen)], scores = [];
    for (let k = 0; k < fens.length; k++) {
      // no score and no move: stalemate
      scores.push(await engine.evaluate(fens[k], { depth }).then((s) => (s.cp == null && s.mate == null ? { cp: 0, best: s.best } : s)));
      onProgress?.((k + 1) / fens.length);
    }
    // the engine's own move loses nothing: what it scores as lost there is the next search seeing further, at a shallow
    // depth (13.Qe3 graded a mistake at depth 10 while being the engine's best, Oct 25)
    return plies.map((p, k) => { const own = !!p.from && !!p.to && scores[k].best?.slice(0, 4) === p.from + p.to, loss = own ? 0 : cpLoss(scores[k], scores[k + 1], p.color); return { ...p, before: scores[k], after: scores[k + 1], best: scores[k].best, loss, grade: grade(loss) }; });
  }

  /**
   * What a move does, in code: the move uci (the engine's best reply, say) played from fen, as { san, captured, check,
   * attacks }: the piece it takes, and the pieces (no pawns) the moved piece attacks from its new square. The coach read
   * the frames for why a blunder lost and guessed: "hanging the queen to the queen on c6", where the engine's answer
   * pinned it to the knight behind it (Oct 25). Null when the move can't be played there.
   */
  const PIECES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  // for a bishop, rook, or queen, the other side's piece on the same line past the one it attacks (a pin or a skewer):
  // " with the knight on e2 behind it", or ''
  const behind = (g, m, at) => {
    if (!'brq'.includes(m.piece)) return '';
    const file = (sq) => sq.charCodeAt(0) - 97, rank = (sq) => +sq[1];
    const df = Math.sign(file(at) - file(m.to)), dr = Math.sign(rank(at) - rank(m.to));
    for (let f = file(at) + df, r = rank(at) + dr; f >= 0 && f < 8 && r >= 1 && r <= 8; f += df, r += dr) {
      const sq = String.fromCharCode(97 + f) + r, p = g.get(sq);
      if (!p) continue;
      return p.color !== m.color && p.type !== 'p' ? ` with the ${PIECES[p.type]} on ${sq} behind it` : '';
    }
    return '';
  };
  function moveThreat(Chess, fen, uci) {
    if (!uci) return null;
    try {
      const g = new Chess(fen), m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
      if (!m) return null;
      // the same side to move again, so chess.js lists what the moved piece can take from where it landed
      const f = g.fen().split(' ');
      f[1] = f[1] === 'w' ? 'b' : 'w'; f[3] = '-';
      let attacks = [];
      try { attacks = new Chess(f.join(' ')).moves({ square: m.to, verbose: true }).filter((x) => x.captured && !'pk'.includes(x.captured)).map((x) => `${PIECES[x.captured]} on ${x.to}${behind(g, m, x.to)}`); } catch {}
      return { san: m.san, captured: m.captured ? PIECES[m.captured] : null, check: /[+#]/.test(m.san), attacks: [...new Set(attacks)] };
    } catch { return null; }
  }

  /**
   * What the engine's line wins, in code: the line pv (uci moves) played from fen, and the material each side has
   * gained when it settles, as { line: SAN with move numbers, side, gain: { piece: n }, pawns, text }. side is the side to
   * move at fen (the one whose reply the line starts with). The coach called 16.Qd3 "losing the queen" where the
   * engine's line wins a pawn and the attack (Oct 25). Stops after `plies`, or earlier at a check-free quiet position.
   */
  const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  function lineGain(Chess, fen, pv, { plies = 6 } = {}) {
    if (!Array.isArray(pv) || !pv.length) return null;
    let g;
    try { g = new Chess(fen); } catch { return null; }
    const side = g.turn(), won = { [side]: {}, [side === 'w' ? 'b' : 'w']: {} }, san = [];
    for (const uci of pv.slice(0, plies)) {
      let m;
      try { m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' }); } catch { break; }
      if (!m) break;
      // White's moves carry their number (chess.js has moved it on by Black's)
      san.push(m.color === 'w' ? `${g.moveNumber()}. ${m.san}` : m.san);
      if (m.captured) won[m.color][m.captured] = (won[m.color][m.captured] || 0) + 1;
    }
    const worth = (c) => Object.entries(won[c]).reduce((x, [p, k]) => x + VALUE[p] * k, 0);
    const other = side === 'w' ? 'b' : 'w', pawns = worth(side) - worth(other);
    const net = {};
    for (const p of Object.keys(VALUE)) { const d = (won[side][p] || 0) - (won[other][p] || 0); if (d) net[p] = d; }
    const name = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' }, who = side === 'w' ? 'White' : 'Black';
    const gained = Object.entries(net).filter(([, d]) => d > 0).map(([p, d]) => `${d > 1 ? `${d} ` : 'a '}${name[p]}${d > 1 ? 's' : ''}`);
    const lost = Object.entries(net).filter(([, d]) => d < 0).map(([p, d]) => `${-d > 1 ? `${-d} ` : 'a '}${name[p]}${-d > 1 ? 's' : ''}`);
    const text = pawns > 0 ? `${who} comes out ${pawns} pawn${pawns === 1 ? '' : 's'} of material up${gained.length ? ` (${gained.join(' and ')}${lost.length ? ` for ${lost.join(' and ')}` : ''})` : ''}` : pawns < 0 ? `${who} comes out ${-pawns} pawn${pawns === -1 ? '' : 's'} of material down` : 'no material changes hands: what it gains is position';
    return { line: san.join(' '), side, net, pawns, text };
  }

  const api = { FILES, MATE, STANDARD, moveThreat, lineGain, boardSquares, squareLook, darkSplit, readBoard, boardOf, matchMove, findBoard, readMoves, asCp, cpLoss, grade, uciEngine, createEngine, createNodeEngine, loadChess, scoreGame, CHESS_URL, ENGINE_URL };
  root.ThirdeyeChess = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
