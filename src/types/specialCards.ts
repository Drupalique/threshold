import type { SuitId } from './suits';
import type { StatusId } from './status';

/**
 * A rider effect layered on top of a suit's normal category effect when a
 * specific tagged card is part of a resolving play (see CreatureCard.specialId
 * and combatEngine.ts's applyRiders). Every kind except bonus-per-card is a
 * fixed-size bonus, not a multiplier, so adding one never changes how the
 * core claim math works; bonus-per-card is the deliberate exception (see its
 * own note below).
 *
 * Kept to the two things the game is fundamentally about: bonus-damage hits
 * whatever the play's own category already targets (an enemy for a player
 * actor, the player for an enemy actor) and is only ever paired with suits
 * that already resolve against a target (threat/weaken/poison). bonus-guard
 * always affects whoever played the card, and is the only rider used on
 * self-targeting suits (boon/guard/strength). bonus-damage-aoe
 * (MECHANIC_BRAINSTORM.md's AOE tier 1, "splash") is bonus-damage's
 * multi-target sibling -- same threat-only pairing, but a player actor's
 * bonus lands on every alive enemy instead of the one chosen target (an
 * enemy actor, with only one possible target, just treats it as ordinary
 * bonus-damage -- see combatEngine's applyRiders). bonus-status reuses
 * relics.ts's status-on-claim targeting rule instead of inventing its own:
 * threat/weaken/poison suits inflict it on whatever the play's category
 * effect already targets (must be a debuff -- a buff would help the
 * opponent), boon/guard/strength suits grant it to whoever played the card
 * (must be a buff, mirroring bonus-guard's self-only reach).
 *
 * bonus-per-card is bonus-damage/bonus-guard's scaling sibling: instead of a
 * flat amount, it's `amount` multiplied by the suit's whole table-set size
 * once this play resolves (combatEngine's `tableCountAfterPlay` -- the "set"
 * this card is part of, not just the cards played this turn), then folded
 * into the exact same bonusDamage/bonusGuard bucket bonus-damage/bonus-guard
 * already feed -- so it reuses their application code untouched and is
 * routed by category the same way. Deliberately rare-tier (SpecialCardDef's
 * own `rarity` field): a late claim into a large table set can make this
 * swing far harder than a flat rider ever could.
 *
 * draw/discard/bonus-plays are the other three "beyond damage/guard/status"
 * riders: draw always benefits whoever played the card (own draw/discard
 * pile, any suit category); discard always targets the opponent (only ever
 * paired with threat/weaken/poison suits, same reasoning as bonus-damage, so
 * "opponent" is always well-defined) and removes the first `amount` cards
 * from their hand, no rng needed; bonus-plays always benefits whoever played
 * the card by bumping CombatState's shared `playsRemaining`, the same field
 * Quake tops up.
 */
export type RiderEffect =
  | { kind: 'bonus-damage'; amount: number }
  | { kind: 'bonus-guard'; amount: number }
  | { kind: 'bonus-damage-aoe'; amount: number }
  | { kind: 'bonus-status'; statusId: StatusId; amount: number }
  | { kind: 'bonus-per-card'; amount: number }
  | { kind: 'draw'; amount: number }
  | { kind: 'discard'; amount: number }
  | { kind: 'bonus-plays'; amount: number };

export type SpecialCardRarity = 'common' | 'rare';

export interface SpecialCardDef {
  id: string;
  suit: SuitId;
  name: string;
  description: string;
  rider: RiderEffect;
  /** Skews reward/shop odds (see config/specialCards.ts's RARITY_WEIGHT) -- absent means 'common', the same odds every special had before rarity existed. */
  rarity?: SpecialCardRarity;
}
