# Eval: loop-41

Generated 2026-10-25 15:38 from `41` by `eval/loop-report.mjs`. Each game was reviewed 2 times by the desktop app in a harness (`consistency.mjs`); run 1 learns the game afresh, later runs reuse what it learned. Graded against the frame-checked coach baselines in `eval/answer-keys/coach/`.

**How to read it.** *Losses cited*: of the baseline's losses (deaths, lost points, blunders, tower losses), how many the finding cites, at the loss or at the decision that led to it. *Factor coverage*: of the kinds of factor the baseline says decided each cited loss (position, information, resources, numbers, map, mechanics), the share the cited cause names, by its words (rough; not graded for chess). *Numbers named*: of the cited losses, how many have a cause that names a number matching one in the baseline's factors (health like 42% or 631/1479, a cooldown like 3:55 left, a score like 2-0, a count like 1 v 2), so depth shows, not only kinds. Cites, kinds, and numbers are the coach's own words; *By code* counts apart the losses only a turning point code filled in cites (cover_losses), and the losses where numbers code wrote match (factor_refs or a filled turning point). *Deaths found*: the record's deaths against the baseline's. *Matches the baseline*: every loss cited with at least 60% coverage (yes), at least half cited (partly), else no.

## Summary

| Game | Runs | Min/run | Calls answered / failed | Model share (answered) | Prompt / output tokens | Deaths found | Losses cited | Factor coverage | Matches the baseline | Numbers named | By code (cited, numbers) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| League of Legends | 2 | 6.9 | 31.5 / 1.5 | 3.5-flash-lite 52%, 3.1-flash-lite 48% | 514k / 66k | 2/2, 1/2 | 3/3, 2/3 | 47%, 90% | partly | 1/3, 0/2 | +0, 0; +0, 0 |
| Rocket League | 2 | 7.5 | 5.5 / 23.0 | 3.5-flash-lite 100% | 62k / 9k | –, – | 0/1, 0/1 | –, – | no | 0/0, 0/0 | +0, 0; +0, 0 |
| Marvel Rivals | 2 | 6.3 | 1.5 / 24.5 | 3.5-flash-lite 67%, 3.1-flash-lite 33% | 6k / 2k | 0/1, 0/1 | 0/4, 0/4 | –, – | no | 0/0, 0/0 | +0, 0; +0, 0 |
| Valorant | 2 | 22.0 | 10.5 / 60.0 | 3.1-flash-lite 81%, 3.5-flash-lite 19% | 149k / 16k | 0/5, 0/5 | 0/5, 0/5 | –, – | no | 0/0, 0/0 | +0, 0; +0, 0 |
| Clash Royale | 2 | 4.5 | 20.5 / 1.5 | 3.5-flash-lite 100% | 315k / 43k | 0/1, 0/1 | 0/3, 0/3 | –, – | no | 0/0, 0/0 | +0, 0; +0, 0 |
| Fortnite | 2 | 13.3 | 18.5 / 8.5 | 3.5-flash-lite 59%, 3.1-flash-lite 41% | 204k / 27k | 1/1, 1/1 | 1/5, 1/5 | 67%, 33% | no | 1/1, 1/1 | +0, 0; +0, 0 |
| Brawl Stars | 2 | 4.5 | 20.0 / 1.0 | 3.5-flash-lite 100% | 304k / 43k | 0/2 +1 invented, 0/2 | 0/3, 0/3 | –, – | no | 0/0, 0/0 | +0, 0; +0, 0 |
| Chess | 2 | 4.0 | 13.5 / 1.0 | 3.5-flash-lite 85%, 2.5-flash-lite 15% | 174k / 36k | –, – | 3/7, 3/7 | n/a, n/a | no | 0/3, 0/3 | +0, 0; +0, 0 |
| Rainbow Six Siege | 2 | 5.3 | 22.0 / 1.0 | 3.5-flash-lite 100% | 275k / 48k | 1/1, 1/1 | 1/2, 2/2 | 33%, 33% | partly | 1/1, 1/2 | +0, 0; +0, 1 |

Across 18 runs: 8.2 min, 15.9 calls answered and 13.6 failed (429/503, retried), 223k prompt and 32k output tokens a run, on average.

## What this loop changed (against loop 40)

Code frozen as `snaps/s41`. Nine clips, two runs each.

- **Every experiment on.** Loop 40's four (`near_loss`, `state_facts`, `spectate_deaths`, `far_downs_low`), plus `objectives`, `cover_losses` (with `chess_seen`), `factor_refs`, `long_runup`, `hud_zoom`, `game_profile`, `par_counters` and `hp_bar`.
- **Unflagged fixes:**
  - The scan counts kills and deaths only of players' characters, not minions.
  - A scoreboard isn't renamed to the K/D/A unless the check's K/D/A answer names it.
  - With deaths unchecked, the fights are read before "nothing lost".
  - The player's own scored goal sets their side over a learned side.
- **Quota.** Both keys' 3.5 Flash-Lite ran out mid-loop, and 3.1 answered 503 "high demand". League run 2 ran on 3.1 for 30 of its 31 answered calls. Fortnite run 2 had 16 failed calls (12 of them 503) and ran mostly on 3.1. Both are graded, but read them with that in mind.

## Evaluation (graded by meaning)

Graded as in loop 40. A cite is a moment at a loss, or leading to it, within its decided span to 4 s after. **Right** means it names the decision the baseline says lost it, with no fact that changes the lesson. **Partly** means the right moment with some right factors. **Wrong** means the cause contradicts the baseline.

- **The six valid games:** 11 losses cited with a right cause, against 8 for the same six in loop 40. The keyword grader counts 16, against 11. Of the other 5 cites in loop 41, 2 are partly right and 3 are wrong.
- **Fewer runs in loop 40:** loop 40 had one Fortnite run, so it covered 41 loss-runs on these games against 46 here. Per run, chess accounts for most of the gain.

### Rocket League, Marvel Rivals, Valorant: invalid, not graded

Quota spoiled these runs. The failed calls come from each run's timeline.

| Game | Run 1: answered / failed | Run 2: answered / failed |
|---|---|---|
| Rocket League | 11 / 14 (12 × 503, 2 × 429) | 0 / 32 (23 × 503, 7 × 429, 1 × 403, 1 aborted) |
| Marvel Rivals | 0 / 8 (6 × 503, 2 × 429) | 3 / 41 (31 × 503, 10 × 429) |
| Valorant | 6 / 54 (42 × 503, 10 × 429, 2 aborted) | 15 / 66 (48 × 503, 17 × 429, 1 aborted); the harness also left `run-2-timeout.txt` |

The side fix for Rocket League ("own scored goal sets their side") can't be judged from this loop.

### League of Legends: partly

Run 1 (the better run):

