import type { SuitDef, SuitId } from '../types/suits';
import type { DoorColor } from '../types/door';
import type { PoolSizeBand } from '../types/room';
import type { Card } from '../types/cards';

// --- Content data -----------------------------------------------------

export const SUIT_DEFINITIONS: SuitDef[] = [
  { id: 'wolf', name: 'Wolf', category: 'threat', displayColor: '#c0392b' },
  { id: 'ember', name: 'Ember', category: 'threat', displayColor: '#2980b9' },
  { id: 'rot', name: 'Rot', category: 'threat', displayColor: '#2471a3' },
  { id: 'spider', name: 'Spider', category: 'threat', displayColor: '#a93226' },
  { id: 'grace', name: 'Grace', category: 'boon', displayColor: '#d4ac0d' },
  { id: 'ward', name: 'Ward', category: 'guard', displayColor: '#16a085' },
  // Status suits: claiming one applies its StatusId's stacks to a target
  // (Hex/Venom, mirroring the enemy's own Debuff/Poison intents) or to the
  // player themself (Vigor, mirroring the enemy's own Strength intent) --
  // see combatEngine.ts's performClaim and design doc 4.9's "next step."
  { id: 'hex', name: 'Hex', category: 'weaken', displayColor: '#8e44ad' },
  { id: 'venom', name: 'Venom', category: 'poison', displayColor: '#229954' },
  { id: 'vigor', name: 'Vigor', category: 'strength', displayColor: '#d35400' },
];

export const THREAT_SUITS: SuitId[] = SUIT_DEFINITIONS.filter(
  (s) => s.category === 'threat',
).map((s) => s.id);

export const BOON_SUIT: SuitId = SUIT_DEFINITIONS.find(
  (s) => s.category === 'boon',
)!.id;

// The player's exclusive defensive suit (asymmetry, not full mirroring):
// claiming it banks Guard that absorbs the player's own incoming HP loss.
// No enemy owns this suit, so it never appears tagged to an instance.
export const GUARD_SUIT: SuitId = SUIT_DEFINITIONS.find(
  (s) => s.category === 'guard',
)!.id;

// The single suit for each status effect the player can inflict -- Hex
// (Weaken) and Venom (Poison) target an enemy like a threat claim does;
// Vigor (Strength) targets the player themself like boon/guard.
export const WEAKEN_SUIT: SuitId = SUIT_DEFINITIONS.find(
  (s) => s.category === 'weaken',
)!.id;
export const POISON_SUIT: SuitId = SUIT_DEFINITIONS.find(
  (s) => s.category === 'poison',
)!.id;
export const STRENGTH_SUIT: SuitId = SUIT_DEFINITIONS.find(
  (s) => s.category === 'strength',
)!.id;

// Wolf/Spider read as "red" (fast, aggressive predators), Ember/Rot as "blue"
// (slow-burning environmental threats) -- an arbitrary but fixed 4-suits-onto-
// 2-colors mapping for the placeholder door color tag.
export const SUIT_COLOR_FAMILY: Record<SuitId, DoorColor | null> = {
  wolf: 'red',
  spider: 'red',
  ember: 'blue',
  rot: 'blue',
  grace: null,
  ward: null,
  hex: null,
  venom: null,
  vigor: null,
};

// --- Hands / pool -------------------------------------------------------

export const PLAYER_HAND_SIZE = 5;

export const ROOM_POOL_SIZE_SMALL: [number, number] = [6, 8];
export const ROOM_POOL_SIZE_LARGE: [number, number] = [12, 16];

// How many distinct threat suits a room's pool draws from -- the "room
// type" knob (design doc 4.8) that replaces "one threat suit per enemy
// present." Deliberately keyed off sizeBand (an existing room-level
// property) rather than the enemy roster, so pool variety is a fact about
// the room, not a side effect of which enemies happened to be rolled.
export const THREAT_SUIT_COUNT_BY_SIZE_BAND: Record<PoolSizeBand, number> = {
  small: 1,
  large: 2,
};

// --- Enemies --------------------------------------------------------------

export const ROOM_MIN_ENEMIES = 1;
export const ROOM_MAX_ENEMIES = 3;

