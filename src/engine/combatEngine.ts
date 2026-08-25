import type { SuitId, SuitCategory } from '../types/suits';
import type { Card, CreatureCard } from '../types/cards';
import type { EnemyInstance } from '../types/enemy';
import type { RoomInstance } from '../types/room';
import type { StatusBag, StatusId } from '../types/status';
import type {
  CombatAction,
  CombatState,
  LogEntry,
  TableOwnerId,
} from '../types/combat';
import type { Rng } from './rng';
import { shuffleDeck, drawCards } from './deckState';
import { countTableSetSize, wipeOwnerTable, dealRoomTable } from './tableState';
import { chooseEnemyPlay } from './enemyAI';
import { enemyDefById } from '../config/enemies';
import { addStacks, stacksOf, tickStatuses, withStrength, withWeaken } from './statusEffects';
import { STATUS_DEFS } from '../types/status';
import {
  SUIT_DEFINITIONS,
  WEAKEN_PCT_PER_STACK,
  PLAYS_PER_TURN_BASE,
  ENEMY_HAND_SIZE,
  ENEMY_PLAYS_PER_TURN,
} from '../config/constants';

const suitCategory = (suit: SuitId) =>
  SUIT_DEFINITIONS.find((s) => s.id === suit)!.category;
const suitName = (suit: SuitId) => SUIT_DEFINITIONS.find((s) => s.id === suit)!.name;

// Categories that act on an enemy the player picks (or, for an enemy actor,
// always hit the player) -- Hex/Venom apply their status to a target the
// same way a threat play deals damage. Every other category (boon, guard,
// strength) always self-targets whoever played it.
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
  rng: Rng,
  playerHP: number,
  playerHPMax: number,
  playerDeck: Card[],
): CombatState {
  const snapshot: MeterSnapshot = { playerHP, playerHPMax, playerGuard: 0 };
  const enemyList = room.enemies.map((e) => `${e.name} (${e.hp} HP)`).join(', ');

  const shuffled = shuffleDeck(playerDeck, rng);
  const { drawn, drawPile, discardPile } = drawCards(shuffled, [], room.params.playerHandSize, rng);

  // Each enemy shuffles a fresh copy of its own EnemyDef.deck and draws an
  // opening hand -- mirrors the player's own deck cycle 1:1. Two same-defId
  // instances never share array identity: shuffleDeck copies before
  // shuffling, so each instance's shuffle is independent.
  const enemies: EnemyInstance[] = room.enemies.map((e) => {
    const def = enemyDefById(e.defId);
    const enemyShuffled = shuffleDeck(def.deck, rng);
    const { drawn: hand, drawPile: enemyDrawPile, discardPile: enemyDiscardPile } = drawCards(
      enemyShuffled,
      [],
      ENEMY_HAND_SIZE,
      rng,
    );
    return { ...e, hand, drawPile: enemyDrawPile, discardPile: enemyDiscardPile };
  });

  const table = dealRoomTable(rng, room.params, `${room.id}-table-r1`);

  return {
    table,
    playerHand: drawn,
    drawPile,
    discardPile,
    roomParams: room.params,
    enemies,
    activeEnemyIndex: 0,
    playerHP,
    playerHPMax,
    playerGuard: 0,
    playerStatuses: {},
    turnNumber: 1,
    activeTurn: 'player',
    playsRemaining: PLAYS_PER_TURN_BASE,
    unlimitedPlaysThisTurn: false,
    log: [makeLog(0, 'system', 'round-start', `Threat looms: ${enemyList}. The room deals its neutral hand onto the table.`, snapshot)],
    status: 'active',
  };
}

// --- Play legality / execution -------------------------------------------

export interface LegalPlayTarget {
  suit: SuitId;
  targetInstanceId?: string;
  tableSetSize: number;
}

/** Every (suit, target) pair the player currently holds a matching, live play for -- UI legality preview. Unlike the old claim system, there's no table-size floor: any suit with >=1 matching hand card is playable, even against a 0-count table (a legitimate "banking" play). */
export function getLegalPlaySets(state: CombatState): LegalPlayTarget[] {
  if (state.playsRemaining <= 0 && !state.unlimitedPlaysThisTurn) return [];

  const suits = new Set<SuitId>();
  for (const card of state.playerHand) {
    if (card.kind !== 'creature') continue;
    suits.add(card.suit);
  }

  const targets: LegalPlayTarget[] = [];
  for (const suit of suits) {
    const size = countTableSetSize(state.table, suit);
    if (requiresEnemyTarget(suitCategory(suit))) {
      // Table piles aren't owned by any enemy -- every alive enemy is a
      // legal, independent target for the same suit.
      for (const enemy of state.enemies) {
        targets.push({ suit, targetInstanceId: enemy.instanceId, tableSetSize: size });
      }
    } else {
      targets.push({ suit, tableSetSize: size });
    }
  }
  return targets;
}

