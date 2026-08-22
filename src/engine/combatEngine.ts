import type { SuitId } from '../types/suits';
import type { Card, SurpriseCard } from '../types/cards';
import type { RoomInstance, RoomParams } from '../types/room';
import type {
  CombatAction,
  CombatActor,
  CombatState,
  LogEntry,
} from '../types/combat';
import type { Rng } from './rng';
import { generateWeightedDeck } from './deckGenerator';
import {
  resolveAddCards,
  resolveBlockSuit,
  resolveForceDiscard,
} from './surpriseEffects';
import { roomAIChooseClaim } from './roomAI';
import {
  SUIT_DEFINITIONS,
  THREAT_SUITS,
  DECAY_TURNS_N,
  DECAY_HP_PENALTY,
  SURPRISE_BLOCK_DURATION_TURNS,
  ROOM_BOON_REGEN_FACTOR,
  HAND_REDRAW_EACH_TURN,
  MIN_POOL_SET_SIZE,
} from '../config/constants';

const suitCategory = (suit: SuitId) =>
  SUIT_DEFINITIONS.find((s) => s.id === suit)!.category;
const suitName = (suit: SuitId) => SUIT_DEFINITIONS.find((s) => s.id === suit)!.name;

interface MeterSnapshot {
  playerHP: number;
  playerHPMax: number;
  playerGuard: number;
  roomThreat: number;
  roomThreatMax: number;
}

let logCounter = 0;
function makeLog(
  turn: number,
  actor: LogEntry['actor'],
  type: string,
  message: string,
  snapshot: MeterSnapshot,
  claimSnapshot?: Pick<LogEntry, 'claimSuit' | 'claimedHandCards' | 'claimedPoolCards'>,
): LogEntry {
  return { id: `log-${logCounter++}`, turn, actor, type, message, ...snapshot, ...claimSnapshot };
}

function countPoolSuit(pool: Card[], suit: SuitId): number {
  return pool.filter((c) => c.kind === 'creature' && c.suit === suit).length;
}

function liveSetSuits(pool: Card[]): SuitId[] {
  const counts = new Map<SuitId, number>();
  for (const c of pool) {
    if (c.kind !== 'creature') continue;
    counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, n]) => n >= MIN_POOL_SET_SIZE)
    .map(([suit]) => suit);
}

// --- Round initialization ---------------------------------------------

interface PoolSurpriseResolution {
  pool: Card[];
  playerHand: Card[];
  roomHand: Card[];
  blockedSuits: Partial<Record<SuitId, number>>;
  log: LogEntry[];
}

/**
 * Resolves any surprise cards present in a freshly generated pool, in
 * left-to-right order, immediately -- the design doc never specifies a
 * reveal/flip mechanic, so "resolve on reveal" reads as "resolve as soon as
 * this pool exists." Cards added by one surprise are not re-scanned for
 * further surprises. Shared by initCombat and the mid-round pool refill
 * below, so a fresh wave gets the same treatment either way.
 */
function resolvePoolSurprises(
  rawPool: Card[],
  params: RoomParams,
  playerHand: Card[],
  roomHand: Card[],
  blockedSuits: Partial<Record<SuitId, number>>,
  log: LogEntry[],
  turnNumber: number,
  rng: Rng,
  idPrefix: string,
  snapshot: MeterSnapshot,
): PoolSurpriseResolution {
  let pool = [...rawPool];
  let nextPlayerHand = playerHand;
  let nextRoomHand = roomHand;
  let nextBlockedSuits = blockedSuits;
  let nextLog = log;

  const surpriseCards = rawPool.filter((c): c is SurpriseCard => c.kind === 'surprise');
  let addCardBatch = 0;
  for (const card of surpriseCards) {
    pool = pool.filter((c) => c.id !== card.id);
    switch (card.effect) {
      case 'add-cards': {
        pool = resolveAddCards(pool, params, rng, `${idPrefix}-add-${addCardBatch++}`);
        nextLog = [
          ...nextLog,
          makeLog(turnNumber, 'system', 'surprise-add-cards', 'A surprise event scatters more cards into the pool.', snapshot),
        ];
        break;
      }
      case 'block-suit': {
        const suit = resolveBlockSuit(pool, rng);
        if (suit) {
          nextBlockedSuits = { ...nextBlockedSuits, [suit]: SURPRISE_BLOCK_DURATION_TURNS };
          nextLog = [
            ...nextLog,
            makeLog(turnNumber, 'system', 'surprise-block-suit', `A surprise event blocks ${suitName(suit)} for ${SURPRISE_BLOCK_DURATION_TURNS} turn(s).`, snapshot),
          ];
        }
        break;
      }
      case 'force-discard': {
        const result = resolveForceDiscard(nextPlayerHand, nextRoomHand, rng);
        nextPlayerHand = result.playerHand;
        nextRoomHand = result.roomHand;
        if (result.discardedCardId) {
          nextLog = [
            ...nextLog,
            makeLog(turnNumber, 'system', 'surprise-force-discard', `A surprise event forces the ${result.actor} to discard a card.`, snapshot),
          ];
        }
        break;
      }
    }
  }

  return { pool, playerHand: nextPlayerHand, roomHand: nextRoomHand, blockedSuits: nextBlockedSuits, log: nextLog };
}

