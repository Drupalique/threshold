// Batch playtest simulator: plays full runs against the real engine and
// instruments the outcomes, so questions about tension/pacing/multi-enemy
// dynamics can be answered with distributions across many seeds instead of
// a single hand-played room. No UI, no mocking -- same runEngine/combatEngine
// calls the interactive scripts/playtest.ts CLI uses.
//
// Two player-turn decision-makers are available, via PLAYTEST_BOT:
//   heuristic (default) -- see pickBestPlay below, a scored greedy bot.
//   llm                 -- combat play/pass decisions go through Claude
//                           (see llmBot.ts) via a cheap model. Reward,
//                           door, and rest-room (heal-or-remove-a-card)
//                           choices all stay on the heuristic pickers
//                           below regardless of PLAYTEST_BOT -- this only
//                           swaps out per-turn play/pass decisions.
// Requires ANTHROPIC_API_KEY when PLAYTEST_BOT=llm. Start small -- each run
// is one real API call per player decision, sequential, not batched.
//
// Usage: npx tsx scripts/playtest-sim.ts [numRuns] [startSeed]
//        PLAYTEST_BOT=llm npx tsx scripts/playtest-sim.ts 1 1
import { createNewRun, startFirstRoom, applyCombatAction, resolveCombatEnd, chooseReward, chooseDoor, restHeal, restRemoveCard } from '../src/engine/runEngine.ts';
import { getLegalPlaySets, type LegalPlayTarget } from '../src/engine/combatEngine.ts';
import { SUIT_DEFINITIONS } from '../src/config/constants.ts';
import { pickLlmPlay, llmStats, type LlmChosenPlay } from './llmBot.ts';
import type { RunState } from '../src/types/run.ts';
import type { CombatState } from '../src/types/combat.ts';
import type { SuitId, SuitCategory } from '../src/types/suits.ts';

const BOT_MODE = (process.env.PLAYTEST_BOT ?? 'heuristic') as 'heuristic' | 'llm';
if (BOT_MODE === 'llm' && !process.env.ANTHROPIC_API_KEY) {
  console.error('PLAYTEST_BOT=llm requires ANTHROPIC_API_KEY to be set in the environment.');
  process.exit(1);
}

const suitCategory = (id: SuitId): SuitCategory => SUIT_DEFINITIONS.find((s) => s.id === id)!.category;

// --- metrics ---------------------------------------------------------------

interface Metrics {
  runs: number;
  wins: number;
  losses: number;
  anomalies: number;
  depthReached: number[];
  deathCauses: Record<string, number>;
  deathEnemyCounts: number[];
  deathDepths: number[];
  playMagnitudes: Record<SuitCategory, number[]>;
  deadHandTurns: number;
  voluntaryPassTurns: number;
  totalPlayerTurns: number;
  unclaimedCardsPerTurn: number[];
  guardBanked: number[];
  enemyCountAtRoomStart: number[];
  roomsClearedPerRun: number[];
  hpLossPerRoomCleared: number[];
  roomOutcomesByEnemyCount: Record<number, { cleared: number; died: number }>;
  restRoomsSeen: number;
  restHealsChosen: number;
  restRemovesChosen: number;
}

function freshMetrics(): Metrics {
  return {
    runs: 0,
    wins: 0,
    losses: 0,
    anomalies: 0,
    depthReached: [],
    deathCauses: {},
    deathEnemyCounts: [],
    deathDepths: [],
    playMagnitudes: { threat: [], boon: [], guard: [], weaken: [], poison: [], strength: [] },
    deadHandTurns: 0,
    voluntaryPassTurns: 0,
    totalPlayerTurns: 0,
    unclaimedCardsPerTurn: [],
    guardBanked: [],
    enemyCountAtRoomStart: [],
    roomsClearedPerRun: [],
    hpLossPerRoomCleared: [],
    roomOutcomesByEnemyCount: {},
    restRoomsSeen: 0,
    restHealsChosen: 0,
    restRemovesChosen: 0,
  };
}

const m = freshMetrics();

// --- bot policy --------------------------------------------------------
// Deliberately a "greedy, always play when profitable" baseline representing
// a reasonably attentive player -- NOT an optimal solver. There's no decay
// to bait or avoid any more (an unclaimed table pile just sits there), so
// this bot's only real choices are which suit to play and who to target.

interface ScoredPlay {
  suit: SuitId;
  targetInstanceId?: string;
  handCardIds: string[];
  score: number;
}