function isLegalPlay(
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

  const category = suitCategory(suit);
  if (requiresEnemyTarget(category)) {
    if (!targetInstanceId) return false;
    if (!state.enemies.some((e) => e.instanceId === targetInstanceId)) return false;
  }
  return true;
}

// Who's making a play -- the player (UI-dispatched) or a specific enemy
// (chosen internally by engine/enemyAI.ts, never UI-dispatched).
type Actor = { kind: 'player' } | { kind: 'enemy'; instanceId: string };

function ownerIdOf(actor: Actor): TableOwnerId {
  return actor.kind === 'player' ? 'player' : actor.instanceId;
}

function actorStatusesOf(state: CombatState, actor: Actor): StatusBag {
  if (actor.kind === 'player') return state.playerStatuses;
  return state.enemies.find((e) => e.instanceId === actor.instanceId)!.statuses;
}

function actorNameOf(state: CombatState, actor: Actor): string {
  if (actor.kind === 'player') return 'Player';
  return state.enemies.find((e) => e.instanceId === actor.instanceId)!.name;
}

/**
 * The one and only "play a set" resolver -- used for both the player's
 * dispatched PLAY_SET action and each enemy's own turn. magnitude =
 * handCardIds.length x (matching table cards visible BEFORE this play, from
 * every owner combined) -- nothing is ever removed from the table by a
 * play; the played cards are simply appended, tagged with the actor's own
 * ownerId, on top of whatever was already there. A 0-magnitude play (no
 * matching table cards yet) is a legitimate "banking" play -- what the old
 * game called feeding, now just the degenerate case of playing.
 *
 * Targeting: threat/weaken/poison plays by the player require a chosen
 * enemy (targetInstanceId); the same categories played by an enemy always
 * hit the player -- enemies never target each other. boon/guard/strength
 * always self-target whoever played them.
 */
