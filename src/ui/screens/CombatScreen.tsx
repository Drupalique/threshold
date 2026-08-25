import { useEffect, useState } from 'react';
import { useRun } from '../../state/runContextObject';
import type { Card } from '../../types/cards';
import type { SuitId } from '../../types/suits';
import { getLegalPlaySets, requiresEnemyTarget } from '../../engine/combatEngine';
import { SUIT_DEFINITIONS, TURN_ANIMATION_DELAY_MS } from '../../config/constants';
import { useLogPlayback } from '../hooks/useLogPlayback';
import { MeterBar } from '../components/MeterBar';
import { TableDisplay } from '../components/TableDisplay';
import { HandDisplay } from '../components/HandDisplay';
import { EnemyPanel, StatusBadges } from '../components/EnemyPanel';
import { PlayControls } from '../components/PlayControls';
import { TurnLogFeed } from '../components/TurnLogFeed';

export function CombatScreen() {
  const { state, dispatchCombat, resolveCombatEnd } = useRun();
  const combat = state.combat!;

  const [selectedSuit, setSelectedSuit] = useState<SuitId | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedTargetInstanceId, setSelectedTargetInstanceId] = useState<string | null>(null);

  // Reset local selection whenever a new turn starts (hand contents change).
  // Adjusted during render (React's documented pattern for resetting state
  // in response to a prop/derived value change) rather than in an effect.
  const [lastSeenTurn, setLastSeenTurn] = useState(combat.turnNumber);
  if (combat.turnNumber !== lastSeenTurn) {
    setLastSeenTurn(combat.turnNumber);
    setSelectedSuit(null);
    setSelectedIds(new Set());
    setSelectedTargetInstanceId(null);
  }

  // A single dispatched action can drop several log entries at once (e.g. an
  // attack followed by an unrelated status tick in the same turn-end tick)
  // -- this drips them out one at a time instead of jumping straight to the
  // net result, so the sequence stays legible.
  const { visibleLog, displayedPlayerHP, displayedPlayerHPMax, displayedPlayerGuard, isPlaying } = useLogPlayback(
    combat.log,
  );

  const isPlayerTurn = combat.activeTurn === 'player' && combat.status === 'active';
  // "Your turn to act" also waits for the previous turn's log queue to
  // finish draining -- otherwise the player could play again while an
  // enemy's just-resolved action is still playing out.
  const canAct = isPlayerTurn && !isPlaying;

  // Auto-drive each enemy's turn on a short delay so its move is legible --
  // but only once the current log queue has finished draining. Re-fires
  // automatically for every enemy in a multi-enemy phase, since each one's
  // resolution bumps combat.turnNumber and keeps activeTurn === 'enemy'
  // until the whole phase concludes.
  useEffect(() => {
    if (combat.status !== 'active' || combat.activeTurn !== 'enemy' || isPlaying) return;
    const timer = setTimeout(() => {
      dispatchCombat({ type: 'ENEMY_TURN' });
    }, TURN_ANIMATION_DELAY_MS);
    return () => clearTimeout(timer);
  }, [combat.activeTurn, combat.status, combat.turnNumber, isPlaying, dispatchCombat]);

  // The round-ending action already updated the meters (see runEngine's
  // applyCombatAction) but deliberately left the phase on 'combat' -- hold
  // here, after the log queue finishes draining, so the HP bar actually
  // animates through its full sequence before we cut to the
  // door-choice/end screen.
  useEffect(() => {
    if (combat.status === 'active' || isPlaying) return;
    const timer = setTimeout(() => {
      resolveCombatEnd();
    }, TURN_ANIMATION_DELAY_MS);
    return () => clearTimeout(timer);
  }, [combat.status, isPlaying, resolveCombatEnd]);

  const legalTargets = canAct ? getLegalPlaySets(combat) : [];
  // Table piles aren't owned by any enemy -- every alive enemy offered here
  // is a legal target for the selected suit, picked by clicking its card in
  // EnemyPanel rather than a separate menu.
  const targetableInstanceIds = new Set(
    selectedSuit
      ? legalTargets.filter((t) => t.suit === selectedSuit && t.targetInstanceId).map((t) => t.targetInstanceId!)
      : [],
  );
  const needsTarget = targetableInstanceIds.size > 1 && !selectedTargetInstanceId;
  // Boon/guard/Vigor suits have no target; threat/Hex/Venom suits auto-
  // resolve onto the lone survivor when exactly one enemy is alive.
  const suitNeedsNoTarget = selectedSuit
    ? !requiresEnemyTarget(SUIT_DEFINITIONS.find((s) => s.id === selectedSuit)!.category)
    : true;

  function handleCardClick(card: Card) {
    if (!canAct) return;
    if (card.kind === 'quake') {
      dispatchCombat({ type: 'PLAYER_PLAY_QUAKE', cardId: card.id });
      return;
    }
    if (selectedSuit !== card.suit) {
      const matching = combat.playerHand.filter((c) => c.kind === 'creature' && c.suit === card.suit);
      setSelectedSuit(card.suit);
      setSelectedIds(new Set(matching.map((c) => c.id)));
      const targets = getLegalPlaySets(combat).filter((t) => t.suit === card.suit);
      setSelectedTargetInstanceId(targets.length === 1 ? (targets[0].targetInstanceId ?? null) : null);
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(card.id)) next.delete(card.id);
      else next.add(card.id);
      if (next.size === 0) setSelectedSuit(null);
      return next;
    });
  }

  function handlePlay() {
    if (!selectedSuit || selectedIds.size === 0) return;
    dispatchCombat({
      type: 'PLAY_SET',
      suit: selectedSuit,
      targetInstanceId: selectedTargetInstanceId ?? undefined,
      handCardIds: Array.from(selectedIds),
    });
    // A play doesn't always end the turn any more (see playsRemaining) --
    // the turnNumber-change effect above only resets selection when the
    // whole turn ends, so clear it here unconditionally instead of leaving
    // stale ids/suit pointing at cards this play just removed from hand.
    setSelectedSuit(null);
    setSelectedIds(new Set());
    setSelectedTargetInstanceId(null);
  }

  function handlePass() {
    dispatchCombat({ type: 'PLAYER_PASS' });
  }

  // tableSetSize is a property of the suit's table pile, not of any one
  // target -- every enemy offered for a threat suit shares the same value
  // (see getLegalPlaySets), so this must not filter by target or it reads
  // as 0 while the player is still picking who to target.
  const tableSetSize = selectedSuit
    ? (legalTargets.find((t) => t.suit === selectedSuit)?.tableSetSize ?? 0)
    : 0;
  const hasChosenTarget = suitNeedsNoTarget || selectedTargetInstanceId !== null;
  const hasPlaysLeft = combat.unlimitedPlaysThisTurn || combat.playsRemaining > 0;
  const canPlay =
    canAct &&
    hasPlaysLeft &&
    selectedSuit !== null &&
    selectedIds.size > 0 &&
    hasChosenTarget;

  return (
    <div className="combat-screen">
      <div className="combat-enemies">
        <EnemyPanel
          enemies={combat.enemies}
          targetableInstanceIds={targetableInstanceIds}
          selectedTargetInstanceId={selectedTargetInstanceId}
          onSelectTarget={setSelectedTargetInstanceId}
        />
      </div>

      <div
        className={[
          'combat-turn-indicator',
          combat.status === 'player-dead' ? 'combat-turn-indicator--dead' : '',
          combat.status === 'room-cleared' ? 'combat-turn-indicator--cleared' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {combat.status === 'player-dead' && 'You have fallen...'}
        {combat.status === 'room-cleared' && 'Room cleared!'}
        {combat.status === 'active' &&
          `Turn ${combat.turnNumber} -- ${isPlaying ? 'Resolving...' : isPlayerTurn ? 'Your turn' : "Enemies' turn"}`}
        {combat.status === 'active' && isPlayerTurn && !isPlaying && (
          <span className="combat-plays-remaining">
            {combat.unlimitedPlaysThisTurn
              ? ' -- Unlimited plays!'
              : ` -- ${combat.playsRemaining} play${combat.playsRemaining === 1 ? '' : 's'} left`}
          </span>
        )}
      </div>

      <div className="combat-main">
        <div className="combat-column">
          <TableDisplay table={combat.table} enemies={combat.enemies} highlightSuit={selectedSuit} />
          <HandDisplay
            hand={combat.playerHand}
            selectedIds={selectedIds}
            disabled={!canAct}
            onCardClick={handleCardClick}
            drawPileCount={combat.drawPile.length}
            discardPileCount={combat.discardPile.length}
          />
          {combat.status === 'active' && (
            <PlayControls
              isPlayerTurn={canAct}
              selectedSuitName={selectedSuit ? SUIT_DEFINITIONS.find((s) => s.id === selectedSuit)!.name : null}
              tableSetSize={tableSetSize}
              selectedCount={selectedIds.size}
              canPlay={canPlay}
              hasAnyLegalPlay={legalTargets.length > 0}
              needsTarget={needsTarget}
              hasPlaysLeft={hasPlaysLeft}
              onPlay={handlePlay}
              onPass={handlePass}
            />
          )}
        </div>
        <div className="combat-column combat-column--log">
          <TurnLogFeed log={visibleLog} />
        </div>
      </div>

      <div className="combat-player-stats meter-with-badge">
        <MeterBar label="Player HP" value={displayedPlayerHP} max={displayedPlayerHPMax} color="#27ae60" />
        {displayedPlayerGuard > 0 && <div className="guard-badge">Guard {displayedPlayerGuard}</div>}
        <StatusBadges statuses={combat.playerStatuses} />
      </div>
    </div>
  );
}
