# Persistent player deck -- brainstorm record + implementation plan

**Start here if you're resuming this cold.** This document is self-contained: it records the options that were considered, the decision that was made, the two biggest design forks (already resolved), the remaining smaller forks (not yet resolved -- flagged explicitly), and a phased implementation plan. Read `PLAYTEST_FINDINGS.md` first for the data this is responding to; read `threshold-prototype-design.md` for the existing system this modifies. See also `MECHANIC_BRAINSTORM.md` for other ideas raised alongside this one (not part of this plan, not scheduled, but worth knowing about) -- notably "feed the pool," a proposed player/enemy action to deliberately grow a pile for a bigger future combo instead of only ever claiming or passing.

## Why this exists

`PLAYTEST_FINDINGS.md` (batch-simulated, n=500x2 profiles) found that **52.5% of player turns have zero legal claims** -- not "nothing worth doing," but no hand card matches anything left in the pool at all (Finding 2). Root cause: the player's hand is regenerated fresh every turn from the room's static suit ratios, completely blind to what a claim just removed from the pool. Hand and pool are statistically-identical twins drawn independently, with no shared memory between them.

Four directions were brainstormed to address this, smallest change to largest:

1. **Reweight the hand toward the pool's current contents** each redraw, instead of the room's static original ratios. Cheapest fix, directly targets the 52.5% number, but risks making claiming feel automatic if the coupling is too tight.
2. **Stop fully redrawing the hand every turn.** Revert to the original v0.2 design doc's intent (hand dealt once per room, only shrinks) so a temporarily-dead card is held (and can become live again later) rather than rerolled away blind.
3. **A true shared, depleting deck per room** -- pool and hand both draw from one shuffled room-deck instead of two independent generators. Literally answers "are they the same deck" with yes. Biggest lift of the small-to-medium options; needs discard/reshuffle rules and a rethink of where dry-pool-refill and Corrupt's `add-cards` pull new cards from.
4. **Decouple the hand from the room entirely: a persistent, run-level player deck**, grown via rewards between rooms (Slay-the-Spire/Dream-Quest pattern), instead of regenerated from whatever suits the current room rolled. Breaks the built-in "hand always has a shot at the pool" guarantee that suits-matched-to-room provided, so it needs a compensating mechanism -- see Fork 2 below. Full game-shape pivot: the round stops being "freshly re-rolled each time" and becomes part of a run-long deckbuilding arc.

A fifth, orthogonal lever was also flagged: **pool/hand supply currently doesn't scale with enemy count at all**, which is a likely deeper cause of Finding 1 (3-enemy rooms clear at 10.4% vs. 91.4% for 1-enemy rooms). That finding is **out of scope for this plan** -- it's a room/enemy-side fix, not a deck-construction one, and should be revisited separately (ideally re-measured with the simulator after this plan lands, since the two changes are independent and stacking them would make it hard to attribute results).

## Decision

**Going with #4** -- persistent, run-level player deck. Rationale (per the user): most rewarding direction, worth the bigger lift. This is a genuine game-shape change, not a tuning pass -- treat it as a new milestone (the design doc's next numbered section once built), not a quick patch.

## Fork 1 (resolved): hand cadence

