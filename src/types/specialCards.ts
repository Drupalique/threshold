import type { SuitId } from './suits';
import type { StatusId } from './status';

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
 */
export type RiderEffect =
  | { kind: 'bonus-damage'; amount: number }
  | { kind: 'bonus-guard'; amount: number }
  | { kind: 'bonus-damage-aoe'; amount: number }
  | { kind: 'bonus-status'; statusId: StatusId; amount: number };

export interface SpecialCardDef {
  id: string;
  suit: SuitId;
  name: string;
  description: string;
  rider: RiderEffect;
}
