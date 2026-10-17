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
| `scan` | A separate Gemini call watches a stretch of the copy and lists kills, deaths, and rounds with times. The video never enters the coach's own context. | ~66 tokens per second watched, 0 looks |
| `frames` | Grabs up to 12 frames around a moment from the full-quality recording, of the whole screen or a region (aim area, kill feed, minimap). The coach sees them for one turn; after that they're swapped for a note. | 1 look |
| `measure_aim` | Gemini boxes the enemy head nearest the crosshair. Code turns that into head-heights and degrees using the game's FOV. | 1 look |
| `ask_player` | One question about a moment, for what video can't show. The app plays the moment and the player taps an answer. At most 3 per review. | Waits for the player |
| `note` | Puts a theory on the board the player watches: testing, supported, or dropped. | Free |
| `finish` | Ends the review with one habit, or with "no single habit stood out". | Checked in code |

### What code enforces

- **The budget.** 30 looks and 30 model calls by default, and every tool result says what's left.
- **Evidence.** `finish` is sent back if any cited moment wasn't looked at closely, or if it cites fewer than 3 separate moments.
- **Aim habits match the numbers.** A habit the profile measures by aim (`measuredBy: "aim"`) needs at least 3 measurements with an enemy in view. It's sent back when those measurements put the crosshair at head level, or when a cited moment was measured at head level.
- **Evidence shows the habit.** Moments where the player got it right go in a separate `contrast` list, which the verdict shows as "Where you got it right". A moment can't be in both lists. With fewer than 3 moments that show the habit, the coach is told to answer "no single habit".
- **Real heads only.** A head box counts only if it sits at the top of a body box. Measurements where the enemy is very close come back with a warning.
- **Won fights.** `finish` is sent back once if the coach never looked at a fight the player won, since a habit that shows up just as often in wins isn't what's losing fights. Finishing again keeps the answer.
- **Measurement timing.** A measurement taken when the kill feed shows a fight ending comes back with a warning. The scan times fights by their kill-feed line, but placement shows earlier, when the enemy first comes into view.
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

Adding a game means writing a profile in `games/`; the code doesn't change.

## Tests

| Command | What it runs | Result (Oct 16, 2026) |
|---|---|---|
| `npm run test:unit` | 21 unit tests: aim geometry, the finish checks, the theory board, events, history, and how the agent loop handles pictures | 21 pass |
| `npm run test:e2e` | 35 checks in Chrome on the synthetic match, with Gemini and the Files API mocked: upload, scan, timeline, questions, the finish checks, the verdict, the re-check against a baseline, and a phone-width layout | 35 pass |
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

**Next test:** a recording with a habit played on purpose, to see whether a strong habit gets caught.

## Limits

- **Scan detail.** The scan watches one frame a second at low resolution. A fight that ends between frames, or a kill feed the model can't read, gets missed. A missed fight only lowers recall; the coach can still look closely anywhere.
- **Head size.** Small heads, under 6 px, give rough measurements, and the tool says so. Stretched resolutions, a crosshair moved off center, or a custom HUD break the profile's assumptions.
- **Quota.** Each turn is one request from Gemini's free daily allowance.