export function initCombat(
  room: RoomInstance,
  rng: Rng,
  playerHP: number,
  playerHPMax: number,
): CombatState {
  const snapshot: MeterSnapshot = {
    playerHP,
    playerHPMax,
    playerGuard: 0,
    roomThreat: room.params.threatValue,
    roomThreatMax: room.params.threatValue,
  };

  const resolved = resolvePoolSurprises(
    room.pool,
    room.params,
    room.playerHandDeal,
    room.roomHandDeal,
    {},
    [],
    0,
    rng,
    `${room.id}-surprise`,
    snapshot,
  );

  const log = [
    ...resolved.log,
    makeLog(0, 'system', 'round-start', `Room Threat ${room.params.threatValue}. The pool is set.`, snapshot),
  ];

  return {
    pool: resolved.pool,
    playerHand: resolved.playerHand,
    roomHand: resolved.roomHand,
    roomParams: room.params,
    playerHP,
    playerHPMax,
    playerGuard: 0,
    roomThreat: room.params.threatValue,
    roomThreatMax: room.params.threatValue,
    turnNumber: 1,
    activeTurn: 'player',
    decayCounters: {},
    blockedSuits: resolved.blockedSuits,
    log,
    status: 'active',
  };
}

/** Draws a brand new hand for `actor`, weighted the same way as the room's original deal. */
function drawFreshHand(actor: CombatActor, state: CombatState, rng: Rng, idPrefix: string): Card[] {
  const params = state.roomParams;
  const offSuitPool = THREAT_SUITS.filter((s) => s !== params.dominantSuit);
  const handSize = actor === 'player' ? params.playerHandSize : params.roomHandSize;
  return generateWeightedDeck(
    handSize,
    idPrefix,
    {
      dominantSuit: params.dominantSuit,
      offSuitPool,
      onSuitRatio: params.onSuitRatio,
      boonRatio: params.boonRatio,
      guardRatio: params.guardRatio,
      surpriseRatio: 0,
    },
    rng,
  );
}

// --- Claim legality / execution -----------------------------------------

/** Suits the player currently holds a matching, unblocked, live-set claim for -- UI legality preview. */
export function getLegalPlayerClaimSuits(state: CombatState): SuitId[] {
  const suits = new Set<SuitId>();
  for (const card of state.playerHand) {
    if (card.kind !== 'creature') continue;
    if ((state.blockedSuits[card.suit] ?? 0) > 0) continue;
    if (countPoolSuit(state.pool, card.suit) >= MIN_POOL_SET_SIZE) suits.add(card.suit);
  }
  return Array.from(suits);
}

function isLegalClaim(
  state: CombatState,
  actor: CombatActor,
  suit: SuitId,
  handCardIds: string[],
): boolean {
  if (handCardIds.length === 0) return false;
  const hand = actor === 'player' ? state.playerHand : state.roomHand;
  const uniqueIds = new Set(handCardIds);
  if (uniqueIds.size !== handCardIds.length) return false;
  for (const id of uniqueIds) {
    const card = hand.find((c) => c.id === id);
    if (!card || card.kind !== 'creature' || card.suit !== suit) return false;
  }
  if ((state.blockedSuits[suit] ?? 0) > 0) return false;
  return countPoolSuit(state.pool, suit) >= MIN_POOL_SET_SIZE;
}

/** Guard absorbs incoming Player HP loss before it lands, from any source. */
function absorbDamage(
  playerHP: number,
  playerGuard: number,
  amount: number,
): { playerHP: number; playerGuard: number; absorbed: number } {
  const absorbed = Math.min(playerGuard, amount);
  const throughDamage = amount - absorbed;
  return { playerHP: Math.max(0, playerHP - throughDamage), playerGuard: playerGuard - absorbed, absorbed };
}

