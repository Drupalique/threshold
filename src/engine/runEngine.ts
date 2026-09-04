import type { RunState } from '../types/run';
import type { Door } from '../types/door';
import type { CombatRoomInstance } from '../types/room';
import type { CombatAction } from '../types/combat';
import type { Card, CreatureCard } from '../types/cards';
import type { SuitId } from '../types/suits';
import { createRng, type Rng } from './rng';
import { buildRunTree } from './runTree';
import { initCombat, applyCombatAction as combatApplyAction } from './combatEngine';
import { generateRewardOffer, generateShrineReward, generateShopOptions, REWARD_SUITS } from './rewardGenerator';
import { uniformPick, pickDistinct } from './weightedPick';
import { specialCardsBySuit } from '../config/specialCards';
import { PLAYER_HP_MAX, REST_HEAL_PCT, RUN_MAX_DEPTH, STARTER_ATTACK_SUIT_COUNT, THREAT_SUITS, buildStarterDeck } from '../config/constants';

// Picks STARTER_ATTACK_SUIT_COUNT distinct threat suits for a run's starter
// deck (see constants.ts's buildStarterDeck, which pairs these with the
// single guard suit it always includes on its own). Reward/shop offers
// aren't narrowed to this pool (REWARD_SUITS stays all 9) -- only the
// starting point is shaped this way, so a player grows back into suit
// variety at their own pace.
function pickStarterAttackSuits(rng: Rng): SuitId[] {
  return pickDistinct(rng, THREAT_SUITS, STARTER_ATTACK_SUIT_COUNT);
}

export function createNewRun(seed: number): RunState {
  const rng = createRng(seed);
  const deck = buildStarterDeck(pickStarterAttackSuits(rng));
  return {
    seed,
    rng,
    runTree: buildRunTree(seed, RUN_MAX_DEPTH),
    currentPath: '',
    depth: 0,
    maxDepth: RUN_MAX_DEPTH,
    playerHP: PLAYER_HP_MAX,
    playerHPMax: PLAYER_HP_MAX,
    phase: 'start',
    deck,
    relics: [],
    potions: [],
    currency: 0,
    rewardOffer: null,
    shopOptions: null,
    pendingDeckAction: null,
    currentDoors: null,
    combat: null,
  };
}

export function startFirstRoom(run: RunState): RunState {
  const node = run.runTree.nodes[run.currentPath];
  // The floor-1 root is always a combat room (see runTree.ts's buildRunTree
  // -- the very first room has no door choice, so it can never roll rest).
  const combat = initCombat(node.room as CombatRoomInstance, run.rng, run.playerHP, run.playerHPMax, run.deck, run.relics, run.potions, run.currency);
  return { ...run, phase: 'combat', combat };
}

/**
 * Applies a combat action but deliberately does NOT transition the run
 * phase away from 'combat' even when the action ends the round (death or
 * clear) -- the caller (CombatScreen) stays mounted for a beat so the meter
 * bars can animate to their final value, same as any other turn, instead of
 * cutting straight to the door-choice/run-end screen. Call resolveCombatEnd
 * afterward (typically after a short delay) to actually advance the phase.
 */
export function applyCombatAction(run: RunState, action: CombatAction): RunState {
  if (!run.combat || run.phase !== 'combat') return run;
  const nextCombat = combatApplyAction(run.combat, action, run.rng);
  return { ...run, combat: nextCombat, playerHP: nextCombat.playerHP, potions: nextCombat.potions, currency: nextCombat.currency };
}

/**
 * Advances the run phase once `run.combat.status` is no longer 'active'. A
 * cleared room goes to the 'reward' phase (chooseReward below advances it to
 * door-choice from there) rather than straight to door generation -- unless
 * this was the run's last room, in which case there's nothing left to
 * reward for.
 */
