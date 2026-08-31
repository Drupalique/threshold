import type { RoomInstance } from '../types/room';
import { SUIT_DEFINITIONS } from '../config/constants';

const suitName = (id: string) => SUIT_DEFINITIONS.find((s) => s.id === id)?.name ?? id;

export interface RoomSummary {
  /** Very short label -- fits a compact tree-node chip. */
  label: string;
  /** Fuller line-by-line detail -- fits a hover/click popover. */
  detail: string[];
}

/** Describes a RoomInstance for display in RunTreeView's chips/tooltips (see ui/components/RunTreeView.tsx). Enemy hands/decks aren't dealt yet at tree-build time, so this only ever reads name/hpMax/isElite. */
export function summarizeRoom(room: RoomInstance): RoomSummary {
  if (room.kind === 'rest') {
    return { label: 'Rest', detail: ['Rest room -- heal or remove a card'] };
  }

  const names = room.enemies.map((e) => `${e.name}${e.isElite ? ' (Elite)' : ''} (${e.hpMax} HP)`);
  const label =
    room.enemies.length === 1
      ? room.enemies[0].name
      : `${room.enemies.length}x ${room.enemies[0]?.name ?? 'enemies'}`;

  return {
    label,
    detail: [
      `${room.params.sizeBand} room, ${room.enemies.length} ${room.enemies.length === 1 ? 'enemy' : 'enemies'}`,
      `Threat suits: ${room.params.threatSuits.map(suitName).join(', ')}`,
      ...names,
    ],
  };
}
