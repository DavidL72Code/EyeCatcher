# Ideas for loop 39 and after

Planned Oct 25 from loops 37 and 38, before any of the working tree's untested fixes ran. Loop files are in the scratchpad (`$SP` = `/private/tmp/claude-501/-Users-davidle-Documents-hackathon/85b4a72f-2966-4d0a-af8c-1c90c58f3635/scratchpad`), as `$SP/loops/<n>/<game>/run-N.json`. A per-loss trace of every run (record event, clip read, factor kinds, cites) is `python3 $SP/brainstorm39/stages.py loops/38 loops/37`, run from `$SP`. Out-of-window read times: `python3 $SP/brainstorm39/times.py loops/37 loops/38`.

The goal, in order: every review matches the baseline for every clip (each loss cited, each deciding factor named with its number), then speed, then tokens, then security.

## Three things to know before reading any loop number

- **Most of loops 37 and 38 ran on 3.1 Flash-Lite, not 3.5.** Every run opens with two 429s on 3.5 (both keys out for the day), and 3.1's thinking is capped at medium (`gemini.js` `MOST_THINKING`). Loop 38's `usage.models`: League runs 1-2 `"gemini-3.1-flash-lite 200": 26` and `21`; League run 3, after what looks like the 03:00 local reset (midnight Pacific), `"gemini-3.5-flash-lite 200": 16`; Brawl Stars all on 3.5; Clash Royale and chess all on 3.1. An A/B whose arms ran on different models measures the model, not the change.
- **Correction to "runs 2 and 3 are near-identical".** True for Clash Royale and chess (identical token counts) and roughly for League. Not for Brawl Stars on 3.5 with the same profile: run 2 took 7 calls and recorded nothing, run 3 took 21 calls and recorded 7 near-deaths (`scanNotes.recordFrom` empty in run 2, "read at 18 of 89 moments" in run 3). Record-stage experiments on Brawl Stars need 2 runs an arm.
- **Near-deaths and damage are over a third of the losses outside chess** (10 of 26: League 1, Marvel Rivals 3, Brawl Stars 1, Siege 1, Fortnite 4). The pipeline treats them as second-class at every stage (below).

## 1. Diagnosis: the first stage that goes wrong, per game

Stages: learn and identity, record, loss windows, clip reads, coach synthesis, checks, finish.

