# EyeCatcher

David Le, Tri Huynh, Deavan Hudtohan, Evan Yang

## 1. Project Overview

Many people like to game but get frustrated after they reach a plateau in their skills. Coaching from people online often costs an arm and a leg, and watching your own replay is a pain and a hassle, and sometimes you still don't know what you did wrong. The people we think would benefit most from our application are competitive players looking to get better, but any gamer can reap the benefits it provides, from children, to adults, to coaches.

So what we made is an open source agentic AI coach that you can use through GitHub Pages or download onto your own machine. Just plug in a Google AI Studio key, drop in a video, follow the AI in real time, and get a critique video and a report on what you could have done better throughout the match.

This system benefits from agentic AI because there's no set structure or workflow for critiquing a video: you need different things every time. Agentic AI gives the AI the autonomy to pick any tool it thinks it needs for the task. It also lets us support numerous games, because the AI researches the game itself instead of using a hardcoded profile.

## 2. Agentic AI Design

![How EyeCatcher reviews a match: learn the game, read the match record, the coach agent loop with its six tools, three checks that can send a finding back, then the report](docs/architecture.svg)

For the overall workflow, you only need to upload your recording. The AI first learns the game with a first pass over the recording, collecting key information like the screen layout, the HUD, and which game it is. Code and Gemini then do a second-look scan and build the match record: kills, fights, the kill feed, key moments, and so on. The coach then uses the tools at its disposal to critique the key moments passed in and form a hypothesis about why the player is losing overall. Its tools are research, which searches the web; read clips and frames, which get clips or frames at certain moments; measure aim; read HUD; and ask you, for clarification when something is unclear.

The proposed findings for the key moments are then checked by code, and each claim is checked by the AI verification agent, which we test by planting fake claims for it to catch. The final pass goes to the human, who decides whether they agree with the finding, and if not, can send it back for further review. If they accept it, it outputs the final report and the narrated critique.

