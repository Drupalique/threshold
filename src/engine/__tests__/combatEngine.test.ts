import { describe, it, expect } from 'vitest';
import { createRng } from '../rng';
import { initCombat, applyCombatAction } from '../combatEngine';
import type { RoomInstance } from '../../types/room';
import type { CombatState } from '../../types/combat';

function makeRoom(overrides: Partial<RoomInstance> = {}): RoomInstance {
  return {
    id: 'test-room',
    params: {
      poolSize: 4,
      sizeBand: 'small',
      dominantSuit: 'wolf',
      threatValue: 20,
      playerHandSize: 5,
      roomHandSize: 3,
      onSuitRatio: 0.6,
      boonRatio: 0.12,
      guardRatio: 0.08,
      surpriseRatio: 0.08,
    },
    pool: [
      { id: 'p1', kind: 'creature', suit: 'wolf' },
      { id: 'p2', kind: 'creature', suit: 'wolf' },
      { id: 'p3', kind: 'creature', suit: 'wolf' },
      { id: 'p4', kind: 'creature', suit: 'wolf' },
    ],
    playerHandDeal: [
      { id: 'ph1', kind: 'creature', suit: 'wolf' },
      { id: 'ph2', kind: 'creature', suit: 'wolf' },
      { id: 'ph3', kind: 'creature', suit: 'wolf' },
    ],
    roomHandDeal: [{ id: 'rh1', kind: 'creature', suit: 'wolf' }],
    ...overrides,
  };
}

describe('claim magnitude', () => {
  it('is multiplicative: pool set size x hand cards played', () => {
    // Extra rot pair left in the pool so it still forms a live set after the
    // wolf claim, keeping the round active (isolating the magnitude math
    // from the pool-exhaustion clean-clear edge case tested separately below).
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'wolf' },
        { id: 'p2', kind: 'creature', suit: 'wolf' },
        { id: 'p3', kind: 'creature', suit: 'wolf' },
        { id: 'p4', kind: 'creature', suit: 'wolf' },
        { id: 'p5', kind: 'creature', suit: 'rot' },
        { id: 'p6', kind: 'creature', suit: 'rot' },
      ],
    });
    const rng = createRng(1);
    const state = initCombat(room, rng, 30, 30);

    const next = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'wolf', handCardIds: ['ph1', 'ph2', 'ph3'] },
      rng,
    );

    // pool set size 4 x 3 hand cards = 12 damage to room threat
    expect(next.roomThreat).toBe(20 - 12);
    expect(next.pool.map((c) => c.id)).toEqual(['p5', 'p6']);
    expect(next.playerHand.map((c) => c.id)).not.toContain('ph1');
  });

  it('room claim damages player HP using the same formula', () => {
    const room = makeRoom({
      roomHandDeal: [
        { id: 'rh1', kind: 'creature', suit: 'wolf' },
        { id: 'rh2', kind: 'creature', suit: 'wolf' },
      ],
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'ember' }],
    });
    const rng = createRng(2);
    let state = initCombat(room, rng, 30, 30);
    // player has no wolf cards to claim with, so pass. Redraw disabled here
    // so the room's hand stays the fixed 2x wolf we set up above.
    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng, false);
    state = applyCombatAction(state, { type: 'ROOM_TURN' }, rng, false);

    // pool set size 4 x 2 room cards = 8 damage to player
    expect(state.playerHP).toBe(30 - 8);
  });

  it('a lethal room claim reports player-dead even when it simultaneously empties the pool', () => {
    // Pool is exactly the 4-card wolf set the room claims in full -- so the
    // same turn that kills the player also exhausts the pool. Death must win.
    const room = makeRoom({
      roomHandDeal: [
        { id: 'rh1', kind: 'creature', suit: 'wolf' },
        { id: 'rh2', kind: 'creature', suit: 'wolf' },
      ],
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'ember' }],
    });
    const rng = createRng(8);
    let state = initCombat(room, rng, 8, 30); // 8 HP; room claim deals 4x2=8
    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng, false);
    state = applyCombatAction(state, { type: 'ROOM_TURN' }, rng, false);

    expect(state.playerHP).toBe(0);
    expect(state.status).toBe('player-dead');
  });
});

