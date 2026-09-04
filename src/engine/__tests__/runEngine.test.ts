import { describe, it, expect } from 'vitest';
import {
  createNewRun,
  startFirstRoom,
  resolveCombatEnd,
  chooseReward,
  claimRewardRelic,
  claimRewardPotion,
  skipReward,
  chooseDoor,
  restHeal,
  restRemoveCard,
  buyShopOption,
  resolveDeckAction,
  leaveShop,
} from '../runEngine';
import { generateShopOptions } from '../rewardGenerator';
import { createRng } from '../rng';
import type { RunState } from '../../types/run';
import type { RestRoomInstance, ShrineRoomInstance, ShopRoomInstance } from '../../types/room';
import { potionById } from '../../config/potions';
import { RELIC_DEFS } from '../../config/relics';
import {
  POTION_INVENTORY_CAP,
  SHOP_CARD_PRICE,
  SHOP_RELIC_PRICE,
  SHOP_POTION_PRICE,
  SHOP_TRANSFORM_PRICE,
  STARTER_DECK,
} from '../../config/constants';

function clearCurrentRoom(run: RunState): RunState {
  return { ...run, combat: { ...run.combat!, enemies: [], status: 'room-cleared' } };
}

/**
 * Forces the run into the 'rest' phase deterministically, bypassing
 * runTree's RNG-dependent REST_ROOM_RATIO roll -- these tests care about
 * restHeal/restRemoveCard's own behavior, not whether a given seed happens
 * to roll a rest room. Injects a synthetic rest-room node into the run's
 * (already-built) tree under a path that can't collide with a real one.
 */
function enterRestRoom(run: RunState): RunState {
  const restRoom: RestRoomInstance = { kind: 'rest', id: 'test-rest-room' };
  const childPath = 'test-rest-room';
  const doorId = 'door-test-rest-room';
  const withDoor: RunState = {
    ...run,
    phase: 'door-choice',
    runTree: {
      ...run.runTree,
      nodes: {
        ...run.runTree.nodes,
        [childPath]: {
          path: childPath,
          floor: run.depth + 2,
          room: restRoom,
          // Rest rooms aren't terminal (unless on the final floor, not the
          // case here) -- finishRestRoom always proceeds to another door
          // pair afterward, so this synthetic node needs one too. Nothing
          // in these tests advances past it, so the target paths don't need
          // to resolve to real nodes.
          doors: [
            { tags: { size: 'small', color: 'red' }, childPath: `${childPath}0` },
            { tags: { size: 'large', color: 'blue' }, childPath: `${childPath}1` },
          ],
        },
      },
    },
    currentDoors: [{ id: doorId, tags: { size: 'small', color: 'red' }, childPath }],
  };
  return chooseDoor(withDoor, doorId);
}

/**
 * Forces the run into the 'reward' phase via a shrine door deterministically,
 * bypassing runTree's RNG-dependent SHRINE_ROOM_RATIO roll -- same
 * synthetic-node trick enterRestRoom uses. Since shrine content is generated
 * live (not precomputed in the tree, see types/room.ts's ShrineRoomInstance),
 * this exercises chooseDoor's own generateShrineReward call, not a canned
 * list. Unlike enterRestRoom, this also advances depth (see chooseDoor's
 * shrine branch), since a shrine's reward offer generates the same way a
 * combat clear's does.
 */
function enterShrineRoom(run: RunState): RunState {
  const shrineRoom: ShrineRoomInstance = { kind: 'shrine', id: 'test-shrine-room' };
  const childPath = 'test-shrine-room';
  const doorId = 'door-test-shrine-room';
  const withDoor: RunState = {
    ...run,
    phase: 'door-choice',
    runTree: {
      ...run.runTree,
      nodes: {
        ...run.runTree.nodes,
        [childPath]: {
          path: childPath,
          floor: run.depth + 2,
          room: shrineRoom,
          doors: [
            { tags: { size: 'small', color: 'red' }, childPath: `${childPath}0` },
            { tags: { size: 'large', color: 'blue' }, childPath: `${childPath}1` },
          ],
        },
      },
    },
    currentDoors: [{ id: doorId, tags: { size: 'small', color: 'red' }, childPath }],
  };
  return chooseDoor(withDoor, doorId);
}

