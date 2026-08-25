interface PlayControlsProps {
  isPlayerTurn: boolean;
  selectedSuitName: string | null;
  tableSetSize: number;
  selectedCount: number;
  canPlay: boolean;
  hasAnyLegalPlay: boolean;
  // True whenever the selected threat/weaken/poison suit has 2+ alive
  // enemies to choose from and none has been picked yet -- picked by
  // clicking the enemy's card directly (see EnemyPanel), not a menu here.
  needsTarget: boolean;
  // False once the turn's plays are used up and no unlimited-plays grant is
  // active -- playing is disabled regardless of what's selected, and the
  // player must Pass to end the turn.
  hasPlaysLeft: boolean;
  onPlay: () => void;
  onPass: () => void;
}

export function PlayControls({
  isPlayerTurn,
  selectedSuitName,
  tableSetSize,
  selectedCount,
  canPlay,
  hasAnyLegalPlay,
  needsTarget,
  hasPlaysLeft,
  onPlay,
  onPass,
}: PlayControlsProps) {
  const magnitude = tableSetSize * selectedCount;

  return (
    <div className="play-controls">
      {!isPlayerTurn && <div className="play-controls-note">Waiting on the room...</div>}
      {isPlayerTurn && (
        <>
          {!hasPlaysLeft ? (
            <div className="play-controls-note">No plays left this turn -- pass to end it.</div>
          ) : needsTarget ? (
            <div className="play-controls-note">
              Click an enemy above to target with {selectedSuitName} ({selectedCount} x {tableSetSize} ={' '}
              {magnitude}).
            </div>
          ) : canPlay ? (
            <div className="play-preview">
              Play {selectedSuitName}: {selectedCount} x {tableSetSize} = <strong>{magnitude}</strong>
              {magnitude === 0 && (
                <div className="play-preview-banking">Nothing to multiply yet -- banks these cards on the table for later.</div>
              )}
            </div>
          ) : (
            <div className="play-controls-note">
              {hasAnyLegalPlay ? 'Select matching cards to play a set.' : 'No legal plays available.'}
            </div>
          )}
          <div className="play-controls-buttons">
            <button type="button" disabled={!canPlay} onClick={onPlay}>
              Play
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