function performPlay(
  state: CombatState,
  actor: Actor,
  suit: SuitId,
  targetInstanceId: string | undefined,
  handCardIds: string[],
): CombatState {
  const category = suitCategory(suit);
  const isThreat = category === 'threat';
  const actorStatuses = actorStatusesOf(state, actor);
  const strengthStacks = isThreat ? stacksOf(actorStatuses, 'strength') : 0;
  const weakenStacks = isThreat ? stacksOf(actorStatuses, 'weaken') : 0;
  const tableCountBefore = countTableSetSize(state.table, suit);
  const boostedBase = isThreat ? withStrength(tableCountBefore, actorStatuses) : tableCountBefore;
  const rawMagnitude = boostedBase * handCardIds.length;
  const magnitude = isThreat ? withWeaken(rawMagnitude, actorStatuses, WEAKEN_PCT_PER_STACK) : rawMagnitude;

  const ownerId = ownerIdOf(actor);
  const playedIdSet = new Set(handCardIds);

  let next: CombatState = state;
  let playedCards: CreatureCard[];
  if (actor.kind === 'player') {
    playedCards = state.playerHand.filter((c): c is CreatureCard => playedIdSet.has(c.id) && c.kind === 'creature');
    next = {
      ...next,
      playerHand: state.playerHand.filter((c) => !playedIdSet.has(c.id)),
      discardPile: [...state.discardPile, ...playedCards],
    };
  } else {
    const enemy = state.enemies.find((e) => e.instanceId === actor.instanceId)!;
    playedCards = enemy.hand.filter((c) => playedIdSet.has(c.id));
    next = updateEnemy(next, actor.instanceId, (e) => ({
      ...e,
      hand: e.hand.filter((c) => !playedIdSet.has(c.id)),
      discardPile: [...e.discardPile, ...playedCards],
    }));
  }
  next = {
    ...next,
    table: [...next.table, ...playedCards.map((c) => ({ id: c.id, suit: c.suit, ownerId }))],
  };

  let effectDesc: string;
  let targetName: string | undefined;

  if (category === 'threat') {
    if (actor.kind === 'player') {
      const enemy = next.enemies.find((e) => e.instanceId === targetInstanceId)!;
      targetName = enemy.name;
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
    } else {
      targetName = 'you';
      const result = absorbDamage(next.playerHP, next.playerGuard, magnitude);
      const dealt = next.playerHP - result.hp;
      next = { ...next, playerHP: result.hp, playerGuard: result.guard };
      effectDesc =
        result.absorbed > 0
          ? `dealing ${magnitude} -- Guard absorbs ${result.absorbed}, ${dealt} gets through`
          : `dealing ${dealt} to you`;
    }
  } else if (category === 'boon') {
    if (actor.kind === 'player') {
      next = { ...next, playerHP: Math.min(state.playerHPMax, next.playerHP + magnitude) };
      effectDesc = `healing ${magnitude} HP`;
    } else {
      const before = next.enemies.find((e) => e.instanceId === actor.instanceId)!.hp;
      next = updateEnemy(next, actor.instanceId, (e) => ({ ...e, hp: Math.min(e.hpMax, e.hp + magnitude) }));
      const healed = next.enemies.find((e) => e.instanceId === actor.instanceId)!.hp - before;
      effectDesc = `healing ${healed} HP`;
    }
  } else if (category === 'guard') {
    if (actor.kind === 'player') {
      next = { ...next, playerGuard: next.playerGuard + magnitude };
      effectDesc = `raising Guard to ${next.playerGuard}`;
    } else {
      next = updateEnemy(next, actor.instanceId, (e) => ({ ...e, guard: e.guard + magnitude }));
      const newGuard = next.enemies.find((e) => e.instanceId === actor.instanceId)!.guard;
      effectDesc = `raising Guard to ${newGuard}`;
    }
  } else if (category === 'weaken' || category === 'poison') {
    const statusId: StatusId = category;
    if (actor.kind === 'player') {
      const enemy = next.enemies.find((e) => e.instanceId === targetInstanceId)!;
      targetName = enemy.name;
      next = updateEnemy(next, enemy.instanceId, (e) => ({ ...e, statuses: addStacks(e.statuses, statusId, magnitude) }));
      const totalStacks = stacksOf(next.enemies.find((e) => e.instanceId === enemy.instanceId)!.statuses, statusId);
      effectDesc = `inflicting +${magnitude} ${STATUS_DEFS[statusId].name} on ${enemy.name} (${totalStacks} stack${totalStacks === 1 ? '' : 's'})`;
    } else {
      targetName = 'you';
      next = { ...next, playerStatuses: addStacks(next.playerStatuses, statusId, magnitude) };
      const totalStacks = stacksOf(next.playerStatuses, statusId);
      effectDesc = `inflicting +${magnitude} ${STATUS_DEFS[statusId].name} on you (${totalStacks} stack${totalStacks === 1 ? '' : 's'})`;
    }
  } else {
    // strength: self-buff, whether the actor is the player or an enemy.
    if (actor.kind === 'player') {
      next = { ...next, playerStatuses: addStacks(next.playerStatuses, 'strength', magnitude) };
      const totalStacks = stacksOf(next.playerStatuses, 'strength');
      effectDesc = `gaining +${magnitude} Strength (${totalStacks} stack${totalStacks === 1 ? '' : 's'})`;
    } else {
      next = updateEnemy(next, actor.instanceId, (e) => ({ ...e, statuses: addStacks(e.statuses, 'strength', magnitude) }));
      const totalStacks = stacksOf(next.enemies.find((e) => e.instanceId === actor.instanceId)!.statuses, 'strength');
      effectDesc = `gaining +${magnitude} Strength (${totalStacks} stack${totalStacks === 1 ? '' : 's'})`;
    }
  }

  const weakenNote =
    weakenStacks > 0
      ? ` (weakened -${Math.round(Math.min(1, weakenStacks * WEAKEN_PCT_PER_STACK) * 100)}% from ${weakenStacks} stack${weakenStacks === 1 ? '' : 's'})`
      : '';
  const strengthNote = strengthStacks > 0 ? ` (+${strengthStacks} from Strength)` : '';
  const actorName = actorNameOf(state, actor);
  next = {
    ...next,
    log: [
      ...next.log,
      makeLog(
        next.turnNumber,
        actor.kind === 'player' ? 'player' : 'enemy',
        'play',
        `${actorName} plays ${suitName(suit)}${targetName ? ` at ${targetName}` : ''} (${handCardIds.length} card(s) x ${tableCountBefore} on the table)${weakenNote}${strengthNote} -- ${effectDesc}.`,
        snapshotOf(next),
      ),
    ],
  };

  return next;
}

// --- Enemy turn resolution -----------------------------------------------

