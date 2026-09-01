// CLI harness for driving a THRESHOLD run one command at a time, straight
// against the real engine (combatEngine/runEngine) with no UI in between.
// Built so a text-only agent (or a human at a terminal) can actually play
// the game: each invocation loads state, applies exactly one player
// decision, auto-resolves the resulting enemy phase, and prints a full text
// picture of the new state to decide the next move from.
//
// Usage: npx tsx scripts/playtest.ts <command> [args...]
// Run `npx tsx scripts/playtest.ts help` for the command list.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createNewRun, startFirstRoom, applyCombatAction, resolveCombatEnd, chooseReward, skipReward, restHeal, restRemoveCard, chooseDoor } from '../src/engine/runEngine.ts';
import { createRngFromState } from '../src/engine/rng.ts';
import { getLegalPlaySets, requiresEnemyTarget } from '../src/engine/combatEngine.ts';
import { SUIT_DEFINITIONS, REST_HEAL_PCT, QUAKE_BONUS_PLAYS } from '../src/config/constants.ts';
import type { RunState } from '../src/types/run.ts';
import type { TableCard } from '../src/types/combat.ts';
import type { SuitId, SuitCategory } from '../src/types/suits.ts';

const STATE_PATH = process.env.PLAYTEST_STATE ?? '.playtest-state.json';

const suitDef = (id: SuitId) => SUIT_DEFINITIONS.find((s) => s.id === id)!;
const suitCategory = (id: SuitId): SuitCategory => suitDef(id).category;

// --- persistence ------------------------------------------------------
// RunState carries a live Rng (closures, not JSON-safe) -- swap it for its
// serialized 32-bit generator state on the way out and reconstruct it with
// createRngFromState on the way in. Everything else in RunState is plain
// data already.

interface SavedRun extends Omit<RunState, 'rng'> {
  rngState: number;
}

function load(): { run: RunState; lastLogLength: number } {
  if (!existsSync(STATE_PATH)) {
    console.log('No run in progress. Start one with: npx tsx scripts/playtest.ts new [seed]');
    process.exit(1);
  }
  const saved = JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as SavedRun & { lastLogLength: number };
  const { rngState, lastLogLength, ...rest } = saved;
  const run: RunState = { ...rest, rng: createRngFromState(rngState) };
  return { run, lastLogLength };
}

function save(run: RunState, lastLogLength: number) {
  const { rng, ...rest } = run;
  const saved: SavedRun & { lastLogLength: number } = { ...rest, rngState: rng.getState(), lastLogLength };
  writeFileSync(STATE_PATH, JSON.stringify(saved, null, 2));
}

// --- auto-play the parts that aren't real decisions --------------------
// Enemies draw their own hand and choose their own plays (engine/enemyAI.ts)
// -- there's nothing for an agent to weigh in on during the enemy phase, so
// dispatch it to completion automatically after every player action, same
// as CombatScreen's UI does on a timer.
function runToNextDecision(run: RunState): RunState {
  let next = run;
  while (next.phase === 'combat' && next.combat?.status === 'active' && next.combat.activeTurn === 'enemy') {
    next = applyCombatAction(next, { type: 'ENEMY_TURN' });
  }
  if (next.phase === 'combat' && next.combat && next.combat.status !== 'active') {
    next = resolveCombatEnd(next);
  }
  return next;
}

// --- rendering -----------------------------------------------------------

function statusBagStr(bag: Record<string, number | undefined> | undefined): string {
  if (!bag) return '';
  const parts = Object.entries(bag).filter(([, v]) => (v ?? 0) > 0).map(([k, v]) => `${k}+${v}`);
  return parts.length ? ` [${parts.join(', ')}]` : '';
}

// Table cards are owner-tagged (`'room'`, `'player'`, or an enemy's own
// instanceId) -- room cards persist and accumulate across rounds until
// someone plays into that suit, while a player's/enemy's own contribution
// persists through the round and only wipes at the start of their own next
// turn. Break the per-suit count down by owner so that's visible.
function tableSummary(table: TableCard[]): string[] {
  const bySuit = new Map<SuitId, TableCard[]>();
  for (const card of table) {
    if (!bySuit.has(card.suit)) bySuit.set(card.suit, []);
    bySuit.get(card.suit)!.push(card);
  }
  if (bySuit.size === 0) return ['  (empty)'];
  const lines: string[] = [];
  for (const [suit, cards] of bySuit) {
    const byOwner = new Map<string, number>();
    for (const c of cards) byOwner.set(c.ownerId, (byOwner.get(c.ownerId) ?? 0) + 1);
    const ownerStr = Array.from(byOwner.entries()).map(([owner, n]) => `${owner}:${n}`).join(', ');
    lines.push(`  ${suit} (${suitCategory(suit)}) x${cards.length} [${ownerStr}]`);
  }
  return lines;
}

