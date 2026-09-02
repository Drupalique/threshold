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

**Status: built** (`CURRENCY_CLAIM_THRESHOLD`/`SHOP_*` constants in `config/constants.ts`, `combatEngine.ts`'s `applyCurrencyOverflow`, `types/room.ts`'s `ShopRoomInstance`, `runEngine.ts`'s `buyShopOption`/`leaveShop`, `ShopScreen.tsx`) -- seeds currency directly off the claim mechanic that's already central to the game, rather than a kill-counter or a flat per-room drop (StS's gold): when a claim -- a real play, or a Free Claim/Salt potion use -- reads a room-owned pile (`tableState.ts`'s `roomOwnedCount`) above `CURRENCY_CLAIM_THRESHOLD` (5), the amount over the threshold converts 1:1 into currency. A shop room reuses the `RoomInstance` discriminated union and dedicated-`RunState.phase` shape rest rooms/shrines already proved out (§6, §11), generated live (like a shrine) rather than precomputed in the tree, since its offer must exclude held relics/respect the potion cap.

**Why it's worth considering:** ties currency generation to the thing Threshold specifically rewards -- big, patient claims -- rather than layering on an unrelated resource. It's a payoff for the existing "let the room pile grow" tension (§2), not a second economy competing with it.

Every open question below was resolved rather than left unresolved:
- **Threshold size**: `CURRENCY_CLAIM_THRESHOLD = 5`, the doc's own suggested starting point -- first-cut, not balance-tested (a `playtest-sim.ts` batch run left most runs holding single-digit currency by run end against an 8-currency card price, so this and the `SHOP_*` prices are an early tuning surface, not final).
- **Persistence**: currency persists for the whole run, like the deck/relics/potions -- not reset per room.
- **Potion scope**: Free Claim and Salt also generate currency when they claim a room pile, not just real plays -- both go through the same `applyCurrencyOverflow` real plays do.
- **Shop's pile**: moot given "no backtracking" -- a shop room is a one-time stop like a rest room or shrine, its offer generated fresh (off `run.rng`) the moment it's entered, never revisited.
- **Acquisition path**: a new `RoomInstance` kind (`ShopRoomInstance`) a door can lead to, via its own `SHOP_ROOM_RATIO` alongside `REST_ROOM_RATIO`/`SHRINE_ROOM_RATIO` in `runTree.ts` -- not a door-choice-slot-consuming variant. A single visit can buy multiple offered slots (one at a time, price deducted each purchase, `runEngine.ts`'s `buyShopOption`) rather than an exclusive pick-1, which is what actually delivers "a wider offering" per this entry's own framing rather than a reskinned reward screen.

**Relationship to existing systems:** builds on `tableState.ts`'s `claimRoomCards`/`roomOwnedCount` and the `RoomInstance.kind` union rest rooms/shrines established (§6); doesn't touch the play formula (§2) or riders (§2). Shop offer generation (`rewardGenerator.ts`'s `generateShopOptions`) reuses the reward screen's own category weights/held-relic/potion-cap exclusion logic wholesale, just stamping a fixed price per `optionType` instead of the reward screen's free pick.

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

## New status effects: Vulnerable, Regen, Haste, Slow

**Status: decided direction, unbuilt.** Discussed as a deliberate first move ahead of new card mechanics, since the three existing statuses (`STATUS_DEFS`, `src/types/status.ts`) are cheap vocabulary that new special cards/relics/Quake-likes can spend, and are all symmetric (player and any enemy can hold/inflict any of them). Four additions, agreed on:

- **Vulnerable** (debuff) -- the mirror of Weaken: while held, incoming threat damage is increased by a flat `VULNERABLE_PCT` instead of the outgoing-damage cut Weaken applies. Same stack-is-duration-only shape as Weaken (`GAME_DESIGN.md` §4) -- 1 stack and 10 stacks apply the same bump, the count only gates how many of the holder's own turns it survives.
- **Regen** (buff) -- the mirror of Poison: heals the holder for its current stack count at end of the holder's own turn, then decays by 1, reusing Poison's exact tick/decay shape (`engine/statusEffects.ts`) with the sign flipped and healing instead of damaging.
- **Haste** (buff) / **Slow** (debuff) -- the first statuses to touch the *plays pool* (`CombatState.playsRemaining`) rather than a play's magnitude: at the start of the holder's own turn, the base allotment (`PLAYS_PER_TURN_BASE` for the player, `ENEMY_PLAYS_PER_TURN` for an enemy) is adjusted by +1/-1 per stack before being seeded, floored at 0, then decays by 1 same as every other status. A real new threat/reward shape distinct from "hits harder" -- an enemy inflicting Slow can, for one turn, take away the player's ability to chain plays the way Quake grants it; a 1-play enemy hit with Slow simply skips its turn's play entirely, which reads as a stun and is an acceptable, intentional edge case.

Frenzy (an alternate-Strength status boosting the hand-count term instead of the table-count term) was raised alongside these and explicitly discarded -- decided not worth the added axis for now.

**Open question shared by all four:** unlike Weaken/Poison/Strength, none of these has a natural home suit -- all nine suits (`SUIT_DEFINITIONS`, `src/config/constants.ts`) already have a fixed category, and there's no free slot to bolt a 10th status onto without either adding a new suit (dilutes `ON_SUIT_RATIO`/the other draw ratios, costs table real estate) or decoupling suit from effect (the still-unbuilt idea earlier in this doc). Recommended default: deliver these the same way relics already do (`config/relics.ts`'s `status-on-claim` effect, e.g. Alpha's Snare) and/or as a named special's rider (a new `RiderEffect` kind, `inflict-status`, alongside `bonus-damage`/`bonus-guard`) rather than as a dedicated suit -- additive, doesn't touch draw ratios, and reuses two mechanisms (relics, riders) that already exist for exactly this "small bonus tacked onto an existing play" shape. Dedicated suits remain a bigger possible follow-up if these four turn out to want to be primary, not secondary, effects.

**Relationship to existing systems:** `types/status.ts`'s `StatusId`/`StatusBag`/`STATUS_DEFS`, `engine/statusEffects.ts`'s shared apply/decay logic, `combatEngine.ts`'s turn-start `playsRemaining` seeding (for Haste/Slow specifically).

## Guard-strip ("Sunder") -- instant Guard removal, replacing the Brittle idea

**Status: decided direction, unbuilt.** An earlier brainstorm pass proposed "Brittle," a decaying debuff stack that made incoming threat damage bypass Guard entirely (the same exemption Poison already gets, §4) for as long as it was held. Superseded by a simpler, non-stack idea: an instant effect that strips some or all of the target's *currently banked* Guard outright, the same instant-and-gone shape Salt already uses on a room pile (`combatEngine.ts`'s `resolveSaltEffect`) rather than a StatusBag stack -- Guard itself never decays on its own (§7: "persists indefinitely... until it actually absorbs damage"), so a debuff that *decays* felt like the wrong shape for something that's fundamentally a one-time strip.

Natural vehicle: a new `RiderEffect` kind (`guard-strip`, amount = flat Guard removed, capped at the target's current Guard so it can't go negative) fired the same way `bonus-damage`/`bonus-guard` riders already fire from a named special or a relic's rider-bonus effect -- no new per-turn state, no decay logic, just a third rider kind alongside the two that exist (`types/specialCards.ts`'s `RiderEffect`).

**Open questions:** which suit(s) carry it -- Hex is the thematic fit (an existing debuff suit, "wearing down defenses" reads as consistent with Weaken), but assigning it there changes what Hex's *basic* per-suit rider means for every plain Hex card, not just a named special, which is a real balance decision rather than a pure addition; safer to introduce it first as a single named special's rider (or a shrine/shop relic) and only promote it to the basic-rider default once it's been played with. Whether it should ever go the other direction (an enemy stripping the *player's* Guard) -- symmetric by default like everything else in this game (§3), but worth flagging since it's a harder counter to a Ward-stacking defensive turn than anything that exists today.

