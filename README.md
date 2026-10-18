# Thirdeye

A post-game coach that watches a recording of your match, finds the one habit costing you the most fights, shows you the moments that prove it, and gives you a drill. In your next match it checks whether the habit is getting better.

It reads recorded gameplay video, so it can work for almost any game. Valorant is the first game profile.

## Run it

```bash
npm run dev
```

Open http://localhost:5177/. Put a free Gemini key in `.env` as `GEMINI_API_KEY=...`; the dev server passes it only to pages opened on this machine. Without one, the start screen asks for a key and keeps it in the browser.

`npm run fixture` makes a 2.5-minute synthetic match (`tests/fixtures/`, not committed). Once it exists, the start screen offers it as a test match.

## How it works

1. **The recording stays on your device.** The browser decodes it with [Mediabunny](https://mediabunny.dev) (WebCodecs).
2. **A small silent copy goes to Gemini.** It's 640 px wide at 2 frames a second, with no audio, so voice chat never leaves the device. It goes to the Gemini Files API, which deletes it after 48 hours.
3. **The coach runs.** It's one Gemini agent loop (`agent.js` on the shared `runAgent` in `gemini.js`), on Flash-Lite models.

The coach gets a goal, its tools and what each costs, a budget, the game profile, and the player's history. The prompt never lists an order of steps.

| Tool | What it does | Cost |
|---|---|---|
| `scan` | Reads every kill-feed line in a stretch from the full-quality recording: the player's kills and deaths, and teammates' too, with each side's team and whether each death was traded within 5 s. A low-detail pass over the scan copy adds round starts. The video never enters the coach's own context. | 1 call per 32 kill-feed lines, plus 1; 0 looks |
| `frames` | Grabs frames around up to 3 moments from the full-quality recording, of the whole screen or a region (aim area, kill feed, minimap). The coach sees them for one turn; after that they're swapped for a note. | 1 look per moment, 0 calls |
| `measure_aim` | Gemini boxes the enemy head nearest the crosshair at up to 6 moments, in one call. Code turns each box into head-heights and degrees using the game's FOV. A moment after the player's own death is skipped for free. | 1 look per moment, 1 call |
| `ask_player` | One question about a moment, for what video can't show. The app plays the moment and the player taps an answer. At most 3 per review. | Waits for the player |
| `finish` | Ends the review with one habit, or with "no single habit stood out". | Checked in code |

Every tool also takes `why` (what this step checks, shown live in the breakdown) and `notes` (theory board changes). Notes ride along with the next step, so updating the board never costs a turn of its own.

### Watching it work

The rail shows the review as it happens. One line with a spinner names the step running now. Under the theory board, **the breakdown** adds a card per step, newest first: what the coach is checking, in its own words; the frames it pulled or the aim crop with the head box and the measured number; what code skipped or sent back; and the theory it changed after that look. Each time on a card plays that moment. When the review ends, the cards fold into "How it got here".

### Reading the kill feed

It's a team game, so the coach needs every kill, not just the player's own. The low-detail scan copy can't show that: at 640 px the kill feed is a smear, and it found only 1 to 4 of 9 kills. So `scan` reads the kill feed from the original recording:

1. **Rows.** Code samples the kill-feed corner once a second and reads its rows on the game's grid (`killfeedGrid` in the profile). The grid is first fitted to the recording from 30 frames, because a stream layout can shift the feed (the TenZ VOD draws it 13 px lower). A slot holds a row when it's mostly team color and has white name text, so a red wall or a teal ability flash doesn't count.
2. **Teams.** Code reads each row's teams from pixels, starting at the right edge, past the victim's portrait: the first color is the victim's team (teal for the player's side, red for the enemy) and the next different color is the killer's. The game draws the victim's end in a muted shade, so muted color counts inside a row. A row that reads as one team on both ends gets no sides, since the background must have shown through.
3. **Each row once.** Code tracks rows from second to second by the shape of the victim's name in white text, which the background behind the feed can't change. New kills join at the bottom and old rows only move up, so a look-alike row lower down is a new kill. Each new row is cut out as a strip, and three frames in the second before it find when it appeared, to a quarter second.
4. **Names.** The strips go to Gemini numbered, 32 to a call, and Gemini reads the names. Gemini is good at names but mixed up the team colors in about half the rows, so the teams come from code. Measured from pixels on the two real recordings (`eval/feedprobe.mjs`): 2 calls for TenZ's 36 lines and 3 for Vyse's 41, with 35 and 41 of them in a strip. Whole crops, 12 to a call, took 7 and 9 calls.
5. **Events.** Code turns the readings into an event log. Repeated sightings become one event. A death counts as traded when the killer dies within 5 s. When a reading comes out as one team on both sides, the names' other kills settle it. A name that appears on both teams (both can pick Omen) is never trusted this way.
6. **Who the player is.** It's the name typed on the start screen. Without one, it's the victim the kill feed names at the player's own deaths, which the low-detail pass catches from the "Killed by" panel. A first version used the yellow marker on the player's rows instead, and it picked Killjoy, whose portrait is yellow.

