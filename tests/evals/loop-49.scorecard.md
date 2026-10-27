# Scorecard: loop-49

Every run held against the coach baselines (`eval/answer-keys/coach`), on the card in `eval/SCORECARD.md`. Cells are counts over the valid runs: n of N. ↑ higher is better, ↓ lower is better.

| Group | Measure | LoL | RL | Rivals | Val | CR | FN | BS | Chess | R6 | All |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Seeing | Player named right ↑ | 0/1 | 0/1 | 1/1 | 0/1 | 0/1 | 0/1 | 1/1 | 1/1 | 0/1 | 3/9 (33%) |
| Seeing | Player named as someone else ↓ | 1/1 | 1/1 | 0/1 | – | – | – | 0/1 | 0/1 | – | 2/5 (40%) |
| Seeing | Character named right ↑ | 1/1 | – | 1/1 | 0/1 | – | – | – | – | 1/1 | 3/4 (75%) |
| Seeing | Losses found in the record ↑ | 2/3 | 1/1 | 3/4 | 5/5 | 2/3 | 1/5 | 3/3 | 6/7 | 2/2 | 25/33 (76%) |
| Seeing | Deaths and points invented ↓ | 0/2 | 0/1 | 0/1 | 0/5 | 0/2 | 0/1 | 0/2 | – | 0/1 | 0/15 (0%) |
| Seeing | Numbers read right ↑ | – | – | – | – | – | – | – | – | – | – |
| Claims | Losses cited ↑ | 2/3 | 0/1 | 2/4 | 5/5 | 1/3 | 1/5 | 3/3 | 6/7 | 1/2 | 21/33 (64%) |
| Claims | Cited losses explained right ↑ | 1/2 | – | 0/2 | 2/5 | 0/1 | 1/1 | 0/3 | 4/6 | 1/1 | 9/21 (43%) |
| Claims | Cited losses partly right | 1/2 | – | 2/2 | 1/5 | 0/1 | 0/1 | 3/3 | 2/6 | 0/1 | 9/21 (43%) |
| Claims | Cited losses explained wrong ↓ | 0/2 | – | 0/2 | 2/5 | 1/1 | 0/1 | 0/3 | 0/6 | 0/1 | 3/21 (14%) |
| Claims | Cites at nothing real ↓ | 0/5 | – | 0/1 | 0/5 | 0/1 | 0/1 | 0/3 | 0/8 | 0/1 | 0/25 (0%) |
| Checker | False claims caught ↑ | 3/3 | 2/2 | – | 0/2 | 2/3 | – | 3/3 | – | 3/3 | 13/16 (81%) |
| Checker | True claims sent back ↓ | 1/4 | 0/2 | – | – | 1/3 | – | 0/3 | – | 1/4 | 3/16 (19%) |
| Cost | Runs (valid of all) | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 9/9 |
| Cost | Minutes a run | 15.1 | 7.1 | 10.6 | 16.4 | 9.3 | 10.6 | 10.5 | 11.4 | 13.2 | 11.6 |
| Cost | Calls a run (answered / failed) | 26.0 / 1.0 | 28.0 / 0.0 | 31.0 / 0.0 | 20.0 / 0.0 | 27.0 / 0.0 | 22.0 / 0.0 | 28.0 / 1.0 | 10.0 / 0.0 | 29.0 / 1.0 | 24.6 / 0.3 |
| Cost | Tokens a run (prompt / output) | 470k / 81k | 267k / 58k | 289k / 46k | 397k / 44k | 365k / 62k | 218k / 33k | 413k / 55k | 161k / 19k | 379k / 75k | 329k / 53k |

- Graded by a grading agent, from the loop-49 worksheet and the validated baselines (eval/answer-keys/coach/baseline.validated.json and validated-*.json), calibrated on loops 45, 46 and 47's grades (and loop 40's for val 2:17, 4:15 and 4:57): each cited loss judged against the key's happened, factors, mistake, better and not_true, with its unsure list not held against a cite; wrong where a cause in a cite at the loss contradicts the key or its not_true, or describes what didn't happen; partly where the decision is missed or an off fact changes the fix; right where the decision is named and off facts leave the lesson standing; one cite at two losses (Rivals 4:16, led to 4:28) graded at each; send-backs for a rule (citing the loss itself, a name nothing read shows, too few losses looked at, not looked closely, the coverage list, the habit_id format, a cause naming none of code's reads, the second-time notice) left out; send-backs that the player was dead at a cited moment graded as claims, with the claim taken from that attempt's finish in the run file; a cause that goes against code's reading or the record graded as a claim, the part the check named; a 'video doesn't show' check graded as a claim where the key settles it; a claim at a whole-second time judged at that second as the key reads it (as loop 45's '4:29.0 isn't read'); a claim found by both the record and the frames check, or sent twice word for word, counted once; mixed evidence judged unclear, as loop 47's bs 2:57; no numbers per loss, as loops 45-47 have none; not yet checked by a second grader, by eval/SCORECARD.md.
