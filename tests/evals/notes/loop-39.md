## What this loop changed (against loop 38)

Code frozen as `snaps/s39`, all nine clips, 2 runs each, one at a time, nearly every call on 3.5 Flash-Lite (loop 38 ran mostly on 3.1).

- Learn says where on screen it read the player's name; a name read on the far side (Clash Royale's opponent's clan) is dropped.
- Each factor kind in a clip read has its own exact instruction; a cause must name every true factor with its number.
- A moment's HUD boxes go as one sheet, not a picture each.
- A health number at a sliver, then high again, is a death candidate (Brawl Stars).
- Chess: each graded move says what the engine's reply takes and attacks (pins and skewers included), and the engine's own move is never graded.
- The "you named a character nobody saw" send-back is asked once.

## Evaluation

- **Better:** Rocket League run 1 matches the baseline (committed forward with the defensive half empty, 2-0 with 1:10 left, 42 boost). Valorant run 1 cites 3 of 5 deaths with 3-4 factor kinds each. Brawl Stars now finds both real deaths (1:11 and 2:59). Fortnite completes (the quota fix) and run 2's cause at the final fight matches (45 health, open ground). Chess run 2 explains its blunders from the engine ("walking into Bxf4+", "allowing Bxa6").
- **Still wrong:**
  - Clash Royale was learned as spectator footage, so it was read play by play with no side for the player and called a win (fixed after the loop: the player's own controls on the HUD mean their own screen).
  - Brawl Stars counted two deaths while the player was already dead and watching a teammate (fixed, flag `spectate_deaths`).
  - Chess run 1 cited small opening mistakes (fixed: a finding must show at least one of the four costliest moves).
  - League's causes quote health at the death, not at the decision.
  - Siege misses the empty magazine.
  - Valorant run 2 cited no loss and cost 792k prompt tokens and 30 calls (over the 25 cap): its record had 13-14 teammate deaths, each a window.
- **Cost:** League, Valorant, Clash Royale and Brawl Stars ran 400k-700k prompt tokens a run, mostly video in the clip reads and the claim check. Loop 40 reads far teammate deaths at low detail (flag `far_downs_low`).
- **Run to run:** runs 1 and 2 differed more than in loop 38 (Valorant 3 of 5 against 0 of 5; League 2 of 3 against 1 of 3). Two runs aren't enough to call a change on one game.
