import { MIN_POOL_SET_SIZE } from '../../config/constants';

interface ClaimControlsProps {
  isPlayerTurn: boolean;
  selectedSuitName: string | null;
  isSelectedSuitBlocked: boolean;
  poolSetSize: number;
  selectedCount: number;
  canClaim: boolean;
  hasAnyLegalClaim: boolean;
  onClaim: () => void;
  onPass: () => void;
}

export function ClaimControls({
  isPlayerTurn,
  selectedSuitName,
  isSelectedSuitBlocked,
  poolSetSize,
  selectedCount,
  canClaim,
  hasAnyLegalClaim,
  onClaim,
  onPass,
}: ClaimControlsProps) {
  return (
    <div className="claim-controls">
      {!isPlayerTurn && <div className="claim-controls-note">Waiting on the room...</div>}
      {isPlayerTurn && (
        <>
          {canClaim ? (
            <div className="claim-preview">
              Claim {selectedSuitName}: {poolSetSize} x {selectedCount} ={' '}
              <strong>{poolSetSize * selectedCount}</strong>
            </div>
          ) : selectedSuitName ? (
            <div className="claim-controls-note">
              {isSelectedSuitBlocked
                ? `${selectedSuitName} is blocked this turn -- pick another suit.`
                : `Not enough ${selectedSuitName} in the pool to claim (need ${MIN_POOL_SET_SIZE}+, found ${poolSetSize}).`}
            </div>
          ) : (
            <div className="claim-controls-note">
              {hasAnyLegalClaim ? 'Select matching cards to claim a set.' : 'No legal claims available.'}
            </div>
          )}
          <div className="claim-controls-buttons">
            <button type="button" disabled={!canClaim} onClick={onClaim}>
              Claim
            </button>
            <button type="button" onClick={onPass}>
              Pass
            </button>
          </div>
        </>
      )}
    </div>
  );
}
