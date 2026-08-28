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

### Riders

Every creature card fires a small **rider** effect on top of its category's effect when it's actually committed as part of a play from a hand — a fixed bonus, not another multiplier, and never triggered by a card just sitting on the table:

- **Basic rider** (every plain, unnamed card): `BASIC_RIDER_AMOUNT` (**1**), kind determined by the suit's own category — threat/weaken/poison suits deal `1` bonus damage to the play's own target, boon/guard/strength suits grant the actor `1` bonus Guard. So even a Hex or Venom play, which itself only inflicts a status stack with no HP effect, still chips 1 HP via its cards' riders.
- **Named special rider** (nine "signature" cards, one per suit, `src/config/specialCards.ts`): same damage-vs-guard split as the basic rider for that suit, but a flat `RIDER_AMOUNT` (**3**) instead of 1, and its own flavor name (Alpha Wolf, Wildfire, Rot Colossus, Broodcaller, Blessed Grace, Bastion Heart, Withering Hex, Widow's Kiss, Battle Fury). A special card is otherwise an ordinary copy of its suit — it joins the same table set and multiplier as any other card of that suit.

A play's cards always share one suit, so every rider in a single play shares one kind (damage or guard) — they're summed into a single bonus and a single log line: naming the source when exactly one card was played (its special name, or its suit name for a plain card), and reading generically ("Rider effects also deal/raise...") when several cards fired together. Riders are unaffected by Weaken/Strength (only the category's own magnitude is).

Cards on the table are always just their suit, with no rider — the UI strips a played card back down to `{id, suit, ownerId}` the instant it lands there, and `TableCard` has no field to carry a rider identity even if it wanted to. Riders only ever fire once, at the moment a card leaves a hand.

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

A room holds 1–3 individually-tracked enemies (`EnemyInstance`), each an instance of a small static roster (`src/config/enemies.ts`, `EnemyDef.minFloor`). **Enemies play exactly the same game the player does** — no fixed attack pattern, no telegraphed intent. Each enemy has its own small, directly-authored `deck: CreatureCard[]` (an enemy's suit slant *is* its identity), shuffles a fresh copy of it at the start of the fight, draws an opening hand of its own `EnemyDef.handSize` (**2** for the two `minFloor: 1` enemies, **3** at `minFloor: 2`, **4** at `minFloor: 3` — deliberately small and rising by floor tier, so a low-level enemy reads as mechanically simpler/more predictable than a high-level one, not just a smaller HP bar), and on its own turn calls `engine/enemyAI.ts`'s `chooseEnemyPlay` to pick one suit to play from its current hand.

### Enemy AI (`chooseEnemyPlay`)

A flat heuristic, not a search: score every suit the enemy holds ≥1 hand card of by `(hand-card-count × (current table count for that suit + hand-card-count)) × a per-category weight` (threat weighted highest, strength lowest), then weighted-pick among the scores (not argmax) so enemies aren't perfectly predictable turn to turn even on a fixed seed. A play always commits **all** of the enemy's current hand cards of the chosen suit — no subset optimization, no holding cards back.

**Low-HP self-preservation:** below `ENEMY_LOW_HP_HEAL_GUARD_THRESHOLD_PCT` (40%) of `hpMax`, boon/guard candidates get a further weight multiplier, so a hurting enemy is meaningfully (not absolutely) more likely to patch itself up than press an attack.

An enemy makes `ENEMY_PLAYS_PER_TURN` (**1**) play on its own turn (half the player's base allotment, deliberately — there's no enemy analog of Quake). At the end of its own turn, its remaining hand tops back up to its own `EnemyDef.handSize` (unplayed cards stay, only the shortfall is drawn — same `topUpHand` logic the player's own deck uses), reshuffling its own discard pile into its own draw pile on empty. Two same-`defId` enemies never share deck/hand array identity — each shuffles independently.

### Roster (`src/config/enemies.ts`, first-cut numbers, not balance-tested)

| Enemy | HP | Min floor | Hand | Deck |
|---|---|---|---|---|
| Wolf-kin | 14 | 1 | 2 | 7× Wolf, 3× Vigor |
| Ember Wretch | 16 | 1 | 2 | 8× Ember, 2× Ward |
| Rot Husk | 18 | 2 | 3 | 3× Rot, 3× Hex, 2× Grace, 2× Ward |
| Spider Broodmother | 22 | 3 | 4 | 4× Spider, 3× Venom, 3× Ward |
| Marsh Wraith | 24 | 4 | 3 | 5× Hex, 5× Venom |
| Stoneward Golem | 27 | 5 | 3 | 4× Ward, 4× Rot, 2× Vigor |
| Chimera Stalker | 30 | 6 | 4 | 3× Wolf, 3× Spider, 3× Ward |
| Cinder Priest | 30 | 7 | 4 | 4× Ember, 4× Grace |
| Bonecrusher Ogre | 34 | 8 | 4 | 7× Rot, 2× Vigor |
| Deepfang Matriarch | 36 | 9 | 5 | 8× Spider, 3× Venom |
| **The Undying Warlord** (elite) | 65 | 10 | 6 | 5× Wolf, 5× Rot, 3× Ward, 3× Vigor |

One copy of each enemy's own primary threat suit is that suit's named special card (see Riders, §2) rather than an added extra — e.g. Wolf-kin's 7 Wolf cards include its 1 Alpha Wolf, not 7 plain Wolf plus an 8th card — so deck size and suit ratios above are unchanged from before specials existed. The five floor 4-9 additions each stake out an archetype the original four didn't cover: Marsh Wraith is the roster's only zero-threat-suit def (pure Hex/Venom control, chipping damage entirely through riders and stacking decay); Stoneward Golem is the first Ward-primary tank; Chimera Stalker is the first dual-threat-suit hybrid (Wolf + Spider); Cinder Priest is the first Grace-primary self-healer; Bonecrusher Ogre is Rot's turn at the early "near-total glass cannon" role Wolf-kin/Ember Wretch established; Deepfang Matriarch is a late apex single-suit glass cannon so floor 9 still has real burst danger once the early cannons are trivial.

### The elite floor (floor 10)

`EnemyDef.isElite` marks a def as excluded from every floor's normal eligible pool and reserved for a guaranteed, forced-solo encounter once `floor >= RUN_MAX_DEPTH` (`roomGenerator.ts`'s `pickEnemies`) — the run's last room is always exactly one elite, never a random 3-pack diluted with early defs, and never an elite showing up early. Currently the only `isElite` def is **The Undying Warlord**, roughly double the next-highest def's HP with the roster's biggest hand (6, still under the player's own 7) and a kit that reprises the run's arc — Wolf (the first threat suit the player ever meets) and Rot (a control suit) as dual threats, Ward so it resists an early-game-style burst kill, Vigor so a dragged-out fight only escalates. The UI tags an elite instance with a gold "Elite" badge (`EnemyPanel.tsx`).

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

**Reward (after clearing a non-final room):** `REWARD_OPTION_COUNT` (**3**) options, uniform across every suit in the game (not just the room just cleared), with Quake folded in at `QUAKE_REWARD_RATIO` (8%) and a named special card (see Riders, §2) folded in at `SPECIAL_REWARD_RATIO` (15%) as possible slots. Pick one; it's appended to `run.deck`. Every option is optional — `skipReward` (`runEngine.ts`) leaves `run.deck` untouched and proceeds straight to door generation, same tail as picking a card (`proceedToDoors`), surfaced as the reward screen's "Pass" button. This is deliberately a screen-level exit rather than a per-card decline, so it stays correct once the reward phase can offer other optional things (see §11) — passing always means "proceed with whatever I've already taken this stop," not an opt-out tied to any one option. No removal/upgrade options exist yet.

**Known risk (unresolved):** the deck stays suit-diverse across all 9 suits, but any given room's table only ever draws from 1–2 threat suits — a 7-card hand from the full deck often doesn't cluster on the room's actual suits, shrinking the "big spike" play moment. Door color signaling (below) is the intended, not-yet-fully-wired compensating mechanism.

---

## 6. Doors

The very first room is generated directly, with no door choice involved. After a non-final room clears (and its reward is picked), two doors are generated. Each door is tagged with two axes describing the room behind it, each independently correlated to the true room at `DOOR_CORRELATION_RATE` (**75%**) — not guaranteed:

- **Size** (small/large) — correlates with the next room's table-deal size band.
- **Color** (red/blue) — correlates with the next room's `primarySuit` family (Wolf/Spider = red, Ember/Rot = blue; a room whose `primarySuit` is a boon/guard/status suit has no fixed family, so its color is an uncorrelated coinflip).

Choosing a door discards the other door and its room entirely — no backtracking, no preview. Both candidate rooms for a pair are generated speculatively up front (each wrapped in a `BranchRoot`, referenced by id rather than embedded inline, so a future multi-depth/convergent-node system could be layered on without a rewrite) — only the chosen one survives.

---

## 7. Player state and win/loss

- **HP**: starts and caps at `PLAYER_HP_MAX` (**30**), carries across rooms within a run. There is currently no source of healing outside combat itself (a Grace claim, playable by the player or, symmetrically, by an enemy healing itself) — no room, door, or reward restores HP between fights. Combined with `ENEMY_COUNT_WEIGHTS_LATE` pushing 3-enemy rooms late-game and the new floor-10 boss (§3), HP is a strictly depleting resource across a run with no in-run way to recover lost ground; see §11's proposed rest room.
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
EnemyDef.handSize (src/config/enemies.ts, per def) = 2 (Wolf-kin, Ember Wretch) / 3 (Rot Husk) / 4 (Spider Broodmother)
ENEMY_PLAYS_PER_TURN = 1
ENEMY_LOW_HP_HEAL_GUARD_THRESHOLD_PCT = 0.4

ON_SUIT_RATIO = 0.45      BOON_SUIT_RATIO = 0.12    GUARD_SUIT_RATIO = 0.08
WEAKEN/POISON/STRENGTH_SUIT_RATIO = 0.08 each

PLAYER_HP_MAX = 30
WEAKEN_PCT_PER_STACK = 0.1

PLAYS_PER_TURN_BASE = 2
QUAKE_REWARD_RATIO = 0.08         REWARD_OPTION_COUNT = 3
SPECIAL_REWARD_RATIO = 0.15

BASIC_RIDER_AMOUNT = 1     (src/config/specialCards.ts -- every plain card's rider)
RIDER_AMOUNT = 3           (src/config/specialCards.ts -- every named special card's rider)

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
- **No in-run HP recovery** (§7) — the player's HP bar only ever goes down (barring an in-combat Grace claim) across all 10 rooms. This is a known, currently-unaddressed design gap; §11 proposes a rest room as the fix, not yet implemented.
- No fresh batch-simulation data exists yet against the current table/live-hand engine — `scripts/playtest-sim.ts` runs cleanly again (see §9) but hasn't been run at scale since the rewrite, so any tuning claims need new numbers, not a revival of old ones. A quick `playtest-sim.ts` run after the floor 4-10 roster expansion (see `src/config/enemies.ts`) dropped the scored heuristic bot's win rate from 1% to 0.3% (300 runs each) — expected direction given tougher new defs, but underscores that none of this is tuned; treat every HP/deck-growth number below as a starting proposal, not a target.

---

## 11. Proposed features (not yet implemented)

Design directions raised in response to §10's gaps, recorded here so future work starts from an agreed plan rather than re-deriving it. None of the below exists in `src/` yet except where noted.

- **Rest rooms** (the fix for the no-HP-recovery gap above) — a campfire, a fairy's cave, or similar: a non-combat room that heals the player some amount, appearing "from time to time" rather than every room (a rest room every room would trivialize attrition; never appearing at all is today's status quo). This is the biggest structural lift of the three: `RoomInstance` currently has no notion of *not* being a combat room — `roomGenerator.ts`/`doorGenerator.ts`/`initCombat` all assume a room means enemies. Implementing this cleanly likely needs a `RoomInstance.kind: 'combat' | 'rest'` (extensible to `'shop'` below), a door-generation path that sometimes points at a rest room instead of rolling `pickEnemies`, and a new phase/screen (`RunState.phase` currently has no non-combat, non-reward, non-door in-run state). How much it heals, and how often it can appear, are open balance questions once the plumbing exists.
- **Reward pass** — done (§5): the reward screen now has a general "Pass" exit (`skipReward` in `runEngine.ts`), independent of how many/what kind of options are on offer, so it stays correct as the set of reward types below grows.
- **Card removal as a reward option** — a reward slot (alongside the existing suit/Quake/special slots, `rewardGenerator.ts`) that lets the player remove a card from `run.deck` instead of adding one. Directly targets §5/§10's suit-diversity gap: the deck only ever grows today, so a 7-card hand drawn from an increasingly large, increasingly diverse pool gets steadily *less* likely to cluster on whatever suits a given room actually deals. Needs a deck-viewing UI the reward screen doesn't have yet (today's `RewardScreen.tsx` only ever shows the 3 offered cards, never the existing deck).
- **Shops** — a room (or reward-adjacent) type where the player spends a resource to pick from a wider offering (cards, removals, maybe relics) rather than a free forced pick-1-of-3. The largest lift of the three: there is currently no currency/resource concept anywhere in `RunState` at all, so this depends on that being designed first (what it's earned from, whether it persists or is per-room, etc.) — treat as a follow-on once rest rooms have proven out the "non-combat room" plumbing above, not something to build in parallel with it.