| Baseline loss | Cited? | Right | Wrong | Missed |
|---|---|---|---|---|
| 1:48 death | yes, 1:45 → 1:48 (right) | "clear minions instead of retreating upon retreat pings". "ultimate was on cooldown". | "Health was low at 271 of 1479": that is mid-burst. The frames check read "621 of 1479 at 1:45" (baseline: 617-621), and the record check put 271 back. "channel an ability": the ult was down. | Flash down. The read has it, but as "Scoreboard clock 3:49": that is Flash's timer (baseline: 3:55 at 1:40). The Nearsight cue. |
| 4:30 near-death (280 of 1589) | yes, 4:26 → 4:30 (partly) | "Advancing ... while enemies were grouping": inside the enemy's reach. | "to farm minions": she had just walked in from base and cast her ult. The read's "R on 1:46 cooldown" shows the cast. "scoreboard clock read 1:05" is Flash's timer (baseline: 1:05 at 4:30). | The ult channel. No Flash. She pinged retreat, then walked in. |
| 8:56 death | yes, 8:46 → 8:56 (wrong) | "missing enemy pings were active". | "without ultimate ready and with low health". Baseline: 1723 of 1820, with Flash and ult up, at 8:44. "Player health was 392 of 693": 693 is her mana. The frames check said 1730 of 1820, and the record check reverted it. "two allies were present": only Blitzcrank was there. | Stopping to channel the ult after Flashing out of the stun. Two teammates dead. |

- **Cite at no real loss:** 5:05 ("Player health read 401 of 609": 609 is mana). The record's near-death there, 291 of 1703, is in loop 39's record too. At 17% health it is as low as the 4:30 baseline loss, so it may be a gap in the baseline.
- **Run 2 (3.1 Flash-Lite):** both its cites are wrong.
  - 1:48: "engaged an enemy champion in the bottom lane". Baseline not-true: "bot lane at 1:48". Plus a code-filled point, "committed to using Bullet Time in the open river"; the frames check had rejected that twice.
  - 4:30: a code fill, "chose to recall while a teammate was being engaged". She was walking out from base.
  - Its record lost the 8:56 death: the second look said "no death of theirs here after all".
- **Record, run 1:** deaths at 1:48 and 8:56 are right. No 5:46 death this time; a second look ruled it out. The 4:30 near-death was found. Kills are 0 in both runs, where loop 40 run 2 had 22 minion "kills".
- **Identity:** the player was learned as xHACKLETx, which is right.
- **Against loop 40: worse** (1 right against 2). The record check overwrote the frames check's right numbers with the reads' wrong ones (mana as health). Run 2's code fills were all wrong.

### Clash Royale: no

Both runs:

| Baseline loss | Cited? | Right | Wrong | Missed |
|---|---|---|---|---|
| 1:33 tower damage (3197 → 761) | no | – | – | Not in the record. Run 2's read has it: "Princess tower health dropped from 1979 to 761", "Hold elixir instead of dropping an immediate counter". |
| 2:36 tower damage (761 → 384) | no | – | – | Not in the record. |
| 3:27 tower destroyed, lost 0-1 | no | – | – | Still recorded as "Enemy princess tower destroyed", a point won. The reads saw the drop ("134", "71") but called the tower destroyed at 3:12. The baseline has it standing at 7 until 3:27.3. |

- **Run 1:** cites only 0:20 (no loss), and its "why" calls it a win: "the final tower-destroying Fireball, enabled the player to secure victory".
- **Run 2:** names nothing ("Code found nothing lost"), after reading 9 fights at full detail.
- **Against loop 40: same** (0 of 3). The fights are now read before "nothing lost", but no tower loss reaches the record. `objectives` had no structures to read.

### Fortnite: no

Run 1:

| Baseline loss | Cited? | Right | Wrong | Missed |
|---|---|---|---|---|
| 2:43, 6:09, 6:59 falls | no | – | – | Not in the record. |
| 7:30 shield 98 → 24, fled | no | – | – | Not in the record. The 30 s run-up now shows the chest and the first hit, but no loss came of it. |
| 7:43 death | yes, 7:36 → 7:44 (right) | "behind a low hedge ... low health (45 HP)". "initiated an engagement with the Arc-Lightning Gun". "taking solid building cover". | "instead of healing" and the fix "Heal to full health": they had no heals (baseline not-true). "the 1v1 fight" and "the final opponent": 4 players were left, and they placed #4. | No build with 500 wood and 500 stone. His own lightning broke the hedge. 24 shield. |

- **Run 2:** cites 7:43 with the same core: "standing still behind a hedge ... low on health (24/45)". Its read swaps the numbers ("24 health and 45 shield"), and its fix says to heal too.
- **Record:** right. 4 kills (loop 40 had 5, one counted twice) and the death at 7:44.
- **Against loop 40: same** per run (1 of 5). Four of the five losses are still not in the record.

### Brawl Stars: no

Both runs:

| Baseline loss | Cited? | Right | Wrong | Missed |
|---|---|---|---|---|
| 0:38 near-death | no | – | – | Not in the record. |
| 1:10 death | no | – | – | Not in the record. Run 2's read saw it: screen text "NPC Abuser PANDA YT" at 1:10. |
| 2:58 death | no | – | – | Not in the record. Run 2's read saw it: "goes down", "13805 before taking burst damage" (baseline: 13805-13895). Run 1's read saw "Following: Mr.ZemoO" at 2:59, but the frames check said he "is seen surviving ... past 2:58.0", and the coach dropped it. |

- **Cite at no real loss:** run 1's only cite is 1:33 ("Health dropped to 73 of 9600"). That is another brawler's health: his max is 14300.
- **Record: wrong.** Learn found no player name; loop 40 had "PANDA YT™". So the reads follow a different brawler in each window (Sandy, Edgar, Mr. P, Fang, Shelly, Emz, Cordelius, Melodie, Leon).
  - Run 1 invented a death at 1:33 and 7 kills; the end screen shows 0 kills.
  - Run 2 has no deaths, and its "why" says "Code found nothing lost".
- **Against loop 40: same** (0 of 3). The failure is different: identity, where it was the dropped health box.

### Chess: no

Run 1:

| Baseline loss | Cited? | Right | Wrong | Missed |
|---|---|---|---|---|
| 0:16 2.f4 | yes (right) | "ignoring that dxe4 wins material". The fix is "exd5 or Nc3". | – | – |
| 5:05 15.Bc3 | no | – | – | – |
| 5:14 16.Qd3 | yes (right) | "Black's bishop ready to play Bc4 ... on the queen". The fix is "d5". | "losing the queen": the engine's gain is a pawn and an attack (+3.9). Baseline not-true: "16...Bc4 would simply win the e2 knight". "the knight on e2 undefended". | – |
| 5:41 18.Nf4 | no | – | – | The costliest move (571). Not cited, and `cover_losses` never asked for it. |
| 6:28 22.Rxf4 | yes (right) | "allowing Bxa6", "the bishop on a6 is undefended". The fix is "Bxc4". | – | Bxc4 Nxc4 Rxf4 wins a piece. |
| 7:52 26.Rf1 | no | – | – | – |

