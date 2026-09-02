import type { RelicDef } from '../types/relics';

/**
 * First-cut relic roster -- not balance-tested, same spirit as
 * specialCards.ts's SPECIAL_CARD_DEFS. Two rider-bonus mutators (one per
 * bonus-damage/bonus-guard rider kind) and four status-on-claim charms,
 * picked to exercise both target-resolution branches applyRelics uses:
 * Wolf/Ember (threat, enemy-targeted) and Grace (boon, self-targeted).
 */
export const RELIC_DEFS: RelicDef[] = [
  {
    id: 'bloodletters-mark',
    name: "Bloodletter's Mark",
    description: 'Every threat play also deals 1 extra damage.',
    effect: { kind: 'rider-bonus', scope: { by: 'category', category: 'threat' }, riderKind: 'bonus-damage', amount: 1 },
  },
  {
    id: 'reinforced-plating',
    name: 'Reinforced Plating',
    description: 'Every Guard play also grants 1 extra Guard.',
    effect: { kind: 'rider-bonus', scope: { by: 'category', category: 'guard' }, riderKind: 'bonus-guard', amount: 1 },
  },
  {
    id: 'alphas-snare',
    name: "Alpha's Snare",
    description: 'Wolf claims also inflict 1 Weaken on the target.',
    effect: { kind: 'status-on-claim', suit: 'wolf', statusId: 'weaken', amount: 1 },
  },
  {
    id: 'smoldering-curse',
    name: 'Smoldering Curse',
    description: 'Ember claims also inflict 1 Weaken on the target.',
    effect: { kind: 'status-on-claim', suit: 'ember', statusId: 'weaken', amount: 1 },
  },
  {
    id: 'venomous-bite',
    name: 'Venomous Bite',
    description: 'Spider claims also inflict 1 Poison on the target.',
    effect: { kind: 'status-on-claim', suit: 'spider', statusId: 'poison', amount: 1 },
  },
  {
    id: 'blessing-of-vigor',
    name: 'Blessing of Vigor',
    description: 'Grace claims also grant 1 Strength.',
    effect: { kind: 'status-on-claim', suit: 'grace', statusId: 'strength', amount: 1 },
  },
  // The 4 new statuses (MECHANIC_BRAINSTORM.md's Vulnerable/Regen/Haste/Slow)
  // ship via this same status-on-claim effect, on suits that don't yet carry
  // a status relic -- no engine change needed, it's already generic over any
  // StatusId.
  {
    id: 'corroding-grip',
    name: 'Corroding Grip',
    description: 'Rot claims also inflict 1 Vulnerable on the target.',
    effect: { kind: 'status-on-claim', suit: 'rot', statusId: 'vulnerable', amount: 1 },
  },
  {
    id: 'numbing-toxin',
    name: 'Numbing Toxin',
    description: 'Venom claims also inflict 1 Slow on the target.',
    effect: { kind: 'status-on-claim', suit: 'venom', statusId: 'slow', amount: 1 },
  },
  {
    id: 'mending-bulwark',
    name: 'Mending Bulwark',
    description: 'Ward claims also grant 1 Regen.',
    effect: { kind: 'status-on-claim', suit: 'ward', statusId: 'regen', amount: 1 },
  },
  {
    id: 'fleetfoot-charm',
    name: 'Fleetfoot Charm',
    description: 'Vigor claims also grant 1 Haste.',
    effect: { kind: 'status-on-claim', suit: 'vigor', statusId: 'haste', amount: 1 },
  },
  {
    id: 'hexbreakers-edge',
    name: "Hexbreaker's Edge",
    description: 'Hex claims also strip 2 Guard from the target.',
    effect: { kind: 'guard-strip', scope: { by: 'suit', suit: 'hex' }, amount: 2 },
  },
];

export function relicById(id: string): RelicDef {
  const def = RELIC_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown relic def: ${id}`);
  return def;
}
