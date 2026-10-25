# Eye Catcher live: a design study

What it would take to make Eye Catcher diagnose games while they're played, what the game rules allow, what it would cost, and what to build first. This is a thinking document. No code was changed for it.

Tags used for every number and claim:
- **[n]**: a source in the list at the end. All were read on 2026-10-25 unless noted.
- **[M: where]**: measured in this repo, with where the measurement came from.
- **[E]**: my estimate, with the arithmetic shown.

## Bottom line

- **Don't build in-match coaching (mode a).** Riot bans it by name, and so do chess.com and lichess. Fortnite's competitive rules ban overlays that know the live game state. In shooters it also can't arrive in time: in all 16 frame-checked shooter losses, the decision that lost the fight ended 2 s or less before the loss.
- **Build one live pipeline with two outputs.** The first is a spectator companion (mode d), which speaks as the match plays for someone watching. The second is an instant post-match review (mode c), which keeps quiet until the player's match ends. Both stay within every game's rules checked here, with one exception: in chess, nothing may analyse the player's own game until it's over.
- **Demo the spectator companion first.** It runs on this Mac without a Windows-only game. It can be replayed from the eval recordings and graded against the 33 frame-checked losses in `eval/answer-keys/coach/`. A minimal version is about 3 days of work [E].
- **Stay on Flash-Lite through generateContent.** No Flash-Lite model works on the Gemini Live API [5]. The Live API is also likely the more expensive path, because it bills the whole session context on every turn [9][10].
- **Expected cost on Flash-Lite at list price** [E, arithmetic in Costs]:
  - spectator companion: about $0.55 per hour;
  - instant post-match: about $0.10 to $0.25 per match;
  - in-match callouts every 10 s: about $0.76 per hour, but that mode shouldn't be built;
  - the same in-match idea on the Live API: roughly $0.26 to $11.50 per hour, most likely a few dollars.

  On the free tier these modes cost nothing, but the 500 requests a day per model cap how much play each one covers.

## 1. What "live" could mean

| Mode | What the player gets, and when | Latency it needs | Rules exposure | Reuses today's code |
|---|---|---|---|---|
| **(a) In-match coaching** | A voice in the ear during play ("jungler's missing, back off") | Inside the decision window: 0–2 s in shooters, 3–5 s in League/Rocket League, 9–13 s in Clash Royale (table in 3.4) | Banned or high-risk in every game checked (section 2) | Least. It needs a new real-time reader and short-horizon prompts |
| **(b) Between rounds / while dead** | What cost them that death, said during the death timer or buy phase | The time they're out: a respawn of about 10 s, up to a round break of about 30 s [E, not verified] | Still during the match. Riot's stance covers it, chess has no "dead" time, and other games are a gray area | High. It's one loss read per death, as `read_clips` does now |
| **(c) Instant post-match** | The full review, ready as the match ends, because the record and loss reads were built while it played | Match end to report in about 1–2 min, against 2–20 min today [M: README, review times] | None while nothing is shown during play. Chess: the engine must not run until the game ends | Highest. It's today's review, fed incrementally |
| **(d) Spectator companion** | Callouts and Q&A for someone watching another player: a coach, a friend, a VOD, a stream | 5–15 s behind is fine [E]. Streams already run seconds behind | None, as long as the output doesn't reach a player in a live game (lichess counts stream commenters as assistance [21]) | High. Same pipeline as (c), plus a voice |

**Trade-offs in short:**
- (a) is the most impressive and the least feasible, against rules and physics alike.
- (b) is useful and cheap, but it is still assistance during a match.
- (c) is what a player would actually use on their own games. It's the least "live" to watch.
- (d) is live to watch and rules-safe. Its value to the player comes afterwards, or through a human coach.

**Recommendation for the hackathon demo:** build the shared live pipeline (capture, then code instruments, then a loss read per loss). Show it first as (d): Eye Catcher watches a recording or stream in a window and speaks each lost fight's cause within seconds. End the demo on (c): the full critique opens as the match ends.
- (d) needs no game installed and can be demoed on this Mac.
- (d) is measurable by replaying the 9 baseline clips at real speed.
- (c) is how the same pipeline serves a player's own ranked games without breaking rules.
- (b) can come later as an opt-in for practice modes only. (a) shouldn't be built.

## 2. Rules and fairness

The README says: "Post-game only. Eye Catcher never reads game memory and never runs during a match." `PLAN.md` gives the reason: live advice or overlays "would break Riot's rules and risk anti-cheat flags." Checked against each publisher's current text:

