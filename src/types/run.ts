import type { CombatState } from './combat';
import type { Door } from './door';
import type { Card } from './cards';
import type { RelicDef } from './relics';
import type { PotionDef } from './potions';
import type { Rng } from '../engine/rng';
import type { RunTree } from './runTree';

export type RunPhase =
  | 'start'
  | 'combat'
  | 'rest'
  | 'reward'
  | 'shop'
  | 'door-choice'
  | 'run-complete'
  | 'run-over';

// A reward screen's offer: always REWARD_CARD_COUNT card choices when cards
// are on offer (a post-combat clear -- pick exactly one, or Pass; see
// rewardGenerator.ts's generateRewardOffer), plus an independent relic row
// and an independent potion row, each present or absent on its own -- a
// relic/potion never competes with a card for the same slot the way the old
// single-mixed-slot design worked. At most one relic and one potion per
// screen, by design (see rewardGenerator.ts). A shrine-offering room (see
// types/room.ts's ShrineRoomInstance) is just a RewardOffer with an empty
// cardOptions and only its relic populated (generateShrineReward) -- there's
// no separate shrine phase/screen, it's the same 'reward' phase and
// RewardScreen as a post-combat clear. Each populated field is independently
// click-to-claim (see runEngine.ts's chooseReward/claimRewardRelic/
// claimRewardPotion) -- claiming one doesn't consume the others, and doesn't
// leave the reward phase; only skipReward does that.
export interface RewardOffer {
  cardOptions: Card[];
  relic: RelicDef | null;
  potion: PotionDef | null;
}

// The 3 shop-only deck actions (MECHANIC_BRAINSTORM.md's Card Upgrade/Suit
// Reroll/Duplicate) -- buying one doesn't apply anything itself, it sets
// RunState.pendingDeckAction so the shop screen can prompt for which deck
// card to act on (see runEngine.ts's resolveDeckAction).
export type DeckActionKind = 'transform' | 'duplicate' | 'upgrade';

// A shop-screen slot -- a card, a relic, a potion, or a deck-action, each
// tagged with optionType and stamped with a fixed price (see
// config/constants.ts's SHOP_CARD_PRICE/SHOP_RELIC_PRICE/SHOP_POTION_PRICE/
// SHOP_TRANSFORM_PRICE/SHOP_DUPLICATE_PRICE/SHOP_UPGRADE_PRICE). Unlike a
// RewardOffer's independent rows, every shop slot competes for the same
// SHOP_OPTION_COUNT spots, and several can be bought in one shop visit --
// see runEngine.ts's buyShopOption.
export type ShopOption =
  | { id: string; optionType: 'card'; price: number; card: Card }
  | { id: string; optionType: 'relic'; price: number; relic: RelicDef }
  | { id: string; optionType: 'potion'; price: number; potion: PotionDef }
  | { id: string; optionType: 'deck-action'; price: number; action: DeckActionKind };

export interface RunState {
  seed: number;
  rng: Rng;
  depth: number;
  maxDepth: number;
  playerHP: number;
  playerHPMax: number;
  phase: RunPhase;
  // The player's persistent, run-level deck (design doc's persistent-deck
  // system) -- grown by chooseReward after every cleared room, reshuffled
  // fresh into CombatState.drawPile/discardPile at the start of every room
  // (see runEngine.initCombat call sites). This is the only thing that
  // carries a player's hand contents across rooms; RoomInstance no longer
  // deals a hand of its own.
  deck: Card[];
  // Persistent, run-level held relics (see types/relics.ts) -- grown by
  // claimRewardRelic, never shrinks (no duplicates are ever offered once a
  // relic is held, see rewardGenerator.ts's unheldRelics/generateRewardOffer/
  // generateShrineReward). Copied into CombatState.relics at initCombat so
  // combatEngine.ts's applyRelics can read it without extra plumbing.
  relics: RelicDef[];
  // Persistent, run-level held potions (see types/potions.ts) -- grown by
  // claimRewardPotion, shrunk by combat's USE_FREE_CLAIM_POTION/
  // USE_SALT_POTION actions (synced back out of CombatState.potions by
  // runEngine.ts's applyCombatAction the same way playerHP is). Unlike
  // relics, duplicates are allowed and a used potion is actually consumed.
  potions: PotionDef[];
  // Persistent, run-level currency (see MECHANIC_BRAINSTORM.md's "Currency
  // from claim overflow, feeding a shop room") -- grown by claim-overflow
  // conversions during combat (synced out of CombatState.currency by
  // applyCombatAction, same as playerHP/potions) and spent by
  // buyShopOption. Never resets mid-run, same persistence as deck/relics/
  // potions.
  currency: number;
  // Set by resolveCombatEnd's room-cleared branch or chooseDoor's shrine
  // branch, consumed by chooseReward/claimRewardRelic/claimRewardPotion/
  // skipReward. Null outside the 'reward' phase.
  rewardOffer: RewardOffer | null;
  // Set by chooseDoor's shop branch, shrunk as options are bought
  // (buyShopOption), cleared by leaveShop. Null outside the 'shop' phase.
  shopOptions: ShopOption[] | null;
  // Set by buyShopOption when a 'deck-action' slot is bought -- the shop
  // screen then prompts for which deck card to apply it to instead of
  // showing the ordinary options grid; resolveDeckAction clears it back to
  // null once a card is chosen. Null whenever no deck-action purchase is
  // awaiting a target card.
  pendingDeckAction: { action: DeckActionKind } | null;
  // The entire run's precomputed branching structure (see types/runTree.ts,
  // engine/runTree.ts's buildRunTree) -- built once from the seed at
  // createNewRun and held for the run's whole lifetime, not just the path
  // actually taken, so dev tooling can show the whole tree at once.
  runTree: RunTree;
  // Path (into runTree.nodes) of the room currently being played.
  currentPath: string;
  currentDoors: Door[] | null;
  combat: CombatState | null;
}
