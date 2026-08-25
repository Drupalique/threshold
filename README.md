# THRESHOLD — Prototype

A browser-based card combat prototype built with React + TypeScript + Vite.

## Concept

THRESHOLD is a roguelike set-collection card game. Each combat round, cards land on a shared table. You and every enemy in the room each hold your own hand, drawn from your own deck, and play matching sets onto the table to deal damage or apply an effect — a play multiplies against however many matching cards are already on the table (including the ones your own play just added), so a bigger table pile met with a bigger play spikes disproportionately. Survive 10 rooms to win.

**Nine suits:** Wolf, Ember, Rot, Spider (threat — damage a chosen enemy), Grace (boon — heals the player), Ward (guard — banks damage absorption), Hex (weaken), Venom (poison), Vigor (strength).

## Running it

```
npm install       # first time only
npm run dev       # dev server at http://localhost:5173/
npm test          # vitest, engine layer
npx tsc -b        # typecheck
npx eslint .      # lint
```

No persistence — reloading the page resets the run.

## Mechanics summary

- **Table:** cards land on a shared table each round, tagged by who played them (the room, the player, or a specific enemy). The room's own cards persist and accumulate across rounds until someone plays into that suit; the player's and each enemy's own contributions persist through the round and wipe only at the start of their own next turn.
- **Player hand:** drawn from a persistent, run-level deck (starts at 19 cards, grows by one per cleared room via a reward pick). Tops back up to size at the end of your turn — unplayed cards stay, only the shortfall redraws.
- **Enemies:** each holds and plays its own hand from its own small authored deck, exactly like the player — there's no fixed attack pattern to memorize.
- **Playing a set:** commit matching hand cards; magnitude = cards played × (table cards of that suit already there + the cards you just added). No decay, no "dead" 0-effect play — every play does something, even into an empty table.
- **Quake:** a rare reward card — play it for unlimited plays the rest of your turn.
- **Doors:** each door carries two independently-rolled tags (size, color) correlated at 75% to the room actually behind it.
- **10-room linear run**, win/loss end screens with a full combat log.

## Architecture

```
src/
  config/       constants.ts, enemies.ts — all tunable balance values and the enemy roster
  engine/       pure, framework-free game logic (combat, table, decks, doors, rewards, rooms)
  state/        RunContext.tsx — React reducer bridge
  ui/           component layer
```

The engine has no React dependency and is tested independently via vitest.

## Key tunable constants (`src/config/constants.ts`)

| Constant | Value | Note |
|---|---|---|
| `PLAYER_HAND_SIZE` | 7 | |
| `ENEMY_HAND_SIZE` | 4 | |
| `ON_SUIT_RATIO` | 0.45 | Primary balance knob for table dealing |
| `PLAYER_HP_MAX` | 30 | |
| `PLAYS_PER_TURN_BASE` | 2 | |
| `RUN_MAX_DEPTH` | 10 | Rooms per run |
| `DOOR_CORRELATION_RATE` | 0.75 | |

See `GAME_DESIGN.md` for the full current-state design reference.

## Status

Feature-complete prototype for its current scope: table-based combat with symmetric player/enemy play, a persistent player deck grown via rewards, and a placeholder door system. `scripts/playtest*.ts` are headless CLI/batch-sim tools for playing or bulk-testing runs against the real engine — see `GAME_DESIGN.md` §9. Tier 2/3 AI, door glyph trees, artifacts, meta-progression, narrative, and art/sound are explicitly out of scope at this stage.