| Game | What the rules say | (a) in-match | (b) while dead | (c) instant post | (d) spectator |
|---|---|---|---|---|---|
| **League of Legends, VALORANT** (Riot) | Riot's player-facing page lists as a measurable advantage apps "drawing conclusions for you during gameplay", adding that Riot wants you to play first and reflect later [13]. VALORANT's developer policy bars in-game apps and overlays with real-time data that changes behavior immediately ("go here now"), as opposed to coaching game over game [14]. League's policy bars apps that dictate player decisions, and allows only overlays of static pre-game data [15]. Penalties run up to permanent suspension and loss of ranked rewards [13]. | Banned | Banned: a death timer is still during gameplay | OK: nothing is shown until after | OK |
| **Fortnite** (Epic) | The Competitive Master Rules prohibit overlays that are aware of the real-time game state and give feedback that's a competitive edge. Discord and streaming software are allowed. They also bar outside assistance with information not on the player's own screen [17]. My fetch got a 403; the text came via search excerpts, so check the page before relying on it. | Banned in competitive play | Banned in competitive play. A battle-royale death usually ends the match anyway | OK | OK (a coach relaying to a competitor would be outside assistance) |
| **Clash Royale, Brawl Stars** (Supercell) | The ToS bans unauthorized third-party software designed to modify or interfere with the service, and getting information from a Supercell game by any method Supercell hasn't expressly permitted [18]. The Safe and Fair Play policy defines third-party software as apps that manipulate gameplay, with a permanent ban as the penalty [18]. The Fan Content Policy allows non-commercial guide apps [18]. | High risk: "any method not expressly permitted" is broad | High risk | Gray, but the same as recording the screen [E] | OK |
| **Rainbow Six Siege** (Ubisoft) | Terms of Use §7.3.4 ban gaining unfair advantages and "unauthorized third-party tools or devices". §7.2.2 says detected unauthorized programs may be reported back to Ubisoft [19]. | High risk | High risk: a round break is still the match | OK | OK |
| **Chess** (chess.com, lichess) | chess.com bans engines, software, plugins, extensions, and any tools that analyse positions during play. It also bans "automated analysis or 'blunder checking' of your games in progress" [20]. lichess bans any external assistance while a game you're in is ongoing, and lists human commenters on streams as assistance [21]. | Banned | Banned (there's no "dead" time) | OK only if Stockfish waits for the result: reading the board during play is recording, scoring it is analysis | OK for others' games, as long as nothing reaches the player |
| **Rocket League** (Psyonix/Epic) | Easy Anti-Cheat has been required for online play on PC since late April 2026. Mods don't run with it on, and still work offline, in training, in LAN matches, and in replays [22]. I found no published rule on screen-reading coaching tools. | Unclear; avoid | Unclear; there's no death, a goal replay is the only pause | OK | OK |
| **Marvel Rivals** (NetEase) | NetEase called the Blitz overlay cheating software and told players to refrain from any third-party plugins (Feb 2025). Its stated reason was that Blitz injects itself into the game process and gives players confidential information, such as damage and healing stats [23]. I didn't find the ToS text itself. | High risk | High risk | OK: it doesn't inject or read hidden data | OK |

