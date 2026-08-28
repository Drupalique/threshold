import type { EnemyDef } from '../types/enemy';
import { cardCopies, specialCard } from './cardHelpers';
import { specialCardById } from './specialCards';

/**
 * Static enemy roster. Each def's `deck` is a small, directly-authored card
 * list (mirrors STARTER_DECK's style, not a ratio-generator) -- an enemy's
 * suit slant IS its identity now, replacing the old fixed pattern cycle
 * under the Earthquake-style rewrite's full symmetry (enemies draw a hand
 * and choose plays exactly like the player; see engine/enemyAI.ts).
 * `minFloor` gates a def into `roomGenerator`'s eligible pool once
 * `run.depth + 1 >= minFloor`. Magnitudes/deck sizes are first-cut numbers,
 * not tuned.
 *
 * Floors 1-3 are the original four (below); floors 4-9 add five new
 * archetypes not previously represented -- a suit-less pure controller, a
 * Ward-primary tank, the roster's first dual-threat-suit hybrid, a
 * Grace-primary self-healer, and a late apex glass cannon -- so a full
 * `RUN_MAX_DEPTH`-length run keeps introducing new kits instead of
 * recycling the same four with bigger HP bars. `THE_UNDYING_WARLORD` is the
 * one `isElite` def: `minFloor: 10` alongside `isElite: true` is
 * belt-and-suspenders (roomGenerator's pickEnemies excludes every
 * `isElite` def from the normal pool outright, then forces a solo elite
 * encounter once `floor >= RUN_MAX_DEPTH`), guaranteeing the run's final
 * room is a single substantial boss fight rather than a random 3-pack of
 * whatever's eligible.
 */