- **Run 2:** right at 2.f4 ("allowing dxe4"), 18.Nf4 ("Bxf4+ with check, losing the knight") and 22.Rxf4 ("allowing Bxa6"). Its fix for 2.f4, "Play d4 or e4", is wrong: e4 is already played, and the engine's move is exd5.
- **Soft cites:** both runs also cite moves the baseline calls soft mistakes (6.Ne2, 7.fxe5, 10.Qb5+, 11.Qe5+, 12.Bd2).
- **The engine's refutation:** every cited baseline move names it (dxe4, Bc4, Bxf4+, Bxa6).
- **Record:** the move list and grades are right. White's clock reads at moves 16-22 (9:43, 9:51, 9:05) are still wrong.
- **Against loop 40: better** (6 right against 3).

### Rainbow Six Siege: partly

Run 2:

| Baseline loss | Cited? | Right | Wrong | Missed |
|---|---|---|---|---|
| 8:38.9 near-death (19 of 100) | yes, 8:39 (partly) | "the doorway between Covered Terrace and Mezzanine ... exposed". "1:35 on the clock". Match point. | "ammo counter at 10/89", written in by `factor_refs`: the rifle was 0/89 and the pistol 21 → 15. | The empty rifle, not reloaded behind the counter. He had seen the enemy in that doorway 3-4 s earlier. |
| 8:58.3 death | yes, 8:59 (right) | "pushed into an enemy room at critically low health (19/100) in a 2 vs 3 situation". "12/64" (baseline: 25 → 12 by 8:58.2). | – | The rifle lowered on entry. TAVUKSEVEN had the defuser. |

- **Run 1:** cites only 8:59, at the loss: "Challenging an enemy in a direct gunfight while at 19 of 100 health, with 25 rounds", 3-0, 1:17. That is right, but thin.
- **Run 1's 8:39 cite was dropped.** The record check sent back "Being down to 19 HP at 8:39" against "100 of 100 at 8:36.0".
- **Record:** right (19 of 100 at 8:39; killed by francomix at 8:59, traded).
- **Identity:** learn named TAVUKSEVEN, a teammate, as the player. The record wasn't affected.
- **Against loop 40: same count (2), better causes.** The count at 8:58 is now right (2 vs 3; loop 40 said 3 v 3), and 8:38 is partly right instead of wrong.

## The experiments, as far as the runs show

- **`cover_losses`: hurt in League, helped a little in chess, didn't fire in Siege. The report can't see it.**
  - In League run 2, three code-filled turning points ("From the clip read: ...", at 1:44, 4:21 and 9:17) are all wrong. The 1:44 one restores "committed to using Bullet Time", which the frames check had rejected twice. At 9:17 she was dead (the frames check: "already dead").
  - In chess run 2, it asked once ("not cited yet, 0:15 f4 ..., 5:04 Bc3 ..., 5:13 Qd3"). The coach added 2.f4 correctly. No engine fill followed for 15.Bc3 or 16.Qd3.
  - It neither asked nor filled in chess run 1, which had no send-backs, so 18.Nf4 and 15.Bc3 stayed uncited.
  - It didn't run in Siege run 1, which was sent back twice, so 8:39 stayed uncited. The cover pass runs only when a finish has no other problems.
  - The final result drops the `filled` marker, so the report's "By code" column reads +0 and counts the fills as the coach's own words.
- **`objectives`: didn't fire.** There are no structure events in any run. Clash Royale's learned layout has no structures (its regions are health, opponent_clock and gold).
- **`hp_bar`: didn't fire.**
  - Fortnite: "no health bar read in code: the HP number read full at 0 of its crops" (run 1), and "its box isn't a bar filled from one end" (run 2).
  - Brawl Stars says the same as Fortnite run 2.
  - Clash Royale read a bar every 0.5 s, but produced no damage events.
  - There are no `damage` events anywhere.
- **`factor_refs`: helped in Siege, hurt in League.**
  - Siege run 2: code wrote in "2 vs 3" and "12/64", both right, and "10/89", which is wrong.
  - League run 2: the coach wrote "[W1.position], [W1.information], [W1.numbers]" into the text, and the because shows the raw tags with no numbers.
- **`hud_zoom`: can't credit it; it may have hurt.**
  - League's clip reads took mana for health twice ("401 of 609", "392 of 693"), which loop 40's reads didn't do.
  - They also took Flash's timer for the scoreboard clock ("3:49" at 1:46, "1:05" at 4:28).
  - The exact numbers in League ("621 of 1479", "R ... 1:48" at 4:26, "1730 of 1820") came from the frames check, not the zoomed sheets.
- **`long_runup`: reads go deeper, but nothing was cited from it.** Fortnite's reads now start at 7:14 and show the chest and the 7:31 hit. Clash Royale run 2's 1:28 read describes the Royal Giant's attack (1979 to 761). Neither became a loss in the record.
- **`game_profile`, `par_counters`, `chess_seen`:** no visible effect. Each game has one recording, so no other layout could be reused. Timings are mixed up with the quota retries.
- **The unflagged fixes:**
  - Minions: worked. League has 0 kills, against 22 in loop 40 run 2.
  - "Fights read before nothing lost": fired. Clash Royale and Brawl Stars run 2 read 8-9 fights, but what the reads saw (tower drops, both Brawl Stars deaths) never reached the record, so both still end "nothing lost".

## What to fix next

Ranked by how many baseline losses each one would reach.

1. **Get losses that aren't deaths into the record (7 losses).** These are Clash Royale's three tower drops and Fortnite's three falls and its 7:30 shield loss. `objectives` and `hp_bar` were on but found nothing to read: no structures were learned, and no box passed as a bar. The reads already see these drops ("1979 to 761", "134", the 7:31 hit), so a structure or health drop a read reports could become a loss.
2. **Stop the record check overruling the frames (5 losses).** In League run 1, the frames check corrected three numbers to the baseline's own. The record check put the reads' wrong numbers back, two of them mana, and the final kept them (1:48, 4:30, 8:56).
   - The same check dropped Siege's 8:39 (19 HP, against a reading from 8:36).
   - In Brawl Stars, the frames check itself called the real 2:58 death "surviving".
3. **Fix `cover_losses` (4 losses).**
   - Chess run 1 had no send-backs and still got no ask or fill for 18.Nf4 and 15.Bc3.
   - Run the cover pass after send-backs too: Siege run 1's 8:38 stayed uncited.
   - Add the promised engine fills for chess 15.Bc3, 16.Qd3 and 26.Rf1.
   - Never fill in a claim the checks rejected.
   - Keep `filled` in the final, so the report can count fills apart.
4. **Brawl Stars identity (3 losses).** Learn found no name, so each read follows another brawler. Use the kill popup's "→ PANDA YT" and the "Following:" text as deaths. Run 2's reads had both.
5. **League HUD labels (3 losses).** Mana was read as health, and Flash's timer as the scoreboard clock. With the label right, Flash would be named at 1:48 and 4:30, the factor loop 40 also missed.
6. **Rerun Rocket League, Marvel Rivals and Valorant once quota is back.** This loop says nothing about them.

