# Eval: loop-40

Generated 2026-10-25 13:13 from `40` by `eval/loop-report.mjs`. Each game was reviewed 2 times by the desktop app in a harness (`consistency.mjs`); run 1 learns the game afresh, later runs reuse what it learned. Graded against the frame-checked coach baselines in `eval/answer-keys/coach/`.

**How to read it.** *Losses cited*: of the baseline's losses (deaths, lost points, blunders, tower losses), how many the finding cites, at the loss or at the decision that led to it. *Factor coverage*: of the kinds of factor the baseline says decided each cited loss (position, information, resources, numbers, map, mechanics), the share the cited cause names, by its words (rough; not graded for chess). *Numbers named*: of the cited losses, how many have a cause that names a number matching one in the baseline's factors (health like 42% or 631/1479, a cooldown like 3:55 left, a score like 2-0, a count like 1 v 2), so depth shows, not only kinds. Cites, kinds, and numbers are the coach's own words; *By code* counts apart the losses only a turning point code filled in cites (cover_losses), and the losses where numbers code wrote match (factor_refs or a filled turning point). *Deaths found*: the record's deaths against the baseline's. *Matches the baseline*: every loss cited with at least 60% coverage (yes), at least half cited (partly), else no.

## Summary

| Game | Runs | Min/run | Calls answered / failed | Model share (answered) | Prompt / output tokens | Deaths found | Losses cited | Factor coverage | Matches the baseline | Numbers named | By code (cited, numbers) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| League of Legends | 2 | 8.9 | 22.0 / 3.0 | 3.5-flash-lite 64%, 3.1-flash-lite 36% | 466k / 55k | 2/2 +1 invented, 2/2 +1 invented | 2/3, 2/3 | 78%, 43% | partly | 1/2, 0/2 | +0, 0; +0, 0 |
| Rocket League | 2 | 3.6 | 19.5 / 1.0 | 3.5-flash-lite 100% | 275k / 53k | –, – | 0/1, 0/1 | –, – | no | 0/0, 0/0 | +0, 0; +0, 0 |
| Marvel Rivals | 2 | 6.5 | 25.5 / 2.0 | 3.5-flash-lite 100% | 370k / 70k | 1/1, 1/1 +1 invented | 1/4, 1/4 | 67%, 100% | no | 1/1, 0/1 | +0, 0; +0, 0 |
| Valorant | 2 | 8.6 | 23.5 / 1.0 | 3.5-flash-lite 100% | 446k / 65k | 5/5, 5/5 | 3/5, 3/5 | 61%, 67% | partly | 0/3, 1/3 | +0, 0; +0, 0 |
| Clash Royale | 2 | 1.6 | 10.5 / 0.5 | 3.5-flash-lite 100% | 90k / 18k | 0/1, 0/1 | 0/3, 0/3 | –, – | no | 0/0, 0/0 | +0, 0; +0, 0 |
| Fortnite | 1 | 7.4 | 19.0 / 1.0 | 3.5-flash-lite 100% | 181k / 32k | 1/1 | 1/5 | 67% | no | 1/1 | +0, 0 |
| Brawl Stars | 2 | 1.0 | 5.5 / 1.5 | 3.5-flash-lite 100% | 70k / 3k | 0/2, 0/2 | 0/3, 0/3 | –, – | no | 0/0, 0/0 | +0, 0; +0, 0 |
| Chess | 2 | 3.6 | 12.5 / 1.0 | 3.5-flash-lite 100% | 175k / 35k | –, – | 2/7, 1/7 | n/a, n/a | no | 0/2, 0/1 | +0, 0; +0, 0 |
| Rainbow Six Siege | 2 | 6.0 | 25.5 / 1.0 | 3.5-flash-lite 100% | 263k / 60k | 1/1, 1/1 | 1/2, 2/2 | 50%, 42% | partly | 1/1, 2/2 | +0, 0; +0, 0 |

Across 17 runs: 5.1 min, 18.1 calls answered and 1.4 failed (429/503, retried), 264k prompt and 44k output tokens a run, on average.

## What this loop changed (against loop 39)

Code frozen as `snaps/s40`. Nine clips, two runs each, except Fortnite: one run.

- `near_loss`: near-deaths are read as losses, at full detail.
- `state_facts`: numbers code knows (score, clock, health before, ammo, players alive) go to the clip reads and the coach.
- `spectate_deaths`: "Defeated" and "Following" screen text are death candidates. No death is counted while the player is already dead in the round.
- `far_downs_low`: teammate deaths far from the player are read at low detail.
- Unflagged: read times are put on the recording's clock. Causes stay on salvaged findings. Untrusted text is wrapped. In chess, a finding must show one of the costliest losses.

## Evaluation (graded by meaning)

How it was graded. A loss counts as cited if a moment is at it, or leads to it, within its decided span to 4 s after. A cited cause is **right** if it names the decision the baseline says lost it, with no fact that changes the lesson. It is **partly** right if it has the right moment and some right factors, but misses that decision or states a fact that changes the fix. It is **wrong** if the cause contradicts the baseline.

- **Total, all 17 runs:** 10 of 61 losses cited with a right cause, against 19 cited by the keyword grader. Of the other 9 cites, 4 are partly right and 5 are wrong.
- **Cost:** 264k prompt tokens and 18 calls a run, against 351k and 23 in loop 39. Most of the drop comes from Brawl Stars and Clash Royale runs that stopped after 4-8 calls. The first runs of League, Marvel, Rocket League and Siege each had 27-28 calls answered, over the 25-call budget.

### League of Legends: partly

Run 1 (the better run):

| Baseline loss | Cited? | Right | Wrong | Missed |
|---|---|---|---|---|
| 1:48 death | yes, 1:43 → 1:46 (right) | "Stepping up to push alone while enemies were missing". "ultimate was on cooldown". "661 of 1479" (baseline: 631-651 at 1:40). | "a teammate was dead": not in the baseline. | Flash down (3:55 left). The 'enemy has vision here' pings. The Nearsight at 1:43.5 as the cue to walk back. Level 9 against 11. |
| 4:30 near-death (280 of 1589) | no | – | – | Not in run 1's record. |
| 8:56 death | yes, 8:44 → 8:55 (right) | "lingering in an unwarded area ... against missing enemies". "ultimate was available but used while exposed": the ult channel. | "1123 of 1820" is her health at 8:52, not at 8:44 (1723). The frames check told the coach this. "2v3": the baseline has two teammates dead. | Flash spent to escape the stun. Two teammates dead. The drake drawing the enemy. |

- **Cites at no real loss:** 2:30 (the Herald). 9:17 ("Dying in a prior skirmish": dead in base, a restatement of 8:56). 5:42 → 5:46 (see the record below).
- **Run 2:** cites 1:48 and 8:56, but puts both in the wrong place, with no numbers. At 1:48 it says "moved into the river area"; she was at the front of the mid wave. At 8:56 it says "walked into the river alone"; Blitzcrank was with her. Its record had the 4:30 near-death (286 of 1589). No clip read covered it: the nearest window ran 4:14-4:24.
- **Record:** deaths at 1:46 and 8:55 are right in both runs. Both runs add a death at 5:46-5:49. Run 1 got it from the HUD's death counter. Run 2's read saw "You died" and 0/1703. The baseline has no loss there, so frame-check 5:40-5:50 before calling it invented. Run 2 counted minion kills as kills (22).
- **Wrong identities:** the clip reads named enemies who aren't in the match (Graves, Quinn), and called Blitzcrank, her teammate, an enemy. Run 1's board kept "killed by enemy Graves".
- **Against loop 39: better in run 1.** Causes now give health at the decision (661/1479), not at the death (1/1479, 0/1820), and name the ult at 8:56. Run 2 is worse. 4:30 is still never cited.

