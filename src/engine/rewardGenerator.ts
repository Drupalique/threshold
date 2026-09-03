import type { SuitId } from '../types/suits';
import type { Card } from '../types/cards';
import type { RewardOption, ShopOption, DeckActionKind } from '../types/run';
import type { RelicDef } from '../types/relics';
import type { PotionDef } from '../types/potions';
import type { Rng } from './rng';
import { uniformPick, weightedPick, pickDistinct } from './weightedPick';
import { SPECIAL_CARD_DEFS, RARITY_WEIGHT } from '../config/specialCards';
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
  CLEAVE_REWARD_RATIO,
  SPECIAL_REWARD_RATIO,
  RELIC_REWARD_RATIO,
  POTION_REWARD_RATIO,
  POTION_INVENTORY_CAP,
  REWARD_OPTION_COUNT,
  REWARD_THREAT_SUIT_BIAS,
  SHRINE_OPTION_COUNT,
  SHOP_OPTION_COUNT,
  SHOP_CARD_PRICE,
  SHOP_RELIC_PRICE,
  SHOP_POTION_PRICE,
  SHOP_DECK_ACTION_RATIO,
  SHOP_TRANSFORM_PRICE,
  SHOP_DUPLICATE_PRICE,
  SHOP_UPGRADE_PRICE,
} from '../config/constants';

// Every suit the reward/shop screens can offer -- unlike a room's pool/hand
// (which are constrained to the room's own threatSuits), a reward is a
// deck-building choice across the whole game, so all suits are always in
// play. Exported for engine/runEngine.ts's Transform deck action, which
// rerolls a card into a random *different* suit from this same list.
export const REWARD_SUITS: SuitId[] = [...THREAT_SUITS, BOON_SUIT, GUARD_SUIT, WEAKEN_SUIT, POISON_SUIT, STRENGTH_SUIT];

type RewardCategory = 'suit' | 'special' | 'quake' | 'cleave' | 'relic' | 'potion';

// Rolls which SPECIAL_CARD_DEFS entry a 'special' reward/shop slot actually
// resolves to, skewed by rarity (RARITY_WEIGHT) instead of a flat
// uniformPick -- shared by the reward screen and the shop's twin slot below
// so both draw from the same odds.
function pickSpecialCardDef(rng: Rng) {
  return weightedPick(rng, SPECIAL_CARD_DEFS.map((d) => ({ weight: RARITY_WEIGHT[d.rarity ?? 'common'], value: d })));
}

/**
 * A reward's suit-slot pick, biased toward the just-cleared room's own
 * threatSuits (MECHANIC_BRAINSTORM.md's "Reward weighting toward the
 * cleared room's threat suits") -- still leaves a REWARD_SUITS-wide uniform
 * tail so off-suit variety stays possible, just no longer equally likely.
 * Falls back to a plain uniform pick when threatSuits is empty (a rest/
 * shrine door doesn't have one, and generateShopOptions never had one to
 * begin with).
 */
function pickRewardSuit(rng: Rng, threatSuits: SuitId[]): SuitId {
  if (threatSuits.length === 0) return uniformPick(rng, REWARD_SUITS);
  const fromThreatSuits = weightedPick<boolean>(rng, [
    { weight: REWARD_THREAT_SUIT_BIAS, value: true },
    { weight: 1 - REWARD_THREAT_SUIT_BIAS, value: false },
  ]);
  return uniformPick(rng, fromThreatSuits ? threatSuits : REWARD_SUITS);
}

/** Relics from RELIC_DEFS not already present in `heldRelics` -- shared by both acquisition paths so neither ever offers a duplicate. */
function unheldRelics(heldRelics: RelicDef[]): RelicDef[] {
  const heldIds = new Set(heldRelics.map((r) => r.id));
  return RELIC_DEFS.filter((r) => !heldIds.has(r.id));
}

// Identifies a card by its actual content (suit + specialId, or its suitless
// kind) rather than its generated id -- two reward slots that both roll a
// plain Wolf card are "the same card" for uniqueness purposes even though
// each gets its own id. Owning a copy already (deck) is fine, per design;
// this only guards against the *same reward screen* repeating itself.
function cardOptionKey(card: Card): string {
  return card.kind === 'creature' ? `creature:${card.suit}:${card.specialId ?? 'plain'}` : card.kind;
}

// Reroll cap for generateRewardOptions' per-slot dedupe loop -- comfortably
// above what a handful of collisions would ever need (the card pool is ~9
// suits + ~20 specials + Quake/Cleave against only REWARD_OPTION_COUNT (3)
// slots), just high enough to guarantee termination rather than spin forever
// in some future degenerate config.
const REWARD_DEDUPE_MAX_ATTEMPTS = 30;

