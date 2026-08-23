# Playtest findings (batch simulation, 2026-08-23)

Method, results, and follow-up questions from the first large-sample playtest
of the THRESHOLD prototype, run against the tuning currently in
`src/config/constants.ts` (`DECAY_TURNS_N=3`, `ON_SUIT_RATIO=0.45`,
`ROOM_MIN/MAX_ENEMIES=1/3`, `RUN_MAX_DEPTH=10`, `PLAYER_HP_MAX=30`). If those
constants change, these numbers need re-running, not just re-reading.

## Method

Two tools now exist for playing THRESHOLD without the UI, straight against
`runEngine`/`combatEngine`:

- **`scripts/playtest.ts`** -- an interactive, one-command-per-decision CLI
  (state persists in `.playtest-state.json` between invocations) for a human
  or an agent to actually play a room and give qualitative impressions. This
  is how the single-room, seed-777, "died to a 3x Wolf-kin room" playthrough
  earlier in this session was produced.
- **`scripts/playtest-sim.ts`** -- a batch simulator: a heuristic bot plays
  full 10-room runs start to finish, and the run instruments outcomes for
  statistical questions a single playthrough can't answer. This document is
  built from that tool, run at `n=500` seeds (1-500) under two different bot
  profiles (see Caveats).

Reproduce with:
```
npx tsx scripts/playtest-sim.ts 500 1                       # aggro profile
PLAYTEST_PROFILE=defensive npx tsx scripts/playtest-sim.ts 500 1
```

### Bot policy (and its limits)

The bot is a greedy, always-use-your-whole-matching-hand claimer: each play,
it scores every legal claim (lethal kills first, then focus-fire the
lowest-HP enemy, guard/heal weighted by HP-need, hex/venom/vigor at a modest
discount) and takes the best one, across as many plays as it has. Two
profiles were run -- **aggro** (current default weights) and **defensive**
(guard/heal weighted 2.5-3x higher, taken much earlier) -- specifically to
check whether the headline lethality finding below was a bot-skill artifact.
It wasn't: the two profiles produced nearly identical outcomes (see
Finding 1), which is itself informative -- see that finding's discussion.

**What the bot does not model**: deliberately baiting a pile into decaying
(for its untargeted-but-free group effect) instead of claiming it. The
design doc raises this as a real strategic option; this bot never takes it,
so every decay event in this data is "decay from being unable to act,"
not "decay chosen on purpose." The decay-related numbers below should be
read as a lower bound on how often decay *could* matter, not a measurement
of decay-as-strategy.

## Headline results (n=500 runs per profile, seeds 1-500)

| | Aggro | Defensive |
|---|---|---|
| Runs completed (reached depth 10) | 0 / 500 | 0 / 500 |
| Avg depth reached (of 10) | 1.24 | ~1.2 |
| Avg rooms cleared before death | 1.24 | ~1.2 |

Zero wins in 1,000 total simulated runs across two meaningfully different
playstyles.

## Finding 1 -- Room lethality is dominated by enemy count, not by play skill, and the cliff is steep

Room clear rate, broken out by how many enemies were in the room (aggro
profile; defensive profile matched within 1-2 points on every cell):

| Enemies in room | Rooms seen | Clear rate | Share of all deaths |
|---|---|---|---|
| 1 | 394 | **91.4%** | 6.8% |
| 2 | 371 | **60.6%** | 29.2% |
| 3 | 357 | **10.4%** | 64.0% |