**Relationship to existing systems:** `types/specialCards.ts`'s `RiderEffect`, `combatEngine.ts`'s `applyRiders`, `tableState.ts`'s Guard-absorption path; conceptually parallel to `resolveSaltEffect`'s "instant discard, no stack, no decay" shape.

## AOE: three tiers, all three agreed worth building

**Status: decided direction (all three), unbuilt.** Directly answers the original prompt ("a claimed pile hits all enemies"), scoped into three sizes precisely so the game gets a cheap version immediately and the expensive version stays contained once it's clear how much power multi-target actually needs. Agreed to pursue all three, roughly in this order:

1. **Splash rider** -- a new `RiderEffect` kind, `bonus-damage-aoe`, carried by a named special (or a relic): instead of adding its bonus to the play's one chosen target, it adds a (smaller) flat amount to *every* alive enemy. Cheapest by far -- riders are already "a fixed bonus, not a multiplier" (§2), so this only needs a new kind and a loop over alive enemies instead of one target. `specialCardsBySuit` (`config/specialCards.ts`) already returns an array per suit, i.e. the code already anticipates more than one named special per suit -- a clean slot for "the AOE-flavored signature" alongside today's single-target one, no new data shape.
2. **Cleave setup card** -- a suitless, hand-only card in Quake's own shape (`types/cards.ts`'s `QuakeCard`, `combatEngine.ts`'s `PLAYER_PLAY_QUAKE`): playing it doesn't resolve a set itself, it flags that the *next* threat play this turn resolves against every alive enemy instead of one chosen enemy, then is discarded/cycles back like any other card. Keeps the core `tableCount x handCount` formula completely untouched -- it only widens who the resolved magnitude lands on, for exactly one play.
3. **True AOE named special** -- the play's entire resolved magnitude (not just a rider) hits every alive enemy, undivided, no reduction. The strongest version, and probably needs a real cost to avoid strictly outclassing single-target play of the same suit -- candidates: suit-locked to one or two suits only, gated to rare/shop-only acquisition, or a lower `RIDER_AMOUNT`-style multiplier tax. Build last, once (1) and (2) show whether multi-enemy rooms actually need something this strong.

