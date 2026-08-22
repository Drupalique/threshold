import type { SuitId } from '../types/suits';
import type { Card } from '../types/cards';
import type { EnemyInstance } from '../types/enemy';
import type { RoomInstance } from '../types/room';
import type {
  CombatAction,
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
import { currentIntent } from './roomIntent';
import {
  SUIT_DEFINITIONS,
  DECAY_TURNS_N,
  SURPRISE_BLOCK_DURATION_TURNS,
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
}

function snapshotOf(state: CombatState): MeterSnapshot {
  return { playerHP: state.playerHP, playerHPMax: state.playerHPMax, playerGuard: state.playerGuard };
}

let logCounter = 0;
function makeLog(
  turn: number,
  actor: LogEntry['actor'],
  type: string,
  message: string,
  snapshot: MeterSnapshot,
): LogEntry {
  return { id: `log-${logCounter++}`, turn, actor, type, message, ...snapshot };
}

function countPoolSetSize(pool: Card[], suit: SuitId): number {
  return pool.filter((c) => c.suit === suit).length;
}

interface LiveSet {
  suit: SuitId;
  size: number;
}

function liveSets(pool: Card[]): LiveSet[] {
  const map = new Map<SuitId, number>();
  for (const c of pool) map.set(c.suit, (map.get(c.suit) ?? 0) + 1);
  return Array.from(map.entries())
    .map(([suit, size]) => ({ suit, size }))
    .filter((s) => s.size >= MIN_POOL_SET_SIZE);
}

/** Absorbs incoming HP loss with `guard` before it lands -- reused for both the player and any enemy. */
function absorbDamage(
  hp: number,
  guard: number,
  amount: number,
): { hp: number; guard: number; absorbed: number } {
  const absorbed = Math.min(guard, amount);
  const throughDamage = amount - absorbed;
  return { hp: Math.max(0, hp - throughDamage), guard: guard - absorbed, absorbed };
}

function updateEnemy(
  state: CombatState,
  instanceId: string,
  fn: (e: EnemyInstance) => EnemyInstance,
): CombatState {
  return { ...state, enemies: state.enemies.map((e) => (e.instanceId === instanceId ? fn(e) : e)) };
}

// --- Round initialization ---------------------------------------------

export function initCombat(
  room: RoomInstance,
  _rng: Rng,
  playerHP: number,
  playerHPMax: number,
): CombatState {
  const snapshot: MeterSnapshot = { playerHP, playerHPMax, playerGuard: 0 };
  const enemyList = room.enemies.map((e) => `${e.name} (${e.hp} HP)`).join(', ');

  return {
    pool: room.pool,
    playerHand: room.playerHandDeal,
    roomParams: room.params,
    enemies: room.enemies,
    activeEnemyIndex: 0,
    playerHP,
    playerHPMax,
    playerGuard: 0,
    playerWeakenPct: 0,
    turnNumber: 1,
    activeTurn: 'player',
    decayCounters: {},
    blockedSuits: {},
    log: [makeLog(0, 'system', 'round-start', `Threat looms: ${enemyList}. The pool is set.`, snapshot)],
    status: 'active',
  };
}

/** Draws a brand new player hand, weighted toward the room's own threat suits. */
function drawFreshHand(state: CombatState, rng: Rng, idPrefix: string): Card[] {
  const params = state.roomParams;
  return generateWeightedDeck(
    params.playerHandSize,
    idPrefix,
    {
      onSuitTargets: params.threatSuits,
      onSuitRatio: params.onSuitRatio,
      boonRatio: params.boonRatio,
      guardRatio: params.guardRatio,
    },
    rng,
  );
}

// --- Claim legality / execution -----------------------------------------

export interface LegalClaimTarget {
  suit: SuitId;
  targetInstanceId?: string;
  poolSetSize: number;
}

/** Every (suit, target) pair the player currently holds a matching, unblocked, live claim for -- UI legality preview. */
export function getLegalPlayerClaimTargets(state: CombatState): LegalClaimTarget[] {
  const suits = new Set<SuitId>();
  for (const card of state.playerHand) suits.add(card.suit);

  const targets: LegalClaimTarget[] = [];
  for (const suit of suits) {
    if ((state.blockedSuits[suit] ?? 0) > 0) continue;
    const size = countPoolSetSize(state.pool, suit);
    if (size < MIN_POOL_SET_SIZE) continue;
    if (suitCategory(suit) === 'threat') {
      // A threat pile isn't owned by any enemy -- every alive enemy is a
      // legal, independent target for the same pile (design doc 4.8).
      for (const enemy of state.enemies) {
        targets.push({ suit, targetInstanceId: enemy.instanceId, poolSetSize: size });
      }
    } else {
      targets.push({ suit, poolSetSize: size });
    }
  }
  return targets;
}

function isLegalClaim(
  state: CombatState,
  suit: SuitId,
  targetInstanceId: string | undefined,
  handCardIds: string[],
): boolean {
  if (handCardIds.length === 0) return false;
  const uniqueIds = new Set(handCardIds);
  if (uniqueIds.size !== handCardIds.length) return false;
  for (const id of uniqueIds) {
    const card = state.playerHand.find((c) => c.id === id);
    if (!card || card.suit !== suit) return false;
  }
  if ((state.blockedSuits[suit] ?? 0) > 0) return false;

  const category = suitCategory(suit);
  if (category === 'threat') {
    if (!targetInstanceId) return false;
    if (!state.enemies.some((e) => e.instanceId === targetInstanceId)) return false;
    return countPoolSetSize(state.pool, suit) >= MIN_POOL_SET_SIZE;
  }
  return countPoolSetSize(state.pool, suit) >= MIN_POOL_SET_SIZE;
}

function performClaim(
  state: CombatState,
  suit: SuitId,
  targetInstanceId: string | undefined,
  handCardIds: string[],
): CombatState {
  const category = suitCategory(suit);
  const poolSetSize = countPoolSetSize(state.pool, suit);
  const rawMagnitude = poolSetSize * handCardIds.length;
  const weakenPct = category === 'threat' ? state.playerWeakenPct : 0;
  const magnitude = weakenPct > 0 ? Math.max(0, Math.round(rawMagnitude * (1 - weakenPct))) : rawMagnitude;

  const claimedIdSet = new Set(handCardIds);
  const nextHand = state.playerHand.filter((c) => !claimedIdSet.has(c.id));
  const nextPool = state.pool.filter((c) => c.suit !== suit);

  let next: CombatState = { ...state, pool: nextPool, playerHand: nextHand };

  let effectDesc: string;
  let enemyName: string | undefined;

  if (category === 'threat') {
    const enemy = next.enemies.find((e) => e.instanceId === targetInstanceId)!;
    enemyName = enemy.name;
    const result = absorbDamage(enemy.hp, enemy.guard, magnitude);
    const dealt = enemy.hp - result.hp;
    const survives = result.hp > 0;
    next = {
      ...next,
      enemies: survives
        ? next.enemies.map((e) => (e.instanceId === enemy.instanceId ? { ...e, hp: result.hp, guard: result.guard } : e))
        : next.enemies.filter((e) => e.instanceId !== enemy.instanceId),
    };
    effectDesc =
      result.absorbed > 0
        ? `dealing ${magnitude} -- Guard absorbs ${result.absorbed}, ${dealt} gets through`
        : `dealing ${dealt} to ${enemy.name}`;
    if (!survives) effectDesc += ` -- ${enemy.name} is defeated!`;
  } else if (category === 'boon') {
    next = { ...next, playerHP: Math.min(state.playerHPMax, next.playerHP + magnitude) };
    effectDesc = `healing ${magnitude} HP`;
  } else {
    next = { ...next, playerGuard: next.playerGuard + magnitude };
    effectDesc = `raising Guard to ${next.playerGuard}`;
  }

  const weakenNote = weakenPct > 0 ? ` (weakened -${Math.round(weakenPct * 100)}%)` : '';
  next = {
    ...next,
    log: [
      ...next.log,
      makeLog(
        next.turnNumber,
        'player',
        'claim',
        `Player claims ${suitName(suit)}${enemyName ? ` from ${enemyName}` : ''} (set of ${poolSetSize}) with ${handCardIds.length} card(s)${weakenNote} -- ${effectDesc}.`,
        snapshotOf(next),
      ),
    ],
  };

  return next;
}

// --- Enemy turn resolution -----------------------------------------------

function resolveEnemyTurn(state: CombatState, rng: Rng): CombatState {
  const enemy = state.enemies[state.activeEnemyIndex];
  const step = currentIntent(enemy);
  let next = state;
  let message: string;

  switch (step.type) {
    case 'attack': {
      const magnitude = step.magnitude ?? 0;
      const result = absorbDamage(next.playerHP, next.playerGuard, magnitude);
      const dealt = next.playerHP - result.hp;
      next = { ...next, playerHP: result.hp, playerGuard: result.guard };
      message =
        result.absorbed > 0
          ? `${enemy.name} attacks for ${magnitude} -- Guard absorbs ${result.absorbed}, you take ${dealt}.`
          : `${enemy.name} attacks for ${dealt}.`;
      break;
    }
    case 'guard': {
      const magnitude = step.magnitude ?? 0;
      next = updateEnemy(next, enemy.instanceId, (e) => ({ ...e, guard: e.guard + magnitude }));
      message = `${enemy.name} raises its guard by ${magnitude}.`;
      break;
    }
    case 'heal': {
      const magnitude = step.magnitude ?? 0;
      const before = enemy.hp;
      next = updateEnemy(next, enemy.instanceId, (e) => ({ ...e, hp: Math.min(e.hpMax, e.hp + magnitude) }));
      const healed = next.enemies.find((e) => e.instanceId === enemy.instanceId)!.hp - before;
      message = `${enemy.name} recovers ${healed} HP.`;
      break;
    }
    case 'debuff': {
      const pct = step.magnitude ?? 0;
      next = { ...next, playerWeakenPct: pct };
      message = `${enemy.name} weakens you -- your next claim deals ${Math.round(pct * 100)}% less.`;
      break;
    }
    case 'corrupt': {
      switch (step.corruptEffect) {
        case 'add-cards': {
          next = {
            ...next,
            pool: resolveAddCards(next.pool, next.roomParams.threatSuits, rng, `corrupt-add-t${next.turnNumber}`),
          };
          message = `${enemy.name} calls in reinforcements -- the pool grows.`;
          break;
        }
        case 'block-suit': {
          const suit = resolveBlockSuit(next.pool, rng);
          if (suit) {
            next = { ...next, blockedSuits: { ...next.blockedSuits, [suit]: SURPRISE_BLOCK_DURATION_TURNS } };
            message = `${enemy.name} blocks ${suitName(suit)} for ${SURPRISE_BLOCK_DURATION_TURNS} turn(s).`;
          } else {
            message = `${enemy.name} tries to disrupt the pool, but finds nothing to block.`;
          }
          break;
        }
        case 'force-discard': {
          const result = resolveForceDiscard(next.playerHand, rng);
          next = { ...next, playerHand: result.playerHand };
          message = result.discardedCardId
            ? `${enemy.name} forces you to discard a card.`
            : `${enemy.name} tries to force a discard, but your hand is empty.`;
          break;
        }
        default:
          message = `${enemy.name} stirs the pool.`;
      }
      break;
    }
  }

  next = updateEnemy(next, enemy.instanceId, (e) => ({ ...e, patternIndex: e.patternIndex + 1 }));
  next = { ...next, log: [...next.log, makeLog(next.turnNumber, 'enemy', step.type, message, snapshotOf(next))] };

  if (next.playerHP <= 0) {
    next = { ...next, status: 'player-dead' };
  }

  return next;
}

// --- Decay ----------------------------------------------------------------

/**
 * Runs after every turn. Any live pool set (keyed by suit -- pool sets are
 * not owned by any enemy, see design doc 4.8) left unclaimed for
 * DECAY_TURNS_N consecutive turns auto-resolves for free: the pile's own
 * suit effect fires at magnitude equal to just its own size (the claim
 * formula's "x hand cards played" term is always 1 here -- nobody committed
 * a hand to it), and it lands on EVERY entity in the room -- the player and
 * every alive enemy alike. This is deliberate: claiming a pile is what lets
 * you choose a target and multiply the effect by your hand; leaving it to
 * decay is untargeted and unmultiplied, and can help enemies as easily as
 * hurt them (a decaying boon pile heals them too) -- that asymmetry is
 * the whole point of claiming promptly. Death is checked after each
 * individual decay resolution, not once per batch, since two sets decaying
 * on the same tick could otherwise let a second penalty "process" after the
 * player is already dead; a decay that wipes out the last enemy is likewise
 * checked for by the room-cleared logic in endTurn once tickDecay returns.
 */
function tickDecay(state: CombatState): CombatState {
  const live = liveSets(state.pool);
  const decayCounters: Partial<Record<SuitId, number>> = {};
  for (const set of live) {
    decayCounters[set.suit] = (state.decayCounters[set.suit] ?? 0) + 1;
  }

  let next: CombatState = { ...state, decayCounters };

  for (const set of live) {
    if ((decayCounters[set.suit] ?? 0) < DECAY_TURNS_N) continue;
    if (next.status !== 'active') break;

    const magnitude = set.size;
    const category = suitCategory(set.suit);
    const pool = next.pool.filter((c) => c.suit !== set.suit);
    const nextDecayCounters = { ...next.decayCounters };
    delete nextDecayCounters[set.suit];

    let playerHP = next.playerHP;
    let playerGuard = next.playerGuard;
    let enemies = next.enemies;
    const parts: string[] = [];

    if (category === 'threat') {
      const result = absorbDamage(playerHP, playerGuard, magnitude);
      const dealt = playerHP - result.hp;
      playerHP = result.hp;
      playerGuard = result.guard;
      parts.push(result.absorbed > 0 ? `you take ${dealt} (Guard absorbs ${result.absorbed})` : `you take ${dealt}`);

      enemies = enemies.flatMap((e) => {
        const r = absorbDamage(e.hp, e.guard, magnitude);
        const dealtToEnemy = e.hp - r.hp;
        const survives = r.hp > 0;
        parts.push(
          `${e.name} takes ${dealtToEnemy}${r.absorbed > 0 ? ` (Guard absorbs ${r.absorbed})` : ''}${survives ? '' : ' -- defeated!'}`,
        );
        return survives ? [{ ...e, hp: r.hp, guard: r.guard }] : [];
      });
    } else if (category === 'boon') {
      const playerHealed = Math.min(next.playerHPMax - playerHP, magnitude);
      playerHP += playerHealed;
      parts.push(`you heal ${playerHealed}`);
      enemies = enemies.map((e) => {
        const healed = Math.min(e.hpMax - e.hp, magnitude);
        parts.push(`${e.name} heals ${healed}`);
        return { ...e, hp: e.hp + healed };
      });
    } else {
      playerGuard += magnitude;
      parts.push(`you gain ${magnitude} Guard`);
      enemies = enemies.map((e) => {
        parts.push(`${e.name} gains ${magnitude} Guard`);
        return { ...e, guard: e.guard + magnitude };
      });
    }

    const decayMessage = `The ${suitName(set.suit)} pile (${magnitude}) decays unclaimed -- it hits every entity in the room: ${parts.join(', ')}.`;

    next = {
      ...next,
      playerHP,
      playerGuard,
      enemies,
      pool,
      decayCounters: nextDecayCounters,
      log: [
        ...next.log,
        makeLog(next.turnNumber, 'system', 'decay', decayMessage, {
          playerHP,
          playerHPMax: next.playerHPMax,
          playerGuard,
        }),
      ],
    };

    if (playerHP <= 0) {
      next = { ...next, status: 'player-dead' };
    }
  }

  return next;
}

// --- Turn-end bookkeeping ------------------------------------------------

function decrementBlocked(blockedSuits: Partial<Record<SuitId, number>>): Partial<Record<SuitId, number>> {
  const next: Partial<Record<SuitId, number>> = {};
  for (const suit of Object.keys(blockedSuits) as SuitId[]) {
    const remaining = (blockedSuits[suit] ?? 0) - 1;
    if (remaining > 0) next[suit] = remaining;
  }
  return next;
}

/**
 * Shared tail for every actor action (player claim/pass, or a single
 * enemy's turn). Pool-refill/blocked-suit countdown run after every
 * individual action; decay, Guard-fade, hand redraw, and the activeTurn
 * flip only run once the whole enemy phase concludes -- decay counts
 * DECAY_TURNS_N *rounds* (the player plus every alive enemy acting once),
 * not individual actor sub-turns, so a multi-enemy room can't blow through
 * the countdown in a single round just because more actors acted.
 */
function endTurn(
  state: CombatState,
  rng: Rng,
  handRedrawEachTurn: boolean = HAND_REDRAW_EACH_TURN,
): CombatState {
  if (state.status !== 'active') return state;

  // A claim or an enemy attack can already have dropped the player to 0
  // before decay/clear checks run below -- must be caught here, not just
  // inside tickDecay's own death check, or a lethal hit could be masked by
  // the room clearing in the same tick.
  if (state.playerHP <= 0) {
    return { ...state, playerHP: 0, status: 'player-dead' };
  }

  // A claim can already have wiped the last enemy before decay/clear checks
  // run below -- must be caught here independently of tickDecay, since decay
  // itself no longer runs on every call.
  if (state.enemies.length === 0) {
    return { ...state, status: 'room-cleared' };
  }

  const isRoundEnd = state.activeTurn === 'enemy' && state.activeEnemyIndex + 1 >= state.enemies.length;

  // Decay only resolves once the whole round (the player, then every alive
  // enemy) has acted -- see docstring. Guard fades first when that happens,
  // so a decaying Ward pile's fresh Guard grant isn't wiped by this same
  // round's fade a few lines down.
  let next: CombatState = state;
  if (isRoundEnd) {
    if (next.playerGuard > 0) {
      next = {
        ...next,
        playerGuard: 0,
        log: [
          ...next.log,
          makeLog(next.turnNumber, 'system', 'guard-fade', 'Your Guard fades.', {
            playerHP: next.playerHP,
            playerHPMax: next.playerHPMax,
            playerGuard: 0,
          }),
        ],
      };
    }

    next = tickDecay(next);
    if (next.status !== 'active') return next;

    if (next.enemies.length === 0) {
      return { ...next, status: 'room-cleared' };
    }
  }

  // A dry pool no longer ends the room for free -- it deals a fresh wave
  // (same enemy-owned weighting) and the fight continues.
  if (liveSets(next.pool).length === 0) {
    const idPrefix = `refill-t${next.turnNumber}`;
    const freshPool = generateWeightedDeck(
      next.roomParams.poolSize,
      idPrefix,
      {
        onSuitTargets: next.roomParams.threatSuits,
        onSuitRatio: next.roomParams.onSuitRatio,
        boonRatio: next.roomParams.boonRatio,
        guardRatio: next.roomParams.guardRatio,
      },
      rng,
    );
    next = {
      ...next,
      pool: freshPool,
      log: [...next.log, makeLog(next.turnNumber, 'system', 'pool-refill', 'The pool runs dry -- a fresh wave is dealt.', snapshotOf(next))],
    };
  }

  if (state.activeTurn === 'player') {
    // Player's turn just ended -- this is the only point a block's
    // countdown ticks (a block set mid-enemy-phase must survive intact
    // through to the player's next turn, not get decremented away in the
    // very same endTurn call that just created it). Weaken expires here
    // too, whether or not it was used, and the enemy phase begins at index 0.
    return {
      ...next,
      blockedSuits: decrementBlocked(next.blockedSuits),
      activeTurn: 'enemy',
      activeEnemyIndex: 0,
      turnNumber: next.turnNumber + 1,
      playerWeakenPct: 0,
    };
  }

  if (!isRoundEnd) {
    return {
      ...next,
      activeEnemyIndex: state.activeEnemyIndex + 1,
      turnNumber: next.turnNumber + 1,
    };
  }

  // The whole enemy phase just concluded -- hand redraws, control returns to
  // the player.
  const newTurnNumber = next.turnNumber + 1;
  let playerHand = next.playerHand;
  if (handRedrawEachTurn) {
    playerHand = drawFreshHand(next, rng, `player-redraw-t${newTurnNumber}`);
    next = {
      ...next,
      log: [
        ...next.log,
        makeLog(newTurnNumber, 'system', 'redraw', 'Player draws a fresh hand.', {
          playerHP: next.playerHP,
          playerHPMax: next.playerHPMax,
          playerGuard: next.playerGuard,
        }),
      ],
    };
  }

  return {
    ...next,
    playerHand,
    activeTurn: 'player',
    activeEnemyIndex: 0,
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
    if (!isLegalClaim(state, action.suit, action.targetInstanceId, action.handCardIds)) return state;
    const claimed = performClaim(state, action.suit, action.targetInstanceId, action.handCardIds);
    return endTurn(claimed, rng, handRedrawEachTurn);
  }

  if (action.type === 'PLAYER_PASS') {
    if (state.activeTurn !== 'player') return state;
    const passed: CombatState = {
      ...state,
      log: [...state.log, makeLog(state.turnNumber, 'player', 'pass', 'Player passes.', snapshotOf(state))],
    };
    return endTurn(passed, rng, handRedrawEachTurn);
  }

  if (action.type === 'ENEMY_TURN') {
    if (state.activeTurn !== 'enemy') return state;
    const resolved = resolveEnemyTurn(state, rng);
    return endTurn(resolved, rng, handRedrawEachTurn);
  }

  return state;
}
