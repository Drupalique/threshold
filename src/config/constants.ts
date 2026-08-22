import type { SuitDef, SuitId } from '../types/suits';
import type { DoorColor } from '../types/door';
import type { SurpriseEffectType } from '../types/cards';

// --- Content data -----------------------------------------------------

export const SUIT_DEFINITIONS: SuitDef[] = [
  { id: 'wolf', name: 'Wolf', category: 'threat', displayColor: '#c0392b' },
  { id: 'ember', name: 'Ember', category: 'threat', displayColor: '#2980b9' },
  { id: 'rot', name: 'Rot', category: 'threat', displayColor: '#2471a3' },
  { id: 'spider', name: 'Spider', category: 'threat', displayColor: '#a93226' },
  { id: 'grace', name: 'Grace', category: 'boon', displayColor: '#d4ac0d' },
  { id: 'ward', name: 'Ward', category: 'guard', displayColor: '#16a085' },
];

export const THREAT_SUITS: SuitId[] = SUIT_DEFINITIONS.filter(
  (s) => s.category === 'threat',
).map((s) => s.id);

export const BOON_SUIT: SuitId = SUIT_DEFINITIONS.find(
  (s) => s.category === 'boon',
)!.id;

// The player's exclusive defensive suit (asymmetry, not full room/player
// mirroring -- see GUARD_SUIT_RATIO and combatEngine's applyClaimEffect):
// claiming it banks Guard that absorbs the player's own incoming HP loss.
// The room has no use for it and its claims fizzle.
export const GUARD_SUIT: SuitId = SUIT_DEFINITIONS.find(
  (s) => s.category === 'guard',
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
};

export const SURPRISE_EFFECT_TYPES: SurpriseEffectType[] = [
  'add-cards',
  'block-suit',
  'force-discard',
];

// --- Hands / pool -------------------------------------------------------

export const PLAYER_HAND_SIZE = 5;
export const ROOM_HAND_SIZE = 3; // design doc suggests 2-3; fixed at 3 for v0.1

// Experimental variant, not in the v0.2 design doc (which specifies hands
// dealt once at round start and only shrinking -- see 4.1/4.3). When true,
// whichever actor is about to take a turn gets a brand new hand (fully
// replacing whatever they didn't play), similar to the source card game.
export const HAND_REDRAW_EACH_TURN = true;

export const ROOM_POOL_SIZE_SMALL: [number, number] = [6, 8];
export const ROOM_POOL_SIZE_LARGE: [number, number] = [12, 16];

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
export const SURPRISE_CARD_RATIO = 0.08; // pool only; hands never contain surprise cards

// --- Combat ---------------------------------------------------------------

export const ROOM_THREAT_BASE = 20;
export const PLAYER_HP_MAX = 30;

export const DECAY_TURNS_N = 3;
export const DECAY_HP_PENALTY = 3;

// The design doc (4.1) defines a set as "2+ cards in the pool" sharing a
// suit -- i.e. the pool alone must supply both matching cards. This variant
// lowers that to 1: a single pool card is claimable as long as the actor
// also holds >=1 matching hand card, so the "set" can be split 1-on-the-
// table / 1-in-hand instead of requiring 2 on the table. Applies symmetrically
// to both player and room claims, and to what counts as "live" for decay.
export const MIN_POOL_SET_SIZE = 1;

export const SURPRISE_ADD_CARDS_COUNT = 2;
export const SURPRISE_BLOCK_DURATION_TURNS = 1;

// When the room claims a boon set, it gets a deliberately milder Room Threat
// regen rather than a symmetric heal (design doc 4.1).
export const ROOM_BOON_REGEN_FACTOR = 0.5;

// --- Doors ------------------------------------------------------------

export const DOOR_CORRELATION_RATE = 0.75;

// --- Run --------------------------------------------------------------

export const RUN_MAX_DEPTH = 10;

// --- UI pacing only (not engine) --------------------------------------

export const TURN_ANIMATION_DELAY_MS = 600;

// A single dispatched action can append several log entries at once (e.g. a
// claim's heal followed by an unrelated suit's decay penalty finishing its
// countdown in the same turn-end tick). Revealing them one at a time, this
// many ms apart, makes that sequence legible instead of a single blended net
// number jumping onto the meters.
export const LOG_STEP_DELAY_MS = 450;

// How long a room claim's hand cards + pool set stay revealed/highlighted
// before fading back to the (already-updated) face-down/empty state.
export const CLAIM_REVEAL_DURATION_MS = 900;