**Open questions:** exact `bonus-damage-aoe` tuning relative to `BASIC_RIDER_AMOUNT`/`RIDER_AMOUNT`; whether Cleave (tier 2) costs a play the way Quake's own grant doesn't; tier 3's gating mechanism specifically.

**Relationship to existing systems:** `types/specialCards.ts`'s `RiderEffect`, `config/specialCards.ts`'s `SPECIAL_CARD_DEFS`/`specialCardsBySuit`, `types/cards.ts`'s `Card` union (tier 2 needs a new suitless card kind alongside `QuakeCard`), `combatEngine.ts`'s `performPlay` target-resolution branch (currently always single-enemy for threat/Hex/Venom, §2).

## Card upgrades -- shape not yet decided, needs more exploration

**Status: raw idea, explicitly not decided.** Agreed upgrades are worth having (deck growth today is exclusively additive -- one uniform-random-suit card per cleared room, §5 -- with no way to make an existing card better), but not yet which of two very different shapes it should take:

- **Promote** -- assign the suit's existing named-special `specialId` (`types/cards.ts`'s `CreatureCard.specialId`) to a plain card the player already owns, turning it into (e.g.) that Wolf card specifically into an Alpha Wolf. Zero new data: `specialId` already exists, `riderForCard` (`config/specialCards.ts`) already looks it up. Duplicates aren't a new risk either -- the reward pool can already hand out two Alpha Wolves independently via `SPECIAL_REWARD_RATIO`, so promoting into an already-held special isn't introducing anything the game doesn't already allow.
- **Reinforce** -- flat, stacking bonus to *that specific card's own* rider amount, independent of the named-special system entirely (e.g. a card's basic rider goes from `BASIC_RIDER_AMOUNT` to +1 above it, then +1 again). Needs a new field on `CreatureCard` (something like `riderBonus: number`) and a change to `riderForCard` to add it on top of whichever rider (basic or named) the card already resolves -- more plumbing than Promote, but composable (a card can be upgraded repeatedly, including a named special).