**Decision: full discard & redraw each turn.** Whatever's unclaimed at the end of a player turn moves to the discard pile (recoverable later via reshuffle, never vanishes), then a fresh hand is drawn from the draw pile next turn -- closest to today's turn-to-turn cadence and the standard deckbuilder pattern. (The alternative -- unclaimed cards stay in hand, top up to hand size -- was considered closer to the original v0.2 doc's "hand only shrinks" intent, but was not chosen.)

## Fork 2 (resolved): suit-matching strictness

**Decision: keep exact-suit matching.** A hand card still needs to match a pool pile's exact suit to claim it -- claiming by category (any threat card claims any threat pile) was considered and rejected as too big a simplification; it would make suit almost cosmetic and remove a layer of the existing puzzle.

This means Fork 2's coverage risk is real and must be designed around: a persistent deck is not guaranteed to match whatever 1-2 threat suits a given room rolled, the way a room-derived hand was. Two things make this survivable rather than just reintroducing Finding 2 under a new name:

- **The door signal system already exists and currently does almost nothing strategically** (`SUIT_COLOR_FAMILY`, door `color`/`texture` tags correlate probabilistically with the next room's dominant suit family, but no player decision currently depends on reading it closely). A persistent deck gives that signal real teeth for the first time: pick doors that favor suits you've built toward, pick reward cards that favor suits your available doors are signaling. This is the intended payoff of going with #4 over the smaller options -- it's not just "fix the bug," it adds a new decision layer using a system that was already half-built.
- **Discard/redraw means a cold turn is temporary, not a wasted blind reroll.** Today, a dead hand is bad luck with no recourse. With a persistent deck, unclaimed cards cycle back through the discard pile and reshuffle, and a player who's noticed a suit isn't paying off can lean reward picks and door choices away from it over the run.

Residual risk to watch for explicitly in Phase 5's revalidation: does the new dead-hand rate actually drop, or does exact-suit-matching just relocate the problem from "random each turn" to "random which room you're in relative to your build"? This is an empirical question, not a design certainty -- measure it, don't assume it.

## Remaining open questions (not yet resolved -- recommendations given, confirm before/while implementing)

These are smaller than Forks 1-2 but still real decisions. Defaults are recommended so implementation isn't blocked, but flag them to the user rather than silently committing if anything looks off during build:

1. **Does the deck reshuffle fresh every room, or do draw/discard piles carry across the whole run?** *Recommended: fresh full-deck shuffle at the start of every room* -- this is the standard convention (Slay the Spire resets to a full shuffled draw pile at the start of every combat) and avoids weird carry-over edge cases (e.g. starting a dangerous 3-enemy room with a discard pile full of your best cards through no fault of play). `run.deck` (content) is the persistent thing; `combat.drawPile` / `discardPile` / `playerHand` are an ephemeral per-room shuffle of it.
2. **Reward cadence and shape.** *Recommended for MVP: choose 1 of 3 randomly-offered cards after every cleared room, no removal/upgrade options yet.* Deck-thinning (remove a card) or upgrades are natural follow-ups once the base loop is validated, not required for the first slice.
3. **Where does the Quake card live now?** Today it's a probabilistic mint during hand generation (`QUAKE_CARD_RATIO`). *Recommended: Quake becomes a reward-pool card offered at a low weight*, not a starter-deck card -- preserves its "rare, exciting" feel without a bespoke spawn mechanic.
4. **Where does a Corrupt `force-discard` send the card?** *Recommended: discard pile (recoverable via the next reshuffle)*, not a permanent exhaust -- an enemy's routine action permanently deleting a card from your deck for the rest of the run would be a much harsher and swingier effect than force-discard currently is, and nothing in the design intent calls for that escalation.
5. **Starting deck composition** -- needs a first-cut concrete list, e.g.: `3x Wolf, 3x Ember, 3x Rot, 3x Spider, 2x Grace, 2x Ward, 1x Hex, 1x Venom, 1x Vigor` (19 cards). This is a balance surface like every ratio constant already in the game -- expect to retune after Phase 5 data, not before.

## What does NOT change

- **Room/pool generation is untouched.** `roomGenerator.ts`'s pool construction (`generateWeightedDeck` against `threatSuits`, `THREAT_SUIT_COUNT_BY_SIZE_BAND`, pool size bands) stays exactly as-is. This keeps Findings 1/3/4 (enemy count lethality, enemy lockstep, decay asymmetry) independently testable -- this plan only touches the player's side of the table.
- **Claim resolution, decay, statuses, enemy patterns** -- all unchanged. `combatEngine.ts`'s `performClaim`/`tickDecay`/`resolveEnemyTurn` logic is untouched; only where `playerHand` *comes from* changes.

## Implementation plan

### Phase 1 -- Core data model + draw/discard engine (no UI, no rewards yet)

- Add `deck: Card[]` to `RunState` (`types/run.ts`), initialized from a new `STARTER_DECK: Card[]` constant (`config/constants.ts`) in `createNewRun`.
- Add `drawPile: Card[]` and `discardPile: Card[]` to `CombatState` (`types/combat.ts`).
- New pure module, e.g. `engine/deckState.ts`:
  - `shuffleDeck(deck: Card[], rng: Rng): Card[]` (Fisher-Yates using the existing seeded `Rng`, so runs stay reproducible).
  - `drawCards(drawPile: Card[], discardPile: Card[], n: number, rng: Rng): { drawn: Card[]; drawPile: Card[]; discardPile: Card[] }` -- draws `n` cards, reshuffling `discardPile` into a fresh `drawPile` mid-draw if it runs out (standard deckbuilder reshuffle-on-empty; needs a unit test for the exact-boundary case where the draw pile empties on the last card needed).
- Remove `RoomInstance.playerHandDeal` (`types/room.ts`) and its generation in `roomGenerator.ts` -- hand no longer comes from room generation at all.
- `combatEngine.initCombat` gains a `playerDeck: Card[]` parameter: shuffles it into a fresh `drawPile`, draws the starting hand via `drawCards`, sets `discardPile: []`. Update `runEngine.startFirstRoom` and `runEngine.chooseDoor` (both currently call `initCombat`) to pass `run.deck`.
- Replace `drawFreshHand` (currently ratio-based `generateWeightedDeck`) in `combatEngine.ts`'s `endTurn` with: move current `playerHand` to `discardPile`, then `drawCards` a fresh hand from `drawPile`/`discardPile` for `PLAYER_HAND_SIZE`. Delete `drawFreshHand` and the now-dead `HAND_REDRAW_EACH_TURN` branch (this plan's chosen cadence makes the "false" branch of that flag meaningless -- simplify rather than keep a dead toggle).
- `performClaim`: claimed hand cards currently just vanish from `playerHand` (filtered out). Change to route them into `discardPile` instead of dropping them (they're claimed, not removed from the deck -- they should come back around next reshuffle).
- Update `surpriseEffects.ts`'s `resolveForceDiscard` (or its call site) so a force-discarded card goes to `discardPile`, per open question 4.
- Unit tests (extend `combatEngine.test.ts` / new `deckState.test.ts`): reshuffle-on-empty correctness, claimed cards reappear in a later draw within the same room, deck composition is stable across a room (no cards gained/lost outside of claims/discards).

### Phase 2 -- Reward flow

- New `RunPhase` value: `'reward'` (`types/run.ts`), sequenced between `room-cleared` and `door-choice`.
- New module `engine/rewardGenerator.ts`: `generateRewardOptions(depth: number, rng: Rng): Card[]` -- 3 distinct cards, uniform pick across non-Quake suits at MVP (per open question 2/3), Quake included at a low weight.
- `runEngine.ts`: `resolveCombatEnd`'s `room-cleared` branch now transitions to `'reward'` instead of straight to door generation; new `chooseReward(run: RunState, cardId: string): RunState` appends the chosen card to `run.deck` and *then* proceeds to the existing door-generation logic (reuse, don't duplicate, the current `room-cleared -> door-choice` transition code).
- Unit tests: reward options are deterministic given the seed, chosen card actually lands in `run.deck` and is present in the *next* room's shuffled draw pile.

### Phase 3 -- Constants cleanup

- Add `STARTER_DECK` (see open question 5's strawman).
- Remove now-dead constants/usages: `HAND_REDRAW_EACH_TURN`, `QUAKE_CARD_RATIO`'s use in hand generation (Quake moves to the reward pool -- see `rewardGenerator.ts`), and any `generateWeightedDeck` call sites that existed only to build a hand (pool-side calls are untouched).
- Leave `ON_SUIT_RATIO` etc. as pool-only constants now (they no longer do double duty for hand generation) -- rename if the dual-purpose naming becomes confusing, but not required for correctness.

### Phase 4 -- UI

- New minimal `RewardScreen` (`ui/screens/`): shows the 3 offered cards, lets the player pick one, calls `chooseReward`.
- `HandDisplay` or a new small component: show draw pile / discard pile counts (players expect this in any deckbuilder UI; also useful for debugging "why did I just get the same 3 cards twice").
- `App.tsx`: route the new `'reward'` `RunPhase` to `RewardScreen`.
- **Update `scripts/playtest.ts`** (the interactive text CLI) to handle the `reward` phase with a new `reward <cardIndex>` command, and to display draw/discard pile sizes in its state render -- this tool is how we playtest, so it needs to stay in sync with the engine or it silently goes stale.

### Phase 5 -- Re-validate against the batch simulator

- Update `scripts/playtest-sim.ts`'s bot: handle the new `reward` phase (simple heuristic -- e.g. pick whichever offered card's suit currently has the most live copies in `run.deck`, or the door-signaled suit if that's wired in yet; doesn't need to be optimal, same "greedy competent, not a solver" bar as the existing bot).
- Re-run at the same scale as `PLAYTEST_FINDINGS.md` (n=500, seeds 1-500, both aggro/defensive profiles) and compare, specifically:
  - **Dead-hand rate** (was 52.5% -- did this actually drop, and by how much? This is the metric this whole plan is trying to move).
  - **Win rate / depth reached** (was 0% / 1.24 avg -- expect this to move somewhat from deck growth over a run, but Finding 1's enemy-count cliff is explicitly out of scope here, so don't expect this alone to fix survivability; separate that signal out when interpreting results).
  - **Guard-waste and big-spike numbers** (Findings 5/6) -- should be roughly unaffected since claim resolution didn't change; a large shift here would flag an implementation bug, not a design result.
- Append a new dated section to `PLAYTEST_FINDINGS.md` with the comparison, rather than overwriting the original -- the pre-change baseline stays valuable for attribution.

### Phase 6 -- Design doc housekeeping

- Once built and validated, add a new numbered section to `threshold-prototype-design.md` (following its existing "Status: built" convention) documenting the persistent-deck system and superseding the relevant parts of section 4's hand-generation description, the same way 4.7/4.8/4.9 each superseded the section before them.
