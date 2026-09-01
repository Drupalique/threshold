import type { PotionDef, PotionKind } from '../../types/potions';
import type { SuitId } from '../../types/suits';
import type { LegalPotionUse } from '../../engine/combatEngine';
import { SUIT_DEFINITIONS } from '../../config/constants';

export interface PendingPotion {
  kind: PotionKind;
  suit: SuitId | null;
  targetInstanceId: string | null;
}

interface PotionControlsProps {
  potions: PotionDef[];
  legalFreeClaimUses: LegalPotionUse[];
  legalSaltUses: LegalPotionUse[];
  canAct: boolean;
  pending: PendingPotion | null;
  // True once a suit is picked for Free Claim but its category still needs
  // an enemy target and none is chosen yet -- mirrors PlayControls'
  // needsTarget, driven by the same shared EnemyPanel click surface (see
  // CombatScreen.tsx).
  needsTarget: boolean;
  onSelectKind: (kind: PotionKind) => void;
  onSelectSuit: (suit: SuitId) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function suitLabel(suit: SuitId): string {
  return SUIT_DEFINITIONS.find((s) => s.id === suit)!.name;
}

// Suit chips for whichever kind is pending -- deduped, since getLegalFreeClaimUses
// fans out one entry per (suit, target) pair for enemy-targeted suits.
function suitOptionsFor(kind: PotionKind, freeClaim: LegalPotionUse[], salt: LegalPotionUse[]): LegalPotionUse[] {
  const source = kind === 'free-claim' ? freeClaim : salt;
  const seen = new Set<string>();
  const out: LegalPotionUse[] = [];
  for (const u of source) {
    if (seen.has(u.suit)) continue;
    seen.add(u.suit);
    out.push(u);
  }
  return out;
}

/**
 * Held-potion panel: pick a kind, then a suit (see PendingPotion/CombatScreen
 * for how enemy targeting is threaded through the same EnemyPanel plays use).
 * Both potion kinds are free actions -- using one never spends a play or
 * ends the turn, so this stays usable alongside PlayControls, not instead of
 * it.
 */
export function PotionControls({
  potions,
  legalFreeClaimUses,
  legalSaltUses,
  canAct,
  pending,
  needsTarget,
  onSelectKind,
  onSelectSuit,
  onConfirm,
  onCancel,
}: PotionControlsProps) {
  if (potions.length === 0) return null;

  const counts = new Map<PotionKind, { def: PotionDef; count: number }>();
  for (const p of potions) {
    const entry = counts.get(p.kind);
    if (entry) entry.count++;
    else counts.set(p.kind, { def: p, count: 1 });
  }

  const canConfirm = pending !== null && pending.suit !== null && !needsTarget;

  return (
    <div className="potion-controls">
      <div className="potion-controls-buttons">
        {Array.from(counts.values()).map(({ def, count }) => (
          <button
            key={def.kind}
            type="button"
            className={pending?.kind === def.kind ? 'potion-kind-button potion-kind-button--active' : 'potion-kind-button'}
            disabled={!canAct}
            title={def.description}
            onClick={() => onSelectKind(def.kind)}
          >
            {def.name} x{count}
          </button>
        ))}
      </div>
      {pending && (
        <div className="potion-suit-picker">
          {suitOptionsFor(pending.kind, legalFreeClaimUses, legalSaltUses).map((u) => (
            <button
              key={u.suit}
              type="button"
              className={pending.suit === u.suit ? 'potion-suit-chip potion-suit-chip--selected' : 'potion-suit-chip'}
              onClick={() => onSelectSuit(u.suit)}
            >
              {suitLabel(u.suit)} ({u.amount})
            </button>
          ))}
          {suitOptionsFor(pending.kind, legalFreeClaimUses, legalSaltUses).length === 0 && (
            <span className="potion-controls-note">Nothing on the table this potion can act on right now.</span>
          )}
          {needsTarget && <span className="potion-controls-note">Click an enemy above to target.</span>}
          <div className="potion-controls-confirm">
            <button type="button" disabled={!canConfirm} onClick={onConfirm}>
              Use
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
