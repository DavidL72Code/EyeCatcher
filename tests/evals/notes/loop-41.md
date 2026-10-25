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
