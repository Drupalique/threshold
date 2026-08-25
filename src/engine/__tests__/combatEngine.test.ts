import { describe, it, expect } from 'vitest';
import { createRng } from '../rng';
import type { Rng } from '../rng';
import { initCombat, applyCombatAction, getLegalPlaySets, requiresEnemyTarget } from '../combatEngine';
import { chooseEnemyPlay } from '../enemyAI';
import { enemyDefById } from '../../config/enemies';
import type { RoomInstance } from '../../types/room';
import type { EnemyInstance } from '../../types/enemy';
import type { CombatState, TableCard } from '../../types/combat';
import type { Card, CreatureCard } from '../../types/cards';
import type { SuitId } from '../../types/suits';
import { PLAYS_PER_TURN_BASE, ENEMY_HAND_SIZE } from '../../config/constants';

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

function makeRoom(overrides: Partial<RoomInstance> = {}): RoomInstance {
  return {
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
  room: RoomInstance,
  rng: Rng,
  playerHP: number,
  playerHPMax: number,
  overrides: Partial<CombatState> = {},
): CombatState {
  return { ...initCombat(room, rng, playerHP, playerHPMax, DEFAULT_DECK), playerHand: DEFAULT_HAND, ...overrides };
}

describe('legality and plays per turn', () => {
  it('is multiplicative: table set size x hand cards played, damaging the targeted enemy', () => {
    const room = makeRoom();
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

    // table set size 4 x 3 hand cards = 12 damage to the enemy
    expect(next.enemies[0].hp).toBe(20 - 12);
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
    expect(state.enemies[0].hp).toBe(20 - 1); // table set size 1 x 1 hand card

    state = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph2'] },
      rng,
    );
    // The first play already claimed the room's 1 wolf card, so the second
    // play only compounds off the player's own contribution from the prior
    // play (1 wolf now on the table).
    expect(state.enemies[0].hp).toBe(20 - 1 - 1);
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

  it('a 0-magnitude play (nothing matching on the table yet) is legal and banks the cards for later', () => {
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
    expect(next.enemies[0].hp).toBe(20); // 0 table count x 2 hand cards = 0
    expect(next.table.filter((c) => c.suit === 'rot' && c.ownerId === 'player').length).toBe(2); // still banked on the table
  });

  it('a Quake card grants unlimited plays for the rest of the turn until the player passes', () => {
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
    expect(state.unlimitedPlaysThisTurn).toBe(true);
    expect(state.activeTurn).toBe('player'); // playing it doesn't end the turn
    expect(state.playerHand.some((c) => c.id === 'phq')).toBe(false); // consumed
    expect(state.discardPile.some((c) => c.id === 'phq')).toBe(true); // discarded, not vanished
    expect(state.playsRemaining).toBe(PLAYS_PER_TURN_BASE); // untouched -- it isn't spent, it's bypassed

    // Three plays in a row -- more than PLAYS_PER_TURN_BASE would normally allow.
    state = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );
    expect(state.activeTurn).toBe('player');
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
    expect(state.activeTurn).toBe('player'); // still going -- unlimited

    // Only Pass actually ends a Quake-boosted turn.
    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
    expect(state.activeTurn).toBe('enemy');
    expect(state.unlimitedPlaysThisTurn).toBe(false); // cleared once the turn actually ends
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
    expect(e2).toBeUndefined(); // table set size 5 x 2 hand cards = 10, exactly lethal
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
    // 1 hand card x 2 table cards (1 from room, 1 from the enemy itself) = 2
    expect(next.enemies[0].hp).toBe(20 - 2);
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
    expect(state.enemies[0].hp).toBe(20); // 0 table count x 1 = 0

    state = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph2'] },
      rng,
    );
    // The first play's own card is now on the table -- 1 table count x 1 hand card = 1
    expect(state.enemies[0].hp).toBe(19);
  });
});

