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
  | 'shrine'
  | 'shop'
  | 'door-choice'
  | 'run-complete'
  | 'run-over';

// A reward-screen slot is a card, a relic, or a potion -- tagged with
// optionType rather than reusing Card.kind ('creature'/'quake'), which is a
// different axis (what kind of card) than this (card vs relic vs potion).
export type RewardOption =
  | { id: string; optionType: 'card'; card: Card }
  | { id: string; optionType: 'relic'; relic: RelicDef }
  | { id: string; optionType: 'potion'; potion: PotionDef };

// A shop-screen slot -- same three-way shape as RewardOption, plus a fixed
// price (see config/constants.ts's SHOP_CARD_PRICE/SHOP_RELIC_PRICE/
// SHOP_POTION_PRICE). Unlike a reward, several of these can be bought in one
// shop visit -- see runEngine.ts's buyShopOption.
export type ShopOption =
  | { id: string; optionType: 'card'; price: number; card: Card }
  | { id: string; optionType: 'relic'; price: number; relic: RelicDef }
  | { id: string; optionType: 'potion'; price: number; potion: PotionDef };

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
  // chooseReward's relic branch and chooseRelic, never shrinks (no
  // duplicates are ever offered once a relic is held, see rewardGenerator.ts
  // and generateShrineOptions). Copied into CombatState.relics at initCombat
  // so combatEngine.ts's applyRelics can read it without extra plumbing.
  relics: RelicDef[];
  // Persistent, run-level held potions (see types/potions.ts) -- grown by
  // chooseReward's potion branch, shrunk by combat's USE_FREE_CLAIM_POTION/
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
  // Set by resolveCombatEnd's room-cleared branch, consumed by chooseReward.
  // Null outside the 'reward' phase.
  rewardOptions: RewardOption[] | null;
  // Set by chooseDoor's shrine branch, consumed by chooseRelic/skipShrine.
  // Null outside the 'shrine' phase.
  shrineOptions: RelicDef[] | null;
  // Set by chooseDoor's shop branch, shrunk as options are bought
  // (buyShopOption), cleared by leaveShop. Null outside the 'shop' phase.
  shopOptions: ShopOption[] | null;
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
