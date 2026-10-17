/* Thirdeye app: the start screen, the review screen, and past reviews. The coach (agent.js) does the reviewing; this
 * file opens the recording, makes and uploads the scan copy, draws everything the coach does onto the match timeline,
 * and puts its questions to the player. */
(function () {
  const G = window.Gemini, C = window.ThirdeyeCore, V = window.ThirdeyeVideo, A = window.ThirdeyeAgent;
  G.preferEnv = true;
  const STORE = 'thirdeye.v1', UPLOADS = 'thirdeye.uploads', NAME = 'thirdeye.player';
  const BUDGET = { looks: 30, turns: 30 };
  const REGION_NAMES = { aim: 'aim area', killfeed: 'kill feed', minimap: 'minimap', scoreboard: 'scoreboard', health: 'health bar' };
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
  const profiles = {};
  let run = null;

  // ---------- telestrator underline ----------
  function penStroke(el) {
    if (!el || el.querySelector('svg.stroke')) return;
    el.insertAdjacentHTML('beforeend', '<svg class="stroke" viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" vector-effect="non-scaling-stroke" filter="url(#marker)" style="stroke-width:0.12em" d="M3 9.6C40 6 86 4.4 129 6.5c24 1.2 45 2.3 68-.8" /></svg>');
  }

  // ---------- status: one spinner, one line ----------
  let tick = null;
  function setStatus(text, mode = '', extra = '') {
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

  // ---------- start screen ----------
  async function profile(id) { return (profiles[id] ||= await (await fetch(`games/${id}.json`)).json()); }

  function renderStart() {
    $('keyBox').hidden = G.hasKey();
    const h = history.habit;
    $('working').hidden = !h;
    if (h) {
      $('working').innerHTML = `<svg aria-hidden="true"><use href="#eye" /></svg><p>Working on <b>${esc(h.name)}</b> since ${niceDate(h.since)}. Your next review checks it.</p><button class="quiet" type="button" id="dropHabit">Stop</button>`;
      $('dropHabit').onclick = () => { history = C.dropHabit(history); write(STORE, history); renderStart(); };
    }
    $('historyBtn').hidden = !history.matches.length;
    $('historyCount').textContent = history.matches.length || '';
  }

  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) start(f); });
  $('fileInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) start(f); });
  $('keyBox').addEventListener('submit', (e) => { e.preventDefault(); G.setKey($('keyInput').value); $('keyInput').value = ''; renderStart(); });
  $('sampleBtn').addEventListener('click', async () => {
    const blob = await (await fetch('tests/fixtures/match.mp4')).blob();
    start(new File([blob], 'synthetic-test-match.mp4', { type: 'video/mp4' }));
  });
  fetch('tests/fixtures/match.mp4', { method: 'HEAD' }).then((r) => { $('sampleBtn').hidden = !r.ok; }, () => {});

  // ---------- a review ----------
  async function start(file) {
    if (!G.hasKey()) { $('keyBox').hidden = false; $('keyInput').focus(); return; }
    const game = await profile($('game').value);
    $('start').hidden = true;
    $('review').hidden = false;
    const player = $('playerName').value.trim();
    write(NAME, player);
    run = { id: uid(), file, game, goal: $('goal').value.trim(), player, workingOn: history.habit, abort: new AbortController(), steps: [], looks: 0, turns: 0 };
    resetReview();
    if (vid.src) URL.revokeObjectURL(vid.src);
    vid.src = URL.createObjectURL(file);
    setStatus('Opening the recording');
    try {
      run.video = await V.open(file);
      drawAxis();
      run.scanFile = await scanCopy(run.video, run.abort.signal);
      drawMeter();
      setStatus('Deciding where to look');
      const result = await A.review({
        video: run.video, file: run.scanFile, profile: game, history, goal: run.goal, player: run.player || null, budget: C.createBudget(BUDGET),
        ask, onEvent, onStep, signal: run.abort.signal,
        onNotice: (n) => setStatus(n, '', ''),
      });
      await showResult(result);
    } catch (e) {
      if (e.name === 'AbortError') return setStatus('Stopped. Pick the match again to restart.', 'error');
      console.error(e);
      setStatus(e.message || String(e), 'error');
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
    ['track', 'axis', 'strip', 'board', 'verdict', 'question'].forEach((id) => { $(id).innerHTML = ''; });
    ['strip', 'board', 'verdict', 'question', 'meter'].forEach((id) => { $(id).hidden = true; });
    $('eyeMark').hidden = true;
  }

  const LINES = {
    scan: (a) => `Reading the kill feed ${a.from}–${a.to}`,
    frames: (a) => `Looking at ${a.at}${a.region && a.region !== 'full' ? `, ${REGION_NAMES[a.region] || a.region}` : ''}`,
    measure_aim: (a) => `Measuring aim at ${a.at}`,
    ask_player: () => 'Waiting for you',
    note: () => 'Updating its theories',
    finish: () => 'Checking the finding',
  };
  function onStep(s) {
    if (s.type === 'think') { run.turns++; setStatus(run.turns === 1 ? 'Deciding where to look' : 'Deciding what to check next'); }
    if (s.type === 'call') {
      setStatus(LINES[s.name]?.(s.args) || s.name, s.name === 'ask_player' ? 'waiting' : '');
      run.steps.push(`${s.name}${s.args.at ? ` ${s.args.at}` : s.args.from ? ` ${s.args.from}–${s.args.to}` : ''}${s.args.region ? ` (${s.args.region})` : ''}${s.args.theory ? `: ${s.args.theory}` : ''}`);
    }
    if (s.type === 'error') run.steps.push(`  ${s.name} failed: ${s.error}`);
  }

  function onEvent(e) {
    if (e.type === 'scanning' && e.progress != null) setStatus(`Reading the kill feed ${C.mmss(e.from)}–${C.mmss(e.to)}`, '', `${Math.round(e.progress * 100)}%`);
    if (e.type === 'scan') { drawEvents(e.events); addMark('scanned', e.from, e.to); }
    if (e.type === 'look') { run.looks++; addMark(e.kind === 'measure' ? 'look measure' : 'look', e.from, e.to); moveEye((e.from + e.to) / 2); drawMeter(); }
    if (e.type === 'frames') showStrip(e.frames);
    if (e.type === 'measure') showStrip([e.shot], e);
    if (e.type === 'note') drawBoard($('board'), e.board, true);
    if (e.type === 'rejected') { setStatus('Finding sent back for more evidence'); run.steps.push(`  finish sent back: ${e.problems.join(' ')}`); }
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
    track.querySelectorAll('.tick, .round').forEach((n) => n.remove());
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
    for (const e of events.filter((x) => ['kill', 'death', 'ally_death'].includes(x.kind))) {
      const el = document.createElement('div');
      el.className = `tick ${e.kind === 'ally_death' ? 'ally' : e.kind}`;
      el.style.left = pct(e.t);
      el.title = `${C.mmss(e.t)} ${e.text || e.kind}`;
      track.append(el);
    }
  }
  function moveEye(t) { const m = $('eyeMark'); m.hidden = false; m.style.left = pct(t); }
  function drawMeter() {
    $('meter').hidden = false;
    $('meterTicks').innerHTML = Array.from({ length: BUDGET.looks }, (_, i) => `<i class="${i < run.looks ? 'on' : ''}"></i>`).join('');
    $('meterText').textContent = `${run.looks} of ${BUDGET.looks} looks`;
  }

  function paintPlayhead() {
    if (!run?.video) return;
    $('playhead').style.left = pct(vid.currentTime);
    timeline.setAttribute('aria-valuenow', Math.round(vid.currentTime));
    timeline.setAttribute('aria-valuetext', C.mmss(vid.currentTime));
  }
  vid.addEventListener('timeupdate', paintPlayhead);
  vid.addEventListener('play', function loop() { paintPlayhead(); if (!vid.paused) requestAnimationFrame(loop); });
  function seekFromPointer(e) {
    const r = timeline.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * run.video.duration);
  }
  timeline.addEventListener('pointerdown', (e) => {
    if (!run?.video || e.target.closest('.pin')) return;
    timeline.setPointerCapture(e.pointerId);
    seekFromPointer(e);
    timeline.onpointermove = seekFromPointer;
  });
  timeline.addEventListener('pointerup', () => { timeline.onpointermove = null; });
  timeline.addEventListener('keydown', (e) => {
    if (!run?.video) return;
    const step = { ArrowLeft: -5, ArrowRight: 5, PageDown: -30, PageUp: 30 }[e.key];
    if (step) { e.preventDefault(); seek(vid.currentTime + step); }
  });
  function seek(t) { vid.currentTime = Math.max(0, Math.min(t, run.video.duration)); paintPlayhead(); }
  let clipEnd = null;
  function playClip(from, to) {
    clipEnd = to;
    seek(from);
    vid.play().catch(() => {});
  }
  vid.addEventListener('timeupdate', () => { if (clipEnd != null && vid.currentTime >= clipEnd) { vid.pause(); clipEnd = null; } });
  vid.addEventListener('seeking', () => { if (clipEnd != null && Math.abs(vid.currentTime - clipEnd) > 6) clipEnd = null; });

  // ---------- rail ----------
  function showStrip(frames, measure) {
    const s = $('strip');
    s.hidden = false;
    s.innerHTML = frames.map((f) => {
      const m = measure?.measure, b = m?.box;
      const box = b ? `<span class="box" style="top:${b[0] / 10}%;left:${b[1] / 10}%;height:${(b[2] - b[0]) / 10}%;width:${(b[3] - b[1]) / 10}%"></span>` : '';
      const note = measure ? (m ? ` · ${Math.abs(m.heads).toFixed(1)} heads ${m.heads >= 0 ? 'low' : 'high'}` : ' · no head') : '';
      return `<figure><div class="shot"><img src="${f.url}" alt="Frame at ${C.mmss(f.t, true)}" />${box}</div><figcaption>${C.mmss(f.t, true)}${note}</figcaption></figure>`;
    }).join('');
  }
  function timesHtml(evidence) {
    return evidence.map((e) => `<button class="t-btn" type="button" data-t="${e.t}" title="${esc(e.what)}">${C.mmss(e.t)}</button>`).join('');
  }
  function drawBoard(el, board, live) {
    el.hidden = !board.length;
    el.innerHTML = `<h3>${live ? 'Theories' : 'Every theory it tested'}</h3><ol>${board.map((x) => `<li class="theory ${x.status}"><span class="st">${x.status}</span><span class="what">${esc(x.theory)}</span>${x.evidence.length ? `<span class="times">${timesHtml(x.evidence)}</span>` : ''}</li>`).join('')}</ol>`;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (b && run?.video) { const t = +b.dataset.t; playClip(t - 2, t + 1.5); }
  });

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
        run.steps.push(`  asked "${question}": ${answer || 'skipped'}`);
        resolve(answer);
      };
      q.querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => done(options[+b.dataset.i]); });
      q.querySelector('[data-skip]').onclick = () => done('');
      q.querySelector('form').onsubmit = (e) => { e.preventDefault(); const v = e.target.querySelector('input').value.trim(); if (v) done(v); };
      run.abort.signal.addEventListener('abort', () => done(''), { once: true });
      q.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  // ---------- the verdict ----------
  async function showResult(r) {
    stopStatus();
    ['question', 'strip', 'board', 'meter'].forEach((id) => { $(id).hidden = true; });
    $('eyeMark').hidden = true;
    const match = { id: run.id, date: today(), name: run.video.name, game: run.game.id, found: r.found, habit: r.habit, habitId: r.habitId, drill: r.drill, recheck: r.recheck, aim: r.aim, progress: r.progress, stats: r.stats, status: 'new' };
    history = C.addMatch(history, match);
    write(STORE, history);

    const v = $('verdict');
    const how = `<details class="how"><summary>How it got here: ${r.stats.turns} calls, ${r.stats.looks} looks</summary><div class="board"></div><ol class="steps">${run.steps.map((s) => `<li>${esc(s.trim())}</li>`).join('')}</ol></details>`;
    const working = run.workingOn && r.progress ? `<p class="progress ${r.progress}">${esc(run.workingOn.name)}: ${PROGRESS[r.progress]}${r.progressFrom === 'measured' ? ` (${Math.abs(run.workingOn.baseline.heads).toFixed(1)} to ${Math.abs(r.aim.heads).toFixed(1)} heads)` : ''}</p>` : '';
    if (!r.found) {
      v.innerHTML = `<p class="label">${r.stopped ? 'Review stopped' : 'The verdict'}</p><h2><span class="pen">${r.stopped ? 'No verdict yet' : 'No single habit stood out'}</span></h2>${working}<p class="why">${esc(r.why)}</p>
        <div class="actions"><button class="pill primary" type="button" id="againBtn">Review again</button></div>${how}`;
    } else {
      const metric = r.aim && run.game.habits.find((h) => h.id === r.habitId)?.measuredBy === 'aim'
        ? `<p class="metric"><b>${Math.abs(r.aim.heads).toFixed(1)}</b><span>heads ${r.aim.heads >= 0 ? 'below' : 'above'} the head when enemies appeared, median of ${r.aim.n} measured</span></p>` : '';
      v.innerHTML = `<p class="label">The habit to fix</p><h2><span class="pen">${esc(r.habit)}</span></h2>${working}${metric}
        <p class="why">${esc(r.why)}</p>
        <h3>Where it shows</h3>
        <ol class="evidence">${r.evidence.map((e, i) => `<li><button type="button" data-t="${e.t}"><span class="thumb" data-thumb="${i}"><span class="n">${i + 1}</span></span><span><span class="tt">${C.mmss(e.t)}</span><span class="wt">${esc(e.what)}</span></span></button></li>`).join('')}</ol>
        ${r.contrast.length ? `<h3>Where you got it right</h3><ul class="contrast">${r.contrast.map((e) => `<li><button class="t-btn" type="button" data-t="${e.t}">${C.mmss(e.t)}</button><span>${esc(e.what)}</span></li>`).join('')}</ul>` : ''}
        <h3>Drill</h3><div class="drill"><p>${esc(r.drill)}</p></div>
        <p class="recheck"><b>Next match:</b> ${esc(r.recheck)}</p>
        <div class="actions" id="actions"><button class="pill primary" type="button" id="acceptBtn">Work on this</button><button class="pill" type="button" id="rejectBtn">Not this</button></div>${how}`;
      $('acceptBtn').onclick = () => decide('accepted', match);
      $('rejectBtn').onclick = () => decide('rejected', match);
    }
    v.hidden = false;
    penStroke(v.querySelector('.pen'));
    drawBoard(v.querySelector('.how .board'), r.board, false);
    $('againBtn')?.addEventListener('click', () => start(run.file));
    v.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    r.evidence.forEach((e, i) => {
      const pin = document.createElement('button');
      pin.className = 'pin';
      pin.type = 'button';
      pin.dataset.t = e.t;
      pin.style.left = pct(e.t);
      pin.style.animationDelay = `${i * 80}ms`;
      pin.textContent = i + 1;
      pin.setAttribute('aria-label', `Evidence ${i + 1} at ${C.mmss(e.t)}`);
      $('timeline').append(pin);
    });
    if (r.evidence.length) {
      const shots = await V.grab(run.video, r.evidence.map((e) => e.t), { maxDim: 320, quality: 0.72 }).catch(() => []);
      shots.forEach((s, i) => { const el = v.querySelector(`[data-thumb="${i}"]`); if (el) el.style.backgroundImage = `url(${s.url})`; });
    }
  }

  function decide(status, match) {
    history = { ...history, matches: history.matches.map((m) => (m.id === match.id ? { ...m, status } : m)) };
    if (status === 'accepted') history = C.acceptHabit(history, match);
    write(STORE, history);
    $('actions').outerHTML = `<p class="accepted">${status === 'accepted' ? 'Saved. Your next review checks this habit.' : "Noted. It won't be tracked."}</p>`;
    renderStart();
  }

  // ---------- past reviews ----------
  $('historyBtn').addEventListener('click', () => {
    const list = [...history.matches].reverse();
    $('historyList').innerHTML = list.map((m) => {
      const on = history.habit?.matchId === m.id;
      const tag = on ? 'working on' : m.progress ? m.progress : m.status === 'rejected' ? 'not this' : '';
      return `<li><span class="h-habit">${esc(m.found ? m.habit : 'No single habit')}</span>${tag ? `<span class="h-tag ${on ? 'on' : ''}">${esc(tag)}</span>` : ''}<span class="h-meta">${niceDate(m.date)} · ${esc(m.name)}</span></li>`;
    }).join('');
    $('history').showModal();
  });
  $('history').addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === $('history')) $('history').close(); });
  $('stopBtn').addEventListener('click', () => run?.abort.abort());

  $('playerName').value = read(NAME, '');
  penStroke(document.querySelector('.start .pen'));
  renderStart();
})();