## League of Legends

### Run 1 (learned the game afresh): one-off, "Overextending without vision or escape tools"

8.1 min · 32 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low, objectives, cover_losses, factor_refs, long_runup, hud_zoom, game_profile, par_counters, hp_bar · 475k prompt tokens (text 124k, images 130k, video 221k), 82k output · finish sent back 2 times · player learned as "xHACKLETx", playing Miss Fortune · record: 0 kills, 2 deaths

> You consistently pushed lanes and contested areas while low on health and with key abilities on cooldown, leaving you vulnerable to enemy ambushes.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 1:48 death | Staying at the front of the mid wave after four 'enemies missing' and three 'enemy has vision here' pings, with Flash and ult down and 42% health. | yes | Committing to channel an ability and clear minions instead of retreating upon retreat pings. Because: Health was low at 271 of 1479, ultimate was on cooldown, 2 teammates faced 2 visible enemies in the immediate fight, and scoreboard clock read 3:49 with match score 13 to 16. / Committing to channel an ability and clea | information, resources, map, mechanics (2 of 5: position, information, resources, numbers, cue_missed) | none | – |
| 4:30 near_death (280 of 1589) | Channeling her ult, which roots her in place, from inside the enemy's reach with no Flash. | yes | Advancing into lane to farm minions while enemies were grouping. Because: Health was dropping, scoreboard clock read 1:05, team score was 15 to 20, 2 teammates were against multiple incoming enemies, and enemies were advancing. / Advancing into lane to farm minions while enemies were grouping. Because: Health was dropp | resources, map (2 of 4: position, resources, map, information) | none | – |
| 8:56 death | After Flashing out of CalvinCoach's stun, stopping in the river to channel her ult (which holds her in place) while two teammates were dead and the jungler was missing; Fizz's missing ping came two seconds later and the jungler's Nearsight a second after that. | yes | Contesting the river area without ultimate ready and with low health. Because: Player health was 392 of 693, ultimate was on a 1:37 cooldown, two allies were present against multiple enemies, score was 21 to 27, and missing enemy pings were active. / Contesting the river area without ultimate ready and with low health. | information, resources, map (2 of 4: numbers, information, resources, objective) | two allies | – |

Cited at no real loss: 5:05 Stepping forward into the lane and path without ultimate or escape utility ready while enemies were missing.; 5:05 Stepping forward into the lane and path without ultimate or escape utility ready while enemies were missing.

### Run 2: one-off, "Overextending or taking unnecessary risks by pushing or engaging without vision or teammate support."

5.7 min · 31 calls answered (3.1-flash-lite 97%, 3.5-flash-lite 3%), 2 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low, objectives, cover_losses, factor_refs, long_runup, hud_zoom, game_profile, par_counters, hp_bar · 554k prompt tokens (text 178k, images 107k, video 269k), 50k output · finish sent back 5 times · player learned as "xHACKLETx", playing Miss Fortune · record: 0 kills, 1 deaths

> The player consistently overextended into dangerous, unwarded areas without teammate support, which led to multiple deaths and lost objectives. This habit of taking unnecessary risks when the team was at a disadvantage or lacked information directly cost the team control of the map and key objectives.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 1:48 death | Staying at the front of the mid wave after four 'enemies missing' and three 'enemy has vision here' pings, with Flash and ult down and 42% health. | yes | The player engaged an enemy champion in the bottom lane. Because: The player engaged an enemy in the bottom lane while exposed and without sufficient teammate support, leading to a disadvantageous fight. [W1.position], [W1.information], [W1.numbers] / From the clip read: The player committed to using Bullet Time in the | numbers, position, information, resources, map, mechanics (4 of 5: position, information, resources, numbers, cue_missed) | none | – |
| 4:30 near_death (280 of 1589) | Channeling her ult, which roots her in place, from inside the enemy's reach with no Flash. | yes | From the clip read: The player chose to recall while a teammate was being engaged Because: it left them without The player lost the opportunity to assist the teammate, resulting in the teammate's death; position The player was in the bottom lane near their turret, but moved away from the fight toward the fountain; info | position, information, resources, numbers, map (4 of 4: position, resources, map, information) | none | – |
| 8:56 death | After Flashing out of CalvinCoach's stun, stopping in the river to channel her ult (which holds her in place) while two teammates were dead and the jungler was missing; Fizz's missing ping came two seconds later and the jungler's Nearsight a second after that. | no | – | – | – | – |

Cited at no real loss: 9:29 The player chose to push the mid lane wave alone after the enemy team secured the dragon.; 9:17 From the clip read: The player entered the river area while the enemy team was contesting the dragon

Run 1 in the app, as it went (images kept on this machine only):

![League of Legends: live-01](loop-41/lol/live-01.png)
![League of Legends: live-02](loop-41/lol/live-02.png)
![League of Legends: live-03](loop-41/lol/live-03.png)
![League of Legends: live-04](loop-41/lol/live-04.png)
![League of Legends: live-05](loop-41/lol/live-05.png)
![League of Legends: live-06](loop-41/lol/live-06.png)
![League of Legends: after-top](loop-41/lol/after-top.png)

## Rocket League

### Run 1 (learned the game afresh): nothing named

6.7 min · 11 calls answered (3.5-flash-lite 100%), 14 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low, objectives, cover_losses, factor_refs, long_runup, hud_zoom, game_profile, par_counters, hp_bar · 124k prompt tokens (text 13k, images 38k, video 73k), 17k output · finish sent back 0 times · player learned as unknown · record: 0 kills, 0 deaths

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 4:15 point_lost (NYAL scores; 2-1, 1:09 left) | A tight-angle shot from the corner while his teammate was also forward, which left the net empty when it was cleared. | no | – | – | – | – |

### Run 2: nothing named

8.3 min · 0 calls answered (–), 32 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low, objectives, cover_losses, factor_refs, long_runup, hud_zoom, game_profile, par_counters, hp_bar · 0k prompt tokens (text 0k, images 0k, video 0k), 0k output · finish sent back 0 times · player learned as unknown · record: 0 kills, 0 deaths

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 4:15 point_lost (NYAL scores; 2-1, 1:09 left) | A tight-angle shot from the corner while his teammate was also forward, which left the net empty when it was cleared. | no | – | – | – | – |

Run 1 in the app, as it went (images kept on this machine only):

![Rocket League: live-01](loop-41/rl/live-01.png)
![Rocket League: live-02](loop-41/rl/live-02.png)
![Rocket League: live-03](loop-41/rl/live-03.png)
![Rocket League: after-top](loop-41/rl/after-top.png)

## Marvel Rivals

### Run 1 (learned the game afresh): nothing named

