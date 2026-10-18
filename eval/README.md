# Evaluation

`npm run eval` runs three reviewers on every recording in `recordings.json` and scores them against the habit planted in it:

| System | What it is |
|---|---|
| `agent` | Thirdeye's agent (`agent.js`) with 24 looks and 12 turns, as in the app. Questions to the player are skipped, since no one is there to answer. |
| `pipeline` | A fixed pipeline with the same pieces and the same 30 looks (`pipeline.js`). It scans the whole match, and for every death it checks four frames 1 to 2.5 s before the kill-feed line (one call) and measures the aim in the latest one that still shows the player's own live view. A frame from the death recap, a kill cam, a teammate's view, or with the scoreboard over the middle doesn't count. It reports `crosshair_low` when the median of 3 or more measurements is 0.75 heads or more below the head. Otherwise it reports no habit. |
| `gemini-agentic` | One prompt on the same scan copy, using Gemini's agentic video mode on `gemini-3.5-flash-lite` (Interactions API, `gemini-agentic.js`). It gets the same game background as the agent and none of the tools or checks. When the API refuses, the result records the refusal. |

All three share one upload of the scan copy per recording. Model calls are counted from Chrome's network traffic, so retries and model fallbacks count too. Each run writes `results-<date>.json` with every finding, the evidence, the agent's tool sequence, and the calls per model, then prints a table.

```bash
npm run eval
```

```bash
npm run eval -- dm-crosshair
```

The second form runs only the recordings whose file name contains `dm-crosshair`. `EVAL_MAX_CALLS` caps the model calls per recording (default 80). The synthetic match takes about 27.

## Adding a real recording

1. Play a deathmatch or a custom game with one habit on purpose: aim at the floor (`crosshair_low`), always swing wide (`wide_peek`), fire while moving (`moving_shots`), spray at long range (`long_spray`), or re-peek the same angle (`repeek`). Play some games normally too, as clean controls.
2. Record the whole game at the default HUD with the crosshair centered (OBS or the NVIDIA overlay is fine). Put the file in `eval/recordings/`. Git ignores that folder, so the video stays on your machine.
3. Add an entry to `recordings.json`. Paths are relative to this folder. `plantedHabit` is a `habit_id` from `games/valorant.json`, or `null` for a clean control.

```json
{ "file": "recordings/dm-crosshair-low-1.mp4", "plantedHabit": "crosshair_low", "note": "Ascent DM, aimed at the floor all game" }
```

`truth` is optional. It points at a JSON file with `duels: [{ "t": seconds }]`, and with it the table shows how many cited moments fall within 2 s of a real duel. Add `kills` and `deaths` (lists of seconds) and the run also scores the scan against them. Add `killfeed`, as `{ "window": [from, to], "events": [{ "t", "killer", "killerTeam", "victim", "victimTeam" }] }` with teams `ally` or `enemy`, and it scores every kill-feed line in the window: found within 3 s, and whether both teams came out right. `game` is optional too and defaults to `valorant`.

To label a recording by hand, `frames.mjs` makes contact sheets:

```bash
node eval/frames.mjs eval/recordings/match.mov sheet 0 900 1 0.42,0.7,0.16,0.18 120 12 120
```

That example puts one tile a second of the kill-emblem area on each sheet. The death panel works the same way at `0.73,0.3,0.26,0.1`, sampled every 2 s. `info` draws the profile's regions on four frames, so you can check they line up with the HUD, and `at` saves single frames.

To check the kill-feed reader on the labeled recordings without spending any Gemini calls, `feedprobe.mjs` cuts the row strips a scan would send, scores them against the `killfeed` labels, and saves the pictures for a look by eye:

```bash
node eval/feedprobe.mjs
```

`shotprobe.mjs` does the same for the shot check: it reads the ammo counter over stretches labeled by eye and reports which read right, and whether any real shooting was read as "no shots", the mistake that would throw out a real habit.

## Reading the results

- One synthetic recording proves nothing about real footage. The fixture has flat shapes, a clean kill feed, and a planted habit on every death, so it only shows that the pieces work end to end.
- For `gemini-agentic`, Looks counts its own processing calls (the places it chose to look). It sees only the scan copy (640 px, 2 fps), while the agent's close looks read the original video. That gap is part of what the comparison measures, so keep it in mind before calling it a fair fight on detail.
- The pipeline can only ever find `crosshair_low`. A planted habit of another kind tests whether the agent can do what the pipeline can't.
- Clean controls are where a confident reviewer gets caught out. With no controls, false positives are untested, and the table says so.
- Agent reviews on the real recordings took 23 to 69 requests on Oct 17 (TenZ 41). On Oct 18, with the 12-turn cap, row-strip kill-feed reads, and one aim call per batch, they took 22 (Vyse: 12 turns, 6 kill-feed and scan, 4 aim) and 20 (TenZ: 12, 3, 5), with no retries. Both used every turn, so turns are now most of the cost. Spread a large set across days on the free tier.
- `headcheck.mjs` compares head boxes one image per call with several per call (about 22 calls). Oct 18, two runs: on the synthetic match's 16 known heads, median error 0.27° one per call and 0.09° batched. On 10 TenZ duel moments the two ways differ by about as much as one way asked twice (median 1.2 heads), so batching costs nothing measurable, and real-footage boxes are only good to about a head.
