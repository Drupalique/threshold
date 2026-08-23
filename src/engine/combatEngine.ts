import type { SuitId, SuitCategory } from '../types/suits';
import type { Card } from '../types/cards';
import { isCreatureCard } from '../types/cards';
import type { EnemyInstance } from '../types/enemy';
import type { RoomInstance } from '../types/room';
import type { StatusId } from '../types/status';
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
import { addStacks, stacksOf, tickStatuses, withStrength, withWeaken } from './statusEffects';
import { STATUS_DEFS } from '../types/status';
import {
  SUIT_DEFINITIONS,
  DECAY_TURNS_N,
  SURPRISE_BLOCK_DURATION_TURNS,
  HAND_REDRAW_EACH_TURN,
  MIN_POOL_SET_SIZE,
  WEAKEN_PCT_PER_STACK,
  PLAYS_PER_TURN_BASE,
  QUAKE_CARD_RATIO,
} from '../config/constants';

const suitCategory = (suit: SuitId) =>
  SUIT_DEFINITIONS.find((s) => s.id === suit)!.category;
const suitName = (suit: SuitId) => SUIT_DEFINITIONS.find((s) => s.id === suit)!.name;

// Categories that act on an enemy the player picks, mirroring "threat" --
// Hex/Venom apply their status to a chosen target the same way a threat pile
// deals damage to one. Every other category (boon, guard, and the
// self-targeting strength/Vigor suit) has no target at all.
export function requiresEnemyTarget(category: SuitCategory): boolean {
  return category === 'threat' || category === 'weaken' || category === 'poison';
}

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
  return pool.filter((c) => isCreatureCard(c) && c.suit === suit).length;
}

interface LiveSet {
  suit: SuitId;
  size: number;
}

