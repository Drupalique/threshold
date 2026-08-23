# THRESHOLD — Current Design Reference

A snapshot of how the prototype actually works today, as one document you
can read start to finish. This is *not* the design history or rationale —
for that, see `threshold-prototype-design.md` (the living spec, with the
"why" behind every decision) and `PROTOTYPE_STATUS.md` (deviations from
that spec, open threads). This file exists to be read cold.

Source of truth for all of this is the code (`src/engine/`, `src/config/`,
`src/types/`) — treat this doc as a map, not a replacement for it.

---

## 1. Premise and run structure

A single-player roguelike run: a linear sequence of up to `RUN_MAX_DEPTH`
(**10**) rooms. Each room is cleared through a set-collection combat round
("Earthquake round," named for its card-game namesake). Clearing a room
offers a reward (a card added to your deck), then a binary door choice for
the next room. No backtracking, no branch preview beyond the two doors in
front of you.

The run ends when either:
- **Player HP reaches 0** (loss), or
- **All 10 rooms are cleared** (win).

There is no meta-progression between runs — one run, start to finish, is
the whole scope.

---

## 2. Combat: the Earthquake round

### The pool and the hand

Each room generates a **pool**: 6–8 cards for a "small" room, 12–16 for
"large" (`ROOM_POOL_SIZE_SMALL`/`LARGE`), drawn from a weighted mix of
suits (see Suits, below). The player has a **hand** of `PLAYER_HAND_SIZE`
(**5**) cards, dealt from their own persistent deck (see §5), discarded and
fully redrawn every player turn.

### Claiming

A **claim** takes all of a suit's pool cards (a "set") plus some number of
matching hand cards and resolves an effect:

```
effect magnitude = pool set size × hand cards committed
```

This multiplicative formula is the core feel of the game — a big pool pile
matched with a big hand play should spike disproportionately. `MIN_POOL_SET_SIZE = 1`
means even a single pool card is claimable, as long as you hold ≥1 matching
hand card (a "1 on the table, 1 in hand" set).

A claim removes the entire pool set (not just the cards you matched) and
resolves the suit's effect (below). Claimed hand cards go to your discard
pile, not out of existence.

Threat/Hex/Venom claims require picking **which alive enemy** to target —
pool piles aren't owned by any enemy (§3), so any suit's pile can be aimed
at any alive enemy. The UI auto-resolves this silently when only one enemy
is alive.

### Suits

Nine suits, each belonging to one category that determines what a claim
(or decay — see below) of that suit does:

| Suit | Category | Player claims → | Decay hits everyone with → |
|---|---|---|---|
| Wolf, Ember, Rot, Spider | `threat` | damage to a chosen enemy | damage |
| Grace | `boon` | heal the player | healing |
| Ward | `guard` | bank Guard (absorbs the player's next incoming hits until it fades) | Guard |
| Hex | `weaken` | inflict Weaken stacks on a chosen enemy | Weaken stacks |
| Venom | `poison` | inflict Poison stacks on a chosen enemy | Poison stacks |
| Vigor | `strength` | grant the player Strength stacks | Strength stacks |

A room's pool only draws from 1 threat suit (small room) or 2 (large room)
— `THREAT_SUIT_COUNT_BY_SIZE_BAND` — plus a scattering of boon/guard/status
suits, all controlled by per-category draw ratios: `ON_SUIT_RATIO` (0.45,
*the* single most important tuning knob), `BOON_SUIT_RATIO` (0.12),
`GUARD_SUIT_RATIO`/`WEAKEN_SUIT_RATIO`/`POISON_SUIT_RATIO`/`STRENGTH_SUIT_RATIO`
(0.08 each). Enemies carry no suit of their own — any threat pile can be
aimed at any enemy regardless of flavor.

If the pool ever runs completely dry (no suit with ≥1 card left), a fresh
wave is dealt immediately — an empty pool never ends a room for free.

### Plays per turn

The player gets `PLAYS_PER_TURN_BASE` (**2**) separate claims per turn
before control passes to the enemies — pool/hand/enemy state carries
between them, so one claim can set up the next. `PLAYER_PASS` always ends
the turn immediately.

**Quake** is a rare (`QUAKE_REWARD_RATIO = 0.08` reward-slot odds), suitless
hand-only card: playing it grants unlimited plays for the rest of the
turn, free (doesn't spend a play itself). Discarded like any other card
when played, not deleted.

### Feed

Instead of claiming, a play can **feed**: commit any number of same-suit
hand cards face-up directly into the pool, growing that suit's pile — or,
since `MIN_POOL_SET_SIZE = 1`, seeding a brand-new pile from zero — without
resolving any effect. Costs a play, same as a claim. No target, no
pool-size floor. Gives an otherwise-dead hand card (nothing in it currently
matches the pool) something productive to do: bank it toward a bigger
future claim.

Fed cards become ordinary pool cards from that point on — if the pile is
later claimed or left to decay, they vanish the way any pool card does,
**not** returning to the discard pile (only recoverable via the deck's next
full-room reshuffle).

**The risk:** feeding does not pause or reset a pile's decay countdown. A
pile grown over several turns and never reclaimed decays at its full,
now-larger size, hitting the player *and* every alive enemy (see Decay,
below) — first playtesting (`PLAYTEST_FINDINGS.md`'s 2026-08-23 addendum)
found this is a real trap, not just theoretical: decay's share of deaths
jumped roughly 5× in an LLM-bot batch that fed aggressively.

### Decay

Any live pool set left unclaimed for `DECAY_TURNS_N` (**3**) consecutive
full rounds (player turn + every alive enemy's turn) auto-resolves: the
pile's own suit effect fires at magnitude = **pile size only** (no
hand-card multiplier — nobody committed a hand to it), landing on **every
entity in the room at once** — the player and every alive enemy. A
decaying threat pile damages everyone; a decaying boon pile heals everyone,
enemies included; a decaying guard pile shields everyone. This asymmetry —
untargeted and unmultiplied, and can help enemies as easily as hurt the
player — is what makes claiming promptly strictly better than waiting, and
scales worse the more enemies are in the room.

---

## 3. Enemies

A room holds 1–3 individually-tracked enemies (`EnemyInstance`), each an
instance of a small static, floor-gated roster (`src/config/enemies.ts`,
`EnemyDef.minFloor`). **Enemies never draw a hand or claim from the pool**
— claiming is exclusively a player action. Instead, each enemy has a fixed,
repeating **pattern**: a cycle of authored steps, never re-rolled, always
telegraphed one step ahead in the UI.

### Roster (first-cut numbers, not balance-tested)

| Enemy | HP | Min floor | Pattern (cycles) |
|---|---|---|---|
| Wolf-kin | 14 | 1 | Attack 4 → Corrupt (force-discard) → Attack 4 → Strength 3 |
| Ember Wretch | 16 | 1 | Attack 3 → Corrupt (block-suit) → Attack 5 |
| Rot Husk | 18 | 2 | Debuff 3 (Weaken) → Attack 4 → Heal 4 → Feed Ward +2 |
| Spider Broodmother | 22 | 3 | Corrupt (add-cards) → Attack 6 → Poison 4 → Guard 6 |

### Intent vocabulary

- **Attack** — flat damage to the player.
- **Guard** — the enemy banks Guard, absorbing the player's next claim against it.
- **Heal** — restores its own HP, capped at max.
- **Debuff** — inflicts Weaken stacks on the player.
- **Poison** — inflicts Poison stacks on the player.
- **Strength** — the enemy buffs itself with Strength stacks.
- **Corrupt** — acts on the shared pool: `add-cards` (grows the pool from the room's threat suits), `block-suit` (a suit can't be claimed or fed for `SURPRISE_BLOCK_DURATION_TURNS`), or `force-discard` (discards a random player hand card).
- **Feed** — mirrors the player's own feed action: adds `magnitude` fresh cards of an authored `feedSuit` to the pool. Rot Husk's cycle demonstrates this, patiently fattening the Ward pile it can't itself claim, banking on it decaying to shield itself and any packmate.

### How many enemies, and how hard

Enemy count per room is **weighted by floor**, not flat: `pickEnemyCount`
blends `ENEMY_COUNT_WEIGHTS_EARLY` (`[6, 2, 0]` — mostly solo at floor 1)
toward `ENEMY_COUNT_WEIGHTS_LATE` (`[1, 3, 5]` — 3-packs common by floor
10) linearly across floor 1..`RUN_MAX_DEPTH`. This replaced a flat uniform
1–3 roll after playtesting found enemy count was the single largest lever
on room lethality (1-enemy rooms cleared ~91% of the time vs. ~10% for
3-enemy, at the old flat rate).

Same-`defId` duplicates in one room no longer act in lockstep: each starts
at a **staggered `patternIndex`** offset (0, 1, 2… mod that def's pattern
length), so a 3-enemy same-type pack telegraphs and resolves on different
beats instead of all three synchronizing every action.

A room clears when every enemy's HP independently reaches 0 (via claim,
decay, or self-inflicted Poison). Turn order within a round: player, then
each alive enemy in stable order.

---

## 4. Status effects

Weaken, Strength, and Poison are unified as **stack counts** on a shared
`StatusBag`, held by the player or any enemy, resolved by the same
functions regardless of holder:

- **Weaken** — knocks `WEAKEN_PCT_PER_STACK` (10%) off an outgoing
  threat/attack magnitude per stack, capped at 100%.
- **Strength** — adds +1 flat damage per stack to an attack's *base*,
  before the hand-card multiplier — for a player threat claim this is
  `(poolSetSize + strength) × handCards`, so it's disproportionately
  valuable on a *small* pool set.
- **Poison** — deals its current stack count as damage to its own holder,
  then decays.

All three decay by exactly 1 stack at the true end of the holder's own turn
(never mid-turn). The player inflicts these via three dedicated suits:
**Hex** (Weaken, targeted like threat), **Venom** (Poison, targeted),
**Vigor** (Strength, self-targeted like a boon). None of the three get a
bonus from the player's own Strength/Weaken (same exemption boon/guard
claims get) — inflicting a status isn't itself treated as an "attack."

---

## 5. Persistent deck and rewards

The player's hand is **not** generated per-room. `RunState.deck` is a
run-level card pool, seeded at run start from a 19-card `STARTER_DECK` (3
copies each of the 4 threat suits, 2 each of Grace/Ward, 1 each of
Hex/Venom/Vigor), and grown by exactly one card per cleared room via a
reward pick.

**Per room:** `run.deck` is freshly shuffled into a `drawPile`, split into
the starting hand. Whatever's unclaimed/unfed at turn end moves to
`discardPile`; a fresh hand is drawn from `drawPile` at the start of the
next player turn, reshuffling `discardPile` back in if it runs dry. Nothing
in the hand cycle is ever permanently deleted — claimed, force-discarded,
and played-Quake cards all cycle back via reshuffle. (Fed cards are the one
exception — see §2.)

**Reward (after clearing a non-final room):** `REWARD_OPTION_COUNT` (**3**)
options, uniform across every suit in the game (not just the room just
cleared), with Quake folded in at `QUAKE_REWARD_RATIO` (8%) as one possible
slot. Pick one; it's appended to `run.deck`. No removal/upgrade options
exist yet.

**Known risk (unresolved):** the deck stays suit-diverse across all 9
suits, but any given room's pool only ever draws from 1–2 threat suits — a
5-card hand from the full deck often doesn't cluster on the room's actual
suits, shrinking the "big spike" claim moment. The intended compensating
mechanism (using door color/reward signals to steer deck-building toward
upcoming suits) is not yet wired into any decision-maker.

---

## 6. Doors

The very first room is generated directly, with no door choice involved.
After that, clearing a room leads to a reward pick, then two doors are
generated (skipped entirely — straight to `run-complete` — if the room just
cleared was the run's last). Each door is tagged with three axes describing
the room behind it,
**each independently correlated to the true room at `DOOR_CORRELATION_RATE`
(75%)** — not guaranteed:

- **Size** (small/large) — correlates with the next room's pool size band.
- **Color** (red/blue) — correlates with the next room's dominant threat
  suit family (Wolf/Spider = red, Ember/Rot = blue; boon/guard/status
  suits carry no color).
- **Texture** (smooth/jagged) — "jagged" correlates with the next room
  containing an enemy whose pattern includes a Corrupt step.

Choosing a door discards the other door and its room entirely — no
backtracking, no preview. This is a placeholder for a much richer planned
system (see `threshold-prototype-design.md` §5.1) — no tree-encoding,
convergent nodes, or artifacts exist yet.

---

## 7. Player state and win/loss

- **HP**: starts and caps at `PLAYER_HP_MAX` (**30**), carries across rooms
  within a run (no full heal between rooms beyond what Grace/decay grant).
- **Guard**: banked via Ward claims/decay; absorbs incoming HP loss;
  **resets to 0 at the end of every full enemy phase**, whether or not it
  was used (a known source of waste — see `PLAYTEST_FINDINGS.md` Finding 5).
- **Statuses**: Weaken/Strength/Poison stacks, decaying 1/turn.
- Death (`playerHP <= 0`) ends the run immediately; clearing the 10th room
  wins it.

---

## 8. Quick constant reference

All in `src/config/constants.ts` unless noted:

```
PLAYER_HAND_SIZE = 5
ROOM_POOL_SIZE_SMALL = [6, 8]        ROOM_POOL_SIZE_LARGE = [12, 16]
THREAT_SUIT_COUNT_BY_SIZE_BAND = { small: 1, large: 2 }

ROOM_MIN/MAX_ENEMIES = 1 / 3
ENEMY_COUNT_WEIGHTS_EARLY = [6, 2, 0]   (floor 1)
ENEMY_COUNT_WEIGHTS_LATE  = [1, 3, 5]   (floor RUN_MAX_DEPTH)

ON_SUIT_RATIO = 0.45      BOON_SUIT_RATIO = 0.12    GUARD_SUIT_RATIO = 0.08
WEAKEN/POISON/STRENGTH_SUIT_RATIO = 0.08 each

PLAYER_HP_MAX = 30
DECAY_TURNS_N = 3
MIN_POOL_SET_SIZE = 1
WEAKEN_PCT_PER_STACK = 0.1
SURPRISE_ADD_CARDS_COUNT = 2      SURPRISE_BLOCK_DURATION_TURNS = 1

PLAYS_PER_TURN_BASE = 2
QUAKE_REWARD_RATIO = 0.08         REWARD_OPTION_COUNT = 3

DOOR_CORRELATION_RATE = 0.75
RUN_MAX_DEPTH = 10
STARTER_DECK = 19 cards (3×4 threat suits, 2×Grace, 2×Ward, 1 each Hex/Venom/Vigor)

# Enemy roster + per-enemy stats: src/config/enemies.ts (authored data, not a global knob)
```

---

## 9. Where the design is shakiest right now

For the full data and reasoning behind each of these, see
`PLAYTEST_FINDINGS.md` (batch-simulation results) and `PROTOTYPE_STATUS.md`
("Open threads"). Briefly, as of this writing:

- The **persistent deck's suit-diversity gap** (§5) is confirmed to hurt
  clear rates and hasn't been addressed — the compensating door/reward
  signaling design exists on paper only.
- **Guard resets fully every enemy phase** regardless of use — playtesting
  shows over half of claimed Guard is typically wasted.
- **Feed's decay interaction is a real, confirmed trap** (§2) — first
  LLM-bot data shows it roughly quintuples decay's share of deaths when
  played opportunistically without tracking individual pile countdowns.
- Enemy stat-block magnitudes, the Rot Husk/Spider Broodmother status/feed
  demonstrations, and enemy-def selection weighting (uniform among
  eligible defs, not biased toward harder ones as floors deepen) are all
  first-cut numbers, not balance-tested.
