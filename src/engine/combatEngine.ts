import type { SuitId, SuitCategory } from '../types/suits';
import type { Card, CreatureCard } from '../types/cards';
import type { EnemyInstance } from '../types/enemy';
import type { CombatRoomInstance } from '../types/room';
import type { StatusBag, StatusId } from '../types/status';
import type { RelicDef } from '../types/relics';
import type { PotionDef, PotionKind } from '../types/potions';
import type {
  CombatAction,
  CombatState,
  LogEntry,
  TableOwnerId,
} from '../types/combat';
import type { Rng } from './rng';
import { shuffleDeck, drawCards, topUpHand } from './deckState';
import { countTableSetSize, wipeOwnerTable, claimRoomCards, dealRoomTableForRound, roomOwnedCount } from './tableState';
import { chooseEnemyPlay } from './enemyAI';
import { enemyDefById } from '../config/enemies';
import { specialCardById, riderForCard } from '../config/specialCards';
import { addStacks, stacksOf, tickStatuses, withStrength, withWeaken, withVulnerable } from './statusEffects';
import { STATUS_DEFS } from '../types/status';
import {
  SUIT_DEFINITIONS,
  WEAKEN_PCT,
  VULNERABLE_PCT,
  PLAYS_PER_TURN_BASE,
  ENEMY_PLAYS_PER_TURN,
  QUAKE_BONUS_PLAYS,
  CURRENCY_CLAIM_THRESHOLD,
  CURRENCY_ENABLED,
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
  room: CombatRoomInstance,
  rng: Rng,
  playerHP: number,
  playerHPMax: number,
  playerDeck: Card[],
  relics: RelicDef[] = [],
  potions: PotionDef[] = [],
  currency: number = 0,
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
      def.handSize,
      rng,
    );
    return { ...e, hand, drawPile: enemyDrawPile, discardPile: enemyDiscardPile };
  });

  const table = dealRoomTableForRound(rng, room.params, `${room.id}-table-r1`);

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
    cleaveActive: false,
    log: [makeLog(0, 'system', 'round-start', `Threat looms: ${enemyList}. The room deals its neutral hand onto the table.`, snapshot)],
    status: 'active',
    relics,
    potions,
    currency,
  };
}

/**
 * Converts room-pile overflow into currency (MECHANIC_BRAINSTORM.md's
 * "Currency from claim overflow"): whenever a claim -- a real play, or a
 * Free Claim/Salt potion use -- reads a room-owned pile above
 * CURRENCY_CLAIM_THRESHOLD, the amount over the threshold is added 1:1 to
 * currency. `roomCountBeforeClaim` must be read by the caller before
 * claimRoomCards removes those cards. A no-op (returns state unchanged) when
 * the pile doesn't clear the threshold, so callers can call this
 * unconditionally after every claim.
 */
