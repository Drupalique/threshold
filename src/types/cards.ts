import type { SuitId } from './suits';

export type SurpriseEffectType = 'add-cards' | 'block-suit' | 'force-discard';

export interface CreatureCard {
  id: string;
  kind: 'creature';
  suit: SuitId;
}

export interface SurpriseCard {
  id: string;
  kind: 'surprise';
  effect: SurpriseEffectType;
}

export type Card = CreatureCard | SurpriseCard;
