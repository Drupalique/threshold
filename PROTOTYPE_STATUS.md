# THRESHOLD Prototype — Status

_Last updated: 2026-08-20. Companion to `threshold-prototype-design.md` (the original v0.2 design doc, still the source of truth for intent/scope) — this file records what's actually built, where it currently diverges from that doc, and how to pick the work back up._

## Running it

```
npm install       # first time only
npm run dev        # dev server at http://localhost:5173/
npm test            # vitest, engine layer only (14 tests)
npx tsc -b            # typecheck
npx eslint .            # lint
```

No build/deploy step exists or is needed — this is a local-only playtest build. No persistence: reloading the page loses the run.

## What's implemented

Full v0.1 scope from the design doc's Section 6:

- Dueling-hands Earthquake combat: shared pool, player hand (5), handicapped room hand (3), multiplicative claim formula (`pool set size × hand cards played`), threat/boon suit effects, Room Threat + Player HP meters.
- Room AI: claims the largest available matching set, no lookahead/bluffing, deterministic tie-break.
- 3 surprise-card effects (`add-cards`, `block-suit`, `force-discard`), resolved once when a pool is generated.
- Decay backstop (3 unclaimed turns → HP penalty + that suit removed from the pool), now shown in the UI as a live countdown.
- Placeholder door system: size + color + texture tags, each independently rolled against the real next room at a 75% correlation rate.
- Linear 10-room run, win/loss end screens with a trailing log, restart.
- 5 suits (4 threat: Wolf/Ember/Rot/Spider, 1 boon: Grace), data-driven in `src/config/constants.ts`.

Architecture: pure, framework-free engine (`src/engine/`) driving a thin React reducer bridge (`src/state/RunContext.tsx`) and a component UI (`src/ui/`). See the file tree in-repo for the full module breakdown; it matches what was planned before build (types → engine → state → ui, bottom-up).

## Deviations from the v0.2 design doc

These came out of playtesting after the initial build and are **not** what the design doc originally specified. Flagging them here so nobody mistakes the doc for current behavior.

| # | Doc said | Prototype now does | Why |
|---|----------|---------------------|-----|
| 1 | Hands dealt once at round start, only shrink (4.1/4.3) | `HAND_REDRAW_EACH_TURN = true` — whichever actor is about to act gets a fully fresh hand every turn | User asked to try it, closer to the source card game |
| 2 | A set needs 2+ cards *in the pool* (4.1) | `MIN_POOL_SET_SIZE = 1` — a single pool card is claimable with 1 matching hand card ("1 on the table, 1 in hand") | User's correction after hitting an unclaimable lone Grace card |
| 3 | (not specified) Pool running dry before Room Threat hits 0 | No longer ends the room for free — deals a fresh wave (same room weighting) and the fight continues; the room only ends via Room Threat = 0 or player death | Original placeholder rule was producing "free win" rooms where the player never landed a claim |
| 4 | Suggested starting `ON_SUIT_RATIO` of 0.6 | Tuned down to `0.45` | 0.6 combined with #1 and #2 above was producing frequent one-hit-kills on both sides |
| 5 | (not specified) | End-of-round screen transition now waits `TURN_ANIMATION_DELAY_MS` (600ms) after a lethal/clearing action before switching screens, so the HP/Threat bar visibly animates first | Death/clear was cutting to the next screen before the meter ever visibly moved |

Everything else (claim mechanics, suit-to-effect mapping, door correlation, run structure) matches the doc as originally scoped.

## UI additions beyond the doc's placeholder spec

Small legibility features added during playtesting, not called out in the doc:

- Per-suit **decay countdown** in the pool ("decays in N", turns red at 1) — reflects deviation #3's decay backstop directly.
- Distinct highlight styles for a selected-but-claimable set vs. a selected-but-not-yet-claimable one (dashed red vs. solid blue border), plus explicit claim-panel messaging ("Not enough X in the pool... / X is blocked this turn").
- Every log entry carries a Player HP / Room Threat snapshot, shown under the entry text — visible in both the live combat log and the end-of-run recap.

## Current tunable constants

All in `src/config/constants.ts`, single source of truth:

```
PLAYER_HAND_SIZE = 5
ROOM_HAND_SIZE = 3
HAND_REDRAW_EACH_TURN = true        # deviation #1
ROOM_POOL_SIZE_SMALL = [6, 8]
ROOM_POOL_SIZE_LARGE = [12, 16]
ON_SUIT_RATIO = 0.45                # deviation #4 -- single most important balance knob
BOON_SUIT_RATIO = 0.12
SURPRISE_CARD_RATIO = 0.08
ROOM_THREAT_BASE = 20
PLAYER_HP_MAX = 30
DECAY_TURNS_N = 3
DECAY_HP_PENALTY = 3
MIN_POOL_SET_SIZE = 1               # deviation #2
SURPRISE_ADD_CARDS_COUNT = 2
SURPRISE_BLOCK_DURATION_TURNS = 1
ROOM_BOON_REGEN_FACTOR = 0.5
DOOR_CORRELATION_RATE = 0.75
RUN_MAX_DEPTH = 10
TURN_ANIMATION_DELAY_MS = 600       # UI pacing only, not engine
```

## Explicitly out of scope (unchanged from the doc)

Tier 2/3 combat AI, full door glyph-field/tree encoding, convergent nodes, artifacts, meta-progression/persistence, narrative framing, real art/sound. None of this has been touched.

## Open threads for next playtesting pass

- `ON_SUIT_RATIO = 0.45` is a first cut after the one-hit-kill report — not yet re-confirmed as the right number, may need another pass up or down.
- `HAND_REDRAW_EACH_TURN` and `MIN_POOL_SET_SIZE = 1` together make claims much more frequent than the doc's original static-hand/2-in-pool design; worth watching whether the room still reads as "a real if simple opponent" (one of the doc's stated success criteria) or has become too easy to out-race now that almost anything is claimable every turn.
- No known bugs at time of writing; last fixed issue was the death-vs-pool-exhaustion race condition (see deviation #3's history) and the instant screen-cut on death/clear (see the animation-delay addition above).
