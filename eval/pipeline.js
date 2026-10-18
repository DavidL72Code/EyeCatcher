/* The fixed pipeline the agent is scored against. Same pieces, no decisions: scan the whole match, measure the aim
 * before every death the scan found, and report crosshair_low when the median of 3 or more measurements sits
 * 0.75 heads or more below the head. Anything else, it reports no habit. It gets the agent's look budget and stops measuring when that runs out.
 * The kill-feed line shows up with the death screen, so the aim is measured at least 1 s before it, in the latest of a
 * few candidate frames that still shows the player's own live view. A frame after death (a death recap with the killer
 * highlighted, a kill cam, a teammate's view) or with the scoreboard over the middle has no crosshair to measure.
 * Loaded into the app page by eval/run.mjs as window.ThirdeyePipeline. */
(function (root) {
  const G = root.Gemini, C = root.ThirdeyeCore, V = root.ThirdeyeVideo, A = root.ThirdeyeAgent;
  const BEFORE_FEED = [1, 1.5, 2, 2.5]; // seconds before the kill-feed line: the candidate frames, latest first
  const LOW = 0.75; // head-heights: where core.js's head band ends
  const LIVE = { type: 'object', properties: { frames: { type: 'array', items: { type: 'object', properties: { frame: { type: 'integer' }, live: { type: 'boolean' } }, required: ['frame', 'live'] } } }, required: ['frames'] };

  // One call per death: which candidate frames show the player's own live, unobstructed view.
  async function liveFrames(shots, profile, { signal, onNotice }) {
    const parts = shots.flatMap((s, i) => [{ text: `Frame ${i + 1}` }, { inlineData: { mimeType: s.mimeType, data: s.data } }]);
    const resp = await G.generate({
      contents: [{ role: 'user', parts: [...parts, { text: `These are full ${profile.name} screens from one player's own recording, a moment apart. For each frame, live is true only when it shows the player's own live first-person view: their weapon in hand, their crosshair at the center, and nothing covering the middle of the screen. live is false on a death screen or death recap (a killed-by banner, a combat report, the killer highlighted), a kill cam, a teammate's view while spectating, or a scoreboard or menu over the middle.` }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: LIVE },
    }, { signal, onNotice });
    const out = G.parseJSON(G.textOf(resp)).frames || [];
    return shots.map((_, i) => out.find((f) => f.frame === i + 1)?.live === true);
  }

  async function run({ video, file, profile, looks = 30, signal, onNotice, onStep = () => {} }) {
    const frame = { w: video.width, h: video.height }, crop = C.regionRect(profile, 'aim', frame);
    onStep({ name: 'scan', args: { from: '0:00', to: C.mmss(video.duration) } });
    // the same record of fights the agent's scan builds, so both start from the same place
    const { events } = await A.fightLog({ video, file, profile, from: 0, to: video.duration, signal, onNotice });
    const deaths = events.filter((e) => e.kind === 'death');
    const measures = [];
    let used = 0;
    for (const d of deaths) {
      if (used + 2 > looks) break; // a look at the candidates, then a measurement
      const times = BEFORE_FEED.map((b) => d.t - b).filter((t) => t >= 0);
      if (!times.length) continue;
      used++;
      onStep({ name: 'frames', args: { at: times.map((t) => C.mmss(t, true)).join(', ') } });
      const shots = await V.grab(video, times, { maxDim: 768 });
      const live = await liveFrames(shots, profile, { signal, onNotice });
      const checked = shots.map((s, i) => ({ t: s.t, live: live[i] }));
      const pick = checked.filter((c) => c.live).sort((a, b) => b.t - a.t)[0];
      if (!pick) { measures.push({ t: null, feedT: d.t, checked, skipped: 'no live frame among the candidates' }); continue; }
      used++;
      onStep({ name: 'measure_aim', args: { at: C.mmss(pick.t, true) } });
      const [shot] = await V.grab(video, [pick.t], { crop, maxDim: 1024, quality: 0.9 });
      const box = await A.findHead(shot, { signal, onNotice });
      measures.push(box ? { t: pick.t, feedT: d.t, checked, ...C.aimOffset({ box, crop, frame, fovH: profile.fovH, crosshair: profile.crosshair }), box } : { t: pick.t, feedT: d.t, checked, found: false });
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
      stats: { looks: used, deaths: deaths.length, measured: measures.filter((m) => Number.isFinite(m.heads)).length, skipped: measures.filter((m) => m.skipped).length },
    };
  }

  root.ThirdeyePipeline = { run, BEFORE_FEED, LOW };
})(window);