/**
 * Forces the run into the 'shop' phase deterministically, bypassing
 * runTree's RNG-dependent SHOP_ROOM_RATIO roll -- same synthetic-node trick
 * enterRestRoom/enterShrineRoom use. Since shop content is generated live
 * (not precomputed in the tree, see types/room.ts's ShopRoomInstance), this
 * exercises chooseDoor's own generateShopOptions call, not a canned list.
 */
function enterShopRoom(run: RunState): RunState {
  const shopRoom: ShopRoomInstance = { kind: 'shop', id: 'test-shop-room' };
  const childPath = 'test-shop-room';
  const doorId = 'door-test-shop-room';
  const withDoor: RunState = {
    ...run,
    phase: 'door-choice',
    runTree: {
      ...run.runTree,
      nodes: {
        ...run.runTree.nodes,
        [childPath]: {
          path: childPath,
          floor: run.depth + 2,
          room: shopRoom,
          doors: [
            { tags: { size: 'small', color: 'red' }, childPath: `${childPath}0` },
            { tags: { size: 'large', color: 'blue' }, childPath: `${childPath}1` },
          ],
        },
      },
    },
    currentDoors: [{ id: doorId, tags: { size: 'small', color: 'red' }, childPath }],
  };
  return chooseDoor(withDoor, doorId);
}