// 'aggro' always plays the biggest matched damage/effect it can, defensive
// tools only when clearly needed. 'defensive' weighs Guard/heal far higher
// and much earlier (a robustness check on the lethality findings -- rules
// out "the bot just doesn't defend" as the explanation for a low survival
// rate before blaming the game's balance).
const PROFILE = (process.env.PLAYTEST_PROFILE ?? 'aggro') as 'aggro' | 'defensive';

function pickBestPlay(state: CombatState, targets: LegalPlayTarget[]): ScoredPlay | null {
  const bySuit = new Map<SuitId, LegalPlayTarget[]>();
  for (const t of targets) {
    if (!bySuit.has(t.suit)) bySuit.set(t.suit, []);
    bySuit.get(t.suit)!.push(t);
  }

  const hpRatio = state.playerHP / state.playerHPMax;
  const enemyCount = state.enemies.length;
  let best: ScoredPlay | null = null;

  for (const [suit, suitTargets] of bySuit) {
    const category = suitCategory(suit);
    const handCardIds = state.playerHand.filter((c) => c.kind === 'creature' && c.suit === suit).map((c) => c.id);
    const handCount = handCardIds.length;
    const tableSetSize = suitTargets[0].tableSetSize;
    // A play joins the table set it multiplies against -- see GAME_DESIGN.md
    // §2 -- so the effective total is what's already there plus this play's
    // own cards, not just what's already there.
    const rawMagnitude = handCount * (tableSetSize + handCount);

    if (category === 'threat' || category === 'weaken' || category === 'poison') {
      // Focus-fire: prefer a kill (least overkill) among alive enemies this
      // pile can legally target; otherwise prefer the lowest-HP enemy, same
      // instinct a human "finish what you started" player would follow.
      for (const t of suitTargets) {
        const enemy = state.enemies.find((e) => e.instanceId === t.targetInstanceId)!;
        let score: number;
        if (category === 'threat') {
          const lethal = rawMagnitude >= enemy.hp;
          score = lethal ? 1000 - enemy.hp : rawMagnitude + (100 - enemy.hp) * 0.05;
        } else {
          // Hex/Venom: no immediate payoff, so weight below a direct-damage
          // play of the same magnitude, and prefer the highest-HP target
          // (spreads pressure onto whoever will survive longest to feel it).
          score = rawMagnitude * 0.6 + enemy.hp * 0.02;
        }
        if (!best || score > best.score) best = { suit, targetInstanceId: t.targetInstanceId, handCardIds, score };
      }
    } else if (category === 'boon') {
      const healAmount = Math.min(rawMagnitude, state.playerHPMax - state.playerHP);
      const urgencyThreshold = PROFILE === 'defensive' ? 0.9 : 0.7;
      const urgency = hpRatio < urgencyThreshold ? (PROFILE === 'defensive' ? 3 : 1) : 0.2;
      const score = healAmount * urgency;
      if (!best || score > best.score) best = { suit, handCardIds, score };
    } else if (category === 'guard') {
      const base = PROFILE === 'defensive' ? 0.8 : 0.3;
      const need = base + 0.7 * (1 - hpRatio) + 0.15 * Math.max(0, enemyCount - 1);
      const score = rawMagnitude * need * (PROFILE === 'defensive' ? 2.5 : 1);
      if (!best || score > best.score) best = { suit, handCardIds, score };
    } else {
      // strength (Vigor): modest baseline value.
      const score = rawMagnitude * 0.5;
      if (!best || score > best.score) best = { suit, handCardIds, score };
    }
  }

  return best;
}

// Reward-pick heuristic: prefer whichever offered suit already has the most
// live copies in run.deck -- a simple "double down on what you've built"
// consistency bias, not a solver. Doors don't signal reward suits, so this
// is the only signal available. Quake scores as an average suit's worth,
// since it's neither clearly better nor worse than another copy of whatever
// suit is already well-represented.
function pickReward(run: RunState): string {
  const options = run.rewardOptions!;
  const suitCounts = new Map<SuitId, number>();
  for (const c of run.deck) {
    if (c.kind !== 'creature') continue;
    suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  }
  const avgCount = suitCounts.size > 0 ? run.deck.length / suitCounts.size : 1;

  let bestId = options[0].id;
  let bestScore = -Infinity;
  for (const opt of options) {
    const score = opt.kind === 'quake' ? avgCount : (suitCounts.get(opt.suit) ?? 0);
    if (score > bestScore) {
      bestScore = score;
      bestId = opt.id;
    }
  }
  return bestId;
}

