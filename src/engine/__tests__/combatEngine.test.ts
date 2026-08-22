import { describe, it, expect } from 'vitest';
import { createRng } from '../rng';
import { initCombat, applyCombatAction, getLegalPlayerClaimTargets } from '../combatEngine';
import type { RoomInstance } from '../../types/room';
import type { EnemyInstance } from '../../types/enemy';
import type { CombatState } from '../../types/combat';
import type { Card } from '../../types/cards';
import { SURPRISE_ADD_CARDS_COUNT, SURPRISE_BLOCK_DURATION_TURNS, DECAY_TURNS_N } from '../../config/constants';

function makeEnemy(overrides: Partial<EnemyInstance> = {}): EnemyInstance {
  return {
    instanceId: 'e1',
    defId: 'wolf-kin',
    name: 'Wolf-kin',
    hp: 20,
    hpMax: 20,
    guard: 0,
    patternIndex: 0,
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
    },
    enemies: [makeEnemy()],
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
    ...overrides,
  };
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
    const state = initCombat(room, rng, 30, 30);

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
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
    });
    const rng = createRng(1);
    const state = initCombat(room, rng, 30, 30);
    const next = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1'] },
      rng,
      false,
    );

    expect(next.enemies).toEqual([]);
    expect(next.status).toBe('room-cleared');
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
      playerHandDeal: [
        { id: 'ph1', kind: 'creature', suit: 'wolf' },
        { id: 'ph2', kind: 'creature', suit: 'wolf' },
      ],
    });
    const rng = createRng(2);
    const state = initCombat(room, rng, 30, 30);

    // Both alive enemies are offered as targets for the very same pile,
    // with the identical pool set size -- there is no "owning" enemy.
    const targets = getLegalPlayerClaimTargets(state).filter((t) => t.suit === 'wolf');
    expect(targets.length).toBe(2);
    expect(targets.every((t) => t.poolSetSize === 5)).toBe(true);

    const next = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'wolf', targetInstanceId: 'e2', handCardIds: ['ph1', 'ph2'] },
      rng,
      false,
    );

    const e1 = next.enemies.find((e) => e.instanceId === 'e1');
    const e2 = next.enemies.find((e) => e.instanceId === 'e2');
    expect(e1?.hp).toBe(10); // untouched -- the player freely chose e2 instead
    expect(e2).toBeUndefined(); // pool set size 5 x 2 hand cards = 10, exactly lethal
    expect(next.pool.some((c) => c.suit === 'wolf')).toBe(false); // the whole pile is consumed regardless of target
  });
});

