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
  /** Opening/top-up hand size for this enemy, replacing the old flat ENEMY_HAND_SIZE -- lower for early-floor enemies so low- and high-level enemies read as mechanically distinct, not just bigger HP bars. */
  handSize: number;
  deck: CreatureCard[];
  /** Marks a guaranteed-solo, floor-10-only boss def -- excluded from every other floor's normal eligible pool and never rolled alongside weaker adds. See roomGenerator.ts's pickEnemies. */
  isElite?: boolean;
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
  // EnemyDef.deck and dealt an opening hand in initCombat, then topped back
  // up to this def's own EnemyDef.handSize at the end of THIS enemy's own turn (see
  // engine/combatEngine.ts's resolveEnemyTurn), keeping whatever it didn't
  // play, reshuffling discardPile into drawPile on empty exactly like
  // engine/deckState.ts's topUpHand already does for the player. Never
  // shared between two same-defId instances -- each rolls its own shuffle
  // from its own copy of the deck.
  hand: CreatureCard[];
  drawPile: CreatureCard[];
  discardPile: CreatureCard[];
  /** Copied from EnemyDef.isElite at instantiation, so the UI can badge it without a def lookup. */
  isElite?: boolean;
}
