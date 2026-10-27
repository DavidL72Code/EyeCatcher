# Scorecard: loop-47

Every run held against the coach baselines (`eval/answer-keys/coach`), on the card in `eval/SCORECARD.md`. Cells are counts over the valid runs: n of N. ↑ higher is better, ↓ lower is better.

| Group | Measure | LoL | RL | Rivals | Val | CR | FN | BS | Chess | R6 | All |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Seeing | Player named right ↑ | 1/1 | void | 1/1 | 0/1 | 0/1 | 0/1 | 1/1 | 1/1 | 0/1 | 4/8 (50%) |
| Seeing | Player named as someone else ↓ | 0/1 | void | 0/1 | – | – | – | 0/1 | 0/1 | – | 0/4 (0%) |
| Seeing | Character named right ↑ | 1/1 | void | 1/1 | 0/1 | – | – | – | – | 1/1 | 3/4 (75%) |
| Seeing | Losses found in the record ↑ | 2/3 | void | 4/4 | 5/5 | 1/3 | 4/5 | 2/3 | 0/7 | 2/2 | 20/32 (63%) |
| Seeing | Deaths and points invented ↓ | 0/2 | void | 0/1 | 0/5 | 1/2 | 0/1 | 0/2 | – | 0/1 | 1/14 (7%) |
| Seeing | Numbers read right ↑ | – | void | – | – | – | – | – | – | – | – |
| Claims | Losses cited ↑ | 2/3 | void | 4/4 | 3/5 | 2/3 | 2/5 | 1/3 | 0/7 | 0/2 | 14/32 (44%) |
| Claims | Cited losses explained right ↑ | 1/2 | void | 1/4 | 1/3 | 0/2 | 1/2 | 0/1 | – | – | 4/14 (29%) |
| Claims | Cited losses partly right | 1/2 | void | 3/4 | 0/3 | 0/2 | 0/2 | 1/1 | – | – | 5/14 (36%) |
| Claims | Cited losses explained wrong ↓ | 0/2 | void | 0/4 | 2/3 | 2/2 | 1/2 | 0/1 | – | – | 5/14 (36%) |
| Claims | Cites at nothing real ↓ | 0/2 | void | 0/4 | 0/5 | 0/4 | 0/3 | 0/1 | – | – | 0/19 (0%) |
| Checker | False claims caught ↑ | 4/4 | void | – | 4/6 | 0/2 | 4/5 | 4/4 | – | 1/1 | 17/22 (77%) |
| Checker | True claims sent back ↓ | 0/4 | void | – | 0/4 | – | 0/4 | 0/4 | – | 0/1 | 0/17 (0%) |
| Cost | Runs (valid of all) | 1/1 | 0/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 8/9 |
| Cost | Minutes a run | 10.1 | – | 6.2 | 10.8 | 8.3 | 11.5 | 4.8 | 3.6 | 6.7 | 7.8 |
| Cost | Calls a run (answered / failed) | 30.0 / 1.0 | – | 25.0 / 1.0 | 29.0 / 1.0 | 25.0 / 1.0 | 29.0 / 1.0 | 26.0 / 1.0 | 9.0 / 1.0 | 26.0 / 1.0 | 24.9 / 1.0 |
| Cost | Tokens a run (prompt / output) | 527k / 96k | – | 350k / 48k | 500k / 84k | 446k / 70k | 498k / 94k | 381k / 69k | 165k / 6k | 314k / 53k | 398k / 65k |

- Void, left out of every row (the API refused or dropped calls, or no result): RL run 1 (6 calls refused or dropped by the API).
- Graded by a grading agent, from the loop-47 worksheet and the validated baselines (eval/answer-keys/coach/baseline.validated.json and validated-*.json), calibrated on loops 45 and 46's grades (and loop 40's for val 4:57, which neither of them cites): each cited loss judged against the key's happened, factors, mistake, better and not_true, with its unsure list not held against a cite; wrong where a cause in a cite at the loss contradicts the key or its not_true, or describes what didn't happen; partly where the decision is missed or an off fact changes the fix; right where the decision is named and off facts leave the lesson standing; send-backs for a rule (citing the loss itself, a name or a heal nothing read shows, too few losses, the second-time notice) left out; send-backs that the player was dead at a cited moment graded as claims, with the claim taken from that attempt's finish in the run file; a cause that goes against code's reading graded as a claim taken from that attempt's finish, as loop 46's r6 8:39; a claim at a whole-second time judged at that second as the key reads it (as loop 45's '4:29.0 isn't read'); a claim found by both the record and the frames check counted once; no numbers per loss, as loops 45 and 46 have none; not yet checked by a second grader, by eval/SCORECARD.md.
