# Scorecard: loop-45

Every run held against the coach baselines (`eval/answer-keys/coach`), on the card in `eval/SCORECARD.md`. Cells are counts over the valid runs: n of N. ↑ higher is better, ↓ lower is better.

| Group | Measure | LoL | RL | Rivals | Val | CR | FN | BS | Chess | R6 | All |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Seeing | Player named right ↑ | 0/1 | 0/1 | 1/1 | 1/1 | 0/1 | 0/1 | 1/1 | 1/1 | 0/1 | 4/9 (44%) |
| Seeing | Player named as someone else ↓ | 1/1 | 1/1 | 0/1 | 0/1 | – | – | 0/1 | 0/1 | – | 2/6 (33%) |
| Seeing | Character named right ↑ | 1/1 | – | 1/1 | 0/1 | – | – | – | – | 1/1 | 3/4 (75%) |
| Seeing | Losses found in the record ↑ | 3/3 | 1/1 | 0/4 | 5/5 | 1/3 | 1/5 | 1/3 | 6/7 | 2/2 | 20/33 (61%) |
| Seeing | Deaths and points invented ↓ | 0/2 | 0/1 | 1/1 | 0/5 | 0/1 | 0/1 | 1/2 | – | 0/1 | 2/14 (14%) |
| Seeing | Numbers read right ↑ | – | – | – | – | – | – | – | – | – | – |
| Claims | Losses cited ↑ | 3/3 | 1/1 | 0/4 | 4/5 | 0/3 | 1/5 | 1/3 | 6/7 | 1/2 | 17/33 (52%) |
| Claims | Cited losses explained right ↑ | 1/3 | 0/1 | – | 0/4 | – | 1/1 | 0/1 | 3/6 | 1/1 | 6/17 (35%) |
| Claims | Cited losses partly right | 2/3 | 1/1 | – | 2/4 | – | 0/1 | 1/1 | 3/6 | 0/1 | 9/17 (53%) |
| Claims | Cited losses explained wrong ↓ | 0/3 | 0/1 | – | 2/4 | – | 0/1 | 0/1 | 0/6 | 0/1 | 2/17 (12%) |
| Claims | Cites at nothing real ↓ | 0/4 | 0/1 | – | 0/5 | – | 0/1 | 0/1 | 0/8 | 0/1 | 0/21 (0%) |
| Checker | False claims caught ↑ | – | 3/3 | – | 0/2 | 3/3 | 1/1 | 6/6 | 2/2 | 2/2 | 17/19 (89%) |
| Checker | True claims sent back ↓ | – | 0/3 | – | – | 0/3 | 0/1 | 2/8 | 2/4 | 1/3 | 5/22 (23%) |
| Cost | Runs (valid of all) | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 9/9 |
| Cost | Minutes a run | 6.2 | 3.4 | 4.0 | 8.0 | 6.4 | 5.1 | 7.4 | 6.3 | 7.4 | 6.0 |
| Cost | Calls a run (answered / failed) | 29.0 / 0.0 | 28.0 / 0.0 | 33.0 / 0.0 | 29.0 / 0.0 | 30.0 / 0.0 | 24.0 / 0.0 | 32.0 / 0.0 | 16.0 / 0.0 | 28.0 / 0.0 | 27.7 / 0.0 |
| Cost | Tokens a run (prompt / output) | 421k / 83k | 321k / 58k | 301k / 55k | 548k / 87k | 475k / 75k | 277k / 50k | 516k / 73k | 300k / 45k | 337k / 71k | 389k / 66k |

- Graded by a grading agent, from the loop-45 worksheet and the validated baselines (eval/answer-keys/coach/baseline.validated.json and validated-*.json): each cited loss judged against the key's happened, factors, mistake, better and not_true, with its unsure list not held against a cite; wrong where a fact in the cause flips the key's lesson, partly where the decision is missed or an off fact leaves the lesson standing; send-backs for a rule (citing the loss itself, a name or a heal nothing read shows, too few losses, the second-time notice, a cause naming none of code's reads) left out; no numbers per loss, as loop-41 has none; not yet checked by a second grader, by eval/SCORECARD.md.