function render(run: RunState, lastLogLength: number) {
  const lines: string[] = [];
  lines.push(`=== seed=${run.seed} depth=${run.depth}/${run.maxDepth} phase=${run.phase} ===`);
  lines.push(`Player HP: ${run.playerHP}/${run.playerHPMax}`);

  if (run.phase === 'combat' && run.combat) {
    const c = run.combat;
    lines.push(`Combat status=${c.status} turn=${c.turnNumber} activeTurn=${c.activeTurn} playsRemaining=${c.playsRemaining}`);
    lines.push(`Player Guard: ${c.playerGuard}${statusBagStr(c.playerStatuses)}`);

    lines.push('');
    lines.push('Enemies:');
    if (c.enemies.length === 0) lines.push('  (none)');
    for (const e of c.enemies) {
      const hand = e.hand.map((card) => card.suit).join(',') || 'no cards';
      lines.push(`  [${e.instanceId}] ${e.name} HP ${e.hp}/${e.hpMax} Guard ${e.guard}${statusBagStr(e.statuses)} -- hand: ${hand}`);
    }

    lines.push('');
    lines.push(`Table (threat suits this room: ${c.roomParams.threatSuits.join(', ')}):`);
    lines.push(...tableSummary(c.table));

    lines.push('');
    lines.push(`Your hand (draw pile ${c.drawPile.length}, discard pile ${c.discardPile.length}):`);
    if (c.playerHand.length === 0) lines.push('  (empty)');
    for (const card of c.playerHand) {
      if (card.kind === 'quake') lines.push(`  [${card.id}] QUAKE -- play for +${QUAKE_BONUS_PLAYS} plays this turn`);
      else lines.push(`  [${card.id}] ${card.suit} (${suitCategory(card.suit)})`);
    }

    if (c.activeTurn === 'player' && c.status === 'active') {
      lines.push('');
      lines.push('Legal plays (suit / table set size / target if any / your matching hand card ids):');
      const targets = getLegalPlaySets(c);
      if (targets.length === 0) lines.push('  (none -- no plays left or nothing matches your hand)');
      for (const t of targets) {
        const matchingIds = c.playerHand.filter((card) => card.kind === 'creature' && card.suit === t.suit).map((card) => card.id);
        const targetName = t.targetInstanceId ? c.enemies.find((e) => e.instanceId === t.targetInstanceId)?.name : '';
        lines.push(`  ${t.suit} x${t.tableSetSize}${t.targetInstanceId ? ` -> ${targetName} [${t.targetInstanceId}]` : ''} : hand ${matchingIds.join(',')}`);
      }
    }

    lines.push('');
    lines.push('Log:');
    const newEntries = c.log.slice(lastLogLength);
    const toShow = newEntries.length > 0 ? newEntries : c.log.slice(-8);
    for (const entry of toShow) lines.push(`  [t${entry.turn} ${entry.actor}/${entry.type}] ${entry.message}`);
  }

  if (run.phase === 'rest') {
    const healAmount = Math.round(run.playerHPMax * REST_HEAL_PCT);
    lines.push('');
    lines.push(`A place to rest. Options (exclusive -- pick one):`);
    lines.push(`  rest-heal              restore ${healAmount} HP (capped at max)`);
    lines.push(`  rest-remove <cardId>   permanently remove one card from your deck`);
    lines.push('');
    lines.push(`Deck (${run.deck.length} cards):`);
    for (const card of run.deck) {
      const desc = card.kind === 'quake' ? 'QUAKE' : `${card.suit} (${suitCategory(card.suit)})`;
      lines.push(`  [${card.id}] ${desc}`);
    }
  }

  if (run.phase === 'reward' && run.rewardOptions) {
    lines.push('');
    lines.push(`Choose a reward card (deck size ${run.deck.length}):`);
    run.rewardOptions.forEach((card, i) => {
      const desc = card.kind === 'quake' ? `QUAKE -- +${QUAKE_BONUS_PLAYS} plays for a turn` : `${card.suit} (${suitCategory(card.suit)})`;
      lines.push(`  [${i}] [${card.id}] ${desc}`);
    });
  }

  if (run.phase === 'door-choice' && run.currentDoors) {
    lines.push('');
    lines.push('Choose a door:');
    for (const d of run.currentDoors) {
      lines.push(`  [${d.id}] size=${d.tags.size} color=${d.tags.color}`);
    }
  }

  if (run.phase === 'run-over') lines.push('\nRUN OVER -- you died.');
  if (run.phase === 'run-complete') lines.push('\nRUN COMPLETE -- you reached max depth!');

  console.log(lines.join('\n'));
}

// --- commands -------------------------------------------------------------

const [, , cmd, ...args] = process.argv;

function newLogLength(run: RunState): number {
  return run.phase === 'combat' && run.combat ? run.combat.log.length : 0;
}

