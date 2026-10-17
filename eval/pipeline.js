/* The fixed pipeline the agent is scored against. Same pieces, no decisions: scan the whole match, measure the aim
 * just before every death the scan found, and report crosshair_low when the median of 3 or more measurements sits
 * 0.75 heads or more below the head. Anything else, it reports no habit. It gets the agent's look budget and stops measuring when that runs out.
 * Loaded into the app page by eval/run.mjs as window.ThirdeyePipeline. */
(function (root) {
  const C = root.ThirdeyeCore, V = root.ThirdeyeVideo, A = root.ThirdeyeAgent;
  const BEFORE_FEED = 0.6; // seconds: the kill-feed line comes after the moment that shows placement
  const LOW = 0.75; // head-heights: where core.js's head band ends

  async function run({ video, file, profile, looks = 30, signal, onNotice, onStep = () => {} }) {
    const frame = { w: video.width, h: video.height }, crop = C.regionRect(profile, 'aim', frame);
    onStep({ name: 'scan', args: { from: '0:00', to: C.mmss(video.duration) } });
    // the same record of fights the agent's scan builds, so both start from the same place
    const { events } = await A.fightLog({ video, file, profile, from: 0, to: video.duration, signal, onNotice });
    const deaths = events.filter((e) => e.kind === 'death');
    const measures = [];
    let used = 0;
    for (const d of deaths) {
      if (used >= looks) break;
      const t = C.clamp(d.t - BEFORE_FEED, 0, video.duration);
      used++;
      onStep({ name: 'measure_aim', args: { at: C.mmss(t, true) } });
      const [shot] = await V.grab(video, [t], { crop, maxDim: 1024, quality: 0.9 });
      const box = await A.findHead(shot, { signal, onNotice });
      measures.push(box ? { t, ...C.aimOffset({ box, crop, frame, fovH: profile.fovH, crosshair: profile.crosshair }) } : { t, found: false });
    }
    const aim = C.summarizeAim(measures);
    const found = !!aim && aim.n >= 3 && aim.heads >= LOW; // like the agent's progress check, one or two duels decide nothing
    return {
      found,
      habitId: found ? 'crosshair_low' : null,
      evidence: found ? measures.filter((m) => m.heads >= LOW).map((m) => ({ t: m.t, what: `crosshair ${m.heads} heads below` })) : [],
      aim,
      measures,
      events,
      stats: { looks: used, deaths: deaths.length, unmeasured: deaths.length - used },
    };
  }

  root.ThirdeyePipeline = { run, BEFORE_FEED, LOW };
})(window);