export function resolveCombatEnd(run: RunState): RunState {
  if (!run.combat || run.phase !== 'combat' || run.combat.status === 'active') return run;

  if (run.combat.status === 'player-dead') {
    return { ...run, phase: 'run-over' };
  }

  // room-cleared
  const newDepth = run.depth + 1;

  if (newDepth >= run.maxDepth) {
    return { ...run, depth: newDepth, phase: 'run-complete' };
  }

  // The just-cleared room's own threatSuits (still readable off run.combat
  // here, before it's cleared below) bias the reward's card-row suit odds --
  // MECHANIC_BRAINSTORM.md's "Reward weighting toward the cleared room's
  // threat suits".
  const rewardOffer = generateRewardOffer(newDepth, run.rng, run.relics, run.potions, run.combat.roomParams.threatSuits);
  return { ...run, depth: newDepth, phase: 'reward', rewardOffer };
}

/**
 * Shared tail for both chooseReward and (in principle) any other
 * reward-phase exit -- surfaces the current tree node's precomputed door
 * pair (see runTree.ts's buildRunTree) rather than generating one live, so
 * the doors on offer are exactly what the seed already fixed for this path.
 */
function proceedToDoors(run: RunState): RunState {
  const node = run.runTree.nodes[run.currentPath];
  const doorRefs = node.doors!;
  const doors: Door[] = doorRefs.map((d) => ({
    id: `door-${d.childPath}`,
    tags: d.tags,
    childPath: d.childPath,
  }));

  return { ...run, phase: 'door-choice', currentDoors: doors };
}

/**
 * Appends the chosen card (by id, from rewardOffer.cardOptions) to the
 * persistent deck, then proceeds to door generation -- unlike
 * claimRewardRelic/claimRewardPotion below, picking a card is exclusive
 * (only one of the offered cards can ever be taken) and always ends the
 * reward phase, since the card row is the reward screen's one real
 * either/or decision. Any relic/potion row still sitting unclaimed in
 * rewardOffer is simply left behind, same as clicking Pass would leave it.
 */
export function chooseReward(run: RunState, cardId: string): RunState {
  if (run.phase !== 'reward' || !run.rewardOffer) return run;
  const chosen = run.rewardOffer.cardOptions.find((c) => c.id === cardId);
  if (!chosen) return run;
  return proceedToDoors({ ...run, deck: [...run.deck, chosen], rewardOffer: null });
}

/** Adds the offered relic to held relics and clears it off the offer, but stays in the reward phase -- claiming a relic doesn't end the visit, since it's an independent row from the card choice (see types/run.ts's RewardOffer). A no-op if no relic is currently on offer (already claimed, or never rolled). */
export function claimRewardRelic(run: RunState): RunState {
  if (run.phase !== 'reward' || !run.rewardOffer?.relic) return run;
  const relic = run.rewardOffer.relic;
  return { ...run, relics: [...run.relics, relic], rewardOffer: { ...run.rewardOffer, relic: null } };
}

/** Adds the offered potion to held potions and clears it off the offer, but stays in the reward phase -- same independent-row shape as claimRewardRelic. A no-op if no potion is currently on offer. */
export function claimRewardPotion(run: RunState): RunState {
  if (run.phase !== 'reward' || !run.rewardOffer?.potion) return run;
  const potion = run.rewardOffer.potion;
  return { ...run, potions: [...run.potions, potion], rewardOffer: { ...run.rewardOffer, potion: null } };
}

/**
 * Leaves whatever's still unclaimed on the offer behind and proceeds to
 * door generation -- the general "I'm done here" exit from the reward
 * phase. Whatever the player already took via chooseReward/
 * claimRewardRelic/claimRewardPotion stays taken; this only ever discards
 * what's left in rewardOffer, never anything already applied to
 * deck/relics/potions.
 */
export function skipReward(run: RunState): RunState {
  if (run.phase !== 'reward') return run;
  return proceedToDoors({ ...run, rewardOffer: null });
}