### Rocket League: no

Both runs:

| Baseline loss | Cited? | Right | Wrong | Missed |
|---|---|---|---|---|
| 4:15 point lost (NYAL scores, 2-1) | no | – | – | All of it: the double commit, boost 65 → 42 on the shot, a 2-0 lead with 1:18 left. |

- **Cites at no real loss:** 3:26 and 3:48 are THESOMEY's goals, which are the player's own. 4:42 is FORKY JR.'s goal, which is his teammate's. "remained grounded inside the goal" matches the baseline's not-true "he stayed static in his goal".
- **Record: wrong.** Learn named NYAL, an opponent, as the player and set the side to blue. The player is THESOMEY, on orange. All four goals flipped: his two goals were marked lost, NYAL's goal won, and his teammate's goal lost. Loop 39 also learned NYAL, but with no side, and its record had the sides right.
- **Against loop 39: worse.** Loop 39 run 1 matched the baseline ("2 to 0 with 1:10 remaining", "defensive half was left unoccupied"). The cause is the side and identity.

### Marvel Rivals: no

Run 1:

| Baseline loss | Cited? | Right | Wrong | Missed |
|---|---|---|---|---|
| 1:19 near-death (16 of 250) | no | – | – | It was in the record (50 of 250) and read at full detail. The cite was sent back twice. |
| 4:18 near-death (54 of 253) | no | – | – | It was in the record (54 of 250). The coach cited 4:17 at "157/250", which is right (baseline: 157 at 4:17). The record check sent it back against the read's 70/250 at 4:18 (baseline: 54 at 4:18, 70 at 4:18.5). |
| 4:27 death | yes, 4:26 → 4:29 (partly) | "121/250" (baseline: 121 of 250). "enemies outnumbering": there were four. | "abilities on cooldown", "no escape route". Baseline: one ability ready, one on 1 s. Its fix is to use the ready one to fall back. | Her ult had just run out (4:25.5). Two teammates were a few metres behind her. |
| 5:10 near-death (30 of 250) | no | – | – | Not in the record. |

- **Run 2:** cites only 1:19, at the loss itself (1:19 → 1:19). It says "health at 50/250 and ability icons on cooldown". The baseline has two slots ready at 1:16; the mistake is staying in until 16 health. Its record misses 4:18. It adds a death at 6:18; the frames check later found her alive at 298/298. Its "why" still blames "key team fights at 6:12".
- **Against loop 39: worse on cites.** Loop 39 cited 2 of 4 and 1 of 4; loop 40 cites 1 and 1. Loop 39 run 2's 4:27 cause, "ahead of teammates at 121/250", was closer.
- **The record is better in run 1:** 3 of the 4 losses, and the first time 4:18 was found.
- **Why:** the checks sent the claims back twice, and the salvage kept one moment. The ability state was read wrong.

### Valorant: no

Run 2:

| Baseline loss | Cited? | Right | Wrong | Missed |
|---|---|---|---|---|
| 0:41 death | yes, 0:39 → 0:40 (wrong) | – | "Held a static angle": he was walking, and fired on the move (Shooting Error 1.40°). "isolated ... away from teammates": woo was beyond the crate. | The moving body shot for 39. Two enemies in the doorway (1 v 2). |
| 2:17 death | yes, 2:15 → 2:17 (wrong) | – | "2v3": it was 2 v 1 by the top bar. "with a pistol": he swapped to the Outlaw at 2:14.3. "active enemy utility": the flash was his own, popping in his own view. | The Outlaw swap mid-fight. Trading with CLV\|bam. |
| 4:15 death | yes, 4:12 → 4:14 (right) | "Dry peeked ... with 51 HP and no teammates alive": 51 HP, nothing thrown, last one alive. | – | Ult ready and unused. Peeking on the move. He never fired as zeytazin crossed his crosshair (ammo stayed 20). 1 v 2 after the plant. |
| 4:57 death | no | – | – | Read at full detail. Not cited. |
| 6:15 death | no | – | – | Read at full detail. The 6:14 claim was sent back because a frames check said he "used the Blindside flash". The baseline has him running in with his knife out, with no flash. |

- **Run 1:** cites 0:41 and 2:17 with the same errors. At 0:41 it adds that the enemy had "a rifle", but that was the pistol round (0-0). It also cites 4:57 with a right core: the Sheriff duel ("with a pistol ... weapon disadvantage"). It misses that he had no armor, that his ult was ready, and that his shot was 0.25 s late.
- **The check flipped 0:41.** Run 1's first claim said "while holding W", which is right. The record check sent it back against the read's "Player stood completely still".
- **Run 1's habit is false.** "Forcing Pistol Fights Against Rifles" fits only 4:57. 0:41 was the pistol round. He died with the Outlaw at 2:17, and with rifles at 4:15 and 6:15.
- **Record: right.** 5 of 5 deaths, at the right times and with the right killers (Fade, Fade, zeytazin, ulquiorra, Reyna). None invented; loop 39 added two while he was dead.
- **Against loop 39: same on causes.** Each loop's best run got 4:15 right and 0:41 wrong. The record and the cost are better: 446k prompt tokens a run, against 692k.
- **Why:** the reads get his own actions wrong (moving or still, whose flash, which gun), and the ult is never read.

### Clash Royale: no

Run 1:

| Baseline loss | Cited? | Right | Wrong | Missed |
|---|---|---|---|---|
| 1:33 tower damage (3197 → 761) | no | – | – | Not in the record: no tower health was read. |
| 2:36 tower damage (761 → 384) | no | – | – | Not in the record. |
| 3:27 tower destroyed, lost 0-1 | no | – | – | Recorded as "Enemy princess tower destroyed", a point won. |

- **Cite at no real loss:** 0:21 "Placing a support unit behind advancing troops near the river".
- **Run 2:** 4 calls, nothing named. It has the same reversed ending ("Final push destroying enemy tower"). Its read names an Archer Queen, which isn't in the match.
- **Record: wrong.** The view is now own_screen (the loop 39 fix took), and the opponent is right (THE FRABET). But the read says "The player deploys Fireball", and the record calls the lost match a win. Baseline not-true: "a Ram Rider or any troop destroyed the right tower (the opponent's Fireball did)".
- **Against loop 39: same** (0 of 3). The cause is the record: the tower's side, and no tower health.

### Fortnite: no

One run:

