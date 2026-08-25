# THRESHOLD — Current Design Reference

A snapshot of how the prototype actually works today, as one document you can read start to finish. This is the *only* design document in the repo — earlier planning/status/playtest docs (a shared decaying pool, fixed enemy attack patterns, a "feed" action, a room-generated hand) described an older build and have been deleted rather than patched; none of that survives in the current engine. Treat this file as a map, not a replacement for the code — source of truth is always `src/engine/`, `src/config/`, `src/types/`.

---

## 1. Premise and run structure

A single-player roguelike run: a linear sequence of up to `RUN_MAX_DEPTH` (**10**) rooms. Each room is cleared through a set-collection combat round. Clearing a non-final room offers a reward (a card added to your deck), then a binary door choice for the next room. No backtracking, no branch preview beyond the two doors in front of you.

The run ends when either:
- **Player HP reaches 0** (`run-over`), or
- **The 10th room is cleared** (`run-complete`, no reward/door generated for it).

There is no meta-progression between runs — one run, start to finish, is the whole scope.

---

## 2. Combat: the table

### The table and the hand

Each room round deals cards onto a shared **table**. Unlike an old pool model, table cards are tagged with an owner (`'room'`, `'player'`, or a specific enemy's `instanceId`) and behave differently depending who owns them:

- **The room's own cards** persist and accumulate across rounds indefinitely — they are only ever removed the instant a play reads that suit's count (see Claiming, below). A room suit nobody plays into just keeps growing, round after round.
- **The player's own played cards** stay on the table for the rest of the round, and are wiped only at the start of the player's own next turn.
- **Each enemy's own played cards** work the same way, wiped only at the start of that specific enemy's own next turn.

There is no decay: a table pile that nobody plays into never auto-resolves, penalizes anyone, or disappears on its own. The room simply keeps dealing fresh batches on top of whatever's unclaimed.

**Per-round dealing:** each room rolls one `dealsPerRound` frequency profile at generation (`ROOM_DEAL_FREQUENCY_PROFILES`: a steady one-a-round room, a steady two-a-round room, or an erratic 1–3-a-round room), then re-rolls within that room's own `[min, max]` every round. Each roll deals that many independent `tableDealSize`-sized batches (rolled once per room from `ROOM_TABLE_DEAL_SMALL`/`LARGE` depending on `sizeBand`), weighted toward the room's `threatSuits` plus a scattering of boon/guard/status suits (same generator as the old pool, `deckGenerator.ts`'s `generateWeightedDeck`, now only ever used for the table).

### Playing a set

A **play** commits some number of same-suit hand cards and resolves an effect:

```
effect magnitude = hand cards played × (table cards of that suit visible BEFORE this play, from every owner combined, PLUS the cards this play itself adds)
```

In other words, **a played set is itself a multiplicative set on the table** — it doesn't just multiply against what was already there, it joins that total first. Playing 2 of a suit onto an empty table is `2 played × 2 now on the table = 4`; playing 2 more onto an existing 3 is `2 played × 5 now on the table = 10`. There is no longer a 0-magnitude "banking" play — every play has an effect, even the very first one into an empty table. (This replaced an earlier formula that only multiplied against the table count *before* the play landed, under which an empty-table play did nothing.)

A play never touches the player's or an enemy's own existing table contribution — those only ever grow within a round, appended to on top of whatever's already there. The room's own matching cards are the one exception: reading their count during a play is what "claims" them, removing them from the table at that moment (`tableState.ts`'s `claimRoomCards`) — this is the entire reason unclaimed room cards are safe to let accumulate across rounds instead of decaying.

Played hand cards go to the actor's discard pile, not out of existence.

Threat/Hex/Venom plays require picking **which alive enemy** to target — table piles aren't owned by any enemy, so any suit's cards can be aimed at any alive enemy. The UI auto-resolves this silently when only one enemy is alive.

### Suits

Nine suits, each belonging to one category that determines what a play of that suit does:

| Suit | Category | Playing it → |
|---|---|---|
| Wolf, Ember, Rot, Spider | `threat` | damage to a chosen enemy |
| Grace | `boon` | heal the player (or the acting enemy, if an enemy plays it) |
| Ward | `guard` | bank Guard (absorbs the holder's own next incoming HP loss) |
| Hex | `weaken` | inflict Weaken stacks on a chosen enemy |
| Venom | `poison` | inflict Poison stacks on a chosen enemy |
| Vigor | `strength` | grant the acting entity Strength stacks |

Every suit is fully symmetric: the player and any enemy can hold and play any of them, including Ward/Grace/Vigor on themselves. A room's table only draws from `THREAT_SUIT_COUNT_BY_SIZE_BAND` distinct threat suits (1 for a small room, 2 for a large one) — a room-level property, independent of which enemies happen to be present (`RoomParams.threatSuits`). Draw ratios: `ON_SUIT_RATIO` (0.45, *the* single most important tuning knob), `BOON_SUIT_RATIO` (0.12), `GUARD_SUIT_RATIO`/`WEAKEN_SUIT_RATIO`/`POISON_SUIT_RATIO`/`STRENGTH_SUIT_RATIO` (0.08 each).

### Plays per turn

The player gets `PLAYS_PER_TURN_BASE` (**2**) separate plays per turn before control passes to the enemy phase — table/hand/enemy state carries between them, so one play can set up the next. `PLAYER_PASS` always ends the turn immediately.

**Quake** is a suitless, hand-only special card, offered as a reward at `QUAKE_REWARD_RATIO` (8% of reward slots): playing it grants unlimited plays for the rest of the turn, free (doesn't spend a play itself). Discarded like any other card when played, not deleted — it cycles back on the next reshuffle. Only `PLAYER_PASS` ends a Quake-boosted turn.

---

## 3. Enemies

A room holds 1–3 individually-tracked enemies (`EnemyInstance`), each an instance of a small static roster (`src/config/enemies.ts`, `EnemyDef.minFloor`). **Enemies play exactly the same game the player does** — no fixed attack pattern, no telegraphed intent. Each enemy has its own small, directly-authored `deck: CreatureCard[]` (an enemy's suit slant *is* its identity), shuffles a fresh copy of it at the start of the fight, draws an opening hand of `ENEMY_HAND_SIZE` (**4**), and on its own turn calls `engine/enemyAI.ts`'s `chooseEnemyPlay` to pick one suit to play from its current hand.

### Enemy AI (`chooseEnemyPlay`)

A flat heuristic, not a search: score every suit the enemy holds ≥1 hand card of by `(hand-card-count × (current table count for that suit + hand-card-count)) × a per-category weight` (threat weighted highest, strength lowest), then weighted-pick among the scores (not argmax) so enemies aren't perfectly predictable turn to turn even on a fixed seed. A play always commits **all** of the enemy's current hand cards of the chosen suit — no subset optimization, no holding cards back.

**Low-HP self-preservation:** below `ENEMY_LOW_HP_HEAL_GUARD_THRESHOLD_PCT` (40%) of `hpMax`, boon/guard candidates get a further weight multiplier, so a hurting enemy is meaningfully (not absolutely) more likely to patch itself up than press an attack.

An enemy makes `ENEMY_PLAYS_PER_TURN` (**1**) play on its own turn (half the player's base allotment, deliberately — there's no enemy analog of Quake). At the end of its own turn, its remaining hand tops back up to `ENEMY_HAND_SIZE` (unplayed cards stay, only the shortfall is drawn — same `topUpHand` logic the player's own deck uses), reshuffling its own discard pile into its own draw pile on empty. Two same-`defId` enemies never share deck/hand array identity — each shuffles independently.

### Roster (`src/config/enemies.ts`, first-cut numbers, not balance-tested)

| Enemy | HP | Min floor | Deck |
|---|---|---|---|
| Wolf-kin | 14 | 1 | 7× Wolf, 3× Vigor |
| Ember Wretch | 16 | 1 | 8× Ember, 2× Ward |
| Rot Husk | 18 | 2 | 3× Rot, 3× Hex, 2× Grace, 2× Ward |
| Spider Broodmother | 22 | 3 | 4× Spider, 3× Venom, 3× Ward |

### How many enemies, and how hard

Enemy count per room is **weighted by floor**, not flat: `pickEnemyCount` blends `ENEMY_COUNT_WEIGHTS_EARLY` (`[6, 2, 0]` — mostly solo at floor 1) toward `ENEMY_COUNT_WEIGHTS_LATE` (`[1, 3, 5]` — 3-packs common by floor 10) linearly across floor 1..`RUN_MAX_DEPTH`. Selection among eligible-by-`minFloor` defs is uniform, not weighted toward harder defs as floors deepen — a known open tuning gap.

Duplicate enemies are allowed and each gets its own independent hand/deck cycle. A room clears when every enemy's HP independently reaches 0 (via a player's play, or an enemy's own Poison tick). Turn order within a round: player, then each alive enemy in stable order. An enemy poisoned to 0 HP mid-phase is kept as a 0-HP "corpse" in the array until the round's end-sweep, so `activeEnemyIndex` doesn't desync against enemies still owed a turn that round.

---

## 4. Status effects

Weaken, Strength, and Poison are unified as **stack counts** on a shared `StatusBag`, held by the player or any enemy, resolved by the same functions regardless of holder:

- **Weaken** — knocks `WEAKEN_PCT_PER_STACK` (10%) off an outgoing *threat* play's magnitude per stack held by the entity dealing it, capped at 100%.
- **Strength** — adds +1 flat to the table-count term per stack, before the hand-card multiplier, on a *threat* play only — for a player threat play this is `(tableCount + handCount + strength) × handCount`, so it's disproportionately valuable on a small table count.
- **Poison** — deals its current stack count as damage to its own holder, then decays.

All three decay by exactly 1 stack at the true end of the holder's own turn (never mid-turn). The player inflicts these via three dedicated suits: **Hex** (Weaken, targeted like threat), **Venom** (Poison, targeted), **Vigor** (Strength, self-targeted like a boon). None of the three get a bonus from the actor's own Strength/Weaken (same exemption boon/guard plays get) — inflicting a status isn't itself treated as an "attack."

---

## 5. Persistent deck and rewards

The player's hand is **not** generated per-room. `RunState.deck` is a run-level card pool, seeded at run start from a 19-card `STARTER_DECK` (3 copies each of the 4 threat suits, 2 each of Grace/Ward, 1 each of Hex/Venom/Vigor), and grown by exactly one card per cleared non-final room via a reward pick.

**Per room:** `run.deck` is freshly shuffled into a `drawPile`, dealing an opening hand of `PLAYER_HAND_SIZE` (**7**). At the end of the player's own turn, the hand **tops back up** to that size rather than being fully discarded and redrawn — whatever wasn't played stays in hand, only the shortfall is drawn from `drawPile` (reshuffling `discardPile` back in if it runs dry). Nothing in the hand cycle is ever permanently deleted — played cards go to `discardPile` and cycle back on the next reshuffle.

**Reward (after clearing a non-final room):** `REWARD_OPTION_COUNT` (**3**) options, uniform across every suit in the game (not just the room just cleared), with Quake folded in at `QUAKE_REWARD_RATIO` (8%) as one possible slot. Pick one; it's appended to `run.deck`. No removal/upgrade options exist yet.

**Known risk (unresolved):** the deck stays suit-diverse across all 9 suits, but any given room's table only ever draws from 1–2 threat suits — a 7-card hand from the full deck often doesn't cluster on the room's actual suits, shrinking the "big spike" play moment. Door color signaling (below) is the intended, not-yet-fully-wired compensating mechanism.

---

## 6. Doors

The very first room is generated directly, with no door choice involved. After a non-final room clears (and its reward is picked), two doors are generated. Each door is tagged with two axes describing the room behind it, each independently correlated to the true room at `DOOR_CORRELATION_RATE` (**75%**) — not guaranteed:

- **Size** (small/large) — correlates with the next room's table-deal size band.
- **Color** (red/blue) — correlates with the next room's `primarySuit` family (Wolf/Spider = red, Ember/Rot = blue; a room whose `primarySuit` is a boon/guard/status suit has no fixed family, so its color is an uncorrelated coinflip).

Choosing a door discards the other door and its room entirely — no backtracking, no preview. Both candidate rooms for a pair are generated speculatively up front (each wrapped in a `BranchRoot`, referenced by id rather than embedded inline, so a future multi-depth/convergent-node system could be layered on without a rewrite) — only the chosen one survives.

---

## 7. Player state and win/loss

- **HP**: starts and caps at `PLAYER_HP_MAX` (**30**), carries across rooms within a run (no full heal between rooms beyond what Grace grants).
- **Guard**: banked via Ward plays; absorbs incoming HP loss; **persists indefinitely** until it actually absorbs damage — it no longer force-resets at the end of every enemy phase.
- **Statuses**: Weaken/Strength/Poison stacks, decaying 1/turn.
- Death (`playerHP <= 0`) ends the run immediately; clearing the 10th room wins it.

---

## 8. Quick constant reference

All in `src/config/constants.ts` unless noted:

```
PLAYER_HAND_SIZE = 7
ROOM_TABLE_DEAL_SMALL = [2, 3]        ROOM_TABLE_DEAL_LARGE = [4, 5]
ROOM_DEAL_FREQUENCY_PROFILES = [{1,1}, {2,2}, {1,3}]   # one room-wide pick, re-rolled within range each round
THREAT_SUIT_COUNT_BY_SIZE_BAND = { small: 1, large: 2 }

ROOM_MIN/MAX_ENEMIES = 1 / 3
ENEMY_COUNT_WEIGHTS_EARLY = [6, 2, 0]   (floor 1)
ENEMY_COUNT_WEIGHTS_LATE  = [1, 3, 5]   (floor RUN_MAX_DEPTH)
ENEMY_HAND_SIZE = 4              ENEMY_PLAYS_PER_TURN = 1
ENEMY_LOW_HP_HEAL_GUARD_THRESHOLD_PCT = 0.4

ON_SUIT_RATIO = 0.45      BOON_SUIT_RATIO = 0.12    GUARD_SUIT_RATIO = 0.08
WEAKEN/POISON/STRENGTH_SUIT_RATIO = 0.08 each

PLAYER_HP_MAX = 30
WEAKEN_PCT_PER_STACK = 0.1

PLAYS_PER_TURN_BASE = 2
QUAKE_REWARD_RATIO = 0.08         REWARD_OPTION_COUNT = 3

DOOR_CORRELATION_RATE = 0.75
RUN_MAX_DEPTH = 10
STARTER_DECK = 19 cards (3×4 threat suits, 2×Grace, 2×Ward, 1 each Hex/Venom/Vigor)

# Enemy roster + per-enemy decks: src/config/enemies.ts (authored data, not a global knob)
```

---

## 9. Playtest tooling

`scripts/playtest.ts` (interactive CLI, one command per decision) and `scripts/playtest-sim.ts` (batch simulator with a scored heuristic bot, plus an optional `PLAYTEST_BOT=llm` mode via `scripts/llmBot.ts`) both drive the real engine directly — no UI, no mocking. They're excluded from `tsconfig`'s `include` (they're Node scripts, not app code), so `npx tsc -b` doesn't typecheck them; verify changes to them by actually running `npx tsx scripts/playtest.ts new` / `npx tsx scripts/playtest-sim.ts` rather than trusting the main build. No decay, feed, or fixed-pattern concepts remain in either script — they were fully removed along with the mechanics themselves, not left as dead branches.

## 10. Where the design is shakiest right now

- The **persistent deck's suit-diversity gap** (§5) hasn't been addressed — door color signaling exists but nothing in the UI or a decision-maker actually steers reward/door picks toward suits already in the deck.
- Enemy stat-block magnitudes, enemy-def selection weighting (uniform among eligible defs, not biased toward harder ones as floors deepen), and the enemy AI's scoring weights are all first-cut numbers, not balance-tested.
- No fresh batch-simulation data exists yet against the current table/live-hand engine — `scripts/playtest-sim.ts` runs cleanly again (see §9) but hasn't been run at scale since the rewrite, so any tuning claims need new numbers, not a revival of old ones.
