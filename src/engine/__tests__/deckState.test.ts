import { describe, it, expect } from 'vitest';
import { createRng } from '../rng';
import { shuffleDeck, drawCards } from '../deckState';
import type { Card } from '../../types/cards';

function makeCards(n: number, prefix = 'c'): Card[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, kind: 'creature' as const, suit: 'wolf' as const }));
}

describe('shuffleDeck', () => {
  it('preserves every card -- a permutation, not a resample', () => {
    const deck = makeCards(10);
    const shuffled = shuffleDeck(deck, createRng(1));
    expect(shuffled).toHaveLength(deck.length);
    expect(new Set(shuffled.map((c) => c.id))).toEqual(new Set(deck.map((c) => c.id)));
  });

  it('is deterministic for a given seed', () => {
    const deck = makeCards(10);
    const a = shuffleDeck(deck, createRng(7));
    const b = shuffleDeck(deck, createRng(7));
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });

  it('breaks up same-suit runs so equal-sized suits never land adjacent', () => {
    const suits = ['wolf', 'ember', 'rot', 'spider'] as const;
    const deck: Card[] = suits.flatMap((suit) =>
      Array.from({ length: 5 }, (_, i) => ({ id: `${suit}${i}`, kind: 'creature' as const, suit })),
    );
    for (let seed = 1; seed <= 20; seed++) {
      const shuffled = shuffleDeck(deck, createRng(seed));
      expect(new Set(shuffled.map((c) => c.id))).toEqual(new Set(deck.map((c) => c.id))); // still a permutation
      for (let i = 1; i < shuffled.length; i++) {
        const prev = shuffled[i - 1] as { suit: string };
        const cur = shuffled[i] as { suit: string };
        expect(cur.suit).not.toBe(prev.suit);
      }
    }
  });

  it('leaves unavoidable adjacency in place rather than looping forever when one suit dominates', () => {
    const deck: Card[] = [
      ...Array.from({ length: 8 }, (_, i) => ({ id: `w${i}`, kind: 'creature' as const, suit: 'wolf' as const })),
      { id: 'e0', kind: 'creature' as const, suit: 'ember' as const },
    ];
    const shuffled = shuffleDeck(deck, createRng(3));
    expect(new Set(shuffled.map((c) => c.id))).toEqual(new Set(deck.map((c) => c.id)));
  });
});

describe('drawCards', () => {
  it('draws straight from drawPile when it already has enough cards', () => {
    const draw = makeCards(5, 'd');
    const result = drawCards(draw, [], 3, createRng(2));
    expect(result.drawn).toHaveLength(3);
    expect(result.drawPile).toHaveLength(2);
    expect(result.discardPile).toHaveLength(0);
  });

  it('reshuffles discardPile into a fresh drawPile once drawPile runs out mid-draw', () => {
    const draw = makeCards(2, 'd');
    const discard = makeCards(3, 'x');
    const result = drawCards(draw, discard, 4, createRng(3));
    expect(result.drawn).toHaveLength(4);
    // 2 from the original drawPile, then a reshuffle of discard supplies the
    // remaining 2, leaving 1 card behind in the new drawPile.
    expect(result.drawPile).toHaveLength(1);
    expect(result.discardPile).toHaveLength(0);
    const allIds = new Set([...result.drawn, ...result.drawPile].map((c) => c.id));
    expect(allIds.size).toBe(5); // no card lost or duplicated across the reshuffle
  });

  it('handles the exact boundary where drawPile empties on the very last card needed, without an unnecessary reshuffle', () => {
    const draw = makeCards(3, 'd');
    const discard = makeCards(2, 'x');
    const result = drawCards(draw, discard, 3, createRng(4));
    expect(result.drawn.map((c) => c.id).sort()).toEqual(['d0', 'd1', 'd2']);
    // Exactly enough in drawPile -- discardPile is left untouched, not
    // reshuffled a beat early.
    expect(result.discardPile).toHaveLength(2);
    expect(result.drawPile).toHaveLength(0);
  });

  it('draws fewer than requested, never throws, if both piles run out', () => {
    const draw = makeCards(1, 'd');
    const result = drawCards(draw, [], 4, createRng(5));
    expect(result.drawn).toHaveLength(1);
    expect(result.drawPile).toHaveLength(0);
    expect(result.discardPile).toHaveLength(0);
  });
});