Enemy count is rolled uniformly 1-3 per room (`ROOM_MIN/MAX_ENEMIES`,
`roomGenerator.ts`'s `pickEnemies`) with **no floor-depth scaling** -- a
3-enemy pack is exactly as likely on the first room of a run as the ninth.
Combined with the near-identical aggro/defensive results, this reads as a
structural cliff, not a skill or tuning-around-the-edges issue: three
enemies attacking every round (up to ~12-18 combined damage against a flat
30 HP pool, per Finding 4) overwhelms the player's tools almost
regardless of how they're played. 64% of all deaths in this dataset
happened specifically in a 3-enemy room, despite those rooms being only
~1/3 of all rooms encountered.

This is the same instinct as the single manually-played room earlier this
session (3x Wolf-kin, dead by turn 17) -- the batch data says that wasn't
an unlucky seed, it's close to the median outcome for that room shape.

**Relative to the design doc's stated success criteria** ("does letting a
pile decay create a meaningful claim-now-vs-wait tension," "do enemies read
as learnable threats") -- this finding suggests the room-to-room variance in
enemy *count* currently swamps whatever signal comes from individual enemy
patterns or claim-timing decisions. A run's survival looks far more
determined by "how many 3-enemy rooms did I draw" than by how well any
single room was played.

## Finding 2 -- Legal-claim "dead hand" turns are the norm, not the exception

**52.5% of all player turns (2,975 / 5,668) had zero legal claims at all**
-- not "nothing worth doing," but no hand card matched anything left in the
pool, full stop. (A further 1.6% had legal claims but none worth taking --
e.g. an overheal at full HP -- which is a normal, healthy kind of "pass.")

The mechanism: `performClaim` (`combatEngine.ts`) removes an *entire* suit's
pool cards on a single claim, but the hand fully redraws every turn
(`HAND_REDRAW_EACH_TURN`) from the same fixed suit-ratio weighting
(`ON_SUIT_RATIO` etc.) regardless of what's actually still in the pool. A
small room has as few as 6 possible suits; two or three claims can empty
most of them in the first couple of turns, and the dry-pool refill only
fires once *every* suit (including tiny leftover boon/guard/status piles)
has decayed away -- which takes up to `DECAY_TURNS_N` (3) full rounds. In
that gap, the hand keeps dealing cards the pool has nothing to match.

This is the flip side of the replenishment question that started this
session: the current design already has a real "hand outruns the pool"
failure mode, just from decay-driven scarcity rather than the reverse. A
partial per-round top-up (the smaller variant floated earlier, not the
full per-round replenish) looks like it would directly attack this number,
worth prototyping as a targeted experiment.

## Finding 3 -- Duplicate enemies never desync; a same-type pack is one enemy with N x output, not N learnable threats

Across 1,435 same-defId multi-enemy comparisons (every completed enemy round
in every multi-copy room across both profiles), **patternIndex was
identical across all copies of a def, 100% of the time (0 violations)**.
Chasing down the two apparent counterexamples the naive version of this
check found confirmed why: enemies only ever miss a turn when the round is
truncated by the player's death, never from an in-game divergence -- there
is no live mechanism (in the current build) that lets two same-def enemies
drift out of step while both remain alive into a following round.

Practically: three Wolf-kin in a room don't present three independent
patterns to read and play around -- they present one pattern, telegraphed
and resolved three times a round in perfect lockstep (e.g. all three
banking Strength on the same beat, then all three attacking boosted on the
next). This compounds directly with Finding 1: a 3-enemy room isn't "three
threats," it's one threat at roughly 3x the damage output of a 1-enemy
room, with no additional tactical texture from having three instead of one.

## Finding 4 -- Decay's "hits everyone" symmetry advantages whoever has more bodies in the room

Across 1,891 decay events, an average of **1.61 enemies** were alive to
receive the same boon/guard/status/threat tick the player received once. In
a 3-enemy room specifically, that means a decaying boon or guard pile heals
or shields up to 3 enemies simultaneously for every 1x the player gets --
by design (`tickDecay`'s doc comment explicitly frames decay as "untargeted
... can help enemies as easily as hurt them"), but the batch data shows this
asymmetry scales directly with the same enemy-count variance driving
Finding 1, compounding it rather than offsetting it.

## Finding 5 -- Banked Guard is usually lost, not spent

Of 604 Guard claims, 324 (54%) ended in a `guard-fade` event with an average
of 1.86 Guard still unspent at the moment it faded (against an average
banked amount of only 1.73 per claim) -- i.e., on a typical fade, close to
the *entire* claimed amount evaporated unused. Guard fully resets at the end
of every full enemy phase (`endTurn`'s guard-fade handling) regardless of
whether an attack ever came to absorb it, so a Guard claim is a bet on
"something will hit me before this round ends" that, per this data, loses
more often than it pays off. (This held under the defensive profile too,
which claims Guard far more eagerly -- more Guard banked did not mean more
Guard used, since the fade timing is fixed, not usage-dependent.)

## Finding 6 (a positive result) -- The multiplicative "big spike" moment is real and reasonably frequent

Of 3,646 threat claims, 33.9% dealt 8+ damage in one claim and 15.4% dealt
12+ (against enemies with 14-22 max HP) -- i.e., roughly one in three or
seven threat claims is the "big hand meets big pile" spike the design doc
names as the core intended feeling (Section 4, "Claim formula"). Whatever
else needs tuning, this specific success criterion looks like it's already
landing.

## Suggested next experiments

None of these are prescriptions -- just what this data points at as worth
trying next, roughly in order of likely impact:

1. **Cap or weight down 3-enemy rooms**, or scale enemy count with floor
   depth instead of rolling it flat 1-3 everywhere -- Finding 1 is the
   single largest lever on survivability in this dataset.
2. **Make the hand redraw pool-aware**, or add the smaller partial-refill
   variant discussed earlier this session, to attack Finding 2's 52.5%
   dead-hand rate.
3. If multi-copy enemy packs stay in the game, consider **staggering their
   starting `patternIndex`** so a pack doesn't telegraph and resolve as one
   synchronized blob (Finding 3) -- or lean into the sync as intentional
   "swarm" flavor, but that should be a deliberate call, not a side effect.
4. Re-run this same simulation after any of the above changes -- the harness
   and bot now exist, so before/after comparisons are cheap.

## Caveats

- The bot is a heuristic, not a solver; it never intentionally baits decay
  (see Method). A human playing for that tension specifically might survive
  3-enemy rooms somewhat more often than this data suggests -- but the
  aggro/defensive agreement in Finding 1 suggests skill has a ceiling well
  short of closing a 91%-vs-10% clear-rate gap.
- Door choice uses a simple HP-and-texture heuristic (`pickDoor`), not
  optimal play; it has only a minor effect on outcomes since enemy count is
  rolled independently of the size/texture tags the door exposes.
- All numbers are tied to the current constants; treat this document as a
  snapshot, not a standing spec, per the design doc's own framing of
  "settled enough to build first."
