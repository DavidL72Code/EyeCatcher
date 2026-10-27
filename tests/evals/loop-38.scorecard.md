# Scorecard: loop-38

Every run held against the coach baselines (`eval/answer-keys/coach`), on the card in `eval/SCORECARD.md`. Cells are counts over the valid runs: n of N. ↑ higher is better, ↓ lower is better.

| Group | Measure | LoL | CR | BS | Chess | All |
|---|---|---|---|---|---|---|
| Seeing | Player named right ↑ | void | void | 3/3 | void | 3/3 (100%) |
| Seeing | Player named as someone else ↓ | void | void | 0/3 | void | 0/3 (0%) |
| Seeing | Character named right ↑ | void | void | – | void | – |
| Seeing | Losses found in the record ↑ | void | void | 1/9 | void | 1/9 (11%) |
| Seeing | Deaths and points invented ↓ | void | void | – | void | – |
| Seeing | Numbers read right ↑ | void | void | not graded | void | not graded |
| Claims | Losses cited ↑ | void | void | 2/9 | void | 2/9 (22%) |
| Claims | Cited losses explained right ↑ | void | void | not graded | void | not graded |
| Claims | Cited losses partly right | void | void | not graded | void | not graded |
| Claims | Cited losses explained wrong ↓ | void | void | not graded | void | not graded |
| Claims | Cites at nothing real ↓ | void | void | not graded | void | not graded |
| Checker | False claims caught ↑ | void | void | not graded | void | not graded |
| Checker | True claims sent back ↓ | void | void | not graded | void | not graded |
| Cost | Runs (valid of all) | 0/3 | 0/3 | 3/3 | 0/3 | 3/12 |
| Cost | Minutes a run | – | – | 2.7 | – | 2.7 |
| Cost | Calls a run (answered / failed) | – | – | 15.0 / 0.0 | – | 15.0 / 0.0 |
| Cost | Tokens a run (prompt / output) | – | – | 190k / 24k | – | 190k / 24k |

- Void, left out of every row (the API refused or dropped calls, or no result): LoL run 1 (3 calls refused or dropped by the API), LoL run 2 (5 calls refused or dropped by the API), LoL run 3 (5 calls refused or dropped by the API), CR run 1 (11 calls refused or dropped by the API), CR run 2 (3 calls refused or dropped by the API), CR run 3 (3 calls refused or dropped by the API), Chess run 1 (3 calls refused or dropped by the API), Chess run 2 (3 calls refused or dropped by the API), Chess run 3 (3 calls refused or dropped by the API).
- No grades file: the rows a grader fills in are empty.
