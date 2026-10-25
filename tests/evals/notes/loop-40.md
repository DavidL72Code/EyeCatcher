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
