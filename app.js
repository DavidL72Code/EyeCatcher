/* Thirdeye app: the start screen, the review screen, and past reviews. The coach (agent.js) does the reviewing; this
 * file opens the recording, makes and uploads the scan copy, draws everything the coach does onto the match timeline,
 * and puts its questions to the player. Everything a review draws is kept in its log, so a past review is the same
 * screen drawn again from that log, with the recording, frames, and report. */
(function () {
  const G = window.Gemini, C = window.ThirdeyeCore, V = window.ThirdeyeVideo, A = window.ThirdeyeAgent, L = window.ThirdeyeLearn, R = window.ThirdeyeReviews, K = window.ThirdeyeReport;
  // the desktop app (desktop/preload.cjs): it remembers where each recording is on disk, so nothing is copied
  const D = window.thirdeyeDesktop || null;
  G.preferEnv = true;
  // PLAYERS: the name the player picked as theirs, per game, so the next review of that game knows it
  const STORE = 'thirdeye.v1', UPLOADS = 'thirdeye.uploads', PLAYERS = 'thirdeye.players', LEARNED = 'thirdeye.learned';
  const BUDGET = { looks: 24, turns: 14 }; // two more turns since the coach chooses its research and its clip reads
  const FACET_NAMES = { guides: 'guides', community: 'Reddit and forums', meta: 'meta', wiki: 'wiki' }; // the research's searches
  const REGION_NAMES = { aim: 'aim area', killfeed: 'kill feed', minimap: 'minimap', scoreboard: 'scoreboard', health: 'health bar', ammo: 'ammo', damage: 'damage dealt', kill_count: 'kill count', board: 'board', player_clock: 'your clock', opponent_clock: 'their clock', gold: 'gold', abilities: 'abilities' };
  const PROGRESS = { better: 'better than before', same: 'about the same as before', worse: 'worse than before', unclear: "couldn't tell this match" };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const today = () => new Date().toLocaleDateString('en-CA');
  const niceDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const uid = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const vid = $('video'), timeline = $('timeline');
  let history = read(STORE, C.emptyHistory());
  let run = null;
  const files = new Map(); // review id -> its recording, for this visit
  const recent = new Map(); // review id -> its saved record, for this visit

  // ---------- telestrator underline ----------
  function penStroke(el) {
    if (!el || el.querySelector('svg.stroke')) return;
    el.insertAdjacentHTML('beforeend', '<svg class="stroke" viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" vector-effect="non-scaling-stroke" filter="url(#marker)" style="stroke-width:0.12em" d="M3 9.6C40 6 86 4.4 129 6.5c24 1.2 45 2.3 68-.8" /></svg>');
  }

  // ---------- status: one spinner, one line ----------
  let tick = null;
  function setStatus(text, mode = '', extra = '') {
    if (run?.replay) return;
    const s = $('status');
    s.hidden = false;
    s.className = `status ${mode}`;
    if ($('statusText').textContent !== text) { $('statusText').textContent = text; s.dataset.since = Date.now(); }
    s.dataset.extra = extra;
    paintSecs();
    clearInterval(tick);
    if (mode !== 'error') tick = setInterval(paintSecs, 1000);
    $('stopBtn').hidden = mode === 'error';
  }
  function paintSecs() {
    const s = $('status'), secs = Math.round((Date.now() - +s.dataset.since) / 1000);
    $('statusSecs').textContent = s.dataset.extra || (secs >= 5 ? `${secs} s` : '');
  }
  function stopStatus() { clearInterval(tick); $('status').hidden = true; }

  // ---------- screens ----------
  // tab: which of Home, Coach, and Past reviews the screen belongs to (a past review is under Past reviews)
  function show(id, tab = { home: 'home', start: 'coach', review: 'coach', reviews: 'reviews' }[id]) {
    for (const s of ['home', 'start', 'review', 'reviews']) $(s).hidden = s !== id;
    // the sidebar and the phone tab bar both mark where you are
    document.querySelectorAll('[data-tab]').forEach((a) => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  }

  // #coach is where a review starts, #reviews the list, #review/<id> one past review, anything else Home. A live
  // review isn't in the address until it's saved, so leaving it stops it (the header won't, while one runs).
  async function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (run && !run.done && !run.replay) run.abort.abort();
    if (h === 'reviews') return showReviews();
    if (h.startsWith('review/')) return openPast(h.slice(7));
    show(h === 'coach' ? 'start' : 'home');
    window.scrollTo(0, 0);
    renderStart();
  }
  window.addEventListener('hashchange', route);

  // ---------- start screen ----------

  function renderStart() {
    $('keyBox').hidden = G.hasKey();
    const h = history.habit;
    $('working').hidden = !h;
    if (h) {
      $('working').innerHTML = `<svg aria-hidden="true"><use href="#eye" /></svg><p>Working on <b>${esc(h.name)}</b> since ${niceDate(h.since)}. Your next review checks it.</p><button class="quiet" type="button" id="dropHabit">Stop</button>`;
      $('dropHabit').onclick = () => { history = C.dropHabit(history); write(STORE, history); renderStart(); };
    }
    // while a review runs, the header can't take you away from it
    document.body.classList.toggle('live', !!(run && !run.done && !run.replay));
    // the desktop app's Thirdeye folder, once the player chose to keep recordings there
    D?.library().then((where) => { $('libraryBtn').hidden = !where; $('libraryBtn').title = where || ''; }, () => {});
    renderRecent();
    $('historyCount').textContent = history.matches.length || '';
  }

  // The browser's own file picker, where there is one, gives a handle to the file, so a past review can open its
  // recording again after a reload. Elsewhere the plain file input is used.
  async function pickRecording(input) {
    try {
      const [handle] = await window.showOpenFilePicker({ id: 'recordings', types: [{ description: 'Match recordings', accept: { 'video/*': ['.mp4', '.mov', '.m4v', '.mkv', '.webm'] } }] });
      return { file: await handle.getFile(), handle };
    } catch (e) {
      if (e.name !== 'AbortError') { input.dataset.plain = '1'; input.click(); }
      return null;
    }
  }
  const withPicker = (input, use) => input.addEventListener('click', (e) => {
    if (!window.showOpenFilePicker || D || input.dataset.plain) return;
    e.preventDefault();
    pickRecording(input).then((p) => p && use(p.file, p.handle));
  });
  // a dropped file's handle has to be asked for while the drop event runs
  const droppedHandle = (e) => [...(e.dataTransfer?.items || [])].find((i) => i.kind === 'file')?.getAsFileSystemHandle?.() ?? null;
  function dropTarget(el, use) {
    ['dragenter', 'dragover'].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => el.addEventListener(ev, () => el.classList.remove('over')));
    el.addEventListener('drop', (e) => { e.preventDefault(); const handle = droppedHandle(e), f = e.dataTransfer?.files?.[0]; if (f) use(f, handle); });
  }

  dropTarget($('drop'), (f, handle) => start(f, { handle }));
  withPicker($('fileInput'), (f, handle) => start(f, { handle }));
  $('fileInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) start(f); });
  $('keyBox').addEventListener('submit', (e) => { e.preventDefault(); G.setKey($('keyInput').value); $('keyInput').value = ''; renderStart(); });
  $('sampleBtn').addEventListener('click', async () => {
    const blob = await (await fetch('tests/fixtures/match.mp4')).blob();
    start(new File([blob], 'synthetic-test-match.mp4', { type: 'video/mp4' }));
  });
  fetch('tests/fixtures/match.mp4', { method: 'HEAD' }).then((r) => { $('sampleBtn').hidden = !r.ok; }, () => {});

  // ---------- a review ----------
  // place: where the recording is on disk, when that's known already (a past review's recording, reviewed again)
  async function start(file, { handle = null, place = null } = {}) {
    if (!G.hasKey()) { show('start'); $('keyBox').hidden = false; $('keyInput').focus(); return; }
    if (location.hash !== '#coach') window.history.pushState(null, '', '#coach');
    show('review');
    run = { id: uid(), file, handle: null, game: null, player: null, workingOn: null, abort: new AbortController(), looks: 0, turns: 0, calls: 0, beat: null, log: [], t0: performance.now() };
    const mine = run;
    Promise.resolve(handle).then((h) => { if (h?.kind === 'file') mine.handle = h; }, () => {});
    mine.place = place ? Promise.resolve(place) : D ? D.remember(file).catch(() => null) : Promise.resolve(null);
    // and, with the player's yes, a copy in the Thirdeye folder, which becomes the review's recording once it's there
    mine.library = place || !D ? Promise.resolve(null) : mine.place.then((p) => p && D.keep(p.path)).catch(() => null);
    // a recording the desktop app can find again by its path isn't copied
    mine.kept = mine.place.then((p) => !p && R.keepRecording(file)).catch((e) => { console.warn("The recording couldn't be kept for past reviews.", e); return false; });
    resetReview();
    renderStart();
    setVideo(file);
    setStatus('Opening the recording');
    if (!run?.replay) stage('learn', '');
    try {
      run.video = await V.open(file);
      run.log.push(['mark', { what: 'opened', ms: Math.round(performance.now() - run.t0) }]);
      drawAxis();
      run.game = await learnGame(run.video, run.abort.signal);
      const game = run.game, seen = C.historyFor(history, game.name);
      // in footage of the whole match the player is one of many on screen, so they say which one, before anything is read
      run.player = game.view === 'spectator' ? await whoInFootage(game) : read(PLAYERS, {})[game.name.toLowerCase()] || null;
      run.workingOn = seen.habit;
      drawLegend(game);
      drawMeter();
      setStatus('Deciding where to look');
      const result = await A.review({
        // the scan copy is made and sent only if a scan needs it: a game whose kill feed reads never does
        video: run.video, file: (fresh) => { if (fresh) run.scanFile = null; return (run.scanFile ||= scanCopy(run.video, run.abort.signal, { fresh })); }, profile: game, history: seen, player: run.player || null, budget: C.createBudget(BUDGET), spent: run.learnCalls || 0,
        ask, confirm: checkIn, identify, onEvent: emit, onStep: step, signal: run.abort.signal,
        onNotice: (n) => setStatus(n, '', ''),
      });
      await finishReview(result);
    } catch (e) {
      if (mine !== run) return;
      run.done = true;
      renderStart();
      if (e.name === 'AbortError') return setStatus('Stopped. Pick the match again to restart.', 'error');
      console.error(e);
      setStatus(e.message || String(e), 'error');
    }
  }

  // What a review draws is kept in its log and drawn again from it later. Frames keep their picture and time, not
  // their canvas or the copy sent to the model.
  const slim = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'canvas' || k === 'data' || k === 'mimeType' ? undefined : v)));
  const shown = (frames) => frames.filter((_, i, all) => all.length <= 4 || i % Math.ceil(all.length / 4) === 0);
  function emit(e) {
    // each entry keeps when it happened, in ms from the recording being given, so a review's time can be told by step
    if (!run.replay) run.log.push(['event', { ...slim(e.type === 'frames' ? { ...e, frames: shown(e.frames) } : e), ms: Math.round(performance.now() - run.t0) }]);
    onEvent(e);
  }
  function step(s) {
    if (!run.replay && ['think', 'call', 'error'].includes(s.type)) run.log.push(['step', { ...slim({ type: s.type, name: s.name, args: s.args, error: s.error }), ms: Math.round(performance.now() - run.t0) }]);
    onStep(s);
  }

  // The game is learned from the recording (learn.js): one model call, kept for a day per recording like the scan copy.
  // The first breakdown card shows what was found, boxed on the frame it was read from.
  async function learnGame(video, signal) {
    const sig = `${video.name}|${video.size}|${video.file.lastModified}`;
    const cache = read(LEARNED, {});
    for (const [k, v] of Object.entries(cache)) if (!(v.expires > Date.now())) delete cache[k];
    setStatus('Reading the screen');
    nowStep('Reading the screen', null, 'Finding the HUD: kill feed, minimap, health, ammo');
    nowPhase('Flipping through the match');
    const stopFlip = flip(Array.from({ length: 8 }, (_, i) => (video.duration * (i + 0.5)) / 8));
    let profile = cache[sig]?.profile, frames = null;
    if (!profile) {
      const mark = (what) => run.log.push(['mark', { what, ms: Math.round(performance.now() - run.t0) }]);
      const r = await L.learnGame({ video, signal, onNotice: (n) => setStatus(n), onPhase: mark }).finally(stopFlip);
      profile = r.profile;
      frames = r.frames;
      run.learnCalls = r.calls || 1;
      cache[sig] = { profile, expires: Date.now() + 24 * 3600e3 };
      write(LEARNED, cache);
    }
    stopFlip();
    const [shot] = frames ? [frames[Math.floor(frames.length / 2)]] : await V.grab(video, [video.duration / 2], { maxDim: 1024, quality: 0.8 });
    emit({ type: 'learned', profile, shot, called: !!frames });
    return profile;
  }
  function drawLearned({ profile, shot, called }) {
    if (called) run.calls += run.learnCalls || 1;
    drawMeter();
    beatStart({ name: 'learn', why: `${profile.name}${profile.genre !== 'other' ? `, ${profile.genre}` : ''}` });
    const boxes = Object.entries(profile.regions).filter(([r]) => r !== 'aim').map(([r, [x, y, w, h]]) => `<span class="el" style="left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%"><span>${esc(REGION_NAMES[r] || r.replace(/_/g, ' '))}</span></span>`).join('');
    run.beat.querySelector('.beat-shots').innerHTML = `<figure class="screen-map"><img src="${shot.url}" data-ft="${shot.t}" alt="What the coach read on screen" />${boxes}</figure>`;
    holdOn(shot.t, `<div class="screen-map over">${boxes}</div>`);
    nowPhase(`Found ${Object.keys(profile.regions).filter((r) => r !== 'aim').length} things to read on screen`);
    const found = Object.keys(profile.regions).filter((r) => r !== 'aim').map((r) => REGION_NAMES[r] || r.replace(/_/g, ' '));
    beatOut(found.length ? `Found: ${found.join(', ')}` : 'Found no screen elements to read', 'muted');
    const left = profile.verified?.dropped || [];
    const said = (d) => (d.shows !== 'nothing' && d.shows !== 'other' ? ` (it showed ${(REGION_NAMES[d.shows] || d.shows).replace(/_/g, ' ')})` : '');
    const moved = profile.verified?.moved || [];
    if (moved.length) beatOut(`Found again, because the first box was somewhere else: ${moved.map((d) => `${REGION_NAMES[d.name] || d.name.replace(/_/g, ' ')}${said(d)}`).join(', ')}`, 'muted');
    if (left.length) beatOut(`Left out, because the box didn't show it: ${left.map((d) => `${REGION_NAMES[d.name] || d.name.replace(/_/g, ' ')}${said(d)}`).join(', ')}`, 'muted');
    if (profile.view === 'spectator') beatOut(`Footage of the whole match, read ${profile.unit || 'play'} by ${profile.unit || 'play'}${profile.sides?.length ? `: ${profile.sides.map((x) => `${x.name} (${x.look})`).join(' vs ')}` : ''}`, 'muted');
    if (profile.regions.killfeed) beatOut(profile.killfeedGrid && profile.killfeedColors ? 'Kill feed rows and team colors measured' : "Kill feed seen, with no colored rows to measure: it's read as plain text, line by line", 'muted');
    if (profile.research) drawResearch(profile.name, profile.research);
  }
  // only web links: a source address can't become a script
  const sourceLinks = (sources) => (sources || []).map((x) => (/^https:\/\//i.test(x.uri) ? `<a href="${esc(x.uri)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a>` : esc(x.title))).join(', ');
  // what matters in the game, and where that came from, on the card of the step that looked it up
  function drawResearch(game, r) {
    const kit = r.character ? `<p class="beat-out"><b>Playing ${esc(r.character.name)}:</b> ${r.character.abilities.map((a) => esc(a.name)).join(' · ')}</p>` : '';
    run.beat.querySelector('.beat-outs').insertAdjacentHTML('beforeend', `<div class="matters"><p class="beat-out"><b>What matters in ${esc(game)}:</b> ${r.priorities.slice(0, 4).map(esc).join(' · ')}</p>${kit}<p class="beat-out muted">${r.researched ? `From ${r.sources.length} source${r.sources.length === 1 ? '' : 's'}${r.facets ? ` (${Object.entries(r.facets).filter(([, n]) => n).map(([f, n]) => `${FACET_NAMES[f] || f} ${n}`).join(', ')})` : ''}: ${sourceLinks(r.sources)}` : "From the model's own knowledge: web search wasn't available"}</p></div>`);
  }

  // The scan copy is made and sent once per recording; Gemini keeps it for 48 hours, so a rerun within a day reuses it.
  // A copy is its uploader's, so it's kept per key (a fingerprint of the key, never the key); fresh: the cached one was
  // refused (another key's, or gone), make it again.
  const keyTag = () => { if (G.backendUrl()) return 'backend'; let h = 2166136261; for (const ch of G.getKey()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0).toString(36); };
  async function scanCopy(video, signal, { fresh = false } = {}) {
    const sig = `${video.name}|${video.size}|${video.file.lastModified}|${keyTag()}`;
    const cache = read(UPLOADS, {});
    for (const [k, v] of Object.entries(cache)) if (!(v.expires > Date.now())) delete cache[k];
    if (fresh) delete cache[sig];
    if (cache[sig]) return cache[sig].file;
    const pct = (p) => `${Math.round(p * 100)}%`;
    setStatus('Making the scan copy', '', '0%');
    nowStep('Making the scan copy', null, 'A small, silent copy of the whole match for the coach to scan');
    const blob = await V.makeProxy(video, { signal, onProgress: (p) => { setStatus('Making the scan copy', '', pct(p)); sweepTo(p * video.duration); nowPhase(`Copying ${pct(p)}`); } });
    nowPhase('Sending it to the coach');
    setStatus('Sending the scan copy', '', '0%');
    const file = await V.upload(blob, { name: video.name.slice(0, 80), signal, onProgress: (p) => setStatus('Sending the scan copy', '', pct(p)) });
    cache[sig] = { file, expires: Date.now() + 24 * 3600e3 };
    write(UPLOADS, cache);
    return file;
  }

  // Where the review is, in the order a review goes: what it has done lit, what it is doing marked, each with a short note
  const STAGES = ['learn', 'record', 'look', 'check', 'verdict'];
  function stage(name, note) {
    const at = STAGES.indexOf(name), list = $('stages');
    if (at < 0) return;
    list.hidden = false;
    list.querySelectorAll('li').forEach((li) => {
      const k = STAGES.indexOf(li.dataset.s);
      li.classList.toggle('done', k < at);
      li.classList.toggle('cur', k === at);
      if (k === at && note != null) li.querySelector('span').textContent = note;
    });
  }
  const stageNote = (name, note) => { const li = $('stages').querySelector(`[data-s="${name}"] span`); if (li) li.textContent = note; };

  function resetReview() {
    ['track', 'axis', 'beats', 'board', 'verdict', 'question', 'checkin', 'crumbs', 'reattach'].forEach((id) => { $(id).innerHTML = ''; });
    stopCritique();
    ['breakdown', 'board', 'verdict', 'question', 'checkin', 'meter', 'log', 'crumbs', 'reattach', 'critique', 'caption'].forEach((id) => { $(id).hidden = true; });
    $('stages').querySelectorAll('li').forEach((li) => { li.className = ''; li.querySelector('span').textContent = ''; });
    $('stages').hidden = true;
    $('finalBoard').innerHTML = '';
    $('board').after($('breakdown')); // a finished review moves it into the log
    timeline.querySelectorAll('.pin').forEach((p) => p.remove());
    $('review').classList.remove('done', 'bare');
    $('stage').hidden = false;
    $('eyeMark').hidden = true;
    hideVideoMarks();
    stopFast();
    nowState = null;
    queue = [];
    playing = false;
    $('now').hidden = true;
    $('followBtn').hidden = true;
    $('player').classList.remove('holding');
    stopStatus();
  }

  function setVideo(file) { setVideoUrl(URL.createObjectURL(file)); run.file = file; }
  // The player can still be reading the old recording's address for a moment after it switches; freeing it then
  // makes that read fail, so it's freed a second later.
  const releaseLater = (url) => { if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 1000); };
  function setVideoUrl(url) {
    const old = vid.src;
    vid.src = url;
    releaseLater(old);
    run.file = null;
    $('reattach').hidden = true;
  }

  function drawLegend(game) {
    $('legend').innerHTML = game?.genre === 'chess' ? '<li class="k-death">Your blunder</li><li class="k-ally">Your mistake</li><li class="k-look">Looked at</li>' : '<li class="k-kill">Your kill</li><li class="k-death">Your death</li><li class="k-ally">Teammate died</li><li class="k-fight">Fight</li><li class="k-look">Looked at</li>';
  }

  const LINES = {
    scan: (a) => `Reading the match ${a.from}–${a.to}`,
    research: (a) => (a.question ? `Looking up: ${String(a.question).slice(0, 80)}` : 'Looking up what matters in this game'),
    read_clips: (a) => `Watching ${plural(Array.isArray(a.windows) ? a.windows.length : 1, 'clip')} as video`,
    frames: (a) => `${a.as === 'clip' ? 'Watching the run-up to' : 'Looking at'} ${a.at}${a.region && a.region !== 'full' ? `, ${REGION_NAMES[a.region] || a.region}` : ''}`,
    measure_aim: (a) => `Measuring aim at ${a.at}${a.more?.length ? ` and ${a.more.length} more` : ''}`,
    ask_player: () => 'Waiting for you',
    finish: () => 'Checking the finding',
  };
  function onStep(s) {
    if (s.type === 'think') { run.turns++; run.calls++; drawMeter(); setStatus(run.turns === 1 ? 'Deciding where to look' : 'Deciding what to check next'); nowPhase(run.turns === 1 ? 'Deciding where to look' : 'Thinking about what it saw'); }
    if (s.type === 'call') { setStatus(LINES[s.name]?.(s.args) || s.name, s.name === 'ask_player' ? 'waiting' : ''); followCall(s.name, s.args || {}); }
    if (s.type === 'error') beatOut(`Didn't work: ${short(s.error)}`, 'warn');
  }

  function onEvent(e) {
    if (e.type === 'learned') { drawLearned(e); stage('record', ''); }
    if (e.type === 'scan') { const n = (k) => (e.events || []).filter((x) => x.kind === k && (x.to ?? x.t) >= e.from - 1 && x.t <= e.to + 1).length; stageNote('record', e.counts?.units != null ? `${e.counts.units} ${e.counts.unit || 'play'}s` : [n('death') && `${n('death')} death${n('death') === 1 ? '' : 's'}`, n('near_death') && `${n('near_death')} near-death${n('near_death') === 1 ? '' : 's'}`, n('point_lost') && `${n('point_lost')} against`, n('kill') && `${n('kill')} kill${n('kill') === 1 ? '' : 's'}`].filter(Boolean).join(' · ') || 'read'); }
    if (e.type === 'step' && ['frames', 'measure_aim', 'read_clips', 'read_hud', 'ask_player'].includes(e.name)) stage('look');
    if ((e.type === 'look' || e.type === 'clips') && run.looks) stageNote('look', `${run.looks} look${run.looks === 1 ? '' : 's'}`);
    if (e.type === 'step' && e.name === 'finish') stage('check', 'against the record and the video');
    if (e.type === 'rejected') stageNote('check', 'sent back, looking again');
    if (e.type === 'scanning' && e.progress != null) setStatus(`Reading the match ${C.mmss(e.from)}–${C.mmss(e.to)}`, '', `${Math.round(e.progress * 100)}%`);
    if (e.type === 'step') { beatStart(e); if (e.why) nowWhy(e.why); }
    if (e.type === 'scanning') { if (e.progress != null) sweepTo(e.from + e.progress * (e.to - e.from)); else fastForward(e.from, e.to); }
    if (e.type === 'scan') { stopFast(); nowPhase(scanLine(e.counts)); run.events = e.events; drawEvents(e.events); addMark('scanned', e.from, e.to); run.calls += e.calls; drawMeter(); beatOut(scanLine(e.counts)); }
    // a clip window is read in the scan, not a look the coach chose: it's marked, not counted
    if (e.type === 'look' && e.kind === 'clip') addMark('look clip', e.from, e.to);
    else if (e.type === 'look') { run.looks++; addMark(e.kind === 'measure' ? 'look measure' : 'look', e.from, e.to); moveEye((e.from + e.to) / 2); drawMeter(); }
    if (e.type === 'clips') { if (e.events) { run.events = e.events; drawEvents(e.events); } run.calls += e.calls; drawMeter(); beatOut(`Watched ${plural(e.windows.length, 'clip')}: ${e.seconds} s at 8 frames a second, in ${plural(e.calls, 'call')}`); for (const w of e.windows) if (w.reading?.story || w.reading?.outcome_why) beatOut(`${C.mmss(w.from)}–${C.mmss(w.to)}: ${w.reading.story || `${w.reading.outcome}, ${w.reading.outcome_why}`}`, 'muted'); }
    if (e.type === 'research') { if (e.research) drawResearch(run.game?.name || 'this game', e.research); else { beatOut(short(e.answer || 'Nothing came back')); beatOut(e.researched ? `From ${sourceLinks(e.sources) || 'the web'}` : "From the model's own knowledge: no web search worked", 'muted'); } }
    if (e.type === 'aim_call') { run.calls++; drawMeter(); }
    if (e.type === 'closing') { run.calls += e.calls || 0; drawMeter(); }
    if (e.type === 'frames_checked') {
      run.calls += e.calls || 0; drawMeter();
      const off = (e.checked || []).filter((x) => x.verdict !== 'shows');
      const fact = (x) => x.facts?.find((f) => f.verdict !== 'shows');
      beatOut(e.unreliable ? `Checked against the video, one agent per claim: they also agreed with a claim the record shows is false, so the check doesn't count` : off.length ? `Checked against the video, one agent per claim: ${off.map((x) => `${C.mmss(x.t)} ${x.verdict === 'goes_against' ? "doesn't fit" : "isn't shown"}${fact(x) ? ` (${fact(x).fact}: ${fact(x).saw})` : ''}`).join('; ')}` : `Checked against the video, one agent per claim: every fact in every moment shows${e.controls ? `, and they caught the ${e.controls === 1 ? 'false claim' : `${e.controls} false claims`} planted among them` : ''}`, e.unreliable || off.length ? 'warn' : 'muted');
    }
    if (e.type === 'claims_checked') { run.calls++; drawMeter(); beatOut(e.contradicted.length ? `Checked against the kill feed and the clips: ${e.contradicted.map((x) => `${C.mmss(x.t)} doesn't fit (${x.fact})`).join('; ')}` : 'Checked against the kill feed and the clips: every moment fits', e.contradicted.length ? 'warn' : 'muted'); }
    if (e.type === 'hud') { run.calls++; drawMeter(); beatShots(e.shots, e.values[0]?.t ?? 0); beatOut(e.values.map((v) => `${C.mmss(v.t, true)} ${v.value ?? '(unreadable)'}`).join(' · ')); }
    if (e.type === 'frames' && e.clip) { beatShots(shown(e.frames), e.t, null, e.clip); nowPhase(`Sending ${C.mmss(e.clip.from, true)}–${C.mmss(e.clip.to, true)} to the coach as video, ${e.clip.fps} frames a second`, shown(e.frames)); }
    else if (e.type === 'frames') { beatShots(shown(e.frames), e.t); nowPhase(`Sending ${e.frames.length} frames around ${C.mmss(e.t, true)} to the coach`, shown(e.frames)); }
    if (e.type === 'measure') { beatShots([e.shot], e.t, e); showMeasure(e); }
    if (e.type === 'shots') (run.shotsAt ||= []).push({ t: e.t, fired: e.fired });
    if (e.type === 'shots' && e.fired != null) beatOut(`${C.mmss(e.t, true)}: ${e.fired ? 'fired (ammo counter moved)' : 'no shots (ammo counter never moved)'}`, 'muted');
    if (e.type === 'refused') beatOut(`${C.mmss(e.t, true)} not measured: this fight was tried twice`, 'muted');
    if (e.type === 'skipped') beatOut(`${C.mmss(e.t, true)} skipped: you were dead (${C.mmss(e.death)})`, 'muted');
    if (e.type === 'answered') beatOut(e.answer ? `You said: ${e.answer}` : 'You skipped it', 'muted');
    if (e.type === 'note') { drawBoard($('board'), e.board, true); beatTake(e.theory, e.change); }
    if (e.type === 'rejected') { setStatus('Finding sent back'); beatOut(`Sent back: ${short(e.problems[0])}`, 'warn'); }
    if (e.type === 'accepted') beatOut('Passed the evidence checks', 'muted');
    if (e.type === 'checked') beatOut(e.agreed ? 'You agreed: this is it' : `You said: ${e.said || 'not really'}. It looks again.`, e.agreed ? 'muted' : 'warn');
    if (e.type === 'decide') beatOut('Sent back twice for the same reason: it has to decide now', 'warn');
    if (e.type === 'forced') { setStatus('Ending without a habit'); beatOut(`Couldn't back ${e.habit}: no habit named`, 'warn'); }
    if (e.type === 'few_losses') { setStatus('Ending: nothing was lost'); beatOut('Nothing was lost in this match: no death, near-death, or lost fight to explain', 'warn'); }
  }

  // ---------- following the coach: the video shows what it's looking at, as it looks ----------
  // While a review runs, the player goes where the coach goes. It flips through the match while the screen is read,
  // sweeps along while the match is copied and scanned, plays the run-up to each moment the coach checks, then holds on
  // that frame while it thinks. The caption says which step this is and what's happening. Touching the player hands it
  // back; the chip picks the coach up again.
  const RUN_UP = 6; // seconds of run-up played into each moment
  const following = () => !!run && !run.replay && !run.done && !run.handsOn && hasVideo();
  let nowState = null, queue = [], playing = false;
  function nowStep(kind, at, why = '') { nowState = { n: (nowState?.n || 0) + 1, kind, at, why, phase: '', frames: [] }; paintNow(); }
  function nowWhy(why) { if (nowState) { nowState.why = why; paintNow(); } }
  function nowPhase(phase, frames) { if (!nowState) return; nowState.phase = phase; if (frames) nowState.frames = frames; paintNow(); }
  function paintNow() {
    const el = $('now');
    el.hidden = !nowState || !run || run.replay || run.done;
    if (el.hidden) return;
    const s = nowState;
    el.innerHTML = `<span class="now-n">${String(s.n).padStart(2, '0')}</span><div class="now-text"><p class="now-kind">${esc(s.kind)}${s.at != null ? ` <span>${C.mmss(s.at, true)}</span>` : ''}</p>${s.why ? `<p class="now-why">${esc(s.why)}</p>` : ''}${s.phase ? `<p class="now-phase"><i></i>${esc(s.phase)}</p>` : ''}</div>${s.frames.length ? `<div class="now-frames">${s.frames.slice(0, 5).map((f) => `<img src="${f.url}" alt="" />`).join('')}</div>` : ''}`;
  }
  // a tool call: what it looks at, played as it starts
  function followCall(name, a) {
    const times = [a.at, ...(Array.isArray(a.more) ? a.more : [])].map(C.parseTime).filter(Number.isFinite);
    if (name === 'scan') nowStep('Reading the match', null);
    else if (name === 'research') nowStep('Looking up the game', null, a.question ? String(a.question).slice(0, 120) : 'Guides, the community, the meta, and the wiki');
    else if (name === 'read_clips') nowStep('Watching clips', null, 'About 10 s around each moment, at 8 frames a second');
    else if (name === 'frames' || name === 'measure_aim' || name === 'read_hud') {
      // a new step cuts straight to its moment: the video stays with what the caption says. A clip look plays exactly
      // the stretch the coach watches (C.clipPlan, as agent.js cuts it); the rest play the RUN_UP seconds into each moment
      const clip = name === 'frames' && a.as === 'clip';
      nowStep(clip ? 'Watching the run-up' : KIND[name], times[0]);
      queue = times.map((t) => (clip ? { ...C.clipPlan({ t, before: a.before, after: a.after, fps: a.fps, duration: run.video.duration }), clip } : { t, from: Math.max(0, t - RUN_UP), to: t }));
      runUp();
    } else if (name === 'finish') nowStep('Checking the finding', null, 'Code checks every moment it cites');
    else if (name === 'ask_player') nowStep('A question for you', times[0] ?? null);
  }
  // the run-up into the next queued moment, then a hold on its frame
  function runUp() {
    const next = queue.shift();
    if (next == null || !following()) { playing = false; return; }
    const { t, from, to, clip } = next;
    playing = true;
    vid.muted = true; // following plays on its own, and a muted video always may
    stopFast();
    hideVideoMarks();
    $('player').classList.remove('holding');
    if (nowState) { nowState.at = t; nowPhase(clip ? `Watching ${C.mmss(from, true)}–${C.mmss(to, true)}, the stretch the coach watches` : `Watching the run-up to ${C.mmss(t, true)}`); }
    playClip(from, to, () => {
      vid.currentTime = t;
      $('player').classList.add('holding');
      if (queue.length) setTimeout(runUp, 700);
      else playing = false;
    });
  }
  // the frame a step is about, held, with something drawn over it (the learned screen, a measured aim)
  function holdOn(t, overlay) {
    if (!following()) return;
    stopFast();
    clipEnd = clipThen = null;
    vid.pause();
    vid.currentTime = t;
    $('player').classList.add('holding');
    if (overlay) { markedAt = t; const v = $('vmarks'); v.innerHTML = overlay; v.hidden = false; placeVideoMarks(); }
  }
  function showMeasure(e) {
    if (!e.found || !e.measure?.box || !run.game?.regions?.aim) return nowPhase(`${C.mmss(e.t, true)}: no enemy close enough to measure`);
    const k = { aspect: run.video.width / run.video.height, ...K.aimMarks(e.measure, run.game, { w: run.video.width, h: run.video.height }) };
    nowPhase(`${k.note} at ${C.mmss(e.t, true)}`);
    if (!playing) holdOn(e.t, marksHtml(k));
  }
  // flipping through a few frames while the screen is read
  function flip(times) {
    let i = 0;
    const step = () => { if (following()) { vid.pause(); vid.currentTime = times[i++ % times.length]; } };
    step();
    const timer = setInterval(step, 700);
    return () => clearInterval(timer);
  }
  // a sweep that follows real progress; throttled, since every seek decodes a frame
  let lastSweep = 0;
  function sweepTo(t) {
    if (!following() || Date.now() - lastSweep < 350) return;
    lastSweep = Date.now();
    vid.pause();
    vid.currentTime = Math.max(0, Math.min(t, run.video.duration));
  }
  // with no progress to follow, a fast play through the stretch, looping, until the scan answers
  let fast = null;
  function fastForward(from, to) {
    if (!following() || fast) return;
    fast = { from, to };
    $('player').classList.remove('holding');
    hideVideoMarks();
    vid.muted = true;
    vid.currentTime = from;
    vid.playbackRate = 16;
    vid.play().catch(() => {});
  }
  function stopFast() { if (!fast) return; fast = null; vid.playbackRate = 1; vid.pause(); }
  vid.addEventListener('timeupdate', () => { if (fast && vid.currentTime >= fast.to - 0.5) vid.currentTime = fast.from; });
  // the player takes over when they touch the video or the timeline
  const handsOn = () => { if (!run || run.replay || run.done || run.handsOn) return; run.handsOn = true; queue = []; playing = false; stopFast(); vid.muted = false; $('player').classList.remove('holding'); $('followBtn').hidden = false; };
  vid.addEventListener('pointerdown', handsOn);
  timeline.addEventListener('pointerdown', handsOn);
  $('followBtn').addEventListener('click', () => { if (!run) return; run.handsOn = false; $('followBtn').hidden = true; if (nowState?.at != null) holdOn(nowState.at); });

  // ---------- the breakdown: one card per step, as it happens ----------
  // A card says what the coach checks (its own words), what it saw (frames, a measured box), and what it made of it. The
  // coach writes its take on a look with its next step, so theory changes land on the card before the new one.
  const KIND = { learn: 'Reading the screen', scan: 'The match record', research: 'Research', read_clips: 'Watching clips', frames: 'Close look', measure_aim: 'Aim check', read_hud: 'Reading the screen', ask_player: 'Question', finish: 'Finding' };
  const short = (text) => { const first = String(text).split(/(?<=\.)\s/)[0]; return first.length > 110 ? `${first.slice(0, 107)}…` : first; };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const scanLine = (c) => (c.units != null ? `${plural(c.units, c.unit)} listed, ${c.the_pass_thought_lost} of them maybe lost` : c.your_moves != null ? `${plural(c.your_moves, 'move')}: ${plural(c.your_blunders, 'blunder')}, ${plural(c.your_mistakes, 'mistake')}` : `${c.fights ? `${plural(c.fights, 'fight')} (${c.fights_won} won, ${c.fights_lost} lost, ${c.fights_no_one_fell} no one fell); ` : ''}${plural(c.your_kills, 'kill')}, ${plural(c.your_deaths, 'death')}, ${c.teammate_deaths} teammate${c.teammate_deaths === 1 ? '' : 's'} down`);
  function beatStart({ name, why }) {
    $('breakdown').hidden = false;
    const li = document.createElement('li');
    li.className = `beat ${name}`;
    li.innerHTML = `<p class="beat-kind">${KIND[name] || esc(name)}</p>${why ? `<p class="beat-why">${esc(why)}</p>` : ''}<div class="beat-shots"></div><div class="beat-outs"></div><ul class="beat-take"></ul>`;
    $('beats').prepend(li);
    run.beat = li;
    li.times = [];
  }
  // clip: a look the coach watched as video, shown as that very clip while it's in memory (its stills once it's gone)
  function beatShots(frames, t, measure, clip) {
    const box = run.beat?.querySelector('.beat-shots');
    if (!box) return;
    const m = measure?.measure, b = m?.box;
    run.beat.times.push(t);
    const group = document.createElement('figure');
    group.className = measure ? 'shot-group aim' : 'shot-group';
    if (clip?.blob instanceof Blob) {
      group.classList.add('watched');
      group.innerHTML = `<button class="t-btn at" type="button" data-t="${t}">${C.mmss(t, true)}</button><video src="${URL.createObjectURL(clip.blob)}" muted loop autoplay playsinline aria-label="The clip the coach watched, ${C.mmss(clip.from, true)} to ${C.mmss(clip.to, true)}"></video><figcaption>${C.mmss(clip.from, true)}–${C.mmss(clip.to, true)} as the coach saw it</figcaption>`;
      return box.append(group);
    }
    group.innerHTML = `<button class="t-btn at" type="button" data-t="${t}">${C.mmss(t, true)}</button><div class="shots">${frames.map((f) => `<div class="shot"><img src="${f.url}" data-ft="${f.t}" alt="Frame at ${C.mmss(f.t, true)}" />${b ? `<span class="box" style="top:${b[0] / 10}%;left:${b[1] / 10}%;height:${(b[2] - b[0]) / 10}%;width:${(b[3] - b[1]) / 10}%"></span>` : ''}</div>`).join('')}</div>${measure ? `<figcaption>${m ? `${Math.abs(m.heads).toFixed(1)} heads ${m.heads >= 0.75 ? 'low' : m.heads <= -0.75 ? 'high' : 'on the head'}` : 'no enemy in view'}</figcaption>` : ''}`;
    box.append(group);
  }
  function beatOut(text, cls = '') {
    const box = run.beat?.querySelector('.beat-outs');
    if (box) box.insertAdjacentHTML('beforeend', `<p class="beat-out ${cls}">${esc(text)}</p>`);
  }
  function beatTake(theory, change) {
    const box = run.beat?.querySelector('.beat-take');
    if (!box || !theory) return;
    const said = change === 'new' ? 'New theory' : change === 'updated' ? 'More for' : { supported: 'Backed up', dropped: 'Dropped', testing: 'Testing again' }[change] || change;
    // what the coach wrote about the moments on this card
    const seen = theory.evidence.filter((e) => e.what && run.beat.times.some((x) => Math.abs(x - e.t) <= 1.5)).slice(-2);
    box.insertAdjacentHTML('beforeend', `<li class="${theory.status}"><span class="said">${esc(said)}</span> ${esc(theory.theory)}${seen.map((e) => `<span class="saw"><button class="t-btn" type="button" data-t="${e.t}">${C.mmss(e.t)}</button> ${esc(e.what)}</span>`).join('')}</li>`);
  }

  // ---------- timeline ----------
  const pct = (t) => `${(Math.max(0, Math.min(t, run.video.duration)) / run.video.duration) * 100}%`;
  function drawAxis() {
    const d = run.video.duration;
    $('axis').innerHTML = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span style="left:${f * 100}%">${C.mmss(d * f)}</span>`).join('');
    $('timeline').setAttribute('aria-valuemax', Math.round(d));
  }
  function addMark(cls, from, to) {
    const el = document.createElement('div');
    el.className = cls;
    el.style.left = pct(from);
    if (!/measure/.test(cls)) el.style.width = `calc(${pct(to)} - ${pct(from)})`;
    $('track').append(el);
  }
  function drawEvents(events) {
    const track = $('track');
    track.querySelectorAll('.tick, .round, .fight').forEach((n) => n.remove());
    // fights as bands along the bottom, by how they ended
    for (const f of events.filter((x) => x.kind === 'engagement' || x.kind === 'play')) {
      const el = document.createElement('div');
      el.className = `fight ${f.outcome}`;
      el.style.left = pct(f.from);
      el.style.width = `calc(${pct(f.to)} - ${pct(f.from)})`;
      el.title = `${C.mmss(f.from)}–${C.mmss(f.to)} ${f.kind === 'play' ? f.unit : 'fight'}: ${f.text}`;
      track.append(el);
    }
    const starts = events.filter((e) => e.kind === 'round_start').map((e) => e.t);
    const rounds = document.createDocumentFragment();
    starts.forEach((t, i) => {
      const el = document.createElement('div');
      el.className = 'round';
      el.style.left = pct(t);
      el.style.width = `calc(${pct(starts[i + 1] ?? run.video.duration)} - ${pct(t)})`;
      el.innerHTML = `<span>R${i + 1}</span>`;
      rounds.append(el);
    });
    track.prepend(rounds);
    // chess: the player's blunders mark like deaths, their mistakes like a teammate's
    const tickOf = (e) => (e.kind === 'move' ? { blunder: 'death', mistake: 'ally' }[e.grade] : { kill: 'kill', death: 'death', ally_death: 'ally' }[e.kind]);
    for (const e of events.filter(tickOf)) {
      const el = document.createElement('div');
      el.className = `tick ${tickOf(e)}`;
      el.style.left = pct(e.t);
      el.title = `${C.mmss(e.t)} ${e.text || e.kind}`;
      track.append(el);
    }
  }
  function moveEye(t) { const m = $('eyeMark'); m.hidden = false; m.style.left = pct(t); }
  function drawMeter() {
    if (run.replay) return;
    $('meter').hidden = false;
    $('meterTicks').innerHTML = Array.from({ length: BUDGET.looks }, (_, i) => `<i class="${i < run.looks ? 'on' : ''}"></i>`).join('');
    $('meterText').textContent = `${run.looks} look${run.looks === 1 ? '' : 's'} · ${run.calls} call${run.calls === 1 ? '' : 's'}`;
  }

  function paintPlayhead() {
    if (!run?.video?.duration) return;
    $('playhead').style.left = pct(vid.currentTime);
    timeline.setAttribute('aria-valuenow', Math.round(vid.currentTime));
    timeline.setAttribute('aria-valuetext', C.mmss(vid.currentTime));
  }
  vid.addEventListener('timeupdate', paintPlayhead);
  vid.addEventListener('play', function loop() { paintPlayhead(); if (!vid.paused) requestAnimationFrame(loop); });
  const hasVideo = () => !!vid.getAttribute('src');
  function seekFromPointer(e) {
    const r = timeline.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * run.video.duration);
  }
  timeline.addEventListener('pointerdown', (e) => {
    if (!run?.video?.duration || e.target.closest('.pin')) return;
    timeline.setPointerCapture(e.pointerId);
    seekFromPointer(e);
    timeline.onpointermove = seekFromPointer;
  });
  timeline.addEventListener('pointerup', () => { timeline.onpointermove = null; });
  timeline.addEventListener('keydown', (e) => {
    if (!run?.video?.duration) return;
    const step = { ArrowLeft: -5, ArrowRight: 5, PageDown: -30, PageUp: 30 }[e.key];
    if (step) { e.preventDefault(); seek(vid.currentTime + step); }
  });
  function seek(t) {
    if (!hasVideo()) return nudge();
    vid.currentTime = Math.max(0, Math.min(t, run.video.duration));
    paintPlayhead();
  }
  let clipEnd = null, clipThen = null;
  function playClip(from, to, then = null) {
    if (!hasVideo()) return nudge();
    clipEnd = to;
    clipThen = then;
    seek(from);
    vid.play().catch(() => {});
  }
  vid.addEventListener('timeupdate', () => {
    if (clipEnd == null || vid.currentTime < clipEnd) return;
    vid.pause();
    const then = clipThen;
    clipEnd = clipThen = null;
    then?.();
  });
  vid.addEventListener('seeking', () => { if (clipEnd != null && Math.abs(vid.currentTime - clipEnd) > 6) clipEnd = clipThen = null; });
  // a past review without its recording: point at where to load it
  function nudge() {
    const r = $('reattach');
    if (r.hidden) return;
    r.classList.remove('nudge');
    void r.offsetWidth;
    r.classList.add('nudge');
    $('stage').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---------- rail ----------
  function timesHtml(evidence) {
    return evidence.map((e) => `<button class="t-btn" type="button" data-t="${e.t}" title="${esc(e.what)}">${C.mmss(e.t)}</button>`).join('');
  }
  function drawBoard(el, board, live) {
    el.hidden = !board.length;
    el.innerHTML = `<h3>${live ? 'Theories' : 'Every theory it tested'}</h3><ol>${board.map((x) => `<li class="theory ${x.status}"><span class="st">${x.status}</span><span class="what">${esc(x.theory)}</span>${x.evidence.length ? `<span class="times">${timesHtml(x.evidence)}</span>` : ''}</li>`).join('')}</ol>`;
  }
  // A frame in the log shows that exact moment in the player, or opens large when the recording isn't loaded.
  document.addEventListener('click', (e) => {
    const img = e.target.closest('.beat img[data-ft]');
    if (img && run) {
      const t = +img.dataset.ft;
      if (!hasVideo()) {
        $('lightboxImg').src = img.src;
        $('lightboxCap').textContent = C.mmss(t, true);
        return $('lightbox').showModal();
      }
      clipEnd = null;
      vid.pause();
      seek(t);
      return $('stage').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    const to = e.target.closest('[data-scroll]');
    if (to) return $(to.dataset.scroll).scrollIntoView({ behavior: 'smooth', block: 'start' });
    const key = e.target.closest('[data-key]');
    if (key && run?.keys) return watchKey(+key.dataset.key);
    const stepLink = e.target.closest('[data-step]');
    if (stepLink) return showStep(+stepLink.dataset.step);
    const b = e.target.closest('[data-t]');
    if (b && run?.video) { const t = +b.dataset.t; playClip(t - 2, t + 1.5); }
  });
  $('lightbox').addEventListener('click', () => $('lightbox').close());

  function ask({ question, t, options }) {
    return new Promise((resolve) => {
      const q = $('question');
      q.hidden = false;
      q.innerHTML = `${t != null ? `<button class="at t-btn" type="button" data-t="${t}">${C.mmss(t)}</button>` : ''}<p>${esc(question)}</p>
        <div class="opts">${options.map((o, i) => `<button type="button" data-i="${i}">${esc(o)}</button>`).join('')}<button class="quiet" type="button" data-skip>Skip</button></div>
        <form><input maxlength="300" placeholder="Or type your answer" aria-label="Your answer" /><button class="pill" type="submit">Send</button></form>`;
      if (t != null) playClip(t - 2.5, t + 1.5);
      const done = (answer) => {
        if (q.hidden) return;
        q.hidden = true;
        q.innerHTML = '';
        emit({ type: 'answered', answer });
        resolve(answer);
      };
      q.querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => done(options[+b.dataset.i]); });
      q.querySelector('[data-skip]').onclick = () => done('');
      q.querySelector('form').onsubmit = (e) => { e.preventDefault(); const v = e.target.querySelector('input').value.trim(); if (v) done(v); };
      run.abort.signal.addEventListener('abort', () => done(''), { once: true });
      q.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  // Before a finding is final the player checks it: the habit, why, and the moments that show it, played. Yes ends the
  // review; anything else goes back to the coach for one more look.
  function checkIn({ habit, why, evidence }) {
    return new Promise((resolve) => {
      const c = $('checkin');
      setStatus('Waiting for you', 'waiting');
      c.hidden = false;
      c.innerHTML = `<p class="label">Before it's final</p><h3>${esc(habit)}</h3>${why ? `<p class="ci-why">${esc(why)}</p>` : ''}
        <div class="ci-moments">${evidence.map((e, i) => `<button class="ci-m" type="button" data-t="${e.t}"><span class="ci-shot" data-ci="${i}"></span><span class="tt">${C.mmss(e.t)}</span></button>`).join('')}</div>
        <p class="ci-q">Is this what's costing you?</p>
        <div class="ci-opts"><button class="pill primary" type="button" data-yes>Yes, that's it</button><button class="pill" type="button" data-no>Not really</button></div>
        <form><input maxlength="300" placeholder="Or say what it is instead" aria-label="What it is instead" /><button class="pill" type="submit">Send</button></form>`;
      V.grab(run.video, evidence.map((e) => e.t), { maxDim: 320, quality: 0.7 }).then((shots) => shots.forEach((s, i) => { const el = c.querySelector(`[data-ci="${i}"]`); if (el) el.style.backgroundImage = `url(${s.url})`; }), () => {});
      if (evidence[0]) playClip(evidence[0].t - 2.5, evidence[0].t + 1);
      const done = (agree, said) => {
        if (c.hidden) return;
        c.hidden = true;
        c.innerHTML = '';
        setStatus(agree ? 'Writing up the finding' : 'Looking again');
        resolve({ agree, said });
      };
      c.querySelector('[data-yes]').onclick = () => done(true, "Yes, that's it");
      c.querySelector('[data-no]').onclick = () => done(false, 'Not really');
      c.querySelector('form').onsubmit = (e) => { e.preventDefault(); const v = e.target.querySelector('input').value.trim(); if (v) done(false, v); };
      run.abort.signal.addEventListener('abort', () => done(true, ''), { once: true });
      c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  // When the kill feed can't tell which name is the player, they pick it (or type it) while the video plays a moment
  // where it shows; the answer is kept for this game.
  async function identify({ names, t, question = 'Which name in the kill feed is you?' }) {
    const name = String((await ask({ question, t, options: names })) || '').trim().slice(0, 40);
    if (name && run.game) write(PLAYERS, { ...read(PLAYERS, {}), [run.game.name.toLowerCase()]: name });
    return name || null;
  }

  // In footage of the whole match (a broadcast, coaching film) code can't tell which player they are: they pick their
  // side, then say which one they are in their own words. Kept per game, and offered first next time.
  async function whoInFootage(game) {
    const key = `${game.name.toLowerCase()}|spectator`, last = read(PLAYERS, {})[key] || null;
    const sides = (game.sides || []).slice(0, 3).map((x) => `${x.name}${x.look ? ` (${x.look})` : ''}`.slice(0, 60));
    const again = last ? `${last.who}, ${last.side}`.slice(0, 60) : null;
    const t = run.video.duration / 2;
    setStatus('Waiting for you', 'waiting');
    const side = String((await ask({ question: 'This is footage of the whole match. Which side are you on?', t, options: again ? [again, ...sides] : sides })) || '').trim();
    if (again && side === again) return last;
    const who = String((await ask({ question: 'Which one is you? Say your position or role, and your number or what you wear.', t, options: [] })) || '').trim().slice(0, 120);
    const pick = (game.sides || []).find((x) => side.startsWith(x.name));
    const player = side || who ? { side: (pick?.name || side).slice(0, 60), look: pick?.look || '', who } : null;
    if (player) write(PLAYERS, { ...read(PLAYERS, {}), [key]: player });
    return player;
  }

  // ---------- the verdict and the report ----------
  async function finishReview(r) {
    stopStatus();
    run.done = true;
    const match = { id: run.id, date: today(), name: run.video.name, video: { size: run.video.size, lastModified: run.video.file.lastModified }, game: run.game.name, found: r.found, habit: r.habit, ...(r.reason ? { reason: r.reason } : {}), habitId: r.habitId, drill: r.drill, recheck: r.recheck, aim: r.aim, progress: r.progress, stats: r.stats, status: 'new' };
    history = C.addMatch(history, match);
    write(STORE, history);
    files.set(run.id, run.file);
    window.history.replaceState(null, '', `#review/${run.id}`);
    const moments = reportMoments(r);
    run.keys = moments.map((e) => ({ t: e.t }));
    renderReport(r, match);
    renderStart();

    // Saved now, and again as its frames and marks arrive, so quitting or leaving the page keeps everything done so
    // far. Leaving only stops the redrawing.
    const mine = run, v = run.video, here = () => mine === run;
    const learned = run.log.find(([, e]) => e.type === 'learned')?.[1];
    const record = {
      id: run.id, date: match.date, calls: run.calls, player: run.player, workingOn: run.workingOn, game: run.game,
      video: { name: v.name, size: v.size, lastModified: v.file.lastModified, duration: v.duration },
      result: slim(r), log: run.log, keys: slim(run.keys), handle: run.handle, path: (await mine.place)?.path || null,
    };
    recent.set(run.id, record);
    let cover = null;
    const save = async () => {
      try {
        const url = record.keys.find((k) => k.shot)?.shot.url || learned?.shot.url;
        if (url && url !== cover?.from) cover = { from: url, small: await smaller(url) };
        await R.save(record, cover?.small);
      } catch (e) { console.warn("This review's log couldn't be saved on this device.", e); }
    };
    await save();
    R.keep(history.matches.map((m) => m.id)).catch(() => {});

    // each key moment: its frame, marked only with what code knows (a measurement, a kill-feed line, a chess move)
    const { keys } = await K.prepare({ video: v, profile: mine.game, moments, measures: r.measures, events: r.events }).catch(() => ({ keys: mine.keys }));
    mine.keys = keys;
    record.keys = slim(keys);
    if (here()) keys.forEach((_, i) => paintKey(i));
    await save();
    if (await mine.kept) R.keepRecordings(videosOfRecent()).catch(() => {});
    const copy = await mine.library;
    if (copy?.path) { record.path = copy.path; await save(); }
  }

  // the recordings of the newest reviews, newest first: those copies are kept
  const videosOfRecent = () => [...history.matches].reverse().map((m) => m.video);

  // the moments the report shows with a frame: the habit's, or with no habit, the reason's (what to do better)
  const reportMoments = (r) => (r.found ? r.evidence : r.fixes || []);

  function renderReport(r, match) {
    const past = run.replay;
    stopFast();
    vid.muted = false;
    $('now').hidden = true;
    $('player').classList.remove('holding');
    $('review').classList.add('done');
    $('stages').hidden = true;
    ['question', 'checkin', 'board', 'meter'].forEach((id) => { $(id).hidden = true; });
    $('eyeMark').hidden = true;
    const v = $('verdict');
    const working = run.workingOn && r.progress ? `<p class="progress ${r.progress}">${esc(run.workingOn.name)}: ${PROGRESS[r.progress]}${r.progressFrom === 'measured' ? ` (${Math.abs(run.workingOn.baseline.heads).toFixed(1)} to ${Math.abs(r.aim.heads).toFixed(1)} heads)` : ''}</p>` : '';
    // the log first: each key moment says which of its steps found it
    const steps = $('beats').children.length;
    $('log').hidden = !steps && !r.board?.length;
    drawBoard($('finalBoard'), r.board || [], false);
    $('logBody').append($('breakdown'));
    [...$('beats').children].reverse().forEach((li) => $('beats').append(li));
    // folded: the verdict and its moments lead; the steps are there for whoever wants them
    $('logBox').open = false;
    paintLogSummary(r);

    const moments = reportMoments(r), instead = moments.some((e) => e.better);
    run.moments = moments;
    run.result = r;
    stopCritique();
    renderCritique(r);
    const list = moments.length ? `<ol class="keys">${moments.map((_, i) => keyHtml(i)).join('')}</ol>` : '';
    const again = '<button class="pill" type="button" id="againBtn">Review again</button>';
    const ci = r.checkIn, checked = !ci ? '' : `<p class="checked${ci.agreed ? ' yes' : ''}">${ci.agreed ? 'You agreed this is it.' : r.found && ci.habit === r.habit ? "You weren't sure. It looked again and kept it." : `You said “${esc(ci.said || 'not really')}”, so it looked again.`}</p>`;
    // what checked it: the record and the video (a check of the video that agreed with a planted false claim doesn't count)
    // a verdict the review put together after the coach's own didn't stand says where it came from
    const salvaged = r.salvaged === 'checked' ? `<p class="trust warn">${esc(r.note)}, so this names what the moments both checks let stand${r.left > 0 ? ` (${r.left} of its moments were left out)` : ''}.</p>` : r.salvaged === 'record' ? `<p class="trust warn">${esc(r.note)}, so this comes from what the match record and the clip reads show at each loss, checked against the record. It wasn't checked against the video.</p>` : '';
    const trust = salvaged || (!r.verified ? '' : r.verified.unreliable ? '<p class="trust warn">Checked against the record. The check against the video didn\'t hold up this time.</p>' : '<p class="trust"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>Checked against the record and the video</p>');
    // one structure for every verdict: what it is, where it shows, what to practice
    const label = r.found ? 'The habit to fix' : r.reason ? 'What cost you this match' : r.stopped ? 'Review stopped' : 'The verdict';
    const headline = r.found ? r.habit : r.reason || (r.stopped ? 'No verdict yet' : r.fewLosses ? 'Nothing cost you here' : 'No single habit stood out');
    const habit = r.found ? run.game?.habits?.find((h) => h.id === r.habitId) : null;
    const metric = r.found && r.aim && (habit ? habit.measuredBy === 'aim' : /crosshair/.test(r.habitId))
      ? `<p class="metric"><b>${Math.abs(r.aim.heads).toFixed(1)}</b><span>heads ${r.aim.heads >= 0 ? 'below' : 'above'} the head when enemies appeared, median of ${r.aim.n} measured</span></p>` : '';
    const contrast = r.contrast?.length ? `<h4>Where you got it right</h4><ul class="contrast">${r.contrast.map((e) => `<li><button class="t-btn" type="button" data-t="${e.t}">${C.mmss(e.t)}</button><span>${esc(e.what)}</span></li>`).join('')}</ul>` : '';
    const practice = r.drill || r.recheck ? `<section class="v-sec"><h3>What to practice</h3>${r.drill ? `<div class="drill"><p>${esc(r.drill)}</p></div>` : ''}${r.recheck ? `<p class="recheck"><b>Next match</b> ${esc(r.recheck)}</p>` : ''}</section>` : '';
    const kind = r.found ? `A habit · it shows at ${moments.length} moment${moments.length === 1 ? '' : 's'}` : r.reason ? 'What cost you this match · once, not a habit' : '';
    v.innerHTML = `<header class="v-head"><h2 aria-label="${esc(label)}: ${esc(headline)}"><span class="pen">${esc(headline)}</span></h2>${kind ? `<p class="kind">${kind}</p>` : ''}${checked}${working}${metric}${r.why ? `<p class="why">${esc(r.why)}</p>` : ''}${trust}</header>
      ${list ? `<section class="v-sec"><h3>${instead ? 'Where it shows, and what to do instead' : 'Where it shows'}</h3>${list}${contrast}</section>` : ''}
      ${practice}
      <div class="actions" id="actions">${r.found ? decisionHtml(match) : ''}${again}</div>`;
    if (r.found) {
      $('acceptBtn')?.addEventListener('click', () => decide('accepted', match));
      $('rejectBtn')?.addEventListener('click', () => decide('rejected', match));
    }
    v.hidden = false;
    penStroke(v.querySelector('.pen'));
    $('againBtn')?.addEventListener('click', reviewAgain);

    if (!past) v.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    moments.forEach((e, i) => {
      const pin = document.createElement('button');
      pin.className = 'pin';
      pin.type = 'button';
      pin.dataset.key = i;
      pin.style.left = pct(e.t);
      pin.style.animationDelay = `${i * 80}ms`;
      pin.textContent = i + 1;
      pin.setAttribute('aria-label', `Moment ${i + 1} at ${C.mmss(e.t)}`);
      timeline.append(pin);
    });
  }

  async function reviewAgain() {
    if (run.file) return start(run.file, { handle: run.handle || run.rec?.handle, place: run.rec?.path ? { path: run.rec.path } : null });
    if (!run.url) return nudge();
    const btn = $('againBtn'), v = run.rec.video;
    btn.disabled = true;
    btn.textContent = 'Opening the recording';
    const blob = await (await fetch(run.url)).blob();
    start(new File([blob], v.name, { type: blob.type, lastModified: v.lastModified }), { place: { path: run.rec.path } });
  }

  function paintLogSummary(r) {
    $('logSummary').textContent = `How it got here: ${run.calls} calls, ${r.stats?.looks ?? run.looks} looks`;
  }

  // ---------- key moments: the frame at each, marked up like a telestrator ----------
  function keyHtml(i) {
    const e = run.moments[i], k = run.keys?.[i] || {}, how = howKnew(e.t, k);
    return `<li class="key" id="key-${i}">
      <figure class="key-frame${k.shot ? '' : ' loading'}" data-key="${i}">${k.shot ? `<img src="${k.shot.url}" alt="The frame at ${C.mmss(e.t, true)}" />${marksHtml(k)}` : ''}<span class="n">${i + 1}</span><span class="watch">Watch</span></figure>
      <div class="key-body">
        <p class="key-when"><button class="t-btn" type="button" data-key="${i}">${C.mmss(e.t, true)}</button></p>
        <p class="key-what">${esc(e.what)}</p>
        ${e.because ? `<p class="key-why"><span class="k">Why it lost</span> ${esc(e.because)}</p>` : ''}
        ${how ? `<p class="key-how"><span class="k">How it knew</span> ${how}</p>` : ''}
        ${e.better ? `<p class="key-fix"><span class="k">Fix</span> ${esc(e.better)}</p>` : ''}
      </div>
    </li>`;
  }
  function paintKey(i) {
    const li = $(`key-${i}`);
    if (li) li.outerHTML = keyHtml(i);
  }

  // which steps of the log found the moment, what they measured, and what the match record says then
  function howKnew(t, k) {
    const steps = [...$('beats').children].map((li, i) => ({ li, n: String(i + 1).padStart(2, '0') })).filter(({ li }) => (li.times || []).some((x) => Math.abs(x - t) <= 1.5));
    const link = ({ n }) => `<button class="step-link" type="button" data-step="${+n}">step ${n}</button>`;
    const aim = steps.find(({ li }) => li.classList.contains('measure_aim')), looked = steps.filter(({ li }) => !li.classList.contains('measure_aim'));
    const out = [];
    if (k.measured && k.note) out.push(`${esc(k.note)}${aim ? ` in ${link(aim)}` : ''}`);
    else if (k.note) out.push(esc(k.note));
    if (looked.length) out.push(`${out.length ? 'seen' : 'Seen'} up close in ${looked.slice(0, 2).map(link).join(' and ')}`);
    const fired = run.shotsAt?.find((x) => Math.abs(x.t - t) < 0.05 && x.fired != null);
    if (fired) out.push(fired.fired ? 'the ammo counter shows they fired' : "the ammo counter shows they didn't fire");
    const line = (run.events || []).find((x) => Math.abs(x.t - t) <= 2 && ((x.kind === 'move' && x.grade) || ['kill', 'death'].includes(x.kind)));
    if (line?.text) out.push(`the match record: ${esc(line.text)}`);
    return out.join('; ');
  }
  function showStep(n) {
    const li = $('beats').children[n - 1];
    if (!li) return;
    $('logBox').open = true;
    li.scrollIntoView({ block: 'center', behavior: 'smooth' });
    li.classList.remove('flash');
    void li.offsetWidth;
    li.classList.add('flash');
  }

  // a pen arrow along a curve from s through c to e, with its head at e
  function arrow(s, c, e, cls) {
    const n = (v) => v.toFixed(1), tl = Math.hypot(e[0] - c[0], e[1] - c[1]), tx = (e[0] - c[0]) / tl, ty = (e[1] - c[1]) / tl, L = 36, A = 0.5;
    const head = (sgn) => [e[0] - L * (tx * Math.cos(A) - sgn * ty * Math.sin(A)), e[1] - L * (ty * Math.cos(A) + sgn * tx * Math.sin(A))];
    // a dashed one keeps its own length, so its dashes stay the same size on any arrow
    return `<path class="${cls} arrow"${/\bdashed\b/.test(cls) ? '' : ' pathLength="1"'} d="M${n(s[0])} ${n(s[1])}Q${n(c[0])} ${n(c[1])} ${n(e[0])} ${n(e[1])}" /><path class="${cls} tip" d="M${head(1).map(n).join(' ')}L${n(e[0])} ${n(e[1])}L${head(-1).map(n).join(' ')}" />`;
  }

  // a hand-drawn loop: a little more than once around, the way a pen circles something
  function loop(cx, cy, rx, ry) {
    const pts = Array.from({ length: 41 }, (_, i) => {
      const a = -1.9 + (i / 40) * (2 * Math.PI + 0.45), wob = 1 + 0.04 * Math.sin(3 * a + 1);
      return `${(cx + Math.cos(a) * rx * wob).toFixed(1)} ${(cy + Math.sin(a) * ry * wob).toFixed(1)}`;
    });
    return `M${pts.join('L')}`;
  }
  // Marks are drawn in the frame's own proportions, so loops stay round and arrows straight; labels sit on top in HTML.
  // The problem is circled in red, the fix in the pen color, with an arrow from one to the other.
  function marksHtml(k) {
    // a fact (a kill-feed line) is drawn like a fix, in the pen color, with no arrow to it
    const W = Math.round(1000 * (k.aspect || 16 / 9)), H = 1000, p = k.problem, f = k.fix || k.fact;
    if (!p && !f && !k.moves?.length) return '';
    const ring = (b, pad) => ({ cx: ((b[1] + b[3]) / 2) * W, cy: ((b[0] + b[2]) / 2) * H, rx: ((b[3] - b[1]) * W * 1.25) / 2 + pad, ry: ((b[2] - b[0]) * H * 1.25) / 2 + pad });
    const n = (v) => v.toFixed(1), svg = [], chips = [];
    let from = null, to = null;
    if (p?.box) { from = ring(p.box, 22); svg.push(`<path class="bad" pathLength="1" d="${loop(from.cx, from.cy, from.rx, from.ry)}" />`); }
    if (p?.point) {
      const cx = p.point[0] * W, cy = p.point[1] * H;
      from = { cx, cy, rx: 30, ry: 30 };
      svg.push(`<circle class="bad" pathLength="1" cx="${n(cx)}" cy="${n(cy)}" r="26" /><path class="bad cross" d="M${n(cx - 50)} ${n(cy)}h18M${n(cx + 32)} ${n(cy)}h18M${n(cx)} ${n(cy - 50)}v18M${n(cx)} ${n(cy + 32)}v18" />`);
    }
    if (f?.box) { to = ring(f.box, 16); svg.push(`<path class="good" pathLength="1" d="${loop(to.cx, to.cy, to.rx, to.ry)}" />`); }
    if (from && to) {
      const dx = to.cx - from.cx, dy = to.cy - from.cy, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
      const edge = (r) => 1 / Math.hypot(ux / r.rx, uy / r.ry);
      const a = edge(from) + 10, b = edge(to) + 12;
      if (len > a + b + 30) {
        const s = [from.cx + ux * a, from.cy + uy * a], e = [to.cx - ux * b, to.cy - uy * b], bend = 0.15 * (len - a - b);
        const c = [(s[0] + e[0]) / 2 - uy * bend, (s[1] + e[1]) / 2 + ux * bend];
        svg.push(arrow(s, c, e, 'good'));
      }
    }
    // Labels go on the far sides of their marks (the lower mark's below it, the higher one's above), flipped at the
    // frame's edges and kept off its sides.
    const chip = (r, cls, text, prefer) => {
      const below = prefer === 'below' ? (r.cy + r.ry) / H < 0.84 : (r.cy - r.ry) / H < 0.16;
      const y = below ? (r.cy + r.ry) / H : (r.cy - r.ry) / H, x = r.cx / W;
      // centered on its mark, or held to the mark's outer edge near a side of the frame, so it's never cut off
      const at = x > 0.72 ? `right:${Math.max(1, (1 - (r.cx + r.rx) / W) * 100).toFixed(1)}%` : x < 0.28 ? `left:${Math.max(1, ((r.cx - r.rx) / W) * 100).toFixed(1)}%` : `left:${(x * 100).toFixed(1)}%`;
      chips.push(`<span class="chip ${cls}${below ? '' : ' up'}${x > 0.72 ? ' end' : x < 0.28 ? ' start' : ''}" style="${at};top:${(y * 100).toFixed(1)}%">${esc(text)}</span>`);
    };
    // Moves, as on a board: an arrow from one square to another and a ring where it lands, drawn one after another.
    // A label goes where the move lands, or at `say` (a spot in the frame, as a key off to the side) when it would
    // cover pieces; it comes in as its move is drawn.
    (k.moves || []).forEach((mv, i) => {
      const x0 = mv.from[0] * W, y0 = mv.from[1] * H, x1 = mv.to[0] * W, y1 = mv.to[1] * H, d = 0.2 + i * 0.5;
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len, stop = mv.stop ?? (mv.ring === false ? 18 : 40);
      const s = [x0 + ux * 16, y0 + uy * 16], e = [x1 - ux * stop, y1 - uy * stop], bend = 0.1 * len * (mv.bend ?? 1);
      const ring = mv.ring === false ? '' : `<circle class="${mv.tone}" pathLength="1" cx="${n(x1)}" cy="${n(y1)}" r="34" />`;
      svg.push(`<g class="mv" style="--d:${d.toFixed(2)}s">${arrow(s, [(s[0] + e[0]) / 2 - uy * bend, (s[1] + e[1]) / 2 + ux * bend], e, `${mv.tone}${mv.dashed ? ' dashed' : ''}`)}${ring}</g>`);
      if (mv.label && mv.say) chips.push(`<span class="chip ${mv.tone} at${mv.dashed ? ' dashed' : ''}" data-d="${(d + 0.3).toFixed(2)}" style="left:${(mv.say[0] * 100).toFixed(1)}%;top:${(mv.say[1] * 100).toFixed(1)}%;animation-delay:${(d + 0.3).toFixed(2)}s">${esc(mv.label)}</span>`);
      else if (mv.label) chip({ cx: x1, cy: y1, rx: 36, ry: 36 }, mv.tone, mv.label, mv.place || 'below');
    });
    const problemLower = !from || !to || from.cy >= to.cy;
    if (p && from) chip(from, 'bad', p.label, problemLower ? 'below' : 'above');
    if (f && to) chip(to, 'good', f.label, problemLower ? 'above' : 'below');
    return `<svg class="marks" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><g filter="url(#tele)">${svg.join('')}</g></svg>${chips.join('')}`;
  }

  // Watching a key moment plays up to it, then holds on that frame with its marks drawn over the video.
  let markedAt = null;
  function watchKey(i) {
    const e = run.moments?.[i];
    if (!e) return;
    timeline.querySelectorAll('.pin').forEach((p) => p.classList.toggle('on', +p.dataset.key === i));
    if (!hasVideo()) return nudge();
    hideVideoMarks();
    $('stage').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    playClip(Math.max(0, e.t - 2.5), e.t, () => {
      markedAt = e.t;
      vid.currentTime = e.t;
      const v = $('vmarks'), k = run.keys?.[i];
      if (!k || !(k.problem || k.fix || k.fact || k.moves?.length)) return;
      v.innerHTML = marksHtml(k);
      v.hidden = false;
      placeVideoMarks();
    });
  }
  function hideVideoMarks() { $('vmarks').hidden = true; $('vmarks').innerHTML = ''; markedAt = null; }

  // ---------- the critique, narrated ----------
  // The finding played back as a critique video: each moment's run-up plays, the video holds on the moment with its marks
  // drawn, and a voice reads what happened there and what to do instead, captioned over the picture. It's the review's
  // own words and marks, read aloud by the browser's own voice, so it costs no model call.
  const LEAD_IN = 4; // s of play before each moment
  const cq = { token: 0, on: false, paused: false };
  const VOICES = ['Samantha', 'Ava', 'Allison', 'Daniel', 'Karen', 'Moira', 'Google US English', 'Google UK English Male', 'Alex'];
  // The most natural English voice there is: Microsoft's neural "Natural" voices (in Edge), the Premium and Enhanced
  // ones macOS can download, then the plain ones by name, else the system's default (macOS also lists novelty voices).
  // The player can pick another; it's kept.
  const VOICE = 'thirdeye.voice';
  const rankVoice = (v) => (/natural/i.test(v.name) ? 0 : /premium/i.test(v.name) ? 1 : /enhanced/i.test(v.name) ? 2 : VOICES.some((n) => v.name.startsWith(n)) ? 3 : 9);
  const englishVoices = () => ('speechSynthesis' in window ? speechSynthesis.getVoices() : []).filter((v) => /^en/i.test(v.lang)).sort((a, b) => rankVoice(a) - rankVoice(b) || VOICES.findIndex((n) => a.name.startsWith(n)) - VOICES.findIndex((n) => b.name.startsWith(n)));
  // Kokoro, the neural voice the local server runs (scripts/voice.mjs), when it's there: Michael unless they picked another
  let kokoro = null;
  fetch('/voice').then((r) => (r.ok ? r.json() : null)).then((j) => { kokoro = j?.voices || null; if (run?.cq) fillVoices(); }).catch(() => {});
  const pickedVoice = () => { const v = read(VOICE, ''); return v.startsWith('kokoro:') ? (kokoro && kokoro[v.slice(7)] ? v : '') : v || (kokoro ? 'kokoro:am_michael' : ''); };
  const kokoroOf = () => (pickedVoice().startsWith('kokoro:') ? pickedVoice().slice(7) : null);
  // a line in Kokoro's voice, made once a review (the server keeps it too): a blob URL to play
  const said = new Map();
  function lineAudio(text) {
    const voice = kokoroOf(), key = `${voice}|${text}`;
    if (!voice) return Promise.resolve(null);
    if (!said.has(key)) said.set(key, fetch('/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice }) }).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? URL.createObjectURL(b) : null)).catch(() => null));
    return said.get(key);
  }
  const voiceOf = () => {
    const en = englishVoices(), picked = pickedVoice();
    const choice = picked && en.find((v) => v.name === picked);
    if (choice) return choice;
    const best = en.find((v) => rankVoice(v) < 9);
    const all = 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
    return best || all.find((v) => v.default && /^en/i.test(v.lang)) || all.find((v) => v.default) || null;
  };
  function fillVoices() {
    const sel = $('cqVoice'), en = englishVoices().filter((v) => rankVoice(v) < 9), ko = Object.entries(kokoro || {});
    sel.hidden = !en.length && !ko.length;
    if (sel.hidden) return;
    const now = pickedVoice() || voiceOf()?.name;
    const opt = (value, label) => `<option value="${esc(value)}"${value === now ? ' selected' : ''}>${esc(label)}</option>`;
    sel.innerHTML = (ko.length ? `<optgroup label="Natural, made on this computer">${ko.map(([id, name]) => opt(`kokoro:${id}`, name)).join('')}</optgroup>` : '')
      + (en.length ? `<optgroup label="System voices">${en.map((v) => opt(v.name, v.name.replace(/^Microsoft /, '').replace(/ - English.*$/, '').replace(/ Online \(Natural\)/, ' (natural)'))).join('')}</optgroup>` : '');
  }
  if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', fillVoices);
  // the browser lists its voices a moment after the page loads
  const voicesReady = new Promise((r) => {
    if (!('speechSynthesis' in window) || speechSynthesis.getVoices().length) return r();
    speechSynthesis.addEventListener('voiceschanged', () => r(), { once: true });
    setTimeout(r, 1500);
  });
  const words = (text) => String(text).split(/\s+/).filter(Boolean).length;
  const firstLine = (text) => String(text || '').split(/(?<=[.!?])\s/)[0];
  // said as a voice reads a time best: "46 seconds in", "2 16"
  const sayTime = (t) => (t < 60 ? `${Math.round(t)} seconds in` : C.mmss(t).replace(':', ' '));
  // The critique walks the whole match: every moment they lost, in time order, each said from what the record knows
  // about it (the clip read of the fight, who killed them and whether anyone traded, the HP number, the score), and the
  // finding's own moments flagged as the habit, with what to do instead. Nothing in it is new: a moment no read covered
  // is said as the record has it, with no advice made up for it.
  // a record line as the voice says it: no team tags, no outcome word ahead of the clip read's story
  const spoken = (text) => {
    const t = String(text || '').replace(/, (enemy|teammate)\)/g, ')').replace(/ \((enemy|teammate)\)/g, '')
      // a player by their character alone, the name the player knows them by ("Sova (Sova)", "zeytazin (Reyna)")
      .replace(/(^|killed |knocked down |trading |by |; |, )([^;,()]+?) \(([A-Z][^(),]*)\)/g, '$1$3')
      // their own death untraded says nothing when nobody was left to trade it; a teammate's untraded is theirs to have traded
      .replace(/(killed you|knocked down you); not traded/, '$1').replace(/; not traded/, ', and nobody traded').replace(/^(won|lost|none)(;\s*(the enemy|they|you|the player) engaged first)?;?\s*/i, '').replace(/^fired in \d+ bursts;\s*/i, '').replace(/\bThe player\b/g, 'You').replace(/\bthe player\b/g, 'you').trim();
    return t ? t.replace(/\.?$/, '.') : '';
  };
  function critiqueChapters(r) {
    const events = run.events || [], deadFor = C.deadForOf(run.game, events), habit = run.moments || [];
    // losses, one per moment: a lost fight holds on the death in it
    const losses = [];
    for (const e of events) {
      if (e.kind === 'death') { const fight = events.find((f) => f.kind === 'engagement' && f.outcome === 'lost' && e.t >= f.from - 1 && e.t <= f.to + 3); losses.push({ t: e.t, text: [fight && spoken(fight.text), spoken(e.text) || 'You died.'].filter(Boolean).join(' ') }); }
      else if (e.kind === 'near_death') losses.push({ t: e.t, text: `Your health fell to ${e.hp} of ${e.of}.` });
      else if (e.kind === 'point_lost') losses.push({ t: e.t, text: spoken(e.text) });
      else if (e.kind === 'engagement' && e.outcome === 'lost' && !events.some((d) => d.kind === 'death' && d.t >= e.from - 1 && d.t <= e.to + 3)) losses.push({ t: e.to, text: `A fight you lost.${spoken(e.text) ? ` ${spoken(e.text)}` : ''}` });
      else if (e.kind === 'ally_death' && e.near === true && !e.tradedBy && !C.deathAt(events, e.t, deadFor)) losses.push({ t: e.t, text: `${spoken(e.text)} They were near you.` });
    }
    // each moment as its own situation: what happened, what made it lose there, what to do instead
    const said = (e) => `${String(e.what || '').replace(/\.?$/, '.')}${e.because ? ` ${String(e.because).replace(/^./, (x) => x.toUpperCase()).replace(/\.?$/, '.')}` : ''}${e.better ? ` Instead: ${e.better.replace(/\.?$/, '.')}` : ''}`;
    const cost = (e) => { const l = Number.isFinite(e.ledTo) && e.ledTo - e.t > 2 ? losses.find((x) => Math.abs(x.t - e.ledTo) <= 4) : null; return l ? ` That cost the fight at ${C.mmss(e.ledTo)}.` : ''; };
    const chapters = habit.map((e, i) => ({ t: e.t, habit: true, key: i, what: e.what, text: `${said(e)}${cost(e)}` }));
    // the moments that decided the fights they lost (turning points), not every death: a loss the finding's moment or
    // a turning point leads to is told with it (the user, Oct 23: "highlight pivotal moments, not just every death")
    const turns = Array.isArray(r.turning) ? r.turning : [];
    const told = (t) => chapters.some((c) => t >= c.t - 2 && t <= c.t + 8 || (c.ledTo != null && Math.abs(t - c.ledTo) <= 4));
    for (const e of turns) if (!chapters.some((c) => Math.abs(c.t - e.t) < 2)) chapters.push({ t: e.t, ledTo: e.ledTo, habit: false, turn: true, what: e.what, text: `${said(e)}${cost(e)}` });
    habit.forEach((e, i) => { if (Number.isFinite(e.ledTo)) chapters[i].ledTo = e.ledTo; });
    // a review from before turning points: each loss, as the record has it
    if (!turns.length) for (const l of losses) if (!told(l.t)) chapters.push({ t: l.t, habit: false, what: l.text, text: l.text });
    return chapters.sort((a, b) => a.t - b.t);
  }
  // what the voice says, in order: the verdict, each chapter, the one costing them most, what to practice
  function critiqueLines(r) {
    const chapters = run.cq || critiqueChapters(r), lines = [], n = chapters.filter((c) => c.habit).length;
    const name = r.found ? r.habit : r.reason || '';
    const head = r.found ? `The habit costing you fights: ${r.habit}.` : r.reason ? `What cost you this match: ${r.reason}.` : '';
    if (head || r.why) lines.push({ i: null, text: `${head} ${firstLine(r.why)}${chapters.length > n ? ' Here are the moments that cost you, and where it shows.' : ''}`.trim() });
    chapters.forEach((c, i) => {
      // no stock opening: "This is it. X dies." at every moment said the same thing each time (the user, Oct 23). Only a
      // loss as the record has it, from a review before turning points, says it was lost.
      const lead = c.habit || c.turn ? '' : 'You lost this one. ';
      lines.push({ i, t: c.t, text: `${C.mmss(c.t)}. ${lead}${c.text}`, said: `At ${sayTime(c.t)}. ${lead}${c.text}` });
    });
    if (name && chapters.length > n) lines.push({ i: null, text: `The one costing you the most: ${name}. It showed at ${n} of the ${chapters.length} moments that cost you.` });
    if (r.drill) lines.push({ i: null, text: `The drill: ${firstLine(r.drill)}` });
    return lines;
  }
  // about how long it runs: each moment's run-up and the time to say each line
  const critiqueSeconds = (lines) => lines.reduce((n, l) => n + (l.t != null ? LEAD_IN + 1 : 0) + words(l.text) / 2.6 + 0.6, 0);
  // resolves when the line has been said; with no voice, or one that never says it's done, after the time to read it
  async function speak(text, token) {
    const url = await lineAudio(text);
    if (token !== cq.token) return;
    if (url) return playLine(url, text, token);
    return sayLine(text, token);
  }
  // a line made by Kokoro: done when it ends (or, if it never says so, after it should have, not counting a pause)
  function playLine(url, text, token) {
    return new Promise((resolve) => {
      const a = new Audio(url);
      let over = false, left = Math.max(1800, (words(text) / 2.6) * 1000) * 1.8 + 2500;
      const done = () => { if (over) return; over = true; clearInterval(guard); if (cq.audio === a) cq.audio = null; resolve(); };
      const guard = setInterval(() => { if (token !== cq.token) { a.pause(); return done(); } if (!cq.paused && (left -= 250) <= 0) done(); }, 250);
      a.onended = a.onerror = done;
      cq.audio = a;
      a.play().catch(done);
    });
  }
  function sayLine(text, token) {
    return new Promise((resolve) => {
      const reading = Math.max(1800, (words(text) / 2.6) * 1000), voice = 'speechSynthesis' in window ? voiceOf() : null;
      // the time it may take, counted only while not paused
      let over = false, left = voice ? reading * 1.8 + 2500 : reading;
      const done = () => { if (over) return; over = true; clearInterval(guard); resolve(); };
      const guard = setInterval(() => { if (token !== cq.token) return done(); if (!cq.paused && (left -= 250) <= 0) done(); }, 250);
      if (!voice) return;
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.rate = 1.02;
      u.onend = u.onerror = done;
      if (token === cq.token) speechSynthesis.speak(u); else done();
    });
  }
  const pauseFor = (ms) => new Promise((r) => setTimeout(r, ms));
  function showCaption(line) {
    const c = $('caption');
    if (!line) { c.hidden = true; c.innerHTML = ''; return; }
    c.innerHTML = `${line.i != null ? `<span class="cap-n">${line.i + 1}</span>` : ''}<span class="cap-text">${esc(line.text)}</span>`;
    c.hidden = false;
    move(c, { opacity: [0, 1], y: [8, 0] }, { duration: 0.3, ease: [0.2, 0.7, 0.2, 1] });
  }
  function markChapter(i) {
    const c = run.cq?.[i], key = c?.habit ? c.key : -1;
    $('cqChapters').querySelectorAll('.cq-ch').forEach((b) => b.classList.toggle('on', +b.dataset.i === i));
    timeline.querySelectorAll('.pin').forEach((p) => p.classList.toggle('on', +p.dataset.key === key));
    $('rail').querySelectorAll('.key').forEach((li, k) => li.classList.toggle('playing', k === key));
  }
  // plays up to a moment, then holds on it with its marks; resolves when it's held (or the critique was stopped)
  function holdAt(i, token) {
    return new Promise((done) => {
      const c = run.cq[i];
      hideVideoMarks();
      playClip(Math.max(0, c.t - LEAD_IN), c.t, () => {
        if (token !== cq.token) return done();
        markedAt = c.t;
        vid.currentTime = c.t;
        const k = c.habit ? run.keys?.[c.key] : run.cqKeys?.[i];
        if (k && (k.problem || k.fix || k.fact || k.moves?.length)) { const v = $('vmarks'); v.innerHTML = marksHtml(k); v.hidden = false; placeVideoMarks(); }
        done();
      });
    });
  }
  async function playCritique(from = 0) {
    if (!run?.result || !run.cq?.length) return;
    if (!hasVideo()) return nudge();
    stopCritique();
    const token = ++cq.token, lines = critiqueLines(run.result);
    // the marks for the losses the finding doesn't cite: the same code-read marks as the report's (no model call)
    if (!run.cqKeys) run.cqKeys = (await K.prepare({ video: run.video, profile: run.game, moments: run.cq.map((c) => ({ t: c.t })), measures: run.result.measures || [], events: run.events || [] }).catch(() => ({ keys: [] }))).keys;
    await voicesReady;
    if (token !== cq.token) return;
    cq.on = true; cq.paused = false; cq.muted = vid.muted;
    vid.muted = true; // the voice over the game's sound would be noise
    $('critique').classList.add('playing');
    $('cqPlayText').textContent = 'Pause';
    $('cqStop').hidden = false;
    $('stage').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    // from a chapter: start at that moment
    const start = from > 0 ? lines.findIndex((l) => l.i === from) : 0;
    const todo = lines.slice(Math.max(0, start));
    for (const [k, line] of todo.entries()) {
      // the next line is made while this one plays, so the voice doesn't wait
      if (todo[k + 1]) lineAudio(todo[k + 1].said || todo[k + 1].text);
      while (cq.paused && token === cq.token) await pauseFor(200);
      if (token !== cq.token) return;
      markChapter(line.i);
      if (line.t != null) await holdAt(line.i, token);
      while (cq.paused && token === cq.token) await pauseFor(200);
      if (token !== cq.token) return;
      await speak(line.said || line.text, token);
      if (token !== cq.token) return;
      await pauseFor(600);
    }
    if (token === cq.token) stopCritique();
  }
  function stopCritique() {
    cq.token++;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (cq.audio) { cq.audio.pause(); cq.audio = null; }
    if (!cq.on) return;
    cq.on = cq.paused = false;
    clipEnd = clipThen = null;
    vid.pause();
    vid.muted = !!cq.muted;
    showCaption(null);
    hideVideoMarks();
    markChapter(-1);
    $('critique').classList.remove('playing', 'paused');
    $('cqPlayText').textContent = 'Watch the critique';
    $('cqStop').hidden = true;
  }
  function toggleCritique() {
    if (!cq.on) return playCritique(0);
    cq.paused = !cq.paused;
    $('critique').classList.toggle('paused', cq.paused);
    $('cqPlayText').textContent = cq.paused ? 'Resume' : 'Pause';
    if ('speechSynthesis' in window) { if (cq.paused) speechSynthesis.pause(); else speechSynthesis.resume(); }
    if (cq.audio) { if (cq.paused) cq.audio.pause(); else cq.audio.play().catch(() => {}); }
    if (cq.paused) vid.pause(); else if (clipEnd != null) vid.play().catch(() => {});
  }
  $('cqPlay').addEventListener('click', toggleCritique);
  // a new voice says one line, so the player hears it before the critique
  $('cqVoice').addEventListener('change', (e) => {
    write(VOICE, e.target.value);
    if (cq.on) return;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    const sample = 'This is how the critique will sound.';
    if (kokoroOf()) { lineAudio(sample).then((url) => { if (url && !cq.on) new Audio(url).play().catch(() => {}); }); return; }
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(sample);
    u.voice = voiceOf();
    speechSynthesis.speak(u);
  });
  $('cqStop').addEventListener('click', stopCritique);
  $('cqChapters').addEventListener('click', (e) => { const b = e.target.closest('.cq-ch'); if (b) playCritique(+b.dataset.i); });
  // the player taking over the video ends the critique
  ['pointerdown', 'keydown'].forEach((ev) => vid.addEventListener(ev, () => { if (cq.on) stopCritique(); }));
  timeline.addEventListener('pointerdown', () => { if (cq.on) stopCritique(); });
  function renderCritique(r) {
    const box = $('critique');
    run.cq = critiqueChapters(r);
    run.cqKeys = null;
    if (!run.cq.length) { box.hidden = true; return; }
    const lines = critiqueLines(r), secs = Math.round(critiqueSeconds(lines)), n = run.cq.filter((c) => c.habit).length;
    $('cqMeta').textContent = `Narrated · ${run.cq.length} moment${run.cq.length === 1 ? '' : 's'}${n && n < run.cq.length ? `, ${n} where it shows` : ''} · about ${C.mmss(secs)}`;
    fillVoices();
    // the opening lines, made while the player reads the report
    lines.slice(0, 2).forEach((l) => lineAudio(l.said || l.text));
    $('cqChapters').innerHTML = run.cq.map((c, i) => `<li><button class="cq-ch${c.habit ? ' habit' : ''}" type="button" data-i="${i}"><span class="cq-n">${c.habit ? c.key + 1 : ''}</span><span class="cq-t">${C.mmss(c.t, true)}</span><span class="cq-w">${c.habit ? '<b>Where it shows</b> ' : ''}${esc(c.text)}</span></button></li>`).join('');
    box.hidden = false;
  }
  // over the picture itself, not the black bars around it
  function placeVideoMarks() {
    const el = $('vmarks');
    if (el.hidden) return;
    const pw = vid.clientWidth, ph = vid.clientHeight, vw = vid.videoWidth || 16, vh = vid.videoHeight || 9, s = Math.min(pw / vw, ph / vh);
    Object.assign(el.style, { width: `${vw * s}px`, height: `${vh * s}px`, left: `${(pw - vw * s) / 2}px`, top: `${(ph - vh * s) / 2}px` });
  }
  vid.addEventListener('play', () => { if (clipThen == null) hideVideoMarks(); });
  vid.addEventListener('seeking', () => { if (markedAt != null && Math.abs(vid.currentTime - markedAt) > 0.25) hideVideoMarks(); });
  window.addEventListener('resize', placeVideoMarks);

  function decisionHtml(match) {
    const m = history.matches.find((x) => x.id === match.id) || match;
    if (history.habit?.matchId === m.id) return '<p class="accepted">Saved. Your next review checks this habit.</p>';
    if (m.status === 'rejected') return '<p class="accepted">Noted. It won\'t be tracked.</p>';
    if (m.status === 'accepted') return '<p class="accepted">You worked on this one.</p>';
    return '<button class="pill primary" type="button" id="acceptBtn">Work on this</button><button class="pill" type="button" id="rejectBtn">Not this</button>';
  }

  function decide(status, match) {
    history = { ...history, matches: history.matches.map((m) => (m.id === match.id ? { ...m, status } : m)) };
    if (status === 'accepted') history = C.acceptHabit(history, match);
    write(STORE, history);
    $('actions').innerHTML = `${decisionHtml(match)}<button class="pill" type="button" id="againBtn">Review again</button>`;
    $('againBtn').addEventListener('click', reviewAgain);
    renderStart();
  }

  // a small copy of a frame, for the list of past reviews
  async function smaller(url, width = 360) {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = width;
    c.height = Math.round((img.naturalHeight / img.naturalWidth) * width);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72);
  }

  // ---------- Home: real matches, read as they play ----------
  // Four scenarios, each a short clip of a recording on this machine (npm run scenes) with what Thirdeye read there:
  // the HUD it learned, kill-feed rows (the reader got 35 of 36 right on the TenZ match and 41 of 41 on Vyse's, against
  // hand labels), and Stockfish's score for a chess move. Every step and mark was checked against the clip's frames.
  // The steps run on the clip's own clock; on the step with a hold, the clip freezes while the pen marks it up. The
  // Valorant and Apex clips are other players' videos, for testing; the chess game is generated.
  const SCENES = [
    {
      id: 'apex', title: 'A fight won', game: 'Apex Legends', aspect: 2170 / 1162, from: 40,
      hud: [['kill feed', [0.729, 0.174, 0.234, 0.166]], ['minimap', [0.058, 0, 0.17, 0.318]], ['ammo', [0.804, 0.816, 0.195, 0.155]], ['damage', [0.866, 0.083, 0.07, 0.048]]],
      steps: [
        { at: 0, kind: 'Reading the screen', phase: 'Found the kill feed, the minimap, the ammo, and the damage dealt', hud: true },
        { at: 2.4, kind: 'Finding the fights', phase: 'Looking for damage numbers, knocks, and kill-feed rows' },
        { at: 4.4, kind: 'Close look', t: 44.4, phase: 'Watching the run-up to the fight' },
        { at: 6.4, kind: 'A fight won', t: 46.4, phase: 'Knocked down Raygebait: 127 damage inflicted', hold: 2.8, marks: [['Hits landing', [0.39, 0.495, 0.53, 0.57]], ['Knocked down · 127 damage', [0.7, 0.425, 0.765, 0.635]]] },
      ],
    },
    {
      id: 'tenz', title: 'Three kills in 11.6 s', game: 'Valorant', aspect: 2170 / 1162, from: 219,
      hud: [['kill feed', [0.77, 0.082, 0.225, 0.11]]],
      steps: [
        { at: 0, kind: 'Reading the kill feed', phase: 'Every row, both teams, from the full-quality recording', hud: true },
        { at: 1, kind: 'Your kill', t: 220, phase: 'You ▸ Fade, enemy team' },
        { at: 9.6, kind: 'Your kill', t: 228.6, phase: 'You ▸ ulquiorra, enemy team' },
        { at: 12.8, kind: 'Three in 11.6 s', t: 231.6, phase: 'You ▸ Reyna: the third kill, 11.6 s after the first', hold: 2.8, marks: [['Kill 3 · You ▸ Reyna', [0.133, 0.8, 0.166, 0.99]]] },
      ],
    },
    {
      id: 'vyse', title: 'Traded after a flash', game: 'Valorant', aspect: 1290 / 726, from: 76,
      hud: [['kill feed', [0.74, 0.08, 0.25, 0.12]]],
      steps: [
        { at: 0, kind: 'Reading the kill feed', phase: 'Teammates\' kills and deaths too, with each side\'s team', hud: true },
        { at: 1.4, kind: 'Flashed', t: 77.4, phase: 'The screen whites out, kill feed and all' },
        { at: 3.8, kind: 'Teammate down', t: 79.8, phase: 'As the flash clears: Omen ▸ ZedCapetinha, your team' },
        { at: 5.5, kind: 'Traded', t: 81.5, phase: 'You ▸ Omen, the killer, 1.4 s after the flash cleared', hold: 2.8, marks: [['You ▸ Omen', [0.162, 0.745, 0.197, 0.987]], ['Your kill', [0.72, 0.45, 0.87, 0.55]]] },
        { at: 8, kind: 'Your kill', t: 84, phase: 'You ▸ Killjoy, 2.8 s later' },
      ],
    },
    {
      id: 'chess', title: 'A blunder with 25 s left', game: 'Chess', note: 'a generated test game', aspect: 16 / 9, from: 68,
      hud: [['board', [0.0625, 0.055, 0.5, 0.89]], ['your clock', [0.609, 0.778, 0.188, 0.098]]],
      steps: [
        { at: 0, kind: 'Reading the board', phase: 'Every move read off the board in code: no model calls', hud: true },
        { at: 3, kind: 'Scoring every move', phase: 'Stockfish rates each of your moves' },
        { at: 6, kind: 'Your move', t: 74, phase: '19. Nce5' },
        // squares are the fixture's: an 80 px board at (80, 40) in 1280 x 720, White at the bottom
        {
          at: 6.6, kind: 'A blunder', t: 74.6, phase: '19. Nce5 loses 4.9 pawns: the f6 pawn takes the knight. Re1 was best.', hold: 4,
          mark: {
            aspect: 16 / 9,
            moves: [
              { tone: 'bad', from: [0.21875, 0.5556], to: [0.34375, 0.4444], label: '19. Nce5 · −4.9 pawns', say: [0.61, 0.3] },
              { tone: 'bad', dashed: true, from: [0.40625, 0.3333], to: [0.34375, 0.4444], ring: false, stop: 40, label: 'then f6 takes the knight', say: [0.61, 0.38] },
              { tone: 'good', from: [0.40625, 0.8889], to: [0.34375, 0.8889], ring: false, label: 'Re1 was best', say: [0.61, 0.46] },
            ],
          },
          marks: [['0:25 on your clock', [0.778, 0.609, 0.876, 0.797]]],
        },
      ],
    },
  ];

  // Motion (vendor/motion.js, motion.dev) does the animating; with reduced motion asked for, things just appear
  const M = window.Motion, calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // what Motion will bring in starts hidden, only once Motion is here to bring it in
  if (M && !calm) document.documentElement.classList.add('motion');
  const move = (el, keyframes, opts) => (M && !calm && el ? M.animate(el, keyframes, opts) : null);

  function homeDemo() {
    const v = $('demoVideo'), hud = $('demoHud'), marks = $('demoMarks'), bar = $('scenes');
    let scene = 0, shown = null, holding = false, progress = null, holdTimer = null;
    bar.innerHTML = SCENES.map((s, i) => `<button class="scene" type="button" role="tab" data-scene="${i}" aria-selected="false"><img src="assets/scenes/${s.id}.jpg" alt="" /><span class="sc-text"><span class="sc-title">${esc(s.title)}</span><span class="sc-game">${esc(s.game)}</span></span><span class="sc-bar"><i></i></span></button>`).join('');
    const paint = (s) => {
      if (shown === s) return;
      shown = s;
      const n = SCENES[scene].steps.indexOf(s) + 1;
      $('demoNow').innerHTML = `<span class="now-n">${String(n).padStart(2, '0')}</span><div class="now-text"><p class="now-kind">${esc(s.kind)}${s.t != null ? ` <span>${C.mmss(s.t, true)}</span>` : ''}</p><p class="now-phase"><i></i>${esc(s.phase)}</p></div>`;
      move($('demoNow'), { opacity: [0, 1], y: [10, 0] }, { duration: 0.35, ease: [0.2, 0.7, 0.2, 1] });
      hud.classList.toggle('on', !!s.hud);
      marks.innerHTML = '';
    };
    function play(i) {
      clearTimeout(holdTimer);
      holding = false;
      scene = i;
      shown = null;
      const s = SCENES[i];
      s.steps.forEach((x) => { x.held = false; });
      $('demo').style.aspectRatio = s.aspect;
      hud.innerHTML = s.hud.map(([name, [x, y, w, h]]) => `<span class="el" style="left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%"><span>${esc(name)}</span></span>`).join('');
      $('demoCaption').textContent = `Thirdeye reading ${s.note || `a real ${s.game} match`}`;
      bar.querySelectorAll('.scene').forEach((b, k) => { b.setAttribute('aria-selected', String(k === i)); b.querySelector('i').style.transform = 'scaleX(0)'; });
      move($('demo'), { opacity: [0.35, 1], scale: [0.985, 1] }, { duration: 0.5, ease: [0.2, 0.7, 0.2, 1] });
      v.src = `assets/scenes/${s.id}.mp4`;
      v.poster = `assets/scenes/${s.id}.jpg`;
      v.play().catch(() => {});
      paint(s.steps[0]);
    }
    // the active chip fills as its clip plays, holds included
    function fill() {
      const s = SCENES[scene], i = bar.querySelectorAll('.scene')[scene]?.querySelector('i');
      if (!i || !v.duration) return;
      const held = s.steps.filter((x) => x.held).reduce((a, x) => a + x.hold, 0), total = v.duration + s.steps.reduce((a, x) => a + (x.hold || 0), 0);
      i.style.transform = `scaleX(${Math.min(1, (v.currentTime + held) / total)})`;
    }
    v.addEventListener('timeupdate', () => {
      fill();
      if (holding) return;
      const steps = SCENES[scene].steps, s = [...steps].reverse().find((x) => v.currentTime >= x.at) || steps[0];
      paint(s);
      // the freeze-frame: the clip stops on the moment while the pen marks it up
      if (s.hold && !s.held && v.currentTime < s.at + 0.6) {
        s.held = holding = true;
        v.pause();
        v.currentTime = s.at;
        marks.innerHTML = (s.mark ? marksHtml(s.mark) : '') + (s.marks || []).map(([label, box]) => marksHtml({ aspect: SCENES[scene].aspect, fix: { box, label } })).join('');
        // labels pop in one after another, or each with its own move when it has one
        const cs = marks.querySelectorAll('.chip');
        move(cs, { scale: [0.6, 1], opacity: [0, 1] }, { type: 'spring', bounce: 0.45, duration: 0.6, delay: (i) => (cs[i].dataset.d ? +cs[i].dataset.d : 0.35 + i * 0.12) });
        holdTimer = setTimeout(() => { holding = false; marks.innerHTML = ''; v.play().catch(() => {}); }, s.hold * 1000);
      }
    });
    v.addEventListener('ended', () => play((scene + 1) % SCENES.length));
    bar.addEventListener('click', (e) => { const b = e.target.closest('[data-scene]'); if (b) play(+b.dataset.scene); });
    // it plays only while it's on screen
    new IntersectionObserver(([e]) => { if (e.isIntersecting) { if (!holding) v.play().catch(() => {}); } else v.pause(); }, { threshold: 0.3 }).observe(v);
    play(0);
    // the walkthrough's last step: Apex's knock-down frame, marked
    $('stepProof').insertAdjacentHTML('beforeend', marksHtml({ aspect: SCENES[0].aspect, fix: { box: [0.39, 0.495, 0.53, 0.57], label: 'Hits landing' } }));
  }

  // the opening card arrives in a short stagger, and each section rises in as it scrolls into view
  function reveal() {
    move(document.querySelectorAll('.hero > *'), { opacity: [0, 1], y: [16, 0] }, { duration: 0.6, delay: M?.stagger(0.07), ease: [0.2, 0.7, 0.2, 1] });
    move($('demo'), { opacity: [0, 1], y: [24, 0], scale: [0.97, 1] }, { duration: 0.8, delay: 0.25, ease: [0.2, 0.7, 0.2, 1] });
    if (!M || calm) return;
    for (const group of ['.home .steps', '.home .why']) {
      M.inView(group, (el) => { M.animate([...el.children], { opacity: [0, 1], y: [24, 0] }, { duration: 0.55, delay: M.stagger(0.08), ease: [0.2, 0.7, 0.2, 1] }); }, { amount: 0.25 });
    }
    M.inView('.home .cta-band', (el) => { M.animate(el, { opacity: [0, 1], scale: [0.96, 1] }, { duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }); }, { amount: 0.4 });
  }

  // ---------- past reviews ----------
  // the sidebar's latest three, each a way back into its review
  async function renderRecent() {
    const latest = [...history.matches].reverse().slice(0, 3), box = $('sideRecent');
    box.hidden = !latest.length;
    if (!latest.length) return;
    const thumbs = await R.thumbs().catch(() => ({}));
    box.innerHTML = `<h2>Latest</h2><ol>${latest.map((m) => `<li><a href="#review/${esc(m.id)}"><span class="sr-shot">${thumbs[m.id] ? `<img src="${thumbs[m.id]}" alt="" />` : ''}</span><span class="sr-text"><span class="sr-habit">${esc(m.found ? m.habit : m.reason || 'Nothing named')}</span><span class="sr-meta">${esc(gameName(m.game))} · ${niceDate(m.date)}</span></span></a></li>`).join('')}</ol>`;
  }

  const TAGS = { better: 'Better', same: 'Same', worse: 'Worse' };
  const tagOf = (m) => (history.habit?.matchId === m.id ? { text: 'Working on', on: true } : TAGS[m.progress] ? { text: TAGS[m.progress] } : m.status === 'rejected' ? { text: 'Not this' } : !m.found && m.reason ? { text: 'Once, not a habit' } : null);

  // a game's name as it was learned; reviews saved before learning kept a lowercase id ("valorant")
  const gameName = (g) => (!g ? 'Other games' : g === g.toLowerCase() ? g.replace(/\b\w/g, (c) => c.toUpperCase()) : g);

  // One shelf per game, the game played most recently first, newest review first on each shelf.
  async function showReviews() {
    show('reviews');
    renderStart();
    const thumbs = await R.thumbs().catch(() => ({}));
    const shelves = new Map();
    for (const m of [...history.matches].reverse()) {
      const name = gameName(m.game), k = name.toLowerCase();
      if (!shelves.has(k)) shelves.set(k, { name, list: [] });
      shelves.get(k).list.push(m);
    }
    const card = (m) => {
      const tag = tagOf(m);
      return `<li><a class="card" href="#review/${esc(m.id)}">
        <span class="c-shot">${thumbs[m.id] ? `<img src="${thumbs[m.id]}" alt="" />` : '<svg aria-hidden="true"><use href="#eye" /></svg>'}${tag ? `<span class="c-tag${tag.on ? ' on' : ''}">${esc(tag.text)}</span>` : ''}</span>
        <span class="c-habit${m.found ? '' : ' none'}">${esc(m.found ? m.habit : m.reason || 'Nothing named')}</span>
        <span class="c-meta">${niceDate(m.date)}</span>
      </a></li>`;
    };
    const working = history.habit && gameName(history.habit.game).toLowerCase();
    const list = [...shelves.values()];
    $('shelves').innerHTML = list.length
      ? `${list.length > 1 ? `<nav class="shelf-nav" aria-label="Games">${list.map((g, i) => `<a href="#shelf-${i}" data-shelf="${i}">${esc(g.name)}<span>${g.list.length}</span></a>`).join('')}</nav>` : ''}
        ${list.map((g, i) => `<section class="shelf" id="shelf-${i}" aria-labelledby="shelf-${i}-name">
          <header><h2 id="shelf-${i}-name">${esc(g.name)}</h2><span class="shelf-count">${g.list.length}</span>${working === g.name.toLowerCase() ? `<span class="shelf-working">Working on ${esc(history.habit.name)}</span>` : ''}</header>
          <ol class="cards">${g.list.map(card).join('')}</ol>
        </section>`).join('')}`
      : `<div class="c-empty"><svg aria-hidden="true"><use href="#eye" /></svg><p class="c-empty-title">No reviews yet</p><p>${D ? 'Reviews from the browser version stay in the browser.' : 'Each review you run lands here.'}</p><a class="pill primary" href="#">Review a match</a></div>`;
    // the game chips scroll to their shelf without leaving #reviews
    $('shelves').querySelectorAll('[data-shelf]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); $(`shelf-${a.dataset.shelf}`).scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  }

  // A past review is drawn again from its saved log: the same timeline, cards, frames, and report. Reviews saved before
  // logs were kept show their report only.
  async function openPast(id) {
    const m = history.matches.find((x) => x.id === id);
    if (!m) return location.replace('#reviews');
    const rec = recent.get(id) || (await R.get(id).catch(() => null));
    show('review', 'reviews');
    resetReview();
    const old = vid.src;
    vid.removeAttribute('src');
    vid.load();
    releaseLater(old);
    run = { id, replay: true, done: true, rec, file: null, handle: rec?.handle || null, video: { name: m.name, duration: rec?.video.duration || 0 }, game: rec?.game || null, workingOn: rec?.workingOn || null, abort: new AbortController(), looks: 0, turns: 0, calls: 0, beat: null, log: [] };
    $('crumbs').hidden = false;
    $('crumbs').innerHTML = `<a class="back" href="#reviews"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" /></svg>All reviews</a><span>${niceDate(m.date)} · ${esc(m.game || '')} · ${esc(m.name)}</span>${D && rec?.path ? `<button class="quiet reveal" type="button" id="revealBtn">${/Mac/.test(navigator.userAgent) ? 'Show in Finder' : 'Show the file'}</button>` : ''}`;
    $('revealBtn')?.addEventListener('click', () => D.reveal(rec.path));
    if (!rec) {
      $('review').classList.add('bare');
      $('stage').hidden = true;
      renderReport({ found: m.found, habit: m.habit, habitId: m.habitId, drill: m.drill, recheck: m.recheck, aim: m.aim, progress: m.progress, stats: m.stats, evidence: [], contrast: [], fixes: [], board: [] }, m);
      $('verdict').insertAdjacentHTML('beforeend', '<p class="older">Saved before reviews kept their log and frames.</p>');
      return;
    }
    if (!m.video) {
      history = { ...history, matches: history.matches.map((x) => (x.id === id ? { ...x, video: { size: rec.video.size, lastModified: rec.video.lastModified } } : x)) };
      write(STORE, history);
    }
    drawAxis();
    drawLegend(rec.game);
    for (const [kind, e] of rec.log) if (kind !== 'mark') (kind === 'event' ? onEvent : onStep)(e);
    run.calls = rec.calls;
    run.keys = rec.keys || (rec.thumbs || []).map((s) => ({ t: s.t, shot: s, aspect: 16 / 9 }));
    renderReport(rec.result, m);
    await attachRecording(rec);
  }

  // The recording comes from this visit; in the desktop app, from where it is on disk; in a browser, from the saved copy
  // or the file handle (the browser may ask once); or else from the player.
  async function attachRecording(rec) {
    const mine = run;
    const use = (file) => {
      if (run !== mine) return;
      if (file.size !== rec.video.size) return reattach(rec, "That's a different recording.");
      files.set(rec.id, file);
      setVideo(file);
    };
    if (files.has(rec.id)) return use(files.get(rec.id));
    if (D && rec.path) {
      const r = await D.open(rec.path).catch(() => ({ missing: true }));
      if (run !== mine) return;
      if (r.url && r.size === rec.video.size) { setVideoUrl(r.url); run.url = r.url; return; }
      return reattach(rec, r.url ? 'The file there is a different recording now. Find this one.' : 'It moved or was renamed. Find the file.');
    }
    const kept = await R.recording(rec.video);
    if (kept) return use(kept);
    if (rec.handle) {
      try { if ((await rec.handle.queryPermission({ mode: 'read' })) === 'granted') return use(await rec.handle.getFile()); } catch {}
    }
    reattach(rec);
  }
  function reattach(rec, problem = '') {
    const r = $('reattach');
    r.hidden = false;
    r.innerHTML = `<div class="r-in"><svg class="r-eye" aria-hidden="true"><use href="#eye" /></svg><p class="r-title">Load the recording to watch it</p><p class="r-file">${esc(rec.video.name)}</p>
      <div class="r-actions">${rec.handle && !problem ? '<button class="pill primary" type="button" id="reopenBtn">Open it</button>' : ''}<label class="pill${rec.handle && !problem ? '' : ' primary'}">Find the file<input type="file" accept="video/*,.mkv" id="reattachInput" /></label></div>
      ${problem ? `<p class="r-err">${esc(problem)}</p>` : ''}</div>`;
    const mine = run;
    const use = (file, handle) => {
      if (run !== mine) return;
      if (file.size !== rec.video.size) return reattach(rec, "That's a different recording.");
      files.set(rec.id, file);
      setVideo(file);
      // the desktop app remembers the new place; a browser keeps a copy
      (D ? D.remember(file) : Promise.resolve(null)).then(async (p) => {
        if (p) { rec.path = p.path; await R.save(rec); const copy = await D.keep(p.path); if (copy?.path) { rec.path = copy.path; await R.save(rec); } return; }
        return R.keepRecording(file).then((ok) => ok && R.keepRecordings(videosOfRecent()));
      }).catch(() => {});
      Promise.resolve(handle).then((h) => {
        if (h?.kind !== 'file') return;
        rec.handle = run.handle = h;
        R.save(rec).catch(() => {});
      }, () => {});
    };
    $('reopenBtn')?.addEventListener('click', async () => {
      try {
        if ((await rec.handle.requestPermission({ mode: 'read' })) === 'granted') return use(await rec.handle.getFile());
      } catch {}
      reattach(rec, 'It moved or was renamed. Find the file.');
    });
    const input = $('reattachInput');
    withPicker(input, use);
    input.addEventListener('change', () => { const f = input.files[0]; input.value = ''; if (f) use(f); });
    onReattach = use;
  }
  let onReattach = null;
  dropTarget($('reattach'), (f, h) => onReattach?.(f, h));

  $('stopBtn').addEventListener('click', () => run?.abort.abort());
  $('libraryBtn').addEventListener('click', () => D?.showLibrary());
  // a backend on a free host sleeps when idle: waking it now saves that wait at the first model call
  if (G.backendUrl()) fetch(`${G.backendUrl()}/health`).catch(() => {});

  penStroke(document.querySelector('.home .pen'));
  homeDemo();
  reveal();
  route();
})();
