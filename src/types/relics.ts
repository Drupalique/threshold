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
 */
export type RelicEffect =
  | {
      kind: 'rider-bonus';
      scope: { by: 'suit'; suit: SuitId } | { by: 'category'; category: SuitCategory };
      riderKind: 'bonus-damage' | 'bonus-guard';
      amount: number;
    }
  | { kind: 'status-on-claim'; suit: SuitId; statusId: StatusId; amount: number };

export interface RelicDef {
  id: string;
  name: string;
  description: string;
  effect: RelicEffect;
}
