// CLI harness for driving a THRESHOLD run one command at a time, straight
// against the real engine (combatEngine/runEngine) with no UI in between.
// Built so a text-only agent (or a human at a terminal) can actually play
// the game: each invocation loads state, applies exactly one player
// decision, auto-resolves the resulting enemy phase (enemies have no real
// choices to make -- see roomIntent.ts), and prints a full text picture of
// the new state to decide the next move from.
//
// Usage: npx tsx scripts/playtest.ts <command> [args...]
// Run `npx tsx scripts/playtest.ts help` for the command list.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createNewRun, startFirstRoom, applyCombatAction, resolveCombatEnd, chooseReward, chooseDoor } from '../src/engine/runEngine.ts';
import { createRngFromState } from '../src/engine/rng.ts';
import { getLegalPlayerClaimTargets, requiresEnemyTarget } from '../src/engine/combatEngine.ts';
import { currentIntent } from '../src/engine/roomIntent.ts';
import { SUIT_DEFINITIONS } from '../src/config/constants.ts';
import type { RunState } from '../src/types/run.ts';
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
// Enemies never choose anything (fixed, cycled patterns -- roomIntent.ts),
// so there is nothing for an agent to weigh in on during the enemy phase.
// Dispatch it to completion automatically after every player action, same
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

function intentStr(step: ReturnType<typeof currentIntent>): string {
  if (step.type === 'corrupt') return `corrupt(${step.corruptEffect})`;
  return `${step.type}${step.magnitude !== undefined ? ` ${step.magnitude}` : ''}`;
}

function render(run: RunState, lastLogLength: number) {
  const lines: string[] = [];
  lines.push(`=== seed=${run.seed} depth=${run.depth}/${run.maxDepth} phase=${run.phase} ===`);
  lines.push(`Player HP: ${run.playerHP}/${run.playerHPMax}`);

  if (run.phase === 'combat' && run.combat) {
    const c = run.combat;
    lines.push(`Combat status=${c.status} turn=${c.turnNumber} activeTurn=${c.activeTurn} playsRemaining=${c.playsRemaining}${c.unlimitedPlaysThisTurn ? ' (UNLIMITED this turn)' : ''}`);
    lines.push(`Player Guard: ${c.playerGuard}${statusBagStr(c.playerStatuses)}`);

    lines.push('');
    lines.push('Enemies:');
    if (c.enemies.length === 0) lines.push('  (none)');
    for (const e of c.enemies) {
      lines.push(`  [${e.instanceId}] ${e.name} HP ${e.hp}/${e.hpMax} Guard ${e.guard}${statusBagStr(e.statuses)} -- next intent: ${intentStr(currentIntent(e))}`);
    }

    lines.push('');
    lines.push(`Pool (threat suits this room: ${c.roomParams.threatSuits.join(', ')}):`);
    const counts = new Map<SuitId, number>();
    for (const card of c.pool) {
      if (card.kind !== 'creature') continue;
      counts.set(card.suit, (counts.get(card.suit) ?? 0) + 1);
    }
    if (counts.size === 0) lines.push('  (empty)');
    for (const [suit, count] of counts) {
      const blocked = c.blockedSuits[suit] ?? 0;
      const decay = c.decayCounters[suit] ?? 0;
      lines.push(
        `  ${suit} (${suitCategory(suit)}) x${count}${decay > 0 ? ` decay ${decay}/3` : ''}${blocked > 0 ? ` BLOCKED ${blocked} more turn(s)` : ''}`,
      );
    }

    lines.push('');
    lines.push(`Your hand (draw pile ${c.drawPile.length}, discard pile ${c.discardPile.length}):`);
    if (c.playerHand.length === 0) lines.push('  (empty)');
    for (const card of c.playerHand) {
      if (card.kind === 'quake') lines.push(`  [${card.id}] QUAKE -- play for unlimited claims this turn`);
      else lines.push(`  [${card.id}] ${card.suit} (${suitCategory(card.suit)})`);
    }

    if (c.activeTurn === 'player' && c.status === 'active') {
      lines.push('');
      lines.push('Legal claims (suit / poolSetSize / target if any / your matching hand card ids):');
      const targets = getLegalPlayerClaimTargets(c);
      if (targets.length === 0) lines.push('  (none -- no plays left or nothing matches your hand)');
      for (const t of targets) {
        const matchingIds = c.playerHand.filter((card) => card.kind === 'creature' && card.suit === t.suit).map((card) => card.id);
        const targetName = t.targetInstanceId ? c.enemies.find((e) => e.instanceId === t.targetInstanceId)?.name : '';
        lines.push(`  ${t.suit} x${t.poolSetSize}${t.targetInstanceId ? ` -> ${targetName} [${t.targetInstanceId}]` : ''} : hand ${matchingIds.join(',')}`);
      }
    }

    lines.push('');
    lines.push('Log:');
    const newEntries = c.log.slice(lastLogLength);
    const toShow = newEntries.length > 0 ? newEntries : c.log.slice(-8);
    for (const entry of toShow) lines.push(`  [t${entry.turn} ${entry.actor}/${entry.type}] ${entry.message}`);
  }

  if (run.phase === 'reward' && run.rewardOptions) {
    lines.push('');
    lines.push(`Choose a reward card (deck size ${run.deck.length}):`);
    run.rewardOptions.forEach((card, i) => {
      const desc = card.kind === 'quake' ? 'QUAKE -- unlimited claims for a turn' : `${card.suit} (${suitCategory(card.suit)})`;
      lines.push(`  [${i}] [${card.id}] ${desc}`);
    });
  }

  if (run.phase === 'door-choice' && run.currentDoors) {
    lines.push('');
    lines.push('Choose a door:');
    for (const d of run.currentDoors) {
      lines.push(`  [${d.id}] size=${d.tags.size} color=${d.tags.color} texture=${d.tags.texture}`);
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

  case 'claim': {
    const [suit, cardIdsRaw, target] = args;
    if (!suit || !cardIdsRaw) {
      console.log('Usage: claim <suit> <cardId1,cardId2,...> [targetInstanceId]');
      process.exit(1);
    }
    const { run } = load();
    if (requiresEnemyTarget(suitCategory(suit as SuitId)) && !target) {
      console.log(`Suit "${suit}" requires a target enemy instance id -- see the Enemies list.`);
      process.exit(1);
    }
    let next = applyCombatAction(run, {
      type: 'PLAYER_CLAIM',
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
  claim <suit> <id,id,...> [targetId]     claim a pool set with these hand cards
  pass                                    end your turn without claiming
  quake <cardId>                          play a Quake card (unlimited claims this turn)
  reward <cardIndex>                      pick a reward card (0-2) after clearing a room, before the door choice
  door <doorId>                           pick a door after clearing a room
  help                                    this message

The enemy phase auto-resolves after every player action (enemies just follow
a fixed pattern -- see the "next intent" shown per enemy, no real choice
there), so every command lands you back at your next real decision point.`);
  }
}
