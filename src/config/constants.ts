import type { SuitDef, SuitId } from '../types/suits';
import type { DoorColor } from '../types/door';
import type { PoolSizeBand, IntRange } from '../types/room';
import type { CreatureCard } from '../types/cards';
import { cardCopies, specialCard } from './cardHelpers';
import { specialCardById } from './specialCards';

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

// A room's per-round deal *frequency* -- how many separate tableDealSize
// batches land on the table each round -- independent of tableDealSize
// itself (how big each one of those batches is). One of these profiles is
// picked uniformly per room at generation time (see roomGenerator's
// pickDealFrequency) and then re-rolled within its own [min,max] every
// round (dealRoomTableForRound): a steady one-a-turn room, a steady
// two-a-turn room, and an erratic room anywhere from 1 to 3 a turn.
export const ROOM_DEAL_FREQUENCY_PROFILES: IntRange[] = [
  { min: 1, max: 1 },
  { min: 2, max: 2 },
  { min: 1, max: 3 },
];

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

// Enemy count is the single largest lever on room lethality (batch
// playtesting found 1-enemy rooms cleared at ~91% vs. ~10% for 3-enemy,
// identical across every bot profile tested) and used to be rolled
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
// passes to the enemy phase. `CombatState.playsRemaining` is a plain numeric
// pool seeded from this base each turn -- StS-style energy, not a countdown
// paired with a special-cased "unlimited" flag -- so any effect (Quake's
// bonus, a future relic/status/card) just adds to or subtracts from it
// directly. See QUAKE_BONUS_PLAYS below for the only modifier that exists
// today.
export const PLAYS_PER_TURN_BASE = 2;

// --- Enemies (symmetric play) ------------------------------------------

// Each enemy's hand size is authored per-def (EnemyDef.handSize in
// config/enemies.ts, alongside hpMax) rather than shared here -- lower for
// early-floor enemies so low- and high-level enemies read as mechanically
// distinct, not just bigger HP bars. All are still smaller than
// PLAYER_HAND_SIZE (7), echoing the old fixed-single-intent-per-turn feel
// without literally fixing it.

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
// damage per stack; Weaken is different -- its stack count is duration only
// (how many of the dealer's own turns it keeps applying), while the cut
// itself is this one flat percentage taken off the top of the dealer's
// outgoing damage whenever any Weaken stacks are held, so a big claim that
// lands a pile of stacks just makes Weaken last longer, never hit harder.
export const WEAKEN_PCT = 0.25;

// --- Doors ------------------------------------------------------------

export const DOOR_CORRELATION_RATE = 0.75;

// Independent per-door-candidate odds that a door leads to a rest room
// (campfire/fairy's cave) instead of a combat room -- rolled separately for
// each of the two doors in a pair (doorGenerator.ts), never on the floor
// RUN_MAX_DEPTH room (that's always the guaranteed elite boss, see
// config/enemies.ts). First-cut number: "from time to time" per the design
// discussion, not balance-tested -- at 0.15 across the 9 door-pair rolls in
// a full run (floors 2..RUN_MAX_DEPTH), a run sees on average ~2.7 rest-room
// doors offered (not guaranteed taken).
export const REST_ROOM_RATIO = 0.15;

// Independent per-door-candidate odds that a door leads to a shrine (a
// relic-offer stop, see types/room.ts's ShrineRoomInstance) instead of a
// combat room -- rolled alongside REST_ROOM_RATIO, same never-on-the-final-
// floor exclusion. Rarer than rest rooms since a relic is a bigger, run-long
// find than a heal/card-removal choice. First-cut number, not balance-tested.
export const SHRINE_ROOM_RATIO = 0.08;

// How many relic options a shrine offers at once -- see
// rewardGenerator.ts's generateShrineOptions.
export const SHRINE_OPTION_COUNT = 2;

// Fraction of playerHPMax a rest room's "Rest" option restores (rounded,
// capped at playerHPMax) -- the fix for the no-in-run-HP-recovery gap
// (GAME_DESIGN.md §7/§10). First-cut number, not balance-tested.
export const REST_HEAL_PCT = 0.3;

// How many floors below the just-cleared room the door-choice screen's
// combined-tree view (DoorTreeChoice.tsx) renders, before truncating --
// unlike DoorCard's per-door preview (still the default, full-reveal view),
// this mode draws both doors' subtrees as one connected graph rooted at the
// completed room, so an unbounded depth would make floor-1's choice as
// sprawling as floor-9's. First-cut number: deep enough to see each door's
// immediate branching shape (its own two doors), shallow enough to stay
// legible at a glance.
export const DOOR_TREE_VIEW_MAX_DEPTH = 3;

