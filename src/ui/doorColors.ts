import type { DoorColor } from '../types/door';

/** Shared between DoorCard.tsx and DoorTreeChoice.tsx -- both render the same door-color tag. */
export const DOOR_COLOR_HEX: Record<DoorColor, string> = { red: '#c0392b', blue: '#2471a3' };