/**
 * Rest is exclusive (heal or remove a card, never both -- see
 * runEngine.ts's restHeal/restRemoveCard). Heals whenever there's any HP
 * missing (never wastes the option); at full HP, thins the deck instead by
 * removing a card from whichever suit is currently the most overrepresented
 * -- the inverse of pickReward's avgCount comparison above.
 */
function pickRestAction(run: RunState): { kind: 'heal' } | { kind: 'remove'; cardId: string } {
  if (run.playerHP < run.playerHPMax) return { kind: 'heal' };

  const suitCounts = new Map<SuitId, number>();
  for (const c of run.deck) {
    if (c.kind !== 'creature') continue;
    suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  }
  let worstCard = run.deck[0];
  let worstCount = -Infinity;
  for (const c of run.deck) {
    const count = c.kind === 'creature' ? (suitCounts.get(c.suit) ?? 0) : 0;
    if (count > worstCount) {
      worstCount = count;
      worstCard = c;
    }
  }
  return { kind: 'remove', cardId: worstCard.id };
}

function pickDoor(run: RunState): string {
  const doors = run.currentDoors!;
  const hpRatio = run.playerHP / run.playerHPMax;
  let bestId = doors[0].id;
  let bestScore = -Infinity;
  for (const d of doors) {
    const score = d.tags.size === 'small' ? (hpRatio < 0.5 ? 2 : 0.5) : (hpRatio < 0.5 ? -1 : 1);
    if (score > bestScore) {
      bestScore = score;
      bestId = d.id;
    }
  }
  return bestId;
}

// --- guard-banked log instrumentation -----------------------------------

function recordGuardBanked(prevCombat: CombatState, nextCombat: CombatState) {
  const bankedThisTick = nextCombat.playerGuard - prevCombat.playerGuard;
  if (bankedThisTick > 0) m.guardBanked.push(bankedThisTick);
}

// --- turn/room/run drivers -----------------------------------------------

// Deliberately does NOT call resolveCombatEnd -- the caller needs to
// classify a death/clear from combat.status while run.phase is still
// 'combat' (resolveCombatEnd immediately advances phase to 'run-over'/
// 'door-choice', which erases that signal for anyone checking afterward).
function runEnemyPhaseToNextDecision(run: RunState): RunState {
  let next = run;
  while (next.phase === 'combat' && next.combat?.status === 'active' && next.combat.activeTurn === 'enemy') {
    next = applyCombatAction(next, { type: 'ENEMY_TURN' });
  }
  return next;
}