describe('reward flow', () => {
  it('always offers exactly REWARD_CARD_COUNT deterministic card choices for a given seed, and the chosen card lands in the deck and the next room\'s draw', () => {
    let run = createNewRun(99);
    run = startFirstRoom(run);
    run = resolveCombatEnd(clearCurrentRoom(run));

    expect(run.phase).toBe('reward');
    expect(run.rewardOffer).not.toBeNull();
    expect(run.rewardOffer!.cardOptions.length).toBe(3);

    // Determinism: the same seed run through the same sequence of calls
    // yields the same card options.
    let run2 = createNewRun(99);
    run2 = startFirstRoom(run2);
    run2 = resolveCombatEnd(clearCurrentRoom(run2));
    expect(run2.rewardOffer!.cardOptions.map((c) => c.id)).toEqual(run.rewardOffer!.cardOptions.map((c) => c.id));

    const chosenId = run.rewardOffer!.cardOptions[0].id;
    const deckSizeBefore = run.deck.length;
    run = chooseReward(run, chosenId);

    expect(run.phase).toBe('door-choice');
    expect(run.rewardOffer).toBeNull();
    expect(run.deck.length).toBe(deckSizeBefore + 1);
    expect(run.deck.some((c) => c.id === chosenId)).toBe(true);

    // A door can now lead to a rest room (REST_ROOM_RATIO) instead of
    // combat -- pick whichever candidate is a combat room, since that's
    // what this test is actually exercising.
    const combatDoor = run.currentDoors!.find(
      (d) => run.runTree.nodes[d.childPath].room.kind === 'combat',
    )!;
    run = chooseDoor(run, combatDoor.id);
    const allIdsInNextRoom = new Set([
      ...run.combat!.playerHand.map((c) => c.id),
      ...run.combat!.drawPile.map((c) => c.id),
      ...run.combat!.discardPile.map((c) => c.id),
    ]);
    expect(allIdsInNextRoom.has(chosenId)).toBe(true);
  });

  it('rejects choosing an id that was not offered, leaving the run in the reward phase', () => {
    let run = createNewRun(5);
    run = startFirstRoom(run);
    run = resolveCombatEnd(clearCurrentRoom(run));
    const deckSizeBefore = run.deck.length;

    const rejected = chooseReward(run, 'not-a-real-option');
    expect(rejected).toBe(run);
    expect(rejected.deck.length).toBe(deckSizeBefore);
  });

  it('lets the player pass on every offered reward, leaving the deck untouched and still proceeding to door-choice', () => {
    let run = createNewRun(7);
    run = startFirstRoom(run);
    run = resolveCombatEnd(clearCurrentRoom(run));
    const deckSizeBefore = run.deck.length;

    run = skipReward(run);

    expect(run.phase).toBe('door-choice');
    expect(run.rewardOffer).toBeNull();
    expect(run.deck.length).toBe(deckSizeBefore);
    expect(run.currentDoors).not.toBeNull();
  });

  it('ignores skipReward outside the reward phase', () => {
    const run = createNewRun(7);
    expect(skipReward(run)).toBe(run);
  });

  it('skips the reward step entirely when the cleared room was the run\'s last one', () => {
    let run = createNewRun(2);
    run = startFirstRoom(run);
    run = { ...run, depth: run.maxDepth - 1 };
    run = resolveCombatEnd(clearCurrentRoom(run));

    expect(run.phase).toBe('run-complete');
    expect(run.rewardOffer).toBeNull();
  });

  it('claimRewardRelic adds the offered relic and clears it off the offer, without leaving the reward phase or touching the still-unpicked card row', () => {
    let run = createNewRun(99);
    run = startFirstRoom(run);
    run = resolveCombatEnd(clearCurrentRoom(run));
    // Force a relic onto the offer regardless of what the seed actually
    // rolled -- claimRewardRelic's own behavior is what's under test here,
    // not RELIC_REWARD_RATIO's odds.
    const relic = RELIC_DEFS[0];
    run = { ...run, rewardOffer: { ...run.rewardOffer!, relic } };

    run = claimRewardRelic(run);

    expect(run.relics).toEqual([relic]);
    expect(run.phase).toBe('reward'); // claiming a relic doesn't end the visit
    expect(run.rewardOffer!.relic).toBeNull();
    expect(run.rewardOffer!.cardOptions.length).toBe(3); // untouched

    // A second claim is a no-op -- the relic is already off the offer.
    const reclaimed = claimRewardRelic(run);
    expect(reclaimed).toBe(run);
  });

  it('claimRewardPotion adds the offered potion and clears it off the offer, the same independent-row way claimRewardRelic does', () => {
    let run = createNewRun(99);
    run = startFirstRoom(run);
    run = resolveCombatEnd(clearCurrentRoom(run));
    const potion = potionById('salt');
    run = { ...run, rewardOffer: { ...run.rewardOffer!, potion } };

    run = claimRewardPotion(run);

    expect(run.potions).toEqual([potion]);
    expect(run.phase).toBe('reward');
    expect(run.rewardOffer!.potion).toBeNull();

    const reclaimed = claimRewardPotion(run);
    expect(reclaimed).toBe(run);
  });

  it('claiming a relic and a potion, then choosing a card, keeps all three and ends the visit', () => {
    let run = createNewRun(99);
    run = startFirstRoom(run);
    run = resolveCombatEnd(clearCurrentRoom(run));
    const relic = RELIC_DEFS[0];
    const potion = potionById('salt');
    run = { ...run, rewardOffer: { ...run.rewardOffer!, relic, potion } };

    run = claimRewardRelic(run);
    run = claimRewardPotion(run);
    const chosenId = run.rewardOffer!.cardOptions[0].id;
    run = chooseReward(run, chosenId);

    expect(run.relics).toEqual([relic]);
    expect(run.potions).toEqual([potion]);
    expect(run.deck.some((c) => c.id === chosenId)).toBe(true);
    expect(run.phase).toBe('door-choice');
    expect(run.rewardOffer).toBeNull();
  });

  it('claimRewardRelic and claimRewardPotion are both no-ops outside the reward phase, or when nothing is on offer', () => {
    const run = createNewRun(7);
    expect(claimRewardRelic(run)).toBe(run);
    expect(claimRewardPotion(run)).toBe(run);
  });
});