function applyCurrencyOverflow(state: CombatState, roomCountBeforeClaim: number): CombatState {
  if (!CURRENCY_ENABLED) return state;
  const overflow = roomCountBeforeClaim - CURRENCY_CLAIM_THRESHOLD;
  if (overflow <= 0) return state;
  const currency = state.currency + overflow;
  return {
    ...state,
    currency,
    log: [
      ...state.log,
      makeLog(
        state.turnNumber,
        'player',
        'currency',
        `The claimed pile (${roomCountBeforeClaim}, past the ${CURRENCY_CLAIM_THRESHOLD}-card threshold) yields +${overflow} currency (${currency} total).`,
        snapshotOf(state),
      ),
    ],
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
  if (state.playsRemaining <= 0) return [];

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

export interface LegalPotionUse {
  suit: SuitId;
  targetInstanceId?: string;
  // The flat amount a potion use would resolve/discard -- Free Claim's
  // table total (every owner combined) or Salt's room-owned count, per
  // getLegalFreeClaimUses/getLegalSaltUses below. Always > 0: a potion use
  // with nothing to act on isn't offered as legal.
  amount: number;
}

/** Every (suit, target) a held Free Claim potion could legally resolve right now -- mirrors getLegalPlaySets' shape, but reads state.table (every owner's cards) instead of the hand, and requires holding a 'free-claim' potion. */
export function getLegalFreeClaimUses(state: CombatState): LegalPotionUse[] {
  if (state.activeTurn !== 'player' || state.status !== 'active') return [];
  if (!state.potions.some((p) => p.kind === 'free-claim')) return [];

  const suits = new Set(state.table.map((c) => c.suit));
  const uses: LegalPotionUse[] = [];
  for (const suit of suits) {
    const amount = countTableSetSize(state.table, suit);
    if (amount <= 0) continue;
    if (requiresEnemyTarget(suitCategory(suit))) {
      for (const enemy of state.enemies) {
        uses.push({ suit, targetInstanceId: enemy.instanceId, amount });
      }
    } else {
      uses.push({ suit, amount });
    }
  }
  return uses;
}

/** Every suit a held Salt potion could legally discard the room's own pile of right now -- only ever the room-owned count, never the player's/an enemy's own contribution (see claimRoomCards). */
export function getLegalSaltUses(state: CombatState): LegalPotionUse[] {
  if (state.activeTurn !== 'player' || state.status !== 'active') return [];
  if (!state.potions.some((p) => p.kind === 'salt')) return [];

  const roomSuits = new Set(state.table.filter((c) => c.ownerId === 'room').map((c) => c.suit));
  const uses: LegalPotionUse[] = [];
  for (const suit of roomSuits) {
    const amount = state.table.filter((c) => c.suit === suit && c.ownerId === 'room').length;
    if (amount > 0) uses.push({ suit, amount });
  }
  return uses;
}

export interface PlayPreview {
  category: SuitCategory;
  tableCountAfterPlay: number;
  /** This play's own category effect (damage/heal/Guard/stacks), Strength/Weaken/Vulnerable already folded in for a threat play -- exactly what performPlay would apply, never a separate estimate. */
  magnitude: number;
  strengthStacks: number;
  weakenStacks: number;
  vulnerableStacks: number;
  /** Combined rider bonus from every selected card (see applyRiders) -- flat, never touched by Strength/Weaken/Vulnerable, added on top of `magnitude` once the play actually resolves. */
  bonusDamage: number;
  bonusGuard: number;
  bonusDamageAoe: number;
  bonusStatus: StatusBag;
  drawAmount: number;
  discardAmount: number;
  bonusPlays: number;
}

/**
 * Previews exactly what PLAY_SET would compute for these hand cards without
 * mutating state -- built from the same computeMagnitude/computeRiderTotals
 * performPlay itself uses, so a UI preview can never drift from the real
 * resolution. Player-only: enemies don't need a pre-play preview since
 * chooseEnemyPlay commits directly. `targetInstanceId` is optional (unset
 * while Cleave is active or no target is chosen yet) -- Vulnerable is
 * target-specific, so the preview only folds it in once a single target is
 * actually known; a Cleave-widened play's real per-enemy Vulnerable can
 * still differ enemy-by-enemy, which the preview doesn't attempt to show.
 */
export function previewPlayerPlay(
  state: CombatState,
  suit: SuitId,
  handCardIds: string[],
  targetInstanceId?: string,
): PlayPreview {
  const category = suitCategory(suit);
  const tableCountBefore = countTableSetSize(state.table, suit);
  const { tableCountAfterPlay, magnitude: rawMagnitude, strengthStacks, weakenStacks } = computeMagnitude(
    category,
    handCardIds.length,
    tableCountBefore,
    state.playerStatuses,
  );
  const targetStatuses = targetInstanceId ? state.enemies.find((e) => e.instanceId === targetInstanceId)?.statuses ?? {} : {};
  const vulnerableStacks = category === 'threat' ? stacksOf(targetStatuses, 'vulnerable') : 0;
  const magnitude = category === 'threat' ? withVulnerable(rawMagnitude, targetStatuses, VULNERABLE_PCT) : rawMagnitude;
  const idSet = new Set(handCardIds);
  const cards = state.playerHand.filter((c): c is CreatureCard => idSet.has(c.id) && c.kind === 'creature');
  const { bonusDamage, bonusGuard, bonusDamageAoe, bonusStatus, drawAmount, discardAmount, bonusPlays } = computeRiderTotals(cards, tableCountAfterPlay);
  return { category, tableCountAfterPlay, magnitude, strengthStacks, weakenStacks, vulnerableStacks, bonusDamage, bonusGuard, bonusDamageAoe, bonusStatus, drawAmount, discardAmount, bonusPlays };
}

function isLegalPlay(
  state: CombatState,
  suit: SuitId,
  targetInstanceId: string | undefined,
  handCardIds: string[],
): boolean {
  if (state.playsRemaining <= 0) return false;
  if (handCardIds.length === 0) return false;
  const uniqueIds = new Set(handCardIds);
  if (uniqueIds.size !== handCardIds.length) return false;
  for (const id of uniqueIds) {
    const card = state.playerHand.find((c) => c.id === id);
    if (!card || card.kind !== 'creature' || card.suit !== suit) return false;
  }

  const category = suitCategory(suit);
  if (requiresEnemyTarget(category)) {
    // Cleave (MECHANIC_BRAINSTORM.md's AOE tier 2) flags the next threat
    // play to resolve against every alive enemy instead of one chosen
    // target -- no targetInstanceId is needed for that one play.
    const cleaveWaivesTarget = category === 'threat' && state.cleaveActive;
    if (!cleaveWaivesTarget) {
      if (!targetInstanceId) return false;
      if (!state.enemies.some((e) => e.instanceId === targetInstanceId)) return false;
    }
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
 * dispatched PLAY_SET action and each enemy's own turn. A played set is
 * itself a multiplicative set on the table: magnitude = handCardIds.length x
 * (matching table cards visible BEFORE this play, from every owner combined,
 * PLUS the cards this play itself adds). Playing 2 of a suit onto an empty
 * table is 2 played x 2 now on the table = 4; playing 2 more onto an
 * existing 3 is 2 played x 5 now on the table = 10. Every play therefore has
 * an effect, even the very first one into an empty table -- there's no more
 * 0-magnitude "banking" play. Player/enemy contributions already on the
 * table are never touched by a play -- they're simply appended to, tagged
 * with the actor's own ownerId, on top of whatever was already there, and
 * only clear via their owner's own-turn-start wipe. The room's own matching
 * cards are the one exception: reading their count here is what "claims"
 * them, so they're removed the moment they're read (see claimRoomCards) --
 * that's the whole reason unclaimed room cards are safe to let accumulate
 * across rounds instead of being wiped every round.
 *
 * Targeting: threat/weaken/poison plays by the player require a chosen
 * enemy (targetInstanceId); the same categories played by an enemy always
 * hit the player -- enemies never target each other. boon/guard/strength
 * always self-target whoever played them.
 */
/**
 * The magnitude formula shared by every play, real or previewed: handCount x
 * (table cards of `category` visible before this play, from every owner
 * combined, PLUS the cards this play itself adds) -- with Strength/Weaken
 * folded in for a *threat* play only (see withStrength/withWeaken), exactly
 * mirroring performPlay's own math so a UI preview built from this can never
 * drift from what actually resolves.
 */
function computeMagnitude(
  category: SuitCategory,
  handCount: number,
  tableCountBefore: number,
  actorStatuses: StatusBag,
): { tableCountAfterPlay: number; magnitude: number; strengthStacks: number; weakenStacks: number } {
  const isThreat = category === 'threat';
  const strengthStacks = isThreat ? stacksOf(actorStatuses, 'strength') : 0;
  const weakenStacks = isThreat ? stacksOf(actorStatuses, 'weaken') : 0;
  const tableCountAfterPlay = tableCountBefore + handCount;
  const boostedTotal = isThreat ? withStrength(tableCountAfterPlay, actorStatuses) : tableCountAfterPlay;
  const rawMagnitude = boostedTotal * handCount;
  const magnitude = isThreat ? withWeaken(rawMagnitude, actorStatuses, WEAKEN_PCT) : rawMagnitude;
  return { tableCountAfterPlay, magnitude, strengthStacks, weakenStacks };
}

/**
 * Sums the rider each of `cards` fires (see applyRiders) into the same
 * combined totals a resolving play would apply -- shared by the real
 * resolver and any preview built ahead of a play. bonusStatus is a
 * StatusBag rather than a single number since (unlike the flat-amount
 * kinds) its "amount" is spread across whichever StatusId each contributing
 * card's rider names -- a play can only ever mix multiple statusIds if it
 * combines two different named specials of the same suit, but summing into
 * a bag handles that for free instead of assuming just one. Only cards with
 * a specialId contribute anything here (riderForCard returns undefined for
 * a plain card, so it's skipped). bonus-per-card folds straight into
 * bonusDamage/bonusGuard (routed the same threat/weaken/poison-vs-rest way
 * every other targeted rider is) rather than getting its own return field,
 * since `tableCountAfterPlay` scaling is
 * the only thing that makes it different from bonus-damage/bonus-guard --
 * once scaled, it's the same bucket, so every downstream consumer (the
 * resolver's actual damage/guard application, the UI preview's combined
 * total) needs no bonus-per-card-specific code at all.
 */
function computeRiderTotals(
  cards: CreatureCard[],
  tableCountAfterPlay: number,
): { bonusDamage: number; bonusGuard: number; bonusDamageAoe: number; bonusStatus: StatusBag; drawAmount: number; discardAmount: number; bonusPlays: number } {
  let bonusDamage = 0;
  let bonusGuard = 0;
  let bonusDamageAoe = 0;
  let bonusStatus: StatusBag = {};
  let drawAmount = 0;
  let discardAmount = 0;
  let bonusPlays = 0;
  for (const card of cards) {
    const rider = riderForCard(card);
    if (!rider) continue;
    const category = suitCategory(card.suit);
    const targetsDamage = category === 'threat' || category === 'weaken' || category === 'poison';
    if (rider.kind === 'bonus-damage') bonusDamage += rider.amount;
    else if (rider.kind === 'bonus-guard') bonusGuard += rider.amount;
    else if (rider.kind === 'bonus-damage-aoe') bonusDamageAoe += rider.amount;
    else if (rider.kind === 'bonus-status') bonusStatus = addStacks(bonusStatus, rider.statusId, rider.amount);
    else if (rider.kind === 'bonus-per-card') {
      const scaled = rider.amount * tableCountAfterPlay;
      if (targetsDamage) bonusDamage += scaled;
      else bonusGuard += scaled;
    } else if (rider.kind === 'draw') drawAmount += rider.amount;
    else if (rider.kind === 'discard') discardAmount += rider.amount;
    else bonusPlays += rider.amount;
  }
  return { bonusDamage, bonusGuard, bonusDamageAoe, bonusStatus, drawAmount, discardAmount, bonusPlays };
}

function performPlay(
  state: CombatState,
  actor: Actor,
  suit: SuitId,
  targetInstanceId: string | undefined,
  handCardIds: string[],
  rng: Rng,
): CombatState {
  const category = suitCategory(suit);
  const actorStatuses = actorStatusesOf(state, actor);
  const tableCountBefore = countTableSetSize(state.table, suit);
  const { tableCountAfterPlay, magnitude, strengthStacks, weakenStacks } = computeMagnitude(
    category,
    handCardIds.length,
    tableCountBefore,
    actorStatuses,
  );

  const ownerId = ownerIdOf(actor);
  const playedIdSet = new Set(handCardIds);
  // Read before claimRoomCards below removes them -- see
  // applyCurrencyOverflow. Only the player's own claim ever converts to
  // currency (see the call site after the play's own log line); an enemy's
  // claim of the same pile never does.
  const roomCountBeforeClaim = roomOwnedCount(state.table, suit);

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
    table: [
      ...claimRoomCards(next.table, suit),
      ...playedCards.map((c) => ({ id: c.id, suit: c.suit, ownerId })),
    ],
  };

  let effectDesc: string;
  let targetName: string | undefined;

  if (category === 'threat') {
    if (actor.kind === 'player') {
      if (next.cleaveActive) {
        // Cleave (MECHANIC_BRAINSTORM.md's AOE tier 2): the setup card
        // already flagged this as the "next threat play," so the same
        // computed magnitude lands on every alive enemy, undivided, instead
        // of the one chosen target -- Vulnerable is still resolved
        // per-enemy since it's a target-side stat.
        const results = next.enemies.map((e) => {
          const dealtMagnitude = withVulnerable(magnitude, e.statuses, VULNERABLE_PCT);
          const result = absorbDamage(e.hp, e.guard, dealtMagnitude);
          return { instanceId: e.instanceId, name: e.name, result, dealt: e.hp - result.hp };
        });
        next = {
          ...next,
          enemies: next.enemies
            .map((e) => {
              const r = results.find((x) => x.instanceId === e.instanceId)!;
              return { ...e, hp: r.result.hp, guard: r.result.guard };
            })
            .filter((e) => e.hp > 0),
          cleaveActive: false,
        };
        const totalDealt = results.reduce((sum, r) => sum + r.dealt, 0);
        const defeated = results.filter((r) => r.result.hp <= 0).map((r) => r.name);
        targetName = 'every enemy';
        effectDesc = `dealing ${totalDealt} total across ${results.length} enem${results.length === 1 ? 'y' : 'ies'}`;
        if (defeated.length > 0) effectDesc += ` -- ${defeated.join(', ')} defeated!`;
      } else {
        const enemy = next.enemies.find((e) => e.instanceId === targetInstanceId)!;
        targetName = enemy.name;
        const dealtMagnitude = withVulnerable(magnitude, enemy.statuses, VULNERABLE_PCT);
        const result = absorbDamage(enemy.hp, enemy.guard, dealtMagnitude);
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
            ? `dealing ${dealtMagnitude} -- Guard absorbs ${result.absorbed}, ${dealt} gets through`
            : `dealing ${dealt} to ${enemy.name}`;
        if (!survives) effectDesc += ` -- ${enemy.name} is defeated!`;
      }
    } else {
      targetName = 'you';
      const dealtMagnitude = withVulnerable(magnitude, next.playerStatuses, VULNERABLE_PCT);
      const result = absorbDamage(next.playerHP, next.playerGuard, dealtMagnitude);
      const dealt = next.playerHP - result.hp;
      next = { ...next, playerHP: result.hp, playerGuard: result.guard };
      effectDesc =
        result.absorbed > 0
          ? `dealing ${dealtMagnitude} -- Guard absorbs ${result.absorbed}, ${dealt} gets through`
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
      ? ` (weakened -${Math.round(WEAKEN_PCT * 100)}%, ${weakenStacks} turn${weakenStacks === 1 ? '' : 's'} left)`
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
        `${actorName} plays ${suitName(suit)}${targetName ? ` at ${targetName}` : ''} (${handCardIds.length} card(s) x ${tableCountAfterPlay} on the table)${weakenNote}${strengthNote} -- ${effectDesc}.`,
        snapshotOf(next),
      ),
    ],
  };

  if (actor.kind === 'player') {
    next = applyCurrencyOverflow(next, roomCountBeforeClaim);
  }
  next = applyRiders(next, actor, targetInstanceId, playedCards, tableCountAfterPlay, rng);
  next = applyRelics(next, actor, category, suit, targetInstanceId);

  return next;
}

/**
 * Fires every played card's rider effect (see types/specialCards.ts) -- runs
 * after the suit's own category effect (and its log line) has fully
 * resolved, and never touches the magnitude formula above (bonus-per-card
 * scales by tableCountAfterPlay, but still lands as a post-hoc add, same as
 * every other rider). Only a named-special card (specialId set) fires a
 * rider at all -- a plain card is nothing but its suit's base multiplicative
 * points (see config/specialCards.ts's riderForCard). A play's cards always
 * share one suit, so any riders they do fire always share one rider kind
 * too -- summed into a single combined bump per resource and one log line
 * per resource, rather than one line per card, since a big play can commit
 * many cards at once. bonus-damage reuses the same target the category
 * effect already resolved against -- only ever paired with threat/weaken/
 * poison suits, so targetInstanceId is guaranteed set for a player actor by
 * isLegalPlay's own requiresEnemyTarget check. `rng` is only needed for the
 * draw rider's drawCards call below; every other rider is deterministic.
 */
function applyRiders(
  state: CombatState,
  actor: Actor,
  targetInstanceId: string | undefined,
  playedCards: CreatureCard[],
  tableCountAfterPlay: number,
  rng: Rng,
): CombatState {
  let next = state;
  const actorName = actorNameOf(state, actor);

  const { bonusDamage, bonusGuard, bonusDamageAoe, bonusStatus, drawAmount, discardAmount, bonusPlays } = computeRiderTotals(playedCards, tableCountAfterPlay);

  // Single-card plays keep the flavorful source name (a named special's own
  // name, or the plain suit's name) in the log line; multi-card plays fold
  // every card's rider into one generic, correctly-pluralized line instead
  // of naming each contributor.
  const single = playedCards.length === 1 ? playedCards[0] : undefined;
  const sourceLabel = single ? (single.specialId ? specialCardById(single.specialId).name : suitName(single.suit)) : 'Rider effects';
  const plural = !single;

  // An enemy actor only ever has one possible target (the player), so its
  // "splash" rider is just ordinary bonus damage -- only a player actor with
  // more than one alive enemy actually needs the separate AOE branch below.
  const singleTargetBonusDamage = bonusDamage + (actor.kind === 'enemy' ? bonusDamageAoe : 0);

  if (singleTargetBonusDamage > 0) {
    if (actor.kind === 'player') {
      // The target may already have been defeated by this same play's own
      // category effect -- nothing left to hit.
      const enemy = next.enemies.find((e) => e.instanceId === targetInstanceId);
      if (enemy) {
        const result = absorbDamage(enemy.hp, enemy.guard, singleTargetBonusDamage);
        const dealt = enemy.hp - result.hp;
        const survives = result.hp > 0;
        next = {
          ...next,
          enemies: survives
            ? next.enemies.map((e) => (e.instanceId === enemy.instanceId ? { ...e, hp: result.hp, guard: result.guard } : e))
            : next.enemies.filter((e) => e.instanceId !== enemy.instanceId),
        };
        let msg = `${sourceLabel} also ${plural ? 'deal' : 'deals'} ${dealt} damage to ${enemy.name}${result.absorbed > 0 ? ` (Guard absorbs ${result.absorbed})` : ''}.`;
        if (!survives) msg += ` ${enemy.name} is defeated!`;
        next = { ...next, log: [...next.log, makeLog(next.turnNumber, 'player', 'rider', msg, snapshotOf(next))] };
      }
    } else {
      const result = absorbDamage(next.playerHP, next.playerGuard, singleTargetBonusDamage);
      const dealt = next.playerHP - result.hp;
      next = { ...next, playerHP: result.hp, playerGuard: result.guard };
      const msg = `${actorName}'s ${sourceLabel} also ${plural ? 'deal' : 'deals'} ${dealt} damage to you${result.absorbed > 0 ? ` (Guard absorbs ${result.absorbed})` : ''}.`;
      next = { ...next, log: [...next.log, makeLog(next.turnNumber, 'enemy', 'rider', msg, snapshotOf(next))] };
    }
  }

  if (actor.kind === 'player' && bonusDamageAoe > 0 && next.enemies.length > 0) {
    // Splash rider (MECHANIC_BRAINSTORM.md's AOE tier 1) -- unlike
    // bonusDamage above, this always hits every alive enemy, not just the
    // one chosen target.
    const results = next.enemies.map((e) => {
      const result = absorbDamage(e.hp, e.guard, bonusDamageAoe);
      return { instanceId: e.instanceId, name: e.name, result, dealt: e.hp - result.hp };
    });
    next = {
      ...next,
      enemies: next.enemies
        .map((e) => {
          const r = results.find((x) => x.instanceId === e.instanceId)!;
          return { ...e, hp: r.result.hp, guard: r.result.guard };
        })
        .filter((e) => e.hp > 0),
    };
    const totalDealt = results.reduce((sum, r) => sum + r.dealt, 0);
    const defeated = results.filter((r) => r.result.hp <= 0).map((r) => r.name);
    let msg = `${sourceLabel} also ${plural ? 'splash' : 'splashes'} ${totalDealt} damage total across ${results.length} enem${results.length === 1 ? 'y' : 'ies'}.`;
    if (defeated.length > 0) msg += ` ${defeated.join(', ')} defeated!`;
    next = { ...next, log: [...next.log, makeLog(next.turnNumber, 'player', 'rider', msg, snapshotOf(next))] };
  }

  if (bonusGuard > 0) {
    // bonus-guard -- always self-targeted.
    if (actor.kind === 'player') {
      next = { ...next, playerGuard: next.playerGuard + bonusGuard };
      next = {
        ...next,
        log: [...next.log, makeLog(next.turnNumber, 'player', 'rider', `${sourceLabel} also ${plural ? 'raise' : 'raises'} Guard to ${next.playerGuard}.`, snapshotOf(next))],
      };
    } else {
      next = updateEnemy(next, actor.instanceId, (e) => ({ ...e, guard: e.guard + bonusGuard }));
      const newGuard = next.enemies.find((e) => e.instanceId === actor.instanceId)!.guard;
      next = {
        ...next,
        log: [...next.log, makeLog(next.turnNumber, 'enemy', 'rider', `${actorName}'s ${sourceLabel} also ${plural ? 'raise' : 'raises'} Guard to ${newGuard}.`, snapshotOf(next))],
      };
    }
  }

  // bonus-status -- same self-vs-opponent targeting rule as applyRelics'
  // status-on-claim (below): boon/guard/strength suits are self-targeting,
  // threat/weaken/poison suits land on whatever the play's category effect
  // already targeted. A play's cards always share one suit, so `category`
  // here is the same for every entry in the bag.
  const statusEntries = Object.entries(bonusStatus) as [StatusId, number][];
  if (statusEntries.length > 0) {
    const category = suitCategory(playedCards[0].suit);
    const selfTargeting = category === 'boon' || category === 'guard' || category === 'strength';
    for (const [statusId, amount] of statusEntries) {
      const statusName = STATUS_DEFS[statusId].name;
      if (selfTargeting) {
        if (actor.kind === 'player') {
          next = { ...next, playerStatuses: addStacks(next.playerStatuses, statusId, amount) };
          const total = stacksOf(next.playerStatuses, statusId);
          next = {
            ...next,
            log: [...next.log, makeLog(next.turnNumber, 'player', 'rider', `${sourceLabel} also ${plural ? 'grant' : 'grants'} you +${amount} ${statusName} (${total} stack${total === 1 ? '' : 's'}).`, snapshotOf(next))],
          };
        } else {
          next = updateEnemy(next, actor.instanceId, (e) => ({ ...e, statuses: addStacks(e.statuses, statusId, amount) }));
          const total = stacksOf(next.enemies.find((e) => e.instanceId === actor.instanceId)!.statuses, statusId);
          next = {
            ...next,
            log: [...next.log, makeLog(next.turnNumber, 'enemy', 'rider', `${actorName}'s ${sourceLabel} also ${plural ? 'grant' : 'grants'} +${amount} ${statusName} (${total} stack${total === 1 ? '' : 's'}).`, snapshotOf(next))],
          };
        }
      } else {
        if (actor.kind === 'player') {
          const enemy = next.enemies.find((e) => e.instanceId === targetInstanceId);
          if (enemy) {
            next = updateEnemy(next, enemy.instanceId, (e) => ({ ...e, statuses: addStacks(e.statuses, statusId, amount) }));
            const total = stacksOf(next.enemies.find((e) => e.instanceId === enemy.instanceId)!.statuses, statusId);
            next = {
              ...next,
              log: [...next.log, makeLog(next.turnNumber, 'player', 'rider', `${sourceLabel} also ${plural ? 'inflict' : 'inflicts'} +${amount} ${statusName} on ${enemy.name} (${total} stack${total === 1 ? '' : 's'}).`, snapshotOf(next))],
            };
          }
        } else {
          next = { ...next, playerStatuses: addStacks(next.playerStatuses, statusId, amount) };
          const total = stacksOf(next.playerStatuses, statusId);
          next = {
            ...next,
            log: [...next.log, makeLog(next.turnNumber, 'enemy', 'rider', `${actorName}'s ${sourceLabel} also ${plural ? 'inflict' : 'inflicts'} +${amount} ${statusName} on you (${total} stack${total === 1 ? '' : 's'}).`, snapshotOf(next))],
          };
        }
      }
    }
  }

  // draw -- always benefits whoever played the card, from their own
  // drawPile/discardPile (drawCards already handles reshuffling on empty --
  // see deckState.ts). May draw fewer than requested if both piles run dry;
  // drawn.length (not the requested amount) is what's logged.
  if (drawAmount > 0) {
    if (actor.kind === 'player') {
      const { drawn, drawPile, discardPile } = drawCards(next.drawPile, next.discardPile, drawAmount, rng);
      if (drawn.length > 0) {
        next = { ...next, playerHand: [...next.playerHand, ...drawn], drawPile, discardPile };
        next = {
          ...next,
          log: [...next.log, makeLog(next.turnNumber, 'player', 'rider', `${sourceLabel} also draws ${drawn.length} card${drawn.length === 1 ? '' : 's'}.`, snapshotOf(next))],
        };
      }
    } else {
      const enemy = next.enemies.find((e) => e.instanceId === actor.instanceId)!;
      const { drawn, drawPile, discardPile } = drawCards(enemy.drawPile, enemy.discardPile, drawAmount, rng);
      if (drawn.length > 0) {
        next = updateEnemy(next, actor.instanceId, (e) => ({ ...e, hand: [...e.hand, ...drawn], drawPile, discardPile }));
        next = {
          ...next,
          log: [...next.log, makeLog(next.turnNumber, 'enemy', 'rider', `${actorName}'s ${sourceLabel} also draws ${drawn.length} card${drawn.length === 1 ? '' : 's'}.`, snapshotOf(next))],
        };
      }
    }
  }

  // discard -- always targets the opponent (only ever paired with threat/
  // weaken/poison suits, so targetInstanceId is set for a player actor same
  // as bonus-damage above). Deterministic: the first discardAmount cards in
  // the target's own hand order, no rng needed. Silently discards fewer if
  // the target's hand is already smaller than discardAmount.
  if (discardAmount > 0) {
    if (actor.kind === 'player') {
      const enemy = next.enemies.find((e) => e.instanceId === targetInstanceId);
      if (enemy) {
        const toDiscard = enemy.hand.slice(0, discardAmount);
        if (toDiscard.length > 0) {
          next = updateEnemy(next, enemy.instanceId, (e) => ({ ...e, hand: e.hand.slice(toDiscard.length), discardPile: [...e.discardPile, ...toDiscard] }));
          next = {
            ...next,
            log: [...next.log, makeLog(next.turnNumber, 'player', 'rider', `${sourceLabel} also forces ${enemy.name} to discard ${toDiscard.length} card${toDiscard.length === 1 ? '' : 's'}.`, snapshotOf(next))],
          };
        }
      }
    } else {
      const toDiscard = next.playerHand.slice(0, discardAmount);
      if (toDiscard.length > 0) {
        next = { ...next, playerHand: next.playerHand.slice(toDiscard.length), discardPile: [...next.discardPile, ...toDiscard] };
        next = {
          ...next,
          log: [...next.log, makeLog(next.turnNumber, 'enemy', 'rider', `${actorName}'s ${sourceLabel} also forces you to discard ${toDiscard.length} card${toDiscard.length === 1 ? '' : 's'}.`, snapshotOf(next))],
        };
      }
    }
  }

  // bonus-plays -- Quake's rider-sized cousin, same state.playsRemaining
  // Quake itself tops up (see PLAYER_PLAY_QUAKE below). Works correctly for
  // a player actor since PLAY_SET's own playsRemaining -= 1 runs after this
  // whole function returns (see applyCombatAction). A no-op in practice for
  // an enemy actor -- resolveEnemyTurn computes its play-count loop bound
  // once, locally, before looping, so bumping playsRemaining here doesn't
  // grant the enemy an extra iteration -- but harmless, and moot today
  // since no enemy roster (config/enemies.ts) holds a bonus-plays special.
  if (bonusPlays > 0) {
    next = { ...next, playsRemaining: next.playsRemaining + bonusPlays };
    const msg =
      actor.kind === 'player'
        ? `${sourceLabel} also grants ${bonusPlays} bonus play${bonusPlays === 1 ? '' : 's'} this turn.`
        : `${actorName}'s ${sourceLabel} also grants ${bonusPlays} bonus play${bonusPlays === 1 ? '' : 's'} this turn.`;
    next = {
      ...next,
      log: [...next.log, makeLog(next.turnNumber, actor.kind === 'player' ? 'player' : 'enemy', 'rider', msg, snapshotOf(next))],
    };
  }

  return next;
}

/**
 * Fires every held relic (config/relics.ts) whose scope matches the suit/
 * category just played -- runs after applyRiders, same reasoning: a relic
 * never touches the magnitude formula, it just layers a flat bonus on top
 * of an already-resolved play. rider-bonus relics reuse applyRiders' own
 * bonus-damage (enemy-or-player-targeted)/bonus-guard (self-targeted) split;
 * status-on-claim relics reuse performPlay's own addStacks calls, targeting
 * whatever the play's own category already targets (an enemy for
 * threat/weaken/poison, self for boon/guard/strength).
 */
function applyRelics(
  state: CombatState,
  actor: Actor,
  category: SuitCategory,
  suit: SuitId,
  targetInstanceId: string | undefined,
): CombatState {
  let next = state;
  const actorName = actorNameOf(state, actor);

  for (const relic of state.relics) {
    if (relic.effect.kind === 'rider-bonus') {
      const { scope, riderKind, amount } = relic.effect;
      const matches = scope.by === 'suit' ? scope.suit === suit : scope.category === category;
      if (!matches) continue;

      if (riderKind === 'bonus-damage') {
        if (actor.kind === 'player') {
          const enemy = next.enemies.find((e) => e.instanceId === targetInstanceId);
          if (enemy) {
            const result = absorbDamage(enemy.hp, enemy.guard, amount);
            const dealt = enemy.hp - result.hp;
            const survives = result.hp > 0;
            next = {
              ...next,
              enemies: survives
                ? next.enemies.map((e) => (e.instanceId === enemy.instanceId ? { ...e, hp: result.hp, guard: result.guard } : e))
                : next.enemies.filter((e) => e.instanceId !== enemy.instanceId),
            };
            let msg = `${relic.name} also deals ${dealt} damage to ${enemy.name}${result.absorbed > 0 ? ` (Guard absorbs ${result.absorbed})` : ''}.`;
            if (!survives) msg += ` ${enemy.name} is defeated!`;
            next = { ...next, log: [...next.log, makeLog(next.turnNumber, 'player', 'relic', msg, snapshotOf(next))] };
          }
        } else {
          const result = absorbDamage(next.playerHP, next.playerGuard, amount);
          const dealt = next.playerHP - result.hp;
          next = { ...next, playerHP: result.hp, playerGuard: result.guard };
          const msg = `${actorName}'s ${relic.name} also deals ${dealt} damage to you${result.absorbed > 0 ? ` (Guard absorbs ${result.absorbed})` : ''}.`;
          next = { ...next, log: [...next.log, makeLog(next.turnNumber, 'enemy', 'relic', msg, snapshotOf(next))] };
        }
      } else {
        // bonus-guard -- always self-targeted, same as applyRiders' own split.
        if (actor.kind === 'player') {
          next = { ...next, playerGuard: next.playerGuard + amount };
          next = {
            ...next,
            log: [...next.log, makeLog(next.turnNumber, 'player', 'relic', `${relic.name} also raises Guard to ${next.playerGuard}.`, snapshotOf(next))],
          };
        } else {
          next = updateEnemy(next, actor.instanceId, (e) => ({ ...e, guard: e.guard + amount }));
          const newGuard = next.enemies.find((e) => e.instanceId === actor.instanceId)!.guard;
          next = {
            ...next,
            log: [...next.log, makeLog(next.turnNumber, 'enemy', 'relic', `${actorName}'s ${relic.name} also raises Guard to ${newGuard}.`, snapshotOf(next))],
          };
        }
      }
    } else if (relic.effect.kind === 'guard-strip') {
      // Sunder (MECHANIC_BRAINSTORM.md's guard-strip): an instant, one-time
      // Guard removal, capped at the target's current Guard -- reuses
      // rider-bonus's own bonus-damage target resolution (the opposing side
      // for whoever played the matching suit/category), but strips Guard
      // instead of dealing damage. Never decays, never stacks -- there's no
      // StatusBag entry for it at all.
      const { scope, amount } = relic.effect;
      const matches = scope.by === 'suit' ? scope.suit === suit : scope.category === category;
      if (!matches) continue;

      if (actor.kind === 'player') {
        const enemy = next.enemies.find((e) => e.instanceId === targetInstanceId);
        if (enemy && enemy.guard > 0) {
          const stripped = Math.min(enemy.guard, amount);
          next = updateEnemy(next, enemy.instanceId, (e) => ({ ...e, guard: e.guard - stripped }));
          next = {
            ...next,
            log: [
              ...next.log,
              makeLog(next.turnNumber, 'player', 'relic', `${relic.name} also strips ${stripped} Guard from ${enemy.name}.`, snapshotOf(next)),
            ],
          };
        }
      } else if (next.playerGuard > 0) {
        const stripped = Math.min(next.playerGuard, amount);
        next = { ...next, playerGuard: next.playerGuard - stripped };
        next = {
          ...next,
          log: [
            ...next.log,
            makeLog(next.turnNumber, 'enemy', 'relic', `${actorName}'s ${relic.name} also strips ${stripped} Guard from you.`, snapshotOf(next)),
          ],
        };
      }
    } else {
      // status-on-claim
      if (relic.effect.suit !== suit) continue;
      const { statusId, amount } = relic.effect;
      const selfTargeting = category === 'boon' || category === 'guard' || category === 'strength';

      if (selfTargeting) {
        if (actor.kind === 'player') {
          next = { ...next, playerStatuses: addStacks(next.playerStatuses, statusId, amount) };
          const totalStacks = stacksOf(next.playerStatuses, statusId);
          next = {
            ...next,
            log: [
              ...next.log,
              makeLog(next.turnNumber, 'player', 'relic', `${relic.name} also grants you +${amount} ${STATUS_DEFS[statusId].name} (${totalStacks} stack${totalStacks === 1 ? '' : 's'}).`, snapshotOf(next)),
            ],
          };
        } else {
          next = updateEnemy(next, actor.instanceId, (e) => ({ ...e, statuses: addStacks(e.statuses, statusId, amount) }));
          const totalStacks = stacksOf(next.enemies.find((e) => e.instanceId === actor.instanceId)!.statuses, statusId);
          next = {
            ...next,
            log: [
              ...next.log,
              makeLog(next.turnNumber, 'enemy', 'relic', `${actorName}'s ${relic.name} also grants +${amount} ${STATUS_DEFS[statusId].name} (${totalStacks} stack${totalStacks === 1 ? '' : 's'}).`, snapshotOf(next)),
            ],
          };
        }
      } else {
        if (actor.kind === 'player') {
          const enemy = next.enemies.find((e) => e.instanceId === targetInstanceId);
          if (enemy) {
            next = updateEnemy(next, enemy.instanceId, (e) => ({ ...e, statuses: addStacks(e.statuses, statusId, amount) }));
            const totalStacks = stacksOf(next.enemies.find((e) => e.instanceId === enemy.instanceId)!.statuses, statusId);
            next = {
              ...next,
              log: [
                ...next.log,
                makeLog(next.turnNumber, 'player', 'relic', `${relic.name} also inflicts +${amount} ${STATUS_DEFS[statusId].name} on ${enemy.name} (${totalStacks} stack${totalStacks === 1 ? '' : 's'}).`, snapshotOf(next)),
              ],
            };
          }
        } else {
          next = { ...next, playerStatuses: addStacks(next.playerStatuses, statusId, amount) };
          const totalStacks = stacksOf(next.playerStatuses, statusId);
          next = {
            ...next,
            log: [
              ...next.log,
              makeLog(next.turnNumber, 'enemy', 'relic', `${actorName}'s ${relic.name} also inflicts +${amount} ${STATUS_DEFS[statusId].name} on you (${totalStacks} stack${totalStacks === 1 ? '' : 's'}).`, snapshotOf(next)),
            ],
          };
        }
      }
    }
  }

  return next;
}

// --- Potions ---------------------------------------------------------------
// Free Claim and Salt (config/potions.ts) both act directly on
// state.table/claimRoomCards, deliberately outside the play system: no
// played cards, no discard, no rider, no relic hook, no Strength/Weaken --
// see MECHANIC_BRAINSTORM.md's "Potions" entry for why that's the point.
// Always player-actor only (no enemy analog), always a free action (no play
// spent, turn doesn't end -- see applyCombatAction's dispatch below).

function removeOnePotion(potions: PotionDef[], kind: PotionKind): PotionDef[] {
  const idx = potions.findIndex((p) => p.kind === kind);
  if (idx === -1) return potions;
  return [...potions.slice(0, idx), ...potions.slice(idx + 1)];
}

/**
 * Resolves `amount` (the suit's current table total, every owner combined --
 * see getLegalFreeClaimUses) directly as the suit's category effect, the
 * same threat/boon/guard/weaken-poison/strength split performPlay's own
 * switch uses, but flat -- no hand-count multiplier, no Strength/Weaken
 * folded in. Claims the room's own matching cards (claimRoomCards) the same
 * way a real play would, but never appends new table cards (there's no
 * played set backing this).
 */
function resolveFreeClaimEffect(
  state: CombatState,
  suit: SuitId,
  targetInstanceId: string | undefined,
  amount: number,
): CombatState {
  const category = suitCategory(suit);
  // amount (above) is the table total across every owner -- currency
  // overflow specifically cares about the room's own pile, so this is read
  // separately (see applyCurrencyOverflow).
  const roomCountBeforeClaim = roomOwnedCount(state.table, suit);
  let next: CombatState = { ...state, table: claimRoomCards(state.table, suit) };
  let effectDesc: string;
  let targetName: string | undefined;

  if (category === 'threat') {
    const enemy = next.enemies.find((e) => e.instanceId === targetInstanceId)!;
    targetName = enemy.name;
    const result = absorbDamage(enemy.hp, enemy.guard, amount);
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
        ? `dealing ${amount} -- Guard absorbs ${result.absorbed}, ${dealt} gets through`
        : `dealing ${dealt} to ${enemy.name}`;
    if (!survives) effectDesc += ` -- ${enemy.name} is defeated!`;
  } else if (category === 'boon') {
    next = { ...next, playerHP: Math.min(state.playerHPMax, next.playerHP + amount) };
    effectDesc = `healing ${amount} HP`;
  } else if (category === 'guard') {
    next = { ...next, playerGuard: next.playerGuard + amount };
    effectDesc = `raising Guard to ${next.playerGuard}`;
  } else if (category === 'weaken' || category === 'poison') {
    const statusId: StatusId = category;
    const enemy = next.enemies.find((e) => e.instanceId === targetInstanceId)!;
    targetName = enemy.name;
    next = updateEnemy(next, enemy.instanceId, (e) => ({ ...e, statuses: addStacks(e.statuses, statusId, amount) }));
    const totalStacks = stacksOf(next.enemies.find((e) => e.instanceId === enemy.instanceId)!.statuses, statusId);
    effectDesc = `inflicting +${amount} ${STATUS_DEFS[statusId].name} on ${enemy.name} (${totalStacks} stack${totalStacks === 1 ? '' : 's'})`;
  } else {
    // strength: self-buff.
    next = { ...next, playerStatuses: addStacks(next.playerStatuses, 'strength', amount) };
    const totalStacks = stacksOf(next.playerStatuses, 'strength');
    effectDesc = `gaining +${amount} Strength (${totalStacks} stack${totalStacks === 1 ? '' : 's'})`;
  }

  next = {
    ...next,
    log: [
      ...next.log,
      makeLog(
        next.turnNumber,
        'player',
        'potion',
        `Player uses Free Claim on ${suitName(suit)}${targetName ? ` at ${targetName}` : ''} (flat ${amount}, no play spent) -- ${effectDesc}.`,
        snapshotOf(next),
      ),
    ],
  };
  return applyCurrencyOverflow(next, roomCountBeforeClaim);
}

/** Discards the room's own pile of `suit` outright -- no effect resolved, same claimRoomCards call a real play's claim uses, just without reading the count into anything. */
function resolveSaltEffect(state: CombatState, suit: SuitId, roomCount: number): CombatState {
  let next: CombatState = { ...state, table: claimRoomCards(state.table, suit) };
  next = {
    ...next,
    log: [
      ...next.log,
      makeLog(
        next.turnNumber,
        'player',
        'potion',
        `Player uses Salt on ${suitName(suit)}, discarding the room's pile of ${roomCount} (no play spent).`,
        snapshotOf(next),
      ),
    ],
  };
  return applyCurrencyOverflow(next, roomCount);
}

// --- Enemy turn resolution -----------------------------------------------

function resolveEnemyTurn(state: CombatState, rng: Rng): CombatState {
  const enemyId = state.enemies[state.activeEnemyIndex].instanceId;
  let next: CombatState = { ...state, table: wipeOwnerTable(state.table, enemyId) };

  // Haste/Slow adjust this enemy's own play allotment for its turn, +1/-1
  // per stack, floored at 0 -- computed once up front from the statuses it
  // enters its turn with, same as the player's own playsRemaining reseed
  // (see endTurn's round-end branch below).
  const enteringEnemy = next.enemies.find((e) => e.instanceId === enemyId)!;
  const playAllotment = Math.max(
    0,
    ENEMY_PLAYS_PER_TURN + stacksOf(enteringEnemy.statuses, 'haste') - stacksOf(enteringEnemy.statuses, 'slow'),
  );

  for (let i = 0; i < playAllotment; i++) {
    const currentEnemy = next.enemies.find((e) => e.instanceId === enemyId)!;
    const choice = chooseEnemyPlay(currentEnemy, next.table, rng);
    if (!choice) {
      next = {
        ...next,
        log: [...next.log, makeLog(next.turnNumber, 'enemy', 'pass', `${currentEnemy.name} has nothing to play.`, snapshotOf(next))],
      };
      break;
    }
    next = performPlay(next, { kind: 'enemy', instanceId: enemyId }, choice.suit, undefined, choice.handCardIds, rng);
  }

  // Tick this enemy's own statuses once, at the true end of its own turn --
  // a Poison tick can drop this enemy to 0 HP; it's left in the array as a
  // "corpse" rather than removed here -- removing it now would shrink
  // `enemies` and desync activeEnemyIndex against enemies still owed a turn
  // this round (see endTurn's round-end sweep, the one safe place to
  // actually drop it).
  const postPlays = next.enemies.find((e) => e.instanceId === enemyId)!;
  const { statuses: tickedStatuses, poisonDamage, regenHeal } = tickStatuses(postPlays.statuses);
  let tickedHp = postPlays.hp;
  const tickedGuard = postPlays.guard;
  let poisonMessage = '';
  if (regenHeal > 0) {
    tickedHp = Math.min(postPlays.hpMax, tickedHp + regenHeal);
  }
  if (poisonDamage > 0) {
    // Poison ignores Guard entirely -- it lands straight on HP, unlike an
    // ordinary threat/attack hit (see absorbDamage above).
    tickedHp = Math.max(0, tickedHp - poisonDamage);
    poisonMessage = `${postPlays.name}'s poison deals ${poisonDamage}.`;
    if (tickedHp <= 0) poisonMessage += ` ${postPlays.name} is defeated!`;
  }

  next = updateEnemy(next, enemyId, (e) => ({ ...e, hp: tickedHp, guard: tickedGuard, statuses: tickedStatuses }));
  if (regenHeal > 0) {
    next = { ...next, log: [...next.log, makeLog(next.turnNumber, 'system', 'regen', `${postPlays.name}'s regen heals ${regenHeal}.`, snapshotOf(next))] };
  }
  if (poisonMessage) {
    next = { ...next, log: [...next.log, makeLog(next.turnNumber, 'system', 'poison', poisonMessage, snapshotOf(next))] };
  }

  // Top the remaining hand back up to this enemy's own handSize, in
  // preparation for its next turn -- whatever it didn't play stays in hand
  // rather than being discarded, mirroring the player's own end-of-round
  // top-up.
  const beforeRedraw = next.enemies.find((e) => e.instanceId === enemyId)!;
  const { hand, drawPile, discardPile } = topUpHand(
    beforeRedraw.hand,
    beforeRedraw.drawPile,
    beforeRedraw.discardPile,
    enemyDefById(beforeRedraw.defId).handSize,
    rng,
  );
  next = updateEnemy(next, enemyId, (e) => ({ ...e, hand, drawPile, discardPile }));

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
  // True when a just-resolved PLAY_SET left the player with plays still
  // remaining in the pool -- skips the player-turn-end machinery below
  // (status ticks, the flip to the enemy phase) so the same player turn
  // simply continues. Never set for PLAYER_PASS or ENEMY_TURN,
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
    const { statuses: tickedStatuses, poisonDamage, regenHeal } = tickStatuses(next.playerStatuses);
    let playerHP = next.playerHP;
    const playerGuard = next.playerGuard;
    let log = next.log;
    if (regenHeal > 0) {
      playerHP = Math.min(next.playerHPMax, playerHP + regenHeal);
      log = [
        ...log,
        makeLog(next.turnNumber, 'system', 'regen', `Regen heals ${regenHeal}.`, { playerHP, playerHPMax: next.playerHPMax, playerGuard }),
      ];
    }
    if (poisonDamage > 0) {
      // Poison ignores Guard entirely -- it lands straight on HP, unlike an
      // ordinary threat/attack hit (see absorbDamage above).
      playerHP = Math.max(0, playerHP - poisonDamage);
      log = [
        ...log,
        makeLog(
          next.turnNumber,
          'system',
          'poison',
          `Poison deals ${poisonDamage}.`,
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
      // Plays only matter during the player's own turn -- zeroed here so any
      // leftover pool (base or Quake-topped) can't leak into bookkeeping
      // across the enemy phase; reset properly when control returns to the
      // player below.
      playsRemaining: 0,
    };
  }

  if (!isRoundEnd) {
    return {
      ...next,
      activeEnemyIndex: state.activeEnemyIndex + 1,
      turnNumber: next.turnNumber + 1,
    };
  }

  // The whole enemy phase just concluded -- a new round begins. Unlike the
  // player and every enemy, the room never wipes its own prior
  // contribution here -- any of its cards nobody claimed are still fair
  // game, so a fresh neutral wave is simply dealt on top of them (see
  // claimRoomCards for the only way room cards ever leave the table).
  // The player's own table area still wipes, then the player's hand tops
  // back up to playerHandSize -- whatever's left in hand from last turn
  // stays, only the shortfall is drawn.
  const newTurnNumber = next.turnNumber + 1;
  const freshRoomCards = dealRoomTableForRound(rng, next.roomParams, `room-deal-t${newTurnNumber}`);
  const table = wipeOwnerTable([...next.table, ...freshRoomCards], 'player');

  const { hand, drawPile, discardPile } = topUpHand(
    next.playerHand,
    next.drawPile,
    next.discardPile,
    next.roomParams.playerHandSize,
    rng,
  );
  next = {
    ...next,
    table,
    playerHand: hand,
    drawPile,
    discardPile,
    log: [
      ...next.log,
      makeLog(newTurnNumber, 'system', 'room-deal', 'The room deals a fresh wave onto the table.', snapshotOf(next)),
      makeLog(newTurnNumber, 'system', 'redraw', 'Player tops their hand back up.', {
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
    // Haste/Slow adjust the base allotment by +1/-1 per stack, floored at 0
    // -- see resolveEnemyTurn's identical enemy-side reseed above.
    playsRemaining: Math.max(
      0,
      PLAYS_PER_TURN_BASE + stacksOf(next.playerStatuses, 'haste') - stacksOf(next.playerStatuses, 'slow'),
    ),
  };
}

// --- Public action dispatch ------------------------------------------------

export function applyCombatAction(state: CombatState, action: CombatAction, rng: Rng): CombatState {
  if (state.status !== 'active') return state;

  if (action.type === 'PLAY_SET') {
    if (state.activeTurn !== 'player') return state;
    if (!isLegalPlay(state, action.suit, action.targetInstanceId, action.handCardIds)) return state;
    let played = performPlay(state, { kind: 'player' }, action.suit, action.targetInstanceId, action.handCardIds, rng);
    // Every play spends exactly one of the turn's plays regardless of how
    // many hand cards it used -- the pool itself is what a bonus like
    // Quake's tops up, so there's no separate spend-bypass case any more.
    played = { ...played, playsRemaining: played.playsRemaining - 1 };
    const turnContinues = played.playsRemaining > 0;
    return endTurn(played, rng, turnContinues);
  }

  if (action.type === 'PLAYER_PLAY_QUAKE') {
    if (state.activeTurn !== 'player') return state;
    const card = state.playerHand.find((c) => c.id === action.cardId);
    if (!card || card.kind !== 'quake') return state;
    // A free action -- doesn't spend a play itself and never ends the turn;
    // it just tops up the same numeric pool PLAY_SET spends from. Playing it
    // discards it, same as any other played card, so it comes back around
    // next reshuffle instead of vanishing for the room.
    const playsRemaining = state.playsRemaining + QUAKE_BONUS_PLAYS;
    return {
      ...state,
      playerHand: state.playerHand.filter((c) => c.id !== action.cardId),
      discardPile: [...state.discardPile, card],
      playsRemaining,
      log: [
        ...state.log,
        makeLog(
          state.turnNumber,
          'player',
          'quake',
          `Player unleashes the Quake card -- +${QUAKE_BONUS_PLAYS} plays this turn (${playsRemaining} now available)!`,
          snapshotOf(state),
        ),
      ],
    };
  }

  if (action.type === 'PLAYER_PLAY_CLEAVE') {
    if (state.activeTurn !== 'player') return state;
    const card = state.playerHand.find((c) => c.id === action.cardId);
    if (!card || card.kind !== 'cleave') return state;
    // A free action, same shape as Quake -- doesn't spend a play, doesn't
    // end the turn. It flags the next threat play to hit every alive
    // enemy (see isLegalPlay/performPlay's cleaveActive checks) rather than
    // granting anything numeric itself.
    return {
      ...state,
      playerHand: state.playerHand.filter((c) => c.id !== action.cardId),
      discardPile: [...state.discardPile, card],
      cleaveActive: true,
      log: [
        ...state.log,
        makeLog(
          state.turnNumber,
          'player',
          'cleave',
          'Player unleashes the Cleave card -- the next threat play this turn hits every alive enemy!',
          snapshotOf(state),
        ),
      ],
    };
  }

  if (action.type === 'USE_FREE_CLAIM_POTION') {
    if (state.activeTurn !== 'player') return state;
    const legal = getLegalFreeClaimUses(state).find(
      (u) => u.suit === action.suit && u.targetInstanceId === action.targetInstanceId,
    );
    if (!legal) return state;
    const resolved = resolveFreeClaimEffect(state, action.suit, action.targetInstanceId, legal.amount);
    return { ...resolved, potions: removeOnePotion(state.potions, 'free-claim') };
  }

  if (action.type === 'USE_SALT_POTION') {
    if (state.activeTurn !== 'player') return state;
    const legal = getLegalSaltUses(state).find((u) => u.suit === action.suit);
    if (!legal) return state;
    const resolved = resolveSaltEffect(state, action.suit, legal.amount);
    return { ...resolved, potions: removeOnePotion(state.potions, 'salt') };
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
