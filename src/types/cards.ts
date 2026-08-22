import type { SuitId } from './suits';

export interface CreatureCard {
  id: string;
  kind: 'creature';
  suit: SuitId;
}

export type Card = CreatureCard;
