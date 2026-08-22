# THRESHOLD — Prototype

A browser-based card combat prototype built with React + TypeScript + Vite.

## Concept

THRESHOLD is a dueling-hands card game. Each combat round, a shared pool of suited cards is dealt to the table. You and the room each hold a hand of cards; you claim matching sets from the pool to deal damage, and so does the room. The pool decays suit-by-suit if left unclaimed too long. Survive 10 rooms to win.

**Five suits:** Wolf, Ember, Rot, Spider (threat — deal damage to the player) and Grace (boon — heals the player).

## Running it

```
npm install       # first time only
npm run dev       # dev server at http://localhost:5173/
npm test          # vitest, engine layer (14 tests)
npx tsc -b        # typecheck
```

No persistence — reloading the page resets the run.

## Mechanics summary

- **Shared pool** of cards is generated each round (size scales with room depth).
- **Player hand:** 5 cards. **Room hand:** 3 cards. Both hands redraw fully each turn.
- **Claiming:** play cards from your hand that match a set already on the table. Damage = pool set size × cards played.
- **Decay backstop:** if a suit goes unclaimed for 3 consecutive turns, the player takes a HP penalty and that suit is removed from the pool.
- **Surprise cards:** rare pool events (`add-cards`, `block-suit`, `force-discard`), resolved when the pool is generated.
- **Door system:** placeholder — next room is described by size/color/texture tags at 75% correlation to reality.
- **10-room linear run**, win/loss end screens with a full combat log.

## Architecture

```
src/
  config/       constants.ts — all tunable balance values
  engine/       pure, framework-free game logic
  state/        RunContext.tsx — React reducer bridge
  ui/           component layer
```

The engine has no React dependency and is tested independently via vitest.

## Key tunable constants (`src/config/constants.ts`)

| Constant | Value | Note |
|---|---|---|
| `PLAYER_HAND_SIZE` | 5 | |
| `ROOM_HAND_SIZE` | 3 | |
| `ON_SUIT_RATIO` | 0.45 | Primary balance knob |
| `PLAYER_HP_MAX` | 30 | |
| `ROOM_THREAT_BASE` | 20 | |
| `DECAY_TURNS_N` | 3 | Turns before decay fires |
| `MIN_POOL_SET_SIZE` | 1 | 1 pool card is claimable |
| `RUN_MAX_DEPTH` | 10 | Rooms per run |

See `PROTOTYPE_STATUS.md` for full balance notes, deviations from the design doc, and open playtesting threads.

## Status

v0.1 feature-complete prototype. Tier 2/3 AI, door glyph trees, artifacts, meta-progression, narrative, and art/sound are explicitly out of scope at this stage.