function applyClaimEffect(
  state: CombatState,
  actor: CombatActor,
  suit: SuitId,
  magnitude: number,
): CombatState {
  const category = suitCategory(suit);
  let playerHP = state.playerHP;
  let roomThreat = state.roomThreat;
  let playerGuard = state.playerGuard;

  if (category === 'threat' && actor === 'player') {
    roomThreat = Math.max(0, roomThreat - magnitude);
  } else if (category === 'threat' && actor === 'room') {
    const result = absorbDamage(playerHP, playerGuard, magnitude);
    playerHP = result.playerHP;
    playerGuard = result.playerGuard;
  } else if (category === 'boon' && actor === 'player') {
    playerHP = Math.min(state.playerHPMax, playerHP + magnitude);
  } else if (category === 'boon' && actor === 'room') {
    // milder setback, not a symmetric heal
    const regen = Math.round(magnitude * ROOM_BOON_REGEN_FACTOR);
    roomThreat = Math.min(state.roomThreatMax, roomThreat + regen);
  } else if (category === 'guard' && actor === 'player') {
    playerGuard = playerGuard + magnitude;
  }
  // guard claimed by room: no effect -- Ward is a player-exclusive tool,
  // the room's claim just fizzles (see GUARD_SUIT doc comment).

  return { ...state, playerHP, roomThreat, playerGuard };
}

function performClaim(
  state: CombatState,
  actor: CombatActor,
  suit: SuitId,
  handCardIds: string[],
): CombatState {
  const poolSetSize = countPoolSuit(state.pool, suit);
  const magnitude = poolSetSize * handCardIds.length;

  const claimedIdSet = new Set(handCardIds);
  const claimedHandCards = (actor === 'player' ? state.playerHand : state.roomHand).filter((c) =>
    claimedIdSet.has(c.id),
  );
  const claimedPoolCards = state.pool.filter((c) => c.kind === 'creature' && c.suit === suit);
  const nextHand = (actor === 'player' ? state.playerHand : state.roomHand).filter(
    (c) => !claimedIdSet.has(c.id),
  );
  const nextPool = state.pool.filter(
    (c) => !(c.kind === 'creature' && c.suit === suit),
  );

  let next: CombatState = {
    ...state,
    pool: nextPool,
    playerHand: actor === 'player' ? nextHand : state.playerHand,
    roomHand: actor === 'room' ? nextHand : state.roomHand,
  };

  const playerHPBefore = next.playerHP;
  next = applyClaimEffect(next, actor, suit, magnitude);

  const category = suitCategory(suit);
  let effectDesc: string;
  if (category === 'threat' && actor === 'player') {
    effectDesc = `dealing ${magnitude} to Room Threat`;
  } else if (category === 'threat' && actor === 'room') {
    const damageDealt = playerHPBefore - next.playerHP;
    const absorbed = magnitude - damageDealt;
    effectDesc =
      absorbed > 0
        ? `dealing ${magnitude} -- Guard absorbs ${absorbed}, Player takes ${damageDealt}`
        : `dealing ${damageDealt} to Player HP`;
  } else if (category === 'boon' && actor === 'player') {
    effectDesc = `healing ${magnitude} HP`;
  } else if (category === 'boon' && actor === 'room') {
    effectDesc = `regenerating some Room Threat`;
  } else if (category === 'guard' && actor === 'player') {
    effectDesc = `raising Guard to ${next.playerGuard}`;
  } else {
    // guard claimed by room -- Ward is a player-exclusive tool
    effectDesc = `but the room has no use for a Ward -- it fizzles`;
  }
  next = {
    ...next,
    log: [
      ...next.log,
      makeLog(
        next.turnNumber,
        actor,
        'claim',
        `${actor === 'player' ? 'Player' : 'Room'} claims ${suitName(suit)} (set of ${poolSetSize}) with ${handCardIds.length} card(s) -- ${effectDesc}.`,
        {
          playerHP: next.playerHP,
          playerHPMax: next.playerHPMax,
          playerGuard: next.playerGuard,
          roomThreat: next.roomThreat,
          roomThreatMax: next.roomThreatMax,
        },
        { claimSuit: suit, claimedHandCards, claimedPoolCards },
      ),
    ],
  };

  return next;
}

// --- Decay ----------------------------------------------------------------