switch (cmd) {
  case 'new': {
    const seed = args[0] ? Number(args[0]) : Math.floor(Math.random() * 1_000_000);
    let run = createNewRun(seed);
    run = startFirstRoom(run);
    save(run, newLogLength(run));
    render(run, 0);
    break;
  }

  case 'state': {
    const { run, lastLogLength } = load();
    render(run, lastLogLength);
    break;
  }

  case 'play': {
    const [suit, cardIdsRaw, target] = args;
    if (!suit || !cardIdsRaw) {
      console.log('Usage: play <suit> <cardId1,cardId2,...> [targetInstanceId]');
      process.exit(1);
    }
    const { run } = load();
    if (requiresEnemyTarget(suitCategory(suit as SuitId)) && !target) {
      console.log(`Suit "${suit}" requires a target enemy instance id -- see the Enemies list.`);
      process.exit(1);
    }
    let next = applyCombatAction(run, {
      type: 'PLAY_SET',
      suit: suit as SuitId,
      handCardIds: cardIdsRaw.split(','),
      targetInstanceId: target,
    });
    next = runToNextDecision(next);
    save(next, newLogLength(next));
    render(next, 0);
    break;
  }

  case 'pass': {
    const { run } = load();
    let next = applyCombatAction(run, { type: 'PLAYER_PASS' });
    next = runToNextDecision(next);
    save(next, newLogLength(next));
    render(next, 0);
    break;
  }

  case 'quake': {
    const [cardId] = args;
    if (!cardId) {
      console.log('Usage: quake <cardId>');
      process.exit(1);
    }
    const { run } = load();
    const next = applyCombatAction(run, { type: 'PLAYER_PLAY_QUAKE', cardId });
    save(next, newLogLength(next));
    render(next, 0);
    break;
  }

  case 'reward': {
    const [indexRaw] = args;
    if (!indexRaw) {
      console.log('Usage: reward <cardIndex>');
      process.exit(1);
    }
    const { run } = load();
    if (run.phase !== 'reward' || !run.rewardOptions) {
      console.log('Not currently at a reward choice.');
      process.exit(1);
    }
    const index = Number(indexRaw);
    const chosen = run.rewardOptions[index];
    if (!chosen) {
      console.log(`No reward option at index ${indexRaw}.`);
      process.exit(1);
    }
    const next = chooseReward(run, chosen.id);
    save(next, newLogLength(next));
    render(next, 0);
    break;
  }

  case 'reward-pass': {
    const { run } = load();
    if (run.phase !== 'reward') {
      console.log('Not currently at a reward choice.');
      process.exit(1);
    }
    const next = skipReward(run);
    save(next, newLogLength(next));
    render(next, 0);
    break;
  }

  case 'rest-heal': {
    const { run } = load();
    if (run.phase !== 'rest') {
      console.log('Not currently at a rest room.');
      process.exit(1);
    }
    const next = restHeal(run);
    save(next, newLogLength(next));
    render(next, 0);
    break;
  }

  case 'rest-remove': {
    const [cardId] = args;
    if (!cardId) {
      console.log('Usage: rest-remove <cardId>');
      process.exit(1);
    }
    const { run } = load();
    if (run.phase !== 'rest') {
      console.log('Not currently at a rest room.');
      process.exit(1);
    }
    const next = restRemoveCard(run, cardId);
    if (next === run) {
      console.log(`No card with id ${cardId} in the deck.`);
      process.exit(1);
    }
    save(next, newLogLength(next));
    render(next, 0);
    break;
  }

  case 'door': {
    const [doorId] = args;
    if (!doorId) {
      console.log('Usage: door <doorId>');
      process.exit(1);
    }
    const { run } = load();
    const next = chooseDoor(run, doorId);
    save(next, newLogLength(next));
    render(next, 0);
    break;
  }

  case 'help':
  default: {
    console.log(`THRESHOLD playtest CLI -- state persists in ${STATE_PATH} between invocations.

Commands:
  new [seed]                              start a fresh run (default: random seed)
  state                                   reprint the current state
  play <suit> <id,id,...> [targetId]      play matching hand cards onto the table (multiplies against what's already there)
  pass                                    end your turn without playing
  quake <cardId>                          play a Quake card (+${QUAKE_BONUS_PLAYS} plays this turn)
  reward <cardIndex>                      pick a reward card (0-2) after clearing a room, before the door choice
  reward-pass                             decline every offered reward and proceed to the door choice
  rest-heal                               at a rest room, restore HP instead of removing a card
  rest-remove <cardId>                    at a rest room, permanently remove a card instead of resting
  door <doorId>                           pick a door after clearing a room
  help                                    this message

The enemy phase auto-resolves after every player action (each enemy draws
its own hand and picks its own play -- see the "hand" shown per enemy above),
so every command lands you back at your next real decision point.`);
  }
}
