/* The report's key moments, marked up like a telestrator: a full frame at each moment, and on it only what code can
 * stand behind. A moment the coach measured shows the crosshair and the enemy head it was measured against. A moment at
 * one of the kill feed's lines shows that line, found again on that frame by its pixels. A chess move shows the move
 * played and the engine's move, on the board's own squares. A moment with none of these shows the frame unmarked: a
 * model drawing boxes on what it thinks it sees put loops on doors and on the player's own gun (Oct 19 audit). Marks are
 * normalized to the frame: a box is [y0, x0, y1, x1] and a point [x, y], each 0 to 1. */
(function (root) {
  const C = root.ThirdeyeCore, V = root.ThirdeyeVideo;
  const PLACE = { above: 'above the head', head: 'on the head', chest: 'on the upper body', low: 'on the lower body' };

  // a measured moment: where the crosshair sat, against the head it was measured on
  function aimMarks(m, profile, frame) {
    const crop = C.regionRect(profile, 'aim', frame), [cx, cy] = profile.crosshair || [0.5, 0.5];
    const [y0, x0, y1, x1] = m.box;
    const head = [(crop.y + (y0 / 1000) * crop.h) / frame.h, (crop.x + (x0 / 1000) * crop.w) / frame.w, (crop.y + (y1 / 1000) * crop.h) / frame.h, (crop.x + (x1 / 1000) * crop.w) / frame.w];
    // more than a head and a half to one side reads as off to that side, not just high or low
    const across = (((head[1] + head[3]) / 2 - cx) * frame.w) / Math.max(1, m.headPx);
    const side = Math.abs(across) > 1.5 ? (across > 0 ? ', left of them' : ', right of them') : '';
    const on = m.band === 'head';
    return {
      measured: true,
      problem: on ? null : { point: [cx, cy], label: `Crosshair ${PLACE[m.band] || 'off the head'}${side}` },
      fix: { box: head, label: on ? 'On the head' : 'Aim here' },
      note: on ? 'On the head' : `Measured ${Math.abs(m.heads).toFixed(1)} heads ${m.heads >= 0 ? 'below' : 'above'} the head`,
    };
  }

  // a square's center on the board, as fractions of the frame
  function squareAt(sq, b) {
    const file = sq.charCodeAt(0) - 97, rank = +sq[1] - 1, col = b.flipped ? 7 - file : file, row = b.flipped ? rank : 7 - rank;
    return [b.x + ((col + 0.5) / 8) * b.w, b.y + ((row + 0.5) / 8) * b.h];
  }
  // a graded chess move: the move played, in red, and the engine's, in the pen color
  function moveMarks(e) {
    const q = e.squares, moves = [{ tone: 'bad', from: squareAt(q.from, e.board), to: squareAt(q.to, e.board), label: `${e.san} (${e.grade})` }];
    if (q.best) moves.push({ tone: 'good', from: squareAt(q.best[0], e.board), to: squareAt(q.best[1], e.board), label: q.bestSan ? `${q.bestSan} was best` : 'the engine\'s move' });
    return { moves, note: `${e.san} gave away ${(e.loss / 100).toFixed(1)} pawns${q.bestSan ? `; the engine played ${q.bestSan}` : ''}` };
  }

  const LINE_WINDOW = 4; // s: a kill-feed line stays up at least this long after it shows
  const say = (e) => (e.kind === 'kill' ? `You ${e.knock ? 'knocked' : 'took out'} ${e.victim}` : e.kind === 'death' ? `${e.killer} ${e.knock ? 'knocked you' : 'took you out'}` : e.kind === 'ally_death' ? `${e.killer} ${e.knock ? 'knocked' : 'took out'} ${e.victim}, your teammate` : `${e.killer} ▸ ${e.victim}`);
  /**
   * Kill-feed lines found again on the key frames: for each moment, the player's kill, death, or teammate down whose line
   * is up then (it showed from 1 s before the moment to LINE_WINDOW s before it), matched by the fingerprint its
   * first sighting left (C.rowDistance on its right end). No match, no mark.
   */
  async function feedMarks({ video, profile, moments, events }) {
    const frame = { w: video.width, h: video.height }, plain = !(profile.killfeedColors && profile.killfeedGrid);
    const crop = plain ? root.ThirdeyeAgent?.textFeedRect?.(profile, frame) : C.regionRect(profile, 'killfeed', frame);
    if (!crop) return [];
    const wanted = moments.map((m) => (events || []).filter((e) => e.fp && ['death', 'ally_death', 'kill'].includes(e.kind) && m.t >= e.t - 1 && m.t <= e.t + LINE_WINDOW).sort((a, b) => ['death', 'ally_death', 'kill'].indexOf(a.kind) - ['death', 'ally_death', 'kill'].indexOf(b.kind))[0] || null);
    const out = moments.map(() => null), times = moments.map((m) => m.t).filter((_, i) => wanted[i]);
    if (!times.length) return out;
    await V.each(video, times, { crop, maxDim: 2000 }, ({ t, canvas, w, h }) => {
      const img = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
      const rows = plain ? C.textRows(img) : C.killfeedRows(img, { colors: profile.killfeedColors, grid: profile.killfeedGrid });
      moments.forEach((m, i) => {
        const e = wanted[i];
        if (!e || Math.abs(m.t - t) > 1e-3) return;
        const r = rows.map((x) => ({ x, d: C.rowDistance(x.fp, e.fp) })).filter((x) => x.d < C.SAME_ROW).sort((a, b) => a.d - b.d)[0]?.x;
        if (!r) return;
        const sx = crop.w / w, sy = crop.h / h;
        out[i] = { fact: { box: [(crop.y + r.y0 * sy) / frame.h, (crop.x + r.x0 * sx) / frame.w, (crop.y + (r.y1 + 1) * sy) / frame.h, (crop.x + (r.x1 + 1) * sx) / frame.w], label: say(e) }, note: `The kill feed: ${say(e)}` };
      });
    });
    return out;
  }

  /**
   * The HUD number code read at a moment, when that number is the point: the health readout at a near-death (or 0 at a
   * death the HP number shows) and the scoreboard at a point either side scored, each within a second of the moment so
   * the frame shows it. The box is the readout's own, grown to hold its number (C.readoutRegion). No reading, no mark.
   */
  const NUMBER_NEAR = 1.2; // s between the reading and the moment's frame
  function hudMarks({ profile, moments, events }) {
    const box = (name) => { const r = profile?.regions?.[name]; if (!r) return null; const [x, y, w, h] = C.readoutRegion(r); return [y, x, y + h, x + w]; };
    return moments.map((m) => {
      const near = (kinds) => (events || []).filter((e) => kinds.includes(e.kind) && Math.abs(e.t - m.t) <= NUMBER_NEAR).sort((a, b) => Math.abs(a.t - m.t) - Math.abs(b.t - m.t))[0];
      const low = near(['near_death']);
      if (low && box('health')) return { fact: { box: box('health'), label: `Health ${low.hp} of ${low.of}` }, note: `The HUD's health read ${low.hp} of ${low.of}` };
      const died = near(['death']);
      // only a death the HP number itself read as 0 (a K/D/A death can show another number: League's read 1)
      if (died && /health read 0/.test(died.text || '') && box('health')) return { fact: { box: box('health'), label: 'Health 0' }, note: "The HUD's health read 0" };
      const point = near(['point_won', 'point_lost']);
      if (point && box('scoreboard')) return { fact: { box: box('scoreboard'), label: point.kind === 'point_won' ? 'Your side scores' : 'The other side scores' }, note: point.text || '' };
      return null;
    });
  }

  /**
   * A full frame at each moment, with the marks code can stand behind. Resolves with
   * { keys: [{ t, shot: { t, url }, aspect, measured?, problem?, fix?, fact?, moves?, note? }], shots } (shots keep the
   * image data).
   */
  async function prepare({ video, profile, moments, measures = [], events = [] }) {
    const frame = { w: video.width, h: video.height };
    const shots = moments.length ? await V.grab(video, moments.map((e) => e.t), { maxDim: 1280, quality: 0.82 }) : [];
    const lines = await feedMarks({ video, profile, moments, events }).catch(() => moments.map(() => null));
    const numbers = hudMarks({ profile, moments, events });
    const keys = moments.map((e, i) => {
      const s = shots.find((x) => Math.abs(x.t - e.t) < 1e-3);
      const m = profile?.regions?.aim && measures.find((x) => Math.abs(x.t - e.t) < 0.35 && Array.isArray(x.box));
      const move = (events || []).filter((x) => x.kind === 'move' && x.squares && x.board && Math.abs(x.t - e.t) <= 2).sort((a, b) => Math.abs(a.t - e.t) - Math.abs(b.t - e.t))[0];
      const marks = m ? aimMarks(m, profile, frame) : move ? moveMarks(move) : lines[i] || numbers[i] || {};
      return { t: e.t, shot: s ? { t: s.t, url: s.url } : null, aspect: frame.w / frame.h, ...marks };
    });
    return { keys, shots };
  }

  root.ThirdeyeReport = { prepare, aimMarks, moveMarks, squareAt, hudMarks };
})(window);
