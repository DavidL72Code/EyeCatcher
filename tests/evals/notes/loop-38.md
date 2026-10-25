## What this loop changed (against loop 37)

- Chess: the coach is told the six costliest graded moves, not the first six in time order.
- League: two learned boxes that overlap no longer swap names (its health bar and ability row had swapped).
- Clip reads answer every factor kind (position, information, resources, numbers, map, mechanics) instead of an optional list.
- The claim checker's clip runs to the loss a moment led to; a death past the clip's end is "can't tell", not "false".
- A spent second key hands back to the first key (Fortnite's three runs had ended "used up on every model").
- A structure taken is the score only in a one-on-one game, never the player's death.
- `drill` and `recheck` are required in `finish`; the scan copy starts early when there's no kill feed; kills only the low-detail pass saw are counted apart.

## Evaluation

- **Chess, better.** Every run cites real blunders (15.Bc3, 16.Qd3, 18.Nf4), against only 2.f4 in loop 37. The reasons were guessed from the frames and partly wrong (16.Qd3 called "hanging the queen to the queen on c6"; the real line is ...Bc4 pinning it to the knight on e2). Fixed for loop 39: code names the engine's reply and what it takes and attacks.
- **League, record fixed, causes shallow.** 0 kills and 2 deaths in all three runs (loop 37 invented 6 kills and 5 deaths). Both deaths cited, but each cause names about 2 of the baseline's 5-6 factor kinds. The clip reads filled the new factor fields with filler ("13 vs 16", the kill score, as numbers). Fixed for loop 39: each kind gets an exact instruction.
- **Clash Royale, wrong.** Learn named the opponent's clan "HIHIHA" as the player, so the scan called a 0-1 loss a win and no tower loss was cited. Fixed for loop 39: learn says where on screen it read the name, and a far-side name is dropped.
- **Brawl Stars, wrong.** No death found of 2: the health number read 1 just before the first death and the screen then followed a teammate. Fixed for loop 39: a near-zero reading followed by a high one is a death candidate for the second look.
- **Cost.** League's prompt tokens ran to 458k a run, 197k of them images: every HUD box went as its own picture. Fixed for loop 39: one sheet per moment.
- Runs 2 and 3 were near-identical (temperature 0), so loop 39 runs each game twice.
