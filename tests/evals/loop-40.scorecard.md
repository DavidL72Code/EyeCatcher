# Scorecard: loop-40

Every run held against the coach baselines (`eval/answer-keys/coach`), on the card in `eval/SCORECARD.md`. Cells are counts over the valid runs: n of N. ↑ higher is better, ↓ lower is better.

| Group | Measure | LoL | RL | Rivals | Val | CR | FN | BS | Chess | R6 | All |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Seeing | Player named right ↑ | void | 0/2 | 1/1 | 1/1 | 0/2 | 0/1 | 2/2 | 2/2 | 0/2 | 6/13 (46%) |
| Seeing | Player named as someone else ↓ | void | 2/2 | 0/1 | 0/1 | – | – | 0/2 | 0/2 | – | 2/8 (25%) |
| Seeing | Character named right ↑ | void | – | 1/1 | 1/1 | – | – | – | – | 1/2 | 3/4 (75%) |
| Seeing | Losses found in the record ↑ | void | 0/2 | 3/4 | 5/5 | 0/6 | 1/5 | 0/6 | 12/14 | 4/4 | 25/46 (54%) |
| Seeing | Deaths and points invented ↓ | void | 6/6 | 0/1 | 0/5 | – | 0/1 | – | – | 0/2 | 6/15 (40%) |
| Seeing | Numbers read right ↑ | void | – | – | – | – | – | – | – | – | – |
| Claims | Losses cited ↑ | void | 0/2 | 1/4 | 3/5 | 0/6 | 1/5 | 0/6 | 3/14 | 3/4 | 11/46 (24%) |
| Claims | Cited losses explained right ↑ | void | – | 0/1 | 1/3 | – | 1/1 | – | 3/3 | 2/3 | 7/11 (64%) |
| Claims | Cited losses partly right | void | – | 1/1 | 0/3 | – | 0/1 | – | 0/3 | 0/3 | 1/11 (9%) |
| Claims | Cited losses explained wrong ↓ | void | – | 0/1 | 2/3 | – | 0/1 | – | 0/3 | 1/3 | 3/11 (27%) |
| Claims | Cites at nothing real ↓ | void | 0/6 | 0/2 | 0/3 | 0/1 | 0/1 | – | 0/3 | 0/3 | 0/19 (0%) |
| Checker | False claims caught ↑ | void | 6/6 | 2/2 | 2/4 | – | – | – | – | 4/5 | 14/17 (82%) |
| Checker | True claims sent back ↓ | void | 0/6 | 1/3 | 2/4 | – | – | – | 5/5 | 4/8 | 12/26 (46%) |
| Cost | Runs (valid of all) | 0/2 | 2/2 | 1/2 | 1/2 | 2/2 | 1/1 | 2/2 | 2/2 | 2/2 | 13/17 |
| Cost | Minutes a run | – | 3.6 | 6.3 | 7.1 | 1.6 | 7.4 | 1.0 | 3.6 | 6.0 | 4.0 |
| Cost | Calls a run (answered / failed) | – | 19.5 / 1.0 | 28.0 / 1.0 | 24.0 / 1.0 | 10.5 / 0.5 | 19.0 / 1.0 | 5.5 / 1.5 | 12.5 / 1.0 | 25.5 / 1.0 | 16.8 / 1.0 |
| Cost | Tokens a run (prompt / output) | – | 275k / 53k | 358k / 69k | 454k / 73k | 90k / 18k | 181k / 32k | 70k / 3k | 175k / 35k | 263k / 60k | 211k / 39k |

- Void, left out of every row (the API refused or dropped calls, or no result): LoL run 1 (3 calls refused or dropped by the API), LoL run 2 (3 calls refused or dropped by the API), Rivals run 2 (3 calls refused or dropped by the API), Val run 1 (1 call the API failed and no retry answered (learn 429)).
- 7 cited losses or cites outside the key not graded yet.
- Graded by a grading agent, from the loop-40 worksheet, the validated coach baselines and the loop-40 notes (their grades kept where they grade a cite; runs they describe only in prose graded to match their totals of 10 right, 4 partly, 5 wrong); checked by a second grading agent (every wrong grade, every true send-back, and every other graded run), its 12 changes applied, by eval/SCORECARD.md.
