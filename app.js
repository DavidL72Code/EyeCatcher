/* Thirdeye app: the start screen, the review screen, and past reviews. The coach (agent.js) does the reviewing; this
 * file opens the recording, makes and uploads the scan copy, draws everything the coach does onto the match timeline,
 * and puts its questions to the player. Everything a review draws is kept in its log, so a past review is the same
 * screen drawn again from that log, with the recording, frames, and report. */
(function () {
  const G = window.Gemini, C = window.ThirdeyeCore, V = window.ThirdeyeVideo, A = window.ThirdeyeAgent, L = window.ThirdeyeLearn, R = window.ThirdeyeReviews, K = window.ThirdeyeReport;
  // the desktop app (desktop/preload.cjs): it remembers where each recording is on disk, so nothing is copied
  const D = window.thirdeyeDesktop || null;
  G.preferEnv = true;
  const STORE = 'thirdeye.v1', UPLOADS = 'thirdeye.uploads', NAME = 'thirdeye.player', LEARNED = 'thirdeye.learned';
  const BUDGET = { looks: 24, turns: 12 };
  const REGION_NAMES = { aim: 'aim area', killfeed: 'kill feed', minimap: 'minimap', scoreboard: 'scoreboard', health: 'health bar', ammo: 'ammo', board: 'board', player_clock: 'your clock', opponent_clock: 'their clock', gold: 'gold', abilities: 'abilities' };
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
  function show(id) {
    for (const s of ['start', 'review', 'reviews']) $(s).hidden = s !== id;
    if (id === 'reviews') $('historyBtn').setAttribute('aria-current', 'page');
    else $('historyBtn').removeAttribute('aria-current');
  }

  // #reviews is the list, #review/<id> one past review, anything else the start screen. A live review isn't in the
  // address until it's saved, so leaving it stops it.
  async function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (run && !run.done && !run.replay) run.abort.abort();
    if (h === 'reviews') return showReviews();
    if (h.startsWith('review/')) return openPast(h.slice(7));
    show('start');
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
    $('historyBtn').hidden = !!(run && !run.done && !run.replay);
    // the desktop app's Thirdeye folder, once the player chose to keep recordings there
    D?.library().then((where) => { $('libraryBtn').hidden = !where; $('libraryBtn').textContent = 'Recordings folder'; $('libraryBtn').title = where || ''; }, () => {});
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
    if (location.hash) window.history.pushState(null, '', location.pathname + location.search);
    show('review');
    const player = $('playerName').value.trim();
    write(NAME, player);
    run = { id: uid(), file, handle: null, game: null, goal: $('goal').value.trim(), player, workingOn: null, abort: new AbortController(), looks: 0, turns: 0, calls: 0, beat: null, log: [] };
    const mine = run;
    Promise.resolve(handle).then((h) => { if (h?.kind === 'file') mine.handle = h; }, () => {});
    mine.place = place ? Promise.resolve(place) : D ? D.remember(file).catch(() => null) : Promise.resolve(null);
    // a recording the desktop app can find again by its path isn't copied
    mine.kept = mine.place.then((p) => !p && R.keepRecording(file)).catch((e) => { console.warn("The recording couldn't be kept for past reviews.", e); return false; });
    resetReview();
    renderStart();
    setVideo(file);
    setStatus('Opening the recording');
    try {
      run.video = await V.open(file);
      drawAxis();
      run.game = await learnGame(run.video, run.abort.signal);
      const game = run.game, seen = C.historyFor(history, game.name);
      run.workingOn = seen.habit;
      drawLegend(game);
      run.scanFile = await scanCopy(run.video, run.abort.signal);
      drawMeter();
      setStatus('Deciding where to look');
      const result = await A.review({
        video: run.video, file: run.scanFile, profile: game, history: seen, goal: run.goal, player: run.player || null, budget: C.createBudget(BUDGET),
        ask, onEvent: emit, onStep: step, signal: run.abort.signal,
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
    if (!run.replay) run.log.push(['event', slim(e.type === 'frames' ? { ...e, frames: shown(e.frames) } : e)]);
    onEvent(e);
  }
  function step(s) {
    if (!run.replay && ['think', 'call', 'error'].includes(s.type)) run.log.push(['step', slim({ type: s.type, name: s.name, args: s.args, error: s.error })]);
    onStep(s);
  }

  // The game is learned from the recording (learn.js): one model call, kept for a day per recording like the scan copy.
  // The first breakdown card shows what was found, boxed on the frame it was read from.
  async function learnGame(video, signal) {
    const sig = `${video.name}|${video.size}|${video.file.lastModified}`;
    const cache = read(LEARNED, {});
    for (const [k, v] of Object.entries(cache)) if (!(v.expires > Date.now())) delete cache[k];
    setStatus('Reading the screen');
    let profile = cache[sig]?.profile, frames = null;
    if (!profile) {
      const r = await L.learnGame({ video, signal, onNotice: (n) => setStatus(n) });
      profile = r.profile;
      frames = r.frames;
      cache[sig] = { profile, expires: Date.now() + 24 * 3600e3 };
      write(LEARNED, cache);
    }
    const [shot] = frames ? [frames[Math.floor(frames.length / 2)]] : await V.grab(video, [video.duration / 2], { maxDim: 1024, quality: 0.8 });
    emit({ type: 'learned', profile, shot, called: !!frames });
    return profile;
  }
  function drawLearned({ profile, shot, called }) {
    if (called) run.calls++;
    drawMeter();
    beatStart({ name: 'learn', why: `${profile.name}${profile.genre !== 'other' ? `, ${profile.genre}` : ''}` });
    const boxes = Object.entries(profile.regions).filter(([r]) => r !== 'aim').map(([r, [x, y, w, h]]) => `<span class="el" style="left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%"><span>${esc(REGION_NAMES[r] || r.replace(/_/g, ' '))}</span></span>`).join('');
    run.beat.querySelector('.beat-shots').innerHTML = `<figure class="screen-map"><img src="${shot.url}" data-ft="${shot.t}" alt="What the coach read on screen" />${boxes}</figure>`;
    const found = Object.keys(profile.regions).filter((r) => r !== 'aim').map((r) => REGION_NAMES[r] || r.replace(/_/g, ' '));
    beatOut(found.length ? `Found: ${found.join(', ')}` : 'Found no screen elements to read', 'muted');
    if (profile.regions.killfeed) beatOut(profile.killfeedGrid && profile.killfeedColors ? 'Kill feed rows and team colors measured' : "Kill feed seen, but its rows couldn't be measured: fights come from a low-detail pass", 'muted');
    // what matters in this game, and where that came from
    const r = profile.research;
    if (r) {
      // only web links: a source address can't become a script
      const sources = (r.sources || []).map((x) => (/^https:\/\//i.test(x.uri) ? `<a href="${esc(x.uri)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a>` : esc(x.title))).join(', ');
      run.beat.querySelector('.beat-outs').insertAdjacentHTML('beforeend', `<div class="matters"><p class="beat-out"><b>What matters in ${esc(profile.name)}:</b> ${r.priorities.slice(0, 4).map(esc).join(' · ')}</p><p class="beat-out muted">${r.researched ? `From ${r.sources.length} source${r.sources.length === 1 ? '' : 's'}: ${sources}` : "From the model's own knowledge: web search wasn't available"}</p></div>`);
    }
  }

  // The scan copy is made and sent once per recording; Gemini keeps it for 48 hours, so a rerun within a day reuses it.
  async function scanCopy(video, signal) {
    const sig = `${video.name}|${video.size}|${video.file.lastModified}`;
    const cache = read(UPLOADS, {});
    for (const [k, v] of Object.entries(cache)) if (!(v.expires > Date.now())) delete cache[k];
    if (cache[sig]) return cache[sig].file;
    const pct = (p) => `${Math.round(p * 100)}%`;
    setStatus('Making the scan copy', '', '0%');
    const blob = await V.makeProxy(video, { signal, onProgress: (p) => setStatus('Making the scan copy', '', pct(p)) });
    setStatus('Sending the scan copy', '', '0%');
    const file = await V.upload(blob, { name: video.name.slice(0, 80), signal, onProgress: (p) => setStatus('Sending the scan copy', '', pct(p)) });
    cache[sig] = { file, expires: Date.now() + 24 * 3600e3 };
    write(UPLOADS, cache);
    return file;
  }

  function resetReview() {
    ['track', 'axis', 'beats', 'board', 'verdict', 'question', 'crumbs', 'reattach'].forEach((id) => { $(id).innerHTML = ''; });
    ['breakdown', 'board', 'verdict', 'question', 'meter', 'log', 'crumbs', 'reattach'].forEach((id) => { $(id).hidden = true; });
    $('finalBoard').innerHTML = '';
    $('board').after($('breakdown')); // a finished review moves it into the log
    timeline.querySelectorAll('.pin').forEach((p) => p.remove());
    $('review').classList.remove('done', 'bare');
    $('stage').hidden = false;
    $('eyeMark').hidden = true;
    hideVideoMarks();
    stopStatus();
  }

  function setVideo(file) { setVideoUrl(URL.createObjectURL(file)); run.file = file; }
  function setVideoUrl(url) {
    if (vid.src.startsWith('blob:')) URL.revokeObjectURL(vid.src);
    vid.src = url;
    run.file = null;
    $('reattach').hidden = true;
  }

  function drawLegend(game) {
    $('legend').innerHTML = game?.genre === 'chess' ? '<li class="k-death">Your blunder</li><li class="k-ally">Your mistake</li><li class="k-look">Looked at</li>' : '<li class="k-kill">Your kill</li><li class="k-death">Your death</li><li class="k-ally">Teammate died</li><li class="k-fight">Fight</li><li class="k-look">Looked at</li>';
  }

  const LINES = {
    scan: (a) => `Reading the match ${a.from}–${a.to}`,
    frames: (a) => `Looking at ${a.at}${a.region && a.region !== 'full' ? `, ${REGION_NAMES[a.region] || a.region}` : ''}`,
    measure_aim: (a) => `Measuring aim at ${a.at}${a.more?.length ? ` and ${a.more.length} more` : ''}`,
    ask_player: () => 'Waiting for you',
    finish: () => 'Checking the finding',
  };
  function onStep(s) {
    if (s.type === 'think') { run.turns++; run.calls++; drawMeter(); setStatus(run.turns === 1 ? 'Deciding where to look' : 'Deciding what to check next'); }
    if (s.type === 'call') setStatus(LINES[s.name]?.(s.args) || s.name, s.name === 'ask_player' ? 'waiting' : '');
    if (s.type === 'error') beatOut(`Didn't work: ${short(s.error)}`, 'warn');
  }

  function onEvent(e) {
    if (e.type === 'learned') drawLearned(e);
    if (e.type === 'scanning' && e.progress != null) setStatus(`Reading the match ${C.mmss(e.from)}–${C.mmss(e.to)}`, '', `${Math.round(e.progress * 100)}%`);
    if (e.type === 'step') beatStart(e);
    if (e.type === 'scan') { run.events = e.events; drawEvents(e.events); addMark('scanned', e.from, e.to); run.calls += e.calls; drawMeter(); beatOut(scanLine(e.counts)); }
    if (e.type === 'look') { run.looks++; addMark(e.kind === 'measure' ? 'look measure' : 'look', e.from, e.to); moveEye((e.from + e.to) / 2); drawMeter(); }
    if (e.type === 'aim_call') { run.calls++; drawMeter(); }
    if (e.type === 'hud') { run.calls++; drawMeter(); beatShots(e.shots, e.values[0]?.t ?? 0); beatOut(e.values.map((v) => `${C.mmss(v.t, true)} ${v.value ?? '(unreadable)'}`).join(' · ')); }
    if (e.type === 'frames') beatShots(shown(e.frames), e.t);
    if (e.type === 'measure') beatShots([e.shot], e.t, e);
    if (e.type === 'shots') (run.shotsAt ||= []).push({ t: e.t, fired: e.fired });
    if (e.type === 'shots' && e.fired != null) beatOut(`${C.mmss(e.t, true)}: ${e.fired ? 'fired (ammo counter moved)' : 'no shots (ammo counter never moved)'}`, 'muted');
    if (e.type === 'refused') beatOut(`${C.mmss(e.t, true)} not measured: this fight was tried twice`, 'muted');
    if (e.type === 'skipped') beatOut(`${C.mmss(e.t, true)} skipped: you were dead (${C.mmss(e.death)})`, 'muted');
    if (e.type === 'answered') beatOut(e.answer ? `You said: ${e.answer}` : 'You skipped it', 'muted');
    if (e.type === 'note') { drawBoard($('board'), e.board, true); beatTake(e.theory, e.change); }
    if (e.type === 'rejected') { setStatus('Finding sent back'); beatOut(`Sent back: ${short(e.problems[0])}`, 'warn'); }
    if (e.type === 'accepted') beatOut('Passed the evidence checks', 'muted');
    if (e.type === 'decide') beatOut('Sent back twice for the same reason: it has to decide now', 'warn');
    if (e.type === 'forced') { setStatus('Ending without a habit'); beatOut(`Couldn't back ${e.habit}: no habit named`, 'warn'); }
  }

  // ---------- the breakdown: one card per step, as it happens ----------
  // A card says what the coach checks (its own words), what it saw (frames, a measured box), and what it made of it. The
  // coach writes its take on a look with its next step, so theory changes land on the card before the new one.
  const KIND = { learn: 'Reading the screen', scan: 'The match record', frames: 'Close look', measure_aim: 'Aim check', read_hud: 'Reading the screen', ask_player: 'Question', finish: 'Finding' };
  const short = (text) => { const first = String(text).split(/(?<=\.)\s/)[0]; return first.length > 110 ? `${first.slice(0, 107)}…` : first; };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const scanLine = (c) => (c.your_moves != null ? `${plural(c.your_moves, 'move')}: ${plural(c.your_blunders, 'blunder')}, ${plural(c.your_mistakes, 'mistake')}` : `${c.fights ? `${plural(c.fights, 'fight')} (${c.fights_won} won, ${c.fights_lost} lost, ${c.fights_no_one_fell} no one fell); ` : ''}${plural(c.your_kills, 'kill')}, ${plural(c.your_deaths, 'death')}, ${c.teammate_deaths} teammate${c.teammate_deaths === 1 ? '' : 's'} down`);
  function beatStart({ name, why }) {
    $('breakdown').hidden = false;
    const li = document.createElement('li');
    li.className = `beat ${name}`;
    li.innerHTML = `<p class="beat-kind">${KIND[name] || esc(name)}</p>${why ? `<p class="beat-why">${esc(why)}</p>` : ''}<div class="beat-shots"></div><div class="beat-outs"></div><ul class="beat-take"></ul>`;
    $('beats').prepend(li);
    run.beat = li;
    li.times = [];
  }
  function beatShots(frames, t, measure) {
    const box = run.beat?.querySelector('.beat-shots');
    if (!box) return;
    const m = measure?.measure, b = m?.box;
    run.beat.times.push(t);
    const group = document.createElement('figure');
    group.className = measure ? 'shot-group aim' : 'shot-group';
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
    for (const f of events.filter((x) => x.kind === 'engagement')) {
      const el = document.createElement('div');
      el.className = `fight ${f.outcome}`;
      el.style.left = pct(f.from);
      el.style.width = `calc(${pct(f.to)} - ${pct(f.from)})`;
      el.title = `${C.mmss(f.from)}–${C.mmss(f.to)} fight: ${f.text}`;
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

  // ---------- the verdict and the report ----------
  async function finishReview(r) {
    stopStatus();
    run.done = true;
    const match = { id: run.id, date: today(), name: run.video.name, video: { size: run.video.size, lastModified: run.video.file.lastModified }, game: run.game.name, found: r.found, habit: r.habit, habitId: r.habitId, drill: r.drill, recheck: r.recheck, aim: r.aim, progress: r.progress, stats: r.stats, status: 'new' };
    history = C.addMatch(history, match);
    write(STORE, history);
    files.set(run.id, run.file);
    window.history.replaceState(null, '', `#review/${run.id}`);
    const moments = reportMoments(r);
    run.keys = moments.map((e) => ({ t: e.t }));
    renderReport(r, match);
    renderStart();

    // each key moment: its frame first, marked from measurements, then the rest marked in one model call
    const mine = run, v = run.video;
    const { keys, shots } = await K.prepare({ video: v, profile: run.game, moments, measures: r.measures }).catch(() => ({ keys: run.keys, shots: [] }));
    if (mine !== run) return;
    run.keys = keys;
    keys.forEach((_, i) => paintKey(i));
    const before = keys.map((k) => !!(k.problem || k.fix));
    const called = await K.mark({ keys, shots, moments, profile: run.game, habit: r.found ? r.habit : '', signal: run.abort.signal }).catch(() => 0);
    if (mine !== run) return;
    if (called) { run.calls += called; paintLogSummary(r); }
    keys.forEach((k, i) => { if (!before[i] && (k.problem || k.fix)) paintKey(i); });

    const learned = run.log.find(([, e]) => e.type === 'learned')?.[1];
    const record = {
      id: run.id, date: match.date, calls: run.calls, goal: run.goal, player: run.player, workingOn: run.workingOn, game: run.game,
      video: { name: v.name, size: v.size, lastModified: v.file.lastModified, duration: v.duration },
      result: slim(r), log: run.log, keys: slim(keys), handle: run.handle, path: (await mine.place)?.path || null,
    };
    recent.set(run.id, record);
    try {
      const cover = keys.find((k) => k.shot)?.shot.url || learned?.shot.url;
      await R.save(record, cover && (await smaller(cover)));
      await R.keep(history.matches.map((m) => m.id));
      if (await mine.kept) await R.keepRecordings(videosOfRecent());
    } catch (e) { console.warn("This review's log couldn't be saved on this device.", e); }
  }

  // the recordings of the newest reviews, newest first: those copies are kept
  const videosOfRecent = () => [...history.matches].reverse().map((m) => m.video);

  // the moments the report shows with a frame: the habit's, or with no habit, what to do better
  const reportMoments = (r) => (r.found ? r.evidence : r.fixes || []);

  function renderReport(r, match) {
    const past = run.replay;
    $('review').classList.add('done');
    ['question', 'board', 'meter'].forEach((id) => { $(id).hidden = true; });
    $('eyeMark').hidden = true;
    const v = $('verdict');
    const working = run.workingOn && r.progress ? `<p class="progress ${r.progress}">${esc(run.workingOn.name)}: ${PROGRESS[r.progress]}${r.progressFrom === 'measured' ? ` (${Math.abs(run.workingOn.baseline.heads).toFixed(1)} to ${Math.abs(r.aim.heads).toFixed(1)} heads)` : ''}</p>` : '';
    // the log first: each key moment says which of its steps found it
    const steps = $('beats').children.length;
    $('log').hidden = !steps && !r.board?.length;
    drawBoard($('finalBoard'), r.board || [], false);
    $('logBody').append($('breakdown'));
    [...$('beats').children].reverse().forEach((li) => $('beats').append(li));
    $('logBox').open = past;
    paintLogSummary(r);

    const moments = reportMoments(r), instead = moments.some((e) => e.better);
    run.moments = moments;
    const list = moments.length ? `<ol class="keys">${moments.map((_, i) => keyHtml(i)).join('')}</ol>` : '';
    const again = '<button class="pill primary" type="button" id="againBtn">Review again</button>';
    if (!r.found) {
      v.innerHTML = `<p class="label">${r.stopped ? 'Review stopped' : 'The verdict'}</p><h2><span class="pen">${r.stopped ? 'No verdict yet' : 'No single habit stood out'}</span></h2>${working}${r.why ? `<p class="why">${esc(r.why)}</p>` : ''}
        ${list ? `<h3>What to do better</h3>${list}` : ''}
        <div class="actions">${again}</div>`;
    } else {
      const habit = run.game?.habits?.find((h) => h.id === r.habitId);
      const metric = r.aim && (habit ? habit.measuredBy === 'aim' : /crosshair/.test(r.habitId))
        ? `<p class="metric"><b>${Math.abs(r.aim.heads).toFixed(1)}</b><span>heads ${r.aim.heads >= 0 ? 'below' : 'above'} the head when enemies appeared, median of ${r.aim.n} measured</span></p>` : '';
      const contrast = r.contrast?.length ? `<h3>Where you got it right</h3><ul class="contrast">${r.contrast.map((e) => `<li><button class="t-btn" type="button" data-t="${e.t}">${C.mmss(e.t)}</button><span>${esc(e.what)}</span></li>`).join('')}</ul>` : '';
      v.innerHTML = `<p class="label">The habit to fix</p><h2><span class="pen">${esc(r.habit)}</span></h2>${working}${metric}
        ${r.why ? `<p class="why">${esc(r.why)}</p>` : ''}
        ${list ? `<h3>${instead ? 'What to do instead' : 'Where it shows'}</h3>${list}` : ''}${contrast}
        <h3>Drill</h3><div class="drill"><p>${esc(r.drill)}</p></div>
        <p class="recheck"><b>Next match:</b> ${esc(r.recheck)}</p>
        <div class="actions" id="actions">${decisionHtml(match)}</div>`;
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
    const W = Math.round(1000 * (k.aspect || 16 / 9)), H = 1000, p = k.problem, f = k.fix;
    if (!p && !f) return '';
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
        const tl = Math.hypot(e[0] - c[0], e[1] - c[1]), tx = (e[0] - c[0]) / tl, ty = (e[1] - c[1]) / tl, L = 36, A = 0.5;
        const head = (sgn) => [e[0] - L * (tx * Math.cos(A) - sgn * ty * Math.sin(A)), e[1] - L * (ty * Math.cos(A) + sgn * tx * Math.sin(A))];
        svg.push(`<path class="good arrow" pathLength="1" d="M${n(s[0])} ${n(s[1])}Q${n(c[0])} ${n(c[1])} ${n(e[0])} ${n(e[1])}" /><path class="good tip" d="M${head(1).map(n).join(' ')}L${n(e[0])} ${n(e[1])}L${head(-1).map(n).join(' ')}" />`);
      }
    }
    // Labels go on the far sides of their marks (the lower mark's below it, the higher one's above), flipped at the
    // frame's edges and kept off its sides.
    const chip = (r, cls, text, prefer) => {
      const below = prefer === 'below' ? (r.cy + r.ry) / H < 0.84 : (r.cy - r.ry) / H < 0.16;
      const y = below ? (r.cy + r.ry) / H : (r.cy - r.ry) / H;
      chips.push(`<span class="chip ${cls}${below ? '' : ' up'}" style="left:${Math.min(84, Math.max(16, (r.cx / W) * 100)).toFixed(1)}%;top:${(y * 100).toFixed(1)}%">${esc(text)}</span>`);
    };
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
      if (!k || !(k.problem || k.fix)) return;
      v.innerHTML = marksHtml(k);
      v.hidden = false;
      placeVideoMarks();
    });
  }
  function hideVideoMarks() { $('vmarks').hidden = true; $('vmarks').innerHTML = ''; markedAt = null; }
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
    $('actions').innerHTML = decisionHtml(match);
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

  // ---------- past reviews ----------
  const TAGS = { better: 'Better', same: 'Same', worse: 'Worse' };
  const tagOf = (m) => (history.habit?.matchId === m.id ? { text: 'Working on', on: true } : TAGS[m.progress] ? { text: TAGS[m.progress] } : m.status === 'rejected' ? { text: 'Not this' } : null);

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
        <span class="c-habit${m.found ? '' : ' none'}">${esc(m.found ? m.habit : 'No single habit')}</span>
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
    show('review');
    resetReview();
    if (vid.src) URL.revokeObjectURL(vid.src);
    vid.removeAttribute('src');
    vid.load();
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
    for (const [kind, e] of rec.log) (kind === 'event' ? onEvent : onStep)(e);
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
      (D ? D.remember(file) : Promise.resolve(null)).then((p) => {
        if (p) { rec.path = p.path; return R.save(rec); }
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

  $('playerName').value = read(NAME, '');
  penStroke(document.querySelector('.start .pen'));
  route();
})();