export function chooseDoor(run: RunState, doorId: string): RunState {
  if (run.phase !== 'door-choice' || !run.currentDoors) return run;
  const chosen = run.currentDoors.find((d) => d.id === doorId);
  if (!chosen) return run;
  const node = run.runTree.nodes[chosen.childPath];
  if (!node) return run;

  // The unchosen door's subtree is never played, but -- unlike before --
  // it isn't discarded from state either: the whole tree was precomputed
  // up front (buildRunTree) and stays there for the run's lifetime so dev
  // tooling can show it (see ui/screens/RunTreeScreen.tsx). "No
  // backtracking" is enforced at the play level (currentPath only ever
  // advances), not by deleting data.
  const base = { ...run, currentPath: chosen.childPath, currentDoors: null };

  if (node.room.kind === 'rest') {
    return { ...base, phase: 'rest' as const, combat: null };
  }

  if (node.room.kind === 'shrine') {
    // Resolves into the same 'reward' phase/RewardScreen a cleared combat
    // room uses -- just with an empty cardOptions and only its relic row
    // populated (see types/room.ts's ShrineRoomInstance, types/run.ts's
    // RewardOffer). Depth advances immediately, same timing as
    // resolveCombatEnd's own reward generation, since a shrine's reward
    // phase exits via the same plain proceedToDoors chooseReward/
    // claimRewardRelic/skipReward already use, not finishSideRoom's
    // exit-time increment. Generated live off run.rng, not precomputed in
    // the tree -- see ShrineRoomInstance for why (it must exclude relics
    // the player already holds by the time they arrive).
    const newDepth = run.depth + 1;
    if (newDepth >= run.maxDepth) {
      return { ...base, depth: newDepth, phase: 'run-complete' as const };
    }
    const rewardOffer = generateShrineReward(run.rng, run.relics);
    return { ...base, depth: newDepth, phase: 'reward' as const, combat: null, rewardOffer };
  }

  if (node.room.kind === 'shop') {
    // Generated live off run.rng, not precomputed -- see types/room.ts's
    // ShopRoomInstance for why (same relic/potion-cap exclusion reasoning
    // as a shrine's offer).
    const shopOptions = generateShopOptions(run.rng, run.relics, run.potions, run.deck);
    return { ...base, phase: 'shop' as const, combat: null, shopOptions };
  }

  const combat = initCombat(node.room, run.rng, run.playerHP, run.playerHPMax, run.deck, run.relics, run.potions, run.currency);
  return { ...base, phase: 'combat' as const, combat };
}

/**
 * Shared tail for rest and shop rooms -- neither grants a reward the way
 * clearing a combat room (or visiting a shrine) does, so this advances depth
 * and goes straight to door generation, skipping the 'reward' phase
 * entirely. Also guards the (currently unreachable, since REST_ROOM_RATIO's
 * roll is skipped once floor >= RUN_MAX_DEPTH) case of a side room landing on
 * the run's last room, same defensive shape as resolveCombatEnd.
 */
function finishSideRoom(run: RunState): RunState {
  const newDepth = run.depth + 1;
  if (newDepth >= run.maxDepth) {
    return { ...run, depth: newDepth, phase: 'run-complete' };
  }
  return proceedToDoors({ ...run, depth: newDepth });
}

/** Restores REST_HEAL_PCT of playerHPMax (rounded, capped at max) and leaves the rest room. Exclusive with restRemoveCard -- see RestScreen.tsx. */
export function restHeal(run: RunState): RunState {
  if (run.phase !== 'rest') return run;
  const healAmount = Math.round(run.playerHPMax * REST_HEAL_PCT);
  const playerHP = Math.min(run.playerHPMax, run.playerHP + healAmount);
  return finishSideRoom({ ...run, playerHP });
}

/** Permanently removes one card (by its unique id) from the persistent deck and leaves the rest room. Exclusive with restHeal -- see RestScreen.tsx. */
export function restRemoveCard(run: RunState, cardId: string): RunState {
  if (run.phase !== 'rest') return run;
  if (!run.deck.some((c) => c.id === cardId)) return run;
  const deck = run.deck.filter((c) => c.id !== cardId);
  return finishSideRoom({ ...run, deck });
}

