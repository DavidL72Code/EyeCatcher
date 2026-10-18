/* Thirdeye app: the start screen, the review screen, and past reviews. The coach (agent.js) does the reviewing; this
 * file opens the recording, makes and uploads the scan copy, draws everything the coach does onto the match timeline,
 * and puts its questions to the player. Everything a review draws is kept in its log, so a past review is the same
 * screen drawn again from that log, with the recording, frames, and report. */
(function () {
  const G = window.Gemini, C = window.ThirdeyeCore, V = window.ThirdeyeVideo, A = window.ThirdeyeAgent, L = window.ThirdeyeLearn, R = window.ThirdeyeReviews;
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
    $('historyBtn').hidden = !history.matches.length || (run && !run.done && !run.replay);
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
    if (!window.showOpenFilePicker || input.dataset.plain) return;
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

  dropTarget($('drop'), (f, h) => start(f, h));
  withPicker($('fileInput'), (f, h) => start(f, h));
  $('fileInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) start(f); });
  $('keyBox').addEventListener('submit', (e) => { e.preventDefault(); G.setKey($('keyInput').value); $('keyInput').value = ''; renderStart(); });
  $('sampleBtn').addEventListener('click', async () => {
    const blob = await (await fetch('tests/fixtures/match.mp4')).blob();
    start(new File([blob], 'synthetic-test-match.mp4', { type: 'video/mp4' }));
  });
  fetch('tests/fixtures/match.mp4', { method: 'HEAD' }).then((r) => { $('sampleBtn').hidden = !r.ok; }, () => {});

  // ---------- a review ----------
  async function start(file, handle = null) {
    if (!G.hasKey()) { show('start'); $('keyBox').hidden = false; $('keyInput').focus(); return; }
    if (location.hash) window.history.pushState(null, '', location.pathname + location.search);
    show('review');
    const player = $('playerName').value.trim();
    write(NAME, player);
    run = { id: uid(), file, handle: null, game: null, goal: $('goal').value.trim(), player, workingOn: null, abort: new AbortController(), looks: 0, turns: 0, calls: 0, beat: null, log: [] };
    const mine = run;
    Promise.resolve(handle).then((h) => { if (h?.kind === 'file') mine.handle = h; }, () => {});
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
      const sources = (r.sources || []).map((x) => `<a href="${esc(x.uri)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a>`).join(', ');
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
    stopStatus();
  }

  function setVideo(file) {
    if (vid.src) URL.revokeObjectURL(vid.src);
    vid.src = URL.createObjectURL(file);
    run.file = file;
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
    if (e.type === 'scan') { drawEvents(e.events); addMark('scanned', e.from, e.to); run.calls += e.calls; drawMeter(); beatOut(scanLine(e.counts)); }
    if (e.type === 'look') { run.looks++; addMark(e.kind === 'measure' ? 'look measure' : 'look', e.from, e.to); moveEye((e.from + e.to) / 2); drawMeter(); }
    if (e.type === 'aim_call') { run.calls++; drawMeter(); }
    if (e.type === 'hud') { run.calls++; drawMeter(); beatShots(e.shots, e.values[0]?.t ?? 0); beatOut(e.values.map((v) => `${C.mmss(v.t, true)} ${v.value ?? '(unreadable)'}`).join(' · ')); }
    if (e.type === 'frames') beatShots(shown(e.frames), e.t);
    if (e.type === 'measure') beatShots([e.shot], e.t, e);
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
  let clipEnd = null;
  function playClip(from, to) {
    if (!hasVideo()) return nudge();
    clipEnd = to;
    seek(from);
    vid.play().catch(() => {});
  }
  vid.addEventListener('timeupdate', () => { if (clipEnd != null && vid.currentTime >= clipEnd) { vid.pause(); clipEnd = null; } });
  vid.addEventListener('seeking', () => { if (clipEnd != null && Math.abs(vid.currentTime - clipEnd) > 6) clipEnd = null; });
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
    const match = { id: run.id, date: today(), name: run.video.name, game: run.game.name, found: r.found, habit: r.habit, habitId: r.habitId, drill: r.drill, recheck: r.recheck, aim: r.aim, progress: r.progress, stats: r.stats, status: 'new' };
    history = C.addMatch(history, match);
    write(STORE, history);
    files.set(run.id, run.file);
    window.history.replaceState(null, '', `#review/${run.id}`);
    renderReport(r, match);
    renderStart();

    const moments = reportMoments(r);
    const thumbs = moments.length ? (await V.grab(run.video, moments.map((e) => e.t), { maxDim: 320, quality: 0.72 }).catch(() => [])).map((s) => ({ t: s.t, url: s.url })) : [];
    paintThumbs(thumbs);
    const v = run.video, learned = run.log.find(([, e]) => e.type === 'learned')?.[1];
    const record = {
      id: run.id, date: match.date, calls: run.calls, goal: run.goal, player: run.player, workingOn: run.workingOn, game: run.game,
      video: { name: v.name, size: v.size, lastModified: v.file.lastModified, duration: v.duration },
      result: slim(r), log: run.log, thumbs, handle: run.handle,
    };
    recent.set(run.id, record);
    try {
      await R.save(record, thumbs[0]?.url || (learned && await smaller(learned.shot.url)));
      await R.keep(history.matches.map((m) => m.id));
    } catch (e) { console.warn("This review's log couldn't be saved on this device.", e); }
  }

  // the moments the report shows with a frame: the habit's, or with no habit, what to do better
  const reportMoments = (r) => (r.found ? r.evidence : r.fixes || []);

  function renderReport(r, match) {
    const past = run.replay;
    $('review').classList.add('done');
    ['question', 'board', 'meter'].forEach((id) => { $(id).hidden = true; });
    $('eyeMark').hidden = true;
    const v = $('verdict');
    const working = run.workingOn && r.progress ? `<p class="progress ${r.progress}">${esc(run.workingOn.name)}: ${PROGRESS[r.progress]}${r.progressFrom === 'measured' ? ` (${Math.abs(run.workingOn.baseline.heads).toFixed(1)} to ${Math.abs(r.aim.heads).toFixed(1)} heads)` : ''}</p>` : '';
    const moments = reportMoments(r), instead = moments.some((e) => e.better);
    const list = moments.length ? `<ol class="evidence">${moments.map((e, i) => `<li><button type="button" data-t="${e.t}"><span class="thumb" data-thumb="${i}"><span class="n">${i + 1}</span></span><span class="m"><span class="tt">${C.mmss(e.t)}</span><span class="wt">${esc(e.what)}</span>${e.better ? `<span class="bt"><span class="k">Instead</span> ${esc(e.better)}</span>` : ''}</span></button></li>`).join('')}</ol>` : '';
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
    $('againBtn')?.addEventListener('click', () => (run.file ? start(run.file, run.handle || run.rec?.handle) : nudge()));

    // the log: every theory it tested, then every step in order, open on a past review
    const steps = $('beats').children.length;
    $('log').hidden = !steps && !r.board?.length;
    $('logSummary').textContent = `How it got here: ${run.calls} calls, ${r.stats?.looks ?? run.looks} looks`;
    drawBoard($('finalBoard'), r.board || [], false);
    $('logBody').append($('breakdown'));
    [...$('beats').children].reverse().forEach((li) => $('beats').append(li));
    $('logBox').open = past;
    if (!past) v.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    moments.forEach((e, i) => {
      const pin = document.createElement('button');
      pin.className = 'pin';
      pin.type = 'button';
      pin.dataset.t = e.t;
      pin.style.left = pct(e.t);
      pin.style.animationDelay = `${i * 80}ms`;
      pin.textContent = i + 1;
      pin.setAttribute('aria-label', `Moment ${i + 1} at ${C.mmss(e.t)}`);
      timeline.append(pin);
    });
  }

  function paintThumbs(thumbs) {
    thumbs.forEach((s, i) => { const el = $('verdict').querySelector(`[data-thumb="${i}"]`); if (el) el.style.backgroundImage = `url(${s.url})`; });
  }

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

  async function showReviews() {
    show('reviews');
    renderStart();
    const thumbs = await R.thumbs().catch(() => ({}));
    $('cards').innerHTML = [...history.matches].reverse().map((m) => {
      const tag = tagOf(m);
      return `<li><a class="card" href="#review/${esc(m.id)}">
        <span class="c-shot">${thumbs[m.id] ? `<img src="${thumbs[m.id]}" alt="" />` : '<svg aria-hidden="true"><use href="#eye" /></svg>'}${tag ? `<span class="c-tag${tag.on ? ' on' : ''}">${esc(tag.text)}</span>` : ''}</span>
        <span class="c-habit${m.found ? '' : ' none'}">${esc(m.found ? m.habit : 'No single habit')}</span>
        <span class="c-meta">${niceDate(m.date)} · ${esc(m.game || m.name)}</span>
      </a></li>`;
    }).join('') || '<li class="c-empty">No reviews yet.</li>';
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
    $('crumbs').innerHTML = `<a class="back" href="#reviews"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" /></svg>All reviews</a><span>${niceDate(m.date)} · ${esc(m.game || '')} · ${esc(m.name)}</span>`;
    if (!rec) {
      $('review').classList.add('bare');
      $('stage').hidden = true;
      renderReport({ found: m.found, habit: m.habit, habitId: m.habitId, drill: m.drill, recheck: m.recheck, aim: m.aim, progress: m.progress, stats: m.stats, evidence: [], contrast: [], fixes: [], board: [] }, m);
      $('verdict').insertAdjacentHTML('beforeend', '<p class="older">Saved before reviews kept their log and frames.</p>');
      return;
    }
    drawAxis();
    drawLegend(rec.game);
    for (const [kind, e] of rec.log) (kind === 'event' ? onEvent : onStep)(e);
    run.calls = rec.calls;
    renderReport(rec.result, m);
    paintThumbs(rec.thumbs || []);
    await attachRecording(rec);
  }

  // The recording comes from this visit, from the saved file handle (the browser may ask once), or from the player.
  async function attachRecording(rec) {
    const mine = run;
    const use = (file) => {
      if (run !== mine) return;
      if (file.size !== rec.video.size) return reattach(rec, "That's a different recording.");
      files.set(rec.id, file);
      setVideo(file);
    };
    if (files.has(rec.id)) return use(files.get(rec.id));
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

  $('playerName').value = read(NAME, '');
  penStroke(document.querySelector('.start .pen'));
  route();
})();
