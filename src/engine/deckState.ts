import type { Card } from '../types/cards';
import type { Rng } from './rng';

function fisherYates<T>(deck: T[], rng: Rng): T[] {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Shuffles `deck` with the seeded Rng. Plain Fisher-Yates -- a prior version
 * of this also interleaved by suit to avoid same-suit runs, but that made
 * hands read as patterned/arranged rather than dealt, so it's back to
 * genuinely random order. Generic so it works for both the player's Card[]
 * deck and an enemy's CreatureCard[] deck.
 */
export function shuffleDeck<T extends Card>(deck: T[], rng: Rng): T[] {
  return fisherYates(deck, rng);
}

export interface DrawResult<T extends Card> {
  drawn: T[];
  drawPile: T[];
  discardPile: T[];
}

/**
 * Draws up to `n` cards from drawPile, reshuffling discardPile into a fresh
 * drawPile mid-draw whenever drawPile runs out (standard deckbuilder
 * reshuffle-on-empty). Draws fewer than `n` cards, never throws, if both
 * piles run out -- the caller's deck is smaller than the hand size it asked
 * for, which is a legal (if awkward) state, not an error. Generic over T so
 * this same logic drives both the player's persistent deck and each
 * enemy's own hand/deck cycle (see types/enemy.ts).
 */
export function drawCards<T extends Card>(drawPile: T[], discardPile: T[], n: number, rng: Rng): DrawResult<T> {
  let draw = [...drawPile];
  let discard = [...discardPile];
  const drawn: T[] = [];

  for (let i = 0; i < n; i++) {
    if (draw.length === 0) {
      if (discard.length === 0) break;
      draw = shuffleDeck(discard, rng);
      discard = [];
    }
    drawn.push(draw.shift()!);
  }

  return { drawn, drawPile: draw, discardPile: discard };
}

export interface TopUpResult<T extends Card> {
  hand: T[];
  drawPile: T[];
  discardPile: T[];
}

/**
 * Tops `hand` up to `handSize`, drawing only the shortfall and leaving
 * whatever's already in hand untouched -- the "draw up to your hand size
 * at the start of your own turn, keeping leftover cards" rule, shared by
 * the player and every enemy. A hand already at or above handSize draws
 * nothing and is returned as-is.
 */
export function topUpHand<T extends Card>(
  hand: T[],
  drawPile: T[],
  discardPile: T[],
  handSize: number,
  rng: Rng,
): TopUpResult<T> {
  const needed = Math.max(0, handSize - hand.length);
  const { drawn, drawPile: nextDrawPile, discardPile: nextDiscardPile } = drawCards(drawPile, discardPile, needed, rng);
  return { hand: [...hand, ...drawn], drawPile: nextDrawPile, discardPile: nextDiscardPile };
}