/**
 * MVP reward shape: a threat-suit-biased pick (see pickRewardSuit) across
 * every suit per slot, Quake/Cleave/a named special card (config/
 * specialCards.ts)/a relic (config/relics.ts)/a potion (config/potions.ts)
 * each folded in at their own low weight -- no removal/upgrade options yet
 * (see runEngine.ts's shop-only deck actions for those). `depth` only feeds
 * the returned ids' uniqueness, not the odds; every slot draws from the same
 * full suit/special/relic/potion pool regardless of depth. Falls back to an
 * ordinary suit pick if every relic is already held (`heldRelics`) or the
 * potion inventory is already at POTION_INVENTORY_CAP (`heldPotions`),
 * rather than ever offering a relic duplicate or growing potions unbounded.
 * `threatSuits` is the just-cleared room's own RoomParams.threatSuits (empty
 * for a reward not tied to a combat room).
 */
// One reward slot's roll -- factored out of generateRewardOptions so its
// caller can reroll on a card-content collision without duplicating the
// whole category/weight table.
function rollRewardOption(
  id: string,
  rng: Rng,
  offerableRelics: RelicDef[],
  potionSlotAvailable: boolean,
  threatSuits: SuitId[],
): RewardOption {
  const category = weightedPick<RewardCategory>(rng, [
    {
      weight:
        1 -
        QUAKE_REWARD_RATIO -
        CLEAVE_REWARD_RATIO -
        SPECIAL_REWARD_RATIO -
        RELIC_REWARD_RATIO -
        POTION_REWARD_RATIO,
      value: 'suit',
    },
    { weight: SPECIAL_REWARD_RATIO, value: 'special' },
    { weight: QUAKE_REWARD_RATIO, value: 'quake' },
    { weight: CLEAVE_REWARD_RATIO, value: 'cleave' },
    { weight: offerableRelics.length > 0 ? RELIC_REWARD_RATIO : 0, value: 'relic' },
    { weight: potionSlotAvailable ? POTION_REWARD_RATIO : 0, value: 'potion' },
  ]);
  if (category === 'quake') {
    return { id, optionType: 'card', card: { id, kind: 'quake' } };
  } else if (category === 'cleave') {
    return { id, optionType: 'card', card: { id, kind: 'cleave' } };
  } else if (category === 'special') {
    const def = pickSpecialCardDef(rng);
    return { id, optionType: 'card', card: { id, kind: 'creature', suit: def.suit, specialId: def.id } };
  } else if (category === 'relic') {
    const relic = uniformPick(rng, offerableRelics);
    return { id, optionType: 'relic', relic };
  } else if (category === 'potion') {
    const potion = uniformPick(rng, POTION_DEFS);
    return { id, optionType: 'potion', potion };
  }
  return { id, optionType: 'card', card: { id, kind: 'creature', suit: pickRewardSuit(rng, threatSuits) } };
}

