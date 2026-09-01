import type { SuitId } from '../types/suits';
import type { TableCard, TableOwnerId } from '../types/combat';
import type { RoomParams } from '../types/room';
import type { Rng } from './rng';
import { generateWeightedDeck } from './deckGenerator';
import { isCreatureCard } from '../types/cards';

/** How many live table cards of `suit` are currently visible, from every owner combined. */
export function countTableSetSize(table: TableCard[], suit: SuitId): number {
  return table.filter((c) => c.suit === suit).length;
}

/** How many of the room's own (ownerId: 'room') table cards of `suit` are currently visible -- unlike countTableSetSize, excludes the player's/an enemy's own contribution. Used to size claim-overflow currency (see combatEngine.ts's applyCurrencyOverflow), which is specifically about the room's own accumulated pile, not the table total. */
export function roomOwnedCount(table: TableCard[], suit: SuitId): number {
  return table.filter((c) => c.suit === suit && c.ownerId === 'room').length;
}

/** Removes every table card belonging to `ownerId` -- the "discard your own play area at the start of your turn" rule, applied identically to the player and each enemy. The room no longer goes through this: its cards persist across rounds and are only ever removed via claimRoomCards. */
export function wipeOwnerTable(table: TableCard[], ownerId: TableOwnerId): TableCard[] {
  return table.filter((c) => c.ownerId !== ownerId);
}

/**
 * Removes the room's own table cards of `suit` -- the "claim" a combatant
 * (player or enemy) makes on the room's neutral deal the moment a play
 * reads that suit's table count. Unclaimed room cards of other suits, and
 * every player/enemy contribution regardless of suit, are left untouched:
 * those only ever clear via their owner's own-turn-start wipe.
 */
export function claimRoomCards(table: TableCard[], suit: SuitId): TableCard[] {
  return table.filter((c) => !(c.suit === suit && c.ownerId === 'room'));
}

/** Generates one tableDealSize-sized batch of the room's neutral deal, tagged ownerId: 'room' -- reuses the same weighted-deck generator the room's pool used to be built from. */
export function dealRoomTable(rng: Rng, roomParams: RoomParams, idPrefix: string): TableCard[] {
  const dealt = generateWeightedDeck(
    roomParams.tableDealSize,
    idPrefix,
    {
      onSuitTargets: roomParams.threatSuits,
      onSuitRatio: roomParams.onSuitRatio,
      boonRatio: roomParams.boonRatio,
      guardRatio: roomParams.guardRatio,
      weakenRatio: roomParams.weakenRatio,
      poisonRatio: roomParams.poisonRatio,
      strengthRatio: roomParams.strengthRatio,
    },
    rng,
  );
  return dealt
    .filter(isCreatureCard)
    .map((c) => ({ id: c.id, suit: c.suit, ownerId: 'room' as const }));
}

/**
 * Rolls how many tableDealSize batches land on the table this round, fresh
 * from roomParams.dealsPerRound's own [min,max] every time this is called
 * (a room with min===max always deals the same count; a wider range makes
 * it erratic round to round), then deals and concatenates that many
 * independent batches. Each batch gets its own id sub-prefix so card ids
 * stay unique even when a room deals more than once in the same round.
 */
export function dealRoomTableForRound(rng: Rng, roomParams: RoomParams, idPrefix: string): TableCard[] {
  const { min, max } = roomParams.dealsPerRound;
  const batchCount = rng.int(min, max);
  const dealt: TableCard[] = [];
  for (let i = 0; i < batchCount; i++) {
    dealt.push(...dealRoomTable(rng, roomParams, `${idPrefix}-b${i}`));
  }
  return dealt;
}