| Baseline loss | Cited? | Right | Wrong | Missed |
|---|---|---|---|---|
| 2:43 fall (97 → 72) | no | – | – | Not in the record. |
| 6:09 fall (75 → 55) | no | – | – | Not in the record. |
| 6:59 fall (55 → 45) | no | – | – | Not in the record. |
| 7:30 shield 98 → 24, fled | no | – | – | Not in the record, no window. |
| 7:43 death | yes, 7:41 → 7:44 (right) | "fires an Arc-Lightning Gun from behind a low hedge". "24 shield and 45 health". "Deadeye Assault Rifle". "4 players remaining". | "on high ground" is unverified at 7:42: the baseline has the shots "from ahead", and a higher shooter only at 7:30. "(24/45)" reads as 24 of 45. The fix, "Heal to full health and shield", goes against the baseline's not-true "they had heals at the end". | No build in the quiet seconds, with 500 wood and 500 stone. His own lightning broke the hedge. |

- **Record:** the death is right (7:44, MISK-82). It has 5 kills where the HUD went 2 → 6; 4:44 and 4:48 look like one kill counted twice.
- **Against loop 39: same.** Loop 39 cited 1 of 5 in run 1 and 2 of 5 in run 2; its run 1 gave MISK-82's 100/63 as the player's health. Now the 7:43 numbers are exact.
- **Why:** four of the five losses are fall or shield damage, which never reach the record.

### Brawl Stars: no

Both runs:

| Baseline loss | Cited? | Right | Wrong | Missed |
|---|---|---|---|---|
| 0:38 near-death (1 of 14300) | no | – | – | Not in the record. |
| 1:10 death | no | – | – | Not in the record. |
| 2:58 death | no | – | – | Not in the record. |

- **Record: wrong, 0 deaths.** The box check dropped the health box ("shows nothing"), so no HP number was read. Loop 39 kept the box and found both deaths. The "Following:" text at 1:10.75 and 2:58.8 never became a death candidate.
- **The "why" is false.** It says "Code found nothing lost", but he died twice.
- **Against loop 39: worse.** Loop 39 run 1 cited 2 of 3. The cause is the record.

### Chess: no

Run 1:

| Baseline loss | Cited? | Right | Wrong | Missed |
|---|---|---|---|---|
| 0:16 2.f4 | no | – | – | In the record, with the engine's line ("allows dxe4"). |
| 5:05 15.Bc3 | no | – | – | The record says "allows Qd5". The baseline's line is 15...Nf6, then ...Nd5. |
| 5:14 16.Qd3 | no | – | – | It was cited ("allows Bc4 ... knight on e2 behind it"), then sent back: the frames check said the video "show[s] Qa6". It judged the engine's line by the move Black played. |
| 5:41 18.Nf4 | yes, 5:40 → 5:44 (right) | "allowed Black to reply with 18... Bxf4+ capturing the knight with check". The better move is "Ng3". | – | Why it lost: f4 sat on the d6 bishop's diagonal to c1, with nothing defending it. He played it a second after the queen trade. |
| 6:15 21.Rhf1 | no | – | – | An inaccuracy at most. |
| 6:28 22.Rxf4 | yes, 6:27 → 6:30 (right) | "allowed Black to reply with 22... Bxa6 capturing White's bishop". The better move is "Bxc4". | "capture the opponent's bishop safely": the b6 knight defended c4. Baseline not-true: the c4 bishop "was free". | The capture order: Bxc4 Nxc4 Rxf4 wins a piece. |
| 7:52 26.Rf1 | no | – | – | In the record ("allows Bd5"). |

- **Run 2:** cites only 18.Nf4, and gives the reason: "Black's dark-squared bishop was active on the diagonal".
- **The engine's refutation:** both cited moves name it (...Bxf4+ and ...Bxa6), with the engine's best move as the fix.
- **Record:** all 26 moves and their grades are right. White's clock reads at moves 16-22 (9:43, 9:51, 9:05) are wrong; the baseline has 7:08 and 7:00. The move times show how fast he moved (18.Nf4 came 1.3 s after ...bxa6), and the baseline's habit is speed, but no cause uses them.
- **Against loop 39: same coverage, more consistent.** Loop 39 run 2 cited the same two moves; loop 39 run 1 cited opening moves. Both runs now cite the costliest move.

### Rainbow Six Siege: partly

Run 2:

| Baseline loss | Cited? | Right | Wrong | Missed |
|---|---|---|---|---|
| 8:38.9 near-death (19 of 100) | yes, 8:38 (wrong) | "Health dropped from 100 to 19". "1:35 left on the clock at score 3-0". Equal numbers: it was 4 v 4 then. | "Holding an angle behind cover facing away": he walked through the doorway on his pistol, into an enemy ahead of him. "ammo was at 21/89": the rifle was 0/89, the pistol 21/100. "unmonitored doorway": he had seen an enemy in it 3-4 s before. | The empty rifle, not reloaded behind the counter. |
| 8:58.3 death | yes, 8:54 (right) | "Stepping through a doorway to challenge an enemy head-on with 19 HP". "25/64". "1:17 remaining on match point". "wait for teammate crossfire support". | "equal forces with 3 teammates alive": it was 2 v 3 from 8:39.5. | The rifle lowered on entry. francomix had just killed two teammates. He could have played off TAVUKSEVEN, who had the defuser. |

- **Run 1:** cites only 8:58. It has the same core ("advances ... at critical health", 19 out of 100, 3-0, 1:17) and the same wrong count ("3 teammates and 3 opponents"). Its fix says to heal "at a station".
- **Run 1's 8:38 cite was dropped.** It said "ammo at 15 in magazine", which is right (the pistol went 21 → 15 at 8:38.9). The check sent it back against the read's 21/100.
- **Record: right.** 19 of 100 at 8:39. Killed by francomix at 8:59 and traded.
- **Wrong operators:** run 1 names Montagne; he was Mute in rounds 2-3 and Ash in round 4. The round-4 reads call him Thunderbird, who is francomix's operator.
- **Against loop 39: better.** Run 2 cites both losses, and the 8:58 cause has 19/100, 25/64, 1:17 and 3-0. The empty magazine is still missed.

## What to fix next

Ranked by how many baseline losses each one would reach.