describe('enemy turn resolution (fixed pattern cycle)', () => {
  it('attack damages the player and advances the pattern index', () => {
    const room = makeRoom({ enemies: [makeEnemy({ patternIndex: 0 })] }); // wolf-kin[0] = attack 4
    const rng = createRng(3);
    let state: CombatState = initCombat(room, rng, 30, 30);
    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng, false);

    expect(next.playerHP).toBe(30 - 4);
    expect(next.enemies[0].patternIndex).toBe(1);
    expect(next.log.some((l) => l.type === 'attack')).toBe(true);
  });

  it('guard banks on the enemy and absorbs the player\'s next claim against it', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ patternIndex: 3 })], // wolf-kin[3] = guard 5
      pool: [
        { id: 'p1', kind: 'creature', suit: 'wolf' },
        { id: 'p2', kind: 'creature', suit: 'wolf' },
        { id: 'p3', kind: 'creature', suit: 'wolf' },
      ],
      playerHandDeal: [
        { id: 'ph1', kind: 'creature', suit: 'wolf' },
        { id: 'ph2', kind: 'creature', suit: 'wolf' },
      ],
    });
    const rng = createRng(4);
    let state: CombatState = initCombat(room, rng, 30, 30);
    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng, false);
    expect(state.enemies[0].guard).toBe(5);

    // pool set size 3 x 2 hand cards = 6; Guard absorbs 5, 1 gets through
    const next = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'wolf', targetInstanceId: 'e1', handCardIds: ['ph1', 'ph2'] },
      rng,
      false,
    );
    expect(next.enemies[0].hp).toBe(20 - 1);
    expect(next.enemies[0].guard).toBe(0);
  });

  it('heal restores enemy HP, capped at hpMax', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ defId: 'rot-husk', name: 'Rot Husk', hp: 16, hpMax: 18, patternIndex: 2 })], // rot-husk[2] = heal 4
    });
    const rng = createRng(5);
    let state: CombatState = initCombat(room, rng, 30, 30);
    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng, false);
    expect(next.enemies[0].hp).toBe(18); // capped, not 20
  });

  it('debuff weakens the player\'s next threat claim, then expires whether or not it was used', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ defId: 'rot-husk', name: 'Rot Husk', hp: 18, hpMax: 18, patternIndex: 0 })], // rot-husk[0] = debuff 0.3
      pool: [
        { id: 'p1', kind: 'creature', suit: 'rot' },
        { id: 'p2', kind: 'creature', suit: 'rot' },
        { id: 'p3', kind: 'creature', suit: 'rot' },
        { id: 'p4', kind: 'creature', suit: 'rot' },
      ],
      playerHandDeal: [
        { id: 'ph1', kind: 'creature', suit: 'rot' },
        { id: 'ph2', kind: 'creature', suit: 'rot' },
      ],
    });
    const rng = createRng(6);
    let state: CombatState = initCombat(room, rng, 30, 30);
    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng, false);
    expect(state.playerWeakenPct).toBeCloseTo(0.3);

    // raw magnitude 4 x 2 = 8, weakened 30% -> round(5.6) = 6
    const next = applyCombatAction(
      state,
      { type: 'PLAYER_CLAIM', suit: 'rot', targetInstanceId: 'e1', handCardIds: ['ph1', 'ph2'] },
      rng,
      false,
    );
    expect(next.enemies[0].hp).toBe(18 - 6);
    expect(next.playerWeakenPct).toBe(0); // expired once the player's turn concluded
  });

  it('corrupt/block-suit blocks a suit present in the pool', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ defId: 'ember-wretch', name: 'Ember Wretch', patternIndex: 1 })], // ember-wretch[1] = corrupt block-suit
    });
    const rng = createRng(7);
    let state: CombatState = initCombat(room, rng, 30, 30);
    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng, false);
    expect(next.blockedSuits.wolf).toBe(SURPRISE_BLOCK_DURATION_TURNS);
  });

  it('corrupt/add-cards grows the pool with cards drawn from the room\'s threat suits', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ defId: 'spider-broodmother', name: 'Spider Broodmother', patternIndex: 0 })], // [0] = corrupt add-cards
    });
    const rng = createRng(8);
    let state: CombatState = initCombat(room, rng, 30, 30);
    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };
    const before = state.pool.length;

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng, false);
    expect(next.pool.length).toBe(before + SURPRISE_ADD_CARDS_COUNT);
    const added = next.pool.slice(before);
    expect(added.every((c) => room.params.threatSuits.includes(c.suit))).toBe(true);
  });

  it('corrupt/force-discard removes a random card from the player hand', () => {
    const room = makeRoom({
      enemies: [makeEnemy({ patternIndex: 1 })], // wolf-kin[1] = corrupt force-discard
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
    });
    const rng = createRng(9);
    let state: CombatState = initCombat(room, rng, 30, 30);
    state = { ...state, activeTurn: 'enemy', activeEnemyIndex: 0 };

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng, false);
    expect(next.playerHand.length).toBe(0);
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
    let state: CombatState = initCombat(room, rng, 30, 30);
    state = { ...state, playerGuard: 5, activeTurn: 'enemy', activeEnemyIndex: 0 };

    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng, false); // e1 attacks for 4, absorbed
    expect(state.playerHP).toBe(30);
    expect(state.playerGuard).toBe(1);
    expect(state.activeTurn).toBe('enemy'); // phase not over -- e2 still to act

    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng, false); // e2 attacks for 3: 1 absorbed, 2 through
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
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
      enemies: [makeEnemy({ patternIndex: 3 })], // guard, not attack -- isolates the decay math from enemy damage
    });
    const rng = createRng(11);
    let state: CombatState = initCombat(room, rng, 20, 30);

    for (let i = 0; i < 8 && state.status === 'active'; i++) {
      const action = state.activeTurn === 'player' ? { type: 'PLAYER_PASS' as const } : { type: 'ENEMY_TURN' as const };
      state = applyCombatAction(state, action, rng, false);
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
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
    });
    const rng = createRng(19);
    let state: CombatState = initCombat(room, rng, 30, 30);
    // Fast-forward the decay counter to one tick shy of resolving, and to the
    // last enemy's turn (decay only ticks at round-end), so a single
    // dispatched action triggers it deterministically.
    state = {
      ...state,
      decayCounters: { rot: DECAY_TURNS_N - 1 },
      activeTurn: 'enemy',
      activeEnemyIndex: 1,
    };

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng, false);

    // magnitude = pile size (3) x 1 -- no hand-card multiplier
    expect(next.playerHP).toBe(30 - 3);
    expect(next.enemies.find((e) => e.instanceId === 'e1')!.hp).toBe(20 - 3);
    expect(next.enemies.find((e) => e.instanceId === 'e2')!.hp).toBe(20 - 3);
    expect(next.pool.some((c) => c.suit === 'rot')).toBe(false);
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
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
    });
    const rng = createRng(20);
    let state: CombatState = initCombat(room, rng, 15, 30);
    state = {
      ...state,
      decayCounters: { grace: DECAY_TURNS_N - 1 },
      activeTurn: 'enemy',
      activeEnemyIndex: 0,
    };

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng, false);

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
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
    });
    const rng = createRng(21);
    let state: CombatState = initCombat(room, rng, 30, 30);
    state = {
      ...state,
      decayCounters: { ward: DECAY_TURNS_N - 1 },
      activeTurn: 'enemy',
      activeEnemyIndex: 0,
    };

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng, false);

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
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
    });
    const rng = createRng(22);
    let state: CombatState = initCombat(room, rng, 30, 30);
    state = {
      ...state,
      decayCounters: { rot: DECAY_TURNS_N - 1 },
      activeTurn: 'enemy',
      activeEnemyIndex: 0,
    };

    const next = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng, false);

    expect(next.enemies).toEqual([]);
    expect(next.status).toBe('room-cleared');
  });
});