// How much larger DoorTreeChoice's graph renders (node size, spacing, row
// labels -- see RunTreeView's `scale` prop) than the dev tab/DoorCard's 1x
// baseline. This view is the primary thing on the door-choice screen and its
// depth is already capped by DOOR_TREE_VIEW_MAX_DEPTH above, so it can afford
// to run bigger without either becoming illegible or outgrowing the screen.
export const DOOR_TREE_VIEW_SCALE = 2;

// --- Run / persistent deck ----------------------------------------------

export const RUN_MAX_DEPTH = 10;

// The run's starting deck -- 19 cards, weighted toward the four threat
// suits with a light scattering of every support suit so an early room
// almost always has *something* live to play. A balance surface like every
// ratio constant above; expect to retune with fresh playtesting data.
// One copy per suit is swapped for that suit's named special card (see
// config/specialCards.ts) rather than added on top -- deck size (19) and
// per-suit counts are unchanged from before specials existed, so every
// existing balance ratio still applies unmodified.
export const STARTER_DECK: CreatureCard[] = [
  ...cardCopies('wolf', 2, 'starter'),
  specialCard(specialCardById('alpha-wolf'), 'starter'),
  ...cardCopies('ember', 2, 'starter'),
  specialCard(specialCardById('wildfire'), 'starter'),
  ...cardCopies('rot', 2, 'starter'),
  specialCard(specialCardById('rot-colossus'), 'starter'),
  ...cardCopies('spider', 2, 'starter'),
  specialCard(specialCardById('broodcaller'), 'starter'),
  ...cardCopies('grace', 1, 'starter'),
  specialCard(specialCardById('blessed-grace'), 'starter'),
  ...cardCopies('ward', 1, 'starter'),
  specialCard(specialCardById('bastion-heart'), 'starter'),
  specialCard(specialCardById('withering-hex'), 'starter'),
  specialCard(specialCardById('widows-kiss'), 'starter'),
  specialCard(specialCardById('battle-fury'), 'starter'),
];

// --- Rewards ------------------------------------------------------------

// Odds a reward offer's slot is a Quake card instead of an ordinary suited
// one -- deliberately rarer than an ordinary suit pick, since a burst of
// extra plays for a turn is one of the strongest things a card can do, and
// it's a permanent deck addition rather than a one-turn-only mint.
export const QUAKE_REWARD_RATIO = 0.08;

// How many bonus plays a Quake card grants (added straight to
// CombatState.playsRemaining, on top of whatever's left this turn) when
// played -- a flat, finite pool topper rather than true-unlimited plays.
export const QUAKE_BONUS_PLAYS = 3;

// Odds a reward offer's slot is a named special card (config/specialCards.ts)
// instead of a plain suited one -- higher than Quake since a rider is a
// smaller, non-permanent-turn-warping bonus, but still meaningfully rarer
// than an ordinary suit pick so it reads as a notable find.
export const SPECIAL_REWARD_RATIO = 0.15;

// Odds a reward offer's slot is a relic (config/relics.ts) instead of an
// ordinary suited one -- rarer than a special card since a relic is a
// run-long passive rather than one deck card, but still available from the
// reward screen (not just a shrine) so relics aren't gated behind RNG luck
// on shrine doors alone.
export const RELIC_REWARD_RATIO = 0.1;

// Odds a reward offer's slot is a potion (config/potions.ts) instead of an
// ordinary suited one -- same tier as RELIC_REWARD_RATIO (a bit below it):
// a potion is a consumable, not a permanent find, but it's still a discrete
// item rather than one more deck card.
export const POTION_REWARD_RATIO = 0.1;

// Combined cap across every held potion kind -- once RunState.potions.length
// reaches this, the reward screen stops offering potions at all (see
// rewardGenerator.ts's generateRewardOptions), same "already at the ceiling"
// shape unheldRelics gives relics, just count-based since potions (unlike
// relics) can duplicate. First-cut number, not balance-tested.
export const POTION_INVENTORY_CAP = 4;

export const REWARD_OPTION_COUNT = 3;

// --- UI pacing only (not engine) --------------------------------------

export const TURN_ANIMATION_DELAY_MS = 600;

// A single dispatched action can append several log entries at once (e.g. a
// claim's damage followed by an unrelated suit's decay penalty finishing its
// countdown in the same turn-end tick). Revealing them one at a time, this
// many ms apart, makes that sequence legible instead of a single blended net
// number jumping onto the meters.
export const LOG_STEP_DELAY_MS = 450;
