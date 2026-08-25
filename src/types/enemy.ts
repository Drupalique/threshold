import type { StatusBag } from './status';
import type { CreatureCard } from './cards';

/**
 * Static, authored template for an enemy type. `deck` is a small, directly-
 * authored card list (mirrors STARTER_DECK's style in config/constants.ts,
 * not a ratio-generator) -- an enemy's suit slant IS its identity now, in
 * place of the old fixed pattern cycle. See config/enemies.ts for the
 * concrete rosters and per-enemy rationale.
 */
export interface EnemyDef {
  id: string;
  name: string;
  hpMax: number;
  minFloor: number;
  deck: CreatureCard[];
}

/** Runtime instance of an EnemyDef within one room -- two enemies can share a defId, each with its own independent hand/deck cycle. */
export interface EnemyInstance {
  instanceId: string;
  defId: string;
  name: string;
  hp: number;
  hpMax: number;
  guard: number;
  statuses: StatusBag;
  // Own persistent per-room hand/deck cycle, mirroring CombatState's
  // playerHand/drawPile/discardPile 1:1 -- shuffled from a fresh copy of
  // EnemyDef.deck and dealt an opening hand in initCombat, then fully
  // discarded-and-redrawn at the end of THIS enemy's own turn (see
  // engine/combatEngine.ts's resolveEnemyTurn), reshuffling discardPile
  // into drawPile on empty exactly like engine/deckState.ts's drawCards
  // already does for the player. Never shared between two same-defId
  // instances -- each rolls its own shuffle from its own copy of the deck.
  hand: CreatureCard[];
  drawPile: CreatureCard[];
  discardPile: CreatureCard[];
}