1. **Cite every loss in the record (9 losses).** These losses were in the record, with a clip read or an engine line, and the better run left them out:
   - chess 2.f4, 15.Bc3, 16.Qd3 and 26.Rf1;
   - Valorant 4:57 and 6:15;
   - Marvel 1:19 and 4:18;
   - League 4:30 (in run 2's record, but no read covered it).

   s41's `cover_losses` targets this. The chess fills would come from the engine, which is right for 3 of the 4. The others are only as good as their reads.
2. **Read ability and ult state as code facts (9 losses).** `state_facts` gives health, ammo, score, clock and players alive, but not abilities. Nine losses turn on them:
   - All four Marvel losses. Each baseline mistake is staying in with an ability ready, and both cited causes said "on cooldown".
   - Valorant 4:15, 4:57 and 6:15: ult ready and unused.
   - League 1:48 (Flash down) and 8:56 (Flash spent).
3. **Record the losses that aren't deaths (7 losses).** Fortnite's three falls and its 7:30 shield loss, and Clash Royale's three tower drops, never reach the record, so nothing reads them. s41's `objectives` and `hp_bar` target these. Clash Royale also needs the tower's side: the opponent's final Fireball on the player's tower was recorded as a win.
4. **Stop the checks sending back right claims (4 losses).** Right claims at Marvel 4:18, Siege 8:38 (run 1) and chess 16.Qd3 were dropped, and Valorant 0:41 was flipped. The numbers at Siege 8:58 and League 1:48 were changed. The checks fail in three ways:
   - A number is checked against a read from another second. Marvel 4:17 "157/250" was checked against the read's 70/250. Siege's 8:39 "15 in magazine" and 8:59 "13/64" were both right at their second. League's 1:41 health went back and forth between 661 and 608.
   - A read's claim is treated as the record. Valorant 0:38 "while holding W" was sent back against the read's "stood completely still".
   - Chess engine lines are judged by the video. 16.Qd3 "allowing Bc4" was sent back because Black played Qa6, and "losing 5.0 pawns" because no score is on screen.
5. **Keep Brawl Stars' health box (3 losses).** The box check dropped it as "shows nothing" at one look. Check the box at several moments, and treat "Following:" text as a death.
6. **Check a learned side against the HUD (1 loss and 4 flipped goals).** In Rocket League, every goal flipped once learn set the side to blue. Loop 39 learned no side and got the goals right. The feed's "YOU" names the player.

## League of Legends

### Run 1 (learned the game afresh): one-off, "Positioning alone without vision and getting ambushed"

11.3 min · 28 calls answered (3.5-flash-lite 100%), 3 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low · 498k prompt tokens (text 111k, images 122k, video 266k), 89k output · finish sent back 3 times · player learned as unknown, playing Miss Fortune · record: 5 kills, 3 deaths

> Failing to respect missing enemy pings and lack of vision caused repeated deaths and lost objectives, leaving the team at a numerical disadvantage.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 1:48 death | Staying at the front of the mid wave after four 'enemies missing' and three 'enemy has vision here' pings, with Flash and ult down and 42% health. | yes | Stepping up to push alone while enemies were missing. Because: Player health was 661 of 1479, ultimate was on cooldown, a teammate was dead, and enemies were missing from the minimap with no vision. / Stepping up to push alone while enemies were missing. Because: Player health was 661 of 1479, ultimate was on cooldown, | position, information, resources, numbers (4 of 5: position, information, resources, numbers, cue_missed) | 661 of 1479, | – |
| 4:30 near_death (280 of 1589) | Channeling her ult, which roots her in place, from inside the enemy's reach with no Flash. | no | – | – | – | – |
| 8:56 death | After Flashing out of CalvinCoach's stun, stopping in the river to channel her ult (which holds her in place) while two teammates were dead and the jungler was missing; Fizz's missing ping came two seconds later and the jungler's Nearsight a second after that. | yes | Entering and lingering in an unwarded area without vision against missing enemies. Because: Player health was 1123 of 1820, ultimate was available but used while exposed, and multiple enemies ambushed in a 2v3 numerical disadvantage. / Entering and lingering in an unwarded area without vision against missing enemies. B | information, resources, numbers (3 of 4: numbers, information, resources, objective) | none | – |

Cited at no real loss: 2:30 Committing to farm and skirmishing instead of contesting the objective.; 5:42 Staying pushed up in an unwarded area after missing enemy warnings.; 2:30 Committing to farm and skirmishing instead of contesting the objective.; 5:42 Staying pushed up in an unwarded area after missing enemy warnings.; 9:17 Dying in a prior skirmish before the objective spawn.

### Run 2: habit, "Overextending and moving into unwarded areas alone."

6.5 min · 16 calls answered (3.1-flash-lite 100%), 3 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low · 434k prompt tokens (text 40k, images 95k, video 298k), 21k output · finish sent back 0 times · player learned as unknown, playing Miss Fortune · record: 22 kills, 3 deaths

> The player's habit of overextending and moving into unwarded areas alone consistently leads to them being caught out of position, resulting in deaths and lost map control, which ultimately costs the team objectives and the game.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 1:48 death | Staying at the front of the mid wave after four 'enemies missing' and three 'enemy has vision here' pings, with Flash and ult down and 42% health. | yes | The player moved into the river area without vision. Because: The player moved into the river alone without vision of the enemy, making them an easy target for an ambush. They were outnumbered and far from the safety of their turret. / The player moved into the river area without vision. Because: The player moved into  | position, information, numbers (3 of 5: position, information, resources, numbers, cue_missed) | none | – |
| 4:30 near_death (280 of 1589) | Channeling her ult, which roots her in place, from inside the enemy's reach with no Flash. | no | – | – | – | – |
| 8:56 death | After Flashing out of CalvinCoach's stun, stopping in the river to channel her ult (which holds her in place) while two teammates were dead and the jungler was missing; Fizz's missing ping came two seconds later and the jungler's Nearsight a second after that. | yes | The player walked into the river alone. Because: The player walked into the river alone without vision of the enemy, leaving them unsupported and vulnerable to being caught by an enemy champion. / The player walked into the river alone. Because: The player walked into the river alone without vision of the enemy, leavin | position, information (1 of 4: numbers, information, resources, objective) | none | – |

Cited at no real loss: 5:44 The player stayed in the lane to clear minions while low on health.; 5:44 The player stayed in the lane to clear minions while low on health.

Run 1 in the app, as it went (images kept on this machine only):

![League of Legends: live-01](loop-40/lol/live-01.png)
![League of Legends: live-02](loop-40/lol/live-02.png)
![League of Legends: live-03](loop-40/lol/live-03.png)
![League of Legends: live-04](loop-40/lol/live-04.png)
![League of Legends: live-05](loop-40/lol/live-05.png)
![League of Legends: live-06](loop-40/lol/live-06.png)
![League of Legends: after-top](loop-40/lol/after-top.png)

## Rocket League

### Run 1 (learned the game afresh): one-off, "Weak defensive clearances and positioning"

4.5 min · 27 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low · 349k prompt tokens (text 107k, images 71k, video 171k), 72k output · finish sent back 3 times · player learned as "NYAL", playing Octane · record: 0 kills, 0 deaths

> Failing to clear the ball cleanly and poor positioning inside the goal allowed the opponents easy scoring opportunities and rebound shots.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 4:15 point_lost (NYAL scores; 2-1, 1:09 left) | A tight-angle shot from the corner while his teammate was also forward, which left the net empty when it was cleared. | no | – | – | – | – |

Cited at no real loss: 3:26 The player challenged the ball in a defensive position without securing a strong enough clear.; 3:48 The player committed to a defensive rotation that left the near post exposed to an enemy's shot.; 4:42 The player remained grounded inside the goal instead of challenging or clearing the ball proactively.; 3:26 The player challenged the ball in a defensive position without securing a strong en

### Run 2: habit, "Delayed defensive challenges and flawed rotation choices"

2.7 min · 12 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low · 201k prompt tokens (text 31k, images 32k, video 138k), 35k output · finish sent back 0 times · player learned as "NYAL", playing Octane · record: 0 kills, 0 deaths

> The player repeatedly conceded goals by choosing passive positioning or delayed challenges near the goal instead of contesting or clearing the ball effectively. Failing to challenge early or rotating away for boost left the defensive net exposed to opponent follow-up shots.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 4:15 point_lost (NYAL scores; 2-1, 1:09 left) | A tight-angle shot from the corner while his teammate was also forward, which left the net empty when it was cleared. | no | – | – | – | – |

Cited at no real loss: 3:25 Challenged the ball directly in front of the goal rather than clearing to the corner.; 3:46 Rotated toward the side boost instead of immediately challenging the advancing ball.; 4:42 Stayed grounded near the goal line after the initial save instead of jumping or rotating up to challenge the dropping ball.; 3:25 Challenged the ball directly in front of the goal rather than clearing to the corn

Run 1 in the app, as it went (images kept on this machine only):

![Rocket League: live-01](loop-40/rl/live-01.png)
![Rocket League: live-02](loop-40/rl/live-02.png)
![Rocket League: live-03](loop-40/rl/live-03.png)
![Rocket League: live-04](loop-40/rl/live-04.png)
![Rocket League: live-05](loop-40/rl/live-05.png)
![Rocket League: live-06](loop-40/rl/live-06.png)
![Rocket League: after-top](loop-40/rl/after-top.png)

## Marvel Rivals

### Run 1 (learned the game afresh): one-off, "Overextending without Vision or Awareness"

6.3 min · 28 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low · 358k prompt tokens (text 92k, images 76k, video 191k), 69k output · finish sent back 2 times · player learned as "PunK10", playing Magik · record: 12 kills, 1 deaths

> Overextending into enemy-held rooms and corridors without escape cooldowns or team support caused the player to take heavy concentrated fire, leading to near-deaths and elimination. By diving directly into enemy groups instead of holding Stepping Discs for retreat or fighting near cover, the player lost crucial health and free team presence.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 1:19 near_death (16 of 250 at 1:16.5; 50 at 1:18.5-1:19) | Staying in after her bonus health broke and VEN was revived, until she was at 16; with abilities ready she left only after a health pack saved her. | no | – | – | – | – |
| 4:18 near_death (54 of 253 at 4:18, then 70 at 4:18.5) | Trading head-on through her ult as her health fell from 250 to 54 in 3 s, with two abilities ready to step out and come back. | no | – | – | – | – |
| 4:27 death (killed by VEN) | Staying forward at half health after her ult ran out, into four enemies, with her teammates behind her. | yes | Fighting multiple enemies in close quarters in a corridor Because: Advanced into a corridor skirmish at 121/250 health (dropping to 32/250) with abilities on cooldown and enemies outnumbering the player in the immediate area / Committing to a close-quarters melee fight while outnumbered and on cooldown Because: Fought  | resources, numbers (2 of 3: numbers, resources, position) | 121/250 | – |
| 5:10 near_death (30 of 250) | Taking the portal dive in at 235 and trading down to 30 before stepping back, with an ability still ready. | no | – | – | – | – |

### Run 2: one-off, "Overextending without Awareness"

6.7 min · 23 calls answered (3.5-flash-lite 100%), 3 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low · 381k prompt tokens (text 95k, images 96k, video 190k), 70k output · finish sent back 2 times · player learned as "PunK10", playing Magik · record: 12 kills, 2 deaths

> Overextending without awareness caused the player to push deep into enemy lines without escape cooldowns or sufficient health, leading to critical near-deaths and eliminations that cost them key team fights at 6:12.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 1:19 near_death (16 of 250 at 1:16.5; 50 at 1:18.5-1:19) | Staying in after her bonus health broke and VEN was revived, until she was at 16; with abilities ready she left only after a health pack saved her. | yes | Player reached near-death state after pushing forward into the street. Because: Advanced into close quarters against multiple enemies without full health or escape abilities ready, with health at 50/250 and ability icons on cooldown. / Player reached near-death state after pushing forward into the street. Because: Adva | position, resources (2 of 2: resources, position) | none | – |
| 4:18 near_death (54 of 253 at 4:18, then 70 at 4:18.5) | Trading head-on through her ult as her health fell from 250 to 54 in 3 s, with two abilities ready to step out and come back. | no | – | – | – | – |
| 4:27 death (killed by VEN) | Staying forward at half health after her ult ran out, into four enemies, with her teammates behind her. | no | – | – | – | – |
| 5:10 near_death (30 of 250) | Taking the portal dive in at 235 and trading down to 30 before stepping back, with an ability still ready. | no | – | – | – | – |

Run 1 in the app, as it went (images kept on this machine only):

![Marvel Rivals: live-01](loop-40/mr/live-01.png)
![Marvel Rivals: live-02](loop-40/mr/live-02.png)
![Marvel Rivals: live-03](loop-40/mr/live-03.png)
![Marvel Rivals: live-04](loop-40/mr/live-04.png)
![Marvel Rivals: live-05](loop-40/mr/live-05.png)
![Marvel Rivals: live-06](loop-40/mr/live-06.png)
![Marvel Rivals: after-top](loop-40/mr/after-top.png)

## Valorant

### Run 1 (learned the game afresh): habit, "Forcing Pistol Fights Against Rifles"

10.2 min · 23 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low · 438k prompt tokens (text 98k, images 123k, video 217k), 58k output · finish sent back 1 time · player learned as "Me" · record: 1 kills, 5 deaths

> The player repeatedly engaged in direct gunfights with pistols against enemy rifles without adequate weapon advantage or utility support, resulting in repeated deaths and lost rounds.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 0:41 death (killed by Fade) | Shooting while still walking into a doorway two enemies held: the first Classic shot went to the body for 39 and Fade's headshot answered. | yes | Player held a static angle in B Link with a pistol and was killed by enemy Fade. Because: Holding a static angle in B Link with a pistol at 100/100 health in a 4v4 round against an enemy holding an advantageous angle with a rifle, without prior vision or support. | information, resources, numbers, mechanics (2 of 3: aim, mechanics, numbers) | none | – |
| 2:17 death (killed by Fade) | Throwing his flash where it popped in his own view and swapping to the Outlaw mid-fight, in a 2 v 1 he could have played with CLV/bam. | yes | Player pushed from B Tunnel onto B Site with a Classic pistol and was killed by enemy Fade. Because: Pushing forward onto B site with a Classic pistol in a 2v3 situation with 100/100 health, without adequate cover, health, or weapon advantage against enemy utility and rifles. / Player pushed from B Tunnel onto B Site w | position, resources, numbers, mechanics (2 of 3: utility, mechanics, numbers) | none | – |
| 4:15 death (killed by zeytazin, 'KILLED BY CLOVE') | Swinging the open courtyard on the move in a 1 v 2 with his ult ready, and not firing when zeytazin ran across his crosshair. | no | – | – | – | – |
| 4:57 death (killed by ulquiorra, 'KILLED BY NEON') | Taking the first duel alone on a Sheriff with no armor and his ult ready, and firing a beat late on a pre-aimed angle. | yes | Player advanced into A Main with a pistol against an enemy position and was killed by enemy Neon. Because: Advancing into A Main with a pistol against an enemy position in a 5v5 round with 100 health, facing a weapon disadvantage without utility support. / Player advanced into A Main with a pistol against an enemy posi | resources, numbers, mechanics (2 of 4: economy, resources, aim, numbers) | none | – |
| 6:15 death (killed by Reyna) | Running onto site with the knife out and the rifle not ready, so the duel with Reyna started 0.35 s late. | no | – | – | – | – |

### Run 2: habit, "W-Keying Defensively: Pushing or dry-peeking chokepoints into numerical or resource disadvantages without teammate support."

7.1 min · 24 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low · 454k prompt tokens (text 116k, images 104k, video 234k), 73k output · finish sent back 2 times · player learned as "Me", playing Yoru · record: 1 kills, 5 deaths

> Pushing or dry-peeking chokepoints into numerical and resource disadvantages repeatedly surrendered first bloods and man-disadvantages, costing winnable rounds.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 0:41 death (killed by Fade) | Shooting while still walking into a doorway two enemies held: the first Classic shot went to the body for 39 and Fade's headshot answered. | yes | Held a static angle in B Link alone while down in numbers. Because: 3v4 numbers disadvantage, isolated in B Link away from teammates, health at 100, and holding a static angle without utility support. / Held a static angle in B Link alone while down in numbers. Because: 3v4 numbers disadvantage, isolated in B Link away | position, resources, numbers, mechanics (2 of 3: aim, mechanics, numbers) | none | – |
| 2:17 death (killed by Fade) | Throwing his flash where it popped in his own view and swapping to the Outlaw mid-fight, in a 2 v 1 he could have played with CLV/bam. | yes | Pushed through B Tunnel into B site with a pistol against enemy utility and Fade. Because: 2v3 numbers disadvantage, health dropping from 100 before elimination, active enemy utility, and pushing through B Tunnel into B site with a pistol against rifles. | resources, numbers, mechanics (2 of 3: utility, mechanics, numbers) | none | – |
| 4:15 death (killed by zeytazin, 'KILLED BY CLOVE') | Swinging the open courtyard on the move in a 1 v 2 with his ult ready, and not firing when zeytazin ran across his crosshair. | yes | Dry peeked and engaged out of A Flowers with 51 HP and no teammates alive. Because: Teammates dead leaving a player disadvantage, health at 51, and dry peeking out of A Flowers without support against remaining enemies. | resources, numbers, mechanics (2 of 3: mechanics, utility, numbers) | 51 HP, health at 51, | – |
| 4:57 death (killed by ulquiorra, 'KILLED BY NEON') | Taking the first duel alone on a Sheriff with no armor and his ult ready, and firing a beat late on a pre-aimed angle. | no | – | – | – | – |
| 6:15 death (killed by Reyna) | Running onto site with the knife out and the rifle not ready, so the duel with Reyna started 0.35 s late. | no | – | – | – | – |

Run 1 in the app, as it went (images kept on this machine only):

![Valorant: live-01](loop-40/val/live-01.png)
![Valorant: live-02](loop-40/val/live-02.png)
![Valorant: live-03](loop-40/val/live-03.png)
![Valorant: live-04](loop-40/val/live-04.png)
![Valorant: live-05](loop-40/val/live-05.png)
![Valorant: live-06](loop-40/val/live-06.png)
![Valorant: after-top](loop-40/val/after-top.png)

## Clash Royale

### Run 1 (learned the game afresh): one-off, "Launching a push near the river without an elixir advantage led to losing an engagement early in the match."

2.5 min · 17 calls answered (3.5-flash-lite 100%), 0 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low · 122k prompt tokens (text 56k, images 32k, video 34k), 30k output · finish sent back 2 times · player learned as unknown · record: 0 kills, 0 deaths

> Unfavorable engagements and aggressive pushes without an elixir advantage give opponents easy defensive trades and counter-attack opportunities.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 1:33 tower damage (right tower 3197 to 761) | Answering a Royal Giant at the bridge with the slowest, most expensive card, and only once it became affordable: the Sparky went down at 1:24.5 and first fired at 1:34.2, by which time the tower had taken all six shots (2436). | no | – | – | – | – |
| 2:36 tower damage (right tower 761 to 384), with the player's King Tower hit and activated (5582 bar from 2:24) | Stacking 13 elixir of Sparkys right against the damaged right tower, so the opponent's Fireball hit the tower (and the King Tower) along with the defence. | no | – | – | – | – |
| 3:27 right tower destroyed in sudden-death overtime: the match lost 0-1 | With a 384-health tower in sudden death, spending everything on defending in front of it (where the Fireball hit both), with no threat elsewhere, so the opponent's spells could finish the tower at their leisure. | no | – | – | – | – |

Cited at no real loss: 0:21 Placing a support unit behind advancing troops near the river encountered enemy defense

### Run 2: nothing named

0.7 min · 4 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low · 59k prompt tokens (text 19k, images 22k, video 18k), 6k output · finish sent back 0 times · player learned as unknown · record: 0 kills, 0 deaths

> Code found nothing lost in what it could read: no death, no lost fight, and no teammate down near you without a trade. No kill feed, death counter, or HP number could be read to check the deaths, which come from a low-detail pass alone, so one it missed is not ruled out. No single habit is named.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 1:33 tower damage (right tower 3197 to 761) | Answering a Royal Giant at the bridge with the slowest, most expensive card, and only once it became affordable: the Sparky went down at 1:24.5 and first fired at 1:34.2, by which time the tower had taken all six shots (2436). | no | – | – | – | – |
| 2:36 tower damage (right tower 761 to 384), with the player's King Tower hit and activated (5582 bar from 2:24) | Stacking 13 elixir of Sparkys right against the damaged right tower, so the opponent's Fireball hit the tower (and the King Tower) along with the defence. | no | – | – | – | – |
| 3:27 right tower destroyed in sudden-death overtime: the match lost 0-1 | With a 384-health tower in sudden death, spending everything on defending in front of it (where the Fireball hit both), with no threat elsewhere, so the opponent's spells could finish the tower at their leisure. | no | – | – | – | – |

Run 1 in the app, as it went (images kept on this machine only):

![Clash Royale: live-01](loop-40/cr/live-01.png)
![Clash Royale: live-02](loop-40/cr/live-02.png)
![Clash Royale: live-03](loop-40/cr/live-03.png)
![Clash Royale: live-04](loop-40/cr/live-04.png)
![Clash Royale: live-05](loop-40/cr/live-05.png)
![Clash Royale: live-06](loop-40/cr/live-06.png)
![Clash Royale: after-top](loop-40/cr/after-top.png)

## Fortnite

### Run 1 (learned the game afresh): one-off, "Engaging an elevated enemy from low hedge cover with critical health and no defensive structure."

7.4 min · 19 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low · 181k prompt tokens (text 41k, images 39k, video 101k), 32k output · finish sent back 0 times · player learned as unknown · record: 5 kills, 1 deaths

> Challenging an enemy from a disadvantaged low-ground position with compromised health and minimal cover leaves you entirely vulnerable to superior high-ground fire, costing you the match in the final moments.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 2:43 damage (fall: health 97 -> 72, shield 98 untouched) | Dropping off a rock face for 25 fall damage with no fight on, which then spent their only bandage for 3 health. | no | – | – | – | – |
| 6:09 damage (fall: health 75 -> 55, shield 98 untouched) | Dropping off the hill to the river for 20 fall damage with no heals left to win it back. | no | – | – | – | – |
| 6:59 minor damage (fall: health 55 -> 45, shield 98 untouched) | A third fall-damage drop, now in the final four, leaving 45 health for the end game. | no | – | – | – | – |
| 7:30 heavy damage (shield 98 -> 24 in three hits, 7:29.9-7:33.1), fled | Walking into the open centre of the final-four circle with the pickaxe out and 45 health to loot a chest someone had already opened, and taking nothing from it, then running across open ground for about 4 s under fire instead of building. | no | – | – | – | – |
| 7:43 death (eliminated by MISK-82 with a Deadeye Assault Rifle; placed #4) | Re-peeking from behind a hedge at 69 health with no heals and no build, firing the Arc-Lightning Gun into the hedge that was their only cover; once it broke, the Deadeye Assault Rifle finished them in under a second. | yes | The player fires an Arc-Lightning Gun from behind a low hedge while having 24 shield and 45 health against an enemy with a Deadeye Assault Rifle on high ground. Because: The player engaged an elevated opponent from low hedge cover with critical health (24/45), no escape utility, and 4 players remaining in the storm cir | position, resources, map, mechanics (4 of 6: position, information, resources, numbers, map, mechanics) | 24/45, 24 shield, 45 health, 4 players | – |

Run 1 in the app, as it went (images kept on this machine only):

![Fortnite: live-01](loop-40/fn/live-01.png)
![Fortnite: live-02](loop-40/fn/live-02.png)
![Fortnite: live-03](loop-40/fn/live-03.png)
![Fortnite: live-04](loop-40/fn/live-04.png)
![Fortnite: live-05](loop-40/fn/live-05.png)
![Fortnite: live-06](loop-40/fn/live-06.png)
![Fortnite: after-top](loop-40/fn/after-top.png)

## Brawl Stars

### Run 1 (learned the game afresh): nothing named

1.2 min · 7 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low · 75k prompt tokens (text 18k, images 41k, video 17k), 4k output · finish sent back 0 times · player learned as "PANDA YT™" · record: 0 kills, 0 deaths

> Code found nothing lost in what it could read: no death, no lost fight, and no teammate down near you without a trade. No kill feed, death counter, or HP number could be read to check the deaths, which come from a low-detail pass alone, so one it missed is not ruled out. No single habit is named.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 0:38 near_death (1 of 14300 HP, 0:38.25-0:40.0) | Walking up into the enemy's pink circle as it appeared and staying in it for about 7 s, ahead of his team. His health went 14300 to 4254 to 1 before he backed off. | no | – | – | – | – |
| 1:10 death (kill popup 'NPC💀💀Abuser -> PANDA YT' at 1:10.5; 'Following: Automatic' from 1:10.75) | After losing 9000 health alone on the right in 2.5 s, staying put alone on the right as kucennn walked up to him, instead of falling back to his team, and taking on three enemies alone. Then, with super charged from 1:05.75 and three gadgets, he used neither b | no | – | – | – | – |
| 2:58 death (kill popup 'SSZtt -> PANDA YT' at 2:58.5; spectating 'Following: ราชาโดดรุม' from 2:58.8) | Walking up alone, ahead of his team, into three enemies, and spending two of his three shots at SSZtt from range for no damage, so he had 1 of 3 left when SSZtt's beam and the circle caught him. Then standing in the enemy's pink circle to hit the object inside | no | – | – | – | – |

### Run 2: nothing named

0.8 min · 4 calls answered (3.5-flash-lite 100%), 2 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low · 64k prompt tokens (text 25k, images 22k, video 17k), 3k output · finish sent back 0 times · player learned as "PANDA YT™" · record: 0 kills, 0 deaths

> Code found nothing lost in what it could read: no death, no lost fight, and no teammate down near you without a trade. No kill feed, death counter, or HP number could be read to check the deaths, which come from a low-detail pass alone, so one it missed is not ruled out. No single habit is named.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 0:38 near_death (1 of 14300 HP, 0:38.25-0:40.0) | Walking up into the enemy's pink circle as it appeared and staying in it for about 7 s, ahead of his team. His health went 14300 to 4254 to 1 before he backed off. | no | – | – | – | – |
| 1:10 death (kill popup 'NPC💀💀Abuser -> PANDA YT' at 1:10.5; 'Following: Automatic' from 1:10.75) | After losing 9000 health alone on the right in 2.5 s, staying put alone on the right as kucennn walked up to him, instead of falling back to his team, and taking on three enemies alone. Then, with super charged from 1:05.75 and three gadgets, he used neither b | no | – | – | – | – |
| 2:58 death (kill popup 'SSZtt -> PANDA YT' at 2:58.5; spectating 'Following: ราชาโดดรุม' from 2:58.8) | Walking up alone, ahead of his team, into three enemies, and spending two of his three shots at SSZtt from range for no damage, so he had 1 of 3 left when SSZtt's beam and the circle caught him. Then standing in the enemy's pink circle to hit the object inside | no | – | – | – | – |

Run 1 in the app, as it went (images kept on this machine only):

![Brawl Stars: live-01](loop-40/bs/live-01.png)
![Brawl Stars: live-02](loop-40/bs/live-02.png)
![Brawl Stars: live-03](loop-40/bs/live-03.png)
![Brawl Stars: live-04](loop-40/bs/live-04.png)
![Brawl Stars: after-top](loop-40/bs/after-top.png)

## Chess

### Run 1 (learned the game afresh): one-off, "Tunnel Vision / Ignoring Opponent's Threats"

3.9 min · 14 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low · 198k prompt tokens (text 62k, images 73k, video 63k), 36k output · finish sent back 2 times · player learned as "VasuGmR" · record: 0 kills, 0 deaths

> Throughout the middlegame, White made several tactical blunders by playing moves that permitted opponent counter-attacks—such as checks capturing knights and undefended piece captures—which repeatedly cost material and decisive advantages.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 0:16 blunder 2.f4 (325 at depth 20, 334 at depth 16; best exd5) | Not taking or defending the attacked e4 pawn. | no | – | – | – | – |
| 5:05 mistake 15.Bc3 (211 at depth 20, 169 at depth 16; best Nc3) | Moving the bishop, within a couple of seconds, onto a square that sets up a knight fork with the queen. | no | – | – | – | – |
| 5:14 blunder 16.Qd3 (430 at depth 20, 303 at depth 16; best d5) | Putting the queen on d3, in line with the e2 knight on the c4 bishop move's diagonal. | no | – | – | – | – |
| 5:41 blunder 18.Nf4 (571 at depth 20, 542 at depth 16; best Ng3) | Moving the knight, about a second after the queen trade, to a square the enemy bishop already attacks, with check behind it. | yes | White plays 18. Nf4. Because: White played 18. Nf4, which allowed Black to reply with 18... Bxf4+ capturing the knight with check. / White plays 18. Nf4. Because: White played 18. Nf4 allowing 18... Bxf4+ with check. | none (0 of 2: position, resources) | none | – |
| 6:15 inaccuracy at most: 21.Rhf1 (88 at depth 20, 119 at depth 16; best g3 at both) | Attacking the f4 bishop with the rook, which lets it escape with a pawn (...Bxh2), instead of with g3. | no | – | – | – | – |
| 6:28 blunder 22.Rxf4 (330 at depth 20, 288 at depth 16; best Bxc4) | Taking the f4 bishop first, which let the c4 bishop take the a6 bishop: an even trade instead of a won piece. | yes | White plays 22. Rxf4. Because: White played 22. Rxf4, which allowed Black to reply with 22... Bxa6 capturing White's bishop. / White plays 22. Rxf4. Because: White played 22. Rxf4 allowing 22... Bxa6. | none (0 of 2: position, information) | none | – |
| 7:52 mistake 26.Rf1 (160 at depth 20, 147 at depth 16; best Re1) | Not challenging the rook on e2. | no | – | – | – | – |

### Run 2: one-off, "Tunnel Vision / Ignoring Opponent's Threats"

3.4 min · 11 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low · 153k prompt tokens (text 48k, images 48k, video 57k), 33k output · finish sent back 2 times · player learned as "VasuGmR" · record: 0 kills, 0 deaths

> Tunnel vision and ignoring opponent threats caused critical tactical blunders where pieces were left undefended or walked directly into forks and checks, losing material and advantage.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 0:16 blunder 2.f4 (325 at depth 20, 334 at depth 16; best exd5) | Not taking or defending the attacked e4 pawn. | no | – | – | – | – |
| 5:05 mistake 15.Bc3 (211 at depth 20, 169 at depth 16; best Nc3) | Moving the bishop, within a couple of seconds, onto a square that sets up a knight fork with the queen. | no | – | – | – | – |
| 5:14 blunder 16.Qd3 (430 at depth 20, 303 at depth 16; best d5) | Putting the queen on d3, in line with the e2 knight on the c4 bishop move's diagonal. | no | – | – | – | – |
| 5:41 blunder 18.Nf4 (571 at depth 20, 542 at depth 16; best Ng3) | Moving the knight, about a second after the queen trade, to a square the enemy bishop already attacks, with check behind it. | yes | Played 18. Nf4 (blunder) Because: Played 18. Nf4 when Black's dark-squared bishop was active on the diagonal, allowing Bxf4+ capturing the knight with check. | none (0 of 2: position, resources) | none | – |
| 6:15 inaccuracy at most: 21.Rhf1 (88 at depth 20, 119 at depth 16; best g3 at both) | Attacking the f4 bishop with the rook, which lets it escape with a pawn (...Bxh2), instead of with g3. | no | – | – | – | – |
| 6:28 blunder 22.Rxf4 (330 at depth 20, 288 at depth 16; best Bxc4) | Taking the f4 bishop first, which let the c4 bishop take the a6 bishop: an even trade instead of a won piece. | no | – | – | – | – |
| 7:52 mistake 26.Rf1 (160 at depth 20, 147 at depth 16; best Re1) | Not challenging the rook on e2. | no | – | – | – | – |

Run 1 in the app, as it went (images kept on this machine only):

![Chess: live-01](loop-40/ch/live-01.png)
![Chess: live-02](loop-40/ch/live-02.png)
![Chess: live-03](loop-40/ch/live-03.png)
![Chess: live-04](loop-40/ch/live-04.png)
![Chess: live-05](loop-40/ch/live-05.png)
![Chess: live-06](loop-40/ch/live-06.png)
![Chess: after-top](loop-40/ch/after-top.png)

## Rainbow Six Siege

### Run 1 (learned the game afresh): one-off, "Pushing into active gunfights at critical health without healing"

5.9 min · 27 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low · 283k prompt tokens (text 92k, images 70k, video 122k), 61k output · finish sent back 2 times · player learned as unknown, playing Montagne · record: 8 kills, 1 deaths

> Engaging enemies while critically wounded left the player with zero health, resulting in heavy damage and an unnecessary death upon taking minimal hits.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 8:38.9 near_death (19 of 100) | Emptying the whole rifle magazine at a doorway target, then walking through that same doorway on his pistol, without reloading, into an enemy who was already set inside. | no | – | – | – | – |
| 8:58.3 death (ELIMINATED BY francomix: THUNDERBIRD, SPEAR .308; headshot icon in the feed row) | Walking into an open room on 19 HP with the rifle lowered, so that when the enemy crossed his crosshair at 13 m (8:56.9) he couldn't shoot until the enemy was in cover, and lost the following exchange to one headshot. | yes | The player advances into the active gunfight in the 2F Piano Room while at critical health. Because: Health at 19 out of 100, equal player numbers active with 3 teammates and 3 opponents, score blue 3, orange 0 with 1:17 remaining, and standing while advancing into the room. / The player advances into the active gunfig | resources, numbers, map (3 of 6: position, information, resources, numbers, map, mechanics) | 19 out of 100, | – |

### Run 2: one-off, "Peeking angles with low health and no intel"

6.1 min · 24 calls answered (3.5-flash-lite 100%), 1 failed · flags: near_loss, state_facts, spectate_deaths, far_downs_low · 244k prompt tokens (text 100k, images 33k, video 110k), 59k output · finish sent back 3 times · player learned as unknown, playing Mute · record: 8 kills, 1 deaths

> Challenging enemies while critically injured and unmonitored forced mutual trades and near-death situations instead of maintaining survivability.

| Baseline loss | What the baseline says decided it | Cited? | What the review said | Kinds named (of the baseline's) | Numbers named | By code |
|---|---|---|---|---|---|---|
| 8:38.9 near_death (19 of 100) | Emptying the whole rifle magazine at a doorway target, then walking through that same doorway on his pistol, without reloading, into an enemy who was already set inside. | yes | Holding an angle behind cover facing away from the incoming enemy approach. Because: Health dropped from 100 to 19, ammo was at 21/89, equal players remained with 3 teammates alive, 1:35 left on the clock at score 3-0, and the position was exposed to an unmonitored doorway. / Holding an angle behind cover facing away f | position, resources, map (3 of 6: position, information, resources, numbers, map, mechanics) | 3-0 | – |
| 8:58.3 death (ELIMINATED BY francomix: THUNDERBIRD, SPEAR .308; headshot icon in the feed row) | Walking into an open room on 19 HP with the rifle lowered, so that when the enemy crossed his crosshair at 13 m (8:56.9) he couldn't shoot until the enemy was in cover, and lost the following exchange to one headshot. | yes | Stepping through a doorway to challenge an enemy head-on with 19 HP. Because: Health was critically low at 19/100, ammo was at 25/64, equal forces with 3 teammates alive, 1:17 remaining on match point, and the player moved exposed without utility or full health. / Stepping through a doorway to challenge an enemy head-o | resources, mechanics (2 of 6: position, information, resources, numbers, map, mechanics) | 19/100,, 25/64,, 19 HP | – |

Run 1 in the app, as it went (images kept on this machine only):

![Rainbow Six Siege: live-01](loop-40/r6/live-01.png)
![Rainbow Six Siege: live-02](loop-40/r6/live-02.png)
![Rainbow Six Siege: live-03](loop-40/r6/live-03.png)
![Rainbow Six Siege: live-04](loop-40/r6/live-04.png)
![Rainbow Six Siege: live-05](loop-40/r6/live-05.png)
![Rainbow Six Siege: live-06](loop-40/r6/live-06.png)
![Rainbow Six Siege: after-top](loop-40/r6/after-top.png)

