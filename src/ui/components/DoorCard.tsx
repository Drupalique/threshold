import type { Door } from '../../types/door';

interface DoorCardProps {
  door: Door;
  onChoose: () => void;
}

const COLOR_HEX: Record<string, string> = { red: '#c0392b', blue: '#2471a3' };

export function DoorCard({ door, onChoose }: DoorCardProps) {
  return (
    <button type="button" className="door-card" onClick={onChoose}>
      <div className="door-card-visual" style={{ background: COLOR_HEX[door.tags.color] }} />
      <div className="door-card-tags">
        <div>Size: {door.tags.size}</div>
        <div>Color: {door.tags.color}</div>
      </div>
    </button>
  );
}
