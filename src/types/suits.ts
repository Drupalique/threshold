import type { StatusId } from './status';

// A status-suit's category is exactly the StatusId it inflicts (weaken/
// poison/strength) -- claiming Hex applies Weaken stacks the same way
// claiming Wolf deals threat damage, so the category doubles as the lookup
// key into the shared StatusBag/addStacks machinery (see combatEngine.ts).
export type SuitCategory = 'threat' | 'boon' | 'guard' | StatusId;

export type SuitId =
  | 'wolf'
  | 'ember'
  | 'rot'
  | 'spider'
  | 'grace'
  | 'ward'
  | 'hex'
  | 'venom'
  | 'vigor';

export interface SuitDef {
  id: SuitId;
  name: string;
  category: SuitCategory;
  displayColor: string;
}