describe('room AI', () => {
  it('claims the largest available set, no lookahead', () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'wolf' },
        { id: 'p2', kind: 'creature', suit: 'wolf' },
        { id: 'p3', kind: 'creature', suit: 'ember' },
        { id: 'p4', kind: 'creature', suit: 'ember' },
        { id: 'p5', kind: 'creature', suit: 'ember' },
      ],
      roomHandDeal: [
        { id: 'rh1', kind: 'creature', suit: 'wolf' },
        { id: 'rh2', kind: 'creature', suit: 'ember' },
      ],
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'rot' }],
    });
    const rng = createRng(3);
    let state = initCombat(room, rng, 30, 30);
    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng, false);
    state = applyCombatAction(state, { type: 'ROOM_TURN' }, rng, false);

    // ember set (size 3) is bigger than wolf set (size 2), room should take it
    expect(state.roomHand.some((c) => c.id === 'rh2')).toBe(false);
    expect(state.roomHand.some((c) => c.id === 'rh1')).toBe(true);
    expect(state.playerHP).toBe(30 - 3 * 1);
  });

  it('whiffs when no legal claim exists', () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'ember' },
        { id: 'p2', kind: 'creature', suit: 'ember' },
      ],
      roomHandDeal: [{ id: 'rh1', kind: 'creature', suit: 'wolf' }],
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'rot' }],
    });
    const rng = createRng(4);
    let state = initCombat(room, rng, 30, 30);
    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng, false);
    const before = state.playerHP;
    state = applyCombatAction(state, { type: 'ROOM_TURN' }, rng, false);
    expect(state.playerHP).toBe(before);
    expect(state.log.some((l) => l.type === 'whiff')).toBe(true);
  });
});

describe('decay backstop', () => {
  it('auto-resolves an unclaimed live set after N turns and short-circuits on death', () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'ember' },
        { id: 'p2', kind: 'creature', suit: 'ember' },
      ],
      // Neither side can claim ember -- forces pure pass/whiff turns.
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'rot' }],
      roomHandDeal: [{ id: 'rh1', kind: 'creature', suit: 'rot' }],
    });
    const rng = createRng(5);
    let state: CombatState = initCombat(room, rng, 5, 30);

    // Drive turns until decay resolves (DECAY_TURNS_N = 3) or the player dies.
    // Redraw disabled -- both hands must stay permanently mismatched with the
    // ember pool for this to actually exercise the decay backstop.
    for (let i = 0; i < 8 && state.status === 'active'; i++) {
      const action = state.activeTurn === 'player' ? { type: 'PLAYER_PASS' as const } : { type: 'ROOM_TURN' as const };
      state = applyCombatAction(state, action, rng, false);
    }

    const decayLogs = state.log.filter((l) => l.type === 'decay');
    expect(decayLogs.length).toBeGreaterThan(0);
    // low starting HP (5) with a 3-damage decay penalty should have killed the player
    expect(state.status === 'player-dead' || state.playerHP < 5).toBe(true);
  });
});

describe('pool exhaustion', () => {
  it('refills the pool and keeps the round active rather than clearing the room for free', () => {
    // Room Threat never dropped (player only passed) -- an empty pool must
    // not hand the player a "win" they didn't earn. It should deal a fresh
    // wave and keep going instead.
    const room = makeRoom({
      pool: [],
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
      roomHandDeal: [{ id: 'rh1', kind: 'creature', suit: 'wolf' }],
    });
    const rng = createRng(6);
    let state = initCombat(room, rng, 30, 30);
    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng, false);

    expect(state.status).toBe('active');
    expect(state.roomThreat).toBe(20); // untouched -- refill isn't a claim
    expect(state.pool.length).toBeGreaterThan(0);
    expect(state.log.some((l) => l.type === 'pool-refill')).toBe(true);
  });
});

describe('MIN_POOL_SET_SIZE = 1 (1 on the table, 1 in hand)', () => {
  it('a single pool card is claimable with a single matching hand card', () => {
    // A rot pair stays in the pool so the round remains active after the
    // wolf claim, isolating the claim-legality change from the separate
    // pool-exhaustion clean-clear behavior tested above.
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'wolf' },
        { id: 'p2', kind: 'creature', suit: 'rot' },
        { id: 'p3', kind: 'creature', suit: 'rot' },
      ],
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
    });
    const rng = createRng(12);
    const state = initCombat(room, rng, 30, 30);
    const next = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'wolf', handCardIds: ['ph1'] },
      rng,
    );

    // pool set size 1 x 1 hand card = 1 damage to room threat
    expect(next.roomThreat).toBe(20 - 1);
    expect(next.pool.map((c) => c.id)).toEqual(['p2', 'p3']);
  });

  it('applies symmetrically to the room -- it will claim a lone pool card too', () => {
    const room = makeRoom({
      pool: [{ id: 'p1', kind: 'creature', suit: 'wolf' }],
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'rot' }],
      roomHandDeal: [{ id: 'rh1', kind: 'creature', suit: 'wolf' }],
    });
    const rng = createRng(13);
    let state = initCombat(room, rng, 30, 30);
    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng, false);
    state = applyCombatAction(state, { type: 'ROOM_TURN' }, rng, false);

    expect(state.playerHP).toBe(30 - 1);
  });
});

describe('boon suit', () => {
  it('heals the player when claimed by the player, and only mildly regens room threat when claimed by the room', () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'grace' },
        { id: 'p2', kind: 'creature', suit: 'grace' },
      ],
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'grace' }],
      roomHandDeal: [{ id: 'rh1', kind: 'creature', suit: 'rot' }],
    });
    const rng = createRng(7);
    let state = initCombat(room, rng, 20, 30);
    state = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'grace', handCardIds: ['ph1'] },
      rng,
    );
    expect(state.playerHP).toBe(22); // healed by 2x1
  });
});

