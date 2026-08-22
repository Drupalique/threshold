import { useEffect, useRef, useState } from 'react';
import { useRun } from '../../state/runContextObject';
import type { Card } from '../../types/cards';
import type { SuitId } from '../../types/suits';
import { getLegalPlayerClaimSuits } from '../../engine/combatEngine';
import {
  SUIT_DEFINITIONS,
  TURN_ANIMATION_DELAY_MS,
  MIN_POOL_SET_SIZE,
  CLAIM_REVEAL_DURATION_MS,
} from '../../config/constants';
import { useLogPlayback } from '../hooks/useLogPlayback';
import { MeterBar } from '../components/MeterBar';
import { PoolDisplay } from '../components/PoolDisplay';
import { HandDisplay } from '../components/HandDisplay';
import { RoomHandIndicator } from '../components/RoomHandIndicator';
import { ClaimControls } from '../components/ClaimControls';
import { TurnLogFeed } from '../components/TurnLogFeed';
import { BlockedSuitBanner } from '../components/BlockedSuitBanner';

export function CombatScreen() {
  const { state, dispatchCombat, resolveCombatEnd } = useRun();
  const combat = state.combat!;

  const [selectedSuit, setSelectedSuit] = useState<SuitId | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset local selection whenever a new turn starts (hand contents change).
  // Adjusted during render (React's documented pattern for resetting state
  // in response to a prop/derived value change) rather than in an effect.
  const [lastSeenTurn, setLastSeenTurn] = useState(combat.turnNumber);
  if (combat.turnNumber !== lastSeenTurn) {
    setLastSeenTurn(combat.turnNumber);
    setSelectedSuit(null);
    setSelectedIds(new Set());
  }

  // A single dispatched action can drop several log entries at once (e.g. a
  // claim's heal followed by an unrelated suit's decay penalty in the same
  // turn-end tick) -- this drips them out one at a time instead of jumping
  // the meters straight to the net result, so the sequence stays legible.
  const {
    visibleLog,
    displayedPlayerHP,
    displayedPlayerHPMax,
    displayedPlayerGuard,
    displayedRoomThreat,
    displayedRoomThreatMax,
    isPlaying,
  } = useLogPlayback(combat.log);

  // Briefly reveal + highlight a room claim's hand cards and pool set,
  // mirroring what the player sees while building their own claim -- except
  // the room's claim is already resolved by the time its log entry exists,
  // so this replays a snapshot of what was just taken rather than a live
  // selection. Keyed off `visibleLog` (not `combat.log`) so it fires in step
  // with the drip-fed log entry, not the instant the action was dispatched.
  const [roomClaimReveal, setRoomClaimReveal] = useState<{
    suit: SuitId;
    handCards: Card[];
    poolCards: Card[];
  } | null>(null);
  const lastRevealedClaimLogId = useRef<string | null>(null);
  // A plain ref, not effect-cleanup-scoped: the watcher effect below re-runs
  // on every drip step (each new visibleLog entry), and effect cleanup fires
  // on every one of those re-runs regardless of whether this branch matched
  // -- tying the clear-timeout to that cleanup would cancel it the moment
  // the *next* log entry drips in, ~450ms later, permanently stranding the
  // reveal on screen. Only a fresh reveal or unmount should cancel it.
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const last = visibleLog[visibleLog.length - 1];
    if (
      !last ||
      last.type !== 'claim' ||
      last.actor !== 'room' ||
      last.id === lastRevealedClaimLogId.current ||
      !last.claimSuit ||
      !last.claimedHandCards ||
      !last.claimedPoolCards
    ) {
      return;
    }
    lastRevealedClaimLogId.current = last.id;
    setRoomClaimReveal({ suit: last.claimSuit, handCards: last.claimedHandCards, poolCards: last.claimedPoolCards });
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    revealTimerRef.current = setTimeout(() => {
      setRoomClaimReveal(null);
      revealTimerRef.current = null;
    }, CLAIM_REVEAL_DURATION_MS);
  }, [visibleLog]);

  useEffect(() => {
    return () => {
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    };
  }, []);

  const isPlayerTurn = combat.activeTurn === 'player' && combat.status === 'active';
  // "Your turn to act" also waits for the previous turn's log queue to
  // finish draining -- otherwise the player could claim again while the
  // room's just-resolved decay hits are still playing out.
  const canAct = isPlayerTurn && !isPlaying;

  // Auto-drive the room's turn on a short delay so its move is legible --
  // but only once the current log queue has finished draining.
  useEffect(() => {
    if (combat.status !== 'active' || combat.activeTurn !== 'room' || isPlaying) return;
    const timer = setTimeout(() => {
      dispatchCombat({ type: 'ROOM_TURN' });
    }, TURN_ANIMATION_DELAY_MS);
    return () => clearTimeout(timer);
  }, [combat.activeTurn, combat.status, combat.turnNumber, isPlaying, dispatchCombat]);

  // The round-ending action already updated the meters (see runEngine's
  // applyCombatAction) but deliberately left the phase on 'combat' -- hold
  // here, after the log queue finishes draining, so the HP/Threat bar
  // actually animates through its full sequence before we cut to the
  // door-choice/end screen.
  useEffect(() => {
    if (combat.status === 'active' || isPlaying) return;
    const timer = setTimeout(() => {
      resolveCombatEnd();
    }, TURN_ANIMATION_DELAY_MS);
    return () => clearTimeout(timer);
  }, [combat.status, isPlaying, resolveCombatEnd]);

  function handleCardClick(card: Card) {
    if (!isPlayerTurn || card.kind !== 'creature') return;
    if (selectedSuit !== card.suit) {
      const matching = combat.playerHand.filter(
        (c): c is Extract<Card, { kind: 'creature' }> => c.kind === 'creature' && c.suit === card.suit,
      );
      setSelectedSuit(card.suit);
      setSelectedIds(new Set(matching.map((c) => c.id)));
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
    dispatchCombat({ type: 'PLAYER_CLAIM', suit: selectedSuit, handCardIds: Array.from(selectedIds) });
  }

  function handlePass() {
    dispatchCombat({ type: 'PLAYER_PASS' });
  }

  const poolSetSize = selectedSuit
    ? combat.pool.filter((c) => c.kind === 'creature' && c.suit === selectedSuit).length
    : 0;
  const legalSuits = canAct ? getLegalPlayerClaimSuits(combat) : [];
  const canClaim = canAct && selectedSuit !== null && selectedIds.size > 0 && poolSetSize >= MIN_POOL_SET_SIZE;
  const isSelectedSuitBlocked = selectedSuit !== null && (combat.blockedSuits[selectedSuit] ?? 0) > 0;

  return (
    <div className="combat-screen">
      <div className="combat-meters">
        <div className="meter-with-badge">
          <MeterBar label="Player HP" value={displayedPlayerHP} max={displayedPlayerHPMax} color="#27ae60" />
          {displayedPlayerGuard > 0 && (
            <div className="guard-badge">Guard {displayedPlayerGuard}</div>
          )}
        </div>
        <MeterBar label="Room Threat" value={displayedRoomThreat} max={displayedRoomThreatMax} color="#8e44ad" />
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
          `Turn ${combat.turnNumber} -- ${isPlaying ? 'Resolving...' : isPlayerTurn ? 'Your turn' : "Room's turn"}`}
      </div>

      <BlockedSuitBanner blockedSuits={combat.blockedSuits} />

      <div className="combat-main">
        <div className="combat-column">
          <RoomHandIndicator count={combat.roomHand.length} revealedCards={roomClaimReveal?.handCards} />
          <PoolDisplay
            pool={combat.pool}
            blockedSuits={combat.blockedSuits}
            decayCounters={combat.decayCounters}
            highlightSuit={selectedSuit}
            claimReveal={roomClaimReveal ? { suit: roomClaimReveal.suit, cards: roomClaimReveal.poolCards } : null}
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
              hasAnyLegalClaim={legalSuits.length > 0}
              onClaim={handleClaim}
              onPass={handlePass}
            />
          )}
        </div>
        <div className="combat-column combat-column--log">
          <TurnLogFeed log={visibleLog} />
        </div>
      </div>
    </div>
  );
}
