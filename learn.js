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
  // own_screen: the player's own screen, everything in it theirs. spectator: footage of the whole match (a broadcast,
  // coaching film, a match filmed from the stands) where the player is one of many, so they say which one they are.
  const VIEWS = ['own_screen', 'spectator'];
  const ELEMENTS = ['kill_feed', 'minimap', 'ammo', 'health', 'scoreboard', 'damage', 'kill_count', 'board', 'player_clock', 'opponent_clock', 'gold', 'abilities'];
  // what each element is, for the learn call and for checking its boxes
  const WHAT = { kill_feed: 'the list of recent kills', minimap: 'the small map', ammo: 'the magazine count', health: "the player's own health or shield bar", scoreboard: "each side's score, or the teams or players left", damage: 'the counter of damage the player has dealt', kill_count: "the counter of the player's own kills, or of their kills, deaths, and assists", board: 'the playing board', player_clock: "the player's clock", opponent_clock: "the opponent's clock", gold: 'the gold or money count', abilities: 'ability or ultimate icons' };
  const AIM_TARGETS = ['head', 'body', 'tracking', 'none'];
  const RESEARCH_STORE = 'thirdeye.research.v2', RESEARCH_DAYS = 7; // v2: searched by facet, with the meta, the wiki's lists, and the character's kit; a week, since the meta moves with patches
  // what code can check a habit with, and what the learn call is told about each
  const CHECKS = {
    aim: 'code measures crosshair height against enemy heads (first-person shooters)',
    shots: 'code reads the ammo counter to tell whether the player fired',
    engine: "code reads every move off the board and a chess engine scores it: each of the player's moves gets its centipawn loss (chess)",
    abilities: 'the clip read around every fight lists each ability the player used, from their ability icons and its effect on screen',
  };
  // The center of a first-person view, where the aim is measured: geometry, the same in any such game.
  const AIM = [0.3, 0.22, 0.4, 0.56];
  const MIN_FEED_H = 0.12; // of the screen: about five lines of a kill feed
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
        view: { type: 'string', enum: VIEWS, description: "own_screen: the player's own game screen, its camera following the one player they control (first or third person). spectator: a broadcast, coaching film, replay, or a match filmed from the stands, where many players are on screen and the camera follows the action" },
        sides: { type: 'array', maxItems: 4, description: 'in spectator footage, the teams or players on each side and how to tell them apart on screen; empty otherwise', items: { type: 'object', properties: { name: str('the side as the screen names it (a team name, a score bug), or by its look'), look: str('how its players look on screen: jersey, helmet, or kit colors, markers') }, required: ['name', 'look'] } },
        unit: str("one unit of play in the game's own word (a round, a play, a point, a rally, a possession, a hand), or empty when play is continuous"),
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
        player_name: str("the player's own name, exactly, only where the screen marks it as theirs (highlighted in a team list or scoreboard, or over the character the camera follows); empty when it doesn't, since names over other characters are other players'"),
        player_side: str("the player's own team or side as the HUD shows it: its color (the color of their own car, name, or bar) or its name; empty in a game without sides"),
        character: str("the character the player plays (an agent, hero, legend, champion, or fighter), by its in-game name, from the portrait or the ability icons; empty when the game has none or it doesn't show"),
        cues: { type: 'array', items: { type: 'string' } },
        key_moments: str('one sentence: the moments where the player wins or loses something'),
      },
      required: ['game', 'genre', 'view', 'first_person', 'crosshair_center', 'team_game', 'rounds', 'elements', 'cues', 'key_moments'],
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
   * reads. The research is the coach's to ask for (agent.js research), so a profile learned from the recording alone has
   * no habits yet; with research given, its habits come from habitsFor.
   */
  /**
   * The coach's habits from research: the game's costly mistakes, then up to 3 of the player's character's. Each keeps a
   * check only when code can really make it in this recording: aim needs the aim region and a game where aim has a
   * height target, shots an ammo counter, the engine a board. profile: { regions }; research as researchGame returns it.
   */
  function habitsFor(research, { regions = {} } = {}, checks = Object.keys(CHECKS)) {
    const aimTarget = AIM_TARGETS.includes(research?.aimTarget) ? research.aimTarget : 'none', habits = [];
    const found = Array.isArray(research?.mistakes) ? [...research.mistakes, ...(research.character?.mistakes || []).slice(0, 3), ...(research.role?.mistakes || []).slice(0, 3)] : [];
    for (const h of found) {
      const id = slug(h?.id || h?.name);
      if (!id || habits.some((x) => x.id === id) || !String(h?.name || '').trim()) continue;
      const by = checks.includes(h.checked_by) ? h.checked_by : null;
      const aimable = regions.aim && (aimTarget === 'head' || aimTarget === 'body');
      habits.push({ id, name: String(h.name).trim().slice(0, 60), signs: String(h.signs || '').trim().slice(0, 300), drill: String(h.drill || '').trim().slice(0, 300), ...(h.cost ? { cost: String(h.cost).trim().slice(0, 200) } : {}), ...(by === 'aim' && aimable ? { measuredBy: 'aim' } : {}), ...(by === 'engine' && regions.board ? { measuredBy: 'engine' } : {}), ...(by === 'shots' && regions.ammo ? { needsShots: true } : {}), ...(by === 'abilities' ? { byAbilities: true } : {}) });
    }
    return habits;
  }
  /** The research as the profile keeps it: what the coach and the report read. */
  const researchBrief = (research) => (research ? { rewards: research.rewards, systems: research.systems, priorities: research.priorities, engagements: research.engagements, meta: research.meta || null, reference: research.reference || null, sources: research.sources, facets: research.facets || null, researched: research.researched, character: research.character || null, role: research.role || null } : null);

  function toProfile(raw, checks = Object.keys(CHECKS), research = null) {
    const regions = mergeBoxes(raw?.elements);
    // a kill feed runs from a screen edge, and a box drawn short of it cuts its names off (Marvel Rivals, Oct 22): one
    // ending near an edge is taken to it
    // and it holds several lines: a box drawn round the one line a frame showed (Marvel Rivals: 0.02 of the screen tall)
    // loses lines that scroll on in a fight, so a thin one reaches toward the middle of the screen, where feeds grow
    if (regions.killfeed) {
      let [x, y, w, h] = regions.killfeed;
      if (x + w > 0.85) w = 1 - x;
      else if (x < 0.15) { w += x; x = 0; }
      if (h < MIN_FEED_H) { if (y + h / 2 < 0.5) h = MIN_FEED_H; else { y = Math.max(0, y + h - MIN_FEED_H); h = MIN_FEED_H; } }
      regions.killfeed = [x, y, w, Math.min(h, 1 - y)].map((v) => Math.round(v * 1000) / 1000);
    }
    const view = raw?.view === 'spectator' ? 'spectator' : 'own_screen';
    // footage of the whole match has no crosshair of the player's: its center is wherever the camera points
    const firstPerson = view === 'own_screen' && !!raw?.first_person, center = raw?.crosshair_center !== false;
    if (firstPerson && center) regions.aim = AIM;
    const sides = view === 'spectator' ? (Array.isArray(raw?.sides) ? raw.sides : []).filter((x) => String(x?.name || '').trim()).slice(0, 4).map((x) => ({ name: String(x.name).trim().slice(0, 40), look: String(x.look || '').trim().slice(0, 120) })) : [];
    const aimTarget = AIM_TARGETS.includes(research?.aimTarget) ? research.aimTarget : 'none';
    const habits = habitsFor(research, { regions }, checks);
    const respawn = +raw?.respawn_seconds;
    return {
      learned: true,
      name: String(raw?.game || 'this game').trim().slice(0, 60),
      genre: GENRES.includes(raw?.genre) ? raw.genre : 'other',
      view,
      ...(view === 'spectator' ? { sides, unit: String(raw?.unit || '').trim().toLowerCase().slice(0, 30) || 'play' } : {}),
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
      character: research?.character?.name || String(raw?.character || '').trim().slice(0, 40) || null,
      playerName: String(raw?.player_name || '').trim().slice(0, 40) || null,
      playerSide: String(raw?.player_side || '').trim().toLowerCase().slice(0, 40) || null,
      research: researchBrief(research),
      habits,
    };
  }

  // ---------- what matters in the game, from the web ----------
  const MISTAKE = { type: 'object', properties: { name: str('a few words'), signs: str("how it shows on the player's screen"), cost: str('why it costs, one sentence'), drill: str('one specific way to practice fixing it'), checked_by: { type: 'string' } }, required: ['name', 'signs', 'cost', 'drill', 'checked_by'] };
  const RESEARCH_SCHEMA = {
    type: 'object',
    properties: {
      rewards: str('what wins a match and earns rank in it, one sentence; never cosmetic rewards'),
      systems: { type: 'array', items: { type: 'object', properties: { name: str("a few words, in the game's own terms"), matters: str('how good players use it to win, one or two sentences') }, required: ['name', 'matters'] } },
      priorities: { type: 'array', items: { type: 'string' } },
      engagements: str('when a fight is worth taking and what makes one good or bad, one or two sentences; empty if the game has no fights'),
      aim_target: { type: 'string', enum: AIM_TARGETS },
      mistakes: { type: 'array', items: MISTAKE },
      meta: { type: 'object', properties: {
        patch: str('the latest patch or season the sources name, its number or date'),
        strong: { type: 'array', items: { type: 'object', properties: { name: str('a character, weapon, or strategy'), why: str('why it is strong now, one sentence') }, required: ['name', 'why'] } },
        changes: { type: 'array', items: { type: 'object', properties: { what: str('what changed: a rework, buff, or nerf, by name'), effect: str('what it changes in play, one sentence') }, required: ['what', 'effect'] } },
      }, required: ['patch', 'strong', 'changes'] },
      reference: { type: 'object', properties: {
        characters: { type: 'array', items: { type: 'object', properties: { name: str('as the game names it'), role: str('its role or class') }, required: ['name', 'role'] } },
        maps: { type: 'array', items: { type: 'string' } },
        weapons: { type: 'array', items: { type: 'string' } },
        other: { type: 'array', items: { type: 'object', properties: { kind: str('what the list is: attachments, items, runes, cards...'), names: { type: 'array', items: { type: 'string' } } }, required: ['kind', 'names'] } },
      }, required: ['characters', 'maps', 'weapons', 'other'] },
    },
    required: ['rewards', 'systems', 'priorities', 'engagements', 'aim_target', 'mistakes', 'meta', 'reference'],
  };
  const CHARACTER_SCHEMA = {
    type: 'object',
    properties: {
      role: str("the character's role or class, a few words"),
      abilities: { type: 'array', items: { type: 'object', properties: { name: str('its exact in-game name'), slot: str("its key or kind as the game names it: a key such as Q, E, or C, or the game's word for it (passive, tactical, ultimate, special move)"), does: str('what it does, one sentence'), use: str('how good players use it to win fights, one sentence') }, required: ['name', 'slot', 'does', 'use'] } },
      mistakes: { type: 'array', items: MISTAKE },
    },
    required: ['role', 'abilities', 'mistakes'],
  };
  // The player's role in footage of a whole match (their position, what they play), as they said it: what wins and
  // loses one unit of play for someone in it, as coaches judge it on film, and its costly mistakes.
  const ROLE_SCHEMA = {
    type: 'object',
    properties: {
      role: str("the role, in the game's own word for it"),
      won_unit: str('what counts as the player winning one unit of play in this role, one or two sentences'),
      lost_unit: str('what counts as the player losing one unit of play in this role, one or two sentences'),
      mistakes: { type: 'array', items: MISTAKE },
    },
    required: ['role', 'won_unit', 'lost_unit', 'mistakes'],
  };
  const MIN_SOURCES = 2; // web pages a search has to cite to count as research
  // What a habit has to be about for a code check to measure it. A habit tagged with a check that can't see it would be
  // judged by numbers about something else: the research tagged Valorant's "dry peeking" with aim, which measures only
  // crosshair height, and gave the chess engine to habits in shooters and fighting games.
  const CHECKABLE = { aim: /crosshair|\baim|\bhead|height/i, shots: /fir(e|ing)|shoot|spray|reload|\bammo|magazine|burst/i, abilities: /abilit|utility|ultimate|\bults?\b|cooldown|tactical|skill/i };
  const checkFor = (m, checks, genre) => {
    const by = m?.checked_by;
    if (!checks.includes(by)) return 'none';
    if (by === 'engine') return genre === 'chess' ? 'engine' : 'none';
    return !CHECKABLE[by] || CHECKABLE[by].test(`${m.name} ${m.signs}`) ? by : 'none';
  };
  const textList = (xs, n, len) => (Array.isArray(xs) ? xs : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, n).map((x) => x.slice(0, len));
  const cleanMistakes = (list, checks, genre, n) => (Array.isArray(list) ? list : []).filter((m) => String(m?.name || '').trim()).slice(0, n)
    .map((m) => ({ name: String(m.name).trim().slice(0, 60), signs: String(m.signs || '').trim().slice(0, 300), cost: String(m.cost || '').trim().slice(0, 200), drill: String(m.drill || '').trim().slice(0, 300), checked_by: checkFor(m, checks, genre) }));
  const cleanSources = (sources) => (sources || []).filter((x) => x?.uri).slice(0, 16).map((x) => ({ title: String(x.title || x.uri).slice(0, 80), uri: x.uri, ...(x.facet ? { facet: x.facet } : {}) }));
  /**
   * The research answer cleaned to its shape, or null when it says nothing usable. Code has the last word on what can be
   * checked: a habit keeps its check only when the check can see it (CHECKABLE; the engine only in chess), a game other
   * than a shooter has no aim target, and an answer counts as researched only with MIN_SOURCES web pages behind it.
   */
  function cleanResearch(r, checks, { sources = [], researched = false, genre = 'other' } = {}) {
    if (!r || typeof r !== 'object') return null;
    const mistakes = cleanMistakes(r.mistakes, checks, genre, 8);
    if (!mistakes.length && !textList(r.priorities, 8, 80).length) return null;
    const cited = cleanSources(sources);
    return {
      rewards: (Array.isArray(r.rewards) ? r.rewards.join('; ') : String(r.rewards || '')).trim().slice(0, 240),
      systems: (Array.isArray(r.systems) ? r.systems : []).filter((x) => String(x?.name || '').trim()).slice(0, 8).map((x) => ({ name: String(x.name).trim().slice(0, 60), matters: String(x.matters || '').trim().slice(0, 300) })),
      priorities: textList(r.priorities, 8, 80), engagements: String(r.engagements || '').trim().slice(0, 300),
      aimTarget: genre === 'shooter' && AIM_TARGETS.includes(r.aim_target) ? r.aim_target : 'none', mistakes,
      meta: cleanMeta(r.meta), reference: cleanReference(r.reference),
      sources: cited, researched: researched && cited.length >= MIN_SOURCES,
    };
  }
  const pairs = (xs, a, b, n, len) => (Array.isArray(xs) ? xs : []).filter((x) => String(x?.[a] || '').trim()).slice(0, n).map((x) => ({ [a]: String(x[a]).trim().slice(0, 60), [b]: String(x[b] || '').trim().slice(0, len) }));
  const cleanMeta = (m) => (m && typeof m === 'object' ? { patch: String(m.patch || '').trim().slice(0, 60), strong: pairs(m.strong, 'name', 'why', 8, 200), changes: pairs(m.changes, 'what', 'effect', 8, 200) } : null);
  const cleanReference = (r) => (r && typeof r === 'object' ? {
    characters: pairs(r.characters, 'name', 'role', 80, 40), maps: textList(r.maps, 40, 40), weapons: textList(r.weapons, 60, 40),
    other: (Array.isArray(r.other) ? r.other : []).filter((x) => String(x?.kind || '').trim()).slice(0, 6).map((x) => ({ kind: String(x.kind).trim().slice(0, 40), names: textList(x.names, 60, 40) })),
  } : null);
  /** A character's kit cleaned to its shape, or null without abilities. */
  function cleanCharacter(r, name, checks, genre, { sources = [], researched = false } = {}) {
    const abilities = (Array.isArray(r?.abilities) ? r.abilities : []).filter((a) => String(a?.name || '').trim()).slice(0, 8)
      .map((a) => ({ name: String(a.name).trim().slice(0, 60), slot: String(a.slot || '').trim().slice(0, 30), does: String(a.does || '').trim().slice(0, 200), use: String(a.use || '').trim().slice(0, 200) }));
    if (!abilities.length) return null;
    const cited = cleanSources(sources);
    return { name: String(name).trim().slice(0, 40), role: String(r.role || '').trim().slice(0, 60), abilities, mistakes: cleanMistakes(r.mistakes, checks, genre, 5), sources: cited, researched: researched && cited.length >= MIN_SOURCES };
  }
  /** A role's research cleaned to its shape, or null when it says neither what loses a unit nor any mistake. */
  function cleanRole(r, said, checks, genre, { sources = [], researched = false } = {}) {
    const lost = String(r?.lost_unit || '').trim().slice(0, 300), won = String(r?.won_unit || '').trim().slice(0, 300), mistakes = cleanMistakes(r?.mistakes, checks, genre, 5);
    if (!lost && !mistakes.length) return null;
    const cited = cleanSources(sources);
    return { name: String(r?.role || said).trim().slice(0, 40), said: String(said).trim().slice(0, 120), won, lost, mistakes, sources: cited, researched: researched && cited.length >= MIN_SOURCES };
  }
  const gameKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const readCache = () => { try { return JSON.parse(root.localStorage?.getItem(RESEARCH_STORE) || '{}') || {}; } catch { return {}; } };
  const writeCache = (key, value) => { const cache = readCache(); cache[key] = { value, expires: Date.now() + RESEARCH_DAYS * 864e5 }; try { root.localStorage?.setItem(RESEARCH_STORE, JSON.stringify(cache)); } catch {} };
  const cached = (key) => { const c = readCache()[key]; return c && c.expires > Date.now() ? c.value : null; };

  /**
   * One web search, answered in prose: asked once more, to search first, when it cites fewer than MIN_SOURCES pages.
   * Returns { text, sources }, or null when search isn't available. opts is shared across one research's searches.
   */
  async function search(ask, facet, opts) {
    // once a search has failed (no search model, a used-up quota, each failure after a minute's waits), the rest of
    // this research doesn't try: it would wait out the same quota again for every question
    if (opts.down) return null;
    let found = null;
    try {
      for (let k = 0; k < 2 && (!found || found.sources.length < MIN_SOURCES); k++) {
        const r = await root.Gemini.grounded(k ? `${ask}\nSearch the web for this first, and answer from the pages you find.` : ask, { signal: opts.signal, onNotice: opts.onNotice });
        if (r.text && (!found || r.sources.length > found.sources.length)) found = r;
      }
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      if (!found) opts.down = true;
    }
    return found && { text: found.text, sources: found.sources.map((x) => ({ ...x, facet })) };
  }
  /**
   * Several searches, each answered in prose, put into one schema by a call without search: asked for JSON outright, the
   * search came back as prose for 2 of 6 games. A question whose search fails is answered from the model's own
   * knowledge, and its facet counts 0 sources. asks: [{ facet, ask }]. Returns { answer, sources, researched, facets }.
   */
  async function researchAll(asks, schema, shape, opts) {
    const Gm = root.Gemini, found = [];
    for (let k = 0; k < asks.length; k += 2) found.push(...(await Promise.all(asks.slice(k, k + 2).map((a) => search(a.ask, a.facet, opts))))); // two at a time
    const web = found.some(Boolean);
    // a search that failed (no search model, a used-up quota) is answered from the model's own knowledge, and marked so
    const prose = await Promise.all(asks.map(async (a, i) => found[i]?.text || Gm.textOf(await Gm.generate({ contents: [{ role: 'user', parts: [{ text: a.ask }] }], generationConfig: { temperature: 0.2 } }, opts))));
    const text = asks.map((a, i) => (prose[i] ? `## ${a.facet}${found[i] ? '' : " (the model's own knowledge, not the web)"}\n${prose[i]}` : '')).filter(Boolean).join('\n\n');
    const resp = await Gm.generate({ contents: [{ role: 'user', parts: [{ text: `${shape}\n\n${text}` }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema } }, opts);
    // a few pages from each search before more from any one, so the meta's and the wiki's show beside the guides'
    const seen = new Set(), sources = [];
    for (let k = 0; found.some((f) => f?.sources[k]); k++) for (const f of found) { const x = f?.sources[k]; if (x && !seen.has(x.uri)) { seen.add(x.uri); sources.push(x); } }
    return { answer: Gm.parseJSON(Gm.textOf(resp)), sources, researched: web, facets: Object.fromEntries(asks.map((a, i) => [a.facet, found[i]?.sources.length || 0])) };
  }

  /**
   * What matters in a game, from the web, searched the way a player would look it up: improvement guides and coaching,
   * what the community (Reddit, forums) calls good and bad habits, the current meta (the patch, what's strongest, recent
   * reworks), and the game's wiki or official pages (every character, map, weapon, and other pick). Nothing in the
   * questions is about one game. One call then puts it in shape: what wins, the systems that decide fights and matches
   * and how good players use them, priorities, when fights are worth it, where good players aim, costly habits (each
   * with what code can check it with), the meta, and the lists. With the character the player plays (an agent, hero,
   * legend, champion, fighter), also its kit as of the latest patch: each ability by its in-game name, what it does, how
   * it's used, and the mistakes players make with it. Kept for RESEARCH_DAYS, the game and each character apart: the
   * meta moves with patches.
   */
  async function researchGame({ name, genre, character = '', role = '', unit = 'play', checks = Object.keys(CHECKS), signal, onNotice }) {
    const key = gameKey(name), opts = { signal, onNotice }; // shared by every search in this research, so a failure is learned once
    const tagging = `checked_by, for each mistake, is what can check it in code: ${checks.map((c) => `${c} (${CHECKS[c]})`).join('; ')}; or none.`;
    let research = cached(key);
    if (!research) {
      const game = `${name} (${genre})`;
      const asks = [
        { facet: 'guides', ask: `How do players get better at ${game}? Use improvement guides and coaching advice from top players and coaches, not general gaming advice, in the game's own terms: what wins a match and what earns rank (not cosmetic rewards); the core systems that decide fights and matches (abilities and ultimates, roles or classes, character picks and counters, economy, objectives, resources, the map or zone, whatever this game has) and how good players use each; the 5 to 8 things that matter most, most important first; when a fight is worth taking and what makes one good or bad; and where good players aim, if the game has aiming.` },
        { facet: 'community', ask: `What do ${game} players on Reddit and the game's forums say are the good and bad habits that decide matches? Give 6 to 8 costly bad habits, each with how it shows on the player's own screen, why it costs, and one specific drill, and the good habits that beat them.` },
        { facet: 'meta', ask: `What is the current meta in ${game}? Name the latest patch or season (its number or date), the strongest characters, weapons, or strategies right now and why, and recent changes (reworks, buffs, nerfs to abilities, weapons, or maps) and what they change in play. Use patch notes, tier lists, and meta reviews.` },
        { facet: 'wiki', ask: `From ${name}'s wiki or official site, list every playable character by its own name, all of them even if there are over a hundred (not just the classes they fall into), each with its role or class; every map; every weapon or weapon class; and anything else a player picks before or during a match (attachments, items, runes, cards...), by the names the game uses.` },
      ];
      const shape = `Put this research on ${name} into the shape asked for, keeping its facts and the game's own names; add nothing it doesn't say. rewards: what wins and earns rank, never cosmetics. systems: up to 8. priorities: 3 to 8, a few words each. aim_target: head, body, tracking (staying on target matters more than where), or none when the game has no aiming. mistakes: 6 to 8, from the guides and the community. meta: as the meta research says. reference: the lists as the wiki research gives them, characters by name, never classes in their place. ${tagging}`;
      const r = await researchAll(asks, RESEARCH_SCHEMA, shape, opts);
      research = cleanResearch(r.answer, checks, { sources: r.sources, researched: r.researched, genre });
      if (research) { research.facets = r.facets; writeCache(key, research); }
    }
    if (research && String(role || '').trim()) research = { ...research, role: await researchRole({ name, genre, role, unit, checks, tagging, opts }) };
    if (!research || !String(character || '').trim()) return research;
    // the character by the game's own name for it, when the wiki's list has it
    const listed = research.reference?.characters?.find((c) => gameKey(c.name) === gameKey(character) || gameKey(c.name).replace(/ /g, '') === gameKey(character).replace(/ /g, ''));
    const who = listed?.name || String(character).trim(), ckey = `${key}|${gameKey(who)}`;
    let kit = cached(ckey);
    if (!kit) {
      const ask = `${who} in ${name}: their kit as of the latest patch, including any recent rework, from the game's wiki or official pages, patch notes, and guides from top players. Name each ability exactly as the game does, with its key or kind as the game names it (the key it's on, or the game's word: passive, tactical, ultimate, special move...), what it does, and how good players use it to win fights. Then their role, and the 3 to 5 most costly mistakes players make with ${who}, each with how it shows on the player's own screen, why it costs, and one specific drill.`;
      const shape = `Put this research on ${who} in ${name} into the shape asked for, keeping every ability's exact in-game name; add nothing it doesn't say. ${tagging}`;
      const r = await researchAll([{ facet: 'character', ask }], CHARACTER_SCHEMA, shape, opts);
      kit = cleanCharacter(r.answer, who, checks, genre, r);
      if (kit) writeCache(ckey, kit);
    }
    return kit ? { ...research, character: kit } : research;
  }

  /**
   * What wins and loses one unit of play (a play, a point, a possession) for a player in the role they said they play,
   * and the role's costly mistakes, from coaching on the web; kept like the game's research, per role and unit. The
   * role is the player's own words, so it goes to the model as data. Its examples are from other games, so no answer
   * is suggested for this one.
   */
  async function researchRole({ name, genre, role, unit, checks, tagging, opts }) {
    const said = String(role).trim().slice(0, 120), rkey = `${gameKey(name)}|role:${gameKey(said)}|${gameKey(unit)}`;
    const hit = cached(rkey);
    if (hit) return hit;
    const as = root.Gemini.untrusted(said, 120);
    const ask = `In ${name} (${genre}), the player says they play as ${as}. As coaches judge a player in that role on film: what counts as that player winning one ${unit}, and what counts as them losing one, in the game's own terms (in tennis, say, a point lost on their serve or an unforced error; in basketball a turnover or a missed open shot); and the 3 to 5 most costly mistakes players in that role make, each with how it shows on film, why it costs, and one specific drill. Use coaching guides and analysis from coaches and top players.`;
    const shape = `Put this research on playing ${as} in ${name} into the shape asked for, in the game's own terms; add nothing it doesn't say. ${tagging}`;
    const r = await researchAll([{ facet: 'role', ask }], ROLE_SCHEMA, shape, opts);
    const out = cleanRole(r.answer, said, checks, genre, r);
    if (out) writeCache(rkey, out);
    return out;
  }

  /**
   * One question of the coach's own about the game, looked up on the web (one search, asked again when it cites fewer
   * than MIN_SOURCES pages), or answered from the model's own knowledge when search fails, and marked so. Kept for
   * RESEARCH_DAYS per game and question. Returns { answer, sources, researched }.
   */
  async function researchQuestion({ name, genre, question, signal, onNotice }) {
    const q = String(question || '').trim().slice(0, 300), key = `${gameKey(name)}?${gameKey(q)}`;
    const hit = cached(key);
    if (hit) return hit;
    const ask = `${q}\nThis is about ${name} (${genre}). Answer from what coaches, top players, the community, and the game's own pages say, in the game's own terms, in a short paragraph or a few points.`;
    const found = await search(ask, 'question', { signal, onNotice });
    const answer = found?.text || root.Gemini.textOf(await root.Gemini.generate({ contents: [{ role: 'user', parts: [{ text: ask }] }], generationConfig: { temperature: 0.2 } }, { signal, onNotice }));
    const out = { answer: String(answer || '').trim().slice(0, 2400), sources: cleanSources(found?.sources), researched: (found?.sources?.length || 0) >= MIN_SOURCES };
    if (out.answer) writeCache(key, out);
    return out;
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
   * Each pixel's hue in degrees (-1 for gray or dark), whether it's clear color rather than a muted shade (drawn by the
   * same lines as C.pixelTeam), and whether it's white, so team colors can be tried many ways on one frame without
   * measuring it again.
   */
  function pixelHues({ data: d, width: w, height: h }) {
    const hue = new Int16Array(w * h).fill(-1), clear = new Uint8Array(w * h), white = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
      if (mx > 205 && sat < 0.2) white[i] = 1;
      if (sat < 0.12 || mx < 85) continue;
      hue[i] = Math.round(((mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn)) * 60 + 360) % 360);
      clear[i] = sat >= 0.35 && mx >= 110 ? 1 : 0;
    }
    return { hue, clear, white, width: w, height: h };
  }

  const TEAM = [null, 'ally', 'enemy'];
  /**
   * The kill-feed rows in one frame under a guess at the team colors. A row puts the killer's color beside the victim's,
   * so its lines hold both teams' clear color, where a wall or the sky holds one; across a band of such lines, a row is
   * the rightmost run of one team's color that meets a run of the other's, with a name in white on it. Names and icons
   * leave gaps a run reads through. px from pixelHues; colors { ally, enemy } as hue ranges. Returns
   * [{ y0, y1, x0, x1, left, right, cols }], cols the clear team-color share of each column.
   */
  function twoTeamRows({ hue, clear, white, width: w, height: h }, colors) {
    const kind = new Uint8Array(w * h); // 1 ally, 2 enemy, 3 and 4 their muted shades
    for (let i = 0; i < w * h; i++) {
      if (hue[i] < 0) continue;
      const t = inRange(hue[i], colors.ally) ? 1 : inRange(hue[i], colors.enemy) ? 2 : 0;
      kind[i] = t && !clear[i] ? t + 2 : t;
    }
    // a line holds a team when 3% of it is that team's color, muted shades included (a see-through bar over a wall
    // is paler); the lines through the names can fall short, so a band reads through two of them
    const need = Math.max(6, w * 0.03), bands = [];
    let top = -1, last = -1;
    for (let y = 0; y <= h; y++) {
      let a = 0, e = 0;
      for (let x = 0; y < h && x < w; x++) { const k = kind[y * w + x]; if (k === 1 || k === 3) a++; else if (k === 2 || k === 4) e++; }
      if (y < h && a >= need && e >= need) { if (top < 0) top = y; last = y; continue; }
      if (top < 0 || (y < h && y - last <= 2)) continue;
      if (last - top >= 5) bands.push({ y0: top, y1: last });
      top = -1;
    }
    return bands.map(({ y0, y1 }) => {
      const n = y1 - y0 + 1, cols = [], runs = [];
      for (let x = 0; x < w; x++) {
        let a = 0, e = 0, sure = 0;
        for (let y = y0; y <= y1; y++) { const k = kind[y * w + x]; if (k === 1 || k === 3) a++; else if (k === 2 || k === 4) e++; if (k === 1 || k === 2) sure++; }
        cols.push(sure / n);
        const t = a >= e && a / n >= 0.3 ? 1 : e / n >= 0.3 ? 2 : 0, last = runs.at(-1);
        if (!t) continue;
        if (last && last.t === t && x - last.x1 <= n * 2) last.x1 = x; else runs.push({ t, x0: x, x1: x });
      }
      // runs a row tall or wider, joined again across the slivers of the other color between them
      const solid = [];
      for (const r of runs.filter((r2) => r2.x1 - r2.x0 + 1 >= n)) {
        const last = solid.at(-1);
        if (last && last.t === r.t && r.x0 - last.x1 <= n * 2) last.x1 = r.x1; else solid.push({ ...r });
      }
      // and a name in white on one side at least (a short one can fall short), which a wall or a portrait doesn't carry
      const named = ({ x0, x1 }) => { let n2 = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) n2 += white[y * w + x]; return n2 / ((x1 - x0 + 1) * n) >= 0.03; };
      for (let k = solid.length - 1; k > 0; k--) {
        const killer = solid[k - 1], victim = solid[k];
        if (killer.t !== victim.t && victim.x0 - killer.x1 <= n) return named(killer) || named(victim) ? { y0, y1, x0: killer.x0, x1: victim.x1, left: TEAM[killer.t], right: TEAM[victim.t], cols } : null;
      }
      return null;
    }).filter(Boolean);
  }

  /**
   * twoTeamRows over the layout samples, less what stays put: a kill-feed row leaves within seconds, while an overlay of
   * two colors (a stream's graphs, a scoreboard bar) sits in one place frame after frame. A band whose place and size
   * repeat, to 3 px, in a tenth of the samples or more isn't a row.
   */
  function feedRows(px, colors) {
    const frames = px.map((p) => twoTeamRows(p, colors)), seen = new Map();
    const key = (b) => [b.y0, b.y1, b.x0, b.x1].map((v) => Math.round(v / 3)).join(':');
    for (const f of frames) for (const k of new Set(f.map(key))) seen.set(k, (seen.get(k) || 0) + 1);
    const most = Math.max(4, frames.length * 0.1);
    return frames.map((f) => f.filter((b) => seen.get(key(b)) < most));
  }

  /**
   * The kill feed's two team colors, measured: a model names a teal "blue", and a wall the color of one team can fill
   * most of the feed's box. Every pair of hues clearly present in the box (10° bins holding 0.5% of its colored pixels
   * or more: the 8 biggest, and any within 30° of a reported color) is tried as ±15° ranges, and the pair under which
   * the most rows line up as two teams side by side (alignedRows) wins. The colors the learn call reported only say
   * which of the two is the player's team.
   * px: pixelHues per frame; bins: the box's hue histogram; inBox and w as alignedRows takes them; refs { ally, enemy }:
   * the reported hues, or null. Returns { colors, found } or null.
   */
  function feedColors(px, bins, inBox, w, refs) {
    const total = bins.reduce((a, v) => a + v, 0);
    const present = bins.map((v, i) => ({ hue: i * 10 + 5, v })).filter((b) => b.v >= total * 0.005).sort((a, b) => b.v - a.v);
    const reported = present.filter((b) => [refs.ally, refs.enemy].some((r) => r != null && hueGap(b.hue, r) <= 30));
    const hues = [...new Set([...present.slice(0, 8), ...reported].map((b) => b.hue))];
    let best = null;
    for (let i = 0; i < hues.length; i++) for (let j = i + 1; j < hues.length; j++) {
      if (hueGap(hues[i], hues[j]) < 40) continue;
      const colors = { ally: around(hues[i], 15), enemy: around(hues[j], 15) };
      const found = alignedRows(feedRows(px, colors), inBox, w), n = found ? found.rows.flat().length : 0;
      if (n > (best?.n ?? 0)) best = { n, pair: [hues[i], hues[j]], colors, found };
    }
    // a handful of rows over a whole match is a coincidence of colors, not a feed
    if (!best || best.n < 8) return null;
    // which hue is the player's team: the assignment nearer the reported colors
    const [p, q] = best.pair, off = (a, b) => (refs.ally != null ? hueGap(a, refs.ally) : 0) + (refs.enemy != null ? hueGap(b, refs.enemy) : 0);
    return { colors: off(q, p) < off(p, q) ? { ally: best.colors.enemy, enemy: best.colors.ally } : best.colors, found: best.found };
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
    const key = right[1] >= left[1] ? 'x1' : 'x0', bin0 = (key === 'x1' ? right : left)[0];
    // Rows whose victim portrait carries neither team's color stop short of the edge by its width, so the bands end in
    // two clusters, two and a half rows' height apart at most; the edge is the outer one.
    const reach = Math.max(tol * 1.5, height * 2.5), mode = median(core.map((b) => b[key]).filter((x) => bin(x) === bin0));
    const ends = core.map((b) => b[key]).filter((x) => Math.abs(x - mode) <= reach).sort((a2, b2) => a2 - b2);
    const at = ends[Math.floor((key === 'x1' ? 0.75 : 0.25) * (ends.length - 1))];
    // a band one row tall, or two touching rows, ending on the shared edge or a portrait short of it
    const past = (b) => (key === 'x1' ? b.x1 - at : at - b.x0), onEdge = (b) => past(b) <= tol * 1.5 && past(b) >= -reach;
    const rows = frames.map((f) => f.filter((b) => onEdge(b) && b.y1 - b.y0 + 1 >= height * 0.65 && b.y1 - b.y0 + 1 <= height * 2.4));
    // and about as wide as the others: a long band that happens to end on the same edge is the HUD or the scenery
    const wide = median(rows.flat().map((b) => b.x1 - b.x0));
    const fits = (b) => b.x1 - b.x0 >= wide * 0.4 && b.x1 - b.x0 <= wide * 1.8;
    for (const f of rows) f.splice(0, f.length, ...f.filter(fits));
    const single = rows.map((f) => f.filter((b) => b.y1 - b.y0 + 1 <= height * 1.35));
    const flat = rows.flat();
    if (single.flat().length < 4) return null;
    const steps = single.flatMap((f) => f.slice(1).map((b2, i) => b2.y0 - f[i].y0)).filter((x) => x >= height && x <= height * 1.6);
    return { rows: single, edge: { key, at }, height: median(single.flat().map((b2) => b2.y1 - b2.y0 + 1)), pitch: steps.length >= 2 ? median(steps) : null, top: Math.min(...flat.map((b2) => b2.y0)), bottom: Math.max(...flat.map((b2) => b2.y1)) };
  }

  /**
   * How much of a row's right end is the victim's portrait rather than team color, as a share of the feed's width.
   * Portraits differ row to row but sit in one place, so it's read across all the rows at once: walking in from the
   * edge, a stretch half a row wide or more where under a quarter of them are team color, starting within a row's
   * height of the edge (a thin strip of bar can come first).
   * cols: per row, the clear team-color share of each column (0-1), left to right, ending at the feed's edge; height:
   * a row's. 0 when rows end in color.
   */
  function portraitShare(cols, width, height) {
    if (!cols.length) return 0;
    const share = (d) => cols.filter((c) => (c[c.length - 1 - d] ?? 0) >= 0.4).length / cols.length;
    let start = -1;
    for (let d = 0; d < width * 0.4; d++) {
      if (share(d) < 0.25) { if (start < 0) start = d; continue; }
      if (start >= 0 && d - start >= height * 0.5) return Math.round((d / width) * 100) / 100;
      if (d > height) return 0;
      start = -1;
    }
    return 0;
  }


  /**
   * Measures the kill feed's layout in the recording: team colors, where its rows sit, their height and pitch, the
   * portrait at each row's end, and which way new rows join. The learn call's box is only a starting point; code
   * searches around it. Returns the profile with killfeed, killfeedColors, and killfeedGrid filled in. With no rows of
   * two team colors there's no killfeedColors, and scans read the feed as plain text; rows that track badly leave no
   * killfeedGrid, and scans find rows as bands of the colors. layout.killfeed says which.
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
    // the learn call's box, in the search crop's pixels: the bands there show the rows' edge and height
    const bx0 = ((box[0] - search[0]) / search[2]) * w, bx1 = ((box[0] + box[2] - search[0]) / search[2]) * w;
    const by0 = ((box[1] - search[1]) / search[3]) * h, by1 = ((box[1] + box[3] - search[1]) / search[3]) * h;
    const inBox = (b2) => (b2.y0 + b2.y1) / 2 >= by0 && (b2.y0 + b2.y1) / 2 <= by1 && b2.x1 >= bx0 && b2.x0 <= bx1;
    const bins = new Array(36).fill(0), cut = [Math.round(bx0), Math.round(by0), Math.max(1, Math.round(bx1 - bx0)), Math.max(1, Math.round(by1 - by0))];
    for (const { img } of imgs) hueHistogram(cropImage(img, ...cut)).forEach((v, i) => { bins[i] += v; });
    const px = imgs.map(({ img }) => pixelHues(img));
    const refs = { ally: profile.colorHues?.ally ?? nameHue(profile.colorNames?.ally), enemy: profile.colorHues?.enemy ?? nameHue(profile.colorNames?.enemy) };
    const measured = feedColors(px, bins, inBox, w, refs);
    if (!measured) return { ...profile, layout: { killfeed: 'no rows of two team colors side by side', hues: topHues(bins) } };
    let { colors, found } = measured;
    // center each color on the pixels inside those rows, so the background behind the feed never votes, and look again
    const mid = ([a2, b2]) => (a2 <= b2 ? (a2 + b2) / 2 : ((a2 + b2 + 360) / 2) % 360);
    const centers = rowHues(imgs.map((x) => x.img), found.rows, colors, { ally: mid(colors.ally), enemy: mid(colors.enemy) });
    if (centers) {
      const again = alignedRows(feedRows(px, centers), inBox, w);
      if (again && again.rows.flat().length >= found.rows.flat().length * 0.9) { colors = { ally: centers.ally, enemy: centers.enemy }; found = again; }
    }
    const pitch = found.pitch || found.height * 1.2, slot = (b2) => Math.round((b2.y0 - found.top) / pitch);
    // A feed's rows stack with no empty slot between them, though the samples can miss a slot or two: out from the slot
    // that holds the most, while one of the next three holds a row.
    const holds = (k) => found.rows.filter((f) => f.some((b2) => slot(b2) === k)).length;
    const most = Array.from({ length: slot({ y0: found.bottom }) + 1 }, (_, k) => k).reduce((a2, k) => (holds(k) > holds(a2) ? k : a2), 0);
    let first = most, last = most;
    const next = (k, dir) => [1, 2, 3].map((d) => k + d * dir).find((j) => j >= 0 && holds(j));
    for (let j; (j = next(first, -1)) !== undefined;) first = j;
    for (let j; (j = next(last, 1)) !== undefined;) last = j;
    const rows = { ...found, rows: found.rows.map((f) => f.filter((b2) => slot(b2) >= first && slot(b2) <= last)) }, flat = rows.rows.flat();
    rows.top = Math.min(...flat.map((b2) => b2.y0));
    rows.bottom = Math.max(...flat.map((b2) => b2.y1));
    // The kill feed is where its rows were, half a row to spare above and below, and one more slot on the side it grows
    // toward: the busiest sample isn't the busiest the feed gets. It grows away from the side that holds a row whenever
    // any row shows.
    const growsDown = holds(first) >= holds(last);
    const y0 = clamp(rows.top - rows.height * 0.5 - (growsDown ? 0 : pitch), 0, h), y1 = clamp(rows.bottom + rows.height * 0.5 + (growsDown ? pitch : 0), 0, h), rh = y1 - y0;
    const pct = (xs, q) => { const t = [...xs].sort((a2, b2) => a2 - b2); return t[Math.min(t.length - 1, Math.floor(q * t.length))]; };
    // and on the side the rows share, no further than their edge: what shows past it is the background, which the reader
    // would take for the victim's color
    const { key, at } = rows.edge, slack = Math.max(2, w * 0.004);
    const x0 = key === 'x0' ? clamp(at - slack, 0, w) : clamp(pct(flat.map((b2) => b2.x0), 0.1) - rows.height, 0, w);
    const x1 = key === 'x1' ? clamp(at + slack, 0, w) : clamp(pct(flat.map((b2) => b2.x1), 0.9) + rows.height, 0, w);
    const killfeed = [search[0] + (x0 / w) * search[2], search[1] + (y0 / h) * search[3], ((x1 - x0) / w) * search[2], (rh / h) * search[3]].map((v) => Math.round(v * 1000) / 1000);
    const trimmed = flat.map((b2) => b2.cols.slice(Math.round(x0), Math.round(x1)));
    // the victim's portrait at a row's end can carry either team's color, so the reader starts past it
    const grid = { top: (rows.top - y0) / rh, pitch: pitch / rh, height: rows.height / rh, portrait: key === 'x1' ? portraitShare(trimmed, x1 - x0, rows.height) : 0 };
    const bands = rows.rows;
    // how many rows read as two different teams, as every kill is
    let two = 0, all = 0;
    for (const { img } of imgs) {
      const sub = cropImage(img, Math.round(x0), Math.round(y0), Math.max(1, Math.round(x1 - x0)), Math.max(1, Math.round(rh)));
      for (const r of C.killfeedRows(sub, { colors, grid })) { all++; if (r.left && r.right) two++; }
    }
    const bestShare = all ? two / all : 0;
    if (bestShare < 0.5) return { ...profile, layout: { killfeed: `rows of two colors, but only ${Math.round(bestShare * 100)}% of them read as two teams`, hues: topHues(bins) } };
    const learned = { ...profile, regions: { ...profile.regions, killfeed }, killfeedColors: colors, killfeedGrid: grid };
    // the busiest sample is where rows move the most
    const busiest = imgs[bands.reduce((k, b, i) => (b.length > bands[k].length ? i : k), 0)].t;
    const dir = await feedDirection({ video, profile: learned, around: busiest, signal });
    // A layout that finds far more new rows than a match has kills is wrong somewhere (a row tracked as new every second
    // costs a model call per 32), so scans fall back to the low-detail pass rather than pay for it.
    if (dir.perMinute > MAX_ROWS_PER_MINUTE) return { ...profile, killfeedColors: colors, layout: { killfeed: `measured, but it found ${Math.round(dir.perMinute)} new rows a minute at the busiest stretch, more than a match has kills`, rowHues: centers?.seen, measured: { killfeed, grid: { ...grid, newRows: dir.newRows } } } };
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
   * Checks each learned box against the screen. VERIFY_FRAMES whole frames, spread over the match, go to one call with
   * every box drawn on them and numbered, and Gemini says what each box outlines, without being told what it should be.
   * The whole screen is there, so the real element is there to compare: shown only a crop, it called Apex Legends'
   * ultimate icon a health bar. A number (ammo, a counter, a clock) is also checked in code, by whether its digits read
   * (C.ammoReading) in most frames, and either check can keep it: the model once called Apex's ammo count a scoreboard.
   * A box goes when its frames show a different element more often than the one claimed; no box is better than a wrong
   * one. A health box must also be long like a bar or a number (twice as long as it is thick) or have digits that read:
   * the learn call boxed Apex's ultimate icon, a square, as health every time. Two boxes that each show the other's element
   * swap names. Then each box that went is asked for once more, told what the first one showed, and the new box is
   * checked the same way. The kill feed isn't judged here (see below). Returns the profile without the boxes that went,
   * with verified: { kept, dropped: [{ name, shows, box }], moved: [{ name, shows, from, to }] }.
   */
  const VERIFY_FRAMES = 3;
  const NUMBERS = ['ammo', 'damage', 'kill_count', 'player_clock', 'opponent_clock', 'gold']; // elements that are digits
  const BARS = ['health']; // elements that are a bar, or a number in some games
  const VERIFY = { type: 'object', properties: { boxes: { type: 'array', items: { type: 'object', properties: { image: { type: 'integer' }, box: { type: 'integer' }, outlines: { type: 'string', enum: [...ELEMENTS, 'other', 'nothing'] } }, required: ['image', 'box', 'outlines'] } } }, required: ['boxes'] };
  // the counters a no-kill-feed record is read off (agent.js readCounters): the player's K/D/A, each side's score, their HP
  const RECORD = ['kill_count', 'scoreboard', 'health'];
  const RELOCATE = { type: 'object', properties: { found: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', enum: ELEMENTS }, picture: { type: 'integer' }, box: BOX }, required: ['name', 'picture', 'box'] } } }, required: ['found'] };
  /**
   * Whether a region [x, y, w, h] is long like a bar or a row of digits in a frame { w, h }: twice as long as it is
   * thick, either way. An icon is about square (Apex's ultimate, 1:1); Valorant's "100" with its shield is 2.5:1.
   */
  const barShaped = ([, , bw, bh], frame) => { const a = bw * frame.w, b = bh * frame.h; return Math.max(a, b) >= Math.min(a, b) * 2; };
  /**
   * Which boxes stay, from the check call's answers (said: [{ box, outlines }], box numbered from 1 in names' order) and
   * the frames where each one's digits read (digits: Map name to count, of pictures). Returns { kept, dropped, regions }.
   */
  // strict: kept only when the check call agrees it outlines that element (for boxes asked for again: digits alone kept
  // a Marvel Rivals ability count as its kill count)
  function judgeBoxes({ names, said, digits, pictures, regions: before, frame, strict = false }) {
    const kept = [], dropped = [], regions = { ...before };
    names.forEach((name, i) => {
      const answers = said.filter((x) => x.box === i + 1).map((x) => x.outlines);
      const own = answers.filter((a) => a === name).length, others = answers.filter((a) => a !== name && a !== 'nothing');
      const reads = (digits.get(name) || 0) * 2 > pictures;
      const shaped = !BARS.includes(name) || barShaped(before[name], frame) || reads;
      if (((own >= others.length && own > 0) || (!strict && NUMBERS.includes(name) && reads)) && shaped) kept.push(name);
      else { dropped.push({ name, shows: mostCommonOf(others) || (shaped ? 'nothing' : 'other'), box: before[name] }); delete regions[name]; }
    });
    // two boxes that each show the other's element were only named the wrong way round: they swap
    for (const d of [...dropped]) {
      const o = dropped.find((x) => x !== d && x.shows === d.name && d.shows === x.name);
      if (!o || !dropped.includes(d)) continue;
      regions[d.shows] = d.box; regions[o.shows] = o.box;
      kept.push(`${d.shows} (was ${d.name})`, `${o.shows} (was ${o.name})`);
      dropped.splice(dropped.indexOf(d), 1); dropped.splice(dropped.indexOf(o), 1);
    }
    return { kept, dropped, regions };
  }
  async function verifyRegions({ video, profile, signal, onNotice, again = true, strict = false }) {
    // the kill feed is checked in code where it's read, by its rows or lines, and is empty in most frames: the model
    // once called an empty Valorant feed's box the scoreboard, and the review lost its record
    const names = Object.keys(profile.regions).filter((r) => r !== 'aim' && r !== 'killfeed');
    if (!names.length) return profile;
    const frame = { w: video.width, h: video.height }, times = Array.from({ length: VERIFY_FRAMES }, (_, k) => +((video.duration * (k + 0.3)) / VERIFY_FRAMES).toFixed(2));
    const pictures = [], clean = [], digits = new Map(names.map((n) => [n, 0]));
    await V.each(video, times, { maxDim: 1280, signal }, ({ canvas, w, h }) => {
      const c = new OffscreenCanvas(w, h), g = c.getContext('2d'), plain = new OffscreenCanvas(w, h);
      plain.getContext('2d').drawImage(canvas, 0, 0);
      g.drawImage(canvas, 0, 0);
      g.lineWidth = 3; g.font = `bold ${Math.round(h / 32)}px sans-serif`; g.textBaseline = 'top';
      names.forEach((name, i) => {
        const [x, y, bw, bh] = profile.regions[name];
        g.strokeStyle = '#ffeb3b'; g.strokeRect(x * w, y * h, bw * w, bh * h);
        const label = String(i + 1), tw = g.measureText(label).width + 8;
        g.fillStyle = '#ffeb3b'; g.fillRect(x * w, Math.max(0, y * h - h / 30), tw, h / 30);
        g.fillStyle = '#000'; g.fillText(label, x * w + 4, Math.max(0, y * h - h / 30) + 2);
      });
      pictures.push(c);
      clean.push(plain);
    });
    for (const name of names.filter((n) => NUMBERS.includes(n) || BARS.includes(n))) {
      await V.each(video, times, { crop: C.regionRect(profile, name, frame), maxDim: 400, signal }, ({ canvas, w, h }) => { if (C.ammoReading(canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h), profile.hudText)) digits.set(name, digits.get(name) + 1); });
    }
    const images = await Promise.all(pictures.map((c) => V.toJpeg(c, 0.85)));
    const parts = images.flatMap((im, i) => [{ text: `Picture ${i + 1}` }, { inlineData: { mimeType: im.mimeType, data: im.data } }]);
    const resp = await G.generate({
      contents: [{ role: 'user', parts: [...parts, { text: `Each picture is a ${profile.name} screen with numbered yellow boxes drawn on it; a number is the same box in every picture. For each box in each picture, say which one of these it mainly outlines: ${ELEMENTS.map((e) => `${e} (${WHAT[e]})`).join('; ')}; other for something else, nothing when it outlines only the game world. Look at the whole screen: the element a box claims may be somewhere else.` }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: VERIFY, mediaResolution: 'MEDIA_RESOLUTION_HIGH' },
    }, { signal, onNotice });
    const said = (G.parseJSON(G.textOf(resp)).boxes || []).map((x) => ({ ...x, outlines: x.outlines === 'kill_feed' ? 'killfeed' : x.outlines }));
    const { kept, dropped, regions } = judgeBoxes({ names, said, digits, pictures: times.length, regions: profile.regions, frame, strict });
    // The counters that make the record, any the learn call didn't box, are asked for once with the boxes that went:
    // it boxed League's K/D/A counter in one call and missed it in the next (Oct 22). One more call per recording.
    const missing = again && profile.genre !== 'chess' ? RECORD.filter((n) => !regions[n] && !dropped.some((d) => d.name === n)) : [];
    if (!again || (!dropped.length && !missing.length)) return { ...profile, regions, verified: { kept, dropped, moved: [] } };
    // Each box that went is asked for once more, with what the first one showed, on the same frames without boxes, and
    // the new boxes are checked like the first (with no third try).
    const at = ([x, y, w, h]) => [y, x, y + h, x + w].map((v) => Math.round(v * 1000));
    const shown = (d) => (d.shows === 'nothing' ? 'only the game world' : d.shows === 'other' ? (BARS.includes(d.name) ? "something that's neither a bar nor a number" : 'something else') : WHAT[d.shows] || d.shows);
    const plainImages = await Promise.all(clean.map((c) => V.toJpeg(c, 0.85)));
    const ask = await G.generate({
      contents: [{ role: 'user', parts: [...plainImages.flatMap((im, i) => [{ text: `Picture ${i + 1}` }, { inlineData: { mimeType: im.mimeType, data: im.data } }]), { text: `Each picture is a ${profile.name} screen. ${dropped.length ? `These elements were boxed in the wrong place: ${dropped.map((d) => `${d.name} (${WHAT[d.name]}${BARS.includes(d.name) ? ', a bar or a number' : ''}): the box [ymin, xmin, ymax, xmax] = [${at(d.box).join(', ')}] in 0-1000 showed ${shown(d)}`).join('; ')}. ` : ''}${missing.length ? `These weren't boxed at all: ${missing.map((n) => `${n} (${WHAT[n]}${n === 'health' ? ', written as a number' : ''})`).join('; ')}. ` : ''}For each one the screen shows${dropped.length ? ' somewhere else' : ''}, give a tight box [ymin, xmin, ymax, xmax] scaled 0-1000 in the picture where it's clearest. Leave out one the screen doesn't show.` }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: RELOCATE, mediaResolution: 'MEDIA_RESOLUTION_HIGH' },
    }, { signal, onNotice });
    const wanted = new Set([...dropped.map((d) => d.name), ...missing]);
    const found = mergeBoxes((G.parseJSON(G.textOf(ask)).found || []).filter((f) => wanted.has(f.name)));
    if (!Object.keys(found).length) return { ...profile, regions, verified: { kept, dropped, moved: [] } };
    // a box for an element the learn call never drew has to be agreed on by the check call, not just hold digits
    const second = await verifyRegions({ video, profile: { ...profile, regions: found }, signal, onNotice, again: false, strict: Object.keys(found).some((n) => missing.includes(n)) });
    const moved = Object.keys(second.regions).filter((name) => dropped.some((d) => d.name === name)).map((name) => ({ name, shows: dropped.find((d) => d.name === name).shows, from: dropped.find((d) => d.name === name).box, to: second.regions[name] }));
    const added = Object.keys(second.regions).filter((name) => missing.includes(name));
    return { ...profile, regions: { ...regions, ...second.regions }, verified: { kept, dropped: dropped.filter((d) => !second.regions[d.name]), moved, added } };
  }
  const mostCommonOf = (xs) => { const n = new Map(); for (const x of xs) n.set(x, (n.get(x) || 0) + 1); return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] || null; };

  /**
   * Which character the player plays, read on its own from three full-size frames: the HUD's portrait and ability
   * icons, and the character the camera follows. Returns the name, or '' when it can't tell.
   */
  const CHARACTER_READ = { type: 'object', properties: { character: str("the character's name as the game gives it, or empty if you can't tell") }, required: ['character'] };
  async function nameCharacter({ video, game, signal, onNotice }) {
    const shots = await V.grab(video, [0.2, 0.5, 0.8].map((k) => +(video.duration * k).toFixed(2)), { maxDim: 1280, quality: 0.85 });
    const resp = await G.generate({
      contents: [{ role: 'user', parts: [...shots.flatMap((f, i) => [{ text: `Moment ${i + 1}` }, { inlineData: { mimeType: f.mimeType, data: f.data } }]), { text: `These are three moments of one ${String(game || 'game').slice(0, 60)} recording from the player's own screen. Which character (agent, hero, legend, champion, or fighter) is the player playing? Look at their own portrait and ability icons on the HUD and at the character the camera follows, and give the game's own name for it; empty if you can't tell.` }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: CHARACTER_READ, mediaResolution: 'MEDIA_RESOLUTION_HIGH' },
    }, { signal, onNotice });
    return String(G.parseJSON(G.textOf(resp)).character || '').trim().slice(0, 40);
  }
  const sameCharacter = (a, b) => { const x = gameKey(a).replace(/ /g, ''), y = gameKey(b).replace(/ /g, ''); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

  /**
   * Learns the game from the recording: the learn call on SAMPLES frames, the check of its boxes, then the pixel layout.
   * Returns { profile, frames, raw }: frames are the pictures the learn call saw, for the app to draw the learned boxes on.
   * onPhase(what) is told as each step ends, for timing.
   */
  async function learnGame({ video, checks = Object.keys(CHECKS), signal, onNotice, onPhase = () => {} }) {
    const times = Array.from({ length: SAMPLES }, (_, k) => +((video.duration * (k + 0.5)) / SAMPLES).toFixed(2));
    const frames = await V.grab(video, times, { maxDim: 1024, quality: 0.8 });
    onPhase('frames grabbed');
    const parts = frames.flatMap((f, i) => [{ text: `Frame ${i + 1}, at ${C.mmss(f.t)}` }, { inlineData: { mimeType: f.mimeType, data: f.data } }]);
    const prompt = `These frames are spread over one recording of a game or match: usually the player's own screen, sometimes a broadcast or film of the whole match. Identify the game and describe what's on screen, so a coach can read the match from it.
view: own_screen or spectator, as defined. In spectator footage: sides, the two sides and how to tell their players apart, and unit, the game's unit of play. On the player's own screen: player_name and player_side, so their own kills, deaths, and points can be told from the other side's.
elements: every HUD or board element that shows the state of play, each with a tight box [ymin, xmin, ymax, xmax] scaled 0-1000 in the frame (frame, numbered from 1) where it's clearest. kill_feed: the list of recent kills, all its rows; ammo: the magazine count; health: the player's own health or shield bar, not an ability icon; damage: the counter of damage the player has dealt, if the game shows one, boxed on its own; kill_count: the counter of the player's own kills, or their kills, deaths, and assists (a K/D/A like 3/1/4), if the game shows one, boxed on its own; scoreboard: each side's score; abilities: the player's ability and ultimate icons with their charges or cooldowns, if the game has them; board: the board of a board game such as chess, never a playing field.
fov_h: the game's default horizontal field of view if you know it, else 0.
cues: up to 6 short facts about how key moments look on screen, such as a kill, a death, a round start, a capture.`;
    const resp = await G.generate({
      contents: [{ role: 'user', parts: [...parts, { text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema() },
    }, { signal, onNotice });
    const raw = G.parseJSON(G.textOf(resp));
    onPhase('learn call');
    // the character, read again on its own; kept only when both reads agree, since a wrong one brings the wrong kit and
    // its habits (League, Oct 22: Miss Fortune read as Samira, and the review coached Samira's Style ranks)
    if (String(raw?.character || '').trim()) {
      const again = await nameCharacter({ video, game: raw.game, signal, onNotice }).catch((e) => { if (e.name === 'AbortError') throw e; return null; });
      if (again !== null && !sameCharacter(raw.character, again)) { raw.characterUnsure = [raw.character, again || 'unknown']; raw.character = ''; }
    }
    // every box is checked against the screen before anything reads from it; what matters in the game is the coach's to
    // look up (agent.js research), when and as it chooses
    const checked = await verifyRegions({ video, profile: toProfile(raw, checks), signal, onNotice }).catch((e) => { if (e.name === 'AbortError') throw e; return toProfile(raw, checks); });
    onPhase('boxes checked');
    const profile = await learnLayout({ video, profile: checked, signal });
    onPhase('layout measured');
    return { profile, frames, raw };
  }

  const api = { learnGame, researchGame, researchQuestion, habitsFor, researchBrief, cleanResearch, learnLayout, verifyRegions, toProfile, mergeBoxes, hueHistogram, pixelHues, twoTeamRows, feedRows, feedColors, judgeBoxes, barShaped, cleanCharacter, nameHue, rgbHue, alignedRows, portraitShare, CHECKS, ELEMENTS, GENRES, AIM, AIM_TARGETS };
  root.ThirdeyeLearn = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
