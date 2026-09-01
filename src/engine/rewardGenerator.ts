import type { SuitId } from '../types/suits';
import type { RewardOption } from '../types/run';
import type { RelicDef } from '../types/relics';
import type { PotionDef } from '../types/potions';
import type { Rng } from './rng';
import { uniformPick, weightedPick, pickDistinct } from './weightedPick';
import { SPECIAL_CARD_DEFS } from '../config/specialCards';
import { RELIC_DEFS } from '../config/relics';
import { POTION_DEFS } from '../config/potions';
import {
  THREAT_SUITS,
  BOON_SUIT,
  GUARD_SUIT,
  WEAKEN_SUIT,
  POISON_SUIT,
  STRENGTH_SUIT,
  QUAKE_REWARD_RATIO,
  SPECIAL_REWARD_RATIO,
  RELIC_REWARD_RATIO,
  POTION_REWARD_RATIO,
  POTION_INVENTORY_CAP,
  REWARD_OPTION_COUNT,
  SHRINE_OPTION_COUNT,
} from '../config/constants';

// Every suit the reward screen can offer -- unlike a room's pool/hand (which
// are constrained to the room's own threatSuits), a reward is a deck-
// building choice across the whole game, so all suits are always in play.
const REWARD_SUITS: SuitId[] = [...THREAT_SUITS, BOON_SUIT, GUARD_SUIT, WEAKEN_SUIT, POISON_SUIT, STRENGTH_SUIT];

type RewardCategory = 'suit' | 'special' | 'quake' | 'relic' | 'potion';

/** Relics from RELIC_DEFS not already present in `heldRelics` -- shared by both acquisition paths so neither ever offers a duplicate. */
function unheldRelics(heldRelics: RelicDef[]): RelicDef[] {
  const heldIds = new Set(heldRelics.map((r) => r.id));
  return RELIC_DEFS.filter((r) => !heldIds.has(r.id));
}

/**
 * MVP reward shape: a uniform pick across every non-Quake suit per slot,
 * Quake/a named special card (config/specialCards.ts)/a relic (config/
 * relics.ts)/a potion (config/potions.ts) each folded in at their own low
 * weight -- no removal/upgrade options yet. `depth` only feeds the returned
 * ids' uniqueness, not the odds; every slot draws from the same full
 * suit/special/relic/potion pool regardless of depth. Falls back to an
 * ordinary suit pick if every relic is already held (`heldRelics`) or the
 * potion inventory is already at POTION_INVENTORY_CAP (`heldPotions`),
 * rather than ever offering a relic duplicate or growing potions unbounded.
 */
export function generateRewardOptions(
  depth: number,
  rng: Rng,
  heldRelics: RelicDef[],
  heldPotions: PotionDef[],
): RewardOption[] {
  const offerableRelics = unheldRelics(heldRelics);
  const potionSlotAvailable = heldPotions.length < POTION_INVENTORY_CAP;
  const options: RewardOption[] = [];
  for (let i = 0; i < REWARD_OPTION_COUNT; i++) {
    const id = `reward-d${depth}-${i}`;
    const category = weightedPick<RewardCategory>(rng, [
      {
        weight:
          1 - QUAKE_REWARD_RATIO - SPECIAL_REWARD_RATIO - RELIC_REWARD_RATIO - POTION_REWARD_RATIO,
        value: 'suit',
      },
      { weight: SPECIAL_REWARD_RATIO, value: 'special' },
      { weight: QUAKE_REWARD_RATIO, value: 'quake' },
      { weight: offerableRelics.length > 0 ? RELIC_REWARD_RATIO : 0, value: 'relic' },
      { weight: potionSlotAvailable ? POTION_REWARD_RATIO : 0, value: 'potion' },
    ]);
    if (category === 'quake') {
      options.push({ id, optionType: 'card', card: { id, kind: 'quake' } });
    } else if (category === 'special') {
      const def = uniformPick(rng, SPECIAL_CARD_DEFS);
      options.push({ id, optionType: 'card', card: { id, kind: 'creature', suit: def.suit, specialId: def.id } });
    } else if (category === 'relic') {
      const relic = uniformPick(rng, offerableRelics);
      options.push({ id, optionType: 'relic', relic });
    } else if (category === 'potion') {
      const potion = uniformPick(rng, POTION_DEFS);
      options.push({ id, optionType: 'potion', potion });
    } else {
      options.push({ id, optionType: 'card', card: { id, kind: 'creature', suit: uniformPick(rng, REWARD_SUITS) } });
    }
  }
  return options;
}

/**
 * A shrine's relic offer -- generated live off run.rng (not precomputed in
 * the run tree, see types/room.ts's ShrineRoomInstance) so it can exclude
 * whatever's already in `heldRelics` by the time the player actually
 * arrives. Uniform, no Quake/special/suit filler -- a shrine only ever
 * offers relics.
 */
export function generateShrineOptions(rng: Rng, heldRelics: RelicDef[]): RelicDef[] {
  return pickDistinct(rng, unheldRelics(heldRelics), SHRINE_OPTION_COUNT);
}
