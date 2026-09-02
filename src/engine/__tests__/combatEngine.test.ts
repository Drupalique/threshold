import { describe, it, expect } from 'vitest';
import { createRng } from '../rng';
import type { Rng } from '../rng';
import {
  initCombat,
  applyCombatAction,
  getLegalPlaySets,
  getLegalFreeClaimUses,
  getLegalSaltUses,
  requiresEnemyTarget,
} from '../combatEngine';
import { chooseEnemyPlay } from '../enemyAI';
import { enemyDefById } from '../../config/enemies';
import type { CombatRoomInstance } from '../../types/room';
import type { EnemyInstance } from '../../types/enemy';
import type { CombatState, TableCard } from '../../types/combat';
import type { Card, CreatureCard } from '../../types/cards';
import type { SuitId } from '../../types/suits';
import { PLAYS_PER_TURN_BASE, QUAKE_BONUS_PLAYS, CURRENCY_CLAIM_THRESHOLD } from '../../config/constants';
import { relicById } from '../../config/relics';
import { potionById } from '../../config/potions';

function makeEnemy(overrides: Partial<EnemyInstance> = {}): EnemyInstance {
  return {
    instanceId: 'e1',
    defId: 'wolf-kin',
    name: 'Wolf-kin',
    hp: 20,
    hpMax: 20,
    guard: 0,
    statuses: {},
    hand: [],
    drawPile: [],
    discardPile: [],
    ...overrides,
  };
}

function makeRoom(overrides: Partial<CombatRoomInstance> = {}): CombatRoomInstance {
  return {
    kind: 'combat',
    id: 'test-room',
    params: {
      tableDealSize: 4,
      dealsPerRound: { min: 1, max: 1 },
      sizeBand: 'small',
      threatSuits: ['wolf'],
      primarySuit: 'wolf',
      playerHandSize: 5,
      onSuitRatio: 0.6,
      boonRatio: 0.12,
      guardRatio: 0.08,
      weakenRatio: 0,
      poisonRatio: 0,
      strengthRatio: 0,
    },
    enemies: [makeEnemy()],
    ...overrides,
  };
}

