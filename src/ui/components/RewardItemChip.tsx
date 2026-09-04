import type { RelicDef } from '../../types/relics';
import type { PotionDef } from '../../types/potions';

// Relic/potion's own chip face -- gives each its own gradient+dashed-border
// treatment (same visual language card-chip--quake/card-chip--cleave
// already use for "not an ordinary suit card") rather than the plain dark
// text box they used to render as, so a relic or a potion reads as its own
// distinct kind of thing at a glance, the same way a card's suit color
// already does.
interface RewardItemChipProps {
  icon: string;
  name: string;
  description: string;
  variant: 'relic' | 'potion';
  onClick?: () => void;
}

function RewardItemChip({ icon, name, description, variant, onClick }: RewardItemChipProps) {
  return (
    <button
      type="button"
      className={`reward-item-chip reward-item-chip--${variant}`}
      onClick={onClick}
      title={description}
    >
      <span className="reward-item-chip-icon" aria-hidden="true">{icon}</span>
      <span className="reward-item-chip-name">{name}</span>
      <span className="reward-item-chip-desc">{description}</span>
    </button>
  );
}

export function RelicChip({ relic, onClick }: { relic: RelicDef; onClick?: () => void }) {
  return <RewardItemChip icon="💎" name={relic.name} description={relic.description} variant="relic" onClick={onClick} />;
}

export function PotionChip({ potion, onClick }: { potion: PotionDef; onClick?: () => void }) {
  return <RewardItemChip icon="🧪" name={potion.name} description={potion.description} variant="potion" onClick={onClick} />;
}
