# Scorecard: loop-50

Every run held against the coach baselines (`eval/answer-keys/coach`), on the card in `eval/SCORECARD.md`. Cells are counts over the valid runs: n of N. ↑ higher is better, ↓ lower is better.

| Group | Measure | LoL | RL | Rivals | Val | CR | FN | BS | Chess | R6 | All |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Seeing | Player named right ↑ | 0/1 | 0/1 | 1/1 | 1/1 | 0/1 | 0/1 | 1/1 | 1/1 | 0/1 | 4/9 (44%) |
| Seeing | Player named as someone else ↓ | 1/1 | 1/1 | 0/1 | 0/1 | 1/1 | – | 0/1 | 0/1 | – | 3/7 (43%) |
| Seeing | Character named right ↑ | 1/1 | – | 1/1 | 0/1 | – | – | – | – | 0/1 | 2/4 (50%) |
| Seeing | Losses found in the record ↑ | 3/3 | 1/1 | 3/4 | 5/5 | 0/3 | 5/5 | 2/3 | 6/7 | 2/2 | 27/33 (82%) |
| Seeing | Deaths and points invented ↓ | 0/2 | 0/1 | 0/1 | 0/5 | – | 0/1 | 0/2 | – | 0/1 | 0/13 (0%) |
| Seeing | Numbers read right ↑ | – | – | – | – | – | – | – | – | – | – |
| Claims | Losses cited ↑ | 2/3 | 1/1 | 2/4 | 4/5 | 2/3 | 4/5 | 2/3 | 6/7 | 2/2 | 25/33 (76%) |
| Claims | Cited losses explained right ↑ | 1/2 | 0/1 | 0/2 | 1/4 | 0/2 | 1/4 | 0/2 | 3/6 | 1/2 | 7/25 (28%) |
| Claims | Cited losses partly right | 1/2 | 1/1 | 2/2 | 1/4 | 0/2 | 0/4 | 1/2 | 3/6 | 1/2 | 10/25 (40%) |
| Claims | Cited losses explained wrong ↓ | 0/2 | 0/1 | 0/2 | 2/4 | 2/2 | 3/4 | 1/2 | 0/6 | 0/2 | 8/25 (32%) |
| Claims | Cites at nothing real ↓ | 0/2 | 0/1 | 0/1 | 0/5 | 1/3 | 0/4 | 0/3 | 1/9 | 0/2 | 2/30 (7%) |
| Checker | False claims caught ↑ | 3/3 | 2/2 | 4/4 | 2/4 | 2/4 | 5/8 | 2/3 | – | 1/1 | 21/29 (72%) |
| Checker | True claims sent back ↓ | 0/3 | 0/2 | 0/4 | 0/2 | 0/2 | 1/6 | 1/3 | 1/1 | 0/1 | 3/24 (13%) |
| Cost | Runs (valid of all) | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 9/9 |
| Cost | Minutes a run | 7.9 | 9.5 | 5.7 | 20.7 | 9.0 | 9.2 | 7.3 | 7.6 | 8.2 | 9.5 |
| Cost | Calls a run (answered / failed) | 30.0 / 0.0 | 25.0 / 0.0 | 31.0 / 0.0 | 29.0 / 0.0 | 26.0 / 0.0 | 31.0 / 0.0 | 29.0 / 0.0 | 11.0 / 0.0 | 22.0 / 0.0 | 26.0 / 0.0 |
| Cost | Tokens a run (prompt / output) | 456k / 99k | 296k / 48k | 381k / 71k | 708k / 109k | 384k / 67k | 533k / 102k | 450k / 66k | 151k / 25k | 286k / 56k | 405k / 71k |

- Graded by a grading agent, from the loop-50 worksheet and the validated baselines (eval/answer-keys/coach/baseline.validated.json and validated-*.json), calibrated on loops 45-49's grades (45, 46, 47 and 49; there is no loop-48 grade file): each cited loss judged against the key's happened, factors, mistake, better and not_true, with its unsure list not held against a cite; wrong where a cause in a cite at the loss contradicts the key or its not_true, or describes what didn't happen; partly where the decision is missed or an off fact changes the fix; right where the decision is named and off facts leave the lesson standing; a cite led to two losses (Rivals 4:18, led to 4:27) graded at each; a cite at one loss that is another loss's run-up (FN's 7:34 cite, the 7:30 run across the plaza) not held against the later loss, as loop 47 read FN's 7:35 cite; send-backs for a rule (citing the loss itself, a name or a heal nothing read shows, a cause naming none of code's reads, the second-time notice) left out; send-backs that the player was dead at a cited moment graded as claims; a cause that goes against code's reading or the record graded as a claim, the part the check named, taken from that attempt's finish in the run file; a 'video doesn't show' check graded as a claim where the key settles it; a claim at a whole-second time judged at that second as the key reads it; a claim sent twice word for word (as a fix and a turning point) counted once; no numbers per loss, as loops 45-49 have none; not yet checked by a second grader, by eval/SCORECARD.md.