async function playPlayerTurn(run: RunState): Promise<RunState> {
  let next = run;
  let guard = 0;
  while (next.phase === 'combat' && next.combat?.status === 'active' && next.combat.activeTurn === 'player') {
    if (guard++ > 50) {
      m.anomalies++;
      return { ...next, phase: 'run-over' as const };
    }
    const state = next.combat;
    // Quake is auto-played the moment it's in hand regardless of bot mode --
    // it never expires within the turn and only ever adds plays, so there's
    // no decision here for either bot to make.
    const quakeCard = state.playerHand.find((c) => c.kind === 'quake');
    if (quakeCard) {
      next = applyCombatAction(next, { type: 'PLAYER_PLAY_QUAKE', cardId: quakeCard.id });
      continue;
    }

    const targets = getLegalPlaySets(state);
    if (targets.length === 0) {
      m.deadHandTurns++;
      m.totalPlayerTurns++;
      m.unclaimedCardsPerTurn.push(state.playerHand.length);
      next = applyCombatAction(next, { type: 'PLAYER_PASS' });
      break;
    }

    const chosen: LlmChosenPlay | null =
      BOT_MODE === 'llm'
        ? await pickLlmPlay(state, targets)
        : (() => {
            const best = pickBestPlay(state, targets);
            return best && best.score > 0
              ? { suit: best.suit, targetInstanceId: best.targetInstanceId, handCardIds: best.handCardIds }
              : null;
          })();

    if (!chosen) {
      m.voluntaryPassTurns++;
      m.totalPlayerTurns++;
      m.unclaimedCardsPerTurn.push(state.playerHand.length);
      next = applyCombatAction(next, { type: 'PLAYER_PASS' });
      break;
    }

    const category = suitCategory(chosen.suit);
    const targetEnemy = chosen.targetInstanceId ? state.enemies.find((e) => e.instanceId === chosen.targetInstanceId) : undefined;
    const before = {
      enemyHp: targetEnemy?.hp,
      playerHP: state.playerHP,
      playerGuard: state.playerGuard,
      enemyStack: targetEnemy ? (targetEnemy.statuses[category as 'weaken' | 'poison'] ?? 0) : undefined,
      playerStrength: state.playerStatuses.strength ?? 0,
    };

    next = applyCombatAction(next, {
      type: 'PLAY_SET',
      suit: chosen.suit,
      targetInstanceId: chosen.targetInstanceId,
      handCardIds: chosen.handCardIds,
    });
    const after = next.combat!;
    const afterEnemy = chosen.targetInstanceId ? after.enemies.find((e) => e.instanceId === chosen.targetInstanceId) : undefined;

    if (category === 'threat') {
      const dealt = before.enemyHp! - (afterEnemy?.hp ?? 0);
      m.playMagnitudes.threat.push(dealt);
    } else if (category === 'boon') {
      m.playMagnitudes.boon.push(after.playerHP - before.playerHP);
    } else if (category === 'guard') {
      m.guardBanked.push(after.playerGuard - before.playerGuard);
      m.playMagnitudes.guard.push(after.playerGuard - before.playerGuard);
    } else if (category === 'weaken' || category === 'poison') {
      const afterStack = afterEnemy ? (afterEnemy.statuses[category] ?? 0) : 0;
      m.playMagnitudes[category].push(afterStack - (before.enemyStack ?? 0));
    } else {
      m.playMagnitudes.strength.push((after.playerStatuses.strength ?? 0) - before.playerStrength);
    }

    if (after.playsRemaining <= 0) {
      m.totalPlayerTurns++;
      m.unclaimedCardsPerTurn.push(after.activeTurn === 'player' ? 0 : after.playerHand.length);
      break;
    }
    if (after.status !== 'active' || after.activeTurn !== 'player') {
      m.totalPlayerTurns++;
      m.unclaimedCardsPerTurn.push(after.playerHand.length);
      break;
    }
  }
  return next;
}

function classifyDeath(finalCombat: CombatState, prevLogLength: number, depth: number) {
  const newEntries = finalCombat.log.slice(prevLogLength);
  const fatal = newEntries.find((e) => e.playerHP <= 0);
  const cause = fatal ? fatal.type : 'unknown';
  m.deathCauses[cause] = (m.deathCauses[cause] ?? 0) + 1;
  m.deathEnemyCounts.push(finalCombat.enemies.filter((e) => e.hp > 0).length);
  m.deathDepths.push(depth);
}

async function playRun(seed: number): Promise<void> {
  let run = createNewRun(seed);
  run = startFirstRoom(run);
  let roomsCleared = 0;
  let safety = 0;

  while (run.phase === 'combat' || run.phase === 'rest' || run.phase === 'reward' || run.phase === 'door-choice') {
    if (safety++ > 400) {
      m.anomalies++;
      return;
    }
    if (run.phase === 'rest') {
      m.restRoomsSeen++;
      const action = pickRestAction(run);
      if (action.kind === 'heal') {
        m.restHealsChosen++;
        run = restHeal(run);
      } else {
        m.restRemovesChosen++;
        run = restRemoveCard(run, action.cardId);
      }
      continue;
    }
    if (run.phase === 'reward') {
      run = chooseReward(run, pickReward(run));
      continue;
    }
    if (run.phase === 'door-choice') {
      run = chooseDoor(run, pickDoor(run));
      continue;
    }
    const roomEnemyCount = run.combat!.enemies.length;
    m.enemyCountAtRoomStart.push(roomEnemyCount);
    if (!m.roomOutcomesByEnemyCount[roomEnemyCount]) m.roomOutcomesByEnemyCount[roomEnemyCount] = { cleared: 0, died: 0 };
    const hpAtRoomStart = run.playerHP;
    const prevLogLength = run.combat!.log.length;

    let roomTurns = 0;
    while (run.phase === 'combat' && run.combat!.status === 'active') {
      if (roomTurns++ > 150) {
        m.anomalies++;
        return;
      }
      run = await playPlayerTurn(run);
      if (run.phase !== 'combat' || run.combat!.status !== 'active') break;
      const prevCombat = run.combat!;
      run = runEnemyPhaseToNextDecision(run);
      if (run.combat) recordGuardBanked(prevCombat, run.combat);
    }

    if (run.phase === 'combat' && run.combat!.status === 'player-dead') {
      classifyDeath(run.combat!, prevLogLength, run.depth);
      m.roomOutcomesByEnemyCount[roomEnemyCount].died++;
      run = resolveCombatEnd(run);
    } else if (run.phase === 'combat' && run.combat!.status === 'room-cleared') {
      roomsCleared++;
      m.hpLossPerRoomCleared.push(hpAtRoomStart - run.playerHP);
      m.roomOutcomesByEnemyCount[roomEnemyCount].cleared++;
      run = resolveCombatEnd(run);
    } else if (run.phase !== 'door-choice') {
      // Already resolved by playPlayerTurn's anomaly guard.
      return;
    }
  }

  m.runs++;
  m.roomsClearedPerRun.push(roomsCleared);
  m.depthReached.push(run.depth);
  if (run.phase === 'run-complete') m.wins++;
  else if (run.phase === 'run-over') m.losses++;
  else m.anomalies++;
}

