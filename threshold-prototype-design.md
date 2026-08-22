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

**A note on fluidity:** this document is scaffolding for a prototype whose job is to be played, not a spec to be honored for its own sake. "Settled" below means *settled enough to build first* — it is not a claim that playtesting can't overturn it. If actually playing the thing reveals that a "Settled" item is working against what it was meant to produce (tension, legible danger, a felt asymmetry between player and room), changing it — even a major departure — is the process working correctly, not scope creep. Section 4.6 is a live example of this: the dueling-hands room model immediately below is listed as Settled, and is simultaneously the subject of an active reconsideration prompted directly by playtesting the base combat loop.

**Settled:**
- Rooms are cleared via shared-pool set-collection combat ("Earthquake rounds"), where both the player and the room draw hands and race to claim sets from a common pool (see Section 4 — this replaces the earlier no-opponent "entropy" version; see 4.5 for that cut concept). *Under active reconsideration on the room side as of the Guard-suit playtesting pass — see 4.6. The player-side Earthquake mechanics are not in question, only what the room does opposite them.*
- Claiming a set is **multiplicative**: reward/damage = (pool set size) × (matching hand cards played), not additive. This is the source of the "big spike" feeling and should not be flattened into a linear formula.
- Progression is a binary-choice tree, one-way, single-room visibility.
- Door properties (color, texture, size, shape) encode information about the next step(s), learnable over time as a full grammar (see Section 5).
- Three combat tiers exist, in increasing order of opponent agency (see Section 4). The base tier already includes a handicapped opposing hand; higher tiers add smarter play and eventually genuine denial logic.
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

### 4.6 Emerging direction — room as a telegraphed pattern, not a second hand (OPEN, not yet built)

**Status: under consideration, not decided, not built.** Written down now because it's a large enough departure from 4.3 that it needs to be visible in the doc before code catches up to it — not because the coding team should start on it. A first playable slice of 4.3 (plus a first player-exclusive tool, the Guard/Ward suit — see the deviations log in `PROTOTYPE_STATUS.md`) exists and is what surfaced this line of thought.

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
  - Optionally, for prototype flavor only: **texture** (smooth / jagged) -> correlates with presence/absence of surprise cards in the next pool.
- Correlation should be **probabilistic, not guaranteed** (e.g. 75% predictive), even at this placeholder stage — this is the property that makes door-reading a skill rather than a lookup table, and it's cheap to implement now rather than retrofit later.
- No tree-encoding, no convergence, no shared-branch similarity, no artifacts, no reversals in the prototype.

### 5.3 Data model note for the coding team

Even though the prototype only needs next-room tags, structure the door/room data model so that a door object *can* later hold a reference to a subtree rather than a single node, without a rewrite. Concretely: model a door as pointing to a **branch root**, not a room, even if in the prototype that branch root only ever has depth 1. This will also make the future shared-branch convergence feature (5.1) straightforward: two doors converging just means two branch-root references pointing at the same subtree object, which should fall out naturally from this model rather than needing special-casing later.

---

## 6. Prototype Scope (Build This)

**In scope for v0.1:**
- Dueling-hands Earthquake combat (Section 4.3), fully playable: shared pool, player hand, handicapped room hand, multiplicative claim formula, Room Threat and Player HP meters.
- Suit-to-effect mapping (threat suits vs. boon suits) as described in 4.1.
- 2-3 surprise card effects, simple implementations.
- Decay backstop for fully-unclaimed sets (4.1).
- Placeholder door system (Section 5.2) with 2 axes minimum (size, color), probabilistic correlation to next room.
- Linear branching dungeon structure, fixed depth (suggest 10 rooms), no backtracking.
- Basic Player HP/death threshold so runs can actually end.
- No meta-progression, no artifacts, no narrative framing required.

**Explicitly out of scope for v0.1 — do not build without further design work:**
- Tier 2 and Tier 3 combat (Section 4.4).
- Full door glyph-field / tree-encoding system, and the shared-branch similarity rendering (Section 5.1).
- Convergent node detection/signatures.
- Artifacts of any kind.
- Meta-progression, run persistence, unlocks.
- Full room content taxonomy — use a small placeholder set of match types (suggest: 3-4 creature/threat "families," 1 hazard family, and 1 boon family) sufficient to exercise the combat and door-correlation systems.

**Success criteria for the prototype** (what we're actually trying to learn): does racing the room's handicapped hand to claim sets — with the multiplicative payoff on big matches — feel tense and satisfying, including the "great hand vs. terrible hand" swings? Does the room's dumb-but-active claiming feel like a real if simple opponent rather than an obstacle course? And does a two-axis, probabilistic door signal feel like a meaningful choice, or does it feel arbitrary/too noisy to read? These questions should be answerable from playtesting v0.1 before any further systems are built.