function resolveEnemyTurn(state: CombatState, rng: Rng): CombatState {
  const enemyId = state.enemies[state.activeEnemyIndex].instanceId;
  let next: CombatState = { ...state, table: wipeOwnerTable(state.table, enemyId) };

  for (let i = 0; i < ENEMY_PLAYS_PER_TURN; i++) {
    const currentEnemy = next.enemies.find((e) => e.instanceId === enemyId)!;
    const choice = chooseEnemyPlay(currentEnemy, next.table, rng);
    if (!choice) {
      next = {
        ...next,
        log: [...next.log, makeLog(next.turnNumber, 'enemy', 'pass', `${currentEnemy.name} has nothing to play.`, snapshotOf(next))],
      };
      break;
    }
    next = performPlay(next, { kind: 'enemy', instanceId: enemyId }, choice.suit, undefined, choice.handCardIds);
  }

  // Tick this enemy's own statuses once, at the true end of its own turn --
  // a Poison tick can drop this enemy to 0 HP; it's left in the array as a
  // "corpse" rather than removed here -- removing it now would shrink
  // `enemies` and desync activeEnemyIndex against enemies still owed a turn
  // this round (see endTurn's round-end sweep, the one safe place to
  // actually drop it).
  const postPlays = next.enemies.find((e) => e.instanceId === enemyId)!;
  const { statuses: tickedStatuses, poisonDamage } = tickStatuses(postPlays.statuses);
  let tickedHp = postPlays.hp;
  let tickedGuard = postPlays.guard;
  let poisonMessage = '';
  if (poisonDamage > 0) {
    const result = absorbDamage(tickedHp, tickedGuard, poisonDamage);
    const dealt = tickedHp - result.hp;
    tickedHp = result.hp;
    tickedGuard = result.guard;
    poisonMessage =
      result.absorbed > 0
        ? `${postPlays.name}'s poison deals ${poisonDamage} -- Guard absorbs ${result.absorbed}, ${dealt} gets through.`
        : `${postPlays.name}'s poison deals ${dealt}.`;
    if (tickedHp <= 0) poisonMessage += ` ${postPlays.name} is defeated!`;
  }

  next = updateEnemy(next, enemyId, (e) => ({ ...e, hp: tickedHp, guard: tickedGuard, statuses: tickedStatuses }));
  if (poisonMessage) {
    next = { ...next, log: [...next.log, makeLog(next.turnNumber, 'system', 'poison', poisonMessage, snapshotOf(next))] };
  }

  // Discard the whole remaining hand and draw a fresh one from this
  // enemy's own deck, in preparation for its next turn -- mirrors the
  // player's own end-of-round redraw, just scoped to this one enemy.
  const beforeRedraw = next.enemies.find((e) => e.instanceId === enemyId)!;
  const { drawn, drawPile, discardPile } = drawCards(
    beforeRedraw.drawPile,
    [...beforeRedraw.discardPile, ...beforeRedraw.hand],
    ENEMY_HAND_SIZE,
    rng,
  );
  next = updateEnemy(next, enemyId, (e) => ({ ...e, hand: drawn, drawPile, discardPile }));

  if (next.playerHP <= 0) {
    next = { ...next, status: 'player-dead' };
  }

  return next;
}

// --- Turn-end bookkeeping ------------------------------------------------

/**
 * Shared tail for every actor action (player play/pass, or a single enemy's
 * turn). On full round rollover, the room's own table area is wiped and
 * re-dealt, then the player's own table area is wiped -- the room is just
 * another owner whose "turn" happens to fall at the top of every round.
 */
