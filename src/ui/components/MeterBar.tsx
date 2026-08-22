interface MeterBarProps {
  label: string;
  value: number;
  max: number;
  color: string;
}

export function MeterBar({ label, value, max, color }: MeterBarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="meter">
      <div className="meter-label">
        <span>{label}</span>
        <span>
          {Math.max(0, Math.round(value))} / {max}
        </span>
      </div>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
