# THRESHOLD Prototype — Status

_Last updated: 2026-08-23. Companion to `threshold-prototype-design.md` (the design doc, source of truth for intent/scope) — this file records what's actually built, where it currently diverges from that doc, and how to pick the work back up._

## Running it

```
npm install       # first time only
npm run dev        # dev server at http://localhost:5173/
npm test            # vitest, engine layer only (33 tests)
npx tsc -b            # typecheck
npx eslint .            # lint
```

No build/deploy step exists or is needed — this is a local-only playtest build. No persistence: reloading the page loses the run.

## What's implemented

Full v0.1 scope from the design doc's Section 6, with the room-opponent model replaced wholesale by Section 4.7 (enemies, not a room hand) partway through playtesting:

- **Player-side Earthquake combat, unchanged from the original design:** shared pool, player hand (5 cards, redrawn each of the player's turns), multiplicative claim formula (`pool set size x hand cards played`), threat/boon/guard suit effects.
- **Enemy-based opposition (design doc 4.7):** each room holds 1-3 individually-tracked enemies drawn from a small static roster (`src/config/enemies.ts`), each with its own HP pool and a **fixed, repeating ability pattern** (Attack / Guard / Heal / Debuff / Poison / Strength / Corrupt) telegraphed one step ahead. Enemies never draw a hand or claim from the pool -- claiming is exclusively a player action.
- **Unified status-effect framework:** Weaken, Strength, and Poison are stack counts on a shared `StatusBag` (`src/types/status.ts`, `src/engine/statusEffects.ts`) held by the player or any enemy instance, decaying by 1 stack per holder turn -- see "Status effects" below.
- **Player-facing status suits (design doc 4.9's carried-forward next step, now built):** Hex and Venom claims inflict Weaken/Poison stacks on a chosen enemy the same way a threat claim deals damage to one; Vigor claims grant the player Strength stacks the same way Grace heals -- see "Status suits" below.
- **Pool piles and enemies are decoupled (design doc 4.8):** enemies carry no suit at all. A room's pool draws from `RoomParams.threatSuits`, chosen independently of which enemies are present (currently keyed off the room's size band -- 1 threat suit for a small room, 2 for a large one). A threat claim can be aimed at **any** alive enemy regardless of suit (prompted in the UI whenever 2+ enemies are alive, not just when duplicates share a suit). A room clears when every enemy's HP has independently reached 0.
- **Decay redesign:** a pile left unclaimed for `DECAY_TURNS_N` turns no longer applies a flat Player HP penalty. It resolves its own suit's effect at magnitude equal to just its own pile size (no hand-card multiplier), landing on **every entity in the room** -- the player and every alive enemy alike. A decaying threat pile hurts everyone; a decaying boon pile heals everyone, enemies included; a decaying guard pile shields everyone. This is what makes claiming meaningfully better than waiting: only a claim lets you pick a target and multiply the effect.
- Floor-gated enemy eligibility (`EnemyDef.minFloor`) -- the "harder enemies appear as floors increase" knob, selection currently uniform among eligible defs (see Open threads).
- Placeholder door system: size + color + texture tags, each independently rolled against the real next room at a 75% correlation rate. Texture now correlates with "does this room contain a Corrupt-capable enemy" (previously: presence of a random pool-embedded surprise card, which no longer exists).
- Linear 10-room run, win/loss end screens with a trailing log, restart.
- 9 suits (4 threat: Wolf/Ember/Rot/Spider, 1 boon: Grace, 1 guard: Ward, 3 status: Hex/Venom/Vigor), data-driven in `src/config/constants.ts`.

Architecture: pure, framework-free engine (`src/engine/`) driving a thin React reducer bridge (`src/state/RunContext.tsx`) and a component UI (`src/ui/`). See the file tree in-repo for the full module breakdown.

## Enemy roster (`src/config/enemies.ts`)

Four `EnemyDef`s for the prototype's placeholder scope (design doc Section 6's taxonomy note). Enemies carry no suit (design doc 4.8) -- their kit is entirely the HP/pattern below, independent of whatever threat suits the room's pool happens to draw. All magnitudes are first-cut numbers, not confirmed by playtesting.

