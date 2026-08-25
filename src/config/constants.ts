import type { SuitDef, SuitId } from '../types/suits';
import type { DoorColor } from '../types/door';
import type { PoolSizeBand } from '../types/room';
import type { CreatureCard } from '../types/cards';
import { cardCopies } from './cardHelpers';

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
  // see combatEngine.ts's performPlay.
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

// Banks Guard that absorbs its holder's own incoming HP loss. An ordinary
// suit under full symmetry (Earthquake-style rewrite) -- any entity, player
// or enemy, can hold and play it on itself. (Previously player-exclusive;
// nothing in the engine ever branched on that, only a comment claimed it.)
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

export const PLAYER_HAND_SIZE = 7;

// A room's table deal used to be sized to last the whole room (a pool,
// refilled only when fully dry); now every round deals a fresh neutral
// batch onto the table regardless of what's already there (see
// combatEngine's dealRoomTable), so this needs to be sized for ONE round,
// not a whole fight -- much smaller than the old 6-8/12-16. Kept nonzero
// even at the low end so round 1 always has *something* live to seed a play
// against.
export const ROOM_TABLE_DEAL_SMALL: [number, number] = [2, 3];
export const ROOM_TABLE_DEAL_LARGE: [number, number] = [4, 5];

// How many distinct threat suits a room's table draws from -- the "room
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

// Enemy count is the single largest lever on room lethality
// (PLAYTEST_FINDINGS.md Finding 1: 1-enemy rooms cleared at 91% vs. 10% for
// 3-enemy, identical across every bot profile tested) and used to be rolled
// uniformly across ROOM_MIN_ENEMIES..ROOM_MAX_ENEMIES regardless of floor --
// a 3-pack was exactly as likely on room 1 as room 9. These are the two
// interpolation endpoints roomGenerator's pickEnemyCount blends between
// across floor 1..RUN_MAX_DEPTH: index 0 = weight for ROOM_MIN_ENEMIES, last
// index = weight for ROOM_MAX_ENEMIES. Must stay the same length as the
// count range (ROOM_MAX_ENEMIES - ROOM_MIN_ENEMIES + 1).
export const ENEMY_COUNT_WEIGHTS_EARLY: number[] = [6, 2, 0]; // floor 1: mostly solo, no 3-packs
export const ENEMY_COUNT_WEIGHTS_LATE: number[] = [1, 3, 5]; // floor RUN_MAX_DEPTH: 3-packs common

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

// --- Plays per turn ----------------------------------------------------
// How many separate plays the player may make in a single turn before it
// passes to the enemy phase. This is the hook point for future temporary
// buffs/debuffs or per-run relics that grant (or cost) a play -- for now the
// only modifier is the Quake card's unlimited-plays effect (see
// CombatState.unlimitedPlaysThisTurn).
export const PLAYS_PER_TURN_BASE = 2;

// --- Enemies (symmetric play) ------------------------------------------

// Smaller than PLAYER_HAND_SIZE (7) -- an enemy should usually have fewer
// live options each turn than the player, echoing the old fixed-single-
// intent-per-turn feel without literally fixing it. Each authored
// EnemyDef.deck (config/enemies.ts) is sized around ~2.5x this so a full
// discard-and-redraw cycle (every enemy's own turn, see
// combatEngine.ts's resolveEnemyTurn) rarely needs a mid-hand reshuffle.
export const ENEMY_HAND_SIZE = 4;

// How many separate plays an enemy makes on its own turn before control
// passes to the next enemy (or back to the player) -- deliberately half of
// PLAYS_PER_TURN_BASE, to keep the enemy phase's pacing close to today's
// one-action-per-enemy-per-beat feel rather than doubling combat's overall
// action count now that enemies act "for real" instead of following a fixed
// intent. No enemy analog of Quake exists -- this is never lifted.
export const ENEMY_PLAYS_PER_TURN = 1;

// Below this fraction of hpMax, engine/enemyAI.ts's chooseEnemyPlay biases
// (not forces) an enemy toward a boon/guard suit it holds over pressing an
// attack. First-cut number, not balance-tested.
export const ENEMY_LOW_HP_HEAL_GUARD_THRESHOLD_PCT = 0.4;

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
export const STARTER_DECK: CreatureCard[] = [
  ...cardCopies('wolf', 3, 'starter'),
  ...cardCopies('ember', 3, 'starter'),
  ...cardCopies('rot', 3, 'starter'),
  ...cardCopies('spider', 3, 'starter'),
  ...cardCopies('grace', 2, 'starter'),
  ...cardCopies('ward', 2, 'starter'),
  ...cardCopies('hex', 1, 'starter'),
  ...cardCopies('venom', 1, 'starter'),
  ...cardCopies('vigor', 1, 'starter'),
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
