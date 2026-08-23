import { useEffect, useState } from 'react';
import { useRun } from '../../state/runContextObject';
import type { Card } from '../../types/cards';
import type { SuitId } from '../../types/suits';
import { getLegalPlayerClaimTargets, requiresEnemyTarget } from '../../engine/combatEngine';
import {
  SUIT_DEFINITIONS,
  TURN_ANIMATION_DELAY_MS,
  MIN_POOL_SET_SIZE,
} from '../../config/constants';
import { useLogPlayback } from '../hooks/useLogPlayback';
import { MeterBar } from '../components/MeterBar';
import { PoolDisplay } from '../components/PoolDisplay';
import { HandDisplay } from '../components/HandDisplay';
import { EnemyPanel, StatusBadges } from '../components/EnemyPanel';
import { ClaimControls } from '../components/ClaimControls';
import { TurnLogFeed } from '../components/TurnLogFeed';
import { BlockedSuitBanner } from '../components/BlockedSuitBanner';

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
  // attack followed by an unrelated suit's decay penalty in the same
  // turn-end tick) -- this drips them out one at a time instead of jumping
  // straight to the net result, so the sequence stays legible.
  const { visibleLog, displayedPlayerHP, displayedPlayerHPMax, displayedPlayerGuard, isPlaying } = useLogPlayback(
    combat.log,
  );

  const isPlayerTurn = combat.activeTurn === 'player' && combat.status === 'active';
  // "Your turn to act" also waits for the previous turn's log queue to
  // finish draining -- otherwise the player could claim again while an
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

  const legalTargets = canAct ? getLegalPlayerClaimTargets(combat) : [];
  // Threat piles aren't owned by any enemy (design doc 4.8) -- every alive
  // enemy offered here is a legal target for the selected suit, picked by
  // clicking its card in EnemyPanel rather than a separate menu.
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
    if (!isPlayerTurn) return;
    if (selectedSuit !== card.suit) {
      const matching = combat.playerHand.filter((c) => c.suit === card.suit);
      setSelectedSuit(card.suit);
      setSelectedIds(new Set(matching.map((c) => c.id)));
      const targets = getLegalPlayerClaimTargets(combat).filter((t) => t.suit === card.suit);
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

  function handleClaim() {
    if (!selectedSuit || selectedIds.size === 0) return;
    dispatchCombat({
      type: 'PLAYER_CLAIM',
      suit: selectedSuit,
      targetInstanceId: selectedTargetInstanceId ?? undefined,
      handCardIds: Array.from(selectedIds),
    });
  }

  function handlePass() {
    dispatchCombat({ type: 'PLAYER_PASS' });
  }

  // poolSetSize is a property of the suit's pool pile, not of any one
  // target -- every enemy offered for a threat suit shares the same value
  // (see getLegalPlayerClaimTargets), so this must not filter by target or
  // it reads as 0 while the player is still picking who to target.
  const poolSetSize = selectedSuit
    ? (legalTargets.find((t) => t.suit === selectedSuit)?.poolSetSize ?? 0)
    : 0;
  const hasChosenTarget = suitNeedsNoTarget || selectedTargetInstanceId !== null;
  const canClaim =
    canAct && selectedSuit !== null && selectedIds.size > 0 && hasChosenTarget && poolSetSize >= MIN_POOL_SET_SIZE;
  const isSelectedSuitBlocked = selectedSuit !== null && (combat.blockedSuits[selectedSuit] ?? 0) > 0;

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
      </div>

      <BlockedSuitBanner blockedSuits={combat.blockedSuits} />

      <div className="combat-main">
        <div className="combat-column">
          <PoolDisplay
            pool={combat.pool}
            blockedSuits={combat.blockedSuits}
            decayCounters={combat.decayCounters}
            highlightSuit={selectedSuit}
          />
          <HandDisplay
            hand={combat.playerHand}
            selectedIds={selectedIds}
            disabled={!canAct}
            onCardClick={handleCardClick}
          />
          {combat.status === 'active' && (
            <ClaimControls
              isPlayerTurn={canAct}
              selectedSuitName={selectedSuit ? SUIT_DEFINITIONS.find((s) => s.id === selectedSuit)!.name : null}
              isSelectedSuitBlocked={isSelectedSuitBlocked}
              poolSetSize={poolSetSize}
              selectedCount={selectedIds.size}
              canClaim={canClaim}
              hasAnyLegalClaim={legalTargets.length > 0}
              needsTarget={needsTarget}
              onClaim={handleClaim}
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
