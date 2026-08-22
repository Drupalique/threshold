export type IntentType = 'attack' | 'guard' | 'heal' | 'debuff' | 'corrupt';

export type CorruptEffectType = 'add-cards' | 'block-suit' | 'force-discard';

export interface IntentStep {
  type: IntentType;
  // Damage (attack), Guard banked (guard), Room-HP restored (heal), or the
  // fraction knocked off the player's next threat claim (debuff, 0-1).
  // Unused for corrupt -- see corruptEffect instead.
  magnitude?: number;
  corruptEffect?: CorruptEffectType;
}

/**
 * Static, authored template for an enemy type. `pattern` is a fixed cycle,
 * not a random table -- deliberately memorizable (design decision: enemy
 * kits should read as "the same kind of threat every time," not a slot
 * machine). An enemy's currently-telegraphed step is
 * `pattern[instance.patternIndex % pattern.length]`.
 *
 * Enemies carry no suit of their own -- suits belong to the room's pool, not
 * to any one enemy (see RoomParams.threatSuits and design doc 4.8). A threat
 * claim can be aimed at any alive enemy regardless of which suits are in
 * the pool.
 */
export interface EnemyDef {
  id: string;
  name: string;
  hpMax: number;
  minFloor: number;
  pattern: IntentStep[];
}

/** Runtime instance of an EnemyDef within one room -- two enemies can share a defId. */
export interface EnemyInstance {
  instanceId: string;
  defId: string;
  name: string;
  hp: number;
  hpMax: number;
  guard: number;
  patternIndex: number;
}
