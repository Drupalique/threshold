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

// A QuakeCard/CleaveCard carries no suit, and each one is rare/one-off
// enough that treating it as its own always-distinct "suit" (keyed by kind
// and id) is simplest -- it never counts as clumping with anything, itself
// included.
function suitKeyOf(card: Card): string {
  return card.kind === 'creature' ? card.suit : `${card.kind}:${card.id}`;
}

/**
 * Shuffles `deck` with the seeded Rng, then interleaves it so a
 * genuinely-random order doesn't still *feel* clumpy at the table (e.g. 3
 * Wolves landing back to back in a hand). Cards are bucketed by suit
 * (bucket order and each bucket's internal order both come straight from
 * the Fisher-Yates shuffle, so which suit wins a size tie is still
 * seed-random, not fixed), then built up one card at a time by always
 * pulling from the largest remaining bucket that isn't the one the last
 * card came from -- the standard greedy for "rearrange so no two adjacent
 * match" (equivalent to LeetCode's Reorganize String), which is provably
 * optimal: it produces zero adjacent same-suit pairs whenever that's
 * possible at all, and when one suit makes up more than half the deck (the
 * only case where some adjacency is unavoidable) it's forced to fall back
 * to repeating the prior bucket only exactly as often as the math demands.
 * No extra rng draws beyond the initial shuffle, so results stay
 * reproducible from a seed. Generic so it works for both the player's
 * Card[] deck and an enemy's CreatureCard[] deck.
 */
export function shuffleDeck<T extends Card>(deck: T[], rng: Rng): T[] {
  const shuffled = fisherYates(deck, rng);

  const buckets = new Map<string, T[]>();
  for (const card of shuffled) {
    const bucket = buckets.get(suitKeyOf(card));
    if (bucket) bucket.push(card);
    else buckets.set(suitKeyOf(card), [card]);
  }
  const groups = [...buckets.values()];

  const result: T[] = [];
  let lastGroup: T[] | null = null;
  while (result.length < shuffled.length) {
    let best: T[] | null = null;
    for (const group of groups) {
      if (group.length === 0 || group === lastGroup) continue;
      if (!best || group.length > best.length) best = group;
    }
    if (!best) best = lastGroup!; // every other bucket is empty -- a repeat here is unavoidable
    result.push(best.shift()!);
    lastGroup = best;
  }
  return result;
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