// --- Deck weighting -------------------------------------------------------
// ON_SUIT_RATIO is THE single most important tuning knob in the whole system
// (design doc 4.3): it directly controls how often the multiplicative claim
// spike occurs. Too high and the big turn becomes routine; too low and it
// feels like rare bad luck instead of a system. Tune this first.
export const ON_SUIT_RATIO = 0.45;
export const BOON_SUIT_RATIO = 0.12;
// Deliberately smaller than BOON_SUIT_RATIO -- Guard is a strong, stackable
// defensive spike (see combatEngine's applyClaimEffect), so it should show
// up less often than a plain heal.
export const GUARD_SUIT_RATIO = 0.08;
// The three status suits (Hex/Venom/Vigor) share this same modest weight --
// like Guard, a stack-inflicting claim is a strong, stackable tool, so it
// stays rarer than a plain on-suit or boon draw.
export const WEAKEN_SUIT_RATIO = 0.08;
export const POISON_SUIT_RATIO = 0.08;
export const STRENGTH_SUIT_RATIO = 0.08;

// --- Combat ---------------------------------------------------------------

export const PLAYER_HP_MAX = 30;

export const DECAY_TURNS_N = 3;

// The design doc (4.1) defines a set as "2+ cards in the pool" sharing a
// suit -- i.e. the pool alone must supply both matching cards. This variant
// lowers that to 1: a single pool card is claimable as long as the player
// also holds >=1 matching hand card, so the "set" can be split 1-on-the-
// table / 1-in-hand instead of requiring 2 on the table.
export const MIN_POOL_SET_SIZE = 1;

export const SURPRISE_ADD_CARDS_COUNT = 2;
export const SURPRISE_BLOCK_DURATION_TURNS = 1;

// --- Plays per turn ----------------------------------------------------
// How many separate set-claims the player may make in a single turn before
// it passes to the enemy phase, distinct from MIN_POOL_SET_SIZE (which
// gates whether any one claim is legal at all). This is the hook point for
// future temporary buffs/debuffs or per-run relics that grant (or cost) a
// play -- for now the only modifier is the Quake card's unlimited-plays
// effect (see CombatState.unlimitedPlaysThisTurn).
export const PLAYS_PER_TURN_BASE = 2;

// --- Status effects ---------------------------------------------------
// Weaken/Strength/Poison are stack counts that decay by 1 per holder turn
// (see engine/statusEffects.ts). Strength and Poison convert 1:1 into flat
// damage per stack; Weaken needs a %-per-stack conversion, tuned here so
// existing content (Rot Husk's old flat 30% debuff) maps onto 3 stacks.
export const WEAKEN_PCT_PER_STACK = 0.1;

// --- Doors ------------------------------------------------------------

export const DOOR_CORRELATION_RATE = 0.75;

// --- Run / persistent deck ----------------------------------------------

export const RUN_MAX_DEPTH = 10;

// The run's starting deck (PERSISTENT_DECK_PLAN.md open question 5's
// strawman) -- 19 cards, weighted toward the four threat suits with a light
// scattering of every support suit so an early room almost always has
// *something* live to claim. A balance surface like every ratio constant
// above; expect to retune after Phase 5 batch-sim data, not before.
function starterCopies(suit: SuitId, count: number): Card[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `starter-${suit}-${i}`,
    kind: 'creature' as const,
    suit,
  }));
}

export const STARTER_DECK: Card[] = [
  ...starterCopies('wolf', 3),
  ...starterCopies('ember', 3),
  ...starterCopies('rot', 3),
  ...starterCopies('spider', 3),
  ...starterCopies('grace', 2),
  ...starterCopies('ward', 2),
  ...starterCopies('hex', 1),
  ...starterCopies('venom', 1),
  ...starterCopies('vigor', 1),
];

// --- Rewards ------------------------------------------------------------

// Odds a reward offer's slot is a Quake card instead of an ordinary suited
// one (PERSISTENT_DECK_PLAN.md open question 3: Quake moved out of hand
// generation entirely and lives here now) -- deliberately rarer than an
// ordinary suit pick, since unlimited plays for a turn is the single
// strongest thing a card can do, and it's now a permanent deck addition
// rather than a one-turn-only mint.
export const QUAKE_REWARD_RATIO = 0.08;

export const REWARD_OPTION_COUNT = 3;

// --- UI pacing only (not engine) --------------------------------------

export const TURN_ANIMATION_DELAY_MS = 600;

// A single dispatched action can append several log entries at once (e.g. a
// claim's damage followed by an unrelated suit's decay penalty finishing its
// countdown in the same turn-end tick). Revealing them one at a time, this
// many ms apart, makes that sequence legible instead of a single blended net
// number jumping onto the meters.
export const LOG_STEP_DELAY_MS = 450;