**Open questions:** Promote and Reinforce aren't mutually exclusive -- could ship one, the other, or both as separate levers; which cards are eligible (any owned card vs. only plain ones, for Promote); where the upgrade action itself is offered (see the reward-slot/rest-room/shrine/shop pattern the venue questions below all share) is a second, separate decision from which shape upgrading takes.

**Relationship to existing systems:** `types/cards.ts`'s `CreatureCard`, `config/specialCards.ts`'s `riderForCard`/`specialCardById`, and whichever room-phase venue is picked (see venue questions below).

## Suit reroll ("Transform") -- guaranteed different suit

**Status: decided mechanic, venue undecided.** Reroll a chosen deck card into a random card of a *different* suit (guaranteed-different, not just possibly-different) -- directly answers the persistent-deck suit-diversity gap `GAME_DESIGN.md` already flags twice as unresolved (§5's "Known risk," §10's first bullet): a 9-suit-diverse deck rarely matches the 1-2 threat suits a given room's table actually deals, and today the only lever against that is rest-room removal (§6), which shrinks the deck but can't retarget it.

**When would this occur? -- raised by the user, still open.** Candidate venues, not yet chosen between:
- **Shop purchase** -- a priced action (pick a deck card, pay currency, it rerolls), same purchase shape `buyShopOption` already has for cards/relics/potions (§6) but sourced from the player's own deck instead of a fresh slot. Favored candidate: repeatable, optional, and spends the resource (currency, §2) that's specifically designed to reward the "let a pile grow" pattern -- a natural sink alongside cards/relics/potions.
- **Shrine option** -- shrines (`ShrineRoomInstance`) currently offer relics only (`generateShrineOptions`, `rewardGenerator.ts`); could fold in a transform slot alongside relic choices, since a shrine visit is already "pick one from a live-generated set of options."
- **Rest-room third option** -- rest rooms (§6) are currently a strict binary (Rest vs. Remove), StS-campfire-style; adding a third mutually-exclusive option is a bigger change to that room kind's shape than the other two venues, since `RestRoomInstance` and `RestScreen.tsx` are both built around exactly-one-of-two.
- **Reward-screen slot** -- alongside add-a-card/Quake/special/relic/potion (§5), competing directly against "add a new random card" as an alternative use of the same pick.

No venue chosen yet -- worth deciding once Upgrade's venue (above) and Duplicate's venue (below) are decided together, since a shop offering Transform + Duplicate + Upgrade all as purchasable actions is a coherent story ("currency buys deck control"), whereas splitting them across shop/shrine/reward risks diluting what each room type is *for*.

**Relationship to existing systems:** `RunState.deck` mutation (same category of operation as `restRemoveCard`, just replacing rather than deleting); whichever venue is picked reuses that venue's existing option-generation/purchase machinery.

## Duplicate an owned card -- venue undecided

**Status: decided mechanic, venue undecided.** Reward/purchase option: copy a card already in the deck, instead of adding a random new suit. Turns "I'm committed to Wolf" into a deliberate choice instead of hoping uniform random rewards cooperate -- the direct opposite lever from Transform (above), which pivots *away* from a suit; Duplicate leans *further into* one.

