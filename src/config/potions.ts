import type { PotionDef } from '../types/potions';

/** The two potion kinds from MECHANIC_BRAINSTORM.md's "Potions" entry -- see combatEngine.ts's resolveFreeClaimEffect/resolveSaltEffect for what each actually does. */
export const POTION_DEFS: PotionDef[] = [
  {
    id: 'free-claim',
    name: 'Free Claim',
    description: "Resolve a suit's current table total as a flat effect, without spending a play or a hand card.",
    kind: 'free-claim',
  },
  {
    id: 'salt',
    name: 'Salt',
    description: "Discard the room's accumulated pile for one suit outright, without resolving it.",
    kind: 'salt',
  },
];

export function potionById(id: string): PotionDef {
  const def = POTION_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown potion def: ${id}`);
  return def;
}