describe('rest rooms', () => {
  it('choosing a door into a rest room sets phase to rest with no combat state', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterRestRoom(run);

    expect(run.phase).toBe('rest');
    expect(run.combat).toBeNull();
  });

  it('restHeal restores REST_HEAL_PCT of max HP, capped at max, and proceeds straight to door-choice with no reward phase', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterRestRoom(run);
    run = { ...run, playerHP: 10 };
    const depthBefore = run.depth;

    run = restHeal(run);

    // REST_HEAL_PCT is 0.3 of PLAYER_HP_MAX (30) = 9, rounded.
    expect(run.playerHP).toBe(19);
    expect(run.phase).toBe('door-choice');
    expect(run.rewardOffer).toBeNull();
    expect(run.depth).toBe(depthBefore + 1);
  });

  it('restHeal never overheals past playerHPMax', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterRestRoom(run);
    run = { ...run, playerHP: 25 };

    run = restHeal(run);

    expect(run.playerHP).toBe(run.playerHPMax);
  });

  it('restRemoveCard removes exactly the targeted card and proceeds to door-choice', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterRestRoom(run);
    const targetId = run.deck[0].id;
    const deckSizeBefore = run.deck.length;

    run = restRemoveCard(run, targetId);

    expect(run.deck.length).toBe(deckSizeBefore - 1);
    expect(run.deck.some((c) => c.id === targetId)).toBe(false);
    expect(run.phase).toBe('door-choice');
  });

  it('restRemoveCard rejects an id not in the deck, leaving the run in the rest phase', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterRestRoom(run);

    const rejected = restRemoveCard(run, 'not-a-real-card');
    expect(rejected).toBe(run);
    expect(rejected.phase).toBe('rest');
  });

  it('restHeal and restRemoveCard are both no-ops outside the rest phase', () => {
    const run = createNewRun(3);
    expect(restHeal(run)).toBe(run);
    expect(restRemoveCard(run, 'anything')).toBe(run);
  });
});

describe('potions', () => {
  it('a claimed potion lands in run.potions and carries into the next room\'s combat.potions', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = resolveCombatEnd(clearCurrentRoom(run));
    const potion = potionById('salt');
    run = { ...run, rewardOffer: { ...run.rewardOffer!, potion } };

    run = claimRewardPotion(run);
    run = skipReward(run);
    expect(run.potions).toEqual([potion]);
    expect(run.phase).toBe('door-choice');

    const combatDoor = run.currentDoors!.find(
      (d) => run.runTree.nodes[d.childPath].room.kind === 'combat',
    )!;
    run = chooseDoor(run, combatDoor.id);
    expect(run.combat!.potions).toEqual([potion]);
  });

  it('holds potions across a rest room the same way it holds relics', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = { ...run, potions: [potionById('salt')] };
    run = enterRestRoom(run);
    run = restHeal(run);

    expect(run.potions).toEqual([potionById('salt')]);
  });
});

describe('shrine rooms', () => {
  it('choosing a door into a shrine advances depth and sets phase to reward with a relic-only offer and no combat state', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    const depthBefore = run.depth;
    run = enterShrineRoom(run);

    expect(run.phase).toBe('reward');
    expect(run.combat).toBeNull();
    expect(run.rewardOffer).not.toBeNull();
    expect(run.rewardOffer!.cardOptions).toEqual([]);
    expect(run.rewardOffer!.potion).toBeNull();
    expect(run.rewardOffer!.relic).not.toBeNull();
    expect(run.depth).toBe(depthBefore + 1);
  });

  it('claimRewardRelic adds exactly the offered relic to held relics, then skipReward proceeds to door-choice', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterShrineRoom(run);
    const offered = run.rewardOffer!.relic!;

    run = claimRewardRelic(run);
    expect(run.relics).toEqual([offered]);
    expect(run.rewardOffer!.relic).toBeNull();

    run = skipReward(run);
    expect(run.phase).toBe('door-choice');
    expect(run.rewardOffer).toBeNull();
  });

  it('skipReward leaves relics untouched and proceeds to door-choice', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterShrineRoom(run);

    run = skipReward(run);

    expect(run.relics).toEqual([]);
    expect(run.rewardOffer).toBeNull();
    expect(run.phase).toBe('door-choice');
  });

  it('a shrine never offers a relic the player already holds', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterShrineRoom(run);
    const firstPick = run.rewardOffer!.relic!;
    run = claimRewardRelic(run);
    run = skipReward(run);

    run = enterShrineRoom(run);

    expect(run.rewardOffer!.relic?.id).not.toBe(firstPick.id);
  });
});