export const ENEMY_DEFS: EnemyDef[] = [
  {
    id: 'wolf-kin',
    name: 'Wolf-kin',
    hpMax: 14,
    minFloor: 1,
    handSize: 2,
    // Old pattern was 2 attacks : 1 Strength buff, zero defense or support --
    // a glass-cannon striker. Deck mirrors that ratio directly: no
    // guard/boon/status suits at all, so it can only ever attack or buff
    // itself, never patch up or debuff back.
    // One of its Wolf copies is the named Alpha Wolf signature card (see
    // config/specialCards.ts) -- suit count is unchanged, so its threat/buff
    // ratio is identical to before specials existed.
    deck: [
      ...cardCopies('wolf', 6, 'wolfkin-deck'),
      specialCard(specialCardById('alpha-wolf'), 'wolfkin-deck'),
      ...cardCopies('vigor', 3, 'wolfkin-deck'),
    ],
  },
  {
    id: 'ember-wretch',
    name: 'Ember Wretch',
    hpMax: 16,
    minFloor: 1,
    handSize: 2,
    // Old pattern was the single most attack-heavy kit in the roster (2 of 3
    // steps were plain attacks, the third was disruption, never anything
    // defensive/supportive). Deck stays almost entirely Ember, with just 2
    // Ward cards so it isn't literally incapable of ever guarding -- a
    // near-total glass cannon, more so than Wolf-kin.
    // One of its Ember copies is the named Wildfire signature card.
    deck: [
      ...cardCopies('ember', 7, 'emberwretch-deck'),
      specialCard(specialCardById('wildfire'), 'emberwretch-deck'),
      ...cardCopies('ward', 2, 'emberwretch-deck'),
    ],
  },
  {
    id: 'rot-husk',
    name: 'Rot Husk',
    hpMax: 18,
    minFloor: 2,
    handSize: 3,
    // Old pattern demonstrated the most kit variety of any enemy (debuff,
    // attack, heal, feed-Ward) -- a patient, control-flavored enemy. Deck
    // spreads across all four direct analogs: Rot (threat), Hex (weaken, was
    // its Debuff step), Grace (heal, was its Heal step), Ward (was its "feed
    // Ward, bank a shield" step -- now that Ward is a symmetric suit, Rot
    // Husk can finally guard ITSELF directly instead of laboriously
    // fattening a pile it could never claim).
    // One of its Rot copies is the named Rot Colossus signature card.
    deck: [
      ...cardCopies('rot', 2, 'rothusk-deck'),
      specialCard(specialCardById('rot-colossus'), 'rothusk-deck'),
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
    handSize: 4,
    // Old pattern: reinforcements, big attack, poison bite, guard -- no heal.
    // Deck reflects the three surviving flavors (Spider/threat, Venom/
    // poison, Ward/guard) roughly evenly, with a slight lean toward Spider
    // since it was always the biggest single hit in its old cycle. The
    // highest-minFloor, highest-HP enemy also gets the most balanced kit of
    // the four, by design -- it's the "complete" threat.
    // One of its Spider copies is the named Broodcaller signature card.
    deck: [
      ...cardCopies('spider', 3, 'spiderbroodmother-deck'),
      specialCard(specialCardById('broodcaller'), 'spiderbroodmother-deck'),
      ...cardCopies('venom', 3, 'spiderbroodmother-deck'),
      ...cardCopies('ward', 3, 'spiderbroodmother-deck'),
    ],
  },
  {
    id: 'marsh-wraith',
    name: 'Marsh Wraith',
    hpMax: 24,
    minFloor: 4,
    handSize: 3,
    // The roster's first def with zero threat-category cards -- it can
    // never claim a threat suit at all. Entirely Hex (Weaken, cripples the
    // player's own outgoing threat damage) and Venom (Poison, a ticking
    // drain), both of which still map to bonus-damage riders (see
    // specialCards.ts's riderKindForCategory), so it isn't literally
    // harmless -- it just does all its damage as chip riders and stacking
    // decay instead of a direct claim, forcing a genuinely different read
    // than any "big attack coming" enemy.
    deck: [
      ...cardCopies('hex', 4, 'marshwraith-deck'),
      specialCard(specialCardById('withering-hex'), 'marshwraith-deck'),
      ...cardCopies('venom', 4, 'marshwraith-deck'),
      specialCard(specialCardById('widows-kiss'), 'marshwraith-deck'),
    ],
  },
  {
    id: 'stoneward-golem',
    name: 'Stoneward Golem',
    hpMax: 27,
    minFloor: 5,
    handSize: 3,
    // First def where Ward -- previously always a 2-3 card support
    // sprinkle on someone else's kit -- is the single biggest suit: a true
    // tank that banks its own Guard faster than its middling Rot threat
    // can be raced down. The 2 Vigor cards mean a fight dragged out long
    // enough lets it start snowballing too, punishing a purely defensive
    // stall against it.
    deck: [
      ...cardCopies('ward', 3, 'stonewardgolem-deck'),
      specialCard(specialCardById('bastion-heart'), 'stonewardgolem-deck'),
      ...cardCopies('rot', 3, 'stonewardgolem-deck'),
      specialCard(specialCardById('rot-colossus'), 'stonewardgolem-deck'),
      ...cardCopies('vigor', 2, 'stonewardgolem-deck'),
    ],
  },
  {
    id: 'chimera-stalker',
    name: 'Chimera Stalker',
    hpMax: 30,
    minFloor: 6,
    handSize: 4,
    // The roster's first dual-threat-suit def -- Wolf and Spider (both
    // "red" in SUIT_COLOR_FAMILY) at even weight, so a single Weaken/guard
    // plan built around one threat suit only ever answers half its
    // pressure. Ward at the same weight as either threat suit keeps it
    // from being pure aggression on top of that.
    deck: [
      ...cardCopies('wolf', 2, 'chimerastalker-deck'),
      specialCard(specialCardById('alpha-wolf'), 'chimerastalker-deck'),
      ...cardCopies('spider', 2, 'chimerastalker-deck'),
      specialCard(specialCardById('broodcaller'), 'chimerastalker-deck'),
      ...cardCopies('ward', 3, 'chimerastalker-deck'),
    ],
  },
  {
    id: 'cinder-priest',
    name: 'Cinder Priest',
    hpMax: 30,
    minFloor: 7,
    handSize: 4,
    // First def where Grace -- previously a 1-2 card garnish on Rot Husk's
    // kit -- is a full half of the deck: a genuine self-healer that turns
    // a slow fight into a war of attrition instead of a burst race,
    // directly rewarding (and punishing indecision in) a longer run rather
    // than just gating a bigger HP bar behind a later floor.
    deck: [
      ...cardCopies('ember', 3, 'cinderpriest-deck'),
      specialCard(specialCardById('wildfire'), 'cinderpriest-deck'),
      ...cardCopies('grace', 3, 'cinderpriest-deck'),
      specialCard(specialCardById('blessed-grace'), 'cinderpriest-deck'),
    ],
  },
  {
    id: 'bonecrusher-ogre',
    name: 'Bonecrusher Ogre',
    hpMax: 34,
    minFloor: 8,
    handSize: 4,
    // Rot's turn at the "near-total glass cannon" archetype Wolf-kin/Ember
    // Wretch established early (§3) -- Rot had only ever appeared as a
    // control suit (Rot Husk, Stoneward Golem) until now. Almost entirely
    // Rot with just enough Vigor to keep snowballing a fight that runs
    // long, no defensive or support suit at all.
    deck: [
      ...cardCopies('rot', 6, 'bonecrusherogre-deck'),
      specialCard(specialCardById('rot-colossus'), 'bonecrusherogre-deck'),
      ...cardCopies('vigor', 2, 'bonecrusherogre-deck'),
    ],
  },
  {
    id: 'deepfang-matriarch',
    name: 'Deepfang Matriarch',
    hpMax: 36,
    minFloor: 9,
    handSize: 5,
    // The late-game apex predator: Spider Broodmother's own kit pushed
    // further, Spider count nearly doubled and Ward dropped entirely --
    // by floor 9 the early glass cannons are trivial, so this reintroduces
    // real one-suit burst danger with the biggest hand of any non-elite
    // def to back it up.
    deck: [
      ...cardCopies('spider', 7, 'deepfangmatriarch-deck'),
      specialCard(specialCardById('broodcaller'), 'deepfangmatriarch-deck'),
      ...cardCopies('venom', 3, 'deepfangmatriarch-deck'),
    ],
  },
  {
    id: 'the-undying-warlord',
    name: 'The Undying Warlord',
    hpMax: 65,
    minFloor: 10,
    handSize: 6,
    isElite: true,
    // The run's one guaranteed boss fight (see roomGenerator.ts's
    // pickEnemies and the file-level comment above) -- roughly double the
    // next-highest def's HP, the biggest hand in the game (still under
    // PLAYER_HAND_SIZE's 7, keeping the "never quite player-sized" rule
    // intact), and a kit that reprises the run's own arc: Wolf (the very
    // first threat suit the player ever faced) and Rot (a control suit)
    // together as its two threat suits, Ward so it can't be burst down
    // like an early glass cannon, and Vigor so a dragged-out fight only
    // gets more dangerous, never less. Four of its suits carry that suit's
    // named special, more than any other single def in the roster.
    deck: [
      ...cardCopies('wolf', 4, 'undyingwarlord-deck'),
      specialCard(specialCardById('alpha-wolf'), 'undyingwarlord-deck'),
      ...cardCopies('rot', 4, 'undyingwarlord-deck'),
      specialCard(specialCardById('rot-colossus'), 'undyingwarlord-deck'),
      ...cardCopies('ward', 2, 'undyingwarlord-deck'),
      specialCard(specialCardById('bastion-heart'), 'undyingwarlord-deck'),
      ...cardCopies('vigor', 2, 'undyingwarlord-deck'),
      specialCard(specialCardById('battle-fury'), 'undyingwarlord-deck'),
    ],
  },
];

export function enemyDefById(id: string): EnemyDef {
  const def = ENEMY_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown enemy def: ${id}`);
  return def;
}