// --- stats helpers ---------------------------------------------------------

function stats(arr: number[]) {
  if (arr.length === 0) return { n: 0, avg: 0, min: 0, max: 0, p90: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  const p90 = sorted[Math.floor(0.9 * (sorted.length - 1))];
  return { n: arr.length, avg: Number(avg.toFixed(2)), min: sorted[0], max: sorted[sorted.length - 1], p90 };
}

// --- main -------------------------------------------------------------

// Default run count is much smaller in llm mode -- each run is a sequence
// of real, sequential API calls, so an accidental no-args invocation
// shouldn't silently fire off hundreds of requests.
const DEFAULT_RUNS = BOT_MODE === 'llm' ? 5 : 300;
const numRuns = Number(process.argv[2] ?? DEFAULT_RUNS);
const startSeed = Number(process.argv[3] ?? 1);

for (let i = 0; i < numRuns; i++) {
  await playRun(startSeed + i);
  if (BOT_MODE === 'llm') {
    const { callCount, fallbackCount } = llmStats();
    console.error(`[progress] run ${i + 1}/${numRuns} done -- ${callCount} llm calls so far (${fallbackCount} fallback-to-pass)`);
  }
}

const report = {
  config: { numRuns, startSeed, botMode: BOT_MODE, ...(BOT_MODE === 'llm' ? { llm: llmStats() } : {}) },
  outcomes: { runs: m.runs, wins: m.wins, losses: m.losses, anomalies: m.anomalies, winRate: Number((m.wins / m.runs).toFixed(3)) },
  depthReached: stats(m.depthReached),
  roomsClearedPerRun: stats(m.roomsClearedPerRun),
  hpLossPerRoomCleared: stats(m.hpLossPerRoomCleared),
  deathCauses: m.deathCauses,
  deathEnemyCountAlive: stats(m.deathEnemyCounts),
  deathDepths: stats(m.deathDepths),
  enemyCountAtRoomStart: stats(m.enemyCountAtRoomStart),
  playerTurns: {
    total: m.totalPlayerTurns,
    deadHandTurns: m.deadHandTurns,
    deadHandRate: Number((m.deadHandTurns / m.totalPlayerTurns).toFixed(3)),
    voluntaryPassTurns: m.voluntaryPassTurns,
    voluntaryPassRate: Number((m.voluntaryPassTurns / m.totalPlayerTurns).toFixed(3)),
  },
  unclaimedCardsPerTurn: stats(m.unclaimedCardsPerTurn),
  playMagnitudes: Object.fromEntries(Object.entries(m.playMagnitudes).map(([k, v]) => [k, { count: v.length, ...stats(v) }])),
  bigThreatSpikes: {
    total: m.playMagnitudes.threat.length,
    ge8: m.playMagnitudes.threat.filter((x) => x >= 8).length,
    ge12: m.playMagnitudes.threat.filter((x) => x >= 12).length,
    ge16: m.playMagnitudes.threat.filter((x) => x >= 16).length,
  },
  guard: {
    banked: stats(m.guardBanked),
  },
  roomClearRateByEnemyCount: Object.fromEntries(
    Object.entries(m.roomOutcomesByEnemyCount).map(([count, o]) => [
      count,
      { ...o, total: o.cleared + o.died, clearRate: Number((o.cleared / (o.cleared + o.died)).toFixed(3)) },
    ]),
  ),
  restRooms: {
    seen: m.restRoomsSeen,
    perRun: Number((m.restRoomsSeen / m.runs).toFixed(2)),
    healsChosen: m.restHealsChosen,
    removesChosen: m.restRemovesChosen,
  },
};

console.log(JSON.stringify(report, null, 2));
