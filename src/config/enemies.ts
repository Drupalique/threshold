import type { EnemyDef } from '../types/enemy';
import { cardCopies } from './cardHelpers';

/**
 * Static enemy roster. Each def's `deck` is a small, directly-authored card
 * list (mirrors STARTER_DECK's style, not a ratio-generator) -- an enemy's
 * suit slant IS its identity now, replacing the old fixed pattern cycle
 * under the Earthquake-style rewrite's full symmetry (enemies draw a hand
 * and choose plays exactly like the player; see engine/enemyAI.ts).
 * `minFloor` gates a def into `roomGenerator`'s eligible pool once
 * `run.depth + 1 >= minFloor`. Magnitudes/deck sizes are first-cut numbers,
 * not tuned.
 */
export const ENEMY_DEFS: EnemyDef[] = [
  {
    id: 'wolf-kin',
    name: 'Wolf-kin',
    hpMax: 14,
    minFloor: 1,
    // Old pattern was 2 attacks : 1 Strength buff, zero defense or support --
    // a glass-cannon striker. Deck mirrors that ratio directly: no
    // guard/boon/status suits at all, so it can only ever attack or buff
    // itself, never patch up or debuff back.
    deck: [...cardCopies('wolf', 7, 'wolfkin-deck'), ...cardCopies('vigor', 3, 'wolfkin-deck')],
  },
  {
    id: 'ember-wretch',
    name: 'Ember Wretch',
    hpMax: 16,
    minFloor: 1,
    // Old pattern was the single most attack-heavy kit in the roster (2 of 3
    // steps were plain attacks, the third was disruption, never anything
    // defensive/supportive). Deck stays almost entirely Ember, with just 2
    // Ward cards so it isn't literally incapable of ever guarding -- a
    // near-total glass cannon, more so than Wolf-kin.
    deck: [...cardCopies('ember', 8, 'emberwretch-deck'), ...cardCopies('ward', 2, 'emberwretch-deck')],
  },
  {
    id: 'rot-husk',
    name: 'Rot Husk',
    hpMax: 18,
    minFloor: 2,
    // Old pattern demonstrated the most kit variety of any enemy (debuff,
    // attack, heal, feed-Ward) -- a patient, control-flavored enemy. Deck
    // spreads across all four direct analogs: Rot (threat), Hex (weaken, was
    // its Debuff step), Grace (heal, was its Heal step), Ward (was its "feed
    // Ward, bank a shield" step -- now that Ward is a symmetric suit, Rot
    // Husk can finally guard ITSELF directly instead of laboriously
    // fattening a pile it could never claim).
    deck: [
      ...cardCopies('rot', 3, 'rothusk-deck'),
      ...cardCopies('hex', 3, 'rothusk-deck'),
      ...cardCopies('grace', 2, 'rothusk-deck'),
      ...cardCopies('ward', 2, 'rothusk-deck'),
    ],
  },
  {
    id: 'spider-broodmother',
    name: 'Spider Broodmother',
    hpMax: 22,
    minFloor: 3,
    // Old pattern: reinforcements, big attack, poison bite, guard -- no heal.
    // Deck reflects the three surviving flavors (Spider/threat, Venom/
    // poison, Ward/guard) roughly evenly, with a slight lean toward Spider
    // since it was always the biggest single hit in its old cycle. The
    // highest-minFloor, highest-HP enemy also gets the most balanced kit of
    // the four, by design -- it's the "complete" threat.
    deck: [
      ...cardCopies('spider', 4, 'spiderbroodmother-deck'),
      ...cardCopies('venom', 3, 'spiderbroodmother-deck'),
      ...cardCopies('ward', 3, 'spiderbroodmother-deck'),
    ],
  },
];

export function enemyDefById(id: string): EnemyDef {
  const def = ENEMY_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown enemy def: ${id}`);
  return def;
}
