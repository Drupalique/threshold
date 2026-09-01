# Mechanic brainstorm (parking lot)

Ideas that have been raised and are worth keeping on record, but aren't decided or scheduled. Add to this file as new ideas come up rather than losing them in conversation history. Each entry should stand alone -- a fresh session should be able to read one entry and understand it without the surrounding chat.

## Decouple suit (multiplier) from effect (what the multiplied value does)

**Status: raw idea, unbuilt.** Today `SuitDef.category` (`src/types/suits.ts`) is a fixed 1:1 property of a `SuitId` -- Wolf is always `threat`, Grace is always `boon`, Ward is always `guard`, Hex/Venom/Vigor are always their one status. A suit's identity *is* its effect. This proposes splitting that into two independent axes on a card: **suit** (which table pile a card stacks into, and therefore what multiplies the play -- purely a grouping/set-size mechanic) and **effect** (what the multiplied value actually does when a play resolves it -- damage, defense/guard, buff, or debuff). Right now those two questions have exactly one answer each, permanently bolted together per suit; this idea is to let them vary independently.

**Why it's worth considering:** the play formula (`table set size x hand cards played`, see `GAME_DESIGN.md` §2) is already the game's core tension-generator, and it lives entirely on the suit axis -- suits are what a player banks on building up. Effects are currently just along for the ride, fixed at design time per suit. Separating them opens design space without touching that core formula: the same Wolf pile could, in principle, be played for damage by one card and for a debuff by a different card of the same suit, or a single suit could host a small fixed menu of effect-cards a player chooses between at play time. It also gives future content (rewards, persistent-deck cards) a second knob to vary independently of "which suit does this card feed," rather than every new effect requiring a brand-new suit.

**Open questions (raw, unresolved):**
- Where does effect live -- on the hand/table card itself (so a "Wolf" card can be either a damage-Wolf or a debuff-Wolf, and the pile mixes effect variants), or does a play choose the effect at play time (the pile stays effect-agnostic, the *play* picks damage vs. debuff)? These are very different designs -- the first adds a second dimension to every card; the second keeps cards as they are and adds a choice to playing.
- Does every suit support every effect, or does each suit have a restricted effect menu (closer to how `SuitCategory` already partitions suits into threat/boon/guard/status families)? Unrestricted is a bigger swing; restricted is closer to today's system with a couple of suits opened up to a second effect as a first experiment.
- Does this replace or sit alongside the three status suits (Hex/Venom/Vigor)? Those already demonstrate "playing a suit applies a status instead of damage" -- this idea generalizes that pattern from "one suit, one status, fixed" to "any suit, any effect, chosen."

