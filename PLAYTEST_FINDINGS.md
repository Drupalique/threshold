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
- **`scripts/playtest-sim.ts`** -- a batch simulator: a bot plays full
  10-room runs start to finish, and the run instruments outcomes for
  statistical questions a single playthrough can't answer. This document is
  built from that tool. Two player-turn decision-makers are available via
  `PLAYTEST_BOT`:
  - `heuristic` (default) -- a hand-scored greedy function (`pickBestClaim`),
    run at `n=500` seeds (1-500) under two different weighting profiles (see
    Caveats). Most of this document is built from this mode.
  - `llm` -- combat claim/pass decisions go through Claude (Haiku 4.5, via
    `scripts/llmBot.ts`) instead of the scoring function; reward and door
    choices stay on the heuristic pickers regardless. See the 2026-08-23
    "agentic cross-check" addendum below for what this was used to confirm.

Reproduce with:
```
npx tsx scripts/playtest-sim.ts 500 1                       # aggro profile
PLAYTEST_PROFILE=defensive npx tsx scripts/playtest-sim.ts 500 1
PLAYTEST_BOT=llm npx tsx scripts/playtest-sim.ts 25 1        # requires ANTHROPIC_API_KEY
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

## Addendum, 2026-08-23 -- persistent player deck (PERSISTENT_DECK_PLAN.md), Phase 5 revalidation

`PERSISTENT_DECK_PLAN.md` was implemented in response to Finding 2 above: the
player's hand no longer regenerates from the current room's own threat
suits every turn; it's dealt from a persistent, run-level deck (19-card
starter, `STARTER_DECK` in `constants.ts`) that only grows via a 1-of-3
reward pick after each cleared room, reshuffled fresh into a per-room
draw/discard pile at the start of every room. Re-ran the exact same
`playtest-sim.ts` harness at the same scale (n=500, seeds 1-500, aggro and
defensive profiles), extended with a `pickReward` heuristic (prefer
whichever offered suit already has the most live copies in the deck --
doors don't signal reward suits yet, so this is the only signal available
to the bot). Full config unchanged (`DECAY_TURNS_N=3`, `ON_SUIT_RATIO=0.45`,
etc.).

**Caveat on comparability**: `roomGenerator.ts`'s pool/enemy generation was
deliberately left untouched by the plan, but removing the old per-room hand
roll changes how many RNG draws happen before pool/enemy generation for
every room after the first, which shifts *which* rooms/enemies a given seed
produces relative to the original dataset. This is not a perfectly
controlled A/B on that axis. It doesn't explain the results below, though:
the mechanism is directly traceable (see Finding 7), and the aggro/defensive
profiles agree closely with each other in this dataset just as they did in
the original one, which is the same cross-check the original findings used
to rule out "bot skill" as the explanation for Finding 1 -- it rules out
"bot skill" here too, leaving the deck/suit-matching mechanism as the
remaining explanation.

### Headline results (n=500 runs per profile, seeds 1-500)

| | Aggro (before &rarr; after) | Defensive (before &rarr; after) |
|---|---|---|
| Runs completed (reached depth 10) | 0/500 &rarr; 0/500 | 0/500 &rarr; 0/500 |
| Avg depth reached (of 10) | 1.24 &rarr; **0.66** | ~1.2 &rarr; **0.66** |
| Dead-hand turn rate | 52.5% &rarr; **52.3%** | 52.5%\* &rarr; **52.7%** |

\*Original doc reported one combined 52.5% figure across both profiles, not
split; treated as the baseline for both rows here.

**Finding 2's target metric did not move.** The dead-hand rate is
statistically unchanged (52.3-52.7% vs. 52.5%). Worse, **average depth
reached fell by almost half** (1.2 &rarr; 0.66) -- the change this plan was
built to improve survivability made it measurably worse on this dataset.

### Finding 7 -- Exact-suit-matching against a suit-diverse persistent deck under-supplies exactly the suits a given room needs, and the reward bot doesn't yet compensate

Room clear rate by enemy count, this dataset vs. the original (aggro; defensive matched within 1-2 points):

| Enemies in room | Before | After (aggro) | After (defensive) |
|---|---|---|---|
| 1 | 91.4% | **82.9%** | 83.6% |
| 2 | 60.6% | **32.3%** | 31.9% |
| 3 | 10.4% | **1.1%** | 1.5% |

Every band got worse, and the 2-enemy band's clear rate roughly halved. The
multiplicative "big spike" also shrank sharply -- claims dealing 8+ damage
fell from 33.9% to **13.6%** (aggro) / 13.9% (defensive) of all threat
claims, and 12+ from 15.4% to **2.4%** / 2.7% (`bigThreatSpikes` in the raw
output) -- while decay's average-enemies-present (1.62, was 1.61) and the
lockstep check (0 violations, unchanged) stayed exactly where Finding 3/4
left them, confirming claim resolution itself wasn't touched and the effect
is isolated to hand/claim supply, as the plan intended when it said pool
generation and claim resolution were both out of scope.

**Mechanism**: `STARTER_DECK` spreads its 19 cards across all 9 suits (3
each of the 4 threat suits, lighter elsewhere), but a room's pool only ever
draws from 1-2 of those 4 threat suits (`THREAT_SUIT_COUNT_BY_SIZE_BAND`).
Under the old room-generated hand, every hand card was weighted toward
*this room's* actual threat suits by construction. Under the persistent
deck, a 5-card hand drawn from a 19-card, 9-suit deck usually holds cards
for suits this room's pool doesn't even contain, on top of Fork 2's already
known exact-suit-matching risk -- and because claim magnitude is `pool set
size x hand cards played`, fewer *same-suit* cards per hand doesn't just
mean fewer legal claims, it means smaller claims when one does land, which
is exactly what the big-spike drop shows.

**This is precisely the risk PERSISTENT_DECK_PLAN.md's Fork 2 flagged as
needing empirical measurement, not assumed away** -- the plan's proposed
compensating mechanism (make the door-signal system, `SUIT_COLOR_FAMILY`,
give reward/door choices real teeth) is explicitly **not yet wired up**:
`pickReward` in `playtest-sim.ts` only looks at the player's own deck
composition, never at door signals or the upcoming room's threat suits,
because nothing in the current build exposes "what suits does the next
room favor" as a decision input yet. This dataset measures the persistent
deck with that compensating half of the design still missing, not the
design's intended end state.

### What this suggests, roughly in order of likely impact

1. **This isn't a finished result** -- it's a measurement of half a design.
   The plan's own Fork 2 discussion anticipated exactly this gap and named
   the fix (door/reward suit signaling); that follow-up work should happen
   before drawing a final verdict on the persistent-deck direction.
2. **`STARTER_DECK`'s composition is a likely lever** even before door
   signaling lands -- fewer suits or more copies per threat suit (e.g. 2
   threat suits x 5 copies instead of 4 x 3) would raise the odds a 5-card
   hand actually clusters on one suit, directly targeting the big-spike
   drop.
3. **Re-run this exact comparison once door/reward suit signaling exists**
   -- the current numbers are a legitimate baseline for that follow-up, not
   a verdict on the persistent-deck idea itself.

### Guard and decay, for completeness (unaffected, as expected)

Guard fade rate ticked down (54% of claims wasted before &rarr; 44.0%
aggro / 40.1% defensive), consistent with fewer total claims happening
before death, not a mechanic change -- `performClaim`/`tickDecay` were
untouched by this plan and the raw wasted/banked averages per claim are
within noise of the original (banked ~1.6-1.7, wasted ~1.85-1.9 both
before and after).

## Addendum, 2026-08-23 -- agentic cross-check: does a real LLM play differently than the heuristic bot?

Every finding above, including the persistent-deck addendum, rests on one
decision-maker: `pickBestClaim`, a hand-tuned scoring function. The
aggro/defensive weight comparison rules out *that function's specific
weights* as the explanation for a result, but it can't rule out "heuristic
scoring bots in general miss something a real reasoning agent would catch."
To close that gap, `scripts/playtest-sim.ts` gained a third decision-maker:
`PLAYTEST_BOT=llm` routes every combat claim/pass decision through Claude
(Haiku 4.5, chosen as a cheap/fast tier) instead of the scoring function.
Each decision is a single forced tool call (`choose_action`) against a
pre-filtered list of legal claim options the engine already computed
(`getLegalPlayerClaimTargets`) -- the model picks an option index or
"pass," and never has to reconstruct suit-matching/targeting legality
itself. Reward and door choices are unchanged (`pickReward`/`pickDoor`,
still heuristic) -- this only replaces the per-turn claim decision. See
`scripts/llmBot.ts` for the prompt/tool definition.

**Validation, not a new statistical claim.** Three runs at increasing scale
(n=1, n=10, n=25, all starting at seed 1 -- each later run's seed range
strictly contains the earlier ones', so treat n=25 as the dataset, not
1+10+25=36 independent samples) confirmed the harness itself works before
trusting any numbers from it: **0 fallback-to-pass events across 418 total
API calls** (14 + 124 + 280) -- every single tool call returned a
parseable, in-range choice. Reasoning text read as genuinely
situation-aware, not templated: it consistently focus-fired the lower-HP
enemy of a pair, finished off nearly-dead enemies before switching targets,
and reached for Grace/Ward specifically when HP dropped into the
single digits -- e.g. *"With very low HP (5/30), claiming Grace to heal
myself is critical for survival before dealing with the Ember Wretch
threat."*

### Head-to-head, same 25 seeds, same room/enemy generation

Ran the heuristic (aggro) bot over the identical seed range (1-25) for a
matched comparison -- both bots faced literally the same rooms, pools, and
enemies, only the claim/pass decision differs:

| | Heuristic (aggro) | LLM (Haiku 4.5) |
|---|---|---|
| Avg depth reached (of 10) | 0.56 | 0.52 |
| Dead-hand turn rate | 58.0% | 57.8% |
| Death causes | attack 22, decay 3 | attack 23, decay 2 |
| Big threat spikes (8+ dmg / 12+ dmg, of threat claims) | 14/126 (11.1%) / 2/126 (1.6%) | 14/123 (11.4%) / 2/123 (1.6%) |
| Guard banked (avg) / wasted on fade (avg) | 1.41 / 1.39 | 1.26 / 1.29 |
| Clear rate, 1-enemy rooms | 71.4% (10/14) | 71.4% (10/14) |
| Clear rate, 2-enemy rooms | 30.8% (4/13) | 23.1% (3/13) |
| Clear rate, 3-enemy rooms | 0% (0/12) | 0% (0/11) |

**The two decision-makers are statistically indistinguishable on this
sample.** Every metric lands within a couple of percentage points or a
single event of the other, including the 1-enemy clear rate matching
*exactly*. This is a materially stronger check than the aggro/defensive
weight comparison the original findings relied on: those two profiles are
still the same scoring function with different coefficients, so agreement
between them only rules out "the specific weights are the problem." A
from-scratch, natural-language-reasoning agent landing on the same
survival curve rules out "heuristic-bot-shaped blind spots" as the
explanation too.

**What this confirms about the earlier findings:** Finding 1's enemy-count
lethality cliff (1-enemy rooms clear roughly 5-7x more often than 3-enemy
rooms, in both this dataset and the original n=500 one) and the persistent-
deck addendum's Finding 7 (dead-hand rate parked at ~52-58% regardless of
who's playing) are not artifacts of a specific bot's scoring quirks. Three
qualitatively different players -- two tunings of a greedy scorer, and an
LLM reasoning per-turn in prose -- converge on the same shape. That raises
the confidence that these are structural properties of the current tuning
(flat 1-3 enemy count with no depth scaling; a suit-diverse persistent deck
under-supplying a room's specific 1-2 threat suits), not a "better play
would fix it" gap.

### Caveats

- **n=25 vs. the n=500 heuristic baseline.** This is a directional
  cross-check, not a like-for-like statistical comparison -- treat the
  table above as "these two agree closely on a shared sample," not as a
  standalone n=25 result to cite on its own.
- **One LLM "profile."** No aggro/defensive-style variant was run for the
  LLM bot; unclear whether prompting it toward a specific playstyle would
  shift results the way the heuristic's profiles didn't.
- **Reward/door choices are still heuristic even in `PLAYTEST_BOT=llm`
  mode.** This cross-check says nothing about whether an LLM would engage
  with the persistent-deck addendum's missing "door/reward suit signaling"
  compensation any better than `pickReward`'s simple deck-count heuristic
  does -- that's a distinct, not-yet-tested question.
- **Sequential API calls.** Each decision is one real network round-trip
  (~1.4s/call observed); n=25 (280 calls) took ~6.5 minutes wall-clock.
  Scaling this to n=500 for a true apples-to-apples sample against the
  heuristic baseline would take roughly two hours sequentially -- worth
  parallelizing before attempting it.
- **Cost was trivial** at Haiku 4.5 pricing (order of $0.30 across all
  three validation runs combined, by rough estimate -- exact token usage
  isn't logged yet).

## Addendum, 2026-08-23 -- depth-scaled enemy count + staggered duplicate patterns (Priorities 1-2)

Implemented the top two items from this document's "suggested next
experiments": `roomGenerator.ts`'s `pickEnemyCount` now weights the 1/2/3
enemy roll by floor instead of rolling uniformly everywhere (blending
`ENEMY_COUNT_WEIGHTS_EARLY` -> `ENEMY_COUNT_WEIGHTS_LATE` across floor
1..`RUN_MAX_DEPTH`, `constants.ts`), and same-defId duplicate enemies now
start at staggered `patternIndex` offsets (0, 1, 2... mod that def's
pattern length) instead of all starting at 0, directly targeting Finding 3's
lockstep. Re-ran the same `playtest-sim.ts` harness (n=500, seeds 1-500,
both profiles) on top of the persistent-deck build these findings already
reflect -- Finding 7's suit-diversity issue is **not** addressed by this
change and is still live underneath these numbers.

| | Aggro (before &rarr; after) | Defensive (before &rarr; after) |
|---|---|---|
| Avg depth reached (of 10) | 0.66 &rarr; **1.44** | 0.66 &rarr; **1.48** |
| Dead-hand turn rate | 52.3% &rarr; 53.2% | 52.7% &rarr; ~53% |

Both profiles agree closely with each other post-change (1.44 vs. 1.48),
the same cross-check the original Finding 1 relied on to rule out bot skill
as the explanation. Average depth more than doubled, and now exceeds even
the original pre-persistent-deck baseline (1.24) -- despite Finding 7's
under-supply problem still being fully present. Room clear rate by enemy
count (aggro), for reference against Finding 1's original table:

| Enemies in room | Original (flat 1-3) | After (floor-scaled, aggro) |
|---|---|---|
| 1 | 91.4% | 76.1% (n=849) |
| 2 | 60.6% | 25.2% (n=302) |
| 3 | 10.4% | 0% (n=71) |

These per-band numbers aren't directly comparable to the original table --
the whole point of the change is that a given band's rooms are no longer
drawn uniformly across all floors. 1-enemy rooms now include ones the
player reaches only after surviving several earlier rooms (worn down, less
HP), and the 71 3-enemy rooms seen are concentrated on deep floors by
design, which is why 3-enemy clear rate reads as 0% here rather than an
improvement -- the dataset's *floor distribution* changed, not just the
band's difficulty. The metric that actually matters -- overall run
survival -- more than doubled, which is the change's actual goal.

Dead-hand rate is essentially unchanged (Finding 2/7 remains unaddressed,
as expected -- neither change touches hand/pool supply). Lockstep check:
100% of same-defId multi-enemy comparisons now show *divergent*
`patternIndex` (was 0% divergence, i.e. 100% synced, before this change) --
confirms the stagger is taking effect as intended.

**Next up per the original priority list:** Priority 3 (retune
`STARTER_DECK` toward fewer, deeper suits) to address Finding 7, which is
still fully live in this dataset and is likely suppressing how much further
depth could improve from here.

## Addendum, 2026-08-23 -- "feed the pool" exercised via the LLM bot, n=10, first look

`playtest-sim.ts`'s heuristic bot has no feed heuristic and wasn't given
one -- `pickBestClaim` is unchanged, so it never feeds. To actually exercise
the new mechanic (design doc 4.11), `llmBot.ts` and `playtest-sim.ts` were
extended so `PLAYTEST_BOT=llm` offers feed options alongside claim options
in the same indexed choice list. Ran `PLAYTEST_BOT=llm npx tsx
scripts/playtest-sim.ts 10 1` (Haiku 4.5, seeds 1-10) on top of the current
build (Priorities 1-2's depth-scaled enemy count + staggered patterns
already landed). **Treat this as a first directional look, not a verdict**
-- n=10 is far below the n=500 heuristic baselines elsewhere in this
document, single model, single prompt, one seed range. 0 fallback-to-pass
events across all 277 LLM calls -- the harness held up.

### Headline: dead-hand turns nearly vanish, but decay becomes the second-most-common killer

| | Before feed (heuristic, n=500, this doc's earlier addendum) | With feed (LLM, n=10) |
|---|---|---|
| Dead-hand turn rate | ~52-53% | **4.7%** (7/149) |
| Death causes | attack (dominant), decay ~7-8% of deaths | attack 6, **decay 4 (40% of deaths)** |
| Avg depth reached | 1.44 (aggro, same build) | 1.1 (n=10, high variance) |

The dead-hand collapse is exactly what feeding was built for (Findings 2/7):
of 270 total claim-or-feed decisions across the 10 runs, 119 (44%) were
feeds -- the model reached for feed constantly, not as a rare fallback, and
turns with literally nothing legal to do dropped from roughly half of all
turns to under 5%.

**But decay's share of deaths jumped roughly 5x**, and the mechanism is
directly traceable to feed's own documented risk (`MECHANIC_BRAINSTORM.md`'s
"built-in risk" section, design doc 4.11): feeding does not pause or reset
`decayCounters`, so a pile the model fed up over several turns and then
didn't return to claim decays at its full grown size -- unmultiplied, but
now hitting a bigger number than a same-suit pile would have reached
without feeding, and (per Finding 4) hitting every alive enemy too, not just
the player. The reasoning log shows the model treating "feed toward a
bigger future claim" as close to a default action whenever nothing looks
immediately great, including several times at single-digit HP ("Feed Ward
to build guard pool for survival -- with only 2 HP remaining..." -- which
does nothing to protect *this* turn) -- it doesn't yet weigh the decay clock
against how many turns are actually left before `DECAY_TURNS_N` (3) expires
that specific pile.

### What this suggests

1. **Feed working as an escape valve for dead hands is confirmed, at least
   directionally** -- the 52% -> 4.7% swing is large enough to survive this
   small a sample even as a rough signal, and it's the exact number the
   mechanic was built to move.
2. **The decay-death jump reads as a real tuning gap, not a fluke of one
   model's prompt.** The mechanism (grown-then-abandoned piles decaying
   bigger) is structural, not a haiku-specific mistake -- any decision-maker
   that feeds opportunistically without tracking each pile's own decay
   countdown will hit this. Worth a follow-up run instrumenting *which*
   piles decay after being fed vs. never fed, to size the effect precisely
   rather than inferring it from the death-cause split alone.
3. **Candidate mitigations, not yet tried:** prompt the bot (and eventually
   a human-facing UI cue) with each live pile's remaining decay countdown
   specifically when a feed option is offered, so "should I feed or
   reclaim this turn" has the countdown in view the way a human playing off
   the UI's own "decays in N" tag already would; or reconsider whether
   feeding should reset/pause that pile's own decay counter (a real design
   option the brainstorm doc's open questions didn't rule out, just didn't
   pick).
4. **Re-run at n=25-50 once any mitigation lands**, matching the scale the
   original LLM cross-check used, before treating either number above as
   settled.

### Caveats

- n=10, one model (Haiku 4.5), one prompt, seeds 1-10 only -- this is a
  smoke test with real signal in it, not a statistically powered result.
- The heuristic bot still can't feed at all, so none of the large n=500
  baselines elsewhere in this document include feed's effect on any metric
  -- every heuristic number in this file predates the mechanic.
- Avg depth reached (1.1) looks lower than the same-build heuristic baseline
  (1.44) but n=10 vs n=500 makes that comparison unreliable on its own;
  don't read a regression into it without a larger sample.