| Game (loop) | First stage wrong | Evidence |
|---|---|---|
| League (38) | **Record** for the near-death; **clip reads** for the deaths | Deaths right in all 3 runs (`record.deathsAt` `[108, 536]`), but the 4:30 near-death (280 of 1589) is missing in runs 1-2 (`scans[0].your_near_deaths: 0`) and found only in run 3 (`near_death t 270`). Death reads: `factors` `numbers: "13 vs 16."` (the kill score), `resources: "Health 271/1479, Mana 181/569."`, `mechanics: "Player is caught out of position."`; no Flash or ult cooldown read in any run. |
| Clash Royale (38) | **Learn and identity**, then **record** | `learned.playerName: "HIHIHA"` (the opponent's clan НІНІНА); `regions` only `gold`, `board`, and a `health` box `moved ... shows "nothing"`. The record invents `point_lost t 44 "Player's right princess tower destroyed"` (the tower was intact until 1:24.5) and `point_won t 208 "Player destroys opponent's king tower"` (the player lost 0-1). No tower health is ever measured. |
| Brawl Stars (38) | **Record** (deaths), after a weak **learn** | `profile.verified.dropped`: `abilities` "shows other", `minimap` "shows team". Runs 1-2: `record` empty. Run 3: 7 near-deaths, 5 of them while spectating a teammate after his deaths (1:37, 1:45, 2:00, 3:14, 3:37; the 90-100 read's `screen_text` "Following: Mr.Zemo0"). **Correction to the brief:** the 2:58 death was read (window 170-180, low detail) and the read wrote `"PANDA YT™ Defeated"` at clip 0:08 (2:58); code never promoted it to a death. |
| Chess (38) | **Coach synthesis** | Record right (52 plies, grades). The coach spent 4 of 9 turns on `frames` of the board to satisfy "looked at closely", then guessed: sent back with "hanging it to the opponent's queen on c6" (`sent[2]`). Cites 2-3 of 7; 2.f4 (3.0 pawns) and 22.Rxf4 (3.1) are among the six costliest the coach was given and are never cited. |
| Marvel Rivals (37) | **Record** (misses 2 of 3 near-deaths), then **loss windows** | Record has only `near_death t 79 "50 of 250"`; 4:18 (54 of 253) and 5:10 (30 of 250) are missing. The 1:19 near-death's window 72-82 was read at low detail with `factors: []`. |
| Rocket League (37) | **Learn** (no boost box), then **clip reads** | `regions` only `scoreboard`. The read's mechanics: "Aerial car control failed to prevent the shot", position "committed to an aerial challenge", while its own `screen_text` says "4:08 SHOT ON GOAL". The score (2-0) and clock (1:18 left) are known to code from `point_won t 208, 230` but never reach the read. |
| Valorant (37 run 2) | **Clip reads** (times), then **coach** | Record right (5 deaths). The two uncited deaths are exactly the two whose read gave clip-clock times: `last_choice.t "0:17"` (window 33.5-43.5) and `"0:03"` (130.8-140.8); the three cited ones had recording times (4:11, 4:52, 6:13). Causes: "pushed into A Main alone without teammate support"; 1v2, ult READY, Sheriff with no armor, the late first shot never named. |
| Siege (37) | **Loss windows** (near-death), then **clip reads** | Near-death at 8:39 (19 of 100) found, but its window 512-526 read at low detail with `factors: []`. The death read has `resources "Health at 19/100"`, `numbers "2 vs 3"`, `mechanics "Engaged in a gunfight with critical health"`: the empty magazine (0/89 from 8:35.7, not reloaded) and the lowered rifle are never named, though code reads the ammo counter. |
| Fortnite (37) | **Infrastructure**, then (expected) **record** | Run 1 `learned {}` after 17.8 min; runs 2 and 3 had 3 of 17 and 0 of 11 calls answered (quota). Even when it runs: 4 of its 5 losses are damage without a death (three falls with the shield untouched, 97→72, 75→55, 55→45, and a shield drop 98→24), none below the 25% near-death line, so no event kind can hold them. |

### By stage, across games

- **Learn and identity.** Identity wrong in Clash Royale (opponent's clan as the player). Missing elements that decide losses: Rocket League's boost, Clash Royale's tower health, Brawl Stars' super, gadget and ammo bar (the box was dropped). There is no element kind for an objective's health or for a resource other than gold.
- **Record.** Health is sampled, not watched: with a K/D/A on the HUD it isn't in the coarse read at all, only at 2 s steps around the low-detail pass's fights (`passLog`: `parts: [... (kdaHud ? [] : ['health'])]`). Short dips (Marvel Rivals 4:18 and 5:10, League 4:30) are caught by luck. A death while the screen then follows a teammate (Brawl Stars) isn't found, and the teammate's health is then read as the player's.
- **Loss windows.** `readClips` counts a window as a loss only for `death`, `point_lost`, `ally_death`; `readFrom` and `clipSpans` only for `death`, `point_lost`. So a near-death gets no run-up, no 8 fps tail, no HUD sheet, low detail, and its read returns no factors: every recorded near-death in both loops (League run 3 263-273, Marvel Rivals 72-82, Siege 512-526, Brawl Stars 34-44) has `factors: []`. Meanwhile 4 of League's 6 high-detail windows (about 100k prompt tokens) are teammate deaths across the map, each read `near: false`.
- **Clip reads.** Factors are filled, often with filler (League's kill score as numbers). Times aren't normalized: `clipTimed` is applied to moments and abilities, not to `factors`, `last_choice` or `screen_text`. Out of window: Clash Royale loop 38 factors 12 of 18 and last choices 2 of 3; Valorant loop 37 factors 4 of 11, last choices 2 of 5; Rocket League screen text 11 of 15. HUD moments are anchored to the record's death time, which runs late (League 1:48 against the real 1:46.4), so "2 s before" lands mid-burst (271 of 1479, against 42% at 1:43-1:45).
- **Coach synthesis.** Causes name about half of what the read had: League's reads filled 6 kinds, causes named 2; Siege 3 and 1-2; Valorant 2-3 and 1-2. None of the causes read here adds a number the read or the record didn't give.
- **Checks.** Doing their job (they caught the chess guesses and Clash Royale's invented towers), but each catch is a send-back turn. Clash Royale: 5 send-backs, `stopped`.
- **Finish.** Coverage isn't required: a habit needs 3 moments and a one-off needs 1 at a loss, so Marvel Rivals cites 2 of 4, Valorant 3 of 5, chess 2-3 of 7. And every salvaged finding loses its causes: all 5 findings with `salvaged: "checked"` (chess 38 runs 2-3, League 38 run 3, League 37 run 3, Clash Royale 37 run 3) have every moment without `because` (12 of the 21 findings with moments were salvaged: 7 from the record, 5 from checked moments).

## 2. Experiments, ranked

Ranked by expected gain on the goal per call spent. Each is behind a flag (`THIRDEYE_FLAGS=a,b` passed to the page through `scripts/dev.mjs` `envScript` like `THIRDEYE_COACH_MODEL`), so one code copy runs both arms.

Metrics used below (`report.mjs` and `grade-base.mjs` give the first, second and fifth; the others need the grader additions under "Before any loop"):
- **Cited**: baseline losses cited. **Kinds**: factor kinds a cited cause names, by the grader's words. **Kinds#**: kinds named with a number that matches the baseline's (new).
- **Record**: each baseline loss has a record event of the right kind in its decided..t+4 span, and no false ones (`stages.py`).
- **Stage**: the stage metric named in each experiment. **False**: cites at no real loss, and `not_true` hits.
- **Cost**: calls (answered/failed), prompt tokens (IMAGE/VIDEO), minutes, and the model share (% of calls 3.5 answered).

### 1. Near-deaths and big damage are losses in the clip read

- **Hypothesis.** A near-death read like a death (run-up, 8 fps tail, HUD sheet, high detail) gets factors; read as now, it never does (0 factors in all 4 recorded cases).
- **Change.** `agent.js` `readClips`: `lost()` and the `loss` lookup include `near_death` (and `damage` once experiment 4 makes it); `core.js` `readFrom` and `agent.js` `clipSpans` take `near_death` as the loss time. Cap near-death reads at the 2 lowest by health share, so Brawl Stars' false lows can't eat the budget.
- **Test.** Marvel Rivals (3 near-deaths), Siege (8:39), League (4:30, needs the record to find it), Brawl Stars (0:38). Stage: near-death windows read at high detail with 3+ non-filler kinds (0 of 4 now). Then Cited and Kinds# on those losses.
- **Cost.** About +25-30k prompt tokens a near-death (League's high-detail calls ran 50-65k for two windows, before the HUD sheet), and +1 call per 2 near-deaths, within `read_clips`' remaining-calls cap. About +15 s.
- **Risk.** Low. A false near-death now costs high-detail tokens; the cap bounds it.
- **A/B.** Yes, flag `near_loss`. With the record replayed (below), the only difference between arms is the read.

### 2. Zero-call plumbing: read times in the recording's clock, and causes kept when a finding is salvaged

- **Hypothesis.** Valorant's two uncited deaths and Clash Royale's stray cites come from clip-clock times; and every salvaged finding scores 0 kinds only because `because` is dropped.
- **Change.** `core.js` `clipTimed` applied to `factors`, `last_choice`, `screen_text` in `readClips`, trying three offsets (none, the clip's start, the tail part's start, since a read times each part from its own 0:00), and dropping a time no offset puts in the window (League's and Rocket League's game clocks). Two offsets can both fit (Valorant's "0:03" lands at 2:02.75 from the clip's start and 2:12.75 from the tail's), so also fix it at the source: `video.js` `clip` already draws every frame on a canvas before encoding, so it can stamp the recording's M:SS in a strip under each frame, and the read copies the time it sees. `agent.js` salvage path (`t.passed`): keep `because`, `better`, `ledTo`.
- **Test.** First offline, no calls: run the new normalization over every `clipWindows` in loops 37/38 (`times.py`); target 100% of high-detail times inside their clip, and Valorant's "0:17" mapped to about 0:39.5. Then Valorant and Clash Royale in a loop. Stage: times in window; Cited (Valorant 3 → 5 of 5 expected); Kinds on salvaged findings (0 now).
- **Cost.** None.
- **Risk.** Very low; a wrong offset is caught by the window test.
- **A/B.** The normalization and the salvage fix are bug fixes: offline is their A/B, and in a loop they ride with the control, measured at their stage. The stamp is flag `stamp_time` (it changes every clip the model sees).

### 3. Hand each loss read and the coach what code already knows, as numbers ("the HUD as numbers")

- **Hypothesis.** Numbers code reads exactly (score and clock, players alive, health and ammo at the decision) are what reads leave out or get wrong; given as true facts, they reach the cause.
- **Change.** A new `core.js` `matchState(events, counts, t)`: the score and clock off the scoreboard reads (Rocket League "2-0, 1:18 left"; Siege match point 3-0), each side alive in round games from the kill feed since the round start (Valorant 4:15 "1 v 2"; Siege "2 v 3"), the K/D/A, health at 10, 6 and 2 s before from the counters, and from `shotsAround` (already 30 fps, free) the first shot's time against the death, shots fired, and a magazine at 0 that wasn't reloaded (Siege 0/89 from 8:35.7). Added to the `facts` line in `readClips` and to `clipLine` for the coach. For chess, the move's think time from ply times (15.Bc3 at 5:04.75, 1.75 s after 14...Bd6) beside the engine's reply (already in the tree). Plus a read-prompt change: each factor quotes what on screen shows it (a HUD number, a status word), and code drops a factor with nothing quoted (filler like "caught out of position").
- **Test.** Valorant, Siege, Rocket League, Brawl Stars, chess. Kinds# for numbers, map, resources, mechanics; False (a wrong code fact would show here).
- **Cost.** 0 calls; a few hundred text tokens a clip.
- **Risk.** Low. A wrong count (a missed feed line) becomes a "true" fact; say it as "the kill feed shows", as now.
- **A/B.** Yes, flag `state_facts`; pairs with experiment 1 in one loop (different fields of the same read).

### 4. Watch the health bar in code, every half second

- **Hypothesis.** A bar's fill read from pixels at 2-4 fps finds every dip (Marvel Rivals 4:18 and 5:10, League 4:30), every fall (Fortnite), and where a fight's health loss began, for 0 calls; the HUD counters stay for the digits.
- **Change.** `core.js` `barFill(img, box)`: the share of the learned `health` box in the bar's own color, calibrated from the first frames where the counter reads full health and from a few digit reads. `agent.js` `passLog`: a `healthBar` series through the match (on the small scan copy where it exists), feeding `nearDeaths`, a new `damage` event (a drop of 20%+ of full within 3 s while the player plays, which is what holds Fortnite's falls), and the HUD moments of experiment 8 (anchored where the drop starts).
- **Test.** Offline first (0 calls): frames via `$SP/ocr/frames.mjs` (headless Chrome, not the harness) at 0.5 s over Marvel Rivals 4:12-4:24 and 5:04-5:13, League 1:38-1:47 and 4:18-4:31, Fortnite 2:41-2:53 and 7:28-7:44; fill against the baseline's numbers (622 → 140 → 0 at 1:45.8-1:46.4; 250 → 54 by 4:18). Then a loop on Marvel Rivals, League, Fortnite. Record: near-deaths found (Marvel Rivals 1 → 3 of 3; League 3 of 3 runs), Fortnite 4 damage losses, no false lows.
- **Cost.** 0 calls, 0 tokens. Decoding: League's 10 min at 2 fps is 1200 crops; measure it, and run it while the scan copy uploads (League waited 30 s idle, timeline 35-65 s).
- **Risk.** Medium: ghost-damage chunks, shields of another color (League's white shield, Fortnite's blue), Brawl Stars' bar moving with the player. Keep the counters as the check: a bar dip with no digit read near it gets the existing second look.
- **A/B.** Yes, flag `hp_bar`; arms compare records directly.

### 5. Tower and objective health read in code (Clash Royale), with the identity fix

- **Hypothesis.** Clash Royale's three losses are tower-health drops; with each tower's number read every few seconds and the player's side right, they are in the record with their amounts, and the result is a 0-1 loss.
- **Change.** `learn.js`: an element `objective` (a structure's health, each with its side), and `gold` widened to any resource count (elixir, boost, mana). `agent.js` `readCounters` reads `objective` and the resource beside the scoreboard; `core.js` turns a drop that holds into an `objective_damage` loss (`lossMoments`, `CLIP_RANK`, and `readFrom`/`clipSpans`, so it gets a run-up like a death) with "3197 to 761". Generic: any game that writes a structure's health. The working tree's `player_name_where` (drop far-side names) settles which towers are the player's.
- **Test.** Probe first: 1-2 calls on a sheet of the four towers at 1:24-1:34 and 3:05-3:28, to see the digits read. Then Clash Royale, 2 runs (run 1 relearns). Record: 3 of 3, with amounts; the result "lost"; Cited; False (the invented 0:44 tower).
- **Cost.** +1-3 counter calls (3:42 at 6 s is 37 cells, one call, plus a fine read around each drop); a few thousand tokens.
- **Risk.** Medium: four small numbers plus king towers per cell; level badges near them read as health.
- **A/B.** Yes, flag `objectives`; identity is checked in the same runs from `learned.playerName`.

### 6. Deaths while the screen follows someone else (Brawl Stars)

- **Hypothesis.** A death shows as health near 0, then the screen following a teammate ("Following: X") or a defeat line naming the player; code that takes those as death candidates finds both deaths, and masks the teammate's health it then reads.
- **Change.** Working tree's `hpSliver`, plus: a clip read's `screen_text` naming the player as killed or defeated, or "Following"/"Spectating", goes to `secondLooks` as a death candidate (they're batched, so no extra call), and in a round mode with no respawn (`deadFor` = the rest of the round) health reads after a death are dropped until the next round start.
- **Test.** Brawl Stars, 2 runs an arm (it varies). Record: 2 of 2 deaths, false near-deaths 5 → 0; then Cited.
- **Cost.** 0-1 calls.
- **Risk.** Low; "Following" could be a teammate's banner in another game: require the player's own plate to be gone too.
- **A/B.** Yes, flag `spectate_deaths` (hpSliver has its own).

### 7. Every loss gets the moment that decided it, with a structured cause

- **Hypothesis.** The coach stops at the minimum (3 moments for a habit, 1 for a one-off); requiring a decided moment at each loss raises Cited to the record's losses, and naming factors by reference keeps the read's numbers in the cause.
- **Change.** Arm A: `core.js` `checkFinish` sends back once unless each of the losses `costliest` lists (up to 6) has a turning point, evidence or fix at it or `led_to` it; a loss still uncovered after that is filled by code from the read's `last_choice` and factors, said as "from the clip read" and checked like any claim. Arm B, adds: each lesson gets `factors: [{kind, ref}]`, `ref` a read's factor (`W3.resources`) or a code fact from experiment 3, and code writes the numbers into `because`. For chess, an engine-graded move counts as looked at (`recordLook` from the record), so no `frames` turn is spent on a board the engine already read.
- **Test.** Chess (2-3 of 7), Marvel Rivals (2 of 4), Valorant (3 of 5), League. With the record and the reads replayed, only the coach and checks run, about 8 calls a run. Cited, Kinds#, False, calls.
- **Cost.** Arm A: +1 send-back at most, and the video check sees more claims (+1 call, about +20-40k tokens). Arm B: output tokens only. Chess saves about 4 turns.
- **Risk.** More claims, more send-backs; a filled-in moment is only as good as the read (do it after experiments 1-3).
- **A/B.** Yes, flags `cover_losses`, `factor_refs`.

### 8. Sharper HUD pictures, not sharper video (the user's "enhance image quality")

- **Hypothesis.** The cooldowns that decided losses (League's Flash 3:55 and ult 1:30 at 1:40; Marvel Rivals' ready slots; Brawl Stars' charged super; Valorant's ult READY) are small digits on icons. The abilities crop goes at about native size (`hudSheet`'s scale is max(1, 360 px / box width), about 1 for League's 0.195-wide box) inside one tiled picture, which the model may shrink further. Upscaled crops, read at the decision rather than mid-burst, read right.
- **Change.** Probe first, then `agent.js` `hudSheet`: a minimum digit height (scale `abilities` and `kill_count` crops 3x), the abilities row as its own picture if the probe says tiling hurts, and moments at 10, 5 and 2 s before the loss, or where experiment 4's drop starts, instead of 6 and 2 s before the record's (late) death time. Per-part media resolution, if the API takes it for Gemini 3; upscaling in code does the same either way.
- **Test.** Probe (no harness, about 12-16 calls on both models): League frames at 1:40, 4:18, 8:44 (known cooldowns), the abilities crop at 1x/2x/3x, alone and in the sheet; Marvel Rivals 4:25.5 slots; Brawl Stars 1:05.75 super. Score against the baseline. Then a loop on League, Marvel Rivals, Brawl Stars: resources Kinds# (cooldown named with its number).
- **Cost.** +1-6k image tokens a loss, against the sheet's saving of most of League's 197k.
- **Risk.** Low; the probe decides before a loop is spent. Raising the video's width or resolution instead is not proposed: it costs per frame on every clip, and the decisive pixels are the HUD's.
- **A/B.** Yes, flag `hud_zoom`; the probe is its own A/B.

### 9. Longer run-ups against denser last seconds (the user's "larger chunks of video")

- **Hypothesis.** Two different gaps. Decisions 18-30 s before the loss are outside the clip: Clash Royale's 3:27 was decided 3:01-3:15 (the clip starts 3:09), League's pings came at 1:16-1:32 for the 1:48 death (the clip starts 1:30). Mechanics within the last second are under-sampled: Valorant's first shot 0.25-0.35 s late, Siege's lowered rifle at 8:56.5-8:57.4.
- **Change.** Arm A: `core.js` `RUN_UP` 18 → 30 with the head at 1 fps (`HEAD_FPS`); the 8 fps tail unchanged. Arm B: the last 2 s before the loss at 16-24 fps as a third part in `clipSpans`.
- **Test.** Arm A on Clash Royale, League, Fortnite: information and position Kinds# at those losses. Arm B on Valorant and Siege: mechanics Kinds#.
- **Cost.** A: +12 frames a loss, about +3-4k tokens (roughly 280 a frame at high detail; measure it). B: about +32-48 frames, +9-13k a loss.
- **Risk.** A is low. B is the doubtful one: Flash-Lite may not see "moving while shooting" at any rate, and experiment 3's ammo-counter facts (first shot, no shot, reload) give the same mechanics from code; run B only if 3 leaves mechanics unnamed.
- **A/B.** Yes, flags `long_runup`, `dense_tail`.

### 10. A game profile (the user's idea), measured as a ceiling first

- **Hypothesis.** Where learn is the first stage that fails (Clash Royale's identity and towers, Brawl Stars' dropped boxes, Rocket League's missing boost), a right profile lifts the record and the resources factors; where the profile is already right (League, Valorant, Siege, Marvel Rivals) it changes little. A profile learned once per game and reused also removes run-to-run box drift and 2-6 learn calls a new recording.
- **Change.** Arm P1, ceiling (eval only, never shipped): a hand-checked profile per game in `eval/answer-keys/profiles/`, boxes measured from full-size frames, with the new elements (towers and elixir, boost, super/gadget/ammo/team bar) and the player's identity, written by the harness into `thirdeye.learned` before the run. Arm P2, shippable: `learn.js` learns a game once with more effort (16 frames from another recording or the rest of the `.full.mp4` session, two learn calls with box consensus, the box check on 5 frames), stored per game name and aspect ratio (`thirdeye.gameprofile.v1`); a new recording reuses its layout with one box-check call, while identity (name, side, character) stays per recording. Generic code: what's stored is learned, not written.
- **Test.** P1 on Clash Royale, Brawl Stars, Rocket League, with experiments 5 and 6 in (a perfect profile can't help a pipeline that doesn't read the element). P2 on the same three plus Valorant (learn from the Vyse recording, review TenZ's). Record, Kinds#, learn calls, and box agreement across runs. The `.full.mp4` files contain the eval clips, so learn P2 from frames outside the clip's span.
- **Cost.** P1: 0 learn calls (saves 3-4). P2: +2-4 calls once per game, then 1 per recording.
- **Risk.** P1 overstates what any learner can reach; that's its purpose. P2: a layout that changes with resolution, patch, or HUD scale; the per-recording box check catches it.
- **A/B.** Yes: profile source is the arm (learned per recording, P1, P2).
- **Expected.** Honest guess: P1 helps Clash Royale and Brawl Stars a lot only together with 5 and 6, Rocket League by one factor (boost), the rest little. If P1 moves nothing, the profile isn't the bottleneck and P2 isn't worth building.

### 11. Clip reads on 3.5 Flash-Lite, pinned

- **Hypothesis.** 3.1's thinking is capped at medium; the reads that decide the factors may be better on 3.5 at high. League run 3 (3.5) is the only League run that found the 4:30 near-death, but that's one run.
- **Change.** `agent.js` `readClips` (and `secondLooks`) pass `prefer: ['gemini-3.5-flash-lite']`; the harness pins the rest with `GEMINI_MODEL` and starts on the key with 3.5 left (`THIRDEYE_SECOND_KEY_FIRST=1`).
- **Test.** League, Valorant, Brawl Stars, both arms in the same morning after the 03:00 reset, record replayed. Kinds#, and the reads' stage metrics (non-filler kinds, times in window).
- **Cost.** Same calls; more thinking tokens; 3.5 has answered faster where it had quota.
- **Risk.** 3.5's daily quota ran out before 03:00 on both keys through loops 37 and 38, so both arms must run right after the reset, back to back.
- **A/B.** Yes, by `prefer`.

### 12. Speed, tokens and security riders

- **Hypothesis.** Two cheap changes cut minutes and tokens without touching accuracy, and a third closes an injection path.
- **Change.** (a) `readCounters`: two sheets in flight at once (as the clip reads are), so League's record phase (about 100 s, with 10 counter requests one after another) shortens. (b) `readClips`: a teammate's death goes high-detail only when the pass or the minimap puts it near the player; League read four far ones (`near: false`) at high detail, about 100k tokens. (c) `clipLine`, `checkClaims` and the closing call wrap `screen_text` in `G.untrusted`: it carries other players' chat word for word into the coach's prompt.
- **Test.** Every loop after they're in. Minutes (League's record phase from the timeline), prompt tokens, Cited unchanged; for (c), a unit test that `clipLine` wraps it, and one probe with an injected chat line.
- **Cost.** Saves about 30 s and about 100k tokens on League.
- **Risk.** (a) per-minute limits (watch for 429s); (b) a near teammate read low could lose its `near`.
- **A/B.** Yes, flags `par_counters`, `far_downs_low`; (c) needs none.

## 3. Order

### Before any loop (no harness, under 20 calls)

- **Flags.** `THIRDEYE_FLAGS` through `envScript`; the harness writes the flags and `usage.models` into each run's JSON.
- **Record replay.** The harness saves each recording's record (events, windows, counters) from a control run and injects it in later runs (`THIRDEYE_REPLAY=record` or `record,reads`). Read and coach experiments then differ only in what they change, and cost about 8-12 calls a run instead of 20-26.
- **Model pin.** `GEMINI_MODEL` from the process env in `envOf`, so a loop runs on one model; `report.mjs` gains a model-share column, and an A/B with different shares isn't compared.
- **Grader additions.** Kinds# (a cited cause's numbers against the baseline factor's: 42%, 621, 3:55, 2-0, 1 v 2); for chess, whether the cause names the engine's reply (...Nd5, ...Bc4, ...Bxf4+) instead of the word regex; the stage metrics from `stages.py` and `times.py`.
- **Offline tests.** Experiment 2 on loops 37/38's JSON; experiment 4's bar fill on frames; the probes for 5 and 8.

### Loops (about 12 runs a key a day, one harness at a time, 8-15 min a game at 2 runs)

The order follows what each experiment needs (a control first, the record before the reads that use it), not the rank.

| Day | Loop | What | Games (runs) | Runs |
|---|---|---|---|---|
| 1 | 39 control | The working tree as is (FACTOR_WHAT, HUD sheet, engine reply, name side, hpSliver, Valorant check fix, Fortnite quota fix) plus experiment 2. Reuse the loop 37/38 profiles (`$SP/ud-37-*`, `$SP/ud-38-*`) except Clash Royale and Brawl Stars (relearn). Save each record for replay. | all 9 (1 each; Brawl Stars 2) | 10 |
| 1 | 40 | Experiments 1 + 3 (one read, different fields; attribute by stage metric), record replayed | Marvel Rivals, Siege, League, Valorant, Rocket League, Brawl Stars (1 each) | 6 |
| 1 | 41 | Experiment 5 (+ P1 arm of 10 for Clash Royale) | Clash Royale (2 + 1) | 3 |
| 1 | spare | reruns of anything that died on quota | | 5 |
| 2 | 42 | Experiments 4 + 6 (both record-stage, different games except Brawl Stars) | Marvel Rivals, League, Fortnite (1 each), Brawl Stars (2) | 5 |
| 2 | 43 | Experiment 7, record and reads replayed (about 8 calls a run, so 8 runs cost about 3 runs' calls) | chess, Marvel Rivals, Valorant, League (arm A then B) | 8 |
| 2 | 44 | Experiment 8 (if the probe says so) and 9A, on separate games | 8: League, Marvel Rivals, Brawl Stars; 9A: Clash Royale, Fortnite | 5 |
| 2 | spare | | | 6 |
| 3 | 45 | Experiment 11, right after 03:00 | League, Valorant, Brawl Stars (both arms) | 6 |
| 3 | 46 | Experiment 10: P1 on Brawl Stars and Rocket League; P2 on Clash Royale, Brawl Stars, Rocket League, Valorant | | 6 |
| 3 | 47 | 9B only if mechanics are still unnamed after 3 | Valorant, Siege | 2 |
| 3 | 48 | All kept changes together, every game, 2 runs each | all 9 | 18 (day 4) |

- **What to combine.** Changes that touch different stages or different games share a loop (1 + 3; 4 + 6; 8 and 9A on separate games). Changes to the same field of the same call don't (8 and 9B both change what a loss read sees: separate games or separate loops).
- **What not to combine.** Anything with experiment 11 (the model is the variable), and experiment 10's arms (the profile is).
- **Experiment 12** rides along once it's in; it's measured by calls, tokens and minutes, with Cited as the guard.
- **Stop rule.** A change that lowers Cited or raises False on any game in its loop is reverted before the next loop, whatever it did elsewhere.