2.6 min · 0 calls answered (–), 8 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low, objectives, cover_losses, factor_refs, long_runup, hud_zoom, game_profile, par_counters, hp_bar · 0k prompt tokens (text 0k, images 0k, video 0k), 0k output · finish sent back 0 times · player learned as unknown · record: 0 kills, 0 deaths

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 1:19 near_death (16 of 250 at 1:16.5; 50 at 1:18.5-1:19) | Staying in after her bonus health broke and VEN was revived, until she was at 16; with abilities ready she left only after a health pack saved her. | no | – | – | – | – |
| 4:18 near_death (54 of 253 at 4:18, then 70 at 4:18.5) | Trading head-on through her ult as her health fell from 250 to 54 in 3 s, with two abilities ready to step out and come back. | no | – | – | – | – |
| 4:27 death (killed by VEN) | Staying forward at half health after her ult ran out, into four enemies, with her teammates behind her. | no | – | – | – | – |
| 5:10 near_death (30 of 250) | Taking the portal dive in at 235 and trading down to 30 before stepping back, with an ability still ready. | no | – | – | – | – |

### Run 2: nothing named

10 min · 3 calls answered (3.5-flash-lite 67%, 3.1-flash-lite 33%), 41 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low, objectives, cover_losses, factor_refs, long_runup, hud_zoom, game_profile, par_counters, hp_bar · 12k prompt tokens (text 1k, images 11k, video 0k), 4k output · finish sent back 0 times · player learned as unknown · record: 0 kills, 0 deaths

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 1:19 near_death (16 of 250 at 1:16.5; 50 at 1:18.5-1:19) | Staying in after her bonus health broke and VEN was revived, until she was at 16; with abilities ready she left only after a health pack saved her. | no | – | – | – | – |
| 4:18 near_death (54 of 253 at 4:18, then 70 at 4:18.5) | Trading head-on through her ult as her health fell from 250 to 54 in 3 s, with two abilities ready to step out and come back. | no | – | – | – | – |
| 4:27 death (killed by VEN) | Staying forward at half health after her ult ran out, into four enemies, with her teammates behind her. | no | – | – | – | – |
| 5:10 near_death (30 of 250) | Taking the portal dive in at 235 and trading down to 30 before stepping back, with an ability still ready. | no | – | – | – | – |

Run 1 in the app, as it went (images kept on this machine only):

![Marvel Rivals: live-01](loop-41/mr/live-01.png)
![Marvel Rivals: after-top](loop-41/mr/after-top.png)

## Valorant

### Run 1 (learned the game afresh): nothing named

18.8 min · 6 calls answered (3.5-flash-lite 67%, 3.1-flash-lite 33%), 54 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low, objectives, cover_losses, factor_refs, long_runup, hud_zoom, game_profile, par_counters, hp_bar · 15k prompt tokens (text 1k, images 14k, video 0k), 7k output · finish sent back 0 times · player learned as unknown · record: 0 kills, 0 deaths

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 0:41 death (killed by Fade) | Shooting while still walking into a doorway two enemies held: the first Classic shot went to the body for 39 and Fade's headshot answered. | no | – | – | – | – |
| 2:17 death (killed by Fade) | Throwing his flash where it popped in his own view and swapping to the Outlaw mid-fight, in a 2 v 1 he could have played with CLV/bam. | no | – | – | – | – |
| 4:15 death (killed by zeytazin, 'KILLED BY CLOVE') | Swinging the open courtyard on the move in a 1 v 2 with his ult ready, and not firing when zeytazin ran across his crosshair. | no | – | – | – | – |
| 4:57 death (killed by ulquiorra, 'KILLED BY NEON') | Taking the first duel alone on a Sheriff with no armor and his ult ready, and firing a beat late on a pre-aimed angle. | no | – | – | – | – |
| 6:15 death (killed by Reyna) | Running onto site with the knife out and the rifle not ready, so the duel with Reyna started 0.35 s late. | no | – | – | – | – |

### Run 2: nothing named

25.1 min · 15 calls answered (3.1-flash-lite 100%), 66 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low, objectives, cover_losses, factor_refs, long_runup, hud_zoom, game_profile, par_counters, hp_bar · 284k prompt tokens (text 92k, images 45k, video 146k), 24k output · finish sent back 0 times · player learned as unknown · record: 0 kills, 0 deaths

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 0:41 death (killed by Fade) | Shooting while still walking into a doorway two enemies held: the first Classic shot went to the body for 39 and Fade's headshot answered. | no | – | – | – | – |
| 2:17 death (killed by Fade) | Throwing his flash where it popped in his own view and swapping to the Outlaw mid-fight, in a 2 v 1 he could have played with CLV/bam. | no | – | – | – | – |
| 4:15 death (killed by zeytazin, 'KILLED BY CLOVE') | Swinging the open courtyard on the move in a 1 v 2 with his ult ready, and not firing when zeytazin ran across his crosshair. | no | – | – | – | – |
| 4:57 death (killed by ulquiorra, 'KILLED BY NEON') | Taking the first duel alone on a Sheriff with no armor and his ult ready, and firing a beat late on a pre-aimed angle. | no | – | – | – | – |
| 6:15 death (killed by Reyna) | Running onto site with the knife out and the rifle not ready, so the duel with Reyna started 0.35 s late. | no | – | – | – | – |

Run 1 in the app, as it went (images kept on this machine only):

![Valorant: live-01](loop-41/val/live-01.png)
![Valorant: live-02](loop-41/val/live-02.png)
![Valorant: after-top](loop-41/val/after-top.png)

## Clash Royale

### Run 1 (learned the game afresh): one-off, "Occasional overcommitting of elixir during mid-match skirmishes."

5.6 min · 27 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low, objectives, cover_losses, factor_refs, long_runup, hud_zoom, game_profile, par_counters, hp_bar · 353k prompt tokens (text 108k, images 57k, video 188k), 58k output · finish sent back 3 times · player learned as unknown, playing Battle Healer · record: 0 kills, 0 deaths

> Managing elixir carefully and executing decisive pushes, such as the final tower-destroying Fireball, enabled the player to secure victory despite early pressure.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 1:33 tower damage (right tower 3197 to 761) | Answering a Royal Giant at the bridge with the slowest, most expensive card, and only once it became affordable: the Sparky went down at 1:24.5 and first fired at 1:34.2, by which time the tower had taken all six shots (2436). | no | – | – | – | – |
| 2:36 tower damage (right tower 761 to 384), with the player's King Tower hit and activated (5582 bar from 2:24) | Stacking 13 elixir of Sparkys right against the damaged right tower, so the opponent's Fireball hit the tower (and the King Tower) along with the defence. | no | – | – | – | – |
| 3:27 right tower destroyed in sudden-death overtime: the match lost 0-1 | With a 384-health tower in sudden death, spending everything on defending in front of it (where the Fireball hit both), with no threat elsewhere, so the opponent's spells could finish the tower at their leisure. | no | – | – | – | – |

Cited at no real loss: 0:20 Player engages an enemy push with Battle Healer, Zap, and Golden Knight.; 0:20 Player engages an enemy push with Battle Healer, Zap, and Golden Knight.

### Run 2: nothing named

