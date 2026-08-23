import type { Card } from '../types/cards';
import type { Rng } from './rng';

/** Fisher-Yates using the seeded Rng, so runs (and reshuffles within a run) stay reproducible from a seed. */
export function shuffleDeck(deck: Card[], rng: Rng): Card[] {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export interface DrawResult {
  drawn: Card[];
  drawPile: Card[];
  discardPile: Card[];
}

/**
 * Draws up to `n` cards from drawPile, reshuffling discardPile into a fresh
 * drawPile mid-draw whenever drawPile runs out (standard deckbuilder
 * reshuffle-on-empty). Draws fewer than `n` cards, never throws, if both
 * piles run out -- the caller's deck is smaller than the hand size it asked
 * for, which is a legal (if awkward) state, not an error.
 */
export function drawCards(drawPile: Card[], discardPile: Card[], n: number, rng: Rng): DrawResult {
  let draw = [...drawPile];
  let discard = [...discardPile];
  const drawn: Card[] = [];

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
