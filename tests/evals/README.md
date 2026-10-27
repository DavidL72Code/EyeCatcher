# Eye Catcher evals

Each loop reviews the test recordings in the desktop app, several times each, and every run is scored on one card against the frame-checked coach baselines (`eval/answer-keys/coach/`): the rows and how they are graded are in `eval/SCORECARD.md`. Each loop has its card (`<loop>.scorecard.md`), its full report (`<loop>.md`, with the app's screens, and `.json`), and, where graded, its grades (`<loop>.grades.json`). `ideas-*.md` are the experiments planned before a loop. Screenshots show third-party footage and stay on this machine (`.gitignore`). Compare two loops with `node eval/scorecard.mjs compare <a> <b>`: it counts only the games valid in both.

| Loop | Games (valid runs) | Losses found ↑ | Losses cited ↑ | Cited, explained right ↑ | Invented ↓ | False claims caught ↑ | Calls a run | Prompt tokens a run | Card |
|---|---|---|---|---|---|---|---|---|---|
| loop-37 | LoL 0, RL 1, Rivals 0, Val 0, CR 0, FN 0, BS 0, Chess 0, R6 1 | 3/3 (100%) | 3/3 (100%) | not graded | 0/2 (0%) | not graded | 20.0 | 187k | [card](loop-37.scorecard.md) · [report](loop-37.md) |
| loop-38 | LoL 0, CR 0, BS 3, Chess 0 | 1/9 (11%) | 2/9 (22%) | not graded | – | not graded | 15.0 | 190k | [card](loop-38.scorecard.md) · [report](loop-38.md) |
| loop-39 | LoL 2, RL 2, Rivals 2, Val 2, CR 2, FN 2, BS 2, Chess 2, R6 2 | 45/66 (68%) | 25/66 (38%) | not graded | 7/33 (21%) | not graded | 23.1 | 351k | [card](loop-39.scorecard.md) · [report](loop-39.md) |
| loop-40 | LoL 0, RL 2, Rivals 1, Val 1, CR 2, FN 1, BS 2, Chess 2, R6 2 | 25/46 (54%) | 11/46 (24%) | 7/11 (64%) | 6/15 (40%) | 14/17 (82%) | 16.8 | 211k | [card](loop-40.scorecard.md) · [report](loop-40.md) |
| loop-41 | LoL 2, RL 0, Rivals 0, Val 0, CR 2, FN 1, BS 2, Chess 2, R6 2 | 21/41 (51%) | 15/41 (37%) | 8/15 (53%) | 1/7 (14%) | 13/16 (81%) | 21.4 | 308k | [card](loop-41.scorecard.md) · [report](loop-41.md) |
| loop-44 | LoL 0, Rivals 0, Val 0, FN 0, Chess 0, R6 0 | – | – | not graded | – | not graded | – | – | [card](loop-44.scorecard.md) |
| loop-45 | LoL 1, RL 1, Rivals 1, Val 1, CR 1, FN 1, BS 1, Chess 1, R6 1 | 20/33 (61%) | 17/33 (52%) | 6/17 (35%) | 2/14 (14%) | 17/19 (89%) | 27.7 | 389k | [card](loop-45.scorecard.md) |
| loop-46 | LoL 1, RL 1, Rivals 1, Val 1, CR 1, FN 1, BS 1, Chess 1, R6 1 | 24/33 (73%) | 14/33 (42%) | 5/14 (36%) | 3/14 (21%) | 10/15 (67%) | 24.3 | 383k | [card](loop-46.scorecard.md) |
| loop-47 | LoL 1, RL 0, Rivals 1, Val 1, CR 1, FN 1, BS 1, Chess 1, R6 1 | 20/32 (63%) | 14/32 (44%) | 4/14 (29%) | 1/14 (7%) | 17/22 (77%) | 24.9 | 398k | [card](loop-47.scorecard.md) |
| loop-49 | LoL 1, RL 1, Rivals 1, Val 1, CR 1, FN 1, BS 1, Chess 1, R6 1 | 25/33 (76%) | 21/33 (64%) | 9/21 (43%) | 0/15 (0%) | 13/16 (81%) | 24.6 | 329k | [card](loop-49.scorecard.md) |
| loop-50 | LoL 1, RL 1, Rivals 1, Val 1, CR 1, FN 1, BS 1, Chess 1, R6 1 | 27/33 (82%) | 25/33 (76%) | 7/25 (28%) | 0/13 (0%) | 21/29 (72%) | 26.0 | 405k | [card](loop-50.scorecard.md) |
