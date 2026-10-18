/* Thirdeye learns each game from the recording, so no one writes a profile. One Gemini call on frames spread over the
 * match names the game and genre, boxes what's on screen, and lists cues and habits; toProfile turns that into the
 * profile the rest reads. Pixel facts are measured, not asked: the kill feed's rows, team colors, and which way new
 * rows join come from the video (learnLayout). Loaded in the browser as window.ThirdeyeLearn and in Node tests
 * through require(), where only the pure functions run. */
(function (root) {
  const G = root.Gemini, C = root.ThirdeyeCore, V = root.ThirdeyeVideo;
  const SAMPLES = 8; // frames the learn call sees
  const LAYOUT_SAMPLES = 120; // frames the kill-feed layout is measured from: a feed is empty most of the time
  const GENRES = ['shooter', 'moba', 'chess', 'fighting', 'racing', 'sports', 'strategy', 'other'];
  const ELEMENTS = ['kill_feed', 'minimap', 'ammo', 'health', 'scoreboard', 'damage', 'board', 'player_clock', 'opponent_clock', 'gold', 'abilities'];
  const AIM_TARGETS = ['head', 'body', 'tracking', 'none'];
  const RESEARCH_STORE = 'thirdeye.research', RESEARCH_DAYS = 30;
  // what code can check a habit with, and what the learn call is told about each
  const CHECKS = {
    aim: 'code measures crosshair height against enemy heads (first-person shooters)',
    shots: 'code reads the ammo counter to tell whether the player fired',
    engine: "code reads every move off the board and a chess engine scores it: each of the player's moves gets its centipawn loss (chess)",
  };
  // The center of a first-person view, where the aim is measured: geometry, the same in any such game.
  const AIM = [0.3, 0.22, 0.4, 0.56];
  const MAX_ROWS_PER_MINUTE = 25; // new kill-feed rows a minute at a match's busiest: more means the layout is wrong
  const DEAD_FOR_ROUNDS = 30; // s: without a detected round start, a death in a round mode is over after this

  const str = (description) => ({ type: 'string', description });
  const BOX = { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 };
  function schema() {
    return {
      type: 'object',
      properties: {
        game: str('the game, or a short description if unknown'),
        genre: { type: 'string', enum: GENRES },
        first_person: { type: 'boolean' },
        crosshair_center: { type: 'boolean' },
        fov_h: { type: 'number', description: "the game's default horizontal field of view in degrees, 0 if unknown" },
        team_game: { type: 'boolean' },
        rounds: { type: 'boolean', description: 'play resets in rounds' },
        respawn_seconds: { type: 'number', description: 'seconds until a dead player plays again mid-round, 0 if they wait for the next round' },
        elements: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', enum: ELEMENTS }, frame: { type: 'integer' }, box: BOX }, required: ['name', 'frame', 'box'] } },
        ally_color: str("one word: the kill feed's color for the player's team, if it colors teams"),
        enemy_color: str("one word: the kill feed's color for the other team"),
        ally_rgb: { type: 'array', items: { type: 'integer' }, description: "the RGB of the kill feed's bar or text color for the player's team, 0-255" },
        enemy_rgb: { type: 'array', items: { type: 'integer' }, description: "the same for the other team" },
        own_rows: str("how the kill feed marks the player's own kills and deaths, if it does"),
        cues: { type: 'array', items: { type: 'string' } },
        key_moments: str('one sentence: the moments where the player wins or loses something'),
      },
      required: ['game', 'genre', 'first_person', 'crosshair_center', 'team_game', 'rounds', 'elements', 'cues', 'key_moments'],
    };
  }

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const median = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

  /**
   * The elements' screen regions, [x, y, w, h] as fractions of the frame. Boxes come as [ymin, xmin, ymax, xmax] in
   * 0-1000; one element boxed in several frames takes the median of each edge, and every region is padded by `pad` of
   * its size and kept on screen. Boxes with no area are dropped.
   */
  function mergeBoxes(elements, pad = 0.15) {
    const by = new Map();
    for (const e of Array.isArray(elements) ? elements : []) {
      const b = e?.box;
      if (!ELEMENTS.includes(e?.name) || !Array.isArray(b) || b.length !== 4 || b.some((v) => !Number.isFinite(+v))) continue;
      const [y0, x0, y1, x1] = b.map((v) => clamp(+v, 0, 1000) / 1000);
      if (y1 - y0 < 0.005 || x1 - x0 < 0.005) continue;
      (by.get(e.name) || by.set(e.name, []).get(e.name)).push([x0, y0, x1, y1]);
    }
    const regions = {};
    for (const [name, list] of by) {
      const [x0, y0, x1, y1] = [0, 1, 2, 3].map((k) => median(list.map((b) => b[k])));
      const px = (x1 - x0) * pad, py = (y1 - y0) * pad;
      const r = [clamp(x0 - px, 0, 1), clamp(y0 - py, 0, 1)];
      regions[name === 'kill_feed' ? 'killfeed' : name] = [r[0], r[1], clamp(x1 + px, 0, 1) - r[0], clamp(y1 + py, 0, 1) - r[1]].map((v) => Math.round(v * 1000) / 1000);
    }
    return regions;
  }

  /**
   * The profile from the learn call's answer and the research on what matters in the game: the same shape every tool
   * reads. Habits are the research's costly mistakes; each keeps a check only when code can really make it here (aim
   * needs a first-person crosshair and a game where aim has a height target, shots an ammo counter, the engine a board).
   */
  function toProfile(raw, checks = Object.keys(CHECKS), research = null) {
    const regions = mergeBoxes(raw?.elements);
    const firstPerson = !!raw?.first_person, center = raw?.crosshair_center !== false;
    if (firstPerson && center) regions.aim = AIM;
    const aimTarget = AIM_TARGETS.includes(research?.aimTarget) ? research.aimTarget : 'none';
    const habits = [];
    for (const h of Array.isArray(research?.mistakes) ? research.mistakes : Array.isArray(raw?.habits) ? raw.habits : []) {
      const id = slug(h?.id || h?.name);
      if (!id || habits.some((x) => x.id === id) || !String(h?.name || '').trim()) continue;
      const by = checks.includes(h.checked_by) ? h.checked_by : null;
      const aimable = regions.aim && (aimTarget === 'head' || aimTarget === 'body');
      habits.push({ id, name: String(h.name).trim().slice(0, 60), signs: String(h.signs || '').trim().slice(0, 300), drill: String(h.drill || '').trim().slice(0, 300), ...(h.cost ? { cost: String(h.cost).trim().slice(0, 200) } : {}), ...(by === 'aim' && aimable ? { measuredBy: 'aim' } : {}), ...(by === 'engine' && regions.board ? { measuredBy: 'engine' } : {}), ...(by === 'shots' && regions.ammo ? { needsShots: true } : {}) });
    }
    const respawn = +raw?.respawn_seconds;
    return {
      learned: true,
      name: String(raw?.game || 'this game').trim().slice(0, 60),
      genre: GENRES.includes(raw?.genre) ? raw.genre : 'other',
      firstPerson,
      teamGame: !!raw?.team_game,
      rounds: !!raw?.rounds,
      fovH: +raw?.fov_h > 30 && +raw?.fov_h < 180 ? +raw.fov_h : null,
      crosshair: [0.5, 0.5],
      regions,
      colorNames: { ally: String(raw?.ally_color || '').trim().toLowerCase(), enemy: String(raw?.enemy_color || '').trim().toLowerCase() },
      colorHues: { ally: rgbHue(raw?.ally_rgb), enemy: rgbHue(raw?.enemy_rgb) },
      killfeedMine: String(raw?.own_rows || '').trim().slice(0, 200) || null,
      deadFor: { rounds: DEAD_FOR_ROUNDS, respawn: respawn > 0 && respawn < 30 ? respawn : 5 },
      cues: (Array.isArray(raw?.cues) ? raw.cues : []).map((c) => String(c).trim()).filter(Boolean).slice(0, 8),
      keyMoments: String(raw?.key_moments || '').trim().slice(0, 300),
      aimTarget,
      research: research ? { rewards: research.rewards, priorities: research.priorities, engagements: research.engagements, sources: research.sources, researched: research.researched } : null,
      habits,
    };
  }

  // ---------- what matters in the game, from the web ----------
  const RESEARCH_SCHEMA = {
    type: 'object',
    properties: {
      rewards: str('what the game scores or rewards a player for, one sentence'),
      priorities: { type: 'array', items: { type: 'string' } },
      engagements: str('when a fight is worth taking and what makes one good or bad, one or two sentences; empty if the game has no fights'),
      aim_target: { type: 'string', enum: AIM_TARGETS },
      mistakes: { type: 'array', items: { type: 'object', properties: { name: str('a few words'), signs: str("how it shows on the player's screen"), cost: str('why it costs, one sentence'), drill: str('one specific way to practice fixing it'), checked_by: { type: 'string' } }, required: ['name', 'signs', 'cost', 'drill', 'checked_by'] } },
    },
    required: ['rewards', 'priorities', 'engagements', 'aim_target', 'mistakes'],
  };
  const textList = (xs, n, len) => (Array.isArray(xs) ? xs : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, n).map((x) => x.slice(0, len));
  /** The research answer cleaned to its shape, or null when it says nothing usable. */
  function cleanResearch(r, checks, { sources = [], researched = false } = {}) {
    if (!r || typeof r !== 'object') return null;
    const mistakes = (Array.isArray(r.mistakes) ? r.mistakes : []).filter((m) => String(m?.name || '').trim()).slice(0, 7)
      .map((m) => ({ name: String(m.name).trim().slice(0, 60), signs: String(m.signs || '').trim().slice(0, 300), cost: String(m.cost || '').trim().slice(0, 200), drill: String(m.drill || '').trim().slice(0, 300), checked_by: checks.includes(m.checked_by) ? m.checked_by : 'none' }));
    if (!mistakes.length && !textList(r.priorities, 6, 80).length) return null;
    return {
      rewards: (Array.isArray(r.rewards) ? r.rewards.join('; ') : String(r.rewards || '')).trim().slice(0, 240), priorities: textList(r.priorities, 6, 80), engagements: String(r.engagements || '').trim().slice(0, 300),
      aimTarget: AIM_TARGETS.includes(r.aim_target) ? r.aim_target : 'none', mistakes,
      sources: (sources || []).filter((x) => x?.uri).slice(0, 8).map((x) => ({ title: String(x.title || x.uri).slice(0, 80), uri: x.uri })), researched,
    };
  }
  const gameKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const readCache = () => { try { return JSON.parse(root.localStorage?.getItem(RESEARCH_STORE) || '{}') || {}; } catch { return {}; } };
  /**
   * What matters in a game, found on the web: what it rewards, what top players prioritize, when fights are worth it,
   * where good players aim, and its costly mistakes, each with what code can check it with. One Google-grounded call
   * (Gemini's search models), kept for RESEARCH_DAYS per game, so a game costs it once. When search isn't available,
   * the same question goes to the model without the web, and the answer says so (researched false, no sources).
   */
  async function researchGame({ name, genre, checks = Object.keys(CHECKS), signal, onNotice }) {
    const Gm = root.Gemini, key = gameKey(name), cache = readCache();
    if (cache[key] && cache[key].expires > Date.now()) return cache[key].research;
    const ask = `What decides how well a player does in ${name} (${genre})? Use what coaches, top players, and the community (guides, Reddit, the game's own pages) say, not general gaming advice. rewards: what wins a match or earns rank in it (rounds, placement, kills, rating...), one sentence; not cosmetics or progression unlocks. priorities: the 3 to 6 things that matter most, a few words each. engagements: when a fight is worth taking and what makes one good or bad; empty if the game has no fights. aim_target: where good players aim in fights in this game: head, body, tracking (staying on target matters more than where), or none. mistakes: 5 to 7 costly habits, each with how it shows on the player's own screen, why it costs, a drill, and checked_by, what can check it in code: ${checks.map((c) => `${c} (${CHECKS[c]})`).join('; ')}; or none.`;
    let research = null, searchError = '';
    try {
      const r = await Gm.grounded(`${ask}\nAnswer only with JSON with the keys rewards, priorities, engagements, aim_target, mistakes (each mistake: name, signs, cost, drill, checked_by).`, { signal, onNotice });
      research = cleanResearch(Gm.parseJSON(r.text), checks, { sources: r.sources, researched: true });
      if (!research) searchError = 'the search answer had nothing usable';
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      searchError = String(e?.message || e).slice(0, 160);
    }
    if (!research) {
      const resp = await Gm.generate({ contents: [{ role: 'user', parts: [{ text: ask }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: RESEARCH_SCHEMA } }, { signal, onNotice });
      research = cleanResearch(Gm.parseJSON(Gm.textOf(resp)), checks, { researched: false });
      if (research) research.searchError = searchError;
    }
    if (research) { cache[key] = { research, expires: Date.now() + RESEARCH_DAYS * 864e5 }; try { root.localStorage?.setItem(RESEARCH_STORE, JSON.stringify(cache)); } catch {} }
    return research;
  }

  // ---------- pixel layout ----------
  // Color words to hues in degrees, for matching the learn call's "teal" or "red" to the hue clusters code finds.
  const HUES = { red: 0, crimson: 350, pink: 330, magenta: 300, purple: 275, violet: 270, blue: 215, cyan: 185, teal: 170, turquoise: 170, aqua: 180, green: 120, lime: 90, yellow: 55, gold: 48, orange: 28 };
  /** The hue in degrees of an [r, g, b] color, or null when it's missing or gray. */
  function rgbHue(rgb) {
    if (!Array.isArray(rgb) || rgb.length < 3 || rgb.some((v) => !Number.isFinite(+v))) return null;
    const [r, g, b] = rgb.map((v) => clamp(+v, 0, 255)), mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (!mx || (mx - mn) / mx < 0.2) return null;
    return Math.round(((mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn)) * 60 + 360) % 360);
  }
  const nameHue = (word) => { const w = String(word || '').toLowerCase(); const k = Object.keys(HUES).find((n) => w.includes(n)); return k ? HUES[k] : null; };
  const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

  /** A 36-bin histogram (10° bins) of the clearly colored pixels in an ImageData-like crop. */
  function hueHistogram({ data: d, width: w, height: h }) {
    const bins = new Array(36).fill(0);
    for (let i = 0; i < w * h; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 110 || (mx - mn) / mx < 0.35) continue;
      const hue = ((mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn)) * 60 + 360) % 360;
      bins[Math.floor(hue / 10) % 36]++;
    }
    return bins;
  }

  /**
   * The two team colors of a kill feed, as hue ranges { ally, enemy }, from a hue histogram summed over many frames.
   * The learn call gives each team's color as RGB (hues) and as a word (names); each takes the clearly present 10° bin
   * nearest it (5% of the biggest or more), within 40° of the RGB's hue or 60° of the word's, so a wall or the sky
   * behind the feed can't stand in for a team. ±25° around each. null when either has nothing near it, or both land
   * on one bin (the feed doesn't color teams).
   */
  function teamHues(bins, names = {}, hues = {}) {
    const top = Math.max(...bins);
    if (!top) return null;
    // any clearly present bin counts, not only peaks: a red beside a bigger orange sits on its shoulder
    const present = bins.map((v, i) => ({ hue: i * 10 + 5, v })).filter((p) => p.v >= top * 0.05);
    const near = (hue, word) => {
      const h = hue ?? nameHue(word), within = hue != null ? 40 : 60;
      return h == null ? null : present.filter((p) => hueGap(p.hue, h) <= within).sort((x, y) => hueGap(x.hue, h) - hueGap(y.hue, h) || y.v - x.v)[0] || null;
    };
    const ally = near(hues.ally, names.ally), enemy = near(hues.enemy, names.enemy);
    if (!ally || !enemy || ally === enemy) return null;
    const range = (h) => [(h - 25 + 360) % 360, (h + 25) % 360];
    return { ally: range(ally.hue), enemy: range(enemy.hue) };
  }

  /**
   * Color bands in one crop with their horizontal extent: x0 and x1, the first and last columns 30% one team's color.
   * Some games fade a row's color toward one edge, so a band found by clear color grows up and down, by up to its own
   * height, while the lines within its extent stay half colored, muted shades included; half a row is no row.
   */
  function bandExtents(img, colors) {
    const { data: d, width: w, height: h } = img;
    const team = (x, y) => { const k = (y * w + x) * 4; return C.pixelTeam(d[k], d[k + 1], d[k + 2], colors); };
    return C.colorBands(C.teamLines(img, colors), w).map((b) => {
      const clearCols = [];
      for (let x = 0; x < w; x++) { let n = 0; for (let y = b.y0; y <= b.y1; y++) { const t = team(x, y); if (t === 1 || t === 2) n++; } clearCols.push(n / (b.y1 - b.y0 + 1)); }
      const on = clearCols.map((v, x) => (v >= 0.3 ? x : -1)).filter((x) => x >= 0);
      if (!on.length) return null;
      const x0 = on[0], x1 = on.at(-1), colored = (y) => { let n = 0; for (let x = x0; x <= x1; x++) if (team(x, y)) n++; return n / (x1 - x0 + 1) >= 0.5; };
      const grow = b.y1 - b.y0 + 1;
      let y0 = b.y0, y1 = b.y1;
      while (y0 > 0 && b.y0 - y0 < grow && colored(y0 - 1)) y0--;
      while (y1 < h - 1 && y1 - b.y1 < grow && colored(y1 + 1)) y1++;
      const cols = [];
      for (let x = 0; x < w; x++) { let n = 0; for (let y = y0; y <= y1; y++) { const t = team(x, y); if (t === 1 || t === 2) n++; } cols.push(n / (y1 - y0 + 1)); }
      return { y0, y1, x0, x1, cols };
    }).filter(Boolean);
  }

  /**
   * The kill-feed rows among color bands over many frames. A kill feed's rows share one edge (the right in most games,
   * the left in some) and one height, and a wall or a flash behind the feed doesn't line up with them. The edge and
   * height come from the bands the learn call boxed (inBox); then every band in the search area that lines up counts.
   * Touching rows read as one taller band, so the height is the 25th percentile. Bands that reach the search area's
   * side are background. frames: bandExtents per frame; w: the crop width. Returns { rows (per frame), height, pitch, top, bottom } or null with too few rows.
   */
  function alignedRows(frames, inBox, w) {
    // a wall or the sky runs to the search area's edge; a row ends before it
    frames = frames.map((f) => f.filter((b) => b.x0 > 2 && b.x1 < w - 3));
    const core = frames.flat().filter(inBox);
    if (core.length < 3) return null;
    const hs = core.map((b) => b.y1 - b.y0 + 1).sort((a2, b2) => a2 - b2), height = hs[Math.floor(hs.length * 0.25)];
    const tol = Math.max(4, w * 0.015), bin = (x) => Math.round(x / tol);
    const modeOf = (xs) => { const n = new Map(); for (const x of xs) n.set(bin(x), (n.get(bin(x)) || 0) + 1); return [...n].sort((a2, b2) => b2[1] - a2[1])[0]; };
    const right = modeOf(core.map((b) => b.x1)), left = modeOf(core.map((b) => b.x0));
    const [key, at] = right[1] >= left[1] ? ['x1', right[0] * tol] : ['x0', left[0] * tol];
    // a band one row tall, or two touching rows, ending on the shared edge
    const rows = frames.map((f) => f.filter((b) => Math.abs(b[key] - at) <= tol * 1.5 && b.y1 - b.y0 + 1 >= height * 0.65 && b.y1 - b.y0 + 1 <= height * 2.4));
    // and about as wide as the others: a long band that happens to end on the same edge is the HUD or the scenery
    const wide = median(rows.flat().map((b) => b.x1 - b.x0));
    const fits = (b) => b.x1 - b.x0 >= wide * 0.4 && b.x1 - b.x0 <= wide * 1.8;
    for (const f of rows) f.splice(0, f.length, ...f.filter(fits));
    const single = rows.map((f) => f.filter((b) => b.y1 - b.y0 + 1 <= height * 1.35));
    const flat = rows.flat();
    if (single.flat().length < 4) return null;
    const steps = single.flatMap((f) => f.slice(1).map((b2, i) => b2.y0 - f[i].y0)).filter((x) => x >= height && x <= height * 1.6);
    return { rows: single, height: median(single.flat().map((b2) => b2.y1 - b2.y0 + 1)), pitch: steps.length >= 2 ? median(steps) : null, top: Math.min(...flat.map((b2) => b2.y0)), bottom: Math.max(...flat.map((b2) => b2.y1)) };
  }

  /**
   * How much of a row's right end is a portrait rather than team color, as a share of the crop width: from the row's
   * right edge, the columns before the first run of 10 mostly team-colored columns. cols: per row, the team-color share
   * of each column (0-1), left to right. The median over rows; 0 when rows end in color.
   */
  function portraitShare(cols, width) {
    const shares = cols.map((c) => {
      let x1 = c.length - 1;
      while (x1 >= 0 && c[x1] < 0.3) x1--;
      if (x1 < 0) return null;
      let run = 0;
      for (let x = x1; x >= 0; x--) { run = c[x] >= 0.6 ? run + 1 : 0; if (run >= 10) return (x1 - (x + 9)) / width; }
      return null;
    }).filter((v) => v != null);
    return shares.length ? Math.round(median(shares) * 1000) / 1000 : 0;
  }

  /**
   * Measures the kill feed's layout in the recording: team colors, where its rows sit, their height and pitch, the
   * portrait at each row's end, and which way new rows join. The learn call's box is only a starting point; code
   * searches around it. Returns the profile with killfeed, killfeedColors, and killfeedGrid filled in. When the rows
   * can't be measured there's no killfeedGrid or no killfeedColors, so scans read fights from the low-detail pass;
   * layout.killfeed says which.
   */
  async function learnLayout({ video, profile, signal }) {
    const box = profile.regions.killfeed;
    if (!box) return profile;
    const frame = { w: video.width, h: video.height };
    // the box may hold one row of several, or cut long names: search well around it, and let the rows say where it is
    const mx = Math.max(box[2] * 0.5, 0.08), up = Math.max(box[3], 0.05), down = Math.max(box[3] * 3, 0.2);
    const search = [clamp(box[0] - mx, 0, 1), clamp(box[1] - up, 0, 1)];
    search.push(clamp(box[0] + box[2] + mx, 0, 1) - search[0], clamp(box[1] + box[3] + down, 0, 1) - search[1]);
    const crop = C.regionRect({ regions: { s: search } }, 's', frame);
    const times = Array.from({ length: LAYOUT_SAMPLES }, (_, k) => (video.duration * (k + 0.5)) / LAYOUT_SAMPLES);
    const imgs = [];
    await V.each(video, times, { crop, maxDim: 2000, signal }, ({ t, canvas, w, h }) => { imgs.push({ t, img: canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h) }); });
    if (!imgs.length) return profile;
    const { width: w, height: h } = imgs[0].img;
    // Start from the colors the learn call gave (as RGB, else from the whole search area's hue peaks), find the rows
    // with them, then center each color on the pixels inside those rows: the background behind the feed never votes.
    // ±40°: a reported "green" can be the feed's teal, 30° away
    const start = profile.colorHues?.ally != null && profile.colorHues?.enemy != null ? { ally: around(profile.colorHues.ally, 40), enemy: around(profile.colorHues.enemy, 40) } : null;
    let colors = start;
    if (!colors) {
      const bins = new Array(36).fill(0);
      for (const { img } of imgs) hueHistogram(img).forEach((v, i) => { bins[i] += v; });
      colors = teamHues(bins, profile.colorNames, profile.colorHues);
      if (!colors) return { ...profile, layout: { killfeed: `no team colors near "${profile.colorNames.ally}" and "${profile.colorNames.enemy}"`, hues: topHues(bins) } };
    }
    // the learn call's box, in the search crop's pixels: the bands there show the rows' edge and height
    const bx0 = ((box[0] - search[0]) / search[2]) * w, bx1 = ((box[0] + box[2] - search[0]) / search[2]) * w;
    const by0 = ((box[1] - search[1]) / search[3]) * h, by1 = ((box[1] + box[3] - search[1]) / search[3]) * h;
    const inBox = (b2) => (b2.y0 + b2.y1) / 2 >= by0 && (b2.y0 + b2.y1) / 2 <= by1 && b2.x1 >= bx0 && b2.x0 <= bx1;
    let found = alignedRows(imgs.map(({ img }) => bandExtents(img, colors)), inBox, w);
    // center each color on the pixels inside those rows, so the background behind the feed never votes, and look again
    const mid = ([a2, b2]) => (a2 <= b2 ? (a2 + b2) / 2 : ((a2 + b2 + 360) / 2) % 360);
    const target = { ally: profile.colorHues?.ally ?? mid(colors.ally), enemy: profile.colorHues?.enemy ?? mid(colors.enemy) };
    const centers = found && rowHues(imgs.map((x) => x.img), found.rows, colors, target);
    if (centers) { colors = { ally: centers.ally, enemy: centers.enemy }; found = alignedRows(imgs.map(({ img }) => bandExtents(img, colors)), inBox, w) || found; }
    if (!found) return { ...profile, killfeedColors: colors, layout: { killfeed: 'team colors found, but no rows that line up' } };
    const rows = found, flat = rows.rows.flat();
    // the kill feed is where its rows were: half a row to spare above and below, and across from the 10th to the 90th
    // percentile of their ends, with a row's height to spare
    const y0 = clamp(rows.top - rows.height * 0.5, 0, h), y1 = clamp(rows.bottom + rows.height * 0.5, 0, h), rh = y1 - y0;
    const pct = (xs, q) => { const t = [...xs].sort((a2, b2) => a2 - b2); return t[Math.min(t.length - 1, Math.floor(q * t.length))]; };
    const x0 = clamp(pct(flat.map((b2) => b2.x0), 0.1) - rows.height, 0, w), x1 = clamp(pct(flat.map((b2) => b2.x1), 0.9) + rows.height, 0, w);
    const killfeed = [search[0] + (x0 / w) * search[2], search[1] + (y0 / h) * search[3], ((x1 - x0) / w) * search[2], (rh / h) * search[3]].map((v) => Math.round(v * 1000) / 1000);
    const trimmed = flat.map((b2) => b2.cols.slice(Math.round(x0), Math.round(x1)));
    const grid = { top: (rows.top - y0) / rh, pitch: (rows.pitch || rows.height * 1.2) / rh, height: rows.height / rh, portrait: portraitShare(trimmed, x1 - x0) };
    const bands = rows.rows;
    // Narrow the feed to the rows the kill-feed reader itself accepts (team color and white name text) across the
    // samples: color bands alone can include a long band of scenery that ends where the rows do.
    const fx = killfeed[0] * frame.w, fw = killfeed[2] * frame.w, rx0 = [], rx1 = [];
    for (const { img } of imgs) {
      const sub = cropImage(img, Math.round(((killfeed[0] - search[0]) / search[2]) * w), Math.round(y0), Math.round((killfeed[2] / search[2]) * w), Math.round(rh));
      for (const r of C.killfeedRows(sub, { colors, grid })) if (r.left && r.right) { rx0.push(r.x0); rx1.push(r.x1); }
    }
    if (rx0.length >= 4) {
      const sw = (killfeed[2] / search[2]) * w, a0 = clamp(pct(rx0, 0.1) - rows.height, 0, sw), a1 = clamp(pct(rx1, 0.9) + rows.height, 0, sw);
      killfeed[0] = Math.round(((fx + (a0 / sw) * fw) / frame.w) * 1000) / 1000;
      killfeed[2] = Math.round(((((a1 - a0) / sw) * fw) / frame.w) * 1000) / 1000;
    }
    // The portrait at a row's end can carry either team's color, so how much of the end to skip decides whether the
    // victim's side reads right. Try widths from none to a fifth of the feed and keep the one where the most rows read
    // as two different teams, as every kill is.
    const subs = imgs.map(({ img }) => cropImage(img, Math.round(((killfeed[0] - search[0]) / search[2]) * w), Math.round(y0), Math.max(1, Math.round((killfeed[2] / search[2]) * w)), Math.max(1, Math.round(rh))));
    let bestShare = -1;
    for (let portrait = 0; portrait <= 0.2001; portrait += 0.02) {
      let two = 0, all = 0;
      for (const sub of subs) for (const r of C.killfeedRows(sub, { colors, grid: { ...grid, portrait } })) { all++; if (r.left && r.right) two++; }
      const share = all ? two / all : 0;
      if (share > bestShare + 0.01) { bestShare = share; grid.portrait = Math.round(portrait * 100) / 100; }
    }
    const learned = { ...profile, regions: { ...profile.regions, killfeed }, killfeedColors: colors, killfeedGrid: grid };
    // the busiest sample is where rows move the most
    const busiest = imgs[bands.reduce((k, b, i) => (b.length > bands[k].length ? i : k), 0)].t;
    const dir = await feedDirection({ video, profile: learned, around: busiest, signal });
    // A layout that finds far more new rows than a match has kills is wrong somewhere (a row tracked as new every second
    // costs a model call per 32), so scans fall back to the low-detail pass rather than pay for it.
    if (dir.perMinute > MAX_ROWS_PER_MINUTE) return { ...profile, killfeedColors: colors, layout: { killfeed: `measured, but it found ${Math.round(dir.perMinute)} new rows a minute at the busiest stretch, more than a match has kills`, rowHues: centers?.seen } };
    return { ...learned, killfeedGrid: { ...grid, newRows: dir.newRows }, layout: { killfeed: 'measured', perMinute: Math.round(dir.perMinute * 10) / 10, twoTeams: Math.round(bestShare * 100) / 100, rowHues: centers?.seen } };
  }
  const around = (h, d) => [(h - d + 360) % 360, (h + d) % 360];
  const inRange = (h, [a, b]) => (a <= b ? h >= a && h <= b : h >= a || h <= b);
  /**
   * Each team's hue range as it really is inside the rows, from the clearly colored pixels in the bands' solid columns
   * (mostly one team's color top to bottom, so the background beside a row doesn't count), in 5° bins per starting
   * range: of the peaks holding 10% or more, the one nearest the color the learn call reported (target), and the bins
   * falling away from it. The biggest peak can be bleed: a see-through red bar over an orange wall reads orange-red.
   * null when a range has too few such pixels to say.
   */
  function rowHues(imgs, bands, colors, target) {
    const sum = { ally: new Array(72).fill(0), enemy: new Array(72).fill(0) };
    imgs.forEach(({ data: d, width: w }, i) => {
      for (const b of bands[i]) for (let x = 0; x < w; x++) {
        let on = 0;
        for (let y = b.y0; y <= b.y1; y++) { const k = (y * w + x) * 4, t = C.pixelTeam(d[k], d[k + 1], d[k + 2], colors); if (t === 1 || t === 2) on++; }
        if (on < (b.y1 - b.y0 + 1) * 0.4) continue;
        for (let y = b.y0; y <= b.y1; y++) {
        const k = (y * w + x) * 4, r = d[k], g = d[k + 1], bl = d[k + 2], mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
        if (mx < 110 || (mx - mn) / mx < 0.35) continue;
        const hue = ((mx === r ? (g - bl) / (mx - mn) : mx === g ? 2 + (bl - r) / (mx - mn) : 4 + (r - g) / (mx - mn)) * 60 + 360) % 360;
        for (const team of ['ally', 'enemy']) if (inRange(hue, colors[team])) sum[team][Math.floor(hue / 5) % 72]++;
        }
      }
    });
    const total = (b) => b.reduce((a, v) => a + v, 0);
    // the chosen peak, and its range: out from the peak while the bins hold 2% or more and keep falling, plus 5°, so a
    // second peak of bleed beside it stays out
    const pick = (b, want) => {
      const peaks = b.map((v, i) => ({ i, v })).filter((p) => p.v >= total(b) * 0.1 && p.v >= b[(p.i + 71) % 72] && p.v >= b[(p.i + 1) % 72]);
      const k = peaks.sort((x, y) => hueGap(x.i * 5 + 2.5, want) - hueGap(y.i * 5 + 2.5, want))[0]?.i ?? b.indexOf(Math.max(...b));
      const reach = (dir) => { let j = k, n = 0; while (n < 5 && b[(j + dir + 72) % 72] >= total(b) * 0.02 && b[(j + dir + 72) % 72] <= b[j]) { j = (j + dir + 72) % 72; n++; } return n; };
      const lo = Math.min(5, Math.max(2, reach(-1) + 1)), hi = Math.min(5, Math.max(2, reach(1) + 1));
      return [((k - lo) * 5 + 360) % 360, ((k + 1 + hi) * 5) % 360];
    };
    if (total(sum.ally) < 200 || total(sum.enemy) < 200) return null;
    const top = (b) => b.map((v, i) => [i * 5, Math.round((100 * v) / total(b))]).filter(([, v]) => v >= 3).sort((x, y) => y[1] - x[1]).map(([hh, v]) => `${hh}:${v}%`).join(' ');
    return { ally: pick(sum.ally, target.ally), enemy: pick(sum.enemy, target.enemy), seen: { ally: top(sum.ally), enemy: top(sum.enemy) } };
  }
  /** A rectangle of an ImageData-like crop, as a new one. */
  function cropImage({ data, width }, x, y, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let r = 0; r < h; r++) out.set(data.subarray(((y + r) * width + x) * 4, ((y + r) * width + x + w) * 4), r * w * 4);
    return { data: out, width: w, height: h };
  }
  // the biggest hue bins, for saying what the kill feed looked like when its colors couldn't be matched
  const topHues = (bins) => bins.map((v, i) => ({ hue: i * 10 + 5, v })).sort((a, b) => b.v - a.v).slice(0, 4).map((x) => x.hue);

  /**
   * Which way new kill-feed rows join, read from the video: over 90 s around the busiest moment, rows are tracked both
   * ways (C.freshRows), and the true direction counts fewer new rows, since the wrong one takes every row that moved for
   * a new kill. Returns { newRows, perMinute }: the new rows a minute that direction found.
   */
  async function feedDirection({ video, profile, around, signal }) {
    const crop = C.regionRect(profile, 'killfeed', { w: video.width, h: video.height }), times = [];
    for (let t = Math.max(0, Math.floor(around - 45)); t <= Math.min(video.duration - 0.05, around + 45); t += 1) times.push(t);
    const stretch = [];
    await V.each(video, times, { crop, maxDim: 2000, signal }, ({ t, canvas, w, h }) => { stretch.push({ t, rows: C.killfeedRows(canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h), { colors: profile.killfeedColors, grid: profile.killfeedGrid }) }); });
    const fresh = (newRows) => { let recent = [], n = 0; for (const { t, rows } of stretch) { const f = C.freshRows(recent, rows, t, { newRows }); recent = f.recent; n += f.fresh.length; } return n; };
    const top = fresh('top'), bottom = fresh('bottom'), minutes = Math.max(1, stretch.length) / 60;
    return top < bottom ? { newRows: 'top', perMinute: top / minutes } : { newRows: 'bottom', perMinute: bottom / minutes };
  }

  /**
   * Learns the game from the recording: the learn call on SAMPLES frames, the research on what matters in the game
   * (researchGame, one call per new game), then the pixel layout. Returns { profile, frames, raw, research }: frames are
   * the pictures the learn call saw, for the app to draw the learned boxes on.
   */
  async function learnGame({ video, checks = Object.keys(CHECKS), signal, onNotice }) {
    const times = Array.from({ length: SAMPLES }, (_, k) => +((video.duration * (k + 0.5)) / SAMPLES).toFixed(2));
    const frames = await V.grab(video, times, { maxDim: 1024, quality: 0.8 });
    const parts = frames.flatMap((f, i) => [{ text: `Frame ${i + 1}, at ${C.mmss(f.t)}` }, { inlineData: { mimeType: f.mimeType, data: f.data } }]);
    const prompt = `These frames are spread over one recording of a game, from the player's own screen. Identify the game and describe what's on screen, so a coach can read the match from it.
elements: every HUD or board element that shows the state of play, each with a tight box [ymin, xmin, ymax, xmax] scaled 0-1000 in the frame (frame, numbered from 1) where it's clearest. kill_feed: the list of recent kills, all its rows; ammo: the magazine count; damage: the counter of damage the player has dealt, if the game shows one, boxed on its own; board: the playing board.
fov_h: the game's default horizontal field of view if you know it, else 0.
cues: up to 6 short facts about how key moments look on screen, such as a kill, a death, a round start, a capture.`;
    const resp = await G.generate({
      contents: [{ role: 'user', parts: [...parts, { text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: schema() },
    }, { signal, onNotice });
    const raw = G.parseJSON(G.textOf(resp));
    // what matters in this game comes from the web, not from what code happens to be able to check
    const research = await researchGame({ name: raw?.game, genre: raw?.genre, checks, signal, onNotice });
    const profile = await learnLayout({ video, profile: toProfile(raw, checks, research), signal });
    return { profile, frames, raw, research };
  }

  const api = { learnGame, researchGame, cleanResearch, learnLayout, toProfile, mergeBoxes, hueHistogram, teamHues, nameHue, rgbHue, alignedRows, portraitShare, CHECKS, ELEMENTS, GENRES, AIM, AIM_TARGETS };
  root.ThirdeyeLearn = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
