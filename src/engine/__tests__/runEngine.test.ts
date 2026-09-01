import { describe, it, expect } from 'vitest';
import {
  createNewRun,
  startFirstRoom,
  resolveCombatEnd,
  chooseReward,
  skipReward,
  chooseDoor,
  restHeal,
  restRemoveCard,
  chooseRelic,
  skipShrine,
  buyShopOption,
  leaveShop,
} from '../runEngine';
import { generateShopOptions } from '../rewardGenerator';
import { createRng } from '../rng';
import type { RunState } from '../../types/run';
import type { RestRoomInstance, ShrineRoomInstance, ShopRoomInstance } from '../../types/room';
import { potionById } from '../../config/potions';
import { RELIC_DEFS } from '../../config/relics';
import { POTION_INVENTORY_CAP, SHOP_CARD_PRICE, SHOP_RELIC_PRICE, SHOP_POTION_PRICE } from '../../config/constants';

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
 * Forces the run into the 'shrine' phase deterministically, bypassing
 * runTree's RNG-dependent SHRINE_ROOM_RATIO roll -- same synthetic-node
 * trick enterRestRoom uses. Since shrine content is generated live (not
 * precomputed in the tree, see types/room.ts's ShrineRoomInstance), this
 * exercises chooseDoor's own generateShrineOptions call, not a canned list.
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
  it('offers deterministic options for a given seed, and the chosen card lands in the deck and the next room\'s draw', () => {
    let run = createNewRun(99);
    run = startFirstRoom(run);
    run = resolveCombatEnd(clearCurrentRoom(run));

    expect(run.phase).toBe('reward');
    expect(run.rewardOptions).not.toBeNull();
    expect(run.rewardOptions!.length).toBe(3);

    // Determinism: the same seed run through the same sequence of calls
    // yields the same reward options.
    let run2 = createNewRun(99);
    run2 = startFirstRoom(run2);
    run2 = resolveCombatEnd(clearCurrentRoom(run2));
    expect(run2.rewardOptions!.map((c) => c.id)).toEqual(run.rewardOptions!.map((c) => c.id));

    const chosenId = run.rewardOptions![0].id;
    const deckSizeBefore = run.deck.length;
    run = chooseReward(run, chosenId);

    expect(run.phase).toBe('door-choice');
    expect(run.rewardOptions).toBeNull();
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
    expect(run.rewardOptions).toBeNull();
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
    expect(run.rewardOptions).toBeNull();
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
    expect(run.rewardOptions).toBeNull();
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
  it('a reward option of optionType potion, chosen, lands in run.potions and carries into the next room\'s combat.potions', () => {
    // Seed 1 is known to roll a potion into one of its 3 reward slots
    // (POTION_REWARD_RATIO is low, so an arbitrary seed usually won't).
    let run = createNewRun(1);
    run = startFirstRoom(run);
    run = resolveCombatEnd(clearCurrentRoom(run));

    const potionOption = run.rewardOptions!.find((o) => o.optionType === 'potion');
    if (potionOption?.optionType !== 'potion') throw new Error('expected seed 1 to offer a potion reward');

    run = chooseReward(run, potionOption.id);
    expect(run.potions).toEqual([potionOption.potion]);
    expect(run.phase).toBe('door-choice');

    const combatDoor = run.currentDoors!.find(
      (d) => run.runTree.nodes[d.childPath].room.kind === 'combat',
    )!;
    run = chooseDoor(run, combatDoor.id);
    expect(run.combat!.potions).toEqual([potionOption.potion]);
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
  it('choosing a door into a shrine sets phase to shrine with generated (non-empty) options and no combat state', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterShrineRoom(run);

    expect(run.phase).toBe('shrine');
    expect(run.combat).toBeNull();
    expect(run.shrineOptions).not.toBeNull();
    expect(run.shrineOptions!.length).toBeGreaterThan(0);
  });

  it('chooseRelic adds exactly the picked relic to held relics and proceeds to door-choice with no reward phase', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterShrineRoom(run);
    const depthBefore = run.depth;
    const chosen = run.shrineOptions![0];

    run = chooseRelic(run, chosen.id);

    expect(run.relics).toEqual([chosen]);
    expect(run.shrineOptions).toBeNull();
    expect(run.phase).toBe('door-choice');
    expect(run.rewardOptions).toBeNull();
    expect(run.depth).toBe(depthBefore + 1);
  });

  it('chooseRelic rejects an id that was not offered, leaving the run in the shrine phase', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterShrineRoom(run);

    const rejected = chooseRelic(run, 'not-a-real-relic');
    expect(rejected).toBe(run);
    expect(rejected.phase).toBe('shrine');
  });

  it('skipShrine leaves relics untouched and proceeds to door-choice', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterShrineRoom(run);

    run = skipShrine(run);

    expect(run.relics).toEqual([]);
    expect(run.shrineOptions).toBeNull();
    expect(run.phase).toBe('door-choice');
  });

  it('a shrine never offers a relic the player already holds', () => {
    let run = createNewRun(3);
    run = startFirstRoom(run);
    run = enterShrineRoom(run);
    const firstPick = run.shrineOptions![0];
    run = chooseRelic(run, firstPick.id);

    run = enterShrineRoom(run);

    expect(run.shrineOptions!.some((r) => r.id === firstPick.id)).toBe(false);
  });

  it('chooseRelic and skipShrine are both no-ops outside the shrine phase', () => {
    const run = createNewRun(3);
    expect(chooseRelic(run, 'anything')).toBe(run);
    expect(skipShrine(run)).toBe(run);
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
    const options = generateShopOptions(createRng(42), RELIC_DEFS, []);
    expect(options.some((o) => o.optionType === 'relic')).toBe(false);

    const cappedPotions = Array.from({ length: POTION_INVENTORY_CAP }, () => potionById('salt'));
    const cappedOptions = generateShopOptions(createRng(42), [], cappedPotions);
    expect(cappedOptions.some((o) => o.optionType === 'potion')).toBe(false);
  });
});