Tools and resources used: Electron, Python, [Motion](https://motion.dev), Claude Code, [chess.js](https://github.com/jhlywa/chess.js), Mediabunny and MediaRecorder, HTML, CSS, JavaScript, and the Gemini API.

## 3. Working Prototype

How to run and test the application. Every way needs a free Gemini API key.

### Get a Gemini API key

1. Go to https://aistudio.google.com/apikey and sign in with a Google account. You must be 18 or older, in a region where the Gemini API is available.
2. Choose Create API key.
3. Copy the key. You paste it into the app's Coach screen, or into `.env` when you run from source. It's sent only to Google.

The free tier costs nothing and allows about 500 requests a day per model. A review takes 15 to 25, so that's about 20 reviews a day. On the free tier Google may use what you send to improve its products, and people may read it ([Gemini API terms](https://ai.google.dev/gemini-api/terms)). Don't review recordings that show anything private.

### Use it on GitHub Pages

1. Open https://davidl72code.github.io/EyeCatcher/ in Chrome or Edge.
2. Go to Coach and paste your key. Your browser keeps it and sends it only to Google.
3. Drop in a recording (MP4, MOV, MKV, or WebM).

There's no server behind the website. Your recordings and reviews stay in your browser. Unlike the app, the critique uses your browser's voices, and a past review asks for its recording again.

To run the website copy on your own machine (needs Node.js 20 or newer and Python 3):

```bash
git clone https://github.com/DavidL72Code/EyeCatcher.git
cd EyeCatcher
npm run web
python3 -m http.server 8080 --directory site
```

Then open http://localhost:8080. `npm run web` uses only Node, so there's nothing to install first.

To put your own copy on GitHub Pages: fork the repo, set Settings › Pages › Source to GitHub Actions, and push to `main`. `.github/workflows/pages.yml` builds and deploys it.

### Download it

1. Get the installer for your system from the [latest release](https://github.com/DavidL72Code/EyeCatcher/releases/latest):

   | System | File |
   | --- | --- |
   | Mac with Apple silicon (M1 or later) | `Eye-Catcher-<version>-mac-arm64.dmg` |
   | Mac with Intel | `Eye-Catcher-<version>-mac-x64.dmg` |
   | Windows 10 or 11 | `Eye-Catcher-<version>-win-x64.exe` |
   | Linux | `Eye-Catcher-<version>-linux-x86_64.AppImage` |

2. Install it. The installers aren't signed with a paid certificate yet, so each system warns you the first time.
   - macOS: open the `.dmg` and drag Eye Catcher into Applications. The first launch is blocked. Go to System Settings › Privacy & Security, find "Eye Catcher was blocked", and choose Open Anyway. Or run this once:
     ```bash
     xattr -dr com.apple.quarantine "/Applications/Eye Catcher.app"
     ```
   - Windows: run the `.exe`. If SmartScreen stops it, choose More info, then Run anyway.
   - Linux: make the file runnable, then open it:
     ```bash
     chmod +x Eye-Catcher-*.AppImage
     ```
3. Open Coach, paste your key, and drop in a recording.

The app keeps your key encrypted in the system keychain (the macOS Keychain, Windows DPAPI, or the Linux keyring). The voice model, Kokoro (about 90 MB), downloads the first time a critique plays. Each release lists every installer's SHA-256 in `SHA256SUMS.txt`, to compare with `shasum -a 256 <file>`.

### Run it from source

You need Node.js 20 or newer and git.

```bash
git clone https://github.com/DavidL72Code/EyeCatcher.git
cd EyeCatcher
npm install
cp .env.example .env
```

On Windows, use `copy .env.example .env`. Open `.env` and put your key after `GEMINI_API_KEY=`. Then start the desktop app:

```bash
npm run desktop
```

Or run it in your browser at http://localhost:5177/:

```bash
npm run dev
```

Home's demo clips aren't in the repo, since they're cut from other players' videos. `npm run scenes` makes them from recordings on your machine.

### Test it

#### Tests, no API key

The fixtures and browser tests drive Google Chrome. Set `CHROME` to its path if it isn't in the default Mac location.

```bash
npm install
npm run fixture
npm run fixture:chess
npm run test:unit
npm run test:e2e
npm run test:desktop
npm run test:chess-video
```

`npm run fixture` makes a 2.5-minute synthetic shooter match, and `npm run fixture:chess` two synthetic chess games, one with blunders planted under time pressure. Both go in `tests/fixtures/`, which git ignores. `npm test` runs the unit tests and the browser test together.

#### Evals that call Gemini

Put your key in `.env` first. Each one spends real requests from your daily allowance.

```bash
npm run test:live
```

The whole pipeline on the synthetic match: learning, the scan, aim, and a full review, about 25 requests. It prints what each piece measured against the fixture's truth.

```bash
npm run eval -- match
```

Runs the agent, a fixed pipeline, and Gemini's own agentic video mode on the synthetic match, and scores each against the planted habit (about 27 requests). `npm run eval -- chess` does the same on the chess games. `EVAL_MAX_CALLS` caps the calls per recording (default 80).

```bash
node eval/researchcheck.mjs
```

Researches six games and scores the answers against `eval/research-checklist.json`. About 10 requests a game. `GAMES="Valorant,Rocket League"` runs fewer.

#### Your own recordings

1. Play a match with one habit on purpose (aim at the floor, always swing wide), or a normal one as a control.
2. Put the file in `eval/recordings/`. Git ignores that folder.
3. Add it to `eval/recordings.json` with the habit you played, or `null` for a control. The fields are in [eval/README.md](eval/README.md).
4. Run it, by any part of its file name:
   ```bash
   npm run eval -- my-match
   ```

To score whole reviews the way the loops are scored, write a baseline for your clip like those in `eval/answer-keys/coach/`, then:

```bash
node eval/scorecard.mjs <loop dir> <name>
node eval/scorecard.mjs compare <a> <b>
```

The first writes the card for one loop's runs, and the second compares two loops on the games valid in both. How each row is graded is in [eval/SCORECARD.md](eval/SCORECARD.md). The harness that runs a loop's reviews in the desktop app isn't in the repo yet.

## 4. Demo

https://www.youtube.com/watch?v=FdzcqXNcqk8

1. Problem: the user keeps dying the same way in ranked and doesn't know why.
2. User interaction: the user drops in a match recording and answers any clarifying question the AI asks.
3. Agentic AI workflow: the system chooses its own tools to accomplish the task, like scanning for key moments, getting clip intervals, getting higher-clarity frames or clips, and asking the user when something is unclear.
4. Result: the user gets a critique video that points out the mistakes at key moments, and an overall critique of what's making them lose the most and what to do to improve.

## 5. Evaluation

### What we test

| Area | What's tested | How | Latest result |
| --- | --- | --- | --- |
| Logic | 237 unit tests: the finish rules, aim geometry, the kill-feed reader, chess reading and scoring, the claim-check rules, the backend's locks, the scorecard | `npm run test:unit` | 237 of 237 pass (Oct 25) |
| The app | 178 checks in Chrome on a synthetic match, with Gemini mocked: upload, scan, timeline, the finish checks, the report, past reviews, phone layout, no code from outside | `npm run test:e2e` | 178 of 178 pass (Oct 25) |
| Desktop app | 22 checks in Electron: recordings remembered across a restart, files you didn't give it refused, the key never in the page, the Eye Catcher folder | `npm run test:desktop` | 22 of 22 pass (Oct 25) |
| Chess reader | Moves read back off synthetic chess video, against a Stockfish truth file | `npm run test:chess-video` | All 64 plies, in order |
| Installers | Nothing private packed; each DMG verifies, opens, and keeps its signature; every file matches the sum taken where it was built | `build/check-pack.cjs`, `build/check-dmg.cjs`, `.github/workflows/release.yml` | v0.1.2: 4 of 4 installers pass (Oct 25) |
| Kill-feed reader | 41 kill-feed lines labeled by hand on a real Valorant match | `npm run eval` | 41 of 41 lines; all 9 kills and 6 deaths (Oct 20) |
| Match record | Deaths, kills, and goals on Rocket League, Marvel Rivals, and League clips, against truth read off the frames | `node eval/recordcheck.mjs` | Rocket League 4 of 4 goals to the right side; Rivals 1 of 1 death, 13 of 14 kills, none invented; League 2 of 2 deaths, no kills invented (Oct 22) |
| Video check | 25 claims labeled off the frames (15 true, 10 false), run twice | `node eval/verifycheck.mjs` | 30 of 30 true claims stood, 18 of 20 false ones stopped, 0 of 24 planted ones agreed with (Oct 22) |
| Research | Six games, scored against a checklist written before any answer | `node eval/researchcheck.mjs` | Coverage 47 of 57 to 55 of 57; errors 26 to 0 (Oct 20) |
| Shots | The ammo counter over 12 stretches labeled by eye | `node eval/shotprobe.mjs` | 12 of 12, none wrongly "no shots" (Oct 22) |
| Chess, real | A chess.com game recorded on a phone | By hand, against the move list | 52 of 52 plies, in order (Oct 24) |
| Whole pipeline | Learning, scan, aim, and a review on a synthetic match with a planted habit | `npm run test:live` | 7 of 8 kills and deaths within 2 s; aim error 0.27° median; found the planted habit in 12 calls |
| Whole reviews | Every review held against a coach's read of 33 losses in 9 games, frame by frame | `eval/scorecard.mjs` | Below |

### Whole reviews, loop by loop

The coach baselines in `eval/answer-keys/coach/` cover League of Legends, Rocket League, Marvel Rivals, Valorant, Clash Royale, Fortnite, Brawl Stars, chess, and Rainbow Six Siege. Each loop reviews every game 2 or 3 times in the desktop app, and every run is scored on the same card ([eval/SCORECARD.md](eval/SCORECARD.md)). From [tests/evals/README.md](tests/evals/README.md), Oct 25:

| Loop | Losses found in the record (higher is better) | Losses cited (higher) | Cited and explained right (higher) | Deaths and points invented (lower) | False claims caught (higher) | Calls a run | Prompt tokens a run |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 37 | 40 of 55 (73%) | 19 of 55 (35%) | not graded | 6 of 22 (27%) | not graded | 18.7 | 244k |
| 38 | 26 of 48 (54%) | 15 of 48 (31%) | not graded | 3 of 9 (33%) | not graded | 18.9 | 262k |
| 39 | 45 of 66 (68%) | 25 of 66 (38%) | not graded | 7 of 33 (21%) | not graded | 23.1 | 351k |
| 40 | 37 of 61 (61%) | not counted | 10 of 61 (16%) | 14 of 33 (42%) | 17 of 22 (77%) | 18.1 | 264k |
| 41 | 22 of 46 (48%) | not counted | 9 of 46 (20%) | 5 of 12 (42%) | 13 of 16 (81%) | 21.0 | 298k |

Loops 38 and 41 ran fewer games: in loop 41, 6 of 18 runs (Rocket League, Marvel Rivals, Valorant) had most of their calls refused by the quota and don't count. Each loop's card, report, and grades are in `tests/evals/`.

### What worked

- Readers written in code held up: 41 of 41 kill-feed lines, 52 of 52 chess plies off a phone recording, 12 of 12 ammo stretches. Before the kill-feed reader, the scan found 1 to 4 of the player's 9 kills.
- The video check. It let 30 of 30 true claims stand, stopped 18 of 20 false ones, and agreed with none of the 24 planted. In loops 40 and 41 the checks caught 17 of 22 and 13 of 16 false claims.
- Research. Coverage of what decides each game went from 82% to 96%, with no errors left.
- The same match takes the same path. At temperature 0, three reviews of one Apex match on Oct 19 came out identical, down to 263,008 prompt tokens each.
- Cost. Loop 41 averaged 21 calls and 298k prompt tokens a run, about $0.20 at 3.5 Flash-Lite's list price, and nothing on the free tier.

### What didn't

- Explaining the loss. The coach named what decided a loss in 16% of them (loop 40) and 20% (loop 41).
- Coverage. In loops 37 to 39 the coach cited only 31% to 38% of the baseline losses.
- Invented deaths and points: 14 of 33 in loop 40, 5 of 12 in loop 41.
- Who the player is. Loop 41 got the player's name right in 4 of 12 runs.
- Good claims thrown out. In loop 41, 7 of the 20 claims the checks sent back were true.
- The quota. Loop 41 lost 6 of 18 runs to refused calls, and a review that falls back to 3.1 Flash-Lite can take 10 to 20 minutes.

### Failures we hit

Each has a fix in the code. [tests/evals/ledger.md](tests/evals/ledger.md) says which are proven on their own case.

- Clash Royale: it took the opponent's name for the player's, and called a 0-1 loss a win (Oct 24).
- League: the low-detail pass gave the player 22 kills, every one of them a minion (loop 40; true: 0).
- Brawl Stars: a review ended "nothing lost" after 3 calls, on a match with 2 deaths (loop 40).
- Habits judged by eye: on Oct 18, 2 of the 3 habits it named were false. Apex's "reloading in the open" cited moments that were healing and riding ziplines.
- The first release: v0.1.0's Mac download was corrupt. Each Mac runner built both DMGs, and their copies landed on one path. v0.1.2 fixed it, and the release now checks every file before it's published.

## 6. Project Documentation

GitHub: https://github.com/DavidL72Code/EyeCatcher

What was built: EyeCatcher, an open source agentic AI coach for any video game. You upload a prerecorded match, and code and the AI coach agent scan it, identify what matters, take a closer look, analyze, confirm, and finally output a critique video and a final report.

How it works: Gemini learns the game's HUD from the recording, then, along with code, builds a match record of kills, deaths, HUD numbers, and the clips worth watching, and an AI coach watches the losing clips. Then a separate verification agent checks each claim against the record (including false claims we planted, to make sure it doesn't just agree with everything) and against the video, before it reaches you.

How to run it: download the installer for macOS, Windows, or Linux from [GitHub Releases](https://github.com/DavidL72Code/EyeCatcher/releases/latest), or in a terminal, `git clone` the repo, `cd EyeCatcher`, `npm install`, then `npm run desktop`. The full steps are in [Working Prototype](#3-working-prototype).

Tools and technologies: the Gemini API, Electron, [Mediabunny](https://mediabunny.dev), [chess.js](https://github.com/jhlywa/chess.js), [Stockfish](https://stockfishchess.org), [Playwright](https://playwright.dev), and GitHub Actions.

Known limitations: in our last eval (loop 41), of the 16 losses the coach cited, it explained 9 right, 4 partly, and 3 wrong, and it's weakest in games without a kill feed. Another limitation is that the application is post-game only, not during the match. The biggest thing holding our app back is the free Gemini tier, which allows about 20 reviews a day per key, but that should be enough for the average person.

How each step works in detail, with the measurements behind it and the full list of limits, is in [docs/how-it-works.md](docs/how-it-works.md).
