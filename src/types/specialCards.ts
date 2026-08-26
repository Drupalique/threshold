import type { SuitId } from './suits';

/**
 * A rider effect layered on top of a suit's normal category effect when a
 * specific tagged card is part of a resolving play (see CreatureCard.specialId
 * and combatEngine.ts's applyRiders). Deliberately independent of the
 * table-set magnitude formula -- these are fixed-size bonuses, not
 * multipliers, so adding one never changes how the core claim math works.
 *
 * Kept to the two things the game is fundamentally about: bonus-damage hits
 * whatever the play's own category already targets (an enemy for a player
 * actor, the player for an enemy actor) and is only ever paired with suits
 * that already resolve against a target (threat/weaken/poison). bonus-guard
 * always affects whoever played the card, and is the only rider used on
 * self-targeting suits (boon/guard/strength).
 */
export type RiderEffect =
  | { kind: 'bonus-damage'; amount: number }
  | { kind: 'bonus-guard'; amount: number };

export interface SpecialCardDef {
  id: string;
  suit: SuitId;
  name: string;
  description: string;
  rider: RiderEffect;
}