Three shapes were raised, differing in how permanent the copy is:
- **Room type** -- a dedicated node kind, like rest/shrine/shop, whose only offer is "pick one deck card, get a permanent second copy." Simplest to reason about but adds a fourth non-combat room kind for a single action, which may be more machinery than the action deserves.
- **Shop purchase** -- priced action alongside Transform/Upgrade in the same "currency buys deck control" venue discussed above; lowest incremental lift if Transform ends up living in the shop too, since it's the same purchase flow with a different source (copy an owned card vs. reroll one).
- **Temporary in-combat duplicate** -- a fundamentally different, lower-commitment shape: a copy that exists for the current room/fight only, closer to a consumable (a potion-like one-shot, or a relic-triggered effect) than a permanent deck change. Bigger lift than the other two since it needs a "this card expires at room end" lifecycle nothing in the deck currently has (§5's hand/discard cycle assumes everything in `run.deck` is permanent).

**Recommendation, not yet agreed:** start with the shop-purchase shape -- it reuses `buyShopOption`'s existing flow almost exactly (source the new card from an owned-card pick instead of a fresh reward slot) -- and treat the temporary/consumable shape as a distinct, later idea (closer in spirit to Free Claim/Salt potions, §2, than to permanent deck growth) rather than a first cut.

**Relationship to existing systems:** `RunState.deck` append (same shape as a reward pick or `buyShopOption`'s card purchase); the temporary variant would need new lifecycle plumbing alongside `RunState.potions`/`CombatState`.

## Reward weighting toward the cleared room's threat suits

**Status: decided direction, unbuilt.** Agreed as the fix for the exact gap "Scale rewards with room difficulty" (above) and `GAME_DESIGN.md` §5/§10 already flag: `generateRewardOptions(depth, rng)` currently weights every suit uniformly across all 9 regardless of which room was just cleared, so "grow the deck" and "the deck actually matches what rooms deal" are today two unrelated processes. Fix: bias reward-suit odds toward the cleared room's own `RoomParams.threatSuits` (§2) instead of uniform-across-all-9 -- still leave a smaller uniform tail so off-suit variety isn't impossible, just no longer equally likely.

Pairs naturally with Transform (above): reward-weighting steers new cards *toward* coherence going forward, Transform lets a player retroactively fix cards already in the deck that don't fit -- one without the other only solves half the gap.

**Open questions:** exact weighting split (e.g. an `ON_SUIT_RATIO`-style constant reused/mirrored for rewards); whether this reads the room's `threatSuits` (deterministic, known at generation) or something coarser.

**Relationship to existing systems:** `rewardGenerator.ts`'s `generateRewardOptions` and its `runEngine.ts` call site (`proceedToDoors`); needs the cleared room's own `RoomParams` threaded into that call, which it isn't today.

## Enemy selection biased toward room threat suits -- flagged risk, not decided

**Status: raised, explicitly flagged as maybe-not-a-good-idea, unresolved.** Companion idea to reward-weighting above: bias `pickEnemies`' currently-uniform-among-eligible-defs selection (§3, itself already documented as "a known open tuning gap") toward enemies whose own primary suit matches the room's `threatSuits`, so a room dealing heavy Wolf on the table is also more likely to be fought against Wolf-affiliated enemies rather than, say, a Grace-primary healer sitting incongruously in a wolf-storm.

**The concern, raised in the same breath as the idea:** this isn't free -- an enemy's own deck is a separate accumulation from the room's table pile (an enemy's played cards go to that enemy's own `ownerId`-tagged pile, not the room's, §2), so matching suits doesn't let an enemy directly benefit from the table pile the player is drawing from. But it does mean the enemy's own kit is now correlated with whichever suit the table is already dumping hardest -- e.g., a Wolf-threat room fighting Wolf-kin (whose deck leans Vigor/self-buff on top of contributing to the same Wolf pressure) reads as thematically tight but is a real, if indirect, difficulty bump over today's uncorrelated pairing. Worth noting the game already has precedent for "correlated but not deterministic" via `DOOR_CORRELATION_RATE` (75%, §6) -- a partial-correlation knob on enemy selection (rather than a hard match) would capture the thematic coherence without fully compounding the difficulty spike, and is the recommended shape *if* this gets built at all.

**Open questions:** whether to build this at all (unresolved, not just unscoped); if built, correlation rate; whether it should be floor-gated the way `ENEMY_COUNT_WEIGHTS_EARLY/LATE` already ramps difficulty by floor (§3), so the correlation (and its implicit difficulty bump) only kicks in once the run is already ramping up anyway.

**Relationship to existing systems:** `roomGenerator.ts`'s `pickEnemies` (currently uniform among `minFloor`-eligible defs); `RoomParams.threatSuits`; conceptually parallel to `DOOR_CORRELATION_RATE`'s existing partial-correlation pattern (§6).
