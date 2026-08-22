# Working Title: THRESHOLD (placeholder)
### Prototype Design Document — v0.3

*This is a living document for an actively-playtested prototype, not a frozen spec — see Section 2 for how "settled" should be read.*

## 1. Concept Overview

A meta-progressive roguelike in which every room is cleared through a **set-collection combat round** ("Earthquake round," named for the 1998 Wizards of the Coast card game it's derived from), and every room exit is a **binary door choice** where the doors' physical properties encode information about what lies beyond.

Progression through the dungeon is **strictly one-way and single-room-sighted** — the player can never see or plan more than one fork ahead. This is a deliberate constraint: the door-reading skill is meant to produce *informed instinct about the immediate choice*, never *route-planning toward a build or goal*. Doors may (in later systems) encode information about the entire branch below them, but even that information is never structural/sequential — it can tell the player what a branch *contains*, never *when* or *where* they'll encounter it.

This document specifies a **first prototype** covering the simplest of three planned combat tiers, plus a placeholder door system sufficient to test the core loop. The two more complex combat tiers and the full door-encoding system are specified for context and future planning, but are **explicitly contingent on the first tier proving fun** — do not build them until told to.

---

## 2. Design Status

This is a brainstorm-stage design. Treat anything under "Prototype Scope" (Section 6) as settled enough to build. Treat everything else as directional intent that may change based on what the prototype teaches us.

**A note on fluidity:** this document is scaffolding for a prototype whose job is to be played, not a spec to be honored for its own sake. "Settled" below means *settled enough to build first* — it is not a claim that playtesting can't overturn it. If actually playing the thing reveals that a "Settled" item is working against what it was meant to produce (tension, legible danger, a felt asymmetry between player and room), changing it — even a major departure — is the process working correctly, not scope creep. Section 4.7 is the most recent example of this in practice: the dueling-hands room model (4.3) was built first, playtesting surfaced that the room read as "a weaker copy of the player" rather than a genuinely different threat (4.6), and it was replaced outright by a per-enemy telegraphed-ability system rather than patched.

**Settled:**
- Rooms are cleared via a **shared-pool set-collection combat round** ("Earthquake round") on the player's side: the player draws a hand and claims sets from a common pool (see Section 4). Opposing the player is no longer a second hand-holder — see 4.7 for the enemy-based system that superseded 4.3/4.6, and 4.5 for the earlier no-opponent "entropy" concept this whole lineage replaced.
- Claiming a set is **multiplicative**: reward/damage = (pool set size) × (matching hand cards played), not additive. This is the source of the "big spike" feeling and should not be flattened into a linear formula. An unclaimed pile that decays instead resolves at a **fixed multiplier of 1** (pile size only) — see 4.7's decay redesign — which is precisely what makes claiming worth the risk of committing hand cards.
- Progression is a binary-choice tree, one-way, single-room visibility.
- Door properties (color, texture, size, shape) encode information about the next step(s), learnable over time as a full grammar (see Section 5).
- Enemies are **static, individually-tracked entities** with fixed, telegraphed ability patterns rather than a second hand-holder (see 4.7). Room difficulty scales by which enemy types are eligible to appear as run depth increases, not by a smarter-AI tier ladder — see 4.7's note on how this reframes the old Tier 2/3 concept in 4.4.
- Two different doors may lead to the *same* downstream node ("convergent nodes"). Critically, this shared node will generally be the **root of an entire shared branch** — the two doors aren't just pointing at one coincidentally identical room, they're pointing at the same downstream subtree. This should manifest visually as **significant, legible similarity between the two doors**, not just a subtle matching detail (see 5.1 for detail — this is a future-system note, not prototype scope).

**Explicitly NOT settled (open questions, parked for later):**
- Full room content taxonomy (enemy families, hazard types, reward categories, event types) — needs its own pass before the full door-encoding grammar can be designed.
- Whether tree-encoded doors show quantity of content or only presence.
- The visual/symbolic language of doors beyond the prototype's placeholder.
- Meta-progression between runs (unlocks, currency, permanent codex).
- Artifact system that alters door legibility (lenses, corruption debuffs).
- Setting, narrative framing, art direction beyond "collapsing temple" tone.

**Do not scope-creep the prototype to cover these.** They exist here so the coding team understands where the architecture may need to flex later, not so they get built now.

---

## 3. Core Game Loop (Prototype Scope)

1. Player enters a room.
2. Player clears the room via an **Earthquake round** (Section 4 — dueling-hands combat).
3. On clearing, two doors are generated and presented (see Section 5 — placeholder system for prototype).
4. Player selects a door. The unchosen door and its contents are discarded — no backtracking, no preview of what was behind it.
5. Repeat until player dies or reaches a run-end condition (prototype: a fixed depth, e.g. 10 rooms, is sufficient — no need to design a "boss" for v0.1).

No meta-progression between runs is required for the prototype. A single run, start to death/completion, is the full scope.

---

## 4. Earthquake Combat System

### 4.1 Base mechanics

- A **shared pool** of cards is laid out at the start of a round. Cards represent creatures/hazards ("threat suits") and beneficial encounters ("boon suits").
- Cards have a **match type** (suit) and belong to a **set** if 2+ cards in the pool share a suit.
- Both the **player** and the **room** draw a hand at the start of the round from a **room-generated deck**, weighted toward the room's dominant suit(s) with a deliberate scattering of off-suit "dead" cards mixed in. This weighting is what produces the "great hand" / "dang, terrible hand" feeling — a deck that's too purely on-suit removes the swing entirely, so don't over-tune toward reliability.
- On a turn, a hand-holder (player or room) may **play matching hand cards onto a pool set to claim it**. Claiming removes those pool cards and resolves an effect scaled by the multiplicative formula below.
- **Claim formula:** `effect magnitude = pool set size × matching hand cards played`. This is the core "feel" mechanic — a big set claimed with a big matching play should feel disproportionately powerful, not just proportionally better. Do not substitute a linear/additive formula; the multiplicative spike is a deliberate, named design goal (see the walkthrough in 4.3 for why).
- **Suit-to-effect mapping:**
  - **Threat suits** (most creatures/hazards): player claims → damage to **Room Threat** (the room's clear meter). Room claims → damage to **Player HP**. Same card pool, opposite target depending on who claims it — every card on the table is live for both sides, nobody is drawing "safe" cards.
  - **Boon suits** (a minority of the deck): player claims → player **heals** (reduces damage taken this run, i.e. restores HP). Room claims → a small, deliberately *milder* setback (e.g. minor Room Threat regen), not a symmetric heal for the room. Full two-way symmetry on boon suits is not worth the added cognitive load at this tier — save it for a harder room type later if wanted.
- **Surprise cards**: a small percentage of the pool should be non-creature "event" cards that disrupt the board when revealed (e.g. shuffle the pool, add cards, block a suit for a turn, force a discard). These exist to prevent the round from becoming a solved optimization problem. Keep the prototype's surprise-card set small (2–3 effects) and simple to implement; expand later.
- **Decay:** any pool set left fully unclaimed by either side for N consecutive turns can auto-resolve as a minor Player HP penalty (kept from the earlier design as a backstop against pure stalemates — tune N by feel, suggested starting value 3).

### 4.2 Room Threat and win/loss conditions

- Each room has a **Room Threat** value set at generation (difficulty knob for later balancing — for the prototype, a flat value per room, e.g. 20, is fine).
- Room clears when Room Threat reaches 0.
- Run ends when Player HP reaches 0.
- There is no room-level fail state beyond HP loss — a badly-played room just means carrying less HP into the next one, consistent with the roguelike genre convention already established for this project.

### 4.3 The room's hand (PROTOTYPE TARGET)

The room is not a real decision-maker. It's meant to be cheap to build and to feel like an active but unintelligent opponent, not a puzzle-solver.

- The room draws a hand **smaller** than the player's (suggested: room hand size 2–3, player hand size 5) from the same weighted deck.
- The room's claim rule should be the simplest possible legible heuristic — e.g. **"claim the largest available matching set it can, immediately, on its turn."** No lookahead, no denial logic, no bluffing, no holding cards for a bigger future set.
- Turn order can alternate (player, then room, repeat) or be randomized per round — either is fine for the prototype; this is a placeholder-scope call the coding team can make.

**Worked example** (illustrative, not a spec — numbers are for feel, not final balance):

Room: *The Sunken Nave*, Room Threat 20. Pool: 4x Wolf (threat), 2x Ember (threat), 1x Rot (threat), 1x Surprise.

- *Turn 1:* Player hand: 3x Wolf, 1x Ember, 1x off-suit. Room hand: 1x Wolf, 1x Rot. Player acts first, plays all 3 Wolf cards onto the 4-Wolf set: `4 x 3 = 12` damage to Room Threat (20 -> 8). This is the intended spike moment — a big pool set plus a big matching hand should feel this disproportionate.
- *Room's turn:* No completable set remains in its hand (its lone Wolf card has nothing left to match, its Rot card has no set partner in the pool) — it whiffs. Note the emergent bonus here: going big and going first doesn't just score the player, it can deny the room's own follow-up.
- *Turn 2:* Pool: 2x Ember, 1x Rot, 1x Surprise (+ any top-up). Player hand: 1x Ember + mostly dead cards. Room hand: 2x Ember. Room acts first this round and claims the Ember set before the player can: `2 x 2 = 4` damage to Player HP. This is the "dang" moment, and it's a more active, legible kind of bad luck than a pure decay timer would produce — the player can see exactly what beat them to it.
- *Turn 3+:* Continues until pool empties or Room Threat hits 0.

**Prototype-scope questions for the coding team to make reasonable placeholder calls on, pending playtesting feedback:**
- Exact hand sizes (suggested starting point: player 5, room 2-3).
- Turn order rule (strict alternation vs. randomized — start with strict alternation, simplest to reason about and to debug).
- Deck weighting ratio of on-suit to off-suit cards — flag this explicitly as **the single most important tuning knob** in the whole system, since it directly controls how often the multiplicative spike moment occurs. Too rich a deck and the big turn becomes routine; too sparse and it feels like rare bad luck rather than a system. Suggested starting point: roughly 60% on-suit / 40% off-suit in the generated hand-deck, then tune by feel.
- Whether pool refreshes/tops up mid-round or is static and shrinking — start with **static, no refresh**, simplest case, matching the original entropy-tier assumption.

### 4.4 Tier 2 / Tier 3 (CONTINGENT — do not build until 4.3 is validated)

With the room now holding a real (if handicapped) hand, the old three-tier split compresses to two remaining steps above the base:

- **Tier 2 — Smarter Room:** same handicapped-hand structure as 4.3, but with a larger hand and/or a better heuristic (e.g. "claim the largest set that maximizes damage to the player," or a light preference toward denying the player's likely best play). Still no true lookahead or bluffing. Use for mid-tier rooms once the base tier is confirmed fun.
- **Tier 3 — Rival Delver:** a genuine opposing decision-maker with real hand-management and a bias toward *denying* the player specific sets rather than pure self-optimization. Reserve for rare, high-stakes encounters (elites, bosses, rival NPC delvers) — this tier is expensive in both design and player attention and should stay uncommon.

### 4.5 Cut concept — Pure Entropy Claim (reference only, not for implementation)

An earlier draft of this system had **no opposing decision-maker at all** — unclaimed pool cards simply auto-resolved against the player after N turns, with the room itself acting as a pure decay rule rather than a hand-holder. This is being superseded by the dueling-hands system above, which was judged more fun and closer to the source game's actual tension (a real, if simple, contest for shared resources). Kept here only so the reasoning behind the change is legible to anyone picking up this document later — do not build this version.

### 4.6 Emerging direction — room as a telegraphed pattern, not a second hand (ADOPTED — see 4.7 for what was actually built)

**Status: adopted and built, generalized further than proposed here.** Kept in place (rather than deleted) because it's the direct lineage for 4.7 and explains the *why* behind the departure; read 4.6 for motivation, 4.7 for the system as actually implemented — the two differ in one significant way: 4.7 generalizes "the room" into **multiple individually-tracked enemies**, each a static instance of an authored type, rather than one telegraphed pattern for the room as a whole. A first playable slice of 4.3 (plus a first player-exclusive tool, the Guard/Ward suit — see the deviations log in `PROTOTYPE_STATUS.md`) is what surfaced this line of thought.

**What playtesting is showing:** with dueling hands on both sides, the room reads as a *weaker copy of the player* rather than a genuinely different kind of threat. Its only handicaps — a smaller hand, a dumb "take the biggest set" heuristic — are handicaps of degree, not of kind, and once claims are frequent (which they are — see PROTOTYPE_STATUS.md deviations #1 and #2), a room turn is still "the same minigame the player just played, slightly worse at it." Worse, because a room claim's magnitude runs through the same uncapped multiplicative formula as the player's, a single unlucky room turn can land as a large, unforeshadowed HP swing. That combination — same game, no cap, no warning — is the direct cause of the "not enough asymmetry" and "death feels random and sudden" observations that prompted this whole line of thought.

**Proposed direction:** leave the player's Earthquake mechanics (shared pool, hand, multiplicative claim formula) completely untouched. Replace the *room's* participation in that system with a **turn-ahead telegraphed intent pattern** — closer to the genre-standard "boss with a readable attack pattern" than to a second player at the same table. Each room turn, the room announces one of a small set of intents one beat before it resolves:

- **Attack** — direct Player HP damage, scaled to the room's own tier/threat, not derived from claiming a pool set. A "big hit" becomes a stat on the room, not a fluke of what happened to be in the pool.
- **Guard** — the room hardens itself: the player's next threat claim against it is dampened, a room-side mirror of the player's own Guard.
- **Corrupt** — the room acts on the shared pool directly instead of on the player or itself: grows a threat suit's stack, buries/shuffles a suit, blocks a suit for a turn, or forces a player discard. Notably **this is not a new mechanic to invent** — it's the existing surprise-card effect vocabulary (`add-cards` / `block-suit` / `force-discard` in `surpriseEffects.ts`), repurposed from a random one-off pool event into a deliberate, telegraphed room action.

**Why this is worth a departure, not just a balance pass:**
- It makes the room a *structurally different* opponent instead of a handicapped mirror — which is the actual asymmetry the current system is missing, not something a bigger hand-size gap or a bigger dumb/smart split would fix.
- It converts "random, sudden death" into "foreseeable danger you saw coming and failed to answer" — the telegraph is the fix for the *feel* complaint, not just the balance complaint.
- Corrupt gives the pool-manipulation idea a home without inventing new systems for it — it reframes machinery that already exists rather than adding to the surface area.

**Open questions if this gets picked up:** this should probably *replace* 4.3's room-hand mechanics rather than run alongside them — a room that both draws a hand and telegraphs a pattern is two overlapping opponent models competing for the same design space. Undecided: what determines a given room's pattern (per room instance? per dominant-suit family? per tier?), how intent magnitude scales with room threat, how the telegraph is surfaced in the UI, and whether Attack/Guard/Corrupt is the right three-part vocabulary or needs a fourth (a "Rest"/pass beat) for pacing.

### 4.7 Enemies, not a room (BUILT — the suit-ownership model below is superseded by 4.8)

**Status: built**, then partially revised — see 4.8, which decouples pool piles from enemy ownership entirely while keeping everything else in this section (enemies as individually-tracked HP pools with a telegraphed pattern) intact. This is a further generalization of 4.6, prompted by a direct design request: instead of "the room" telegraphing one pattern as if it were a single opposing entity, a room now contains **1–3 individually-tracked enemies**, each a runtime instance of a small, static, authored roster. The player still plays the unmodified Earthquake mechanics from 4.1–4.3 (shared pool, hand, multiplicative claim formula); everything that changed is what's on the other side of the table.

**Enemies owned suits, claims were targeted (AS ORIGINALLY BUILT — see 4.8).** Each enemy type (`EnemyDef`) was permanently tied to one threat suit and had its own HP pool. Every threat-suit card generated into the room's pool was tagged with the specific enemy instance it belonged to, so claiming a Wolf set damaged *that* Wolf-kin, not a shared room-wide meter. Two enemies of the same type could appear in the same room (an explicit design goal) and were tracked and targeted completely independently — if their shared suit had two live sets on the table, the player was prompted to choose which one their hand cards went toward. Boon and guard suits remained un-owned, exactly as before. There is no single "Room Threat" scalar; a room clears when every enemy's HP has independently reached 0 — this part is unchanged by 4.8.

**Enemies act, they don't draw hands.** An enemy never holds cards or claims from the pool — claiming is now exclusively a player action. Instead, each `EnemyDef` carries a **fixed, repeating pattern** of ability steps (a plain array, cycled by index — never re-rolled), drawn from a five-verb vocabulary:

- **Attack** — flat Player HP damage, a stat on the enemy, not derived from the pool.
- **Guard** — the enemy banks its own Guard, absorbing the player's next claim against it (a room-side mirror of the player's Ward tool).
- **Heal** — the enemy restores its own HP, capped at max.
- **Debuff (Weaken)** — knocks a fraction off the magnitude of the player's *next* threat claim; expires at the end of the player's next turn whether or not it was used.
- **Corrupt** — acts on the shared pool instead of the player or itself: `add-cards`, `block-suit`, or `force-discard`. This is deliberately not a new mechanic — it's 4.6's Corrupt idea, reusing the exact `add-cards`/`block-suit`/`force-discard` vocabulary that used to live in random one-off "surprise cards" embedded in the pool. Surprise cards no longer spawn in the pool at all; Corrupt is now the *only* way those three effects fire, always as a deliberate, telegraphed enemy action rather than a random reveal.

The enemy currently telegraphs `pattern[patternIndex % pattern.length]` — the step that resolves the *next* time it acts — so the player always sees one beat ahead, StS-style. A fixed cycle (rather than a random weighted roll each turn) was a deliberate choice: enemy kits are meant to be memorizable, "the same kind of threat every time," not a slot machine. Heal/Debuff are new beyond 4.6's three-verb sketch (Attack/Guard/Corrupt) — added to match a genre-standard "traditional turn-based enemy" toolkit (attack, defend, heal, debuff the target, disrupt the shared resource).

**Turn structure.** After the player's turn, each alive enemy takes its turn in stable order — one dispatched action per enemy, not one action for the whole room. **Guard persists through the entire enemy phase**, not just the first enemy to act, and fades only once every alive enemy has gone; the same is true of the player's hand redraw and the blocked-suit countdown, which only tick at the true start/end of a full player turn. This was a real bug caught during implementation (an earlier draft decremented block/decay bookkeeping on every single enemy sub-action, which silently unblocked a suit in the very same tick Corrupt blocked it) — see the fixed version in `combatEngine.ts`'s `endTurn` for the corrected phase-boundary logic.

**Floor-gated static roster.** Each `EnemyDef` carries a `minFloor`; room generation only picks from defs eligible for the current depth (`config/enemies.ts` holds the roster — one def per threat suit for the prototype's placeholder scope, per the taxonomy note in Section 6). This is the "harder enemies show up as floors increase" knob the design explicitly asked for. Selection among eligible defs is currently **uniform**, not weighted toward higher-tier defs as a room gets deeper — flagged as an open tuning knob, not a correctness gap.

**Decay redesign: the pile fires itself, at everyone, unmultiplied.** A pile left unclaimed for `DECAY_TURNS_N` turns no longer applies a flat, suit-blind Player HP penalty. Instead it resolves **its own suit's effect**, at magnitude equal to just its own pile size (i.e. the claim formula's "× hand cards played" term is always 1 — nobody committed a hand to it), landing on **every entity in the room at once**: the player and every currently-alive enemy, not just the pile's owner. A threat pile decaying damages everyone; a boon pile decaying heals everyone — including the enemies; a guard pile decaying grants Guard to everyone. This is what makes claiming actually matter beyond just "getting there first": claiming is the *only* way to choose a specific target and multiply the effect by hand cards committed — decay is the deliberately worse, untargeted, unmultiplied fallback, and it can help an enemy as easily as it hurts the player. A decay that empties the last enemy's HP clears the room exactly like a claim would.

**Worked example** (illustrative, not a spec): *The Sunken Nave*, two enemies — Wolf-kin (14 HP, pattern: attack 4 / corrupt force-discard / attack 4 / guard 5) and Ember Wretch (16 HP, pattern: attack 3 / corrupt block-suit / attack 5). Player claims a 4-card Wolf set with 3 hand cards (12 damage) — Wolf-kin drops to 2 HP. Wolf-kin's turn resolves its currently-telegraphed step (say, attack 4) and advances to the next step in its cycle; Ember Wretch then takes its own turn independently, on its own cycle. Meanwhile a 2-card Ember pile nobody claims for 3 turns decays: 2 damage to the player, 2 damage to Wolf-kin *and* Ember Wretch alike, gone from the pool. The player's next claim against Wolf-kin (now weakened by the earlier decay tick) finishes it off; Ember Wretch remains, so the room is not yet clear.

**What this obsoletes:** 4.3's room-hand mechanics (`roomHand`, `ROOM_HAND_SIZE`, the "claim the biggest available set" room-AI heuristic) are gone entirely, replaced by the above. The flat `DECAY_HP_PENALTY` constant is gone, replaced by the pile-size-driven decay magnitude described above. Pool-embedded random surprise cards are gone; the `add-cards`/`block-suit`/`force-discard` vocabulary survives only as Corrupt intent steps.

**Open questions carried forward:** whether enemy selection should weight toward higher-`minFloor` defs as depth increases (currently uniform among eligible); whether `block-suit`'s target suit should avoid the acting enemy's own suit (currently uniform random, so an enemy can accidentally block itself); attack/heal/guard magnitude tuning across the roster (first-cut numbers, unconfirmed by playtesting); and what Tier 2/3 (Section 4.4) even means now — 4.4 was written against the old "smarter room AI" framing, but enemies are now deliberately *static* by design intent (a direct ask, not a placeholder), so a genuine difficulty-tier ladder above the base roster likely needs a fresh pass (bigger/rarer enemy defs? a true "Rival Delver" with real decision-making, kept separate from the static roster?) rather than treating 4.4 as still-accurate.

### 4.8 Pool piles and enemies decoupled (BUILT — supersedes 4.7's suit-ownership model)

**Status: built.** Prompted by a direct design request after playing with 4.7's model: enemies and pool piles are now **independent entities that don't constrain each other**. An enemy no longer has a suit at all (`EnemyDef`/`EnemyInstance` carry no `suit` field), and a pool card no longer carries an owning enemy instance. Everything else about enemies from 4.7 — individually-tracked HP, the fixed telegraphed pattern, Attack/Guard/Heal/Debuff/Corrupt — is unchanged.

**Pool piles are a property of the room, not of the enemies in it.** `RoomParams` now carries `threatSuits: SuitId[]` — the specific threat suits woven into this room's pool, picked independently of which enemies `pickEnemies` happens to roll. The number of distinct threat suits is currently keyed off the room's existing size band (`THREAT_SUIT_COUNT_BY_SIZE_BAND`: 1 for a small room, 2 for a large one) — a first-cut "room type" knob, not a considered balance choice. This was a deliberate design call: piles are now generated with a relation to the *room*, at most incidentally to the specific enemies present, rather than being derived directly from the enemy roster the way 4.7 did it. The player's hand is dealt from the same `threatSuits` list as the pool, so a hand always has a chance at matching whatever's actually on the table.

**A claim can target any alive enemy, regardless of suit.** Since piles aren't owned, `getLegalPlayerClaimTargets` now offers *every* alive enemy as a target for a given threat-suit pile, all sharing the identical pool-set size — there is no "correct" or "matching" enemy anymore. The existing target-picker UI (built for 4.7's rare same-suit-duplicate case) now does double duty as the primary way to aim a claim in any multi-enemy room, and auto-resolves silently when only one enemy is alive, exactly as before. Decay was already suit-only in its effect (it always hit every entity in the room, never just an "owner") so its resolution logic is unchanged in spirit — only simplified, since there's no owner dimension left to key `decayCounters` by.

**Why this is worth a departure, not just a refactor:** 4.7's model made "which enemy owns this suit" do double duty as both *flavor* (Wolf-kin is wolf-suited) and *mechanical constraint* (a Wolf pile can only ever hit the Wolf-kin). Collapsing those together meant a room with three different-suited enemies effectively had three non-interacting mini-fights sharing a table, rather than one real tactical choice. Decoupling them turns "which pile do I claim, and who do I point it at" into two genuinely separate decisions — e.g. dumping your biggest pile onto whichever enemy is lowest on HP or about to attack, regardless of what suit that enemy happens to be flavored as.

**What this obsoletes:** `CreatureCard.ownerInstanceId`, `EnemyDef.suit`/`EnemyInstance.suit`, and every piece of combatEngine/deckGenerator/PoolDisplay logic that grouped or filtered pool cards by owning enemy are gone. `RoomParams.primarySuit` (used only for door color-tag flavor) now derives from `threatSuits` instead of "the highest-HP enemy's suit."

**Open questions for the next playtesting pass:** is 1-vs-2 threat suits (by size band) the right lever for "room type," or should it also vary with floor/depth, or be its own explicit room archetype independent of size? Should suit variety correlate with the specific enemies present at all (e.g. guarantee at least one overlap), or is full independence — the current implementation — actually better because it keeps piles and enemies legibly separate? Does "any target, no exceptions" claiming feel like a clean tactical widening, or does it remove too much texture from the old "this pile is *this* enemy's problem" readability? Targeting is now click-to-target directly on the enemy card (a follow-up past this section's original ship) rather than a separate "which enemy?" menu — does clicking the card itself read as clearly interactive on first encounter, or does it need a stronger affordance than a highlighted border?

---

## 5. Door System

### 5.1 Full design intent (for context — not prototype scope)

Doors are meant to eventually encode **content, not structure** — a compressed, lossy, non-sequential summary of everything in the branch below them (enemy types, hazard types, reward categories, events), rendered as an overlapping, partially illegible visual "glyph field" across four axes: color, texture, size, shape.

Key intended properties (do not build these yet, but the data model should not actively make them impossible later — see 5.3):
- The encoding is a **fixed-size symbol budget** per door, regardless of the size of the branch beneath it — meaning early, large branches compress into chaotic/noisy fields, and later, smaller branches naturally resolve into near-literal legibility. This is intended to produce a "doors get more readable as you descend" curve without needing a separate difficulty/legibility stat.
- **Convergent nodes** (two doors leading to the same downstream node) share an underlying signature. Importantly, when this happens, the shared node is generally the **root of an entire shared branch** — both doors lead into the *same subtree*, not just a single coincidentally-matching room. This has a real consequence for the visual language: the two doors should display **significant, noticeable similarity** (a strong shared motif across their glyph fields), not a single buried matching detail. A player catching this should feel like they're recognizing a large, recurring shape, not spotting a needle in a haystack. That said, the dressing (rotation, recoloring, blending into surrounding noise per each door's own path) still applies on top of that shared core, so the similarity is strong but not identical — legible to a trained eye, not simply a duplicate image. Convergence is never flagged directly; it's a pattern-recognition skill for expert players.
- Artifacts (future system) can alter legibility: stabilizing signatures for easier convergence-spotting, revealing coarse early/late sequencing, increasing symbol resolution — or, as debuffs, injecting false signatures or reducing resolution.
- The grammar itself, once learned, is **fully and permanently knowable** — no irreducible randomness in what a door's features mean. Any "reversal" or corrupted dialect (a floor-wide modifier that inverts an axis's meaning, e.g.) must be telegraphed at the *threshold of the floor/biome*, not hidden at individual doors — the player should always be able to know *which ruleset* they're currently reading.

### 5.2 Placeholder system for the prototype

The full symbol-field encoding above is **not required** to test the combat loop. For v0.1, implement the simplest possible version that still lets us sanity-check "does a door choice feel meaningful":

- Each door has a small set of visible tags drawn directly from **next-room-only** content (no branch-encoding yet). Suggested minimal tag set:
  - **Size** (small / large) -> correlates with pool size of the next room's Earthquake round.
  - **Color** (e.g. red / blue, expand later) -> correlates with dominant suit family in the next pool.
  - Optionally, for prototype flavor only: **texture** (smooth / jagged) -> correlates with whether the next room contains an enemy whose pattern includes a Corrupt step (see 4.7) — "jagged" now reads as "a pool-manipulating enemy lurks here," the role a random surprise card used to play for this tag before Corrupt superseded surprise cards.
- Correlation should be **probabilistic, not guaranteed** (e.g. 75% predictive), even at this placeholder stage — this is the property that makes door-reading a skill rather than a lookup table, and it's cheap to implement now rather than retrofit later.
- No tree-encoding, no convergence, no shared-branch similarity, no artifacts, no reversals in the prototype.

### 5.3 Data model note for the coding team

Even though the prototype only needs next-room tags, structure the door/room data model so that a door object *can* later hold a reference to a subtree rather than a single node, without a rewrite. Concretely: model a door as pointing to a **branch root**, not a room, even if in the prototype that branch root only ever has depth 1. This will also make the future shared-branch convergence feature (5.1) straightforward: two doors converging just means two branch-root references pointing at the same subtree object, which should fall out naturally from this model rather than needing special-casing later.

---

## 6. Prototype Scope (Build This)

*This section describes v0.1 as originally scoped. The room-opponent bullets below (room hand, surprise cards) are superseded by 4.7's enemy-based system, currently built — read them as history of what was first shipped, not current behavior. See `PROTOTYPE_STATUS.md` for what's actually running today.*

**In scope for v0.1 (original):**
- Dueling-hands Earthquake combat (Section 4.3), fully playable: shared pool, player hand, handicapped room hand, multiplicative claim formula, Room Threat and Player HP meters.
- Suit-to-effect mapping (threat suits vs. boon suits) as described in 4.1.
- 2-3 surprise card effects, simple implementations.
- Decay backstop for fully-unclaimed sets (4.1).
- Placeholder door system (Section 5.2) with 2 axes minimum (size, color), probabilistic correlation to next room.
- Linear branching dungeon structure, fixed depth (suggest 10 rooms), no backtracking.
- Basic Player HP/death threshold so runs can actually end.
- No meta-progression, no artifacts, no narrative framing required.

**Explicitly out of scope for v0.1 — do not build without further design work:**
- Tier 2 and Tier 3 combat (Section 4.4) — this framing is itself under question now that enemies are static by design intent; see 4.7's closing note.
- Full door glyph-field / tree-encoding system, and the shared-branch similarity rendering (Section 5.1).
- Convergent node detection/signatures.
- Artifacts of any kind.
- Meta-progression, run persistence, unlocks.
- Full room content taxonomy — use a small placeholder set of match types (currently: 4 threat suits, 1 boon family, 1 guard family, generated independently of the room's 1-3 enemies — see 4.8) sufficient to exercise the combat and door-correlation systems.

**Success criteria for the prototype** (what we're actually trying to learn): does claiming pool sets — with the multiplicative payoff on big matches — feel tense and satisfying, including the "great hand vs. terrible hand" swings? Do individually-tracked, statically-patterned enemies (4.7) read as real, learnable threats rather than either a mirror-match minigame or a pure obstacle course? Does letting a pile decay (now a genuine double-edged event that can help enemies as much as the player) create a meaningful claim-now-vs-wait tension? And does a two-axis, probabilistic door signal feel like a meaningful choice, or does it feel arbitrary/too noisy to read? These questions should be answerable from playtesting before any further systems are built.