function endTurn(
  state: CombatState,
  rng: Rng,
  // True when a just-resolved PLAY_SET left the player with more plays this
  // turn (or unlimited plays are active) -- skips the player-turn-end
  // machinery below (status ticks, the flip to the enemy phase) so the same
  // player turn simply continues. Never set for PLAYER_PASS or ENEMY_TURN,
  // which always end their actor's turn outright.
  continuePlayerTurn: boolean = false,
): CombatState {
  if (state.status !== 'active') return state;

  // A play or an enemy attack can already have dropped the player to 0
  // before the checks below run -- must be caught here, not just inside
  // resolveEnemyTurn's own death check, or a lethal hit could be masked.
  if (state.playerHP <= 0) {
    return { ...state, playerHP: 0, status: 'player-dead' };
  }

  // A play can already have wiped the last enemy before the checks below run.
  if (state.enemies.length === 0) {
    return { ...state, status: 'room-cleared' };
  }

  const isRoundEnd = state.activeTurn === 'enemy' && state.activeEnemyIndex + 1 >= state.enemies.length;

  let next: CombatState = state;
  if (isRoundEnd) {
    // A Poison tick during this enemy phase can have left a 0-HP "corpse" in
    // the array -- round-end is the first safe point to actually drop it,
    // since activeEnemyIndex arithmetic during the phase assumes the array
    // only shrinks between rounds. Its already-played table cards are left
    // exactly where they are -- ownerId is a plain string tag, not a live
    // reference, so a defeated enemy's contribution simply stays on the
    // table permanently (it will never get another turn to wipe it).
    if (next.enemies.some((e) => e.hp <= 0)) {
      next = { ...next, enemies: next.enemies.filter((e) => e.hp > 0) };
    }

    if (next.enemies.length === 0) {
      return { ...next, status: 'room-cleared' };
    }
  }

  if (state.activeTurn === 'player' && continuePlayerTurn) {
    return next;
  }

  if (state.activeTurn === 'player') {
    // Player's turn just ended -- the player's own statuses tick here,
    // whether or not they were used this turn: a Poison stack deals its
    // damage now, then every stack decays by 1, and the enemy phase begins
    // at index 0.
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

  // The whole enemy phase just concluded -- a new round begins. The room
  // (just another table owner whose "turn" falls here) discards its own
  // prior contribution and deals a fresh neutral wave, then the player's
  // own table area wipes, then the player's whole hand discards and a
  // fresh one is drawn.
  const newTurnNumber = next.turnNumber + 1;
  const roomWiped = wipeOwnerTable(next.table, 'room');
  const freshRoomCards = dealRoomTable(rng, next.roomParams, `room-deal-t${newTurnNumber}`);
  const table = wipeOwnerTable([...roomWiped, ...freshRoomCards], 'player');

  const preRedrawDiscard = [...next.discardPile, ...next.playerHand];
  const { drawn, drawPile, discardPile } = drawCards(
    next.drawPile,
    preRedrawDiscard,
    next.roomParams.playerHandSize,
    rng,
  );
  next = {
    ...next,
    table,
    playerHand: drawn,
    drawPile,
    discardPile,
    log: [
      ...next.log,
      makeLog(newTurnNumber, 'system', 'room-deal', 'The room deals a fresh wave onto the table.', snapshotOf(next)),
      makeLog(newTurnNumber, 'system', 'redraw', 'Player draws a fresh hand.', {
        playerHP: next.playerHP,
        playerHPMax: next.playerHPMax,
        playerGuard: next.playerGuard,
      }),
    ],
  };

  return {
    ...next,
    activeTurn: 'player',
    activeEnemyIndex: 0,
    turnNumber: newTurnNumber,
    playsRemaining: PLAYS_PER_TURN_BASE,
    unlimitedPlaysThisTurn: false,
  };
}

// --- Public action dispatch ------------------------------------------------

export function applyCombatAction(state: CombatState, action: CombatAction, rng: Rng): CombatState {
  if (state.status !== 'active') return state;

  if (action.type === 'PLAY_SET') {
    if (state.activeTurn !== 'player') return state;
    if (!isLegalPlay(state, action.suit, action.targetInstanceId, action.handCardIds)) return state;
    let played = performPlay(state, { kind: 'player' }, action.suit, action.targetInstanceId, action.handCardIds);
    // Unlimited plays (Quake) never spend down; otherwise this play spends
    // exactly one of the turn's plays regardless of how many hand cards it
    // used.
    if (!played.unlimitedPlaysThisTurn) {
      played = { ...played, playsRemaining: played.playsRemaining - 1 };
    }
    const turnContinues = played.unlimitedPlaysThisTurn || played.playsRemaining > 0;
    return endTurn(played, rng, turnContinues);
  }

  if (action.type === 'PLAYER_PLAY_QUAKE') {
    if (state.activeTurn !== 'player') return state;
    const card = state.playerHand.find((c) => c.id === action.cardId);
    if (!card || card.kind !== 'quake') return state;
    // A free action -- doesn't spend a play and never ends the turn itself;
    // only Pass (or running out of plays without this card) does that.
    // Playing it discards it, same as any other played card, so it comes
    // back around next reshuffle instead of vanishing for the room.
    return {
      ...state,
      playerHand: state.playerHand.filter((c) => c.id !== action.cardId),
      discardPile: [...state.discardPile, card],
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
    return endTurn(passed, rng);
  }

  if (action.type === 'ENEMY_TURN') {
    if (state.activeTurn !== 'enemy') return state;
    const resolved = resolveEnemyTurn(state, rng);
    return endTurn(resolved, rng);
  }

  return state;
}