describe('claiming the room caps Quake self-compounding by splitting a suit into singles', () => {
  it('splitting a suit into N one-card plays deals strictly less than one N-card play, since the first single already claims the room\'s whole stockpile', () => {
    const bigPlayRoom = makeRoom();
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
      unlimitedPlaysThisTurn: true,
    });
    bigPlayState = applyCombatAction(
      bigPlayState,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1', 'ph2', 'ph3'] },
      rngBig,
    );
    const bigPlayDamage = 20 - bigPlayState.enemies[0].hp;
    expect(bigPlayDamage).toBe(9); // 3 table x 3 hand cards

    const splitRoom = makeRoom();
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
      playsRemaining: 1,
      unlimitedPlaysThisTurn: true,
    });
    for (const id of ['ph1', 'ph2', 'ph3']) {
      splitState = applyCombatAction(
        splitState,
        { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: [id] },
        rngSplit,
      );
    }
    const splitDamage = 20 - splitState.enemies[0].hp;
    // The first single claims all 3 room wolf cards (3 table x 1 hand = 3),
    // leaving nothing but the player's own prior contribution to compound
    // off of for the next two singles (1 table x 1 = 1, then 2 table x 1 = 2).
    expect(splitDamage).toBe(3 + 1 + 2);

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
    expect(next.playerHP).toBe(30 - 1); // 1 table wolf x 1 hand card
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
  it('a player play banks Guard equal to the usual play magnitude, with no HP/enemy effect', () => {
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

    expect(next.playerGuard).toBe(2);
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
    // table wolf count 1 x 1 hand card = 1; fully absorbed by the 2 banked Guard
    expect(state.playerHP).toBe(30);
    expect(state.playerGuard).toBe(1);
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
    expect(e1.guard).toBe(1); // 1 hand card x 1 table ward card
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
  it('a player play inflicts Weaken stacks on the chosen enemy instead of HP damage, mirroring an enemy\'s own Debuff', () => {
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
    expect(next.enemies[0].statuses.weaken).toBe(2); // table set size 2 x 1 hand card
    expect(next.enemies[0].hp).toBe(20); // no HP change
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
    // raw magnitude = table 2 x hand 2 = 4, weakened by stacks x 10%
    let next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'rot', targetInstanceId: 'e1', handCardIds: ['ph1', 'ph2'] },
      rng,
    );
    const expectedMagnitude = Math.max(0, Math.round(4 * Math.max(0, 1 - stacks * 0.1)));
    expect(next.enemies[0].hp).toBe(20 - expectedMagnitude);
    expect(next.playerStatuses.weaken).toBe(stacks); // turn hasn't ended yet -- no decay tick

    next = applyCombatAction(next, { type: 'PLAYER_PASS' }, rng);
    expect(next.playerStatuses.weaken).toBe(stacks - 1); // decays by 1 at the end of the player's turn
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
    expect(state.enemies[0].statuses.poison).toBe(2);
    expect(state.enemies[0].hp).toBe(20); // applying the stacks doesn't hit immediately

    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };
    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(next.enemies[0].hp).toBe(20 - 2); // its own poison tick, at the true end of its own turn
    expect(next.enemies[0].statuses.poison).toBe(1);
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
    expect(next.playerStatuses.strength).toBe(2);
    expect(next.playerHP).toBe(30);

    next = applyCombatAction(next, { type: 'PLAYER_PASS' }, rng);
    expect(next.playerStatuses.strength).toBe(1);
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
    // (table set size 1 + 3 Strength) x 2 hand cards = 8
    const next = applyCombatAction(
      state,
      { type: 'PLAY_SET', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1', 'ph2'] },
      rng,
    );
    expect(next.enemies[0].hp).toBe(20 - 8);
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
    expect(next.playerHP).toBe(22);
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
    // chosen suit): 2 table x 2 hand = 4 Strength, then decays by 1 at this
    // same turn's own end -> 3. 1 enemy -- this also concludes the round.
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(state.enemies[0].statuses.strength).toBe(3);
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
    // table wolf 1 x hand 1 = 1, boosted by 3 remaining Strength -> 4
    expect(next.playerHP).toBe(30 - 4);
    expect(next.enemies[0].statuses.strength).toBe(2); // decays again after this turn
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
    expect(enemy.hand.length).toBe(ENEMY_HAND_SIZE);
    const originalHandIds = enemy.hand.map((c) => c.id);

    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);

    const after = state.enemies.find((e) => e.instanceId === 'e1')!;
    expect(after.hand.length).toBe(ENEMY_HAND_SIZE);
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
    expect(state.enemies[0].hand.map((c) => c.id)).not.toEqual(state.enemies[1].hand.map((c) => c.id));
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