/**
 * Runs after every turn. Any live pool set left unclaimed for
 * DECAY_TURNS_N consecutive turns auto-resolves as a Player HP penalty.
 * Death is checked after each individual decay resolution, not once per
 * batch, since two sets decaying on the same tick could otherwise let a
 * second penalty "process" after the player is already dead.
 */
function tickDecay(state: CombatState): CombatState {
  const live = new Set(liveSetSuits(state.pool));
  const decayCounters: Partial<Record<SuitId, number>> = {};
  for (const suit of live) {
    decayCounters[suit] = (state.decayCounters[suit] ?? 0) + 1;
  }

  let next: CombatState = { ...state, decayCounters };

  for (const suit of Object.keys(decayCounters) as SuitId[]) {
    if ((decayCounters[suit] ?? 0) < DECAY_TURNS_N) continue;
    if (next.status !== 'active') break;

    const { playerHP, playerGuard, absorbed } = absorbDamage(next.playerHP, next.playerGuard, DECAY_HP_PENALTY);
    const pool = next.pool.filter((c) => !(c.kind === 'creature' && c.suit === suit));
    const nextDecayCounters = { ...next.decayCounters };
    delete nextDecayCounters[suit];
    const decayMessage =
      absorbed > 0
        ? `The ${suitName(suit)} set decays unclaimed -- Guard absorbs ${absorbed}, Player takes ${DECAY_HP_PENALTY - absorbed} damage.`
        : `The ${suitName(suit)} set decays unclaimed -- Player takes ${DECAY_HP_PENALTY} damage.`;

    next = {
      ...next,
      playerHP,
      playerGuard,
      pool,
      decayCounters: nextDecayCounters,
      log: [
        ...next.log,
        makeLog(
          next.turnNumber,
          'system',
          'decay',
          decayMessage,
          { playerHP, playerHPMax: next.playerHPMax, playerGuard, roomThreat: next.roomThreat, roomThreatMax: next.roomThreatMax },
        ),
      ],
    };

    if (playerHP <= 0) {
      next = { ...next, status: 'player-dead' };
    }
  }

  return next;
}

// --- Turn-end bookkeeping ------------------------------------------------

function endTurn(
  state: CombatState,
  rng: Rng,
  handRedrawEachTurn: boolean = HAND_REDRAW_EACH_TURN,
): CombatState {
  if (state.status !== 'active') return state;

  // A claim's own damage (e.g. the room claiming a threat set) can already
  // have dropped the player to 0 before decay/clear checks run below -- must
  // be caught here, not just inside tickDecay's own decay-caused death check,
  // or a lethal room claim could be masked by the room clearing in the same tick.
  if (state.playerHP <= 0) {
    return { ...state, playerHP: 0, status: 'player-dead' };
  }

  let next = tickDecay(state);
  if (next.status !== 'active') return next;

  if (next.roomThreat <= 0) {
    return { ...next, status: 'room-cleared' };
  }

  // A dry pool no longer ends the room for free -- it deals a fresh wave
  // (same room weighting) and the fight continues. Room Threat only ever
  // drops from a player claim, so this keeps a stalled-out pool from handing
  // the player a "win" they never actually earned.
  if (liveSetSuits(next.pool).length === 0) {
    const idPrefix = `refill-t${next.turnNumber}`;
    const snapshot: MeterSnapshot = {
      playerHP: next.playerHP,
      playerHPMax: next.playerHPMax,
      playerGuard: next.playerGuard,
      roomThreat: next.roomThreat,
      roomThreatMax: next.roomThreatMax,
    };
    const freshPool = generateWeightedDeck(
      next.roomParams.poolSize,
      idPrefix,
      {
        dominantSuit: next.roomParams.dominantSuit,
        offSuitPool: THREAT_SUITS.filter((s) => s !== next.roomParams.dominantSuit),
        onSuitRatio: next.roomParams.onSuitRatio,
        boonRatio: next.roomParams.boonRatio,
        guardRatio: next.roomParams.guardRatio,
        surpriseRatio: next.roomParams.surpriseRatio,
      },
      rng,
    );
    const refillLog = [
      ...next.log,
      makeLog(next.turnNumber, 'system', 'pool-refill', 'The pool runs dry -- a fresh wave is dealt.', snapshot),
    ];
    const resolved = resolvePoolSurprises(
      freshPool,
      next.roomParams,
      next.playerHand,
      next.roomHand,
      next.blockedSuits,
      refillLog,
      next.turnNumber,
      rng,
      idPrefix,
      snapshot,
    );
    next = {
      ...next,
      pool: resolved.pool,
      playerHand: resolved.playerHand,
      roomHand: resolved.roomHand,
      blockedSuits: resolved.blockedSuits,
      log: resolved.log,
    };
  }

  // Guard protects "for the next turn": it's granted on the player's turn
  // and expires once the room's following turn has fully resolved (whether
  // or not it absorbed anything), rather than lingering indefinitely. Must
  // check `state.activeTurn` (whose turn is concluding right now), not
  // `next.activeTurn` -- the flip to the new turn hasn't happened yet.
  if (state.activeTurn === 'room' && next.playerGuard > 0) {
    next = {
      ...next,
      playerGuard: 0,
      log: [
        ...next.log,
        makeLog(next.turnNumber, 'system', 'guard-fade', 'Your Guard fades.', {
          playerHP: next.playerHP,
          playerHPMax: next.playerHPMax,
          playerGuard: 0,
          roomThreat: next.roomThreat,
          roomThreatMax: next.roomThreatMax,
        }),
      ],
    };
  }

  const blockedSuits: Partial<Record<SuitId, number>> = {};
  for (const suit of Object.keys(next.blockedSuits) as SuitId[]) {
    const remaining = (next.blockedSuits[suit] ?? 0) - 1;
    if (remaining > 0) blockedSuits[suit] = remaining;
  }

  const newActiveTurn: CombatActor = next.activeTurn === 'player' ? 'room' : 'player';
  const newTurnNumber = next.turnNumber + 1;

  let playerHand = next.playerHand;
  let roomHand = next.roomHand;
  let log = next.log;
  if (handRedrawEachTurn) {
    const idPrefix = `${newActiveTurn}-redraw-t${newTurnNumber}`;
    if (newActiveTurn === 'player') {
      playerHand = drawFreshHand('player', next, rng, idPrefix);
    } else {
      roomHand = drawFreshHand('room', next, rng, idPrefix);
    }
    log = [
      ...log,
      makeLog(newTurnNumber, 'system', 'redraw', `${newActiveTurn === 'player' ? 'Player' : 'Room'} draws a fresh hand.`, {
        playerHP: next.playerHP,
        playerHPMax: next.playerHPMax,
        playerGuard: next.playerGuard,
        roomThreat: next.roomThreat,
        roomThreatMax: next.roomThreatMax,
      }),
    ];
  }

  return {
    ...next,
    playerHand,
    roomHand,
    log,
    blockedSuits,
    activeTurn: newActiveTurn,
    turnNumber: newTurnNumber,
  };
}