describe('shop rooms', () => {
  it('choosing a door into a shop sets phase to shop with generated (non-empty) options and no combat state', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterShopRoom(run);

    expect(run.phase).toBe('shop');
    expect(run.combat).toBeNull();
    expect(run.shopOptions).not.toBeNull();
    expect(run.shopOptions!.length).toBeGreaterThan(0);
  });

  it('buyShopOption deducts the price, applies a card option to the deck, removes the bought slot, and stays in the shop phase', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterShopRoom(run);
    const cardOption = {
      id: 'test-card',
      optionType: 'card' as const,
      price: SHOP_CARD_PRICE,
      card: { id: 'test-card-card', kind: 'creature' as const, suit: 'wolf' as const },
    };
    run = { ...run, currency: 50, shopOptions: [cardOption] };
    const deckSizeBefore = run.deck.length;

    run = buyShopOption(run, cardOption.id);

    expect(run.currency).toBe(50 - SHOP_CARD_PRICE);
    expect(run.deck.length).toBe(deckSizeBefore + 1);
    expect(run.deck.some((c) => c.id === cardOption.card.id)).toBe(true);
    expect(run.shopOptions).toEqual([]);
    expect(run.phase).toBe('shop');
  });

  it('buyShopOption applies a relic option to held relics and a potion option to held potions', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterShopRoom(run);
    const relicOption = { id: 'test-relic', optionType: 'relic' as const, price: SHOP_RELIC_PRICE, relic: RELIC_DEFS[0] };
    const potionOption = { id: 'test-potion', optionType: 'potion' as const, price: SHOP_POTION_PRICE, potion: potionById('salt') };
    run = { ...run, currency: 100, shopOptions: [relicOption, potionOption] };

    run = buyShopOption(run, relicOption.id);
    expect(run.relics).toEqual([RELIC_DEFS[0]]);
    expect(run.currency).toBe(100 - SHOP_RELIC_PRICE);

    run = buyShopOption(run, potionOption.id);
    expect(run.potions).toEqual([potionById('salt')]);
    expect(run.currency).toBe(100 - SHOP_RELIC_PRICE - SHOP_POTION_PRICE);
    expect(run.shopOptions).toEqual([]);
  });

  it('buying an option that costs more than held currency is a no-op', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterShopRoom(run);
    const cardOption = {
      id: 'test-card',
      optionType: 'card' as const,
      price: SHOP_CARD_PRICE,
      card: { id: 'test-card-card', kind: 'creature' as const, suit: 'wolf' as const },
    };
    run = { ...run, currency: SHOP_CARD_PRICE - 1, shopOptions: [cardOption] };

    const rejected = buyShopOption(run, cardOption.id);
    expect(rejected).toBe(run);
  });

  it('buying an id that was not offered is a no-op', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterShopRoom(run);

    const rejected = buyShopOption(run, 'not-a-real-option');
    expect(rejected).toBe(run);
  });

  it('leaveShop clears the offer and proceeds to door-choice', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterShopRoom(run);
    const depthBefore = run.depth;

    run = leaveShop(run);

    expect(run.shopOptions).toBeNull();
    expect(run.phase).toBe('door-choice');
    expect(run.depth).toBe(depthBefore + 1);
  });

  it('buyShopOption and leaveShop are both no-ops outside the shop phase', () => {
    const run = createNewRun(3);
    expect(buyShopOption(run, 'anything')).toBe(run);
    expect(leaveShop(run)).toBe(run);
  });

  it('never offers a relic the player already holds, and stops offering potions once the inventory cap is reached', () => {
    const options = generateShopOptions(createRng(42), RELIC_DEFS, [], STARTER_DECK);
    expect(options.some((o) => o.optionType === 'relic')).toBe(false);

    const cappedPotions = Array.from({ length: POTION_INVENTORY_CAP }, () => potionById('salt'));
    const cappedOptions = generateShopOptions(createRng(42), [], cappedPotions, STARTER_DECK);
    expect(cappedOptions.some((o) => o.optionType === 'potion')).toBe(false);
  });

  it("buying a deck-action option doesn't touch deck/relics/potions -- it sets pendingDeckAction instead", () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterShopRoom(run);
    const deckActionOption = { id: 'test-transform', optionType: 'deck-action' as const, price: SHOP_TRANSFORM_PRICE, action: 'transform' as const };
    run = { ...run, currency: 50, shopOptions: [deckActionOption] };
    const deckBefore = run.deck;

    run = buyShopOption(run, deckActionOption.id);

    expect(run.currency).toBe(50 - SHOP_TRANSFORM_PRICE);
    expect(run.deck).toBe(deckBefore); // untouched until resolveDeckAction picks a card
    expect(run.pendingDeckAction).toEqual({ action: 'transform' });
    expect(run.shopOptions).toEqual([]);
  });

  it('resolveDeckAction: transform rerolls the chosen card to a different suit and clears any specialId', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterShopRoom(run);
    // The real starter deck is basics-only (see constants.ts's
    // buildStarterDeck), so swap in the full-roster STARTER_DECK fixture to
    // get a specialId card to target.
    run = { ...run, deck: STARTER_DECK, pendingDeckAction: { action: 'transform' } };
    const target = run.deck.find((c) => c.kind === 'creature' && c.specialId)!;

    run = resolveDeckAction(run, target.id);

    const rerolled = run.deck.find((c) => c.id === target.id)!;
    expect(rerolled.kind).toBe('creature');
    if (rerolled.kind === 'creature') {
      expect(rerolled.suit).not.toBe((target as { suit: string }).suit);
      expect(rerolled.specialId).toBeUndefined();
    }
    expect(run.pendingDeckAction).toBeNull();
  });

  it('resolveDeckAction: duplicate appends a fresh-id copy of the chosen card, leaving the original untouched', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterShopRoom(run);
    run = { ...run, pendingDeckAction: { action: 'duplicate' } };
    const target = run.deck[0];
    const deckSizeBefore = run.deck.length;

    run = resolveDeckAction(run, target.id);

    expect(run.deck.length).toBe(deckSizeBefore + 1);
    expect(run.deck.filter((c) => c.kind === 'creature' && c.suit === (target as { suit: string }).suit).length).toBeGreaterThanOrEqual(2);
    expect(run.deck.some((c) => c.id === target.id)).toBe(true); // original untouched
    expect(run.pendingDeckAction).toBeNull();
  });

  it('resolveDeckAction: upgrade promotes a plain card to its suit\'s named special, and is a no-op on an already-special card', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterShopRoom(run);
    // The real starter deck is basics-only, so swap in the full-roster
    // STARTER_DECK fixture, which has both plain and specialId cards.
    run = { ...run, deck: STARTER_DECK, pendingDeckAction: { action: 'upgrade' } };
    const plain = run.deck.find((c) => c.kind === 'creature' && !c.specialId)!;

    const upgraded = resolveDeckAction(run, plain.id);
    const upgradedCard = upgraded.deck.find((c) => c.id === plain.id)!;
    expect(upgradedCard.kind).toBe('creature');
    if (upgradedCard.kind === 'creature') expect(upgradedCard.specialId).toBeDefined();
    expect(upgraded.pendingDeckAction).toBeNull();

    // Already-special card: no-op, run unchanged.
    const alreadySpecial = run.deck.find((c) => c.kind === 'creature' && c.specialId)!;
    const rejected = resolveDeckAction(run, alreadySpecial.id);
    expect(rejected).toBe(run);
  });

  it('resolveDeckAction is a no-op outside the shop phase or without a pending action', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    expect(resolveDeckAction(run, run.deck[0].id)).toBe(run);

    run = enterShopRoom(run);
    expect(resolveDeckAction(run, run.deck[0].id)).toBe(run); // no pendingDeckAction set
  });
});