### What code enforces

- **The budget.** 24 looks and 12 turns by default, and every tool result says what's left. Turns run out first, so the brief asks for several moments per call.
- **Dead time.** After the player dies, the screen is a death recap or a teammate's view until they're back in. How long that lasts comes from the profile's `deadFor`: the rest of a round when the scan found round starts, a respawn when it found none (deathmatch). `measure_aim` skips those moments before they cost a look or a call, and `finish` refuses evidence from more than 2 s after a death (the death itself can show a habit like dying alone).
- **No hunting for a reading.** A fight can be measured twice (the first try can land on the kill-feed line or the death); a third try is refused for free. When the numbers rule a habit out, `finish` says to drop the theory and name another, or finish with no habit, rather than to show more measurements.
- **Theories need a look.** A theory goes to "supported" only once one of its moments was looked at closely. A hunch stays at "testing", and the coach is told why.
- **Shots.** Code reads the HUD ammo counter (the profile's `ammo` region) 2 s either side of each close look and says whether the player fired: the magazine digits at the first steady frame against the last. Background behind the digits can make them unreadable, and then the answer is "unclear", never "no shots". A habit the profile marks `needsShots` (spraying, shooting while moving) can't cite a moment with no shots. On 8 stretches labeled by eye in the two real recordings (`eval/shotprobe.mjs`), 7 read right and 1 short one read unclear; none read "no shots" wrongly.
- **Said ahead.** Every look's result says what `finish` will still ask for (a won fight not yet looked at), so the coach rarely spends a turn on a rejected finish.
- **Evidence.** `finish` is sent back if any cited moment wasn't looked at closely, or if it cites fewer than 3 separate moments.
- **Aim habits match the numbers.** A habit the profile measures by aim (`measuredBy: "aim"`) needs at least 3 measurements with an enemy in view. It's sent back when those measurements put the crosshair at head level, or when a cited moment was measured at head level.
- **Evidence shows the habit.** Moments where the player got it right go in a separate `contrast` list, which the verdict shows as "Where you got it right". A moment can't be in both lists. With fewer than 3 moments that show the habit, the coach is told to answer "no single habit".
- **Real heads only.** A head box counts only if it sits at the top of a body box. Measurements where the enemy is very close come back with a warning.
- **Won fights.** `finish` is sent back once if the coach never looked at a fight the player won, since a habit that shows up just as often in wins isn't what's losing fights. Finishing again keeps the answer.
- **Measurement timing.** A measurement taken when the kill feed shows a won fight ending comes back with a warning. The scan times fights by their kill-feed line, but placement shows earlier, when the enemy first comes into view.
- **Progress.** When the player is working on an aim habit, code compares this match's measured median with the baseline. Half a head of change, over at least 3 duels each, counts as better or worse. The coach's own opinion is used only when there are no numbers.
- **Post-game only.** Thirdeye never reads game memory and never runs during a match.

The player decides which habit to work on ("Work on this" or "Not this"). History lives in `localStorage` on the device.

## Files

```
index.html  styles.css  app.js   UI: start screen, review timeline, theory board, verdict, past reviews
agent.js                         the coach: its brief, six tools, and the finish checks
video.js                         decode frames, make the scan copy, upload to the Files API
core.js                          pure logic: times, aim geometry, budget, evidence checks, theories, history
games/valorant.json              the game profile: FOV, screen regions, cues, habits and drills
gemini.js                        copied from hackathon/shared/gemini.js (REST client and agent loop)
scripts/dev.mjs                  static dev server; makes env.js from .env
tests/                           unit tests, the browser test, the live check, and the fixture maker
```

Adding a game means writing a profile in `games/`; the code doesn't change. Besides the FOV, regions, cues, and habits, the profile says how the game draws what code reads: the kill feed's grid, team colors, which way new rows join (`newRows`), and how the player's own rows are marked (`killfeedMine`); the HUD text color (`hudText`); and how long a death keeps the player out (`deadFor`). A game without a field gets a safe default: no kill-feed grid falls back to color bands, no `ammo` region skips the shot check, and no `deadFor` assumes a 5 s respawn.

## Tests

| Command | What it runs | Result (Oct 16, 2026) |
|---|---|---|
| `npm run test:unit` | 32 unit tests: aim geometry, the finish checks, the theory board, events, the kill-feed reader (rows on the grid, portraits, walls and flashes, new rows, names, teams, trades, finding the player), history, and how the agent loop handles pictures | 32 pass |
| `npm run test:e2e` | 36 checks in Chrome on the synthetic match, with Gemini and the Files API mocked: upload, scan, timeline, questions, the finish checks, the verdict, the re-check against a baseline, and a phone-width layout | 36 pass |
| `npm run test:live` | The real pipeline on the synthetic match, about 25 requests | Below |

**Live check on the synthetic match** (one run, 720p at 30 fps, 150 s):
- **Scan copy:** 0.63 MB, made in 2.7 s and uploaded in 6.1 s.
- **Scan:** found 7 of 8 kills and deaths within 2 s. Every time it found was 0.4 s late, because times are whole seconds.
- **Aim:** boxed 8 of 8 heads. The median error was 0.27° and the worst 1.01°, against a target of 0.5° median.
- **Review:** found the planted habit (crosshair low) in 12 calls and 7 looks, in 42 s. It measured two fights the player won as well as the losses.

These numbers come from drawn shapes, not game footage.

**Real footage (Oct 17).** The first 14 minutes of a YouTube match by a skilled player, screen-recorded at 1290x726. I labeled it by hand (9 kills, 6 deaths), and the labels match the in-game scoreboard. There were three eval runs (`npm run eval`):
- **Scan copy:** 27 MB, made in about 30 s and uploaded in about 30 s.
- **Scan:** found 4 of 6 deaths, but only 1 to 4 of 9 kills per run. Two frames a second and higher image detail didn't help.
- **Head boxes:** landed on the right head whenever an enemy was in view. Gemini once boxed a wall mark as a head, so it now has to return each head with its body, and code drops heads that aren't on a body.
- **Verdicts:** nothing usable yet. Across three runs the agent named three different habits (crosshair low, peeking wide, shooting while moving), and a frame-by-frame check supports none of them. Twice it measured, saw the crosshair at head level, and dropped that theory. Gemini's agentic mode said "crosshair low" every time, against the measurements. The fixed pipeline mostly measured empty or point-blank frames.

**Kill feed on the same footage.** I labeled every kill-feed line from 0:00 to 10:00 by hand: 41 events, most of them teammates'. Each full 14-minute scan costs about 15 model calls and 1 to 2 minutes.
- **Lines found:** all 41 in each of the last three full-match runs, against 1 to 4 of the player's 9 kills before the reader existed. The first version found 22 of 22 and 19 of 19 on two stretches, but it only worked because the team checks covered for rows it merged; on the full match it picked the wrong player.
- **Player's own fights:** when the player was identified correctly, the scan found all 9 kills and all 6 deaths.
- **Teams:** 37 of 41 right in the best run. All four misses were teammate Febera's deaths: her portrait at the end of the row reads as the enemy color. The reader now skips the portrait, and those frames read correctly.
- **Who the player is:** wrong in two of four full-match runs, first Killjoy (a yellow portrait), then the allied Omen (two Omens, plus a teammate's death taken for the player's). The current rule counts only teammates and combines yellow marks with the player's death screens. It passes the unit tests, but the live check ran out of Gemini's free daily quota. **Not verified on the real match yet.** Typing your in-game name on the start screen skips the guess.

**Next test:** a recording with a habit played on purpose, to see whether a strong habit gets caught.

## Limits

- **Scan detail.** The scan watches one frame a second at low resolution. A fight that ends between frames, or a kill feed the model can't read, gets missed. A missed fight only lowers recall; the coach can still look closely anywhere.
- **Head size.** Small heads, under 6 px, give rough measurements, and the tool says so. Stretched resolutions, a crosshair moved off center, or a custom HUD break the profile's assumptions.
- **Quota.** Each turn is one request from Gemini's free daily allowance.