| Enemy | HP | Min floor | Pattern (fixed cycle) |
|---|---|---|---|
| Wolf-kin | 14 | 1 | Attack 4 -> Corrupt (force-discard) -> Attack 4 -> Strength 3 |
| Ember Wretch | 16 | 1 | Attack 3 -> Corrupt (block-suit) -> Attack 5 |
| Rot Husk | 18 | 2 | Debuff 3 (Weaken stacks) -> Attack 4 -> Heal 4 |
| Spider Broodmother | 22 | 3 | Corrupt (add-cards) -> Attack 6 -> Poison 4 -> Guard 6 |

Wolf-kin's old Guard 5 step became Strength 3 (demonstrates the Strength status) and one of Spider Broodmother's two Attack 6 steps became Poison 4 (demonstrates the Poison status) -- see the "Status effects" section below. Both are first-cut substitutions, not a balance pass.

## Status effects (`src/types/status.ts`, `src/engine/statusEffects.ts`)

Weaken, Strength, and Poison are now a single unified framework: a `StatusBag` (stack counts keyed by status) lives on both the player (`CombatState.playerStatuses`) and every `EnemyInstance.statuses`, and the exact same functions (`withWeaken`, `withStrength`, `tickStatuses`) resolve them regardless of who's holding them.

- **Weaken**: knocks `WEAKEN_PCT_PER_STACK` (10%) off an outgoing threat claim/attack per stack, capped at 100%. Previously a single flat fraction the enemy set on the player that unconditionally cleared after exactly one player turn (design doc 4.7's Debuff step); now a stack count that decays by 1 per holder turn instead of vanishing outright, and can in principle land on an enemy (a Weaken-inflicting player tool) exactly as it lands on the player today, since the same function computes both.
- **Strength**: adds `+N` flat damage per stack to an attack's base, before any hand-card multiplier -- for a player threat claim this folds into the pool-set-size term (`(poolSetSize + strength) x handCards`), so it's disproportionately valuable on a small pool set, by design (a deliberate lever for making a bad pool read still matter).
- **Poison**: deals its current stack count as damage to its own holder, then decays by 1 -- a DoT, resolved once per holder turn.

All three decay by exactly 1 stack at the true end of a holder's own turn (the player's turn, or one enemy's dispatched action) -- never per sub-action, matching the existing decayCounters/blockedSuits phase-boundary discipline from design doc 4.7. An enemy that's poisoned to 0 HP by its own tick mid-enemy-phase is kept as a 0-HP "corpse" in `enemies[]` until the round concludes (removing it immediately would desync `activeEnemyIndex` against enemies still owed a turn that round) -- see `combatEngine.ts`'s round-end sweep in `endTurn`.

The enemy side grants these via its pattern (Rot Husk's Debuff, Wolf-kin's Strength step, Spider Broodmother's Poison step); the player side now grants them via the three status suits below.

## Status suits (Hex, Venom, Vigor)

The player-facing mirror of the enemy's own Debuff/Poison/Strength intents, added on top of the status framework above. A claim in one of these suits resolves through `addStacks` exactly like an enemy's own status-granting step does -- same magnitude formula (`poolSetSize x handCards`) as every other suit, just landing in a `StatusBag` instead of as HP damage/healing/Guard.

- **Hex** (category `weaken`) -- targeted like a threat claim: the player picks which alive enemy to inflict Weaken stacks on. No target, no legal claim (see `requiresEnemyTarget` in `combatEngine.ts`).
- **Venom** (category `poison`) -- targeted the same way; inflicts Poison stacks on the chosen enemy, which then deal damage on that enemy's own next turn tick, same as the player's own Poison.
- **Vigor** (category `strength`) -- untargeted like Grace/Ward: grants Strength stacks to the player themself.

None of the three get the claim's own Strength/Weaken bonus (same rule as boon/guard -- see `performClaim`'s `isThreat` gate): inflicting a debuff isn't itself an "attack" the player's own buffs should scale. Each has its own pool/hand draw ratio (`WEAKEN_SUIT_RATIO`/`POISON_SUIT_RATIO`/`STRENGTH_SUIT_RATIO` = 0.08 each, mirroring `GUARD_SUIT_RATIO`'s "rarer than boon" weighting), and each decays symmetrically like every other suit: a Hex/Venom/Vigor pile left unclaimed for `DECAY_TURNS_N` turns grants its stacks to **everyone in the room** (player and every alive enemy alike) at magnitude = pile size, same "hits everyone, untargeted" rule threat/boon/guard decay already followed.

First-cut ratios and suit-to-status mapping, not balance-tested -- see Open threads.

## Deviations from the v0.2 design doc

These came out of playtesting after the initial build and are **not** what the design doc originally specified. They concern the player-side Earthquake mechanics, which haven't changed under the 4.7 rewrite, so all five are still live and accurate. (The room-opponent model itself -- 4.3's dueling room hand -- was not patched via a deviation; it was replaced outright, and the design doc's Section 4.7 has been updated in lockstep to describe what's actually built. See that section rather than this table for the enemy system.)

| # | Doc said | Prototype now does | Why |
|---|----------|---------------------|-----|
| 1 | Hands dealt once at round start, only shrink (4.1/4.3) | `HAND_REDRAW_EACH_TURN = true` -- the player gets a fully fresh hand at the start of each of their turns | User asked to try it, closer to the source card game |
| 2 | A set needs 2+ cards *in the pool* (4.1) | `MIN_POOL_SET_SIZE = 1` -- a single pool card is claimable with 1 matching hand card ("1 on the table, 1 in hand") | User's correction after hitting an unclaimable lone Grace card |
| 3 | (not specified) Pool running dry before all enemies are defeated | No longer ends the room for free -- deals a fresh wave (same enemy-owned weighting) and the fight continues; the room only ends via every enemy's HP reaching 0 or player death | Original placeholder rule was producing "free win" rooms where the player never landed a claim |
| 4 | Suggested starting `ON_SUIT_RATIO` of 0.6 | Tuned down to `0.45` | 0.6 combined with #1 and #2 above was producing frequent one-hit-kills on both sides |
| 5 | (not specified) | End-of-round screen transition now waits `TURN_ANIMATION_DELAY_MS` (600ms) after a lethal/clearing action before switching screens, so the HP/enemy panel visibly animates first | Death/clear was cutting to the next screen before the meters ever visibly moved |

## UI additions beyond the doc's placeholder spec

Small legibility features added during playtesting, not called out in the doc:

- Per-suit **decay countdown** in the pool ("decays in N", turns red at 1) -- reflects deviation #3's decay backstop directly.
- Distinct highlight styles for a selected-but-claimable set vs. a selected-but-not-yet-claimable one (dashed red vs. solid blue border), plus explicit claim-panel messaging ("Not enough X in the pool... / X is blocked this turn").
- Every log entry carries a Player HP / Guard snapshot, shown under the entry text -- visible in both the live combat log and the end-of-run recap. Enemy HP is **not** snapshotted per log entry and updates live/instantly in the enemy panel, unlike the player HP bar's drip-animated reveal -- a deliberate scope cut, not an oversight (see Open threads).
- **Enemy panel** (`EnemyPanel.tsx`) replacing the old face-down "room's hand" indicator: one card per alive enemy showing its HP bar, current Guard (if any), and its currently-telegraphed intent (icon + verb + magnitude, e.g. "⚔ Attack 4").
- **Click-to-target enemy selection:** whenever the selected threat suit has a live pool set and 2+ enemies are alive (pool piles aren't enemy-owned -- see design doc 4.8 -- so *any* alive enemy is a legal target, not just one sharing the pile's suit), every alive `EnemyPanel` card becomes clickable (highlighted border) and clicking one sets it as the claim's target (shown with a "Target" badge), rather than a separate "which enemy?" menu. Auto-resolves silently when there's only one legal target, which is the common case in a 1-enemy room.
- The just-cleared room's full combat log is now shown on the door-choice screen (under the two doors), using the fact that `run.combat` isn't replaced until a door is actually chosen -- gives the player time to review what happened before committing to a door instead of the log vanishing the instant the room clears.

## Current tunable constants

All in `src/config/constants.ts` unless noted, single source of truth:

```
PLAYER_HAND_SIZE = 5
HAND_REDRAW_EACH_TURN = true        # deviation #1
ROOM_POOL_SIZE_SMALL = [6, 8]
ROOM_POOL_SIZE_LARGE = [12, 16]
ROOM_MIN_ENEMIES = 1
ROOM_MAX_ENEMIES = 3
THREAT_SUIT_COUNT_BY_SIZE_BAND = { small: 1, large: 2 }  # design doc 4.8 -- room-type knob for pool variety
ON_SUIT_RATIO = 0.45                # deviation #4 -- single most important balance knob
BOON_SUIT_RATIO = 0.12
GUARD_SUIT_RATIO = 0.08
WEAKEN_SUIT_RATIO = 0.08            # Hex -- see "Status suits" above
POISON_SUIT_RATIO = 0.08            # Venom
STRENGTH_SUIT_RATIO = 0.08          # Vigor
PLAYER_HP_MAX = 30
DECAY_TURNS_N = 3
MIN_POOL_SET_SIZE = 1               # deviation #2
SURPRISE_ADD_CARDS_COUNT = 2
SURPRISE_BLOCK_DURATION_TURNS = 1
WEAKEN_PCT_PER_STACK = 0.1          # see "Status effects" above
DOOR_CORRELATION_RATE = 0.75
RUN_MAX_DEPTH = 10
TURN_ANIMATION_DELAY_MS = 600       # UI pacing only, not engine
LOG_STEP_DELAY_MS = 450             # UI pacing only, not engine

# Enemy roster + magnitudes: src/config/enemies.ts (see table above), not
# constants.ts -- per-enemy stats are authored data, not global knobs.
```

`DECAY_HP_PENALTY` and `ROOM_THREAT_BASE`/`ROOM_HAND_SIZE` from the earlier build no longer exist -- decay magnitude is now the live pile's size (see 4.7), and per-enemy HP replaced the single Room Threat meter.

## Explicitly out of scope (unchanged from the doc)

Full door glyph-field/tree encoding, convergent nodes, artifacts, meta-progression/persistence, narrative framing, real art/sound. None of this has been touched. Tier 2/3 combat (design doc 4.4) is now an open question rather than simply "not yet built" -- see 4.7's closing note in the design doc.

## Open threads for next playtesting pass

- **Enemy selection is uniform, not weighted toward harder defs as floors deepen.** `minFloor` gates *eligibility* but doesn't bias the roll -- a floor-5 room is exactly as likely to serve up a floor-1 Wolf-kin as anything else eligible. Worth a weighting pass once there's more roster to weight across.
- **Enemy stat-block magnitudes (HP, Attack/Guard/Heal numbers) are a first cut**, not yet balanced against the player's claim-formula output at `ON_SUIT_RATIO = 0.45`. Watch specifically whether multi-enemy rooms (2-3 at once) are harder than intended, since Attack damage is no longer capped by a shared meter the way Room Threat used to cap total incoming room damage per round.
- **The decay redesign is unplayed.** Does "a decaying boon pile heals the enemies too" read as an interesting claim-now tension, or just feel bad/confusing the first time it happens to a player? This was a deliberate departure from a flat penalty and hasn't been through a playtest pass yet.
- **The pool/enemy decoupling (design doc 4.8) is unplayed.** The target-picker now fires on nearly every multi-enemy threat claim instead of the rare same-suit-duplicate case -- confirm that's still a lightweight prompt and not friction, and whether "any pile, any target" reads as a clean tactical widening or removes texture from "this pile is this enemy's problem." Also unconfirmed: whether 1-vs-2 threat suits by size band is the right room-type lever, and whether pool suit variety should correlate with the specific enemies present at all (currently fully independent by design).
- **The Weaken/Strength/Poison status framework, and the Hex/Venom/Vigor suits that let the player inflict/grant them, are unplayed.** Open questions: do the 0.08 draw ratios feel right relative to Guard's 0.08 and Grace's 0.12, does a decaying Hex/Venom pile weakening/poisoning *the player too* read as an interesting tension or just feel bad the first time it happens (same open question the boon/guard decay symmetry already raised), and is "no Strength/Weaken bonus applies to a status-suit claim" (the `isThreat` gate) the right call or should the player's own Strength boost how many Weaken/Poison stacks a Hex/Venom claim inflicts?
- **Wolf-kin's Strength swap and Spider Broodmother's Poison swap are unbalanced first cuts**, not confirmed by playtesting -- see the roster table above.
- No known bugs at time of writing; last fixed issue during this pass was a blocked-suit countdown that was decrementing in the same `endTurn` call that had just set it via Corrupt, silently unblocking a suit the instant it was blocked (fixed by only ticking the countdown at the true end of the player's turn, not on every enemy sub-action).