function makeDeck(suit: SuitId, count: number, prefix = 'deck'): Card[] {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${suit}-${i}`, kind: 'creature' as const, suit }));
}

const DEFAULT_DECK: Card[] = makeDeck('wolf', 12);
const DEFAULT_HAND: Card[] = [
  { id: 'ph1', kind: 'creature', suit: 'wolf' },
  { id: 'ph2', kind: 'creature', suit: 'wolf' },
  { id: 'ph3', kind: 'creature', suit: 'wolf' },
];

// initCombat's real shuffle/deal is exercised directly by the deck-cycling
// tests below; everywhere else, this hacks straight to a scenario by
// overwriting whatever fields the test cares about, same pattern the old
// suite used for playerHand -- initCombat still runs first so
// drawPile/discardPile/table stay internally consistent for anything a test
// doesn't explicitly override.
function makeCombat(
  room: CombatRoomInstance,
  rng: Rng,
  playerHP: number,
  playerHPMax: number,
  overrides: Partial<CombatState> = {},
): CombatState {
  return { ...initCombat(room, rng, playerHP, playerHPMax, DEFAULT_DECK), playerHand: DEFAULT_HAND, ...overrides };
}

describe('legality and plays per turn', () => {
  it('is multiplicative: the play itself joins the table set it multiplies against, damaging the targeted enemy', () => {
    const room = makeRoom({ enemies: [makeEnemy({ hp: 30, hpMax: 30 })] });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: [
        { id: 't1', suit: 'wolf', ownerId: 'room' },
        { id: 't2', suit: 'wolf', ownerId: 'room' },
        { id: 't3', suit: 'wolf', ownerId: 'room' },
        { id: 't4', suit: 'wolf', ownerId: 'room' },
      ],
      playerHand: DEFAULT_HAND,
    });

    const next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1', 'ph2', 'ph3'] },
      rng,
    );

    // 4 already on the table + 3 played = 7 on the table x 3 hand cards = 21
    // damage, plus each of the 3 played cards' own +1 basic rider = 24 total
    expect(next.enemies[0].hp).toBe(30 - 21 - 3);
    expect(next.playerHand.map((c) => c.id)).not.toContain('ph1');
    // The played cards land on the table too, tagged to the player.
    expect(next.table.filter((c) => c.suit === 'wolf' && c.ownerId === 'player').length).toBe(3);
    // The room's 4 wolf cards were just claimed by this play -- gone.
    expect(next.table.filter((c) => c.suit === 'wolf' && c.ownerId === 'room').length).toBe(0);
  });

  it('a lethal play defeats the enemy and clears the room when it was the last one', () => {
    const room = makeRoom({ enemies: [makeEnemy({ hp: 4, hpMax: 4 })] });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: [
        { id: 't1', suit: 'wolf', ownerId: 'room' },
        { id: 't2', suit: 'wolf', ownerId: 'room' },
        { id: 't3', suit: 'wolf', ownerId: 'room' },
        { id: 't4', suit: 'wolf', ownerId: 'room' },
      ],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
    });
    const next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );

    expect(next.enemies).toEqual([]);
    expect(next.status).toBe('room-cleared');
  });

  it(`lets the player make ${PLAYS_PER_TURN_BASE} plays before the turn passes to the enemy phase`, () => {
    const room = makeRoom();
    const rng = createRng(31);
    let state: CombatState = makeCombat(room, rng, 30, 30, {
      table: [{ id: 't1', suit: 'wolf', ownerId: 'room' }],
      playerHand: [
        { id: 'ph1', kind: 'creature', suit: 'wolf' },
        { id: 'ph2', kind: 'creature', suit: 'wolf' },
      ],
    });
    expect(state.playsRemaining).toBe(PLAYS_PER_TURN_BASE);

    state = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );
    expect(state.activeTurn).toBe('player'); // first of two plays -- turn continues
    expect(state.playsRemaining).toBe(PLAYS_PER_TURN_BASE - 1);
    // 1 already on the table + 1 played = 2 on the table x 1 hand card = 2,
    // plus the played card's own +1 basic rider = 3
    expect(state.enemies[0].hp).toBe(20 - 2 - 1);

    state = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph2'] },
      rng,
    );
    // The first play already claimed the room's 1 wolf card, so the second
    // play only compounds off the player's own contribution from the prior
    // play (1 wolf now on the table, + this play's own 1 = 2), plus another
    // +1 basic rider.
    expect(state.enemies[0].hp).toBe(20 - 2 - 1 - 2 - 1);
    expect(state.activeTurn).toBe('enemy'); // plays exhausted -- turn actually ends now
  });

  it('rejects a play once plays are exhausted, and offers no legal targets', () => {
    const room = makeRoom();
    const rng = createRng(32);
    const state: CombatState = makeCombat(room, rng, 30, 30, {
      playerHand: [{ id: 'ph3', kind: 'creature', suit: 'ember' }],
      playsRemaining: 0,
    });
    expect(getLegalPlaySets(state)).toEqual([]);
    const rejected = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'ember', targetInstanceId: 'e1', handCardIds: ['ph3'] },
      rng,
    );
    expect(rejected).toBe(state); // illegal play, state unchanged
  });

  it('a play into an empty table still has an effect, since the play itself becomes the table set it multiplies against', () => {
    const room = makeRoom({ params: { ...makeRoom().params, threatSuits: ['rot'] } });
    const rng = createRng(33);
    const state = makeCombat(room, rng, 30, 30, {
      table: [],
      playerHand: [
        { id: 'ph1', kind: 'creature', suit: 'rot' },
        { id: 'ph2', kind: 'creature', suit: 'rot' },
      ],
    });
    const next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'rot', targetInstanceId: 'e1', handCardIds: ['ph1', 'ph2'] },
      rng,
    );
    // 0 already on the table + 2 played = 2 on the table x 2 hand cards = 4,
    // plus each of the 2 played cards' own +1 basic rider = 6 total
    expect(next.enemies[0].hp).toBe(20 - 4 - 2);
    expect(next.table.filter((c) => c.suit === 'rot' && c.ownerId === 'player').length).toBe(2); // played cards still land on the table
  });

  it('a Quake card adds a flat bonus straight into the plays pool, on top of whatever is left this turn', () => {
    const room = makeRoom();
    const rng = createRng(33);
    let state: CombatState = makeCombat(room, rng, 30, 30, {
      table: [{ id: 't1', suit: 'wolf', ownerId: 'room' }],
      playerHand: [
        { id: 'phq', kind: 'quake' },
        { id: 'ph1', kind: 'creature', suit: 'wolf' },
        { id: 'ph2', kind: 'creature', suit: 'wolf' },
        { id: 'ph3', kind: 'creature', suit: 'wolf' },
      ],
    });

    state = applyCombatAction(state, { type: 'PLAYER_PLAY_QUAKE', cardId: 'phq' }, rng);
    expect(state.activeTurn).toBe('player'); // playing it doesn't end the turn
    expect(state.playerHand.some((c) => c.id === 'phq')).toBe(false); // consumed
    expect(state.discardPile.some((c) => c.id === 'phq')).toBe(true); // discarded, not vanished
    expect(state.playsRemaining).toBe(PLAYS_PER_TURN_BASE + QUAKE_BONUS_PLAYS); // topped up, not bypassed

    // Three plays in a row -- more than PLAYS_PER_TURN_BASE alone would allow,
    // but well within the Quake-topped pool.
    state = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );
    expect(state.activeTurn).toBe('player');
    expect(state.playsRemaining).toBe(PLAYS_PER_TURN_BASE + QUAKE_BONUS_PLAYS - 1);
    state = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph2'] },
      rng,
    );
    expect(state.activeTurn).toBe('player');
    state = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph3'] },
      rng,
    );
    expect(state.activeTurn).toBe('player'); // still going -- pool isn't exhausted yet
    expect(state.playsRemaining).toBe(PLAYS_PER_TURN_BASE + QUAKE_BONUS_PLAYS - 3);

    // The pool is finite now, so Pass is still needed to end the turn early.
    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
    expect(state.activeTurn).toBe('enemy');
  });
});

describe('table piles are independent of any specific enemy', () => {
  it('offers every alive enemy as a target for the same pile, and a play only affects the chosen one', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ instanceId: 'e1', hp: 10, hpMax: 10 }), makeEnemy({ instanceId: 'e2', hp: 10, hpMax: 10 })],
    });
    const rng = createRng(2);
    const state = makeCombat(room, rng, 30, 30, {
      table: [
        { id: 't1', suit: 'wolf', ownerId: 'room' },
        { id: 't2', suit: 'wolf', ownerId: 'room' },
        { id: 't3', suit: 'wolf', ownerId: 'room' },
        { id: 't4', suit: 'wolf', ownerId: 'room' },
        { id: 't5', suit: 'wolf', ownerId: 'room' },
      ],
      playerHand: [
        { id: 'ph1', kind: 'creature', suit: 'wolf' },
        { id: 'ph2', kind: 'creature', suit: 'wolf' },
      ],
    });

    const targets = getLegalPlaySets(state).filter((t) => t.suit === 'wolf');
    expect(targets.length).toBe(2);
    expect(targets.every((t) => t.tableSetSize === 5)).toBe(true);

    const next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e2', handCardIds: ['ph1', 'ph2'] },
      rng,
    );

    const e1 = next.enemies.find((e) => e.instanceId === 'e1');
    const e2 = next.enemies.find((e) => e.instanceId === 'e2');
    expect(e1?.hp).toBe(10); // untouched -- the player freely chose e2 instead
    expect(e2).toBeUndefined(); // 5 already on the table + 2 played = 7 on the table x 2 hand cards = 14, lethal
  });
});

describe('table multiplier math', () => {
  it('reads magnitude from every owner\'s contribution combined, not just one owner', () => {
    const room = makeRoom();
    const rng = createRng(40);
    const state = makeCombat(room, rng, 30, 30, {
      table: [
        { id: 't1', suit: 'wolf', ownerId: 'room' },
        { id: 't2', suit: 'wolf', ownerId: 'e1' },
      ],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
    });
    const next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );
    // 2 already on the table (1 from room, 1 from the enemy itself) + 1
    // played = 3 on the table x 1 hand card = 3, plus the played card's own
    // +1 basic rider = 4
    expect(next.enemies[0].hp).toBe(20 - 3 - 1);
  });
});

describe('same-turn compounding', () => {
  it('a second play in the same turn reads a table count that already includes the first play, including the actor\'s own contribution', () => {
    const room = makeRoom();
    const rng = createRng(41);
    let state: CombatState = makeCombat(room, rng, 30, 30, {
      table: [],
      playerHand: [
        { id: 'ph1', kind: 'creature', suit: 'wolf' },
        { id: 'ph2', kind: 'creature', suit: 'wolf' },
      ],
    });

    state = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );
    // 0 already on the table + 1 played = 1 on the table x 1 hand card = 1,
    // plus the played card's own +1 basic rider = 2
    expect(state.enemies[0].hp).toBe(18);

    state = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph2'] },
      rng,
    );
    // The first play's own card is now on the table -- 1 already there + 1
    // played = 2 on the table x 1 hand card = 2, plus another +1 basic rider = 3
    expect(state.enemies[0].hp).toBe(15);
  });
});

describe('claiming the room caps Quake self-compounding by splitting a suit into singles', () => {
  it('splitting a suit into N one-card plays deals strictly less than one N-card play, since the first single already claims the room\'s whole stockpile', () => {
    // Higher HP than makeRoom()'s default 20 -- the big play's magnitude
    // (18) plus its 3 cards' basic riders (3) now totals 21, which would
    // otherwise one-shot a 20-HP enemy before its post-play hp is even
    // readable.
    const bigPlayRoom = makeRoom({ enemies: [makeEnemy({ hp: 40, hpMax: 40 })] });
    const rngBig = createRng(42);
    let bigPlayState: CombatState = makeCombat(bigPlayRoom, rngBig, 30, 30, {
      table: [
        { id: 't1', suit: 'wolf', ownerId: 'room' },
        { id: 't2', suit: 'wolf', ownerId: 'room' },
        { id: 't3', suit: 'wolf', ownerId: 'room' },
      ],
      playerHand: [
        { id: 'ph1', kind: 'creature', suit: 'wolf' },
        { id: 'ph2', kind: 'creature', suit: 'wolf' },
        { id: 'ph3', kind: 'creature', suit: 'wolf' },
      ],
      playsRemaining: 1,
    });
    bigPlayState = applyCombatAction(
      bigPlayState,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1', 'ph2', 'ph3'] },
      rngBig,
    );
    const bigPlayDamage = 40 - bigPlayState.enemies[0].hp;
    // 3 already on the table + 3 played = 6 on the table x 3 hand cards =
    // 18, plus each of the 3 played cards' own +1 basic rider = 21
    expect(bigPlayDamage).toBe(18 + 3);

    const splitRoom = makeRoom({ enemies: [makeEnemy({ hp: 40, hpMax: 40 })] });
    const rngSplit = createRng(43);
    let splitState: CombatState = makeCombat(splitRoom, rngSplit, 30, 30, {
      table: [
        { id: 't1', suit: 'wolf', ownerId: 'room' },
        { id: 't2', suit: 'wolf', ownerId: 'room' },
        { id: 't3', suit: 'wolf', ownerId: 'room' },
      ],
      playerHand: [
        { id: 'ph1', kind: 'creature', suit: 'wolf' },
        { id: 'ph2', kind: 'creature', suit: 'wolf' },
        { id: 'ph3', kind: 'creature', suit: 'wolf' },
      ],
      playsRemaining: 3,
    });
    for (const id of ['ph1', 'ph2', 'ph3']) {
      splitState = applyCombatAction(
        splitState,
        { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: [id] },
        rngSplit,
      );
    }
    const splitDamage = 40 - splitState.enemies[0].hp;
    // The first single claims all 3 room wolf cards (3 already there + 1
    // played = 4 on the table x 1 hand = 4), leaving nothing but the
    // player's own prior contribution to compound off of for the next two
    // singles (1 already there + 1 played = 2 x 1 = 2, then 2 already there
    // + 1 played = 3 x 1 = 3) -- plus each of the 3 singles' own +1 basic
    // rider on top of its own magnitude: (4+1) + (2+1) + (3+1).
    expect(splitDamage).toBe(4 + 1 + (2 + 1) + (3 + 1));

    expect(splitDamage).toBeLessThan(bigPlayDamage);
  });
});

describe('persistence across owners until each owner\'s own-turn start wipe', () => {
  it('a play\'s cards stay on the table through the whole round, wiping only at the owner\'s own next turn', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ instanceId: 'e1' }), makeEnemy({ instanceId: 'e2' })],
    });
    const rng = createRng(50);
    let state: CombatState = makeCombat(room, rng, 30, 30, {
      table: [],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
      enemies: [
        makeEnemy({ instanceId: 'e1', hand: [{ id: 'e1h1', kind: 'creature', suit: 'vigor' }] }),
        makeEnemy({ instanceId: 'e2', hand: [] }),
      ],
    });

    state = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );
    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
    expect(state.activeTurn).toBe('enemy');
    expect(state.table.some((c) => c.id === 'ph1' && c.ownerId === 'player')).toBe(true);

    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng); // e1 acts
    expect(state.table.some((c) => c.id === 'ph1' && c.ownerId === 'player')).toBe(true); // round not over yet
    expect(state.table.some((c) => c.id === 'e1h1' && c.ownerId === 'e1')).toBe(true); // e1's own play landed

    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng); // e2 acts -- round ends now
    expect(state.table.some((c) => c.id === 'ph1')).toBe(false); // player's own area wiped -- it's the player's turn again
    expect(state.table.some((c) => c.id === 'e1h1' && c.ownerId === 'e1')).toBe(true); // e1 hasn't had another turn yet -- untouched
  });
});

describe('the room\'s automatic per-round deal', () => {
  it('keeps its unclaimed prior contribution and deals a fresh wave on top every round, never reachable via a dispatched action', () => {
    const room = makeRoom({ params: { ...makeRoom().params, tableDealSize: 3 } });
    const rng = createRng(60);
    let state: CombatState = makeCombat(room, rng, 30, 30, {
      table: [
        { id: 'r-old-1', suit: 'wolf', ownerId: 'room' },
        { id: 'r-old-2', suit: 'wolf', ownerId: 'room' },
      ],
      playerHand: [],
      enemies: [makeEnemy({ hand: [] })],
    });

    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng); // round ends -- room deals again

    const newRoomCards = state.table.filter((c) => c.ownerId === 'room');
    // Nothing claimed the old cards this round -- they're still there, on
    // top of whatever the fresh deal added.
    expect(newRoomCards.some((c) => c.id === 'r-old-1')).toBe(true);
    expect(newRoomCards.some((c) => c.id === 'r-old-2')).toBe(true);
    expect(newRoomCards.length).toBeGreaterThan(2);
    expect(state.log.some((l) => l.type === 'room-deal')).toBe(true);
  });

  it('is claimed away by a play, and does not come back on its own the next round', () => {
    const room = makeRoom({ params: { ...makeRoom().params, tableDealSize: 3 } });
    const rng = createRng(61);
    let state: CombatState = makeCombat(room, rng, 30, 30, {
      table: [
        { id: 'r-old-1', suit: 'wolf', ownerId: 'room' },
        { id: 'r-old-2', suit: 'wolf', ownerId: 'room' },
      ],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
      enemies: [makeEnemy({ hand: [] })],
    });

    state = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );
    // Claimed the instant the play read the wolf table count.
    expect(state.table.some((c) => c.id === 'r-old-1' || c.id === 'r-old-2')).toBe(false);

    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng); // round ends -- room deals again
    expect(state.table.some((c) => c.id === 'r-old-1' || c.id === 'r-old-2')).toBe(false);
  });
});

describe('room deal frequency (dealsPerRound)', () => {
  it('deals dealsPerRound.max batches of tableDealSize in the opening round for a fixed-frequency room', () => {
    const room = makeRoom({
      params: { ...makeRoom().params, tableDealSize: 3, dealsPerRound: { min: 2, max: 2 } },
    });
    const rng = createRng(80);
    const state = initCombat(room, rng, 30, 30, DEFAULT_DECK);
    expect(state.table.filter((c) => c.ownerId === 'room').length).toBe(6); // 2 batches x 3 cards
  });

  it('deals dealsPerRound.max batches again on top of the unclaimed prior wave, for a steady two-a-turn room', () => {
    const room = makeRoom({
      params: { ...makeRoom().params, tableDealSize: 3, dealsPerRound: { min: 2, max: 2 } },
    });
    const rng = createRng(81);
    let state: CombatState = makeCombat(room, rng, 30, 30, {
      table: [],
      playerHand: [],
      enemies: [makeEnemy({ hand: [] })],
    });

    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng); // round ends -- room deals 2 batches

    expect(state.table.filter((c) => c.ownerId === 'room').length).toBe(6); // 2 batches x 3 cards
  });

  it('rolls a fresh batch count each round, within its own [min,max], for an erratic-frequency room', () => {
    const room = makeRoom({
      params: { ...makeRoom().params, tableDealSize: 2, dealsPerRound: { min: 1, max: 4 } },
    });
    const rng = createRng(82);
    let state: CombatState = makeCombat(room, rng, 30, 30, {
      table: [],
      playerHand: [],
      enemies: [makeEnemy({ hand: [] })],
    });

    for (let i = 0; i < 5; i++) {
      const before = state.table.filter((c) => c.ownerId === 'room').length;
      state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
      state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
      const dealtThisRound = state.table.filter((c) => c.ownerId === 'room').length - before;
      expect(dealtThisRound).toBeGreaterThanOrEqual(2); // 1 batch x 2 cards
      expect(dealtThisRound).toBeLessThanOrEqual(8); // 4 batches x 2 cards
      expect(dealtThisRound % 2).toBe(0); // always a whole number of tableDealSize-sized batches
    }
  });
});

describe('enemy turn resolution', () => {
  it('an enemy\'s threat play always hits the player, never another enemy', () => {
    const room = makeRoom({ enemies: [makeEnemy({ instanceId: 'e1' })] });
    const rng = createRng(70);
    const state: CombatState = makeCombat(room, rng, 30, 30, {
      table: [{ id: 't1', suit: 'wolf', ownerId: 'room' }],
      playerHand: [],
      enemies: [makeEnemy({ instanceId: 'e1', hand: [{ id: 'e1h1', kind: 'creature', suit: 'wolf' }] })],
      activeTurn: 'enemy',
      activeEnemyIndex: 0,
    });

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    // 1 already on the table + 1 played = 2 on the table x 1 hand card = 2,
    // plus the played card's own +1 basic rider = 3
    expect(next.playerHP).toBe(30 - 2 - 1);
    expect(next.log.some((l) => l.type === 'play' && l.actor === 'enemy')).toBe(true);
  });

  it('has nothing to play and logs a pass when its hand is empty', () => {
    const room = makeRoom({ enemies: [makeEnemy({ instanceId: 'e1' })] });
    const rng = createRng(71);
    const state: CombatState = makeCombat(room, rng, 30, 30, {
      playerHand: [],
      enemies: [makeEnemy({ instanceId: 'e1', hand: [] })],
      activeTurn: 'enemy',
      activeEnemyIndex: 0,
    });

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(next.playerHP).toBe(30);
    expect(next.log.some((l) => l.type === 'pass' && l.actor === 'enemy')).toBe(true);
  });
});

describe('guard suit (Ward)', () => {
  it('a player play banks Guard equal to the usual play magnitude plus its cards\' basic rider guard, with no HP/enemy effect', () => {
    const room = makeRoom();
    const rng = createRng(15);
    const state = makeCombat(room, rng, 30, 30, {
      table: [
        { id: 't1', suit: 'ward', ownerId: 'room' },
        { id: 't2', suit: 'ward', ownerId: 'room' },
      ],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'ward' }],
    });
    const next = applyCombatAction(state, { type: 'PLAY_SET', suit: 'ward', handCardIds: ['ph1'] }, rng);

    // 2 already on the table + 1 played = 3 on the table x 1 hand card = 3,
    // plus the played card's own +1 basic rider guard = 4
    expect(next.playerGuard).toBe(4);
    expect(next.playerHP).toBe(30);
    expect(next.enemies[0].hp).toBe(20);
  });

  it('absorbs incoming enemy attack damage before it reaches player HP', () => {
    const room = makeRoom();
    const rng = createRng(16);
    let state = makeCombat(room, rng, 30, 30, {
      table: [{ id: 't1', suit: 'wolf', ownerId: 'room' }],
      playerGuard: 2,
      playerHand: [],
      enemies: [makeEnemy({ hand: [{ id: 'e1h1', kind: 'creature', suit: 'wolf' }] })],
      activeTurn: 'enemy',
      activeEnemyIndex: 0,
    });

    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    // 1 already on the table + 1 played = 2 on the table x 1 hand card = 2,
    // fully absorbed by the 2 banked Guard -- but the rider fires as a
    // separate absorbDamage call afterward, by which point Guard is already
    // spent, so its own +1 basic rider damage gets through untouched.
    expect(state.playerHP).toBe(29);
    expect(state.playerGuard).toBe(0);
  });

  it('an enemy playing Ward banks Guard on itself, not the player', () => {
    const room = makeRoom({ enemies: [makeEnemy({ instanceId: 'e1' })] });
    const rng = createRng(110);
    let state: CombatState = makeCombat(room, rng, 30, 30, {
      table: [{ id: 'wt1', suit: 'ward', ownerId: 'room' }],
      playerHand: [],
      enemies: [makeEnemy({ instanceId: 'e1', hand: [{ id: 'e1w1', kind: 'creature', suit: 'ward' }] })],
      activeTurn: 'enemy',
      activeEnemyIndex: 0,
    });

    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    const e1 = state.enemies.find((e) => e.instanceId === 'e1')!;
    // 1 already on the table + 1 played = 2 on the table x 1 hand card = 2,
    // plus the played card's own +1 basic rider guard = 3
    expect(e1.guard).toBe(3);
    expect(state.playerGuard).toBe(0);
  });
});

describe('Guard never auto-resets', () => {
  it('persists across multiple full rounds untouched until it actually absorbs damage', () => {
    const room = makeRoom({ enemies: [makeEnemy({ instanceId: 'e1', hp: 20, hpMax: 20 })] });
    const rng = createRng(100);
    let state: CombatState = makeCombat(room, rng, 30, 30, {
      playerGuard: 5,
      playerHand: [],
      enemies: [makeEnemy({ instanceId: 'e1', hand: [] })],
    });

    for (let i = 0; i < 3; i++) {
      state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
      state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    }
    expect(state.playerGuard).toBe(5);
  });
});

describe('weaken suit (Hex)', () => {
  it('a player play inflicts Weaken stacks on the chosen enemy, with only its cards\' small basic rider chipping HP, mirroring an enemy\'s own Debuff', () => {
    const room = makeRoom();
    const rng = createRng(27);
    const state = makeCombat(room, rng, 30, 30, {
      table: [
        { id: 't1', suit: 'hex', ownerId: 'room' },
        { id: 't2', suit: 'hex', ownerId: 'room' },
      ],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'hex' }],
    });
    const next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'hex', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );
    expect(next.enemies[0].statuses.weaken).toBe(3); // 2 already on the table + 1 played = 3 on the table x 1 hand card
    // Weaken itself does no HP damage -- but weaken is still a "threat-like"
    // category for rider purposes (config/specialCards.ts's
    // riderKindForCategory), so the played card's own +1 basic rider still
    // chips 1 HP.
    expect(next.enemies[0].hp).toBe(20 - 1);
  });

  it('requires an enemy target the same way a threat play does', () => {
    const room = makeRoom();
    const rng = createRng(28);
    const state = makeCombat(room, rng, 30, 30, {
      table: [
        { id: 't1', suit: 'hex', ownerId: 'room' },
        { id: 't2', suit: 'hex', ownerId: 'room' },
      ],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'hex' }],
    });
    const legal = getLegalPlaySets(state).filter((t) => t.suit === 'hex');
    expect(legal.length).toBe(1);
    expect(legal[0].targetInstanceId).toBe('e1');
    expect(requiresEnemyTarget('weaken')).toBe(true);

    const rejected = applyCombatAction(state, { type: 'PLAY_SET', suit: 'hex', handCardIds: ['ph1'] }, rng);
    expect(rejected).toBe(state); // illegal play (no targetInstanceId), state unchanged
  });

  it('debuff applies Weaken stacks that reduce the player\'s next play, decaying by 1 (not fully) at the player\'s own turn end', () => {
    const room = makeRoom({ enemies: [makeEnemy({ instanceId: 'e1' })] });
    const rng = createRng(6);
    let state: CombatState = makeCombat(room, rng, 30, 30, {
      playerHand: [],
      table: [
        { id: 'seed-hex-1', suit: 'hex', ownerId: 'room' },
        { id: 'seed-hex-2', suit: 'hex', ownerId: 'room' },
      ],
      enemies: [makeEnemy({ instanceId: 'e1', hand: [{ id: 'e1h1', kind: 'creature', suit: 'hex' }] })],
      activeTurn: 'enemy',
      activeEnemyIndex: 0,
    });
    // 1 enemy -- this ENEMY_TURN also concludes the round (table/hand
    // auto-redealt/redrawn), so the weaken stacks it lands are read first,
    // then the specific rot table/hand this play needs is forced after.
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(state.playerStatuses.weaken).toBeGreaterThan(0);
    const stacks = state.playerStatuses.weaken!;

    state = {
      ...state,
      table: [
        { id: 't1', suit: 'rot', ownerId: 'room' },
        { id: 't2', suit: 'rot', ownerId: 'room' },
      ],
      playerHand: [
        { id: 'ph1', kind: 'creature', suit: 'rot' },
        { id: 'ph2', kind: 'creature', suit: 'rot' },
      ],
    };
    // raw magnitude = (2 already on the table + 2 played = 4 on the table) x 2 hand = 8, weakened by a
    // flat WEAKEN_PCT (25%) regardless of stack count -- stacks are duration only, not intensity.
    let next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'rot', targetInstanceId: 'e1', handCardIds: ['ph1', 'ph2'] },
      rng,
    );
    const expectedMagnitude = Math.round(8 * (1 - 0.25));
    // The rider is a flat bonus, not run through withWeaken -- each of the 2
    // played cards' own +1 basic rider (2 total) lands unweakened, on top of
    // the weakened main magnitude.
    expect(next.enemies[0].hp).toBe(20 - expectedMagnitude - 2);
    expect(next.playerStatuses.weaken).toBe(stacks); // turn hasn't ended yet -- no decay tick

    next = applyCombatAction(next, { type: 'PLAYER_PASS' }, rng);
    expect(next.playerStatuses.weaken).toBe(stacks - 1); // decays by 1 at the end of the player's turn
  });

  it('a large pile of Weaken stacks still only cuts the flat WEAKEN_PCT -- never zeroes out damage', () => {
    const room = makeRoom({ enemies: [makeEnemy({ instanceId: 'e1' })] });
    const rng = createRng(6);
    const state: CombatState = makeCombat(room, rng, 30, 30, {
      playerStatuses: { weaken: 25 }, // far more stacks than the old %-per-stack math could tolerate
      table: [
        { id: 't1', suit: 'rot', ownerId: 'room' },
        { id: 't2', suit: 'rot', ownerId: 'room' },
      ],
      playerHand: [
        { id: 'ph1', kind: 'creature', suit: 'rot' },
        { id: 'ph2', kind: 'creature', suit: 'rot' },
      ],
    });
    // raw magnitude = (2 + 2) x 2 = 8, cut by a flat 25% regardless of the 25 stacks held.
    const next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'rot', targetInstanceId: 'e1', handCardIds: ['ph1', 'ph2'] },
      rng,
    );
    const expectedMagnitude = Math.round(8 * (1 - 0.25));
    expect(expectedMagnitude).toBeGreaterThan(0);
    expect(next.enemies[0].hp).toBe(20 - expectedMagnitude - 2);
  });
});

describe('poison suit (Venom)', () => {
  it('a player play inflicts Poison stacks on the chosen enemy, which deal damage on that enemy\'s own turn', () => {
    const room = makeRoom();
    const rng = createRng(29);
    let state: CombatState = makeCombat(room, rng, 30, 30, {
      table: [
        { id: 't1', suit: 'venom', ownerId: 'room' },
        { id: 't2', suit: 'venom', ownerId: 'room' },
      ],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'venom' }],
      enemies: [makeEnemy({ hand: [] })],
    });
    state = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'venom', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );
    expect(state.enemies[0].statuses.poison).toBe(3); // 2 already on the table + 1 played = 3 on the table x 1 hand card
    // Poison itself doesn't hit immediately -- but poison is still a
    // "threat-like" category for rider purposes, so the played card's own
    // +1 basic rider chips 1 HP right away.
    expect(state.enemies[0].hp).toBe(20 - 1);

    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };
    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(next.enemies[0].hp).toBe(20 - 1 - 3); // its own poison tick, at the true end of its own turn
    expect(next.enemies[0].statuses.poison).toBe(2); // decays by 1
  });

  it('ignores Guard entirely -- a poisoned enemy\'s own tick lands straight on HP, and its Guard is untouched', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ instanceId: 'e1', hp: 20, hpMax: 20, guard: 10, statuses: { poison: 3 }, hand: [] })],
    });
    const rng = createRng(31);
    const state = makeCombat(room, rng, 30, 30, { playerHand: [], activeTurn: 'enemy', activeEnemyIndex: 0 });
    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(next.enemies[0].hp).toBe(20 - 3); // poison bypasses its 10 Guard entirely
    expect(next.enemies[0].guard).toBe(10); // Guard is left untouched, not consumed
  });

  it('ignores Guard entirely -- the player\'s own poison tick lands straight on HP, and their Guard is untouched', () => {
    const room = makeRoom({ enemies: [makeEnemy({ instanceId: 'e1' })] });
    const rng = createRng(32);
    const state = makeCombat(room, rng, 30, 30, {
      playerHand: [],
      playerGuard: 10,
      playerStatuses: { poison: 4 },
    });
    const next = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
    expect(next.playerHP).toBe(30 - 4); // poison bypasses the 10 Guard entirely
    expect(next.playerGuard).toBe(10); // Guard is left untouched, not consumed
  });
});

describe('strength suit (Vigor) and boon suit (Grace)', () => {
  it('a player play grants the player Strength stacks -- no target needed, no HP/enemy effect', () => {
    const room = makeRoom();
    const rng = createRng(30);
    const state = makeCombat(room, rng, 30, 30, {
      table: [
        { id: 't1', suit: 'vigor', ownerId: 'room' },
        { id: 't2', suit: 'vigor', ownerId: 'room' },
      ],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'vigor' }],
    });
    let next = applyCombatAction(state, { type: 'PLAY_SET', suit: 'vigor', handCardIds: ['ph1'] }, rng);
    // 2 already on the table + 1 played = 3 on the table x 1 hand card
    expect(next.playerStatuses.strength).toBe(3);
    expect(next.playerHP).toBe(30);

    next = applyCombatAction(next, { type: 'PLAYER_PASS' }, rng);
    expect(next.playerStatuses.strength).toBe(2);
  });

  it('player Strength boosts a threat play by adding stacks to the table count before the hand-card multiplier', () => {
    const room = makeRoom();
    const rng = createRng(25);
    const state = makeCombat(room, rng, 30, 30, {
      table: [{ id: 't1', suit: 'wolf', ownerId: 'room' }],
      playerStatuses: { strength: 3 },
      playerHand: [
        { id: 'ph1', kind: 'creature', suit: 'wolf' },
        { id: 'ph2', kind: 'creature', suit: 'wolf' },
      ],
    });
    // (1 already on the table + 2 played = 3, +3 Strength = 6) x 2 hand
    // cards = 12, plus each of the 2 played cards' own +1 basic rider = 14
    const next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1', 'ph2'] },
      rng,
    );
    expect(next.enemies[0].hp).toBe(20 - 12 - 2);
  });

  it('heals the player when played -- no target instance needed', () => {
    const room = makeRoom();
    const rng = createRng(14);
    const state = makeCombat(room, rng, 20, 30, {
      table: [
        { id: 't1', suit: 'grace', ownerId: 'room' },
        { id: 't2', suit: 'grace', ownerId: 'room' },
      ],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'grace' }],
    });
    const next = applyCombatAction(state, { type: 'PLAY_SET', suit: 'grace', handCardIds: ['ph1'] }, rng);
    // 2 already on the table + 1 played = 3 on the table x 1 hand card = 3
    expect(next.playerHP).toBe(23);
  });

  it('an enemy Strength buff boosts its own next attack, decaying by 1 per its own turn', () => {
    const room = makeRoom({ enemies: [makeEnemy({ instanceId: 'e1' })] });
    const rng = createRng(24);
    let state: CombatState = makeCombat(room, rng, 30, 30, {
      playerHand: [],
      table: [
        { id: 't1', suit: 'vigor', ownerId: 'room' },
        { id: 't2', suit: 'vigor', ownerId: 'room' },
      ],
      enemies: [
        makeEnemy({
          instanceId: 'e1',
          hand: [
            { id: 'e1v1', kind: 'creature', suit: 'vigor' },
            { id: 'e1v2', kind: 'creature', suit: 'vigor' },
          ],
        }),
      ],
      activeTurn: 'enemy',
      activeEnemyIndex: 0,
    });

    // Plays both vigor cards (a play always commits every hand card of the
    // chosen suit): 2 already on the table + 2 played = 4 on the table x 2
    // hand = 8 Strength, then decays by 1 at this same turn's own end -> 7.
    // 1 enemy -- this also concludes the round.
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(state.enemies[0].statuses.strength).toBe(7);
    expect(state.activeTurn).toBe('player');

    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
    expect(state.activeTurn).toBe('enemy');

    // Force a wolf attack card into the same enemy's hand and a matching table pile.
    state = {
      ...state,
      table: [{ id: 'wt1', suit: 'wolf', ownerId: 'room' }],
      enemies: [{ ...state.enemies[0], hand: [{ id: 'e1w1', kind: 'creature', suit: 'wolf' }] }],
    };
    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    // 1 already on the table + 1 played = 2 on the table, boosted by 7
    // remaining Strength -> 9, x hand 1 = 9, plus the played card's own +1
    // basic rider = 10
    expect(next.playerHP).toBe(30 - 9 - 1);
    expect(next.enemies[0].statuses.strength).toBe(6); // decays again after this turn
  });
});

describe('enemy defeated mid-phase (corpse)', () => {
  it('is kept as a corpse until round end so later enemies still get their turn, and its already-played table cards survive its removal', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ instanceId: 'e1' }), makeEnemy({ instanceId: 'e2' })],
    });
    const rng = createRng(90);
    let state: CombatState = makeCombat(room, rng, 30, 30, {
      playerHand: [],
      table: [],
      enemies: [
        makeEnemy({
          instanceId: 'e1',
          defId: 'rot-husk',
          name: 'Rot Husk',
          hp: 3,
          hpMax: 18,
          statuses: { poison: 5 },
          hand: [{ id: 'e1c1', kind: 'creature', suit: 'hex' }],
        }),
        makeEnemy({ instanceId: 'e2', defId: 'wolf-kin', name: 'Wolf-kin', hp: 14, hpMax: 14, hand: [] }),
      ],
      activeTurn: 'enemy',
      activeEnemyIndex: 0,
    });

    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng); // e1 acts, then its own poison tick kills it
    expect(state.enemies.length).toBe(2); // corpse retained mid-phase, not spliced out yet
    expect(state.enemies.find((e) => e.instanceId === 'e1')!.hp).toBe(0);
    expect(state.activeTurn).toBe('enemy');
    expect(state.activeEnemyIndex).toBe(1); // correctly advanced to e2
    expect(state.table.some((c) => c.id === 'e1c1' && c.ownerId === 'e1')).toBe(true);

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng); // e2 still gets its turn
    expect(next.enemies.length).toBe(1); // corpse swept once the round concludes
    expect(next.enemies[0].instanceId).toBe('e2');
    expect(next.activeTurn).toBe('player');
    // e1's contribution stays on the table permanently -- it will never get another turn to wipe it.
    expect(next.table.some((c) => c.id === 'e1c1' && c.ownerId === 'e1')).toBe(true);
  });
});

describe('no decay, ever', () => {
  it('an idle table pile never auto-resolves, and no decay-typed log entry is ever produced', () => {
    const room = makeRoom({ enemies: [makeEnemy({ instanceId: 'e1', hp: 20, hpMax: 20 })] });
    const rng = createRng(120);
    let state: CombatState = makeCombat(room, rng, 30, 30, {
      playerHand: [],
      table: [
        { id: 'rot1', suit: 'rot', ownerId: 'room' },
        { id: 'rot2', suit: 'rot', ownerId: 'room' },
      ],
      enemies: [makeEnemy({ instanceId: 'e1', hand: [] })],
    });

    for (let i = 0; i < 10 && state.status === 'active'; i++) {
      const action = state.activeTurn === 'player' ? { type: 'PLAYER_PASS' as const } : { type: 'ENEMY_TURN' as const };
      state = applyCombatAction(state, action, rng);
    }

    expect(state.log.some((l) => l.type === 'decay')).toBe(false);
    expect(state.status).toBe('active');
    expect(state.playerHP).toBe(30);
    expect(state.enemies[0].hp).toBe(20);
  });
});

describe('enemy hand/deck cycling', () => {
  it('discards an enemy\'s whole hand and draws a fresh one from its own deck after its own turn, conserving every card', () => {
    const room = makeRoom({ enemies: [makeEnemy({ instanceId: 'e1', defId: 'wolf-kin' })] });
    const rng = createRng(70);
    let state = initCombat(room, rng, 30, 30, DEFAULT_DECK);
    const enemy = state.enemies[0];
    const wolfKinHandSize = enemyDefById('wolf-kin').handSize;
    expect(enemy.hand.length).toBe(wolfKinHandSize);
    const originalHandIds = enemy.hand.map((c) => c.id);

    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);

    const after = state.enemies.find((e) => e.instanceId === 'e1')!;
    expect(after.hand.length).toBe(wolfKinHandSize);
    expect(after.hand.map((c) => c.id)).not.toEqual(originalHandIds);

    const deckSize = enemyDefById('wolf-kin').deck.length;
    const allIdsAfter = new Set([
      ...after.hand.map((c) => c.id),
      ...after.drawPile.map((c) => c.id),
      ...after.discardPile.map((c) => c.id),
      ...state.table.filter((c) => c.ownerId === 'e1').map((c) => c.id),
    ]);
    expect(allIdsAfter.size).toBe(deckSize);
  });

  it('never shares hand/deck array identity between two same-defId instances', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ instanceId: 'e1', defId: 'wolf-kin' }), makeEnemy({ instanceId: 'e2', defId: 'wolf-kin' })],
    });
    const rng = createRng(72);
    const state = initCombat(room, rng, 30, 30, DEFAULT_DECK);
    expect(state.enemies[0].hand).not.toBe(state.enemies[1].hand);
    // Compare full shuffled order (hand + drawPile), not just the opening
    // hand -- with a small per-def handSize, two independent shuffles can
    // coincidentally deal the same couple of cards into the hand slice even
    // though the underlying shuffles (and therefore draw piles) differ.
    const shuffledOrder = (e: EnemyInstance) => [...e.hand, ...e.drawPile].map((c) => c.id);
    expect(shuffledOrder(state.enemies[0])).not.toEqual(shuffledOrder(state.enemies[1]));
  });
});

describe('enemy AI (engine/enemyAI.ts)', () => {
  it('always produces a play using cards actually in the enemy\'s hand', () => {
    const enemy = makeEnemy({
      hand: [
        { id: 'h1', kind: 'creature', suit: 'wolf' },
        { id: 'h2', kind: 'creature', suit: 'ward' },
      ],
    });
    const rng = createRng(80);
    const choice = chooseEnemyPlay(enemy, [], rng);
    expect(choice).not.toBeNull();
    expect(['wolf', 'ward']).toContain(choice!.suit);
    for (const id of choice!.handCardIds) {
      expect(enemy.hand.some((c) => c.id === id && c.suit === choice!.suit)).toBe(true);
    }
  });

  it('returns null when the enemy\'s hand is empty', () => {
    const enemy = makeEnemy({ hand: [] });
    expect(chooseEnemyPlay(enemy, [], createRng(81))).toBeNull();
  });

  it('biases toward boon/guard suits when the enemy is below the low-HP threshold', () => {
    const hand: CreatureCard[] = [
      { id: 'atk', kind: 'creature', suit: 'wolf' },
      { id: 'heal', kind: 'creature', suit: 'grace' },
    ];
    const table: TableCard[] = [];

    function healPickRate(hp: number, hpMax: number, seedStart: number): number {
      let healPicks = 0;
      const trials = 200;
      for (let i = 0; i < trials; i++) {
        const enemy = makeEnemy({ hp, hpMax, hand });
        const choice = chooseEnemyPlay(enemy, table, createRng(seedStart + i));
        if (choice?.suit === 'grace') healPicks++;
      }
      return healPicks / trials;
    }

    const lowHpRate = healPickRate(1, 20, 1000);
    const healthyRate = healPickRate(20, 20, 2000);
    expect(lowHpRate).toBeGreaterThan(healthyRate);
  });
});

describe('hand discard & redraw (persistent deck) -- player', () => {
  it('keeps unplayed hand cards and only tops up the shortfall once the enemy phase concludes, conserving every card', () => {
    const room = makeRoom();
    const rng = createRng(17);
    const deck = makeDeck('wolf', 8, 'pd');
    let state = initCombat(room, rng, 30, 30, deck);
    const originalHandIds = state.playerHand.map((c) => c.id);
    const playedId = originalHandIds[0];

    state = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: [playedId] },
      rng,
    );
    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);

    expect(state.activeTurn).toBe('player');
    expect(state.playerHand.length).toBe(room.params.playerHandSize);
    // Every card that wasn't played stays in hand -- only the played card's slot got refilled.
    for (const id of originalHandIds.slice(1)) {
      expect(state.playerHand.some((c) => c.id === id)).toBe(true);
    }
    expect(state.playerHand.some((c) => c.id === playedId)).toBe(false);
    expect(state.log.some((l) => l.type === 'redraw')).toBe(true);

    const allIdsNow = new Set([
      ...state.playerHand.map((c) => c.id),
      ...state.drawPile.map((c) => c.id),
      ...state.discardPile.map((c) => c.id),
    ]);
    expect(allIdsNow.size).toBe(deck.length);
    for (const c of deck) expect(allIdsNow.has(c.id)).toBe(true);
  });

  it('routes played cards to the discard pile, where they can be drawn again later in the same room', () => {
    const room = makeRoom();
    const rng = createRng(40);
    const deck: Card[] = [
      { id: 'tiny-1', kind: 'creature', suit: 'wolf' },
      { id: 'tiny-2', kind: 'creature', suit: 'wolf' },
    ];
    let state = initCombat(room, rng, 30, 30, deck);
    const playedId = state.playerHand[0].id;

    state = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: [playedId] },
      rng,
    );
    expect(state.discardPile.some((c) => c.id === playedId)).toBe(true);

    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);

    const seenAgain = [...state.playerHand, ...state.drawPile, ...state.discardPile].some((c) => c.id === playedId);
    expect(seenAgain).toBe(true);
  });
});

describe('relics', () => {
  it('a rider-bonus relic scoped to a category adds its flat bonus-damage on top of the play\'s own basic rider', () => {
    const room = makeRoom({ enemies: [makeEnemy({ hp: 30, hpMax: 30 })] });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: [],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
      relics: [relicById('bloodletters-mark')],
    });

    const next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );

    // 0 on table + 1 played = 1 on the table x 1 hand card = 1, plus the
    // card's own +1 basic rider, plus Bloodletter's Mark's +1 category rider = 3
    expect(next.enemies[0].hp).toBe(30 - 3);
    expect(next.log.some((l) => l.message.includes("Bloodletter's Mark"))).toBe(true);
  });

  it('a rider-bonus relic scoped to a category adds its flat bonus-guard the same way', () => {
    const room = makeRoom({ params: { ...makeRoom().params, threatSuits: ['ward'] } });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: [],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'ward' }],
      relics: [relicById('reinforced-plating')],
    });

    const next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'ward', handCardIds: ['ph1'] },
      rng,
    );

    // 0 on table + 1 played = 1 x 1 = 1, plus the card's own +1 basic rider
    // guard, plus Reinforced Plating's +1 category rider guard = 3
    expect(next.playerGuard).toBe(3);
  });

  it('a status-on-claim relic inflicts its status on the enemy target for an enemy-facing suit', () => {
    const room = makeRoom({ enemies: [makeEnemy({ hp: 30, hpMax: 30 })] });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: [],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
      relics: [relicById('alphas-snare')],
    });

    const next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );

    expect(next.enemies[0].statuses.weaken).toBe(1);
  });

  it('a status-on-claim relic scoped to a self-targeting suit buffs the actor instead of an enemy', () => {
    const room = makeRoom({ params: { ...makeRoom().params, threatSuits: ['grace'] } });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: [],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'grace' }],
      relics: [relicById('blessing-of-vigor')],
    });

    const next = applyCombatAction(state, { type: 'PLAY_SET', suit: 'grace', handCardIds: ['ph1'] }, rng);

    expect(next.playerStatuses.strength).toBe(1);
  });

  it('a relic scoped to a different suit/category does nothing', () => {
    const room = makeRoom({ enemies: [makeEnemy({ hp: 30, hpMax: 30 })] });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: [],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
      // Guard-scoped/Grace-scoped relics, neither of which matches a Wolf play.
      relics: [relicById('reinforced-plating'), relicById('venomous-bite')],
    });

    const next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );

    // 0 on table + 1 played = 1 x 1 = 1, plus the card's own +1 basic rider = 2 -- no relic bonus.
    expect(next.enemies[0].hp).toBe(30 - 2);
    expect(next.enemies[0].statuses.poison).toBeUndefined();
    expect(next.playerGuard).toBe(0);
  });
});

describe('potions', () => {
  it('Free Claim resolves a threat suit\'s flat table total as damage, with no play spent and the turn continuing', () => {
    const room = makeRoom({ enemies: [makeEnemy({ hp: 30, hpMax: 30 })] });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: [
        { id: 't1', suit: 'wolf', ownerId: 'room' },
        { id: 't2', suit: 'wolf', ownerId: 'room' },
        { id: 't3', suit: 'wolf', ownerId: 'room' },
      ],
      potions: [potionById('free-claim')],
    });

    const next = applyCombatAction(
      state,
      { type: 'USE_FREE_CLAIM_POTION', suit: 'wolf', targetInstanceId: 'e1' },
      rng,
    );

    // Flat 1:1 -- no hand-card multiplier, no rider, no Strength/Weaken.
    expect(next.enemies[0].hp).toBe(30 - 3);
    expect(next.playsRemaining).toBe(state.playsRemaining);
    expect(next.activeTurn).toBe('player');
    expect(next.potions).toEqual([]);
    expect(next.log.some((l) => l.type === 'potion' && l.message.includes('Free Claim'))).toBe(true);
  });

  it('Free Claim fans out over every alive enemy for a threat suit, same as a real play', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ instanceId: 'e1', hp: 30, hpMax: 30 }), makeEnemy({ instanceId: 'e2', hp: 30, hpMax: 30 })],
    });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: [{ id: 't1', suit: 'wolf', ownerId: 'room' }],
      potions: [potionById('free-claim')],
    });

    const uses = getLegalFreeClaimUses(state).filter((u) => u.suit === 'wolf');
    expect(uses.length).toBe(2);
    expect(uses.every((u) => u.amount === 1)).toBe(true);

    const next = applyCombatAction(state, { type: 'USE_FREE_CLAIM_POTION', suit: 'wolf', targetInstanceId: 'e2' }, rng);
    expect(next.enemies.find((e) => e.instanceId === 'e1')!.hp).toBe(30); // untouched
    expect(next.enemies.find((e) => e.instanceId === 'e2')!.hp).toBe(29);
  });

  it('Free Claim only claims the room\'s own matching cards -- the player\'s/an enemy\'s own contribution to that suit\'s table count stays on the table', () => {
    const room = makeRoom({ enemies: [makeEnemy({ instanceId: 'e1', hp: 30, hpMax: 30 })] });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: [
        { id: 't1', suit: 'wolf', ownerId: 'room' },
        { id: 't2', suit: 'wolf', ownerId: 'room' },
        { id: 't3', suit: 'wolf', ownerId: 'e1' },
      ],
      potions: [potionById('free-claim')],
    });

    const next = applyCombatAction(state, { type: 'USE_FREE_CLAIM_POTION', suit: 'wolf', targetInstanceId: 'e1' }, rng);

    // amount = all 3 owners combined, but only the 2 room-owned cards are
    // actually removed from the table -- e1's own contribution is untouched
    // (only e1's own next-turn wipe ever clears it).
    expect(next.enemies[0].hp).toBe(30 - 3);
    expect(next.table.filter((c) => c.suit === 'wolf' && c.ownerId === 'room').length).toBe(0);
    expect(next.table.some((c) => c.id === 't3' && c.ownerId === 'e1')).toBe(true);
  });

  it('Free Claim on a guard suit banks flat Guard, on a weaken suit inflicts flat stacks, and on a strength suit self-buffs -- all with no play spent', () => {
    const room = makeRoom();
    const rng = createRng(1);

    const guardState = makeCombat(room, rng, 30, 30, {
      table: [{ id: 'w1', suit: 'ward', ownerId: 'room' }, { id: 'w2', suit: 'ward', ownerId: 'room' }],
      potions: [potionById('free-claim')],
    });
    const guardNext = applyCombatAction(guardState, { type: 'USE_FREE_CLAIM_POTION', suit: 'ward' }, rng);
    expect(guardNext.playerGuard).toBe(2);

    const weakenState = makeCombat(room, rng, 30, 30, {
      table: [{ id: 'h1', suit: 'hex', ownerId: 'room' }],
      potions: [potionById('free-claim')],
    });
    const weakenNext = applyCombatAction(weakenState, { type: 'USE_FREE_CLAIM_POTION', suit: 'hex', targetInstanceId: 'e1' }, rng);
    expect(weakenNext.enemies[0].statuses.weaken).toBe(1);
    expect(weakenNext.enemies[0].hp).toBe(20); // no rider -- untouched HP

    const strengthState = makeCombat(room, rng, 30, 30, {
      table: [{ id: 'v1', suit: 'vigor', ownerId: 'room' }, { id: 'v2', suit: 'vigor', ownerId: 'room' }],
      potions: [potionById('free-claim')],
    });
    const strengthNext = applyCombatAction(strengthState, { type: 'USE_FREE_CLAIM_POTION', suit: 'vigor' }, rng);
    expect(strengthNext.playerStatuses.strength).toBe(2);
  });

  it('is illegal without a held Free Claim potion, or when the suit has nothing on the table -- state unchanged either way', () => {
    const room = makeRoom({ enemies: [makeEnemy({ hp: 30, hpMax: 30 })] });
    const rng = createRng(1);

    const noPotion = makeCombat(room, rng, 30, 30, {
      table: [{ id: 't1', suit: 'wolf', ownerId: 'room' }],
      potions: [],
    });
    expect(getLegalFreeClaimUses(noPotion)).toEqual([]);
    expect(applyCombatAction(noPotion, { type: 'USE_FREE_CLAIM_POTION', suit: 'wolf', targetInstanceId: 'e1' }, rng)).toBe(noPotion);

    const emptyTable = makeCombat(room, rng, 30, 30, {
      table: [],
      potions: [potionById('free-claim')],
    });
    expect(getLegalFreeClaimUses(emptyTable).filter((u) => u.suit === 'wolf')).toEqual([]);
    expect(applyCombatAction(emptyTable, { type: 'USE_FREE_CLAIM_POTION', suit: 'wolf', targetInstanceId: 'e1' }, rng)).toBe(emptyTable);
  });

  it('Salt discards only the room\'s own pile for a suit -- no effect resolved, player/enemy-owned cards of that suit untouched', () => {
    const room = makeRoom({ enemies: [makeEnemy({ instanceId: 'e1', hp: 30, hpMax: 30 })] });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: [
        { id: 't1', suit: 'wolf', ownerId: 'room' },
        { id: 't2', suit: 'wolf', ownerId: 'room' },
        { id: 't3', suit: 'wolf', ownerId: 'e1' },
      ],
      potions: [potionById('salt')],
    });

    const uses = getLegalSaltUses(state);
    expect(uses).toEqual([{ suit: 'wolf', amount: 2 }]);

    const next = applyCombatAction(state, { type: 'USE_SALT_POTION', suit: 'wolf' }, rng);

    expect(next.table.filter((c) => c.suit === 'wolf' && c.ownerId === 'room').length).toBe(0);
    expect(next.table.some((c) => c.id === 't3' && c.ownerId === 'e1')).toBe(true);
    expect(next.enemies[0].hp).toBe(30); // nothing resolved -- purely discarded
    expect(next.playerHP).toBe(30);
    expect(next.playsRemaining).toBe(state.playsRemaining);
    expect(next.activeTurn).toBe('player');
    expect(next.potions).toEqual([]);
    expect(next.log.some((l) => l.type === 'potion' && l.message.includes('Salt'))).toBe(true);
  });

  it('is illegal without a held Salt potion, or when the room holds nothing of that suit -- state unchanged either way', () => {
    const room = makeRoom();
    const rng = createRng(1);

    const noPotion = makeCombat(room, rng, 30, 30, {
      table: [{ id: 't1', suit: 'wolf', ownerId: 'room' }],
      potions: [],
    });
    expect(applyCombatAction(noPotion, { type: 'USE_SALT_POTION', suit: 'wolf' }, rng)).toBe(noPotion);

    const noRoomPile = makeCombat(room, rng, 30, 30, {
      table: [{ id: 't1', suit: 'wolf', ownerId: 'player' }],
      potions: [potionById('salt')],
    });
    expect(getLegalSaltUses(noRoomPile)).toEqual([]);
    expect(applyCombatAction(noRoomPile, { type: 'USE_SALT_POTION', suit: 'wolf' }, rng)).toBe(noRoomPile);
  });

  it('consuming one potion of a kind leaves other held potions (including other-kind and duplicate) untouched', () => {
    const room = makeRoom({ enemies: [makeEnemy({ hp: 30, hpMax: 30 })] });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: [{ id: 't1', suit: 'wolf', ownerId: 'room' }],
      potions: [potionById('free-claim'), potionById('free-claim'), potionById('salt')],
    });

    const next = applyCombatAction(state, { type: 'USE_FREE_CLAIM_POTION', suit: 'wolf', targetInstanceId: 'e1' }, rng);
    expect(next.potions).toEqual([potionById('free-claim'), potionById('salt')]);
  });
});

function roomPile(suit: SuitId, count: number, prefix = 't'): TableCard[] {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, suit, ownerId: 'room' as const }));
}

describe('currency (claim overflow)', () => {
  it('a real play claiming a room pile above the threshold converts the excess 1:1 into currency', () => {
    const room = makeRoom({ enemies: [makeEnemy({ hp: 60, hpMax: 60 })] });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: roomPile('wolf', CURRENCY_CLAIM_THRESHOLD + 3),
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
      currency: 0,
    });

    const next = applyCombatAction(state, { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] }, rng);

    expect(next.currency).toBe(3);
    expect(next.log.some((l) => l.type === 'currency' && l.message.includes('+3 currency'))).toBe(true);
  });

  it('a claim at or below the threshold grants no currency', () => {
    const room = makeRoom({ enemies: [makeEnemy({ hp: 60, hpMax: 60 })] });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: roomPile('wolf', CURRENCY_CLAIM_THRESHOLD),
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
      currency: 0,
    });

    const next = applyCombatAction(state, { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] }, rng);

    expect(next.currency).toBe(0);
    expect(next.log.some((l) => l.type === 'currency')).toBe(false);
  });

  it('a Free Claim potion converts overflow off the room-owned count specifically, not the combined-owner total Free Claim itself resolves', () => {
    const room = makeRoom({ enemies: [makeEnemy({ hp: 60, hpMax: 60 })] });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: [...roomPile('wolf', CURRENCY_CLAIM_THRESHOLD + 1), { id: 'p1', suit: 'wolf', ownerId: 'player' }],
      potions: [potionById('free-claim')],
      currency: 0,
    });

    const next = applyCombatAction(state, { type: 'USE_FREE_CLAIM_POTION', suit: 'wolf', targetInstanceId: 'e1' }, rng);

    // Free Claim's own damage reads all 7 (6 room + 1 player), but currency
    // overflow is only off the 6 room-owned cards: 6 - 5 = 1.
    expect(next.enemies[0].hp).toBe(60 - 7);
    expect(next.currency).toBe(1);
  });

  it('a Salt potion converts the discarded room pile\'s overflow into currency even though nothing else resolves', () => {
    const room = makeRoom();
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: roomPile('wolf', CURRENCY_CLAIM_THRESHOLD + 4),
      potions: [potionById('salt')],
      currency: 2,
    });

    const next = applyCombatAction(state, { type: 'USE_SALT_POTION', suit: 'wolf' }, rng);

    expect(next.currency).toBe(2 + 4);
  });

  it('an enemy\'s own claim never grants the player currency', () => {
    const room = makeRoom({ enemies: [makeEnemy({ instanceId: 'e1' })] });
    const rng = createRng(70);
    const state: CombatState = makeCombat(room, rng, 30, 30, {
      table: roomPile('wolf', CURRENCY_CLAIM_THRESHOLD + 5),
      playerHand: [],
      enemies: [makeEnemy({ instanceId: 'e1', hand: [{ id: 'e1h1', kind: 'creature', suit: 'wolf' }] })],
      activeTurn: 'enemy',
      activeEnemyIndex: 0,
      currency: 0,
    });

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);

    expect(next.currency).toBe(0);
    expect(next.log.some((l) => l.type === 'currency')).toBe(false);
  });
});

describe('Vulnerable', () => {
  it("inflates incoming threat damage on the TARGET's own stacks by a flat percentage, but leaves rider bonus damage untouched", () => {
    const room = makeRoom({ enemies: [makeEnemy({ hp: 30, hpMax: 30, statuses: { vulnerable: 1 } })] });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: [
        { id: 't1', suit: 'wolf', ownerId: 'room' },
        { id: 't2', suit: 'wolf', ownerId: 'room' },
      ],
      playerHand: [
        { id: 'ph1', kind: 'creature', suit: 'wolf' },
        { id: 'ph2', kind: 'creature', suit: 'wolf' },
      ],
    });

    const next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1', 'ph2'] },
      rng,
    );

    // 2 on table + 2 played = 4 on the table x 2 hand cards = 8 base,
    // inflated by Vulnerable's +25% -> round(8*1.25) = 10, plus each played
    // card's own +1 basic rider (never touched by Vulnerable) = 12 total.
    expect(next.enemies[0].hp).toBe(30 - 12);
  });

  it('does nothing when the target holds no Vulnerable stacks', () => {
    const room = makeRoom({ enemies: [makeEnemy({ hp: 30, hpMax: 30 })] });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: [],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
    });
    const next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );
    expect(next.enemies[0].hp).toBe(30 - 1 - 1); // 1 base + 1 basic rider, no inflation
  });
});

describe('Regen', () => {
  it("heals the holder for its current stack count at end of turn, then decays -- Poison's mirror", () => {
    const room = makeRoom({ enemies: [makeEnemy({ hp: 10, hpMax: 20, statuses: { regen: 3 }, hand: [] })] });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, { playerHand: [], activeTurn: 'enemy', activeEnemyIndex: 0 });
    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(next.enemies[0].hp).toBe(10 + 3);
    expect(next.enemies[0].statuses.regen).toBe(2);
  });

  it('caps healing at hpMax', () => {
    const room = makeRoom({ enemies: [makeEnemy({ hp: 19, hpMax: 20, statuses: { regen: 3 }, hand: [] })] });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, { playerHand: [], activeTurn: 'enemy', activeEnemyIndex: 0 });
    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(next.enemies[0].hp).toBe(20);
  });

  it("heals the player at the end of their own turn the same way", () => {
    const room = makeRoom({ enemies: [makeEnemy({ instanceId: 'e1' })] });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 10, 20, { playerHand: [], playerStatuses: { regen: 4 } });
    const next = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
    expect(next.playerHP).toBe(10 + 4);
    expect(next.playerStatuses.regen).toBe(3);
  });
});

describe('Haste and Slow', () => {
  it("adjust the player's next playsRemaining allotment by +1/-1 per stack, floored at 0", () => {
    const room = makeRoom({ enemies: [makeEnemy({ instanceId: 'e1', hand: [] })] });
    const rng = createRng(1);

    const hasted = applyCombatAction(
      makeCombat(room, rng, 30, 30, { playerHand: [], playerStatuses: { haste: 2 }, activeTurn: 'enemy', activeEnemyIndex: 0 }),
      { type: 'ENEMY_TURN' },
      rng,
    );
    expect(hasted.activeTurn).toBe('player');
    expect(hasted.playsRemaining).toBe(PLAYS_PER_TURN_BASE + 2);

    const flooredSlow = applyCombatAction(
      makeCombat(room, rng, 30, 30, { playerHand: [], playerStatuses: { slow: 5 }, activeTurn: 'enemy', activeEnemyIndex: 0 }),
      { type: 'ENEMY_TURN' },
      rng,
    );
    expect(flooredSlow.playsRemaining).toBe(0); // floored, never negative
  });

  it("grant/take an enemy's own play allotment for its turn the same way", () => {
    const room = makeRoom({ enemies: [makeEnemy({ instanceId: 'e1' })] });
    const rng = createRng(70);

    const hastedEnemyState: CombatState = makeCombat(room, rng, 30, 30, {
      table: [],
      playerHand: [],
      enemies: [
        makeEnemy({
          instanceId: 'e1',
          statuses: { haste: 1 },
          hand: [
            { id: 'e1h1', kind: 'creature', suit: 'wolf' },
            { id: 'e1h2', kind: 'creature', suit: 'ember' },
          ],
        }),
      ],
      activeTurn: 'enemy',
      activeEnemyIndex: 0,
    });
    const hastedNext = applyCombatAction(hastedEnemyState, { type: 'ENEMY_TURN' }, rng);
    // Base ENEMY_PLAYS_PER_TURN (1) would only ever play one of the two
    // suits in hand (an enemy always commits a whole suit at once) --
    // Haste's +1 lets it play both.
    expect(hastedNext.log.filter((l) => l.type === 'play' && l.actor === 'enemy').length).toBe(2);

    const slowedEnemyState: CombatState = makeCombat(room, rng, 30, 30, {
      table: [],
      playerHand: [],
      enemies: [makeEnemy({ instanceId: 'e1', statuses: { slow: 3 }, hand: [{ id: 'e1h1', kind: 'creature', suit: 'wolf' }] })],
      activeTurn: 'enemy',
      activeEnemyIndex: 0,
    });
    const slowedNext = applyCombatAction(slowedEnemyState, { type: 'ENEMY_TURN' }, rng);
    // Floored at 0 -- the enemy's turn is skipped entirely, no play/pass log at all.
    expect(slowedNext.playerHP).toBe(30);
    expect(slowedNext.log.some((l) => l.actor === 'enemy' && (l.type === 'play' || l.type === 'pass'))).toBe(false);
  });
});

describe('guard-strip relic (Sunder)', () => {
  it("strips a flat amount of Guard from the target, capped at what they currently hold", () => {
    const room = makeRoom({
      params: { ...makeRoom().params, threatSuits: ['hex'] },
      enemies: [makeEnemy({ hp: 30, hpMax: 30, guard: 5 })],
    });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: [],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'hex' }],
      relics: [relicById('hexbreakers-edge')],
    });

    const next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'hex', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );

    // The played card's own basic rider (bonus-damage 1, since Hex is a
    // weaken/enemy-targeting category) absorbs 1 off Guard first (5 -> 4),
    // then Hexbreaker's Edge strips its own flat 2 (4 -> 2).
    expect(next.enemies[0].guard).toBe(2);
    expect(next.log.some((l) => l.message.includes("Hexbreaker's Edge"))).toBe(true);
  });

  it('caps the strip at whatever Guard the target still holds, rather than going negative', () => {
    const room = makeRoom({
      params: { ...makeRoom().params, threatSuits: ['hex'] },
      enemies: [makeEnemy({ hp: 30, hpMax: 30, guard: 2 })],
    });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: [],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'hex' }],
      relics: [relicById('hexbreakers-edge')],
    });

    const next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'hex', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );

    // The basic rider's 1 bonus-damage absorbs 1 off Guard (2 -> 1); the
    // relic then wants to strip 2 but only 1 remains -- capped, never negative.
    expect(next.enemies[0].guard).toBe(0);
  });
});

describe('AOE tier 1: splash rider (bonus-damage-aoe)', () => {
  it('a card carrying a bonus-damage-aoe rider hits every alive enemy, on top of the chosen target\'s own single-target effect', () => {
    const room = makeRoom({
      enemies: [
        makeEnemy({ instanceId: 'e1', hp: 30, hpMax: 30 }),
        makeEnemy({ instanceId: 'e2', hp: 30, hpMax: 30 }),
      ],
    });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, {
      table: [],
      playerHand: [{ id: 'ph1', kind: 'creature', suit: 'ember', specialId: 'cinder-storm' }],
    });

    const next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'ember', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );

    // Main category effect: 0 on table + 1 played = 1 x 1 = 1 damage, e1 only.
    // Splash rider: +2 bonus-damage-aoe to EVERY alive enemy, e1 included.
    expect(next.enemies.find((e) => e.instanceId === 'e1')!.hp).toBe(30 - 1 - 2);
    expect(next.enemies.find((e) => e.instanceId === 'e2')!.hp).toBe(30 - 2);
  });
});

describe('Cleave setup card (AOE tier 2)', () => {
  it("flags the next threat play to hit every alive enemy without a chosen target, then clears itself", () => {
    const room = makeRoom({
      enemies: [
        makeEnemy({ instanceId: 'e1', hp: 30, hpMax: 30 }),
        makeEnemy({ instanceId: 'e2', hp: 30, hpMax: 30 }),
      ],
    });
    const rng = createRng(1);
    let state: CombatState = makeCombat(room, rng, 30, 30, {
      table: [],
      playerHand: [
        { id: 'phc', kind: 'cleave' },
        { id: 'ph1', kind: 'creature', suit: 'wolf' },
      ],
    });

    state = applyCombatAction(state, { type: 'PLAYER_PLAY_CLEAVE', cardId: 'phc' }, rng);
    expect(state.cleaveActive).toBe(true);
    expect(state.activeTurn).toBe('player'); // free action, doesn't end the turn
    expect(state.playsRemaining).toBe(PLAYS_PER_TURN_BASE); // and doesn't spend a play

    // No targetInstanceId given -- isLegalPlay waives it while cleaveActive.
    state = applyCombatAction(state, { type: 'PLAY_SET', suit: 'wolf', handCardIds: ['ph1'] }, rng);

    // 0 on table + 1 played = 1 x 1 = 1 damage lands on EACH alive enemy.
    // (The played card's own basic rider needs a specific target to resolve
    // against, so it's a no-op here -- only the category magnitude widens.)
    expect(state.enemies.find((e) => e.instanceId === 'e1')!.hp).toBe(30 - 1);
    expect(state.enemies.find((e) => e.instanceId === 'e2')!.hp).toBe(30 - 1);
    expect(state.cleaveActive).toBe(false); // cleared once the threat play resolved
  });
});