function liveSets(pool: Card[]): LiveSet[] {
  const map = new Map<SuitId, number>();
  for (const c of pool) {
    if (!isCreatureCard(c)) continue;
    map.set(c.suit, (map.get(c.suit) ?? 0) + 1);
  }
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
    playerStatuses: {},
    turnNumber: 1,
    activeTurn: 'player',
    playsRemaining: PLAYS_PER_TURN_BASE,
    unlimitedPlaysThisTurn: false,
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
      weakenRatio: params.weakenRatio,
      poisonRatio: params.poisonRatio,
      strengthRatio: params.strengthRatio,
      quakeRatio: QUAKE_CARD_RATIO,
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
  // No plays left this turn (and no Quake card in play to lift the cap) --
  // every claim is illegal until the player passes.
  if (state.playsRemaining <= 0 && !state.unlimitedPlaysThisTurn) return [];

  const suits = new Set<SuitId>();
  for (const card of state.playerHand) {
    if (card.kind !== 'creature') continue;
    suits.add(card.suit);
  }

  const targets: LegalClaimTarget[] = [];
  for (const suit of suits) {
    if ((state.blockedSuits[suit] ?? 0) > 0) continue;
    const size = countPoolSetSize(state.pool, suit);
    if (size < MIN_POOL_SET_SIZE) continue;
    if (requiresEnemyTarget(suitCategory(suit))) {
      // A threat/hex/venom pile isn't owned by any enemy -- every alive
      // enemy is a legal, independent target for the same pile (design doc
      // 4.8, extended to the status suits in 4.9).
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
  if (state.playsRemaining <= 0 && !state.unlimitedPlaysThisTurn) return false;
  if (handCardIds.length === 0) return false;
  const uniqueIds = new Set(handCardIds);
  if (uniqueIds.size !== handCardIds.length) return false;
  for (const id of uniqueIds) {
    const card = state.playerHand.find((c) => c.id === id);
    if (!card || card.kind !== 'creature' || card.suit !== suit) return false;
  }
  if ((state.blockedSuits[suit] ?? 0) > 0) return false;

  const category = suitCategory(suit);
  if (requiresEnemyTarget(category)) {
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
  const isThreat = category === 'threat';
  // Strength/Weaken only apply to threat claims -- boon/guard claims aren't
  // "attacks," so the player's own combat stacks don't touch them.
  const strengthStacks = isThreat ? stacksOf(state.playerStatuses, 'strength') : 0;
  const weakenStacks = isThreat ? stacksOf(state.playerStatuses, 'weaken') : 0;
  const boostedBase = isThreat ? withStrength(poolSetSize, state.playerStatuses) : poolSetSize;
  const rawMagnitude = boostedBase * handCardIds.length;
  const magnitude = isThreat ? withWeaken(rawMagnitude, state.playerStatuses, WEAKEN_PCT_PER_STACK) : rawMagnitude;

  const claimedIdSet = new Set(handCardIds);
  const nextHand = state.playerHand.filter((c) => !claimedIdSet.has(c.id));
  const nextPool = state.pool.filter((c) => !isCreatureCard(c) || c.suit !== suit);

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
  } else if (category === 'guard') {
    next = { ...next, playerGuard: next.playerGuard + magnitude };
    effectDesc = `raising Guard to ${next.playerGuard}`;
  } else if (category === 'weaken' || category === 'poison') {
    // Hex/Venom: the player inflicts their own status stacks on a chosen
    // enemy, resolved by the exact same addStacks the enemy's own
    // Debuff/Poison intents use (see engine/statusEffects.ts) -- just
    // pointed the other direction.
    const enemy = next.enemies.find((e) => e.instanceId === targetInstanceId)!;
    enemyName = enemy.name;
    next = updateEnemy(next, enemy.instanceId, (e) => ({
      ...e,
      statuses: addStacks(e.statuses, category, magnitude),
    }));
    const totalStacks = stacksOf(
      next.enemies.find((e) => e.instanceId === enemy.instanceId)!.statuses,
      category,
    );
    effectDesc = `inflicting +${magnitude} ${STATUS_DEFS[category].name} on ${enemy.name} (${totalStacks} stack${totalStacks === 1 ? '' : 's'})`;
  } else {
    // Vigor: the player buffs themself, mirroring the enemy's own Strength
    // intent (see engine/statusEffects.ts).
    next = { ...next, playerStatuses: addStacks(next.playerStatuses, 'strength', magnitude) };
    const totalStacks = stacksOf(next.playerStatuses, 'strength');
    effectDesc = `gaining +${magnitude} Strength (${totalStacks} stack${totalStacks === 1 ? '' : 's'})`;
  }

  const weakenNote =
    weakenStacks > 0
      ? ` (weakened -${Math.round(Math.min(1, weakenStacks * WEAKEN_PCT_PER_STACK) * 100)}% from ${weakenStacks} stack${weakenStacks === 1 ? '' : 's'})`
      : '';
  const strengthNote = strengthStacks > 0 ? ` (+${strengthStacks} from Strength)` : '';
  next = {
    ...next,
    log: [
      ...next.log,
      makeLog(
        next.turnNumber,
        'player',
        'claim',
        `Player claims ${suitName(suit)}${enemyName ? ` from ${enemyName}` : ''} (set of ${poolSetSize}) with ${handCardIds.length} card(s)${weakenNote}${strengthNote} -- ${effectDesc}.`,
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
      const baseMagnitude = withStrength(step.magnitude ?? 0, enemy.statuses);
      const magnitude = withWeaken(baseMagnitude, enemy.statuses, WEAKEN_PCT_PER_STACK);
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
      const stacks = step.magnitude ?? 0;
      next = { ...next, playerStatuses: addStacks(next.playerStatuses, 'weaken', stacks) };
      const totalStacks = stacksOf(next.playerStatuses, 'weaken');
      message = `${enemy.name} weakens you -- +${stacks} Weaken (${totalStacks} stack${totalStacks === 1 ? '' : 's'}, -${Math.round(Math.min(1, totalStacks * WEAKEN_PCT_PER_STACK) * 100)}% claims).`;
      break;
    }
    case 'poison': {
      const stacks = step.magnitude ?? 0;
      next = { ...next, playerStatuses: addStacks(next.playerStatuses, 'poison', stacks) };
      const totalStacks = stacksOf(next.playerStatuses, 'poison');
      message = `${enemy.name} poisons you -- +${stacks} Poison (${totalStacks} stack${totalStacks === 1 ? '' : 's'}).`;
      break;
    }
    case 'strength': {
      const stacks = step.magnitude ?? 0;
      next = updateEnemy(next, enemy.instanceId, (e) => ({ ...e, statuses: addStacks(e.statuses, 'strength', stacks) }));
      const totalStacks = stacksOf(next.enemies.find((e) => e.instanceId === enemy.instanceId)!.statuses, 'strength');
      message = `${enemy.name} hardens itself -- +${stacks} Strength (${totalStacks} stack${totalStacks === 1 ? '' : 's'}).`;
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

  // Tick this enemy's own statuses once, at the true end of its own turn --
  // same cadence its pattern index advances at, and (per statusEffects.ts)
  // the same phase-boundary discipline decayCounters/blockedSuits already
  // follow: once per actor turn, never per sub-effect within it. A Poison
  // tick can drop this enemy to 0 HP; it's left in the array as a "corpse"
  // rather than removed here -- removing it now would shrink `enemies` and
  // desync activeEnemyIndex against enemies still owed a turn this round
  // (see endTurn's round-end sweep, the one safe place to actually drop it).
  const postStep = next.enemies.find((e) => e.instanceId === enemy.instanceId)!;
  const { statuses: tickedStatuses, poisonDamage } = tickStatuses(postStep.statuses);
  let tickedHp = postStep.hp;
  let tickedGuard = postStep.guard;
  let poisonMessage = '';
  if (poisonDamage > 0) {
    const result = absorbDamage(tickedHp, tickedGuard, poisonDamage);
    const dealt = tickedHp - result.hp;
    tickedHp = result.hp;
    tickedGuard = result.guard;
    poisonMessage =
      result.absorbed > 0
        ? ` ${enemy.name}'s poison deals ${poisonDamage} -- Guard absorbs ${result.absorbed}, ${dealt} gets through.`
        : ` ${enemy.name}'s poison deals ${dealt}.`;
    if (tickedHp <= 0) poisonMessage += ` ${enemy.name} is defeated!`;
  }

  next = updateEnemy(next, enemy.instanceId, (e) => ({
    ...e,
    hp: tickedHp,
    guard: tickedGuard,
    statuses: tickedStatuses,
    patternIndex: e.patternIndex + 1,
  }));
  next = {
    ...next,
    log: [...next.log, makeLog(next.turnNumber, 'enemy', step.type, `${message}${poisonMessage}`, snapshotOf(next))],
  };

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
    const pool = next.pool.filter((c) => !isCreatureCard(c) || c.suit !== set.suit);
    const nextDecayCounters = { ...next.decayCounters };
    delete nextDecayCounters[set.suit];

    let playerHP = next.playerHP;
    let playerGuard = next.playerGuard;
    let playerStatuses = next.playerStatuses;
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
    } else if (category === 'guard') {
      playerGuard += magnitude;
      parts.push(`you gain ${magnitude} Guard`);
      enemies = enemies.map((e) => {
        parts.push(`${e.name} gains ${magnitude} Guard`);
        return { ...e, guard: e.guard + magnitude };
      });
    } else {
      // Hex/Venom/Vigor decay: same "hits everyone, untargeted" symmetry as
      // threat/boon/guard above -- a Poison pile left to decay poisons the
      // player as much as every enemy, exactly like a decaying threat pile
      // damages both alike.
      const statusId: StatusId = category;
      const statusLabel = STATUS_DEFS[statusId].name;
      playerStatuses = addStacks(playerStatuses, statusId, magnitude);
      parts.push(`you gain +${magnitude} ${statusLabel}`);
      enemies = enemies.map((e) => {
        parts.push(`${e.name} gains +${magnitude} ${statusLabel}`);
        return { ...e, statuses: addStacks(e.statuses, statusId, magnitude) };
      });
    }

    const decayMessage = `The ${suitName(set.suit)} pile (${magnitude}) decays unclaimed -- it hits every entity in the room: ${parts.join(', ')}.`;

    next = {
      ...next,
      playerHP,
      playerGuard,
      playerStatuses,
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
  // True when a just-resolved PLAYER_CLAIM left the player with more plays
  // this turn (or unlimited plays are active) -- skips the player-turn-end
  // machinery below (status ticks, blocked-suit countdown, the flip to the
  // enemy phase) so the same player turn simply continues. Never set for
  // PLAYER_PASS or ENEMY_TURN, which always end their actor's turn outright.
  continuePlayerTurn: boolean = false,
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

    // A Poison tick during this enemy phase can have left a 0-HP "corpse" in
    // the array (see resolveEnemyTurn) -- round-end is the first safe point
    // to actually drop it, since activeEnemyIndex arithmetic during the
    // phase assumes the array only shrinks between rounds.
    if (next.enemies.some((e) => e.hp <= 0)) {
      next = { ...next, enemies: next.enemies.filter((e) => e.hp > 0) };
    }

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
        weakenRatio: next.roomParams.weakenRatio,
        poisonRatio: next.roomParams.poisonRatio,
        strengthRatio: next.roomParams.strengthRatio,
      },
      rng,
    );
    next = {
      ...next,
      pool: freshPool,
      log: [...next.log, makeLog(next.turnNumber, 'system', 'pool-refill', 'The pool runs dry -- a fresh wave is dealt.', snapshotOf(next))],
    };
  }

  if (state.activeTurn === 'player' && continuePlayerTurn) {
    // The just-resolved claim left plays remaining (or unlimited plays are
    // active) -- the player's turn isn't over, so none of the turn-end
    // machinery below (status ticks, blocked-suit countdown, the flip to
    // the enemy phase) runs yet. Only the dry-pool refill above still
    // applies mid-turn.
    return next;
  }

  if (state.activeTurn === 'player') {
    // Player's turn just ended -- this is the only point a block's
    // countdown ticks (a block set mid-enemy-phase must survive intact
    // through to the player's next turn, not get decremented away in the
    // very same endTurn call that just created it). The player's own
    // statuses tick here too, whether or not they were used this turn: a
    // Poison stack deals its damage now, then every stack decays by 1, and
    // the enemy phase begins at index 0.
    const { statuses: tickedStatuses, poisonDamage } = tickStatuses(next.playerStatuses);
    let playerHP = next.playerHP;
    let playerGuard = next.playerGuard;
    let log = next.log;
    if (poisonDamage > 0) {
      const result = absorbDamage(playerHP, playerGuard, poisonDamage);
      const dealt = playerHP - result.hp;
      playerHP = result.hp;
      playerGuard = result.guard;
      log = [
        ...log,
        makeLog(
          next.turnNumber,
          'system',
          'poison',
          result.absorbed > 0
            ? `Poison deals ${poisonDamage} -- Guard absorbs ${result.absorbed}, you take ${dealt}.`
            : `Poison deals ${dealt}.`,
          { playerHP, playerHPMax: next.playerHPMax, playerGuard },
        ),
      ];
    }

    if (playerHP <= 0) {
      return { ...next, playerHP: 0, playerGuard, playerStatuses: tickedStatuses, log, status: 'player-dead' };
    }

    return {
      ...next,
      playerHP,
      playerGuard,
      playerStatuses: tickedStatuses,
      log,
      blockedSuits: decrementBlocked(next.blockedSuits),
      activeTurn: 'enemy',
      activeEnemyIndex: 0,
      turnNumber: next.turnNumber + 1,
      // Plays only matter during the player's own turn -- cleared here so a
      // stray Quake effect can't leak into bookkeeping across the enemy
      // phase; both are reset properly when control returns to the player
      // below.
      playsRemaining: 0,
      unlimitedPlaysThisTurn: false,
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
    // A fresh player turn -- reset the plays budget (see
    // CombatState.playsRemaining's doc comment for the future relic/buff
    // hook point) and clear any unlimited-plays grant from the prior turn.
    playsRemaining: PLAYS_PER_TURN_BASE,
    unlimitedPlaysThisTurn: false,
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
    let claimed = performClaim(state, action.suit, action.targetInstanceId, action.handCardIds);
    // Unlimited plays (Quake) never spend down; otherwise this claim spends
    // exactly one of the turn's plays regardless of how many hand cards it
    // used.
    if (!claimed.unlimitedPlaysThisTurn) {
      claimed = { ...claimed, playsRemaining: claimed.playsRemaining - 1 };
    }
    const turnContinues = claimed.unlimitedPlaysThisTurn || claimed.playsRemaining > 0;
    return endTurn(claimed, rng, handRedrawEachTurn, turnContinues);
  }

  if (action.type === 'PLAYER_PLAY_QUAKE') {
    if (state.activeTurn !== 'player') return state;
    const card = state.playerHand.find((c) => c.id === action.cardId);
    if (!card || card.kind !== 'quake') return state;
    // A free action -- doesn't spend a play and never ends the turn itself;
    // only Pass (or running out of plays without this card) does that.
    return {
      ...state,
      playerHand: state.playerHand.filter((c) => c.id !== action.cardId),
      unlimitedPlaysThisTurn: true,
      log: [
        ...state.log,
        makeLog(
          state.turnNumber,
          'player',
          'quake',
          'Player unleashes the Quake card -- unlimited plays this turn!',
          snapshotOf(state),
        ),
      ],
    };
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
