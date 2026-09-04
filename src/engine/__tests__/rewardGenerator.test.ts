import { describe, it, expect } from 'vitest';
import { createRng } from '../rng';
import { generateRewardOffer, generateShopOptions, REWARD_SUITS } from '../rewardGenerator';
import type { Card } from '../../types/cards';

describe("reward weighting toward the cleared room's threat suits", () => {
  it('biases a reward\'s plain card-slot picks toward the given threatSuits, without making other suits impossible', () => {
    const rng = createRng(7);
    const suitCounts: Record<string, number> = {};
    for (let i = 0; i < 400; i++) {
      const offer = generateRewardOffer(i, rng, [], [], ['wolf']);
      for (const card of offer.cardOptions) {
        if (card.kind === 'creature' && !card.specialId) {
          suitCounts[card.suit] = (suitCounts[card.suit] ?? 0) + 1;
        }
      }
    }
    const total = Object.values(suitCounts).reduce((a, b) => a + b, 0);
    const wolfShare = (suitCounts.wolf ?? 0) / total;
    // Uniform-across-9-suits would land near 1/9 (~0.11) -- the bias should
    // put Wolf well above that.
    expect(wolfShare).toBeGreaterThan(0.4);
    // Off-suit variety must still be possible -- the uniform tail keeps
    // other suits from dropping to 0.
    const otherSuits = REWARD_SUITS.filter((s) => s !== 'wolf');
    expect(otherSuits.some((s) => (suitCounts[s] ?? 0) > 0)).toBe(true);
  });

  it('falls back to a plain uniform pick when threatSuits is empty', () => {
    const rng = createRng(9);
    const offer = generateRewardOffer(0, rng, [], [], []);
    expect(offer.cardOptions.length).toBeGreaterThan(0);
  });
});

describe('shop deck-action eligibility (Transform/Duplicate/Upgrade)', () => {
  it('never offers a deck-action slot when the deck has no creature cards', () => {
    const deck: Card[] = [{ id: 'q1', kind: 'quake' }];
    for (let i = 0; i < 50; i++) {
      const options = generateShopOptions(createRng(i), [], [], deck);
      expect(options.some((o) => o.optionType === 'deck-action')).toBe(false);
    }
  });

  it('offers Transform/Duplicate but never Upgrade when every creature card already has a specialId', () => {
    const deck: Card[] = [{ id: 'c1', kind: 'creature', suit: 'wolf', specialId: 'alpha-wolf' }];
    let sawTransformOrDuplicate = false;
    for (let i = 0; i < 50; i++) {
      const options = generateShopOptions(createRng(i), [], [], deck);
      for (const o of options) {
        if (o.optionType === 'deck-action') {
          expect(o.action).not.toBe('upgrade');
          sawTransformOrDuplicate = true;
        }
      }
    }
    expect(sawTransformOrDuplicate).toBe(true);
  });

  it('offers Upgrade when the deck has an eligible plain (no-specialId) card', () => {
    const deck: Card[] = [{ id: 'c1', kind: 'creature', suit: 'wolf' }];
    let sawUpgrade = false;
    for (let i = 0; i < 50; i++) {
      const options = generateShopOptions(createRng(i), [], [], deck);
      if (options.some((o) => o.optionType === 'deck-action' && o.action === 'upgrade')) sawUpgrade = true;
    }
    expect(sawUpgrade).toBe(true);
  });
});