**Relationship to existing systems:** doesn't touch the table's per-owner ownership model (`src/types/combat.ts`'s `TableCard.ownerId`) -- that's orthogonal to what a play's effect *is*. Closest existing precedent is `SuitCategory` itself, which already proves the "suit implies effect" half of the current design; this entry is about whether that implication should become a choice instead of a constant.

## Currency from claim overflow, feeding a shop room

**Status: raw idea, unbuilt.** `RunState` has no currency concept at all today -- `GAME_DESIGN.md` §11 names this as the specific blocker on building shops. Rather than a kill-counter or a flat per-room drop (StS's gold), seed currency directly off the claim mechanic that's already central to the game: when a play's `claimRoomCards` (`src/engine/tableState.ts`) reads a room pile above some threshold size (e.g. 5+), the amount over the threshold converts 1:1 into currency. A shop room would reuse the `RoomInstance` discriminated union and dedicated-`RunState.phase` shape rest rooms already proved out (§6, §11) -- its own persistent pile, fenced off from claiming by playing a hand, spendable only at a fixed currency rate.

**Why it's worth considering:** ties currency generation to the thing Threshold specifically rewards -- big, patient claims -- rather than layering on an unrelated resource. It's a payoff for the existing "let the room pile grow" tension (§2), not a second economy competing with it.

**Open questions (raw, unresolved):** threshold-size tuning; whether currency persists for the whole run (like the deck) or resets per room; whether a shop's pile is one-time or regenerates; whether entering a shop consumes a door-choice slot or is a new node kind alongside rest rooms in `runTree.ts`.

**Relationship to existing systems:** builds on `tableState.ts`'s `claimRoomCards` and the `RoomInstance.kind` union rest rooms established (§6); doesn't touch the play formula (§2) or riders (§2).

## Relics keyed to suits, riders, and the enemy-symmetry break

**Status: suit-bound charms and rider mutators are built** (`src/types/relics.ts`, `src/config/relics.ts`, `combatEngine.ts`'s `applyRelics`) -- held in `RunState.relics`, acquired via a reward-screen slot (`RELIC_REWARD_RATIO`) or a dedicated shrine room (`ShrineRoomInstance`, `SHRINE_ROOM_RATIO`), unlimited held with no duplicates offered. **Anti-symmetric relics remain unbuilt**, deferred since they touch `enemyAI.ts`/`wipeOwnerTable` more invasively than the other two shapes:

- **Suit-bound charms** -- a passive scoped to one suit family, e.g. "Wolf claims also inflict 1 Weaken on the target." Gives suit specialization a payoff beyond the current only suit-diversity lever, rest-room card removal (§6/§10).
- **Rider mutators** -- adjust `BASIC_RIDER_AMOUNT`/`RIDER_AMOUNT` (`src/config/specialCards.ts`) for one category, or add a secondary rider effect to a category's plays. Cheap and isolated, since riders (§2) are already a fixed bonus computed independently of the main table-multiplier formula.
- **Anti-symmetric relics** -- break the player/enemy rule symmetry (§3) in the player's favor only: seeing an enemy's hand, or making an enemy's own table pile decay 1/turn (fighting the documented no-decay rule, §2, asymmetrically). A shape StS structurally can't offer, since its enemies don't run the player's own mechanics the way `chooseEnemyPlay` (`src/engine/enemyAI.ts`) does here.

**Why it's worth considering:** suit-bound and rider relics are cheap additive hooks that don't touch the core formula; anti-symmetric relics are the strongest "not a reskin" differentiator available, since they exploit the specific fact that enemies and the player run the same play loop.

**Open questions (raw, unresolved, anti-symmetric relics only):** acquisition path (likely the same reward-slot/shrine split already built); whether they need a cap so they don't trivialize "enemies play the same game" (§3), which is otherwise a core piece of Threshold's premise.

**Relationship to existing systems:** suit-bound/rider relics hook into `SuitDef.category` and `specialCards.ts`'s rider constants; anti-symmetric relics touch `enemyAI.ts` and the room's/enemy's own wipe rules (`tableState.ts`'s `wipeOwnerTable`) more invasively.

## Potions as one-shot claim/table manipulation, spent on the player's own timing

**Status: built** (`src/types/potions.ts`, `src/config/potions.ts`, `combatEngine.ts`'s `USE_FREE_CLAIM_POTION`/`USE_SALT_POTION`, `PotionControls.tsx`) -- both shapes below shipped as designed, acquired from a reward-screen slot (`POTION_REWARD_RATIO`), capped combined at `POTION_INVENTORY_CAP` (4) held at once, duplicates allowed unlike relics. Every open question below was resolved in favor of the simplest option (reward-slot-only acquisition, a combined cap, no loss on rest/reward pass) rather than left unresolved -- see `GAME_DESIGN.md` §2's "Potions" subsection for the shipped shape.

- **Free Claim** -- resolves a chosen suit's current table total as a flat 1:1 effect, without spending a play or a hand card. Deliberately weaker than a well-timed play (which multiplies), but free in every resource that matters -- mirrors how StS potions sidestep the energy/card economy rather than compete inside it.
- **Salt** -- deletes a room's own accumulated pile for one suit outright (same data path as `claimRoomCards`, but discarding instead of resolving an effect). A defensive answer to a threat suit that's grown large while the player holds none of that suit, which today has no counter besides eating the hit.

**Why it's worth considering:** both are one-line variations on `claimRoomCards` (resolve without multiplying / discard without resolving), cheap to prototype, and they target the exact mechanic -- accumulating, unclaimed room piles (§2) -- that's already the game's central tension, unlike a generic heal/damage potion that would work identically in any deckbuilder.

**Open questions (raw, unresolved):** acquisition (reward slot vs. rare table drop vs. shop purchase -- ties into the currency entry above); inventory cap and whether unused potions are lost at a rest/reward pass (StS-style "use it or lose it"); per-run pool vs. per-room refresh.

**Relationship to existing systems:** both act on `tableState.ts`'s `claimRoomCards`/`countTableSetSize`; neither touches the plays-pool (`CombatState.playsRemaining`, §2) or hand/discard cycling (§5) -- deliberately, since sitting outside those is the point.

## Scale rewards with room difficulty (counter the easiest-room incentive)

**Status: raw idea, unbuilt -- and a verifiable gap in the current reward code, not just a hypothetical.** `generateRewardOptions(depth, rng)` (`src/engine/rewardGenerator.ts`) keys reward quality only off floor depth -- the same 3-option/Quake/Special odds regardless of which room the player actually just cleared. But room difficulty already varies independently of floor: `sizeBand` (small/large table-deal size) is a uniform 50/50 coinflip per room (`roomGenerator.ts`'s `uniformPick(rng, ['small', 'large'])`), not floor-correlated, and enemy count is floor-weighted but still variable within a floor (`ENEMY_COUNT_WEIGHTS_EARLY`/`LATE`, §3). Since a door's size/color tags (§6) correlate with the next room's difficulty at `DOOR_CORRELATION_RATE` (75%), a player who wants easier fights can already lean toward "small" doors today with zero reward downside -- there's no equivalent of StS's elite-for-better-relic trade.

**Why it's worth considering:** without some reward coupling to difficulty, harder rooms are strictly worse to choose (more risk, same payout), undercutting the door-choice system's point as a meaningful decision -- especially once the current full-subtree door preview (§1, §6: "a deliberate, temporary state of full disclosure") is eventually dialed back to real tag-based signaling. Fixing the reward coupling and fixing the preview are complementary changes, not either/or -- but the coupling arguably matters more once information is imperfect again, since right now a player can already perfectly predict which door is "small."

Rough directions, grounded in Threshold's actual difficulty knobs rather than a flat StS reskin:

- Thread the cleared room's own `sizeBand`/enemy count into `generateRewardOptions` (instead of just `depth`), scaling option count or Quake/Special odds off them.
- The currency-from-overflow entry above partially solves this for free: a "large" room's bigger table piles naturally yield more currency on claim, without any reward-table changes.
- Add optional, non-final elite encounters (today `isElite` is reserved solely for the guaranteed floor-10 boss, §3) as a rare, clearly-tagged mid-run door option, trading a harder fight for a guaranteed relic/special-card slot -- the direct StS-elite analog.

**Open questions (raw, unresolved):** reward the room actually fought (post-hoc, requires threading the cleared room's params into `generateRewardOptions`) vs. reward the door chosen (pre-hoc, using the tag correlation itself as the risk); interaction with the doc's stated intent to dial back the full-tree reveal (§6).

**Relationship to existing systems:** touches `rewardGenerator.ts`'s `generateRewardOptions` and its call site in `runEngine.ts`'s `proceedToDoors` path; an optional-elite door would relax `roomGenerator.ts`'s current isElite-only-at-`RUN_MAX_DEPTH` restriction (§3); the currency angle links directly to the Overflow entry above.