3.5 min · 14 calls answered (3.5-flash-lite 100%), 2 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low, objectives, cover_losses, factor_refs, long_runup, hud_zoom, game_profile, par_counters, hp_bar · 276k prompt tokens (text 56k, images 40k, video 181k), 28k output · finish sent back 0 times · player learned as unknown · record: 0 kills, 0 deaths

> Code found nothing lost in what it could read: no death, no lost fight, and no teammate down near you without a trade. No kill feed, death counter, or HP number could be read to check the deaths, which come from a low-detail pass alone, so one it missed is not ruled out. No single habit is named.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 1:33 tower damage (right tower 3197 to 761) | Answering a Royal Giant at the bridge with the slowest, most expensive card, and only once it became affordable: the Sparky went down at 1:24.5 and first fired at 1:34.2, by which time the tower had taken all six shots (2436). | no | – | – | – | – |
| 2:36 tower damage (right tower 761 to 384), with the player's King Tower hit and activated (5582 bar from 2:24) | Stacking 13 elixir of Sparkys right against the damaged right tower, so the opponent's Fireball hit the tower (and the King Tower) along with the defence. | no | – | – | – | – |
| 3:27 right tower destroyed in sudden-death overtime: the match lost 0-1 | With a 384-health tower in sudden death, spending everything on defending in front of it (where the Fireball hit both), with no threat elsewhere, so the opponent's spells could finish the tower at their leisure. | no | – | – | – | – |

Run 1 in the app, as it went (images kept on this machine only):

![Clash Royale: live-01](loop-41/cr/live-01.png)
![Clash Royale: live-02](loop-41/cr/live-02.png)
![Clash Royale: live-03](loop-41/cr/live-03.png)
![Clash Royale: live-04](loop-41/cr/live-04.png)
![Clash Royale: live-05](loop-41/cr/live-05.png)
![Clash Royale: live-06](loop-41/cr/live-06.png)
![Clash Royale: after-top](loop-41/cr/after-top.png)

## Fortnite

### Run 1 (learned the game afresh): one-off, "Engaged an enemy in the open at low health during the final endgame fight."

6 min · 20 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low, objectives, cover_losses, factor_refs, long_runup, hud_zoom, game_profile, par_counters, hp_bar · 220k prompt tokens (text 54k, images 71k, video 94k), 32k output · finish sent back 1 time · player learned as unknown · record: 4 kills, 1 deaths

