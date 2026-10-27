# Scorecard: loop-41

Every run held against the coach baselines (`eval/answer-keys/coach`), on the card in `eval/SCORECARD.md`. Cells are counts over the valid runs: n of N. ↑ higher is better, ↓ lower is better.

| Group | Measure | LoL | RL | Rivals | Val | CR | FN | BS | Chess | R6 | All |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Seeing | Player named right ↑ | 2/2 | void | void | void | 0/2 | 0/1 | 0/2 | 2/2 | 0/2 | 4/11 (36%) |
| Seeing | Player named as someone else ↓ | 0/2 | void | void | void | – | – | – | 0/2 | 2/2 | 2/6 (33%) |
| Seeing | Character named right ↑ | 2/2 | void | void | void | – | – | – | – | 2/2 | 4/4 (100%) |
| Seeing | Losses found in the record ↑ | 4/6 | void | void | void | 0/6 | 1/5 | 0/6 | 12/14 | 4/4 | 21/41 (51%) |
| Seeing | Deaths and points invented ↓ | 0/3 | void | void | void | – | 0/1 | 1/1 | – | 0/2 | 1/7 (14%) |
| Seeing | Numbers read right ↑ | – | void | void | void | – | – | – | – | – | – |
| Claims | Losses cited ↑ | 5/6 | void | void | void | 0/6 | 1/5 | 0/6 | 6/14 | 3/4 | 15/41 (37%) |
| Claims | Cited losses explained right ↑ | 1/5 | void | void | void | – | 0/1 | – | 5/6 | 2/3 | 8/15 (53%) |
| Claims | Cited losses partly right | 1/5 | void | void | void | – | 1/1 | – | 1/6 | 1/3 | 4/15 (27%) |
| Claims | Cited losses explained wrong ↓ | 3/5 | void | void | void | – | 0/1 | – | 0/6 | 0/3 | 3/15 (20%) |
| Claims | Cites at nothing real ↓ | 0/9 | void | void | void | 0/1 | 0/1 | 0/1 | 0/16 | 0/4 | 0/32 (0%) |
| Checker | False claims caught ↑ | 7/10 | void | void | void | 1/1 | – | 3/3 | 1/1 | 1/1 | 13/16 (81%) |
| Checker | True claims sent back ↓ | 3/10 | void | void | void | 0/1 | – | 1/4 | 1/2 | 2/3 | 7/20 (35%) |
| Cost | Runs (valid of all) | 2/2 | 0/2 | 0/2 | 0/2 | 2/2 | 1/2 | 2/2 | 2/2 | 2/2 | 11/18 |
| Cost | Minutes a run | 6.9 | – | – | – | 4.5 | 6.0 | 4.5 | 4.0 | 5.3 | 5.1 |
| Cost | Calls a run (answered / failed) | 31.5 / 1.5 | – | – | – | 20.5 / 1.5 | 20.0 / 1.0 | 20.0 / 1.0 | 13.5 / 1.0 | 22.0 / 1.0 | 21.4 / 1.2 |
| Cost | Tokens a run (prompt / output) | 514k / 66k | – | – | – | 315k / 43k | 220k / 32k | 304k / 43k | 174k / 36k | 275k / 48k | 308k / 46k |

- Void, left out of every row (the API refused or dropped calls, or no result): RL run 1 (no result), RL run 2 (no result), Rivals run 1 (no result), Rivals run 2 (no result), Val run 1 (no result), Val run 2 (no result), FN run 2 (16 calls refused or dropped by the API).
- 14 cited losses or cites outside the key not graded yet.
- Graded by a grading agent, from the loop-41 worksheet, notes and ledger and the validated baselines (loss grades as the notes give them; sent-back claims judged against each baseline's happened, factors and not_true); checked by a second grading agent (every wrong grade, every true send-back, and every other graded run), its 12 changes applied, by eval/SCORECARD.md.
