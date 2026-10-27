# The scorecard

Every loop is scored on one card, with the same rows in the same order, so any two loops can be compared. Each review run is held against the frame-checked coach baseline of its clip (`eval/answer-keys/coach/`). Cells are counts over the valid runs: *n of N*.

```
node eval/scorecard.mjs worksheet <loop dir> <name>   # what a grader has to judge, as JSON
node eval/scorecard.mjs <loop dir> <name>             # the card: tests/evals/<name>.scorecard.md and .json
node eval/scorecard.mjs compare <a> <b>               # two loops, on the games valid in both
```

## The rows

| Group | Row | n of N | Scored by |
|---|---|---|---|
| Seeing | Player named right ↑ | runs whose player name matches one the key accepts (`ids.player`) | code |
| Seeing | Player named as someone else ↓ | runs that named another person (a teammate, the opponent), of runs that named anyone; a run that names no one counts in neither | code |
| Seeing | Character named right ↑ | runs whose character matches (`ids.character`), in games where one shows | code |
| Seeing | Losses found in the record ↑ | the key's losses the record holds: a death as a death; a near-death or damage as a near-death, damage, or a point lost; a point or structure lost as a point lost; a chess mistake as the same move graded a mistake. Within 5 s | code |
| Seeing | Deaths and points invented ↓ | the record's deaths, and its points or structures lost in games whose key lists that kind of loss, with no such loss in the key within 5 s, of all of those it holds. A key lists every death of the player; it doesn't list a team's turrets or drakes in League, so those aren't counted | code |
| Seeing | Numbers read right ↑ | the distinct numbers the cites at a loss give (health, a share, a cooldown, a score, a count, ammo) that the key or the frames show right, of those the grader could judge | grader |
| Claims | Losses cited ↑ | the key's losses with a cite at them: coverage | code |
| Claims | Cited losses explained right ↑ | of the losses cited: the cite names the decision the key says lost it, with no fact that changes the lesson | grader |
| Claims | Cited losses partly right | of the losses cited: the right moment and some of the right factors, but not that decision, or a fact that changes the fix | grader |
| Claims | Cited losses explained wrong ↓ | of the losses cited: a cause that contradicts the key | grader |
| Claims | Cites at nothing real ↓ | cites at no loss of the key's that are at nothing real either, of all cites. A cite outside the key's losses can be at a real loss the key doesn't list (a soft chess mistake the key's engine grades 100+, a near-death, a team's lost objective): that one isn't counted | grader |
| Checker | False claims caught ↑ | claims the checker sent back that were false, of all the false claims made (those, plus each cited loss explained wrong) | grader |
| Checker | True claims sent back ↓ | claims the checker sent back that were true, of all the claims it sent back that the grader could judge | grader |
| Cost | Runs, minutes, calls, tokens | valid runs of all; then averages over the valid runs | code |

Coverage and accuracy are kept apart. A finding names one habit at a few losses, so *Losses cited* says how much of the match it reached, and right, partly, and wrong say how good what it claimed was. "Cited" means a cite (evidence, a fix, or a turning point, the coach's words and code's alike) lands at the loss: from 3 s before the decision that led to it began, to 4 s after it. A claim shown twice word for word (as a fix and as a turning point) counts once.

**Void runs.** A run the API got in the way of says nothing about the code: 3 or more calls refused or dropped (the model busy, a 503, a 429 over quota), since retries, model fallbacks, and lost minutes then decide what it does; a call that failed and no retry answered; or no result. It's left out of every row and listed under the table with why, and the game is run again.

## Grading the rows code can't

The worksheet (`node eval/scorecard.mjs worksheet <loop dir> <name>`) lists, for each valid run, every cited baseline loss with what the baseline says happened and what decided it, the cites at it, and every claim the checker sent back. The grader writes `tests/evals/<name>.grades.json`:

```json
{
 "loop": "loop-41",
 "by": "who graded it, and how",
 "games": {
  "lol": {
   "1": {
    "losses": { "1:48": { "grade": "right", "why": "names staying in lane after the retreat pings; Flash down", "numbers": { "right": ["3:55 left"], "wrong": ["271 of 1479"], "unclear": [] } } },
    "outside": [ { "t": "5:05", "really": "loss", "why": "a near-death the key doesn't list: HP 291 of 1703 on the HUD" } ],
    "sent_back": [ { "claim": "health 621 of 1479 at 1:45", "really": "true", "why": "baseline: 617-621 of 1479 at 1:43-1:45" } ]
   }
  }
 }
}
```

- **Loss keys** are the baseline loss's `t`, exactly as the key writes it. A cited loss with no grade shows up under the table as not graded.
- **grade:** `right`, `partly`, or `wrong`, by the rules above, against the baseline's `happened`, `factors`, `mistake`, and `not_true`. Only what the finding shows counts, not what a clip read said.
- **numbers:** every distinct number the cites at that loss give (the worksheet's `numbers_given` is code's parse, a starting list: add any it missed, drop any that isn't a reading). `right` when the key or its frames show that value at the moment the cite names (a reading inside a range the key gives counts), `wrong` when they show another, `unclear` when they don't say. A right value given the wrong meaning (a cooldown called the match clock) is wrong.
- **outside:** each cite at no loss of the key's, by its time: `loss` when it's at a real loss the key doesn't list (the key's own notes, its engine grades, or the record show one there), `none` when nothing was lost there, `unclear` when neither can be told.
- **sent_back:** only claims a check found against (the frames, the record, the clips, the engine). A send-back for a rule (not looked closely enough, a name nothing on screen gives, too few losses) isn't a claim and is left out. `really`: `false` when the baseline or frames show the claim wrong, `true` when they show it right, `unclear` when they say neither.
- **why:** one line, citing the baseline's words or a frame time.

A grade is a judgment, so a second grader checks a sample, at least one run per game, and every `wrong`. Where they disagree, the frames decide.