**What a live mode changes in the README's promise:**
- **"Never reads game memory" holds in every mode.** Everything stays pixels from a screen capture, the same way OBS or a clip app sees the game. No hooks and no injection. Injection is what NetEase objected to in Blitz [23], and a game-capture hook is what broke when Vanguard updated (OBS's Riot game capture, July 2026, secondary report [25]).
- **"Never runs during a match" would change** to "never tells the player anything during their match". That covers (c) and (d). Modes (a) and (b) break it, and the rules above are why.
- **For chess, (c) needs a stricter rule:** no engine (and no model) touches a game the player is in until the result shows on screen. chess.com bans automated analysis of games in progress, even unseen [20].
- **The Riot developer policies [14][15] govern apps built on the Riot API.** Eye Catcher uses none. The player-facing stance [13] covers any app, though, and Vanguard is a kernel driver that can block software [16].
- **Tournaments** have their own rules on coaching during matches. They're not covered here.

## 3. Technical pipeline

### 3.1 Capture

- **Electron:** the main process picks a source with `desktopCapturer.getSources({ types: ['window'] })` and grants it through `session.setDisplayMediaRequestHandler`. The page then calls `navigator.mediaDevices.getDisplayMedia()` [24]. macOS asks for Screen Recording permission (10.15 and later) [24]. Capturing system audio needs another permission and doesn't report a failure when it's missing [24]. Live mode doesn't need audio: voice chat must never leave the device, as today.
- **Capture the game's window, not the screen.** Notifications, DMs and other windows would otherwise go to Gemini. On the free tier, Google uses submitted content to improve its products, and human reviewers may read it [11].
- **Frames to readers:** `MediaStreamTrackProcessor` (WebCodecs) hands `VideoFrame`s to a worker, which crops the learned regions onto OffscreenCanvases. That's the same `getImageData` input core.js readers take today [E: standard Chromium API, not tried here].
- **Two encoders run alongside** [E]:
  - **A ring buffer for clips:** VP8 at 960 px, 8 fps, 1.5 Mbps (today's `read_clips` settings), keyframe every 1–2 s, holding the last ~30 s. That's about 1.5 Mbps × 30 s = 5.6 MB of RAM, and a loss clip is cut from it without decoding.
  - **The recording on disk** for the post-match review, since the review reads the kill feed and HUD from the original. At about 5 Mbps that's about 2.2 GB an hour.
- **Fullscreen games:** a game in exclusive fullscreen may capture black or hide other windows. Borderless windowed avoids that [E].
- **Phone games** (Clash Royale, Brawl Stars) need the phone mirrored to the Mac first [E].
- **Platform:** VALORANT has no Mac client (secondary source [26]). A live demo of the player's own game on this Mac is limited to games that run here, or to a second device. The spectator companion has no such limit.

### 3.2 Sampling rates, and what runs in code

The readers below ran on one real VALORANT frame (960×514, TenZ at 6:14) in Node on this Mac, with the machine's load average at about 5.7 [M: scratchpad `live-bench.cjs`, one run]:

| Instrument (today's function) | Code or model | Live rate | Cost per frame | Live use |
|---|---|---|---|---|
| Kill-feed rows and team colors (`C.killfeedRows`, `freshRows`) | Code | 4 Hz (today: 1 Hz plus 3 back-frames) | **0.91 ms** on a 221×209 crop [M] | New kills and deaths within ~0.25–0.5 s [E] |
| Plain-text feed lines (`C.textRows`) | Code | 2 Hz | **0.49 ms** [M] | Apex-style feeds |
| Ammo digits, shots (`C.ammoReading`) | Code | 4 Hz (as today) | **0.06 ms** on 59×26 [M] | Firing, and fights in games without a damage counter |
| Chess squares (`squareLook` × 64) and move matching (chess.js) | Code | 2 Hz | **1.1 ms** for 64 squares [M]; move matching not timed | Every move as it lands |
| Stockfish 10 (asm.js, `uciEngine`) | Code | Per move | **52–59 ms** a position at depth 10–12 in Node [M]. The depth-12 time may have been helped by the depth-10 search before it. A browser worker is likely slower [E] | Spectated games only, or after the player's own game ends |
| Camera cuts (gray frames) | Code | 2 Hz | Not timed | Spectator footage |
| Names on kill-feed strips | Model (32 strips a call) | Batched | One call per batch | Read the player's name once, then match their strip by the shape of its white text, which the tracker already uses (`fp`, `nameKey`), with no further calls [E] |
| K/D/A, HP, damage, score | Model (sheets of up to 48 cells a call). Code's digit reader misread small digits over scenery [M: README] | On demand | One call per sheet | Read around events, not swept. A 48-cell sheet at 2 s spans 96 s, too late as a trigger |
| Death confirmation (`secondLooks`) | Model | Per event | — | Folded into the loss read |
| Loss reads (`readClips`) | Model, video at 8 fps, high detail | Per loss | ~28k tokens (section 4) | The core of (b), (c) and (d) |
| Claim check, video check, coach | Model | After the match | As today | Post-match only; no time for them live |

Scaled to 1080p crops, about four times the pixels, the code readers still take a few milliseconds a frame [E]. **The code side is not the bottleneck.** The bottleneck is knowing a loss happened without a model call. Code knows it in kill-feed games, in chess, and wherever a gray death screen or a disappearing HUD can be measured. It doesn't yet know it where only the HUD's counters show it (League's K/D/A, Rocket League's score), because those numbers are read by Gemini.

### 3.3 What needs a model, and at what detail

- **The loss read** is a `readClips` call on one loss:
  - 4 s of setup at 2 fps, then the last 8 s at 8 fps, at `MEDIA_RESOLUTION_HIGH` (280 tokens a frame [6]);
  - the HUD sheet 6 s and 2 s before;
  - the minimap 12, 6 and 1 s before.

  Low detail is not an option here. At low detail Gemini mistimed a knock on the Apex recording that high detail read right [M: README].
- **Periodic situational reads,** which only mode (a) would need, would be a 10 s clip at 2 fps at default detail (70 tokens a frame [6]; measured 66 on 3.5 Flash-Lite [M: README]).
- **The Live API** samples video at 1 frame a second at most [2][3]. That's too thin to see a shooter fight that lasts 1–3 s. At low resolution it also can't read HUD numbers or the kill feed: at 640 px the feed is a smear [M: README].

### 3.4 Latency budget

The eval baselines say when each loss was decided. From the 33 frame-checked losses in `eval/answer-keys/coach/` (Oct 24), here is the time from the start and from the end of each decision window to the loss [M: `baseline.validated.json`, `validated-*.json`]:

| Game (losses) | Decision starts before the loss | Decision ends before the loss |
|---|---|---|
| VALORANT (5) | 3–5 s | 0–1 s |
| Marvel Rivals (4) | 3–5 s | 0–2 s |
| Rainbow Six Siege (2) | 2.7–5.1 s | 0.9 s |
| Fortnite (5) | 1–12 s | −3.1 to 0.8 s (the decision runs into the loss) |
| Brawl Stars (3) | 6–9.5 s | 1.25–4.25 s |
| League of Legends (3) | 9–12 s | 3–4 s |
| Rocket League (1) | 8 s | 5 s |
| Clash Royale (3) | 15–24 s | 9–13 s |
| Chess (7) | 1–34.5 s | 0 s (the move is the loss) |

Pipeline stages, live [E unless tagged]:

| Stage | Time |
|---|---|
| Frame reaches the worker | ~33 ms at 30 fps |
| Code reader | 0.06–1.1 ms a frame [M] |
| Event confirmed (seen in 2 samples at 4 Hz) | 0.25–0.5 s |
| Clip cut from the encoded ring | ~0.1–0.2 s. Today's cut from a file takes 0.35–1.15 s [M: README] |
| Upload of a 1–2 MB request | 0.2–1 s |
| Flash-Lite, thinking off, small input | 1–3 s. Coach turns without thinking measured 1–8 s [M: README] |
| Flash-Lite, thinking on | 8 s for a five-claim check on 3.5 [M: README], 20–50 s a coach turn [M], up to 250–352 s on 3.1 at high [M] |
| Voice starts: system voice (`speechSynthesis`) | ~0.1–0.5 s |
| Voice starts: Kokoro | A 7.7 s line took 9 s on this Mac [M: README], too slow for a callout |
| Player reacts to a spoken cue | ~0.5–1 s |

What that means per mode:
- **(a):** about 2.5–6 s end to end without thinking. In shooters that's after the loss. In League and Rocket League it's borderline, and only for cues code can see. Only Clash Royale's timing allows it, and its rules don't. Mode (a) is out on both counts.
- **(b):** one loss read with thinking capped at low or medium takes about 8–20 s [E]. That fits a VALORANT or Siege round break (buy phase about 30 s, commonly cited, not verified) and League's mid-to-late death timers (about 10–50 s by level [27], not verified). It misses short respawns.
- **(c):** with the record and loss reads done during the match, what's left at the end is the coach's turns and the checks: about 6–12 calls, or 1–4 min [E]. To be ready the moment the match ends, the coach would have to start before the end.
- **(d):** a callout 10–20 s after the loss is fine for a watcher.

### 3.5 Delivery

- **Voice first.** The system voice speaks through `speechSynthesis` with no window over the game. That's the least anti-cheat surface and the fastest to start [E]. Callouts stay short (under about 2 s), with at most one per 20–30 s, and only after a loss [E]. Kokoro stays for the post-match critique.
- **The overlay, if ever:** a separate Electron window, transparent, click-through (`setIgnoreMouseEvents`), always on top (`setAlwaysOnTop` at `screen-saver`), and on macOS visible over fullscreen (`setVisibleOnAllWorkspaces` with `visibleOnFullScreen`, a no-op on Windows) [24]. `setContentProtection` keeps it out of Eye Catcher's own capture, though ScreenCaptureKit apps can capture it anyway [24].
  - Technically it's an ordinary OS window, so nothing is injected [E].
  - But the rules that ban live overlays [14][17] are about what the overlay says, not how it's drawn. An overlay during the player's own match is out for the same reasons as (a).
- **Spectator mode** can use the app's own window: a side panel beside the captured window with a timeline of callouts, each one replayable.

### 3.6 Reused or rebuilt

| Piece | Status | What changes |
|---|---|---|
| `core.js` readers and record logic (`killfeedRows`, `freshRows`, `textRows`, `ammoReading`, `buildKillfeed`, `feedSightings`, `nearDeaths`, `eventWindows`, `readFrom`) | Reused | They take ImageData and event lists. They don't care whether frames are live |
| `chess-reader.js` (board, moves, `scoreGame`, `uciEngine`) | Reused | The engine is gated to games the player isn't in |
| `gemini.js` (`generate`, fallbacks, retries, two keys, thinking caps) | Reused | Live calls need a short timeout and no minute-long waits: a late callout is worth nothing |
| `agent.js` schemas and prompts (`CLIPS` with `factors` and `last_choice`; `checkClaims`, `verifyClaims`, `review()`) | Reused | `review()` already takes a record built by code before its first turn [M: README] |
| `learn.js` | Reused, with a new input | Its 8 frames come from the first minutes of the match, or from a cached profile per game and resolution. Boxes vary between learn calls [M: README], so the box check stays |
| `video.js` (`open`, `grab`, `each`, `clip`) | Adapted | A `LiveVideo` gives the same interface over the frame ring and the encoded ring. Today's functions seek a file by timestamps |
| `feedStrips`, `readKillfeed`, `readCounters`, `passLog`, `fightLog`, `secondLooks` | Rebuilt as incremental | Today they sweep a whole stretch (`GRID_SAMPLES` spread over it, one second-look call for everything). Live versions keep state across frames and flush on an event or a timer |
| `server/index.mjs` | Adapted | The per-address limits (30 a minute, 200 a day) need a live budget. The Live API, if used, needs an ephemeral-token endpoint: tokens work only for the Live API, default to 1 use, start a session within 1 min, last 30 min, and can lock the model and config [7]. The page's CSP would have to allow `wss://` |
| Capture, frame pump, per-genre loss triggers (gray screen, hidden HUD, the player's feed row), match start and end detection, callout composer and rate limit, voice, replay harness, live grader | New | — |

## 4. Models and cost

### 4.1 The Gemini Live API, as documented today

| Question | Answer | Source |
|---|---|---|
| Models | `gemini-3.8-live` (stable, the default), `gemini-3.8-live-extended-thinking` (stable), `gemini-3.1-flash-live-preview` (legacy), `gemini-2.5-flash-native-audio-preview-12-2025` (limited access), and a translate preview | [5] (models page updated 2026-10-22), [3] |
| Any Flash-Lite? | **No.** No Flash-Lite model is listed for Live, and the `gemini-3.5-flash-lite` page says the Live API is not supported | [5] |
| Video input | JPEG or PNG frames, **at most 1 frame a second**. `mediaResolution` sets the tokens a frame | [2][3] |
| Tokens per frame on Live | **Not documented.** Gemini 3 video is 70 a frame at default or low and 280 at high [6]. The general token page says 258 an image tile [12]. The pricing page's per-minute rate ($0.002 a minute at $1.00/M) implies about 2,000 tokens a minute, which matches neither at 1 fps | [1][6][12] |
| Output | Native audio models answer in audio only; text comes as a transcription | [3] |
| Session length | Without compression: audio-only 15 min, **audio+video 2 min**. A connection lasts about 10 min. Resumption handles stay valid 2 h, and a GoAway message comes before a cut | [4] |
| Context window | 128k tokens for native audio models (the `gemini-3.8-live` page says 131,072), 32k for other Live models | [3][5] |
| Thinking | Not supported on `gemini-3.8-live`. Low, medium or high on Extended Thinking. Levels on 3.1 Flash Live | [3] |
| Proactive audio | The model may decide not to respond. Not on 3.1 Flash Live | [3] |
| Function calling | Yes. Async on 3.8, sequential only on 3.1 Flash Live | [3] |
| Billing per turn | "During each turn, the API bills for all context tokens", history and system instruction included. That's stated on Google Cloud's page. A developer's reconciliation on the Gemini API matched the bill within ~3% only when every turn's snapshot was summed | [9][10] |
| Free tier | Listed as free of charge for the Live models. Rate limits aren't published (AI Studio shows them per account), and concurrent-session limits aren't documented | [1][8] |

### 4.2 Prices (paid tier, per million tokens)

From the pricing page [1], updated 2026-10-22:

| Model | Input | Output (thinking included) |
|---|---|---|
| `gemini-3.5-flash-lite` | $0.30 (text, image, video, audio) | $2.50 |
| `gemini-3.1-flash-lite` | $0.25 text, image, video; $0.50 audio | $1.50 |
| `gemini-2.5-flash-lite` | $0.10 text, image, video; $0.30 audio | $0.40 |
| `gemini-3.8-live`, `-extended-thinking`, `gemini-3.1-flash-live-preview` | $0.75 text; $3.00 audio ($0.005/min); $1.00 image/video ($0.002/min) | $4.50 text; $12.00 audio ($0.018/min) |
| `gemini-2.5-flash-native-audio-preview-12-2025` | $0.50 text; $3.00 audio/video | $2.00 text; $12.00 audio |

- **Free tier:** all of these models are listed as free of charge on the free tier [1]. Content sent there may be used to improve Google's products and read by human reviewers [11].
- **Known limits:** 500 requests a day per model per project for 3.x Flash-Lite [M: Oct 22 429 response, `limit 500`].
- **Audio:** counted at 25 tokens a second [9].

### 4.3 Expected cost per hour, by mode

Shared inputs:
- **Tokens a frame:** 70 at default or low and 280 at high [6]. An image is 1,120 at default [6], and a 768 px still measured 1,089 [M: README].
- **A loss read:** 4 s at 2 fps plus 8 s at 8 fps = 72 frames × 280 = 20,160 tokens. Add a HUD sheet (1,120), three minimap stills (3,360) and ~3,000 of prompt, for **~27,600 in**. Output is ~800 of answer plus ~3,000 of thinking at low or medium, for **~3,800 out** [E]. 3.5 Flash-Lite thought at most 7,091 tokens on a check at high [M: README].
- **Deaths an hour:** Vyse's 14 minutes had 6 deaths, about 26 an hour [M: README]. I use 30 an hour [E].

| Mode | Arithmetic [E] | Calls an hour | $ an hour, 3.5 FL | $ an hour, 3.1 FL | Free tier: hours of play a day on one key (500 RPD a model) |
|---|---|---|---|---|---|
| **(a) via generateContent, a read every 10 s** | Per call: 10 s × 2 fps × 70 = 1,400 video, plus a HUD image (1,120) and ~2,000 of text = ~4,500 in, ~300 out. × 360 calls = 1.62M in, 0.108M out. 3.5: 1.62 × 0.30 + 0.108 × 2.50 | 360 | **$0.76** | **$0.57** | 1.4 h |
| **(a) or (d) via the Live API** (`gemini-3.8-live`, 1 fps, a prompt every 10 s, sliding window ~12k) | Re-billed per turn: 360 turns × 12k = 4.3M × $1.00. Light: every 30 s with 16k = 1.9M → $1.92. Heavy: every 10 s with 32k = 11.5M → $11.52. If video were billed once at $0.002/min: 60 × $0.002 = $0.12, plus 360 × 500 text tokens × $0.75/M = $0.14. Voice out: 30 callouts × 3 s × 25 tok/s × $12/M = $0.03 | 120–360 turns | **~$4.3** (range $0.26–$11.5) | not Flash-Lite | Unknown (limits unpublished) |
| **(b) while dead** (loss read per death, plus a text note per round in round-based games) | 30 × (27.6k in, 3.8k out) = 0.83M in, 0.114M out → 3.5: 0.83 × 0.30 + 0.114 × 2.50 = $0.53. Round notes: 36 × (4k, 300) → $0.07 | ~66 | **~$0.60** | **~$0.43** | ~7.5 h |
| **(c) instant post-match** | The same calls as today's review, spread through the match: 15–25 calls and 200k–450k prompt tokens a review [M: README], with 20k–45k out [E] → 3.5: $0.11–0.25 a match (measured $0.09–0.16 on Oct 19–20 [M: README]). A match an hour: VALORANT ~1.5, League ~2, Clash Royale ~12 [E] | 23–38 (VALORANT), 180–300 (Clash Royale) | **$0.17–0.38** (VALORANT), **$1.3–3.0** (Clash Royale) | ~25–30% less | ~13–22 h (VALORANT); ~2–3 h (Clash Royale) |
| **(d) spectator companion** (a loss read per loss, plus questions) | Loss reads as in (b): $0.53. Questions: 10 × (6k in, 500 out) = $0.03 | ~40 | **~$0.55** | **~$0.40** | ~12 h |
| **(d) chess spectator** | Stockfish is free. One narration call per mistake: ~10 a game × (3k in, 200 out) = $0.014 a game | ~30 | **~$0.04** | — | 16 h+ |

What the table says:
- **The binding limit is requests, not money.** At list price, every Flash-Lite mode is under a dollar an hour except short-match games reviewed every match. On the free tier, what runs out is requests: a key's 500 a day per model goes in 1.4 hours of mode (a), against a working day of (b) or (d).
- **The Live API is the costly and uncertain path.** It bills the whole context on every turn [9][10] at 3.3× Flash-Lite's video rate ($1.00 against $0.30). Its frame tokenization isn't documented, and it has no Flash-Lite model. Its per-minute prices look cheap only if that re-billing doesn't apply, and Google Cloud's own page says it does.
- **Short-match games multiply the calls.** Clash Royale's 3–4 minute matches would spend a review's 15–25 calls every few minutes. In those games, review a session of matches, not each one.
- **Eye Catcher's backend limits would cut live use short.** 200 calls a day per address ends mode (a) after 33 minutes, so live needs its own budget there.

## 5. Risks and unknowns

**Risks:**
- **Rules.** A live feature that leaks into the player's own match is a ban risk in every game checked (section 2). Every live output needs a hard gate on "the player's match is over", or on spectating someone else.
- **Wrong callouts with no checks.** Post-match, every finding goes through the claim check and the video check. The video check stopped 18 of 20 false claims on labeled cases [M: README `verifycheck`]. Clip reads alone named the wrong ability on one of two Vyse windows checked by eye [M: README]. Callouts skip those checks, so they should say what code measured (the kill feed, the HUD numbers, the engine) and at most one model-read cause, worded as a read.
- **Busy models.** 3.5 Flash-Lite answered 503 for long stretches in testing [M: README, memory]. A live callout can't wait a minute and retry, so a late one is dropped.
- **Machine load.** A game, Electron, two encoders and a model client on 8 GB of RAM. Loops already timed out under load here [M: memory, Oct 24]. Spectator mode on a VOD is lighter than playing.
- **Learning the screen live.** Boxes shift between learn calls [M: README], and the first minute of a match may not show the kill feed. A cached per-game profile helps, at the cost of not adapting to a new HUD layout.
- **Privacy.** Screen capture can pick up more than the game. Capture the window and crop to regions, and keep in mind that free-tier content may be read by human reviewers [11].

**Unknowns, to measure before committing:**
- How many tokens a Live API frame costs, and whether per-turn re-billing applies to video on the Gemini API (not only on Google Cloud).
- The Live API's free-tier limits.
- Flash-Lite's latency on a ~28k-token loss read at thinking low or medium. That one measurement decides whether (b) and (d) callouts are timely.
- Loss triggers without a model in games where only the HUD's numbers show the loss (League's K/D/A, Rocket League's score).
- Whether a publisher would treat mode (c) as "drawing conclusions during gameplay" [13] even though nothing is shown. A strict setting (record during the match, run every model call after it) removes the doubt at the cost of latency.

## 6. Plan, and how to measure it

### 6.1 Prototype first (in this order)

1. **A replay harness.** It feeds an eval recording through the live path at 1× wall-clock time, with frames from mediabunny, no capture, and no Electron. Then own-loss detection with code readers only, timed on the 9 baseline clips. No model calls. Go if ≥ 90% of the 33 losses fire within 2 s [E: target].
2. **One loss read from the encoded ring** on 3.5 Flash-Lite at thinking low, medium and high: latency and correctness on the 33 losses. Go if the median is ≤ 10 s from the loss and it reaches the baseline's factors as often as the post-match read does.
3. **A callout line and the system voice,** with a side panel of callouts. Rate-limited, and spoken only after a loss.

### 6.2 Phases (days are estimates)

| Day | Build | Done when |
|---|---|---|
| 1 | Replay harness; `LiveVideo` (frame ring plus VP8 ring); incremental kill-feed, text-feed, ammo and chess readers; event log with detection times | Loss detection and latency on 9 clips, no model calls |
| 2 | Loss read on trigger; callout composer; `speechSynthesis` | Callouts on the 9 clips, graded against the baselines (6.3) |
| 3 | Spectator mode with real capture: `desktopCapturer` of a window playing a VOD; side panel; demo script | **The minimal live demo** |
| 4 | Instant post-match: recording to disk, handoff of the record and loss reads to `review()`, match end detection, the chess engine gated to after the result | Match end to report time, and the report graded like today's |
| 5 (optional) | A Live API spectator Q&A experiment: ephemeral tokens from the backend; cost reconciled by summing each turn's `usageMetadata` | Measured $ an hour against section 4.3 |

### 6.3 Measuring whether live callouts are right

The answer keys already exist: 33 losses across 9 clips, each with its time, when it was decided, what happened, the factors (position, information, resources, numbers, map, mechanics), and `not_true` claims [M: `eval/answer-keys/coach/`].
- **Detection:** the share of the 33 losses that get a callout, and the latency from the loss to the voice starting (median and 90th percentile).
- **Correctness:** grade each callout's claims against the baseline's account of what happened and its factors, with the Oct 24 grader `grade-base.mjs`. That grader lives in the session scratchpad, not the repo, so move it into `eval/` first. Spot-check with a fresh validator agent, which caught 35 wrong facts in a first baseline [M: memory].
- **False alarms:** callouts with no baseline loss within ±10 s, per clip. Any callout that matches a `not_true` claim is a hard fail.
- **Consistency:** three runs per clip at temperature 0, and whether the callouts match between runs.
- **A post-match audit:** after each replay, run `verifyClaims` on every callout. The share it would reject is the error rate the live path skipped checking.
- **The record:** score the live record against `eval/answer-keys/games` with `eval/recordcheck.mjs`, as the post-match record is scored now. Live should match post-match.
- **Mode (c):** the final review graded as today's, plus time from match end to report, against a post-match run on the same clip.
- **Cost:** calls and tokens per clip from `usageMetadata`. For the Live API, sum every turn's snapshot [10].

## Sources

1. Gemini Developer API pricing. https://ai.google.dev/gemini-api/docs/pricing (updated 2026-10-22)
2. Live API overview. https://ai.google.dev/gemini-api/docs/live (updated 2026-10-06)
3. Live API capabilities guide. https://ai.google.dev/gemini-api/docs/live-guide (updated 2026-09-18)
4. Live API session management. https://ai.google.dev/gemini-api/docs/live-session (updated 2026-09-15)
5. Models: https://ai.google.dev/gemini-api/docs/models (updated 2026-10-22); https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite; https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live (updated 2026-10-19)
6. Media resolution. https://ai.google.dev/gemini-api/docs/media-resolution (updated 2026-10-13)
7. Ephemeral tokens. https://ai.google.dev/gemini-api/docs/ephemeral-tokens (updated 2026-09-15)
8. Rate limits. https://ai.google.dev/gemini-api/docs/rate-limits (updated 2026-10-15; free-tier numbers only in AI Studio)
9. Best practices with Gemini Live API (Google Cloud). https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/live-api/best-practices (updated 2026-10-22)
10. Developer forum, cumulative per-turn billing (July 2026; not Google staff). https://discuss.ai.google.dev/t/does-gemini-live-native-audio-bill-cumulative-prompt-tokens-on-every-turn-cost-seems-to-scale-with-turn-count-not-call-duration/173248
11. Gemini API Additional Terms. https://ai.google.dev/gemini-api/terms (updated 2026-04-28)
12. Token counting. https://ai.google.dev/gemini-api/docs/tokens (updated 2026-10-13)
13. Riot Support, Third Party Applications. https://support.riotgames.com/hc/en-us/articles/225266848 (Feb 10, 2025)
14. Riot Developer Portal, VALORANT. https://developer.riotgames.com/docs/valorant (no date shown)
15. Riot Developer Portal, League of Legends. https://developer.riotgames.com/docs/lol; general policies. https://developer.riotgames.com/policies/general (May 29, 2025)
16. Riot Vanguard. https://support.riotgames.com/en-us/riot/performance/what-is-vanguard (June 2, 2026)
17. Fortnite Competitive Master Rules. https://www.fortnite.com/competitive/rules-guidelines/rules-library/fortnite-competitive-master-rules (returned 403 to my fetch; wording from search excerpts; verify)
18. Supercell Terms of Service. https://supercell.com/en/terms-of-service/ (effective Nov 6, 2024); Safe and Fair Play. https://supercell.com/en/safe-and-fair-play/; Fan Content Policy. https://supercell.com/en/fan-content-policy/ (Sep 27, 2023)
19. Ubisoft Terms of Use. https://www.ubisoft.com/legal/documents/termsofuse/en-US (Jan 26, 2026)
20. chess.com Fair Play Policy. https://www.chess.com/legal/fair-play (Mar 25, 2026)
21. lichess Terms of Service. https://lichess.org/terms-of-service (Aug 1, 2026)
22. Rocket League Easy Anti-Cheat (secondary, quoting Psyonix). https://www.shacknews.com/article/148822/rocket-league-easy-anti-cheat (Apr 23, 2026); https://www.gamingonlinux.com/2026/04/rocket-league-adds-easy-anti-cheat-with-steam-deck-linux-still-supported/ (Apr 30, 2026)
23. Marvel Rivals bans Blitz (secondary, quoting NetEase's marvelrivals.com post). https://shacknews.com/article/143188/marvel-rivals-blitz-plugin-ban (Feb 21, 2025)
24. Electron. https://www.electronjs.org/docs/latest/api/desktop-capturer; https://www.electronjs.org/docs/latest/api/browser-window
25. OBS game capture and Vanguard (secondary). https://win.gg/obs-game-capture-not-working-valorant-league-of-legends-fix/
26. VALORANT on Mac (secondary). https://www.thespike.gg/valorant/beginner-guides/install/can-you-play-valorant-on-mac
27. League of Legends Wiki, Death. https://wiki.leagueoflegends.com/en-us/Death (death timer numbers not verified)