> Taking fights out in the open without full health or proper cover leaves you vulnerable to being eliminated by opponents with high-tier weapons in endgame scenarios.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 2:43 damage (fall: health 97 -> 72, shield 98 untouched) | Dropping off a rock face for 25 fall damage with no fight on, which then spent their only bandage for 3 health. | no | – | – | – | – |
| 6:09 damage (fall: health 75 -> 55, shield 98 untouched) | Dropping off the hill to the river for 20 fall damage with no heals left to win it back. | no | – | – | – | – |
| 6:59 minor damage (fall: health 55 -> 45, shield 98 untouched) | A third fall-damage drop, now in the final four, leaving 45 health for the end game. | no | – | – | – | – |
| 7:30 heavy damage (shield 98 -> 24 in three hits, 7:29.9-7:33.1), fled | Walking into the open centre of the final-four circle with the pickaxe out and 45 health to loot a chest someone had already opened, and taking nothing from it, then running across open ground for about 4 s under fire instead of building. | no | – | – | – | – |
| 7:43 death (eliminated by MISK-82 with a Deadeye Assault Rifle; placed #4) | Re-peeking from behind a hedge at 69 health with no heals and no build, firing the Arc-Lightning Gun into the hedge that was their only cover; once it broke, the Deadeye Assault Rifle finished them in under a second. | yes | Player positioned behind a low hedge with low health at InnoLoop Labs instead of healing, leading to elimination in the 1v1 fight. Because: Positioned behind a low hedge in the open with low health (45 HP) and initiated an engagement with the Arc-Lightning Gun instead of healing or taking solid building cover. | position, resources, numbers, mechanics (4 of 6: position, information, resources, numbers, map, mechanics) | 45 HP | – |

### Run 2: one-off, "The player was eliminated because they engaged an enemy while low on health and in a vulnerable, open position without attempting to heal or find better cover."

20.5 min · 17 calls answered (3.1-flash-lite 88%, 3.5-flash-lite 12%), 16 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low, objectives, cover_losses, factor_refs, long_runup, hud_zoom, game_profile, par_counters, hp_bar · 187k prompt tokens (text 60k, images 28k, video 99k), 22k output · finish sent back 1 time · player learned as unknown · record: 4 kills, 1 deaths

> The player's decision to engage while low on health and in an exposed position directly led to their elimination. They failed to prioritize survival by healing or seeking better cover before committing to the fight.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 2:43 damage (fall: health 97 -> 72, shield 98 untouched) | Dropping off a rock face for 25 fall damage with no fight on, which then spent their only bandage for 3 health. | no | – | – | – | – |
| 6:09 damage (fall: health 75 -> 55, shield 98 untouched) | Dropping off the hill to the river for 20 fall damage with no heals left to win it back. | no | – | – | – | – |
| 6:59 minor damage (fall: health 55 -> 45, shield 98 untouched) | A third fall-damage drop, now in the final four, leaving 45 health for the end game. | no | – | – | – | – |
| 7:30 heavy damage (shield 98 -> 24 in three hits, 7:29.9-7:33.1), fled | Walking into the open centre of the final-four circle with the pickaxe out and 45 health to loot a chest someone had already opened, and taking nothing from it, then running across open ground for about 4 s under fire instead of building. | no | – | – | – | – |
| 7:43 death (eliminated by MISK-82 with a Deadeye Assault Rifle; placed #4) | Re-peeking from behind a hedge at 69 health with no heals and no build, firing the Arc-Lightning Gun into the hedge that was their only cover; once it broke, the Deadeye Assault Rifle finished them in under a second. | yes | The player engaged an enemy while standing still behind a hedge in an open area while low on health. Because: The player was stationary behind a hedge in an open area, making them an easy target for the enemy. They were also low on health (24/45) and engaged without attempting to heal or reposition to better cover. / T | position, resources (2 of 6: position, information, resources, numbers, map, mechanics) | 24/45 | – |

Run 1 in the app, as it went (images kept on this machine only):

![Fortnite: live-01](loop-41/fn/live-01.png)
![Fortnite: live-02](loop-41/fn/live-02.png)
![Fortnite: live-03](loop-41/fn/live-03.png)
![Fortnite: live-04](loop-41/fn/live-04.png)
![Fortnite: live-05](loop-41/fn/live-05.png)
![Fortnite: live-06](loop-41/fn/live-06.png)
![Fortnite: after-top](loop-41/fn/after-top.png)

## Brawl Stars

### Run 1 (learned the game afresh): one-off, "Overextending in the open lane while low on health"

5.8 min · 29 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low, objectives, cover_losses, factor_refs, long_runup, hud_zoom, game_profile, par_counters, hp_bar · 382k prompt tokens (text 141k, images 125k, video 117k), 56k output · finish sent back 3 times · player learned as unknown · record: 7 kills, 1 deaths

> Advancing into open fire without defensive cover while critically injured resulted in elimination, losing the fight.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 0:38 near_death (1 of 14300 HP, 0:38.25-0:40.0) | Walking up into the enemy's pink circle as it appeared and staying in it for about 7 s, ahead of his team. His health went 14300 to 4254 to 1 before he backed off. | no | – | – | – | – |
| 1:10 death (kill popup 'NPC💀💀Abuser -> PANDA YT' at 1:10.5; 'Following: Automatic' from 1:10.75) | After losing 9000 health alone on the right in 2.5 s, staying put alone on the right as kucennn walked up to him, instead of falling back to his team, and taking on three enemies alone. Then, with super charged from 1:05.75 and three gadgets, he used neither b | no | – | – | – | – |
| 2:58 death (kill popup 'SSZtt -> PANDA YT' at 2:58.5; spectating 'Following: ราชาโดดรุม' from 2:58.8) | Walking up alone, ahead of his team, into three enemies, and spending two of his three shots at SSZtt from range for no damage, so he had 1 of 3 left when SSZtt's beam and the circle caught him. Then standing in the enemy's pink circle to hit the object inside | no | – | – | – | – |

Cited at no real loss: 1:32 Advancing into the open lane to challenge enemies while vulnerable.; 1:32 Advancing into the open lane to challenge enemies while vulnerable.

### Run 2: nothing named

3.2 min · 11 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low, objectives, cover_losses, factor_refs, long_runup, hud_zoom, game_profile, par_counters, hp_bar · 226k prompt tokens (text 28k, images 25k, video 173k), 31k output · finish sent back 0 times · player learned as unknown · record: 0 kills, 0 deaths

> Code found nothing lost in what it could read: no death, no lost fight, and no teammate down near you without a trade. No kill feed, death counter, or HP number could be read to check the deaths, which come from a low-detail pass alone, so one it missed is not ruled out. No single habit is named.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 0:38 near_death (1 of 14300 HP, 0:38.25-0:40.0) | Walking up into the enemy's pink circle as it appeared and staying in it for about 7 s, ahead of his team. His health went 14300 to 4254 to 1 before he backed off. | no | – | – | – | – |
| 1:10 death (kill popup 'NPC💀💀Abuser -> PANDA YT' at 1:10.5; 'Following: Automatic' from 1:10.75) | After losing 9000 health alone on the right in 2.5 s, staying put alone on the right as kucennn walked up to him, instead of falling back to his team, and taking on three enemies alone. Then, with super charged from 1:05.75 and three gadgets, he used neither b | no | – | – | – | – |
| 2:58 death (kill popup 'SSZtt -> PANDA YT' at 2:58.5; spectating 'Following: ราชาโดดรุม' from 2:58.8) | Walking up alone, ahead of his team, into three enemies, and spending two of his three shots at SSZtt from range for no damage, so he had 1 of 3 left when SSZtt's beam and the circle caught him. Then standing in the enemy's pink circle to hit the object inside | no | – | – | – | – |

Run 1 in the app, as it went (images kept on this machine only):

![Brawl Stars: live-01](loop-41/bs/live-01.png)
![Brawl Stars: live-02](loop-41/bs/live-02.png)
![Brawl Stars: live-03](loop-41/bs/live-03.png)
![Brawl Stars: live-04](loop-41/bs/live-04.png)
![Brawl Stars: live-05](loop-41/bs/live-05.png)
![Brawl Stars: live-06](loop-41/bs/live-06.png)
![Brawl Stars: after-top](loop-41/bs/after-top.png)

## Chess

### Run 1 (learned the game afresh): habit, "Autopiloting and Not Calculating"

3.7 min · 14 calls answered (3.5-flash-lite 71%, 2.5-flash-lite 29%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low, objectives, cover_losses, factor_refs, long_runup, hud_zoom, game_profile, par_counters, hp_bar, chess_seen · 135k prompt tokens (text 35k, images 68k, video 32k), 25k output · finish sent back 0 times · player learned as "VasuGmR" · record: 0 kills, 0 deaths

> Making rapid moves without calculating opponent checks, captures, and threats led to multiple major blunders and lost material throughout the game.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 0:16 blunder 2.f4 (325 at depth 20, 334 at depth 16; best exd5) | Not taking or defending the attacked e4 pawn. | yes | Played 2. f4, giving away a pawn and weakening the center without calculating Black's response Because: Played 2. f4 at 0:15 with center control and pawn structure compromised, ignoring that dxe4 wins material and opens lines / Played f4 Because: Played f4 ignoring dxe4 | none (0 of 2: position, information) | none | – |
| 5:05 mistake 15.Bc3 (211 at depth 20, 169 at depth 16; best Nc3) | Moving the bishop, within a couple of seconds, onto a square that sets up a knight fork with the queen. | no | – | – | – | – |
| 5:14 blunder 16.Qd3 (430 at depth 20, 303 at depth 16; best d5) | Putting the queen on d3, in line with the e2 knight on the c4 bishop move's diagonal. | yes | Played 16. Qd3, walking into a discovered attack and losing the queen/material Because: Played Qd3 at 5:13 with the knight on e2 undefended and Black's bishop ready to play Bc4 with a discovered attack on the queen | position (1 of 2: position, information) | none | – |
| 5:41 blunder 18.Nf4 (571 at depth 20, 542 at depth 16; best Ng3) | Moving the knight, about a second after the queen trade, to a square the enemy bishop already attacks, with check behind it. | no | – | – | – | – |
| 6:15 inaccuracy at most: 21.Rhf1 (88 at depth 20, 119 at depth 16; best g3 at both) | Attacking the f4 bishop with the rook, which lets it escape with a pawn (...Bxh2), instead of with g3. | no | – | – | – | – |
| 6:28 blunder 22.Rxf4 (330 at depth 20, 288 at depth 16; best Bxc4) | Taking the f4 bishop first, which let the c4 bishop take the a6 bishop: an even trade instead of a won piece. | yes | Played 22. Rxf4, allowing Bxa6 and losing material Because: Played Rxf4 at 6:27 without calculating that the bishop on a6 is undefended after the capture | none (0 of 2: position, information) | none | – |
| 7:52 mistake 26.Rf1 (160 at depth 20, 147 at depth 16; best Re1) | Not challenging the rook on e2. | no | – | – | – | – |

Cited at no real loss: 0:57 Played Ne2; 1:02 Played fxe5; 2:03 Played Qb5+; 2:16 Played Qe5+; 3:23 Played Bd2

### Run 2: habit, "Ignoring opponent's threats and tactical replies"

4.2 min · 13 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low, objectives, cover_losses, factor_refs, long_runup, hud_zoom, game_profile, par_counters, hp_bar, chess_seen · 214k prompt tokens (text 92k, images 39k, video 82k), 48k output · finish sent back 4 times · player learned as "VasuGmR" · record: 0 kills, 0 deaths

> Making moves without calculating opponent threats, pins, and tactical replies repeatedly lost material and converted winning or playable positions into lost games.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 0:16 blunder 2.f4 (325 at depth 20, 334 at depth 16; best exd5) | Not taking or defending the attacked e4 pawn. | yes | Played 2. f4 allowing dxe4 Because: Played 2. f4 prematurely weakening central control and allowing dxe4. | none (0 of 2: position, information) | none | – |
| 5:05 mistake 15.Bc3 (211 at depth 20, 169 at depth 16; best Nc3) | Moving the bishop, within a couple of seconds, onto a square that sets up a knight fork with the queen. | no | – | – | – | – |
| 5:14 blunder 16.Qd3 (430 at depth 20, 303 at depth 16; best d5) | Putting the queen on d3, in line with the e2 knight on the c4 bishop move's diagonal. | no | – | – | – | – |
| 5:41 blunder 18.Nf4 (571 at depth 20, 542 at depth 16; best Ng3) | Moving the knight, about a second after the queen trade, to a square the enemy bishop already attacks, with check behind it. | yes | Played 18. Nf4 allowing Bxf4+ Because: Played 18. Nf4 without calculating Black's tactical response of Bxf4+ with check, losing the knight and conceding significant material. | none (0 of 2: position, resources) | none | – |
| 6:15 inaccuracy at most: 21.Rhf1 (88 at depth 20, 119 at depth 16; best g3 at both) | Attacking the f4 bishop with the rook, which lets it escape with a pawn (...Bxh2), instead of with g3. | no | – | – | – | – |
| 6:28 blunder 22.Rxf4 (330 at depth 20, 288 at depth 16; best Bxc4) | Taking the f4 bishop first, which let the c4 bishop take the a6 bishop: an even trade instead of a won piece. | yes | Played 22. Rxf4 allowing Bxa6 Because: Played 22. Rxf4 overlooking Black's bishop capturing the piece, losing material. | none (0 of 2: position, information) | none | – |
| 7:52 mistake 26.Rf1 (160 at depth 20, 147 at depth 16; best Re1) | Not challenging the rook on e2. | no | – | – | – | – |

Cited at no real loss: 2:03 Played 10. Qb5+ allowing Nc6; 1:02 Played 7. fxe5 allowing Qxe5; 2:16 Played 11. Qe5+ allowing Be6; 3:23 Played 12. Bd2 allowing Nd7

Run 1 in the app, as it went (images kept on this machine only):

![Chess: live-01](loop-41/ch/live-01.png)
![Chess: live-02](loop-41/ch/live-02.png)
![Chess: live-03](loop-41/ch/live-03.png)
![Chess: live-04](loop-41/ch/live-04.png)
![Chess: live-05](loop-41/ch/live-05.png)
![Chess: live-06](loop-41/ch/live-06.png)
![Chess: after-top](loop-41/ch/after-top.png)

## Rainbow Six Siege

### Run 1 (learned the game afresh): one-off, "Engaging in gunfights at critical low health (19 of 100) without healing or retreating to cover."

6.3 min · 29 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low, objectives, cover_losses, factor_refs, long_runup, hud_zoom, game_profile, par_counters, hp_bar · 354k prompt tokens (text 122k, images 100k, video 131k), 58k output · finish sent back 3 times · player learned as "TAVUKSEVEN", playing Mute · record: 8 kills, 1 deaths

> Though the player performed exceptionally well overall (winning 5 of 6 fights and securing the match victory), the sole death and lost fight occurred when engaging enemies at critical low health (19/100) instead of retreating to heal.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 8:38.9 near_death (19 of 100) | Emptying the whole rifle magazine at a doorway target, then walking through that same doorway on his pistol, without reloading, into an enemy who was already set inside. | no | – | – | – | – |
| 8:58.3 death (ELIMINATED BY francomix: THUNDERBIRD, SPEAR .308; headshot icon in the feed row) | Walking into an open room on 19 HP with the rifle lowered, so that when the enemy crossed his crosshair at 13 m (8:56.9) he couldn't shoot until the enemy was in cover, and lost the following exchange to one headshot. | yes | Moving through upper floor rooms at 19 of 100 health prior to the lost engagement Because: Pressing forward into engagement areas at 19 of 100 health without resetting health or securing support. / Engaging an enemy directly at 19 of 100 health resulting in being eliminated Because: Challenging an enemy in a direct gun | position, resources (2 of 6: position, information, resources, numbers, map, mechanics) | 19 of 100 | – |

### Run 2: one-off, "Engaging enemies at low health without cover or healing"

4.2 min · 15 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low, objectives, cover_losses, factor_refs, long_runup, hud_zoom, game_profile, par_counters, hp_bar · 196k prompt tokens (text 46k, images 45k, video 105k), 37k output · finish sent back 0 times · player learned as "TAVUKSEVEN", playing Mute · record: 8 kills, 1 deaths

> The player played exceptionally well overall, winning 5 out of 6 fights and taking the match 4-0. However, in the final round at match point, the player took unnecessary risks by challenging doorways at low health (19/100) without cover or healing utility, leading to a near-death state and their only death of the match.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 8:38.9 near_death (19 of 100) | Emptying the whole rifle magazine at a doorway target, then walking through that same doorway on his pistol, without reloading, into an enemy who was already set inside. | yes | The player engages an enemy in the doorway between Covered Terrace and Mezzanine while exposed, dropping to near-death. Because: The player challenged a direct doorway angle while exposed in 2F Mezzanine at match point with 1:35 on the clock and 3 vs 3 numbers, taking heavy unshielded damage; as read: position 8:39 The | position, numbers (2 of 6: position, information, resources, numbers, map, mechanics) | none | – |
| 8:58.3 death (ELIMINATED BY francomix: THUNDERBIRD, SPEAR .308; headshot icon in the feed row) | Walking into an open room on 19 HP with the rifle lowered, so that when the enemy crossed his crosshair at 13 m (8:56.9) he couldn't shoot until the enemy was in cover, and lost the following exchange to one headshot. | yes | The player pushes into 2F Piano Room at 19 HP and engages in a gunfight, resulting in death. Because: The player pushed into an enemy room at critically low health (19/100) in a 2 vs 3 situation without healing or secure cover; as read: position 8:59 The player stood in the 2F Piano Room doorway exposed to enemy angles | position, resources (2 of 6: position, information, resources, numbers, map, mechanics) | 19/100, 19 HP, 2 vs 3 | numbers: 19/100, |

Run 1 in the app, as it went (images kept on this machine only):

![Rainbow Six Siege: live-01](loop-41/r6/live-01.png)
![Rainbow Six Siege: live-02](loop-41/r6/live-02.png)
![Rainbow Six Siege: live-03](loop-41/r6/live-03.png)
![Rainbow Six Siege: live-04](loop-41/r6/live-04.png)
![Rainbow Six Siege: live-05](loop-41/r6/live-05.png)
![Rainbow Six Siege: live-06](loop-41/r6/live-06.png)
![Rainbow Six Siege: after-top](loop-41/r6/after-top.png)

