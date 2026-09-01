export type PotionKind = 'free-claim' | 'salt';

/**
 * A run-persistent, consumable item (`RunState.potions`/`CombatState.potions`)
 * -- unlike a `RelicDef`, potions are consumed on use and can stack in
 * duplicate (held as plain list entries, no per-instance id needed since
 * every entry of a given kind is interchangeable; see combatEngine.ts's
 * removeOnePotion). Both kinds act on `tableState.ts`'s claimRoomCards/
 * countTableSetSize, deliberately outside the play/hand economy -- see
 * combatEngine.ts's resolveFreeClaimEffect/resolveSaltEffect.
 */
export interface PotionDef {
  id: string;
  name: string;
  description: string;
  kind: PotionKind;
}
