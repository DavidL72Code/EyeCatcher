# Scorecard: loop-46

Every run held against the coach baselines (`eval/answer-keys/coach`), on the card in `eval/SCORECARD.md`. Cells are counts over the valid runs: n of N. ↑ higher is better, ↓ lower is better.

| Group | Measure | LoL | RL | Rivals | Val | CR | FN | BS | Chess | R6 | All |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Seeing | Player named right ↑ | 1/1 | 0/1 | 1/1 | 0/1 | 0/1 | 0/1 | 1/1 | 1/1 | 0/1 | 4/9 (44%) |
| Seeing | Player named as someone else ↓ | 0/1 | 1/1 | 0/1 | – | – | – | 0/1 | 0/1 | – | 1/5 (20%) |
| Seeing | Character named right ↑ | 1/1 | – | 1/1 | 0/1 | – | – | – | – | 0/1 | 2/4 (50%) |
| Seeing | Losses found in the record ↑ | 2/3 | 1/1 | 3/4 | 5/5 | 0/3 | 5/5 | 0/3 | 6/7 | 2/2 | 24/33 (73%) |
| Seeing | Deaths and points invented ↓ | 3/5 | 0/1 | 0/1 | 0/5 | – | 0/1 | – | – | 0/1 | 3/14 (21%) |
| Seeing | Numbers read right ↑ | – | – | – | – | – | – | – | – | – | – |
| Claims | Losses cited ↑ | 0/3 | 0/1 | 3/4 | 2/5 | 0/3 | 2/5 | 0/3 | 6/7 | 1/2 | 14/33 (42%) |
| Claims | Cited losses explained right ↑ | – | – | 1/3 | 0/2 | – | 0/2 | – | 3/6 | 1/1 | 5/14 (36%) |
| Claims | Cited losses partly right | – | – | 2/3 | 0/2 | – | 0/2 | – | 2/6 | 0/1 | 4/14 (29%) |
| Claims | Cited losses explained wrong ↓ | – | – | 0/3 | 2/2 | – | 2/2 | – | 1/6 | 0/1 | 5/14 (36%) |
| Claims | Cites at nothing real ↓ | 1/1 | – | 0/3 | 0/2 | – | 0/2 | – | 0/8 | 0/2 | 1/18 (6%) |
| Checker | False claims caught ↑ | 3/3 | 2/2 | 2/2 | 1/3 | – | 0/2 | – | 1/2 | 1/1 | 10/15 (67%) |
| Checker | True claims sent back ↓ | 0/3 | 0/2 | 0/2 | 0/1 | – | – | – | 4/5 | 0/1 | 4/14 (29%) |
| Cost | Runs (valid of all) | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 9/9 |
| Cost | Minutes a run | 8.6 | 4.0 | 5.0 | 11.2 | 3.8 | 8.7 | 1.8 | 7.3 | 7.3 | 6.4 |
| Cost | Calls a run (answered / failed) | 29.0 / 1.0 | 33.0 / 1.0 | 27.0 / 0.0 | 30.0 / 0.0 | 21.0 / 0.0 | 26.0 / 0.0 | 15.0 / 0.0 | 16.0 / 1.0 | 22.0 / 1.0 | 24.3 / 0.4 |
| Cost | Tokens a run (prompt / output) | 581k / 94k | 399k / 73k | 361k / 60k | 564k / 81k | 387k / 37k | 415k / 65k | 136k / 18k | 292k / 64k | 307k / 52k | 383k / 60k |

- Graded by a grading agent, from the loop-46 worksheet and the validated baselines (eval/answer-keys/coach/baseline.validated.json and validated-*.json), calibrated on loop 45's grades: each cited loss judged against the key's happened, factors, mistake, better and not_true, with its unsure list not held against a cite; wrong where a fact in the cause flips the key's lesson or describes what didn't happen, partly where the decision is missed or an off fact leaves the lesson standing; send-backs for a rule (citing the loss itself, a name or a heal nothing read shows, too few losses, the second-time notice, a cause naming none of code's reads, the coverage list) left out; send-backs that the player was dead at a cited moment graded as claims, with the claim taken from that attempt's finish in the run file; a claim at a whole-second time judged at that second as the key reads it (as loop 45's '4:29.0 isn't read'); a claim sent twice word for word counted once; no numbers per loss, as loop 45 has none; not yet checked by a second grader, by eval/SCORECARD.md.
