import type { EnemyDef, EnemyInstance, IntentStep } from '../types/enemy';
import { enemyDefById } from '../config/enemies';

export function defFor(instance: EnemyInstance): EnemyDef {
  return enemyDefById(instance.defId);
}

/** The step that will resolve the NEXT time this enemy acts -- what the UI telegraphs. */
export function currentIntent(instance: EnemyInstance): IntentStep {
  const def = defFor(instance);
  return def.pattern[instance.patternIndex % def.pattern.length];
}