// --- Public action dispatch ------------------------------------------------

export function applyCombatAction(
  state: CombatState,
  action: CombatAction,
  rng: Rng,
  handRedrawEachTurn: boolean = HAND_REDRAW_EACH_TURN,
): CombatState {
  if (state.status !== 'active') return state;

  if (action.type === 'PLAYER_CLAIM') {
    if (state.activeTurn !== 'player') return state;
    if (!isLegalClaim(state, 'player', action.suit, action.handCardIds)) return state;
    const claimed = performClaim(state, 'player', action.suit, action.handCardIds);
    return endTurn(claimed, rng, handRedrawEachTurn);
  }

  if (action.type === 'PLAYER_PASS') {
    if (state.activeTurn !== 'player') return state;
    const passed: CombatState = {
      ...state,
      log: [
        ...state.log,
        makeLog(state.turnNumber, 'player', 'pass', 'Player passes.', {
          playerHP: state.playerHP,
          playerHPMax: state.playerHPMax,
          playerGuard: state.playerGuard,
          roomThreat: state.roomThreat,
          roomThreatMax: state.roomThreatMax,
        }),
      ],
    };
    return endTurn(passed, rng, handRedrawEachTurn);
  }

  if (action.type === 'ROOM_TURN') {
    if (state.activeTurn !== 'room') return state;
    const choice = roomAIChooseClaim(state);
    if (!choice) {
      const whiffed: CombatState = {
        ...state,
        log: [
          ...state.log,
          makeLog(state.turnNumber, 'room', 'whiff', 'The room has no claim available and whiffs.', {
            playerHP: state.playerHP,
            playerHPMax: state.playerHPMax,
            playerGuard: state.playerGuard,
            roomThreat: state.roomThreat,
            roomThreatMax: state.roomThreatMax,
          }),
        ],
      };
      return endTurn(whiffed, rng, handRedrawEachTurn);
    }
    const claimed = performClaim(state, 'room', choice.suit, choice.handCardIds);
    return endTurn(claimed, rng, handRedrawEachTurn);
  }

  return state;
}