describe('pool exhaustion', () => {
  it('refills the pool and keeps the round active rather than clearing it for free', () => {
    const room = makeRoom({ pool: [] });
    const rng = createRng(12);
    let state = initCombat(room, rng, 30, 30);
    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng, false);

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
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'wolf' }],
    });
    const rng = createRng(13);
    const state = initCombat(room, rng, 30, 30);
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
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'grace' }],
    });
    const rng = createRng(14);
    const state = initCombat(room, rng, 20, 30);
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
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'ward' }],
    });
    const rng = createRng(15);
    const state = initCombat(room, rng, 30, 30);
    const next = applyCombatAction(state, { type: 'PLAYER_CLAIM', suit: 'ward', handCardIds: ['ph1'] }, rng, false);

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
      playerHandDeal: [{ id: 'ph1', kind: 'creature', suit: 'ward' }],
      enemies: [makeEnemy({ patternIndex: 0 })], // attack 4
    });
    const rng = createRng(16);
    let state = initCombat(room, rng, 30, 30);
    state = applyCombatAction(state, { type: 'PLAYER_CLAIM', suit: 'ward', handCardIds: ['ph1'] }, rng, false);
    expect(state.playerGuard).toBe(2);

    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng, false);
    // attack 4; Guard absorbs 2, 2 gets through
    expect(state.playerHP).toBe(30 - 2);
    expect(state.playerGuard).toBe(0);
  });
});

describe('hand redraw (experimental)', () => {
  it('replaces the player hand once the enemy phase concludes and control returns to the player', () => {
    const room = makeRoom();
    const rng = createRng(17);
    let state = initCombat(room, rng, 30, 30);
    const originalHandIds = state.playerHand.map((c: Card) => c.id);

    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng, true);
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng, true);

    expect(state.activeTurn).toBe('player');
    expect(state.playerHand.length).toBe(room.params.playerHandSize);
    expect(state.playerHand.map((c) => c.id)).not.toEqual(originalHandIds);
    expect(state.log.some((l) => l.type === 'redraw')).toBe(true);
  });

  it('leaves the hand untouched between turns when disabled', () => {
    const room = makeRoom();
    const rng = createRng(18);
    let state = initCombat(room, rng, 30, 30);
    const originalHandIds = state.playerHand.map((c: Card) => c.id);

    state = applyCombatAction(state, { type: 'PLAYER_PASS' }, rng, false);
    state = applyCombatAction(state, { type: 'ENEMY_TURN' }, rng, false);

    expect(state.playerHand.map((c) => c.id)).toEqual(originalHandIds);
    expect(state.log.some((l) => l.type === 'redraw')).toBe(false);
  });
});