/**
 * Buys one shop option (by id): deducts its price from currency and applies
 * it to deck/relics/potions, the same three-way split chooseReward already
 * has -- except a 'deck-action' purchase (Transform/Duplicate/Upgrade)
 * doesn't touch any of those itself, it sets `pendingDeckAction` so the shop
 * screen can prompt for which deck card to apply it to (see
 * resolveDeckAction below). Unlike chooseReward, this doesn't leave the
 * phase -- it only removes the bought option from shopOptions, so the
 * player can keep buying whatever else they can still afford (see leaveShop
 * for the actual exit). A no-op (returns run unchanged) if the option
 * doesn't exist or currency can't cover its price.
 */
export function buyShopOption(run: RunState, optionId: string): RunState {
  if (run.phase !== 'shop' || !run.shopOptions) return run;
  const chosen = run.shopOptions.find((o) => o.id === optionId);
  if (!chosen) return run;
  if (run.currency < chosen.price) return run;

  const currency = run.currency - chosen.price;
  const shopOptions = run.shopOptions.filter((o) => o.id !== optionId);
  if (chosen.optionType === 'deck-action') {
    return { ...run, currency, shopOptions, pendingDeckAction: { action: chosen.action } };
  }
  const withPurchase =
    chosen.optionType === 'card'
      ? { deck: [...run.deck, chosen.card] }
      : chosen.optionType === 'relic'
        ? { relics: [...run.relics, chosen.relic] }
        : { potions: [...run.potions, chosen.potion] };
  return { ...run, ...withPurchase, currency, shopOptions };
}

let deckActionDupCounter = 0;

/**
 * Resolves a bought-but-not-yet-applied deck action (see buyShopOption)
 * against a chosen deck card. A no-op outside the 'shop' phase, without a
 * pending action, if the card doesn't exist, isn't a creature card (Quake/
 * Cleave cards carry no suit, so none of these three make sense on them),
 * or -- for 'upgrade' specifically -- if it already carries a specialId
 * (only a plain card can be promoted).
 */
export function resolveDeckAction(run: RunState, cardId: string): RunState {
  if (run.phase !== 'shop' || !run.pendingDeckAction) return run;
  const card = run.deck.find((c) => c.id === cardId);
  if (!card || card.kind !== 'creature') return run;
  const { action } = run.pendingDeckAction;
  if (action === 'upgrade' && card.specialId) return run;

  let deck: Card[];
  if (action === 'transform') {
    // Guaranteed-different suit reroll (MECHANIC_BRAINSTORM.md's "Suit
    // reroll (Transform)") -- a rerolled special becomes a plain card of its
    // new suit, since its old specialId no longer matches.
    const otherSuits = REWARD_SUITS.filter((s) => s !== card.suit);
    const suit = uniformPick(run.rng, otherSuits);
    deck = run.deck.map((c) => (c.id === cardId ? { ...c, suit, specialId: undefined } : c));
  } else if (action === 'duplicate') {
    const copy: CreatureCard = { ...card, id: `${card.id}-dup-${deckActionDupCounter++}` };
    deck = [...run.deck, copy];
  } else {
    // upgrade (Promote) -- every suit now carries 2 named specials (see
    // config/specialCards.ts's SPECIAL_CARD_DEFS), but this always promotes
    // to the suit's first-listed one (its starter-deck special, e.g. Wildfire
    // over Cinder Storm for Ember), deterministically, no rng draw. The
    // suit's other special(s) stay reward/shop-pool only, same as they
    // already were before Upgrade could ever produce them either way.
    const special = specialCardsBySuit(card.suit)[0];
    deck = run.deck.map((c) => (c.id === cardId ? { ...c, specialId: special.id } : c));
  }
  return { ...run, deck, pendingDeckAction: null };
}

/** Leaves the shop, buying nothing further -- the general "I'm done here" exit, same shape as skipReward. */
export function leaveShop(run: RunState): RunState {
  if (run.phase !== 'shop') return run;
  return finishSideRoom({ ...run, shopOptions: null });
}
