import type { DeckActionKind } from '../types/run';

// Shop-only labels for the 3 deck actions (MECHANIC_BRAINSTORM.md's Suit
// Reroll/Duplicate/Card Upgrade) -- pure display text, the actual
// eligibility/effect logic lives in engine/rewardGenerator.ts's
// eligibleDeckActions and runEngine.ts's resolveDeckAction. Shared by
// ShopScreen (where these are purchasable) and the dev Items tab
// (CompendiumScreen, a reference listing).
export const DECK_ACTION_INFO: Record<DeckActionKind, { name: string; description: string; pickPrompt: string }> = {
  transform: {
    name: 'Transform',
    description: 'Reroll a deck card into a random different suit.',
    pickPrompt: 'Choose a card to reroll into a different suit',
  },
  duplicate: {
    name: 'Duplicate',
    description: 'Copy a card already in your deck.',
    pickPrompt: 'Choose a card to duplicate',
  },
  upgrade: {
    name: 'Upgrade',
    description: "Promote a plain card into its suit's named special.",
    pickPrompt: 'Choose a plain card to upgrade',
  },
};
