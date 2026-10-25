# Mistake ledger

Every wrong, partly right, or missed baseline loss the judged loops found (loops 40 and 41, graded by meaning against `eval/answer-keys/coach/`).

Each mistake gets traced to the first stage that went wrong, fixed generically, and proven on that exact case. The proof is a unit test or a replay built from the run's own saved data, then a targeted live run of that clip.

Status:
- **open:** no fix yet.
- **fixed:** code changed, not yet proven on the case.
- **proven offline:** a test or replay on the run's own data passes.
- **proven live:** a fresh review of the clip gets it right.

## League of Legends

| # | Loss | What was wrong | First wrong stage | Fix | Status |
|---|---|---|---|---|---|
| L1 | 1:48 death | Health "271 of 1479" (mid-burst); the frames check read 621, and the record check put 271 back | Record check | Round 4: a number contradicts only from a record line or the video check, at the claim's own moment (`staleAgainst`, `videoSaw`) | proven offline (dry run on loop 41: 6 of 6 wrong contradictions dropped) |
| L2 | 1:48 death | Flash down never named; the read took Flash's 3:49 timer for "the scoreboard clock" | Clip read (HUD labels) | Round 4: the clock is "never a number on an ability icon"; round 3: `ability_state` reads each icon lit or dimmed in code | proven offline (36 of 36 icons right on League frames) |
| L3 | 1:48 death | "channel an ability": the ult was down | Coach | `ability_state` gives the ult dimmed as a code fact | fixed |
| L4 | 4:30 near-death | "to farm minions" (she walked in from base and cast her ult); the ult's root and no Flash missed | Clip read | `ability_state` (R lit, then dimmed after the cast; F dimmed); `near_loss` reads it at full detail | fixed |
| L5 | 8:56 death | "without ultimate ready and with low health": she had 1723 of 1820 with Flash and the ult up; "392 of 693" is mana | Clip read and record check | Round 4 HUD labels ("a second bar is another resource"); L1's rule; `ability_state` | fixed |
| L6 | 8:56 death | "two allies present": only Blitzcrank | Clip read | The read counts a teammate only on the player's screen or beside their marker on the minimap, never off the scoreboard; the video check gets the minimap with any claim of a place or teammates and holds it to that | fixed (a model behaviour: the prompts are tested, `ledger L6, L9, V3, V4, B4: ...`; needs a live run) |
| L7 | (run 2) | Code-filled turning points at 1:44, 4:21, 9:17 all wrong; one restored a claim the checks had rejected | `cover_losses` | Round 4: never fill from a rejected claim; fills are checked as code's words | proven offline (1:44 and 9:17 now blocked) |
| L8 | 8:56 death (run 2, 3.1) | The record lost the death: the second look said "no death here after all" | Record (second look) | It wasn't the second look: the pass wrote "Game in progress" as a round start at 0:00, so League was taken for no-respawn rounds and 8:56 dropped as a death while dead from 1:48. A lone round start at the opening is no rounds; a death the HUD's death count rose at stays whatever the round says (`playedInRounds`, `aliveInRound` keep) | proven offline (`ledger L8: ...`, on run 2's saved record) |
| L9 | 1:48, 8:56 (loop 40 run 2) | "moved into the river" (she was at the front of the mid wave) | Clip read (place) | The read's own prompt gave "in the river" as its example of a place: now a place is "which lane and how far along it" off the minimap, never from scenery; the video check holds a place to the minimap picture | fixed (a model behaviour; prompts tested, needs a live run) |

## Clash Royale

| # | Loss | What was wrong | First wrong stage | Fix | Status |
|---|---|---|---|---|---|
| C1 | 1:33 tower damage | Not in the record | Record | Round 4: a drop a clip read reports with both numbers becomes a loss (`readDrops`) | proven offline (1979 → 761 at 1:34, from loop 41 run 2's read) |
| C2 | 2:36 tower damage | Not in the record (no read gave both numbers) | Record | `objectives` learn now required to box structures | fixed |
| C3 | 3:27 tower lost, match lost 0-1 | Recorded as "Enemy princess tower destroyed", a point won; every review calls the loss a win | Record (whose structure) | A look at the end screen (one call, only where the pass scored points in a one-on-one game), its result decided in code from what it copied: the banner, the trophies by the player's own name (-24), the winner's banner (THE FRABET), the crowns (`resultOf`); the record's points turned over to fit (`settleResult`). Frame-checked: the player's near-side right tower falls at 3:25, THE FRABET's banner at 3:29.5 | proven offline (`ledger C3: ...`, on run 2's saved record and the frame-checked end screen) |

## Fortnite

| # | Loss | What was wrong | First wrong stage | Fix | Status |
|---|---|---|---|---|---|
| F1 | 2:43, 6:09 falls | Not in the record | Record | Round 4: `hp_bar` guard widened; must fall where the HP number falls | proven offline (exactly 2:43 and 6:09 on the frames) |
| F2 | 6:59 fall (55 → 45) | Not in the record | Record | Where no fight is near (no shot, hit, kill, death, or near-death within 8 s), a drop of 8% that stays down 3 s is damage; a level must hold (no one-frame spike) (`barDamage` quiet) | proven offline (`ledger F2: ...`, on the bar read off the recording: exactly 2:43, 6:09, 6:59) |
| F3 | 7:30 shield 98 → 24 | Not in the record | Record | The shield bar read as a second series beside the health bar in a shooter (`secondBar`); falls that run on are one | proven offline (`ledger F3: ...`, on the recording's crops: 7:27.5-7:34 100% to 24%, none of the early flickers) |
| F4 | 7:43 death | Fix says "heal to full": they had no heals | Coach | A better resting on a consumable nothing read at that loss shows is asked about once, then its clause is taken out (`unheldResource`, `dropResourceClause`) | proven offline (`ledger F4: ...`, on run 1's saved fix and read) |
| F5 | 7:43 death | "the 1v1 fight", "the final opponent": 4 players were left | Clip read | Who was left, from the screen's own words (YOU PLACED #4, N PLAYERS REMAINING) as a fact for the claim check, and a last-duel claim goes against it in code (`playersLeft`, `soloAgainst`) | proven offline (`ledger F5: ...`, on run 1's saved claim and screen text) |

## Brawl Stars

| # | Loss | What was wrong | First wrong stage | Fix | Status |
|---|---|---|---|---|---|
| B1 | all | No player name learned, so each read followed a different brawler | Learn, then clip reads | Round 4: every read is told the camera follows the player; the centered character decides | fixed |
| B2 | 1:10, 2:58 deaths | Not in the record; the reads had "goes down" and "Following:" | Record | Round 4: narrated deaths become candidates for the second look | proven offline (both deaths from loop 41 run 2's reads) |
| B3 | 2:58 death | The video check said he "is seen surviving" | Video check | A fact of the player's death the record checked in code at that moment is the record's, not the video's (it watched the teammate the camera followed); the claim still needs a fact the video shows | proven offline (`ledger B3: ...`, on run 1's saved send-back) |
| B4 | 0:38 near-death | Not in the record | Learn (health box) | The learn call boxes a health bar over the character with its number, not the name above it (run 1's box sat on the sand and the start of "PANDA YT", frame-checked) | fixed (a model behaviour; prompt tested, needs a live run) |

## Chess

| # | Loss | What was wrong | First wrong stage | Fix | Status |
|---|---|---|---|---|---|
| H1 | 15.Bc3, 18.Nf4 | Not cited | Finish (turning points cut by time) | Round 4: the 6 turning points at the costliest losses are checked; engine fills for uncovered blunders | fixed |
| H2 | 26.Rf1 | Not cited (8th by engine loss, outside the top 6) | Cover | In chess the cover asks after the eight costliest moves (`CHESS_COVER_N`) | proven offline (`ledger H2: ...`, on run 1's saved record and cites) |
| H3 | 16.Qd3 | "losing the queen": the engine's gain is a pawn and the attack | Coach | The engine's line played out (`lineGain`) is in each graded move's text and on the event; a material claim it says otherwise of goes against, in code (`lineContradicts`) | proven offline (`ledger H3: ...`, run 1's claim against the line) |
| H4 | 2.f4 | Fix "Play d4 or e4": e4 was already played; the engine's move is exd5 | Coach (fix) | A chess cite's better that doesn't name the engine's move gets it written in, marked betterBy engine (`chessBetter`) | proven offline (`ledger H4: ...`, on run 2's saved turning point) |
| H5 | moves 16-22 | Clock read 9:43, 9:51, 9:05, where it was lower | Record (clock read): the root cause was `V.grab` returning frames in time order while `readHud` read them in the order asked (graded moves are asked by cost), so each move got another move's clock | `V.grab` returns frames in the order asked (also fixes the second look's, the minimap's, and the ability icons' frames, read by position); misreads that still rise are left out (`steadyClocks`) | proven offline (`ledger H5: ...`, on run 1's saved clocks) |

## Rainbow Six Siege

| # | Loss | What was wrong | First wrong stage | Fix | Status |
|---|---|---|---|---|---|
| S1 | 8:38 near-death | Ammo "21/89", "10/89": one weapon's magazine with the other's reserve (the rifle 0/89, the pistol 21/100) | Clip read and `factor_refs` | Each slot's magazine and reserve read as a pair, the slot in hand named; a claim mixing slots goes against (`C.mixedAmmo`) | proven offline (21/89 against 0/89 and 21/100 goes against) |
| S2 | 8:38 near-death | "facing away from the incoming enemy approach": false, and it passed both checks | Closing call (salvage) | It came from a salvage's closing note, checked only against the read it came from: closing notes now go through the video check; first person faces what's on screen | proven offline (the note is left out) |
| S3 | 8:38 near-death | The empty rifle, not reloaded, never named | Clip read | `state_facts` ammo (needs S1) | fixed (with S1) |
| S4 | 8:39 (run 1) | The cite was sent back against "100 of 100 at 8:36" | Record check | L1's rule | proven offline |
| S5 | 8:58 death | "equal numbers": it was 2 v 3 | `state_facts` alive count | Round 3: kill-feed sides and score rounds | proven offline (2 v 3 on loop 40's record) |

## Rocket League, Marvel Rivals, Valorant (from loop 40; loop 41 was spoiled by quota)

| # | Loss | What was wrong | First wrong stage | Fix | Status |
|---|---|---|---|---|---|
| R1 | 4:15 goal against | Record flipped every goal: learned the opponent's name and the wrong side | Learn, then record | The player's own scored goal sets their side | fixed |
| M1 | 4:17 near-death | The right "157/250" was sent back against a read's 70/250 at 4:18 | Record check | L1's rule | proven offline |
| M2 | 4:27 death, 1:19 | "abilities on cooldown": one ready, one on 1 s | Clip read | Where code can't split the row, the read is told nothing is known of it and to say ready or on cooldown only where the icon shows it plainly (`abilityUnknown`); the split itself still can't take Rivals' row | proven offline (`ledger M2: ...`; the recording's Rivals crops give the same "split into 1 icons, which isn't sure") |
| V1 | 0:41 death | "Held a static angle": he walked in and fired on the move | Clip read (movement) | A code fact under state_facts in first person: the view moving or still over the last 2 s, off the scene at the screen's sides (`viewMotion`) | fixed (unit-tested on synthetic frames, `ledger V1: ...`; no Valorant recording here to replay it on) |
| V2 | 0:41 (run 1) | The right "while holding W" was sent back against a read's "stood completely still" | Record check | Round 4: a read's words can't contradict | fixed |
| V3 | 2:17 death | "2v3" (2 v 1), "with a pistol" (the Outlaw), "enemy utility" (his own flash) | Clip read and `state_facts` (the feed missed a kill) | The read names the weapon only by the HUD's weapon icon or slot, and takes an effect as the player's only where their own icon dims; the alive count from a missed feed kill is not fixed | fixed in part (prompts tested; the missed feed kill is open: no Valorant recording here) |
| V4 | 6:15 death | Sent back: the frames check said he "used the Blindside flash"; he ran in with his knife out | Video check | The video check: a cast is the player's only where their own ability icon dims as it's cast; running in with a knife out isn't one | fixed (a model behaviour; prompt tested, needs a live run) |
| V5 | 4:15, 4:57, 6:15 | The ult ready and unused, never named | Clip read | `ability_state` (untested on Valorant) | fixed |

## The critique video (from watching the exported Siege critique)

| # | What was wrong | Cause | Fix | Status |
|---|---|---|---|---|
| U1 | A 20 s pause (0:22 to 0:38): one frozen frame with "First, at 8 38." | The next line's voice was still being made, and nothing played while it waited | Every line made before playback; a span keeps looping while its line runs | fixed, but see U4 |
| U2 | The talking sounded robotic: stat lists ("25 bullets in the mag and 20 in the secondary"), times read out ("8 38") | The finding's written lines read word for word | A spoken script from one Flash-Lite call, checked in code (no new numbers, at most two a moment, no times), saved with the review; fallback lines read no times | fixed, not yet heard (needs quota for the script call) |
| U3 | The marked picture circles 100/100 where the critique says 19/100 | The mark is drawn on the frame at the cited moment (8:38), before the health dropped (8:38.9) | open: draw a number mark on the frame where the record read that number, or check the digits first | fixing |
| U4 | The saved video shows the ready card for about 70 s (0:06 to 0:78) | Recording starts before every line is made; making 4 lines took about 75 s | open: record only after all lines are made; make the voice when the report first shows | fixing |
