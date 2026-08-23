# Mechanic brainstorm (parking lot)

Ideas that have been raised and are worth keeping on record, but aren't
decided or scheduled the way `PERSISTENT_DECK_PLAN.md` is. Add to this file
as new ideas come up rather than losing them in conversation history. Each
entry should stand alone -- a fresh session should be able to read one entry
and understand it without the surrounding chat.

## Feed the pool -- play cards into a pile instead of only claiming from it

**Status: built, 2026-08-23 -- see `threshold-prototype-design.md` Section 4.11 for the system as shipped and `PROTOTYPE_STATUS.md` for current open threads.** The open questions below were resolved during implementation (costs a full play; can seed a pile from zero; feeds exactly the hand cards selected, no cap; a fed card behaves like any other pool card, not tracked back to `discardPile`; enemies got a basic `feed` intent too, demonstrated on Rot Husk). Kept here for the historical reasoning -- read 4.11 for what's actually running.

**The idea:** today the only way a hand card interacts with the pool is
claiming (consume a live set + matching hand cards, resolve an effect,
remove the pile). There's no way to voluntarily *grow* a pile. This proposes
a second action: spend a play to add a hand card face-up to a suit's pool
pile instead of claiming it -- growing that pile's set size without
resolving anything, banking on a bigger future claim.

**Why it's worth considering:** the claim formula is `poolSetSize x
handCardsPlayed`. Feeding permanently grows `poolSetSize` (until claimed or
decayed), which pays off on *every* future card thrown at that pile, not
just the one spent feeding it -- so it's a deliberate bet on a bigger
multiplicative spike later rather than a smaller one now. It also gives
"dead" hand cards (see `PLAYTEST_FINDINGS.md` Finding 2 -- 52.5% of turns
have zero legal claims) something productive to do: a card that doesn't
match anything worth claiming right now can still be banked toward a future
combo instead of being pure waste on a forced pass.

**The built-in risk (what stops this from being strictly better than
passing):** growing a pile does **not** reset or pause its decay counter --
a bigger fed pile that isn't claimed within `DECAY_TURNS_N` turns still
decays at magnitude = full pile size, hitting the player once and (per
Finding 4) every alive enemy independently. Feeding is a real bet: a bigger
combo if cashed in, a bigger self-inflicted (and enemy-benefiting, in a
multi-enemy room) blast if not. It also gives Corrupt's `block-suit` newly
sharp teeth -- an enemy can specifically punish a pile it sees being
deliberately built up, which it currently has no particular reason to
target over any other live suit.

**A symmetric enemy version -- new "feed" intent step:** enemies currently
only ever shrink the pool (via player claims) or grow it *randomly*
(Corrupt's `add-cards`) -- nothing telegraphs an enemy deliberately fattening
one *specific* pile. A natural mirror: add "feed" as a new `IntentType`
(alongside attack/guard/heal/debuff/poison/strength/corrupt) that adds cards
to a suit of the enemy's choosing. The most interesting target isn't a
threat suit (symmetric self-damage on decay) but a **boon or guard pile** --
an enemy deliberately fattening a Ward pile it intends to let decay reuses
Finding 4's decay-asymmetry (untargeted decay benefits whoever has more
bodies in the room) as actual enemy behavior/archetype flavor, not just a
passive stat quirk. This would make a natural "control"-type enemy kit:
patient, pool-manipulating, punishing the player for not clearing a
building threat -- distinct from the current attack-heavy Wolf-kin/Ember
Wretch rosters.

**Open questions (none resolved -- this is a raw idea, not a spec):**

- **Play cost:** does feeding cost a full play (same as a claim -- keeps it
  a genuine opportunity-cost choice each turn) or is it free/cheaper (turns
  it into a strict complement you do with leftover plays, and gives
  dead-hand turns a use without ever competing against an attractive
  claim)? Leaning toward "costs a play" for the tension, but untested.
- **Starting from zero:** can you feed a suit with zero live pool copies
  (seed a brand-new pile from nothing) or only add to an already-live set
  (`>= MIN_POOL_SET_SIZE`)? Starting from zero is more powerful (stockpile
  toward a suit that isn't even on the table yet) and more swingy.
- **How many cards per feed:** exactly one card per play, or can you dump
  your whole matching hand into the pile in one action? Dumping trades this
  turn's claim potential entirely for a bigger future one -- a bigger bet,
  plausible to allow, but changes the pacing math a lot.
- **Interaction with the persistent deck plan** (if both ship): does a fed
  card sit "in the pool" as a distinct object from the player's discard
  pile, or is it effectively already discarded the moment it's fed (cycles
  back on reshuffle regardless of whether the pile is later claimed or
  decays)? Needs a decision once both features are actually being built
  together, not before.
- **Telegraphing:** every existing enemy intent is telegraphed one beat
  ahead (design doc's stated principle). "Feed" should almost certainly
  follow suit for consistency, even though hiding which suit it targets
  might seem tempting for surprise value -- flagging only because it's the
  one intent type where breaking the pattern might seem attractive and
  probably shouldn't be done without a deliberate reason.

**Relationship to existing findings:**

- Complements (does not compete with) `PERSISTENT_DECK_PLAN.md` -- gives
  dead-hand turns a productive action independent of where the hand itself
  comes from.
- Extends Finding 4 (decay's per-enemy-count asymmetry) from a passive
  balance quirk into potential enemy-archetype content.
- Does not touch Finding 1 (enemy-count lethality cliff) or Finding 3
  (enemy lockstep) -- still open, separate issues.