export function generateRewardOptions(
  depth: number,
  rng: Rng,
  heldRelics: RelicDef[],
  heldPotions: PotionDef[],
  threatSuits: SuitId[],
): RewardOption[] {
  const offerableRelics = unheldRelics(heldRelics);
  const potionSlotAvailable = heldPotions.length < POTION_INVENTORY_CAP;
  const options: RewardOption[] = [];
  // Cards already offered this screen (by content, not id) -- a card slot
  // rerolls against this set so no two of the REWARD_OPTION_COUNT choices are
  // the same pick, even though owning a duplicate of something already in the
  // deck is completely fine (see cardOptionKey). Relic/potion slots aren't
  // subject to this: relics already dedupe via offerableRelics/unheldRelics,
  // and potions are designed to stack.
  const usedCardKeys = new Set<string>();
  for (let i = 0; i < REWARD_OPTION_COUNT; i++) {
    const id = `reward-d${depth}-${i}`;
    let option = rollRewardOption(id, rng, offerableRelics, potionSlotAvailable, threatSuits);
    for (
      let attempt = 0;
      option.optionType === 'card' && usedCardKeys.has(cardOptionKey(option.card)) && attempt < REWARD_DEDUPE_MAX_ATTEMPTS;
      attempt++
    ) {
      option = rollRewardOption(id, rng, offerableRelics, potionSlotAvailable, threatSuits);
    }
    if (option.optionType === 'card') usedCardKeys.add(cardOptionKey(option.card));
    options.push(option);
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

/** Eligible DeckActionKinds for the current `deck` -- Transform/Duplicate need any creature card, Upgrade additionally needs one with no specialId yet (see runEngine.ts's resolveDeckAction, which enforces the exact same eligibility when the purchase is actually resolved). */
function eligibleDeckActions(deck: Card[]): DeckActionKind[] {
  const kinds: DeckActionKind[] = [];
  if (deck.some((c) => c.kind === 'creature')) kinds.push('transform', 'duplicate');
  if (deck.some((c) => c.kind === 'creature' && !c.specialId)) kinds.push('upgrade');
  return kinds;
}

function deckActionPrice(kind: DeckActionKind): number {
  return kind === 'transform' ? SHOP_TRANSFORM_PRICE : kind === 'duplicate' ? SHOP_DUPLICATE_PRICE : SHOP_UPGRADE_PRICE;
}

/**
 * A shop's priced offer -- SHOP_OPTION_COUNT slots, drawn from the same
 * category pool generateRewardOptions above uses (suit/special/Quake/
 * Cleave/relic/potion, same held-relic/potion-cap exclusion, but a plain
 * uniform suit pick -- a shop isn't tied to a just-cleared room's
 * threatSuits) plus a shop-only deck-action slot (Transform/Duplicate/
 * Upgrade -- MECHANIC_BRAINSTORM.md's Suit Reroll/Duplicate/Card Upgrade,
 * all three sharing this one venue per the doc's own reasoning), each
 * stamped with its fixed price (config/constants.ts's SHOP_CARD_PRICE/
 * SHOP_RELIC_PRICE/SHOP_POTION_PRICE/SHOP_TRANSFORM_PRICE/
 * SHOP_DUPLICATE_PRICE/SHOP_UPGRADE_PRICE) instead of the reward screen's
 * exclusive pick-1 framing -- see runEngine.ts's buyShopOption for how
 * multiple slots can be bought in one visit. Generated live off run.rng in
 * chooseDoor, not precomputed in the tree, same reason a shrine's offer
 * isn't (types/room.ts's ShopRoomInstance). `deck` is the player's current
 * persistent deck, read only to gate deck-action eligibility.
 */
export function generateShopOptions(rng: Rng, heldRelics: RelicDef[], heldPotions: PotionDef[], deck: Card[]): ShopOption[] {
  const offerableRelics = unheldRelics(heldRelics);
  const potionSlotAvailable = heldPotions.length < POTION_INVENTORY_CAP;
  const deckActionKinds = eligibleDeckActions(deck);
  const options: ShopOption[] = [];
  for (let i = 0; i < SHOP_OPTION_COUNT; i++) {
    const id = `shop-${i}`;
    const category = weightedPick<RewardCategory | 'deck-action'>(rng, [
      {
        weight:
          1 -
          QUAKE_REWARD_RATIO -
          CLEAVE_REWARD_RATIO -
          SPECIAL_REWARD_RATIO -
          RELIC_REWARD_RATIO -
          POTION_REWARD_RATIO -
          SHOP_DECK_ACTION_RATIO,
        value: 'suit',
      },
      { weight: SPECIAL_REWARD_RATIO, value: 'special' },
      { weight: QUAKE_REWARD_RATIO, value: 'quake' },
      { weight: CLEAVE_REWARD_RATIO, value: 'cleave' },
      { weight: offerableRelics.length > 0 ? RELIC_REWARD_RATIO : 0, value: 'relic' },
      { weight: potionSlotAvailable ? POTION_REWARD_RATIO : 0, value: 'potion' },
      { weight: deckActionKinds.length > 0 ? SHOP_DECK_ACTION_RATIO : 0, value: 'deck-action' },
    ]);
    if (category === 'quake') {
      options.push({ id, optionType: 'card', price: SHOP_CARD_PRICE, card: { id, kind: 'quake' } });
    } else if (category === 'cleave') {
      options.push({ id, optionType: 'card', price: SHOP_CARD_PRICE, card: { id, kind: 'cleave' } });
    } else if (category === 'special') {
      const def = pickSpecialCardDef(rng);
      options.push({ id, optionType: 'card', price: SHOP_CARD_PRICE, card: { id, kind: 'creature', suit: def.suit, specialId: def.id } });
    } else if (category === 'relic') {
      const relic = uniformPick(rng, offerableRelics);
      options.push({ id, optionType: 'relic', price: SHOP_RELIC_PRICE, relic });
    } else if (category === 'potion') {
      const potion = uniformPick(rng, POTION_DEFS);
      options.push({ id, optionType: 'potion', price: SHOP_POTION_PRICE, potion });
    } else if (category === 'deck-action') {
      const action = uniformPick(rng, deckActionKinds);
      options.push({ id, optionType: 'deck-action', price: deckActionPrice(action), action });
    } else {
      options.push({ id, optionType: 'card', price: SHOP_CARD_PRICE, card: { id, kind: 'creature', suit: uniformPick(rng, REWARD_SUITS) } });
    }
  }
  return options;
}
