import type { SuitId, SuitCategory } from './suits';
import type { StatusId } from './status';

/**
 * A passive, run-persistent effect layered on top of whatever a matching
 * play already does -- fires from combatEngine.ts's applyRelics, right after
 * a played card's own rider (see specialCards.ts's RiderEffect), and never
 * touches the table-set magnitude formula, same independence riders already
 * have. Two shapes:
 *
 * - `rider-bonus` generalizes a "rider mutator": an extra flat bonus-damage/
 *   bonus-guard, scoped to either one suit or a whole category, added on top
 *   of the play's own rider every time a matching suit is played.
 * - `status-on-claim` generalizes a "suit-bound charm": playing the scoped
 *   suit additionally inflicts status stacks, targeting whatever the play's
 *   own category already targets (an enemy for threat/weaken/poison, self
 *   for boon/guard/strength) -- same target split riders' bonus-damage/
 *   bonus-guard split already encodes.
 * - `guard-strip` (MECHANIC_BRAINSTORM.md's "Sunder") is an instant, one-time
 *   Guard removal from whoever the play's category resolves against (the
 *   same target rider-bonus's bonus-damage uses) -- capped at the target's
 *   current Guard, never a StatusBag stack: Guard itself never decays on its
 *   own, so a decaying debuff felt like the wrong shape for a one-time
 *   strip.
 */
export type RelicEffect =
  | {
      kind: 'rider-bonus';
      scope: { by: 'suit'; suit: SuitId } | { by: 'category'; category: SuitCategory };
      riderKind: 'bonus-damage' | 'bonus-guard';
      amount: number;
    }
  | { kind: 'status-on-claim'; suit: SuitId; statusId: StatusId; amount: number }
  | {
      kind: 'guard-strip';
      scope: { by: 'suit'; suit: SuitId } | { by: 'category'; category: SuitCategory };
      amount: number;
    };

export interface RelicDef {
  id: string;
  name: string;
  description: string;
  effect: RelicEffect;
}