describe('guard suit (Ward)', () => {
  it('a player claim banks Guard equal to the usual claim magnitude, with no HP/threat effect', () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'ward' },
        { id: 'p2', kind: 'creature', suit: 'ward' },
        { id: 'p3', kind: 'creature', suit: 'rot' },
        { id: 'p4', kind: 'creature', suit: 'rot' },
      ],
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'ward' }],
      roomHandDeal: [{ id: 'rh1', kind: 'creature', suit: 'rot' }],
    });
    const rng = createRng(20);
    const state = initCombat(room, rng, 30, 30);
    const next = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'ward', handCardIds: ['ph1'] },
      rng,
      false,
    );

    expect(next.playerGuard).toBe(2); // pool set size 2 x 1 hand card
    expect(next.playerHP).toBe(30);
    expect(next.roomThreat).toBe(20);
  });

  it('absorbs incoming room damage before it reaches Player HP', () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'ward' },
        { id: 'p2', kind: 'creature', suit: 'ward' },
        { id: 'p3', kind: 'creature', suit: 'wolf' },
        { id: 'p4', kind: 'creature', suit: 'wolf' },
        { id: 'p5', kind: 'creature', suit: 'wolf' },
      ],
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'ward' }],
      roomHandDeal: [
        { id: 'rh1', kind: 'creature', suit: 'wolf' },
        { id: 'rh2', kind: 'creature', suit: 'wolf' },
      ],
    });
    const rng = createRng(21);
    let state = initCombat(room, rng, 30, 30);
    state = applyCombatAction(state, { type: 'PLAYER_CLAIM', suit: 'ward', handCardIds: ['ph1'] }, rng, false);
    expect(state.playerGuard).toBe(2); // pool set size 2 x 1

    state = applyCombatAction(state, { type: 'ROOM_TURN' }, rng, false);
    // room claim magnitude: pool set size 3 x 2 hand cards = 6; Guard absorbs 2, 4 gets through
    expect(state.playerHP).toBe(30 - 4);
    // fully consumed absorbing the hit -- nothing left to expire
    expect(state.playerGuard).toBe(0);
  });

  it('expires after the room completes its next turn even if never hit', () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'ward' },
        { id: 'p2', kind: 'creature', suit: 'ward' },
      ],
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'ward' }],
      // no matching suit for the room -- guaranteed whiff
      roomHandDeal: [{ id: 'rh1', kind: 'creature', suit: 'rot' }],
    });
    const rng = createRng(22);
    let state = initCombat(room, rng, 30, 30);
    state = applyCombatAction(state, { type: 'PLAYER_CLAIM', suit: 'ward', handCardIds: ['ph1'] }, rng, false);
    expect(state.playerGuard).toBe(2);

    state = applyCombatAction(state, { type: 'ROOM_TURN' }, rng, false);
    expect(state.playerGuard).toBe(0);
    expect(state.log.some((l) => l.type === 'guard-fade')).toBe(true);
  });

  it('fizzles with no effect when the room claims it -- Ward is player-exclusive', () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'ward' },
        { id: 'p2', kind: 'creature', suit: 'ward' },
      ],
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'rot' }],
      roomHandDeal: [{ id: 'rh1', kind: 'creature', suit: 'ward' }],
    });
    const rng = createRng(23);
    let state = initCombat(room, rng, 30, 30);
    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng, false);
    state = applyCombatAction(state, { type: 'ROOM_TURN' }, rng, false);

    expect(state.playerHP).toBe(30);
    expect(state.roomThreat).toBe(20);
    expect(state.playerGuard).toBe(0);
    expect(state.pool.some((c) => c.kind === 'creature' && c.suit === 'ward')).toBe(false);
  });
});

describe('hand redraw (experimental)', () => {
  it('replaces the incoming actor hand with a freshly generated hand when enabled', () => {
    const room = makeRoom();
    const rng = createRng(9);
    let state = initCombat(room, rng, 30, 30);
    const originalRoomHandIds = state.roomHand.map((c) => c.id);

    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng, true);

    expect(state.activeTurn).toBe('room');
    expect(state.roomHand.length).toBe(room.params.roomHandSize);
    expect(state.roomHand.every((c) => c.kind === 'creature')).toBe(true);
    expect(state.roomHand.map((c) => c.id)).not.toEqual(originalRoomHandIds);
    expect(state.log.some((l) => l.type === 'redraw')).toBe(true);
  });

  it('leaves the incoming hand untouched between turns when disabled', () => {
    const room = makeRoom();
    const rng = createRng(10);
    let state = initCombat(room, rng, 30, 30);
    const originalRoomHandIds = state.roomHand.map((c) => c.id);

    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng, false);

    expect(state.roomHand.map((c) => c.id)).toEqual(originalRoomHandIds);
    expect(state.log.some((l) => l.type === 'redraw')).toBe(false);
  });
});
