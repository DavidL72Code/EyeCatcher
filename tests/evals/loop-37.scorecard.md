# Scorecard: loop-37

Every run held against the coach baselines (`eval/answer-keys/coach`), on the card in `eval/SCORECARD.md`. Cells are counts over the valid runs: n of N. ↑ higher is better, ↓ lower is better.

| Group | Measure | LoL | RL | Rivals | Val | CR | FN | BS | Chess | R6 | All |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Seeing | Player named right ↑ | void | 0/1 | void | void | void | void | void | void | 0/1 | 0/2 (0%) |
| Seeing | Player named as someone else ↓ | void | – | void | void | void | void | void | void | – | – |
| Seeing | Character named right ↑ | void | – | void | void | void | void | void | void | 1/1 | 1/1 (100%) |
| Seeing | Losses found in the record ↑ | void | 1/1 | void | void | void | void | void | void | 2/2 | 3/3 (100%) |
| Seeing | Deaths and points invented ↓ | void | 0/1 | void | void | void | void | void | void | 0/1 | 0/2 (0%) |
| Seeing | Numbers read right ↑ | void | not graded | void | void | void | void | void | void | not graded | not graded |
| Claims | Losses cited ↑ | void | 1/1 | void | void | void | void | void | void | 2/2 | 3/3 (100%) |
| Claims | Cited losses explained right ↑ | void | not graded | void | void | void | void | void | void | not graded | not graded |
| Claims | Cited losses partly right | void | not graded | void | void | void | void | void | void | not graded | not graded |
| Claims | Cited losses explained wrong ↓ | void | not graded | void | void | void | void | void | void | not graded | not graded |
| Claims | Cites at nothing real ↓ | void | not graded | void | void | void | void | void | void | not graded | not graded |
| Checker | False claims caught ↑ | void | not graded | void | void | void | void | void | void | not graded | not graded |
| Checker | True claims sent back ↓ | void | not graded | void | void | void | void | void | void | not graded | not graded |
| Cost | Runs (valid of all) | 0/3 | 1/1 | 0/1 | 0/3 | 0/3 | 0/3 | 0/1 | 0/3 | 1/3 | 2/21 |
| Cost | Minutes a run | – | 8.3 | – | – | – | – | – | – | 13.4 | 10.9 |
| Cost | Calls a run (answered / failed) | – | 20.0 / 2.0 | – | – | – | – | – | – | 20.0 / 2.0 | 20.0 / 2.0 |
| Cost | Tokens a run (prompt / output) | – | 204k / 15k | – | – | – | – | – | – | 169k / 23k | 187k / 19k |

- Void, left out of every row (the API refused or dropped calls, or no result): LoL run 1 (no result), LoL run 2 (8 calls refused or dropped by the API), LoL run 3 (6 calls refused or dropped by the API), Rivals run 1 (8 calls refused or dropped by the API), Val run 1 (no result), Val run 2 (13 calls refused or dropped by the API), Val run 3 (no result), CR run 1 (3 calls refused or dropped by the API), CR run 2 (4 calls refused or dropped by the API), CR run 3 (3 calls refused or dropped by the API), FN run 1 (no result), FN run 2 (no result), FN run 3 (no result), BS run 1 (6 calls refused or dropped by the API), Chess run 1 (7 calls refused or dropped by the API), Chess run 2 (6 calls refused or dropped by the API), Chess run 3 (6 calls refused or dropped by the API), R6 run 1 (6 calls refused or dropped by the API), R6 run 2 (9 calls refused or dropped by the API).
- No grades file: the rows a grader fills in are empty.
