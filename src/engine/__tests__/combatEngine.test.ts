import { describe, it, expect } from 'vitest';
import { createRng } from '../rng';
import type { Rng } from '../rng';
import { initCombat, applyCombatAction, getLegalPlayerClaimTargets } from '../combatEngine';
import type { RoomInstance } from '../../types/room';
import type { EnemyInstance } from '../../types/enemy';
import type { CombatState } from '../../types/combat';
import type { Card } from '../../types/cards';
import { isCreatureCard } from '../../types/cards';
import type { SuitId } from '../../types/suits';
import {
  SURPRISE_ADD_CARDS_COUNT,
  SURPRISE_BLOCK_DURATION_TURNS,
  DECAY_TURNS_N,
  PLAYS_PER_TURN_BASE,
} from '../../config/constants';

function makeEnemy(overrides: Partial<EnemyInstance> = {}): EnemyInstance {
  return {
    instanceId: 'e1',
    defId: 'wolf-kin',
    name: 'Wolf-kin',
    hp: 20,
    hpMax: 20,
    guard: 0,
    patternIndex: 0,
    statuses: {},
    ...overrides,
  };
}

function makeRoom(overrides: Partial<RoomInstance> = {}): RoomInstance {
  return {
    id: 'test-room',
    params: {
      poolSize: 4,
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
    pool: [
      { id: 'p1', kind: 'creature', suit: 'wolf' },
      { id: 'p2', kind: 'creature', suit: 'wolf' },
      { id: 'p3', kind: 'creature', suit: 'wolf' },
      { id: 'p4', kind: 'creature', suit: 'wolf' },
    ],
    ...overrides,
  };
}

// --- persistent-deck test helpers ---------------------------------------
// The pool/enemies stay room-authored (via makeRoom above), but the hand no
// longer comes from RoomInstance -- it's a slice of the player's shuffled
// persistent deck (see PERSISTENT_DECK_PLAN.md). Most tests below don't
// care about deck contents at all, only about a specific starting hand to
// drive a specific claim -- makeCombat covers that by initializing through
// the real deck/shuffle machinery (so drawPile/discardPile stay internally
// consistent) and then overwriting playerHand directly, exactly as many
// tests already hack other CombatState fields (activeTurn, statuses,
// decayCounters) to jump straight to the scenario under test.

function makeDeck(suit: SuitId, count: number, prefix = 'deck'): Card[] {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${suit}-${i}`, kind: 'creature' as const, suit }));
}

const DEFAULT_DECK: Card[] = makeDeck('wolf', 12);

const DEFAULT_HAND: Card[] = [
  { id: 'ph1', kind: 'creature', suit: 'wolf' },
  { id: 'ph2', kind: 'creature', suit: 'wolf' },
  { id: 'ph3', kind: 'creature', suit: 'wolf' },
];

function makeCombat(
  room: RoomInstance,
  rng: Rng,
  playerHP: number,
  playerHPMax: number,
  hand: Card[] = DEFAULT_HAND,
  deck: Card[] = DEFAULT_DECK,
): CombatState {
  return { ...initCombat(room, rng, playerHP, playerHPMax, deck), playerHand: hand };
}

describe('claim magnitude', () => {
  it('is multiplicative: pool set size x hand cards played, damaging the targeted enemy', () => {
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
    const state = makeCombat(room, rng, 30, 30);

    const next = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1', 'ph2', 'ph3'] },
      rng,
    );

    // pool set size 4 x 3 hand cards = 12 damage to the enemy
    expect(next.enemies[0].hp).toBe(20 - 12);
    expect(next.pool.map((c) => c.id)).toEqual(['p5', 'p6']);
    expect(next.playerHand.map((c) => c.id)).not.toContain('ph1');
  });

  it('a lethal claim defeats the enemy and clears the room when it was the last one', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ hp: 4, hpMax: 4 })],
      pool: [
        { id: 'p1', kind: 'creature', suit: 'wolf' },
        { id: 'p2', kind: 'creature', suit: 'wolf' },
        { id: 'p3', kind: 'creature', suit: 'wolf' },
        { id: 'p4', kind: 'creature', suit: 'wolf' },
      ],
    });
    const rng = createRng(1);
    const state = makeCombat(room, rng, 30, 30, [{ id: 'ph1', kind: 'creature', suit: 'wolf' }]);
    const next = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );

    expect(next.enemies).toEqual([]);
    expect(next.status).toBe('room-cleared');
  });
});

describe('plays per turn', () => {
  it(`lets the player make ${PLAYS_PER_TURN_BASE} claims before the turn passes to the enemy phase`, () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'wolf' },
        { id: 'p2', kind: 'creature', suit: 'rot' },
      ],
    });
    const rng = createRng(31);
    let state: CombatState = makeCombat(room, rng, 30, 30, [
      { id: 'ph1', kind: 'creature', suit: 'wolf' },
      { id: 'ph2', kind: 'creature', suit: 'rot' },
    ]);
    expect(state.playsRemaining).toBe(PLAYS_PER_TURN_BASE);

    state = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );
    expect(state.activeTurn).toBe('player'); // first of two plays -- turn continues
    expect(state.playsRemaining).toBe(PLAYS_PER_TURN_BASE - 1);
    expect(state.enemies[0].hp).toBe(20 - 1);

    state = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'rot', targetInstanceId: 'e1', handCardIds: ['ph2'] },
      rng,
    );
    expect(state.enemies[0].hp).toBe(20 - 2); // second claim still resolved
    expect(state.activeTurn).toBe('enemy'); // plays exhausted -- turn actually ends now
  });

  it('rejects a claim once plays are exhausted, and offers no legal targets', () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'wolf' },
        { id: 'p2', kind: 'creature', suit: 'rot' },
        { id: 'p3', kind: 'creature', suit: 'ember' },
      ],
    });
    const rng = createRng(32);
    let state: CombatState = makeCombat(room, rng, 30, 30, [
      { id: 'ph1', kind: 'creature', suit: 'wolf' },
      { id: 'ph2', kind: 'creature', suit: 'rot' },
      { id: 'ph3', kind: 'creature', suit: 'ember' },
    ]);
    state = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );
    state = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'rot', targetInstanceId: 'e1', handCardIds: ['ph2'] },
      rng,
    );
    expect(state.playsRemaining).toBe(0);
    expect(state.activeTurn).toBe('enemy'); // second claim already ended the turn

    // Force back into an (otherwise impossible) player turn with 0 plays
    // left, to exercise the engine-level guard directly.
    state = { ...state, activeTurn: 'player', playsRemaining: 0 };
    expect(getLegalPlayerClaimTargets(state)).toEqual([]);
    const rejected = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'ember', targetInstanceId: 'e1', handCardIds: ['ph3'] },
      rng,
    );
    expect(rejected).toBe(state); // illegal claim, state unchanged
  });

  it('a Quake card grants unlimited plays for the rest of the turn until the player passes', () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'wolf' },
        { id: 'p2', kind: 'creature', suit: 'rot' },
        { id: 'p3', kind: 'creature', suit: 'ember' },
      ],
    });
    const rng = createRng(33);
    let state: CombatState = makeCombat(room, rng, 30, 30, [
      { id: 'phq', kind: 'quake' },
      { id: 'ph1', kind: 'creature', suit: 'wolf' },
      { id: 'ph2', kind: 'creature', suit: 'rot' },
      { id: 'ph3', kind: 'creature', suit: 'ember' },
    ]);

    state = applyCombatAction(state, { type: 'PLAYER_PLAY_QUAKE', cardId: 'phq' }, rng);
    expect(state.unlimitedPlaysThisTurn).toBe(true);
    expect(state.activeTurn).toBe('player'); // playing it doesn't end the turn
    expect(state.playerHand.some((c) => c.id === 'phq')).toBe(false); // consumed
    expect(state.discardPile.some((c) => c.id === 'phq')).toBe(true); // discarded, not vanished -- recoverable next reshuffle
    expect(state.playsRemaining).toBe(PLAYS_PER_TURN_BASE); // untouched -- it isn't spent, it's bypassed

    // Three claims in a row -- more than PLAYS_PER_TURN_BASE would normally allow.
    state = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );
    expect(state.activeTurn).toBe('player');
    state = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'rot', targetInstanceId: 'e1', handCardIds: ['ph2'] },
      rng,
    );
    expect(state.activeTurn).toBe('player');
    state = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'ember', targetInstanceId: 'e1', handCardIds: ['ph3'] },
      rng,
    );
    expect(state.activeTurn).toBe('player'); // still going -- unlimited
    expect(state.enemies[0].hp).toBe(20 - 3);

    // Only Pass actually ends a Quake-boosted turn.
    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
    expect(state.activeTurn).toBe('enemy');
    expect(state.unlimitedPlaysThisTurn).toBe(false); // cleared once the turn actually ends
  });
});

describe('pool piles are independent of any specific enemy (design doc 4.8)', () => {
  it('offers every alive enemy as a target for the same pile, and a claim only affects the chosen one', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ instanceId: 'e1', hp: 10, hpMax: 10 }), makeEnemy({ instanceId: 'e2', hp: 10, hpMax: 10 })],
      pool: [
        { id: 'p1', kind: 'creature', suit: 'wolf' },
        { id: 'p2', kind: 'creature', suit: 'wolf' },
        { id: 'p3', kind: 'creature', suit: 'wolf' },
        { id: 'p4', kind: 'creature', suit: 'wolf' },
        { id: 'p5', kind: 'creature', suit: 'wolf' },
        // A lone off-suit card so the pool isn't left fully empty by the
        // claim below -- an empty pool auto-refills (unrelated mechanic),
        // which would otherwise put fresh wolf cards right back and muddy
        // the "the whole pile is gone" assertion.
        { id: 'p6', kind: 'creature', suit: 'rot' },
      ],
    });
    const rng = createRng(2);
    const state = makeCombat(room, rng, 30, 30, [
      { id: 'ph1', kind: 'creature', suit: 'wolf' },
      { id: 'ph2', kind: 'creature', suit: 'wolf' },
    ]);

    // Both alive enemies are offered as targets for the very same pile,
    // with the identical pool set size -- there is no "owning" enemy.
    const targets = getLegalPlayerClaimTargets(state).filter((t) => t.suit === 'wolf');
    expect(targets.length).toBe(2);
    expect(targets.every((t) => t.poolSetSize === 5)).toBe(true);

    const next = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'wolf', targetInstanceId: 'e2', handCardIds: ['ph1', 'ph2'] },
      rng,
    );

    const e1 = next.enemies.find((e) => e.instanceId === 'e1');
    const e2 = next.enemies.find((e) => e.instanceId === 'e2');
    expect(e1?.hp).toBe(10); // untouched -- the player freely chose e2 instead
    expect(e2).toBeUndefined(); // pool set size 5 x 2 hand cards = 10, exactly lethal
    expect(next.pool.some((c) => isCreatureCard(c) && c.suit === 'wolf')).toBe(false); // the whole pile is consumed regardless of target
  });
});

describe('enemy turn resolution (fixed pattern cycle)', () => {
  it('attack damages the player and advances the pattern index', () => {
    const room = makeRoom({ enemies: [makeEnemy({ patternIndex: 0 })] }); // wolf-kin[0] = attack 4
    const rng = createRng(3);
    let state: CombatState = makeCombat(room, rng, 30, 30);
    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);

    expect(next.playerHP).toBe(30 - 4);
    expect(next.enemies[0].patternIndex).toBe(1);
    expect(next.log.some((l) => l.type === 'attack')).toBe(true);
  });

  it('guard banks on the enemy and absorbs the player\'s next claim against it', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ defId: 'spider-broodmother', name: 'Spider Broodmother', patternIndex: 3 })], // spider-broodmother[3] = guard 6
      pool: [
        { id: 'p1', kind: 'creature', suit: 'wolf' },
        { id: 'p2', kind: 'creature', suit: 'wolf' },
        { id: 'p3', kind: 'creature', suit: 'wolf' },
      ],
    });
    const rng = createRng(4);
    let state: CombatState = makeCombat(room, rng, 30, 30);
    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(state.enemies[0].guard).toBe(6);

    // This room has one enemy, so that ENEMY_TURN just concluded the whole
    // round and redrew the hand from the deck -- force the specific
    // matching hand this claim needs, same as any other CombatState field
    // this suite hacks directly to reach a scenario.
    state = {
      ...state,
      playerHand: [
        { id: 'ph1', kind: 'creature', suit: 'wolf' },
        { id: 'ph2', kind: 'creature', suit: 'wolf' },
      ],
    };

    // pool set size 3 x 2 hand cards = 6; Guard absorbs all 6, none gets through
    const next = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1', 'ph2'] },
      rng,
    );
    expect(next.enemies[0].hp).toBe(20);
    expect(next.enemies[0].guard).toBe(0);
  });

  it('heal restores enemy HP, capped at hpMax', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ defId: 'rot-husk', name: 'Rot Husk', hp: 16, hpMax: 18, patternIndex: 2 })], // rot-husk[2] = heal 4
    });
    const rng = createRng(5);
    let state: CombatState = makeCombat(room, rng, 30, 30);
    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(next.enemies[0].hp).toBe(18); // capped, not 20
  });

  it('debuff applies Weaken stacks that reduce the player\'s claim, then decay by 1 (not fully expire) at turn end', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ defId: 'rot-husk', name: 'Rot Husk', hp: 18, hpMax: 18, patternIndex: 0 })], // rot-husk[0] = debuff 3 stacks
      pool: [
        { id: 'p1', kind: 'creature', suit: 'rot' },
        { id: 'p2', kind: 'creature', suit: 'rot' },
        { id: 'p3', kind: 'creature', suit: 'rot' },
        { id: 'p4', kind: 'creature', suit: 'rot' },
      ],
    });
    const rng = createRng(6);
    let state: CombatState = makeCombat(room, rng, 30, 30);
    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(state.playerStatuses.weaken).toBe(3);

    // One enemy -- that ENEMY_TURN concluded the round and redrew the hand;
    // force the rot hand this claim needs (see the guard-banking test above
    // for the same pattern).
    state = {
      ...state,
      playerHand: [
        { id: 'ph1', kind: 'creature', suit: 'rot' },
        { id: 'ph2', kind: 'creature', suit: 'rot' },
      ],
    };

    // raw magnitude 4 x 2 = 8, weakened 3 stacks x 10% = 30% -> round(5.6) = 6
    let next = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'rot', targetInstanceId: 'e1', handCardIds: ['ph1', 'ph2'] },
      rng,
    );
    expect(next.enemies[0].hp).toBe(18 - 6);
    // One of two plays spent (PLAYS_PER_TURN_BASE = 2) -- the player's turn,
    // and thus the status decay tick, hasn't happened yet.
    expect(next.playerStatuses.weaken).toBe(3);

    next = applyCombatAction(next, { type: 'PLAYER_PASS' }, rng);
    expect(next.playerStatuses.weaken).toBe(2); // decays by 1 at the end of the player's turn, not fully expired
  });

  it('corrupt/block-suit blocks a suit present in the pool', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ defId: 'ember-wretch', name: 'Ember Wretch', patternIndex: 1 })], // ember-wretch[1] = corrupt block-suit
    });
    const rng = createRng(7);
    let state: CombatState = makeCombat(room, rng, 30, 30);
    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(next.blockedSuits.wolf).toBe(SURPRISE_BLOCK_DURATION_TURNS);
  });

  it('corrupt/add-cards grows the pool with cards drawn from the room\'s threat suits', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ defId: 'spider-broodmother', name: 'Spider Broodmother', patternIndex: 0 })], // [0] = corrupt add-cards
    });
    const rng = createRng(8);
    let state: CombatState = makeCombat(room, rng, 30, 30);
    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };
    const before = state.pool.length;

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(next.pool.length).toBe(before + SURPRISE_ADD_CARDS_COUNT);
    const added = next.pool.slice(before);
    expect(added.every((c) => isCreatureCard(c) && room.params.threatSuits.includes(c.suit))).toBe(true);
  });

  it('corrupt/force-discard routes a random hand card to the discard pile, recoverable on the next reshuffle', () => {
    const room = makeRoom({
      enemies: [
        makeEnemy({ instanceId: 'e1', patternIndex: 1 }), // wolf-kin[1] = corrupt force-discard
        // A second enemy so e1 acting isn't the whole round concluding --
        // otherwise the round-end redraw (which fires in the very same
        // dispatched action) would immediately overwrite the hand this test
        // is trying to observe right after the discard.
        makeEnemy({ instanceId: 'e2', patternIndex: 3 }), // wolf-kin[3] = strength (self-buff, doesn't touch the player)
      ],
    });
    const rng = createRng(9);
    let state: CombatState = makeCombat(room, rng, 30, 30, [{ id: 'ph1', kind: 'creature', suit: 'wolf' }]);
    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(next.playerHand.length).toBe(0);
    expect(next.discardPile.some((c) => c.id === 'ph1')).toBe(true);
    expect(next.activeTurn).toBe('enemy'); // round not over -- e2 still to act
  });
});

describe('status effects: Weaken/Strength/Poison are stacks that decay by 1 per holder turn', () => {
  it('poison applies stacks to the player that deal damage and decay by 1 only at the player\'s own turn end', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ defId: 'spider-broodmother', name: 'Spider Broodmother', hp: 22, hpMax: 22, patternIndex: 2 })], // spider[2] = poison 4
    });
    const rng = createRng(23);
    let state: CombatState = makeCombat(room, rng, 30, 30);
    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };

    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(state.playerStatuses.poison).toBe(4);
    expect(state.playerHP).toBe(30); // applying the stacks doesn't hit immediately

    // Player passes; poison deals its current stack count (4) at the end of
    // the player's own turn, then decays by 1 -- not wiped to 0.
    const next = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
    expect(next.playerHP).toBe(30 - 4);
    expect(next.playerStatuses.poison).toBe(3);
  });

  it('strength the enemy grants itself boosts its own next attack, then decays by 1 per its own turn', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ patternIndex: 3 })], // wolf-kin[3] = strength 3
    });
    const rng = createRng(24);
    let state: CombatState = makeCombat(room, rng, 30, 30);
    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };

    // Granting the buff also ticks it down once, at the end of this same turn.
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(state.enemies[0].statuses.strength).toBe(2);

    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
    // wolf-kin[0] = attack 4, boosted by its 2 remaining Strength stacks -> 6
    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(next.playerHP).toBe(30 - 6);
    expect(next.enemies[0].statuses.strength).toBe(1); // decays again after this turn
  });

  it('strength on the player boosts a threat claim by adding stacks to the pool set size before the hand-card multiplier', () => {
    const room = makeRoom({
      pool: [{ id: 'p1', kind: 'creature', suit: 'wolf' }],
    });
    const rng = createRng(25);
    let state: CombatState = makeCombat(room, rng, 30, 30, [
      { id: 'ph1', kind: 'creature', suit: 'wolf' },
      { id: 'ph2', kind: 'creature', suit: 'wolf' },
    ]);
    state = { ...state, playerStatuses: { strength: 3 } };

    // (pool set size 1 + 3 Strength) x 2 hand cards = 8
    let next = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1', 'ph2'] },
      rng,
    );
    expect(next.enemies[0].hp).toBe(20 - 8);
    // One of two plays spent (PLAYS_PER_TURN_BASE = 2) -- turn hasn't ended
    // yet, so no decay tick.
    expect(next.playerStatuses.strength).toBe(3);

    next = applyCombatAction(next, { type: 'PLAYER_PASS' }, rng);
    expect(next.playerStatuses.strength).toBe(2); // decays by 1 at the end of the player's turn
  });

  it('an enemy defeated by its own Poison tick mid-phase is kept as a "corpse" until round end, so later enemies still get their turn', () => {
    const room = makeRoom({
      enemies: [
        makeEnemy({ instanceId: 'e1', defId: 'rot-husk', name: 'Rot Husk', hp: 3, hpMax: 18, patternIndex: 1, statuses: { poison: 5 } }), // rot-husk[1] = attack 4; its own poison tick then kills it
        makeEnemy({ instanceId: 'e2', defId: 'wolf-kin', name: 'Wolf-kin', hp: 14, hpMax: 14, patternIndex: 0 }), // wolf-kin[0] = attack 4
      ],
    });
    const rng = createRng(26);
    let state: CombatState = makeCombat(room, rng, 30, 30);
    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };

    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng); // e1 acts, then its own poison tick kills it
    expect(state.enemies.length).toBe(2); // corpse retained mid-phase, not spliced out yet
    expect(state.enemies.find((e) => e.instanceId === 'e1')!.hp).toBe(0);
    expect(state.activeTurn).toBe('enemy');
    expect(state.activeEnemyIndex).toBe(1); // correctly advanced to e2, not skipped or repeated

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng); // e2 still gets its turn
    expect(next.playerHP).toBe(30 - 4 - 4); // e1's attack (4) + e2's attack (4)
    expect(next.enemies.length).toBe(1); // corpse swept once the round concludes
    expect(next.enemies[0].instanceId).toBe('e2');
    expect(next.activeTurn).toBe('player');
  });
});

describe('multi-enemy phase and Guard', () => {
  it('Guard persists through the whole enemy phase, not just the first enemy, and fades only once the phase concludes', () => {
    const room = makeRoom({
      enemies: [
        makeEnemy({ instanceId: 'e1', defId: 'wolf-kin', patternIndex: 0 }), // attack 4
        makeEnemy({ instanceId: 'e2', defId: 'ember-wretch', name: 'Ember Wretch', patternIndex: 0 }), // attack 3
      ],
    });
    const rng = createRng(10);
    let state: CombatState = makeCombat(room, rng, 30, 30);
    state = { ...state, playerGuard: 5, activeTurn: 'enemy', activeEnemyIndex: 0 };

    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng); // e1 attacks for 4, absorbed
    expect(state.playerHP).toBe(30);
    expect(state.playerGuard).toBe(1);
    expect(state.activeTurn).toBe('enemy'); // phase not over -- e2 still to act

    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng); // e2 attacks for 3: 1 absorbed, 2 through
    expect(state.playerHP).toBe(30 - 2);
    // Guard was fully consumed absorbing e2's hit, not left over to expire --
    // no separate guard-fade entry is expected in that case.
    expect(state.playerGuard).toBe(0);
    expect(state.activeTurn).toBe('player');
  });
});

describe('decay backstop', () => {
  it('auto-resolves an unclaimed live set after N turns and short-circuits on death', () => {
    const room = makeRoom({
      // A rot pair the player's all-wolf hand can never legally claim,
      // guaranteeing the decay backstop is what removes it.
      pool: [
        { id: 'p1', kind: 'creature', suit: 'rot' },
        { id: 'p2', kind: 'creature', suit: 'rot' },
      ],
      enemies: [makeEnemy({ patternIndex: 3 })], // guard, not attack -- isolates the decay math from enemy damage
    });
    const rng = createRng(11);
    let state: CombatState = makeCombat(room, rng, 20, 30, [{ id: 'ph1', kind: 'creature', suit: 'wolf' }]);

    for (let i = 0; i < 8 && state.status === 'active'; i++) {
      const action = state.activeTurn === 'player' ? { type: 'PLAYER_PASS' as const } : { type: 'ENEMY_TURN' as const };
      state = applyCombatAction(state, action, rng);
    }

    const decayLogs = state.log.filter((l) => l.type === 'decay');
    expect(decayLogs.length).toBeGreaterThan(0);
    expect(state.status === 'player-dead' || state.playerHP < 20).toBe(true);
  });
});

describe('decay applies the pile\'s own effect at magnitude = pile size only, to every entity in the room', () => {
  it('a threat pile damages the player and every alive enemy, not just one', () => {
    const room = makeRoom({
      enemies: [
        makeEnemy({ instanceId: 'e1', defId: 'wolf-kin', hp: 20, hpMax: 20 }),
        // patternIndex 1 (corrupt/block-suit) so this enemy's own turn -- needed
        // to reach round-end -- doesn't hit the player/itself and skew the
        // decay-only damage assertions below.
        makeEnemy({ instanceId: 'e2', defId: 'ember-wretch', name: 'Ember Wretch', hp: 20, hpMax: 20, patternIndex: 1 }),
      ],
      pool: [
        { id: 'p1', kind: 'creature', suit: 'rot' },
        { id: 'p2', kind: 'creature', suit: 'rot' },
        { id: 'p3', kind: 'creature', suit: 'rot' },
      ],
    });
    const rng = createRng(19);
    let state: CombatState = makeCombat(room, rng, 30, 30, [{ id: 'ph1', kind: 'creature', suit: 'wolf' }]);
    // Fast-forward the decay counter to one tick shy of resolving, and to the
    // last enemy's turn (decay only ticks at round-end), so a single
    // dispatched action triggers it deterministically.
    state = {
      ...state,
      decayCounters: { rot: DECAY_TURNS_N - 1 },
      activeTurn: 'enemy',
      activeEnemyIndex: 1,
    };

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);

    // magnitude = pile size (3) x 1 -- no hand-card multiplier
    expect(next.playerHP).toBe(30 - 3);
    expect(next.enemies.find((e) => e.instanceId === 'e1')!.hp).toBe(20 - 3);
    expect(next.enemies.find((e) => e.instanceId === 'e2')!.hp).toBe(20 - 3);
    expect(next.pool.some((c) => isCreatureCard(c) && c.suit === 'rot')).toBe(false);
  });

  it('a boon pile heals the player and every alive enemy', () => {
    const room = makeRoom({
      // patternIndex 1 (corrupt/force-discard) so reaching round-end doesn't
      // also land an attack that would muddy the heal assertions below.
      enemies: [makeEnemy({ instanceId: 'e1', hp: 10, hpMax: 20, patternIndex: 1 })],
      pool: [
        { id: 'p1', kind: 'creature', suit: 'grace' },
        { id: 'p2', kind: 'creature', suit: 'grace' },
      ],
    });
    const rng = createRng(20);
    let state: CombatState = makeCombat(room, rng, 15, 30, [{ id: 'ph1', kind: 'creature', suit: 'wolf' }]);
    state = {
      ...state,
      decayCounters: { grace: DECAY_TURNS_N - 1 },
      activeTurn: 'enemy',
      activeEnemyIndex: 0,
    };

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);

    expect(next.playerHP).toBe(15 + 2);
    expect(next.enemies[0].hp).toBe(10 + 2);
  });

  it('a guard pile grants Guard to the player and every alive enemy', () => {
    const room = makeRoom({
      // patternIndex 1 (corrupt/force-discard) so reaching round-end doesn't
      // also grant this enemy Guard of its own, which would absorb the
      // decay's damage-free guard grant and muddy the assertions below.
      enemies: [makeEnemy({ instanceId: 'e1', patternIndex: 1 })],
      pool: [
        { id: 'p1', kind: 'creature', suit: 'ward' },
        { id: 'p2', kind: 'creature', suit: 'ward' },
      ],
    });
    const rng = createRng(21);
    let state: CombatState = makeCombat(room, rng, 30, 30, [{ id: 'ph1', kind: 'creature', suit: 'wolf' }]);
    state = {
      ...state,
      decayCounters: { ward: DECAY_TURNS_N - 1 },
      activeTurn: 'enemy',
      activeEnemyIndex: 0,
    };

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);

    expect(next.playerGuard).toBe(2);
    expect(next.enemies[0].guard).toBe(2);
  });

  it('a threat pile that defeats the last enemy clears the room', () => {
    const room = makeRoom({
      // patternIndex 1 (corrupt/force-discard) so reaching round-end doesn't
      // also land an attack of its own before the decay-caused death check.
      enemies: [makeEnemy({ instanceId: 'e1', hp: 2, hpMax: 20, patternIndex: 1 })],
      pool: [
        { id: 'p1', kind: 'creature', suit: 'rot' },
        { id: 'p2', kind: 'creature', suit: 'rot' },
        { id: 'p3', kind: 'creature', suit: 'rot' },
      ],
    });
    const rng = createRng(22);
    let state: CombatState = makeCombat(room, rng, 30, 30, [{ id: 'ph1', kind: 'creature', suit: 'wolf' }]);
    state = {
      ...state,
      decayCounters: { rot: DECAY_TURNS_N - 1 },
      activeTurn: 'enemy',
      activeEnemyIndex: 0,
    };

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);

    expect(next.enemies).toEqual([]);
    expect(next.status).toBe('room-cleared');
  });
});

describe('pool exhaustion', () => {
  it('refills the pool and keeps the round active rather than clearing it for free', () => {
    const room = makeRoom({ pool: [] });
    const rng = createRng(12);
    let state = makeCombat(room, rng, 30, 30);
    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);

    expect(state.status).toBe('active');
    expect(state.enemies[0].hp).toBe(20); // untouched -- refill isn't a claim
    expect(state.pool.length).toBeGreaterThan(0);
    expect(state.log.some((l) => l.type === 'pool-refill')).toBe(true);
  });
});

describe('MIN_POOL_SET_SIZE = 1 (1 on the table, 1 in hand)', () => {
  it('a single pool card is claimable with a single matching hand card', () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'wolf' },
        { id: 'p2', kind: 'creature', suit: 'rot' },
        { id: 'p3', kind: 'creature', suit: 'rot' },
      ],
    });
    const rng = createRng(13);
    const state = makeCombat(room, rng, 30, 30, [{ id: 'ph1', kind: 'creature', suit: 'wolf' }]);
    const next = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );

    expect(next.enemies[0].hp).toBe(20 - 1);
    expect(next.pool.map((c) => c.id)).toEqual(['p2', 'p3']);
  });
});

describe('boon suit', () => {
  it('heals the player when claimed -- no target instance needed', () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'grace' },
        { id: 'p2', kind: 'creature', suit: 'grace' },
      ],
    });
    const rng = createRng(14);
    const state = makeCombat(room, rng, 20, 30, [{ id: 'ph1', kind: 'creature', suit: 'grace' }]);
    const next = applyCombatAction(state, { type: 'PLAYER_CLAIM', suit: 'grace', handCardIds: ['ph1'] }, rng);
    expect(next.playerHP).toBe(22); // healed by 2x1
  });
});

describe('guard suit (Ward)', () => {
  it('a player claim banks Guard equal to the usual claim magnitude, with no HP/enemy effect', () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'ward' },
        { id: 'p2', kind: 'creature', suit: 'ward' },
      ],
    });
    const rng = createRng(15);
    const state = makeCombat(room, rng, 30, 30, [{ id: 'ph1', kind: 'creature', suit: 'ward' }]);
    const next = applyCombatAction(state, { type: 'PLAYER_CLAIM', suit: 'ward', handCardIds: ['ph1'] }, rng);

    expect(next.playerGuard).toBe(2);
    expect(next.playerHP).toBe(30);
    expect(next.enemies[0].hp).toBe(20);
  });

  it('absorbs incoming enemy attack damage before it reaches Player HP', () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'ward' },
        { id: 'p2', kind: 'creature', suit: 'ward' },
      ],
      enemies: [makeEnemy({ patternIndex: 0 })], // attack 4
    });
    const rng = createRng(16);
    let state = makeCombat(room, rng, 30, 30, [{ id: 'ph1', kind: 'creature', suit: 'ward' }]);
    state = applyCombatAction(state, { type: 'PLAYER_CLAIM', suit: 'ward', handCardIds: ['ph1'] }, rng);
    expect(state.playerGuard).toBe(2);
    expect(state.activeTurn).toBe('player'); // one play spent, one left (PLAYS_PER_TURN_BASE = 2) -- still the player's turn
    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);

    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    // attack 4; Guard absorbs 2, 2 gets through
    expect(state.playerHP).toBe(30 - 2);
    expect(state.playerGuard).toBe(0);
  });
});

describe('weaken suit (Hex)', () => {
  it('a player claim inflicts Weaken stacks on the chosen enemy instead of HP damage, mirroring the enemy\'s own Debuff', () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'hex' },
        { id: 'p2', kind: 'creature', suit: 'hex' },
      ],
    });
    const rng = createRng(27);
    const state = makeCombat(room, rng, 30, 30, [{ id: 'ph1', kind: 'creature', suit: 'hex' }]);
    const next = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'hex', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );
    expect(next.enemies[0].statuses.weaken).toBe(2); // pool set size 2 x 1 hand card
    expect(next.enemies[0].hp).toBe(20); // no HP change
  });

  it('requires an enemy target the same way a threat claim does', () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'hex' },
        { id: 'p2', kind: 'creature', suit: 'hex' },
      ],
    });
    const rng = createRng(28);
    const state = makeCombat(room, rng, 30, 30, [{ id: 'ph1', kind: 'creature', suit: 'hex' }]);
    const legal = getLegalPlayerClaimTargets(state).filter((t) => t.suit === 'hex');
    expect(legal.length).toBe(1);
    expect(legal[0].targetInstanceId).toBe('e1');

    const rejected = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'hex', handCardIds: ['ph1'] }, // no targetInstanceId
      rng,
    );
    expect(rejected).toBe(state); // illegal claim, state unchanged
  });
});

describe('poison suit (Venom)', () => {
  it('a player claim inflicts Poison stacks on the chosen enemy, which then deal damage on that enemy\'s own turn', () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'venom' },
        { id: 'p2', kind: 'creature', suit: 'venom' },
      ],
      enemies: [makeEnemy({ patternIndex: 1 })], // wolf-kin[1] = corrupt force-discard, isolates the poison damage
    });
    const rng = createRng(29);
    let state: CombatState = makeCombat(room, rng, 30, 30, [{ id: 'ph1', kind: 'creature', suit: 'venom' }]);
    state = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'venom', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
    );
    expect(state.enemies[0].statuses.poison).toBe(2);
    expect(state.enemies[0].hp).toBe(20); // applying the stacks doesn't hit immediately

    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };
    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);
    expect(next.enemies[0].hp).toBe(20 - 2); // its own poison tick, at the true end of its own turn
    expect(next.enemies[0].statuses.poison).toBe(1); // decays by 1
  });
});

describe('strength suit (Vigor)', () => {
  it('a player claim grants the player Strength stacks -- no target needed, no HP/enemy effect', () => {
    const room = makeRoom({
      pool: [
        { id: 'p1', kind: 'creature', suit: 'vigor' },
        { id: 'p2', kind: 'creature', suit: 'vigor' },
      ],
    });
    const rng = createRng(30);
    const state = makeCombat(room, rng, 30, 30, [{ id: 'ph1', kind: 'creature', suit: 'vigor' }]);
    let next = applyCombatAction(state, { type: 'PLAYER_CLAIM', suit: 'vigor', handCardIds: ['ph1'] }, rng);
    // pool set size 2 x 1 hand card = 2 stacks granted. One of two plays
    // spent (PLAYS_PER_TURN_BASE = 2) -- the turn hasn't ended yet, so no
    // decay tick fires.
    expect(next.playerStatuses.strength).toBe(2);
    expect(next.playerHP).toBe(30);
    expect(next.enemies[0].hp).toBe(20);

    // Passing ends the turn -- the same cadence the existing
    // player-Strength/Weaken tests already exercise.
    next = applyCombatAction(next, { type: 'PLAYER_PASS' }, rng);
    expect(next.playerStatuses.strength).toBe(1);
  });
});

describe('hand discard & redraw (persistent deck)', () => {
  it('discards the whole hand and draws a fresh one once the enemy phase concludes, conserving every card', () => {
    const room = makeRoom();
    const rng = createRng(17);
    const deck = makeDeck('wolf', 8, 'pd');
    // Genuinely drawn from `deck` (no hand override here) -- the point of
    // this test is to conserve every card the deck started with, which a
    // manual playerHand override would break.
    let state = initCombat(room, rng, 30, 30, deck);
    const originalHandIds = state.playerHand.map((c) => c.id);

    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);

    expect(state.activeTurn).toBe('player');
    expect(state.playerHand.length).toBe(room.params.playerHandSize);
    expect(state.playerHand.map((c) => c.id)).not.toEqual(originalHandIds);
    expect(state.log.some((l) => l.type === 'redraw')).toBe(true);

    // No card the deck started with is ever lost -- the new hand plus
    // whatever's left in drawPile/discardPile still accounts for every id
    // the deck was built from (the old hand, unclaimed, went to discard).
    const allIdsNow = new Set([
      ...state.playerHand.map((c) => c.id),
      ...state.drawPile.map((c) => c.id),
      ...state.discardPile.map((c) => c.id),
    ]);
    expect(allIdsNow.size).toBe(deck.length);
    for (const c of deck) expect(allIdsNow.has(c.id)).toBe(true);
  });

  it('routes claimed cards to the discard pile, where they can be drawn again later in the same room', () => {
    const room = makeRoom({
      pool: [{ id: 'p1', kind: 'creature', suit: 'wolf' }],
    });
    const rng = createRng(40);
    // A tiny 2-card deck forces a reshuffle on the very next draw, so the
    // just-claimed card is guaranteed to come back around.
    const deck: Card[] = [
      { id: 'tiny-1', kind: 'creature', suit: 'wolf' },
      { id: 'tiny-2', kind: 'creature', suit: 'wolf' },
    ];
    let state = initCombat(room, rng, 30, 30, deck);
    const claimedId = state.playerHand[0].id;

    state = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'wolf', targetInstanceId: 'e1', handCardIds: [claimedId] },
      rng,
    );
    expect(state.discardPile.some((c) => c.id === claimedId)).toBe(true);

    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng);
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng);

    const seenAgain = [...state.playerHand, ...state.drawPile, ...state.discardPile].some((c) => c.id === claimedId);
    expect(seenAgain).toBe(true);
  });
});
