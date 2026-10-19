/* The report's key moments, marked up like a telestrator: a full frame at each moment, where on it the problem was, and
 * where the fix is. A moment the coach measured is marked from the measurement in code: the crosshair, the enemy head
 * it was measured against, and an arrow from one to the other. Any other moment is marked by one model call over all
 * of them, on the frames themselves. Marks are normalized to the frame: a box is [y0, x0, y1, x1] and a point [x, y],
 * each 0 to 1. */
(function (root) {
  const G = root.Gemini, C = root.ThirdeyeCore, V = root.ThirdeyeVideo;
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

  /**
   * A full frame at each moment, with marks from measurements where there are any. Resolves with
   * { keys: [{ t, shot: { t, url }, aspect, measured?, problem?, fix?, note? }], shots } (shots keep the image data).
   */
  async function prepare({ video, profile, moments, measures = [] }) {
    const frame = { w: video.width, h: video.height };
    const shots = moments.length ? await V.grab(video, moments.map((e) => e.t), { maxDim: 1280, quality: 0.82 }) : [];
    const keys = moments.map((e) => {
      const s = shots.find((x) => Math.abs(x.t - e.t) < 1e-3);
      const m = profile?.regions?.aim && measures.find((x) => Math.abs(x.t - e.t) < 0.35 && Array.isArray(x.box));
      return { t: e.t, shot: s ? { t: s.t, url: s.url } : null, aspect: frame.w / frame.h, ...(m ? aimMarks(m, profile, frame) : {}) };
    });
    return { keys, shots };
  }

  const BOX = { type: 'array', items: { type: 'number' }, description: '[ymin, xmin, ymax, xmax] scaled 0-1000' };
  const MARKS = { type: 'object', properties: { images: { type: 'array', items: { type: 'object', properties: {
    image: { type: 'integer' },
    problem_box: BOX, problem: { type: 'string', description: 'what is wrong right there, 2 to 6 words' },
    fix_box: BOX, fix: { type: 'string', description: 'what to do right there, 2 to 5 words' },
  }, required: ['image', 'problem_box', 'problem'] } } }, required: ['images'] };

  // a box worth drawing: inside the frame, not empty, and not most of the screen
  function box(b) {
    if (!Array.isArray(b) || b.length !== 4 || !b.every((v) => Number.isFinite(+v))) return null;
    const [y0, x0, y1, x1] = b.map((v) => Math.min(1000, Math.max(0, +v)) / 1000);
    return y1 - y0 > 0.005 && x1 - x0 > 0.005 && (y1 - y0) * (x1 - x0) < 0.5 ? [y0, x0, y1, x1] : null;
  }
  const label = (s, n) => String(s || '').trim().replace(/\.$/, '').slice(0, n);

  /**
   * Marks the moments no measurement covers, in one model call over their frames. moments carry the coach's what and
   * better for each key. Resolves with the number of model calls made (0 or 1); a failed call leaves those keys unmarked.
   */
  async function mark({ keys, shots, moments, profile, habit, signal, onNotice }) {
    const todo = keys.map((k, i) => i).filter((i) => !keys[i].measured && shots.some((s) => Math.abs(s.t - keys[i].t) < 1e-3));
    if (!todo.length) return 0;
    const parts = todo.flatMap((i, n) => {
      const s = shots.find((x) => Math.abs(x.t - keys[i].t) < 1e-3), e = moments[i];
      return [{ text: `Image ${n + 1}, at ${C.mmss(e.t, true)}. The coach saw: ${e.what}${e.better ? ` Instead: ${e.better}` : ''}` }, { inlineData: { mimeType: s.mimeType, data: s.data } }];
    });
    try {
      const resp = await G.generate({
        contents: [{ role: 'user', parts: [...parts, { text: `These are frames from the player's own screen in a ${profile?.name || 'game'} match. A coach found this in them${habit ? `: ${habit}` : ''}. Mark each frame up for the player like a sports telestrator. problem_box is a tight box around the one spot in the frame that shows what the coach saw (the crosshair and what it's on, the player's position, the piece left hanging), and problem says what is wrong there in 2 to 6 plain words, like "crosshair on their arm" or "standing in the open". If the fix has a place in the frame (where the crosshair or the player should have been), fix_box boxes it and fix says what to do there in 2 to 5 words. Leave out fix_box when the fix has no place on screen. Box only what you can see.` }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: MARKS, mediaResolution: 'MEDIA_RESOLUTION_HIGH' },
      }, { signal, onNotice });
      const out = G.parseJSON(G.textOf(resp)).images || [];
      todo.forEach((i, n) => {
        const r = out.find((x) => x.image === n + 1), p = box(r?.problem_box), f = box(r?.fix_box);
        if (p && label(r.problem, 48)) keys[i].problem = { box: p, label: label(r.problem, 48) };
        if (f && label(r.fix, 40)) keys[i].fix = { box: f, label: label(r.fix, 40) };
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      console.warn("The key moments couldn't be marked.", e);
    }
    return 1;
  }

  root.ThirdeyeReport = { prepare, mark, aimMarks };
})(window);
