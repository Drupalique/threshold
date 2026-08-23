// Batch playtest simulator: plays full runs against the real engine with a
// heuristic "competent player" bot (see pickBestClaim/pickDoor below) and
// instruments the outcomes, so questions about tension/pacing/decay/multi-
// enemy dynamics can be answered with distributions across many seeds
// instead of a single hand-played room. No UI, no mocking -- same
// runEngine/combatEngine calls the interactive scripts/playtest.ts CLI uses.
//
// Usage: npx tsx scripts/playtest-sim.ts [numRuns] [startSeed]
import { createNewRun, startFirstRoom, applyCombatAction, resolveCombatEnd, chooseDoor } from '../src/engine/runEngine.ts';
import { getLegalPlayerClaimTargets, requiresEnemyTarget, type LegalClaimTarget } from '../src/engine/combatEngine.ts';
import { SUIT_DEFINITIONS, DECAY_TURNS_N } from '../src/config/constants.ts';
import type { RunState } from '../src/types/run.ts';
import type { CombatState } from '../src/types/combat.ts';
import type { SuitId, SuitCategory } from '../src/types/suits.ts';

const suitCategory = (id: SuitId): SuitCategory => SUIT_DEFINITIONS.find((s) => s.id === id)!.category;
const suitByName = (name: string) => SUIT_DEFINITIONS.find((s) => s.name.toLowerCase() === name.toLowerCase());

// --- metrics ---------------------------------------------------------------

interface Metrics {
  runs: number;
  wins: number;
  losses: number;
  anomalies: number;
  depthReached: number[];
  turnsPerRun: number[];
  deathCauses: Record<string, number>;
  deathEnemyCounts: number[];
  deathDepths: number[];
  decayEvents: { category: SuitCategory; enemiesPresent: number }[];
  claimMagnitudes: Record<SuitCategory, number[]>;
  deadHandTurns: number;
  voluntaryPassTurns: number;
  totalPlayerTurns: number;
  unclaimedCardsPerTurn: number[];
  guardWasted: number[];
  guardBanked: number[];
  lockstepChecks: number;
  lockstepViolations: number;
  enemyCountAtRoomStart: number[];
  roomsClearedPerRun: number[];
  hpLossPerRoomCleared: number[];
  roomOutcomesByEnemyCount: Record<number, { cleared: number; died: number }>;
}

function freshMetrics(): Metrics {
  return {
    runs: 0,
    wins: 0,
    losses: 0,
    anomalies: 0,
    depthReached: [],
    turnsPerRun: [],
    deathCauses: {},
    deathEnemyCounts: [],
    deathDepths: [],
    decayEvents: [],
    claimMagnitudes: { threat: [], boon: [], guard: [], weaken: [], poison: [], strength: [] },
    deadHandTurns: 0,
    voluntaryPassTurns: 0,
    totalPlayerTurns: 0,
    unclaimedCardsPerTurn: [],
    guardWasted: [],
    guardBanked: [],
    lockstepChecks: 0,
    lockstepViolations: 0,
    enemyCountAtRoomStart: [],
    roomsClearedPerRun: [],
    hpLossPerRoomCleared: [],
    roomOutcomesByEnemyCount: {},
  };
}

const m = freshMetrics();

// --- bot policy --------------------------------------------------------
// Deliberately a "greedy, always claim when profitable, never bait decay"
// baseline representing a reasonably attentive player -- NOT an optimal
// solver. It never deliberately leaves a pile to decay for the untargeted
// group-effect payoff (that's a real strategic option the design doc raises
// but modeling optimal decay-timing is a separate, harder question); every
// decay this bot triggers is decay-from-inability-to-act, not decay-by-choice.
// See PLAYTEST_FINDINGS.md for how that caveat bears on the decay numbers.

interface ScoredClaim {
  suit: SuitId;
  targetInstanceId?: string;
  handCardIds: string[];
  score: number;
}

// 'aggro' always claims the biggest matched damage/effect it can, defensive
// tools only when clearly needed. 'defensive' weighs Guard/heal far higher
// and much earlier (as a robustness check on the lethality findings below --
// see PLAYTEST_FINDINGS.md -- to rule out "the bot just doesn't defend" as
// the explanation for a low survival rate before blaming the game's balance).
const PROFILE = (process.env.PLAYTEST_PROFILE ?? 'aggro') as 'aggro' | 'defensive';

function pickBestClaim(state: CombatState, targets: LegalClaimTarget[]): ScoredClaim | null {
  const bySuit = new Map<SuitId, LegalClaimTarget[]>();
  for (const t of targets) {
    if (!bySuit.has(t.suit)) bySuit.set(t.suit, []);
    bySuit.get(t.suit)!.push(t);
  }

  const hpRatio = state.playerHP / state.playerHPMax;
  const enemyCount = state.enemies.length;
  let best: ScoredClaim | null = null;

  for (const [suit, suitTargets] of bySuit) {
    const category = suitCategory(suit);
    const handCardIds = state.playerHand.filter((c) => c.kind === 'creature' && c.suit === suit).map((c) => c.id);
    const handCount = handCardIds.length;
    const poolSetSize = suitTargets[0].poolSetSize;
    const rawMagnitude = poolSetSize * handCount;

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
          // claim of the same magnitude, and prefer the highest-HP target
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
      // strength (Vigor): modest baseline value, discounted for decay risk.
      const score = rawMagnitude * 0.5;
      if (!best || score > best.score) best = { suit, handCardIds, score };
    }
  }

  return best;
}

function pickDoor(run: RunState): string {
  const doors = run.currentDoors!;
  const hpRatio = run.playerHP / run.playerHPMax;
  let bestId = doors[0].id;
  let bestScore = -Infinity;
  for (const d of doors) {
    let score = 0;
    score += d.tags.size === 'small' ? (hpRatio < 0.5 ? 2 : 0.5) : (hpRatio < 0.5 ? -1 : 1);
    score += d.tags.texture === 'jagged' ? -0.5 : 0.3;
    if (score > bestScore) {
      bestScore = score;
      bestId = d.id;
    }
  }
  return bestId;
}

// --- decay/guard-fade log instrumentation -------------------------------

function recordDecayAndGuardFade(prevCombat: CombatState, nextCombat: CombatState) {
  const newEntries = nextCombat.log.slice(prevCombat.log.length);
  for (const entry of newEntries) {
    if (entry.type === 'decay') {
      const match = entry.message.match(/^The (.+?) pile \((\d+)\) decays/);
      if (match) {
        const suit = suitByName(match[1]);
        if (suit) m.decayEvents.push({ category: suit.category, enemiesPresent: prevCombat.enemies.length });
      }
    }
    if (entry.type === 'guard-fade') {
      if (prevCombat.playerGuard > 0) m.guardWasted.push(prevCombat.playerGuard);
    }
  }
}

function checkLockstep(combat: CombatState) {
  const byDef = new Map<string, number[]>();
  for (const e of combat.enemies) {
    if (!byDef.has(e.defId)) byDef.set(e.defId, []);
    byDef.get(e.defId)!.push(e.patternIndex);
  }
  for (const indices of byDef.values()) {
    if (indices.length < 2) continue;
    m.lockstepChecks++;
    if (new Set(indices).size > 1) m.lockstepViolations++;
  }
}

// --- turn/room/run drivers -----------------------------------------------

// Deliberately does NOT call resolveCombatEnd -- the caller needs to
// classify a death/clear from combat.status while run.phase is still
// 'combat' (resolveCombatEnd immediately advances phase to 'run-over'/
// 'door-choice', which erases that signal for anyone checking afterward).
function runEnemyPhaseToNextDecision(run: RunState): RunState {
  let next = run;
  while (next.phase === 'combat' && next.combat?.status === 'active' && next.combat.activeTurn === 'enemy') {
    const prevCombat = next.combat;
    next = applyCombatAction(next, { type: 'ENEMY_TURN' });
    if (next.combat) recordDecayAndGuardFade(prevCombat, next.combat);
  }
  // Checked once per full round, not per individual enemy sub-action: mid-
  // round, enemies are *expected* to be transiently offset from each other
  // as they act one at a time in sequence -- that's not a desync, just
  // sequencing. Also skip a round truncated by player death (status !==
  // 'active') -- combat ending before the last enemy acted isn't a pattern
  // desync either, just the fight being over.
  if (next.combat && next.combat.status === 'active') checkLockstep(next.combat);
  return next;
}

function playPlayerTurn(run: RunState): RunState {
  let next = run;
  let guard = 0;
  while (next.phase === 'combat' && next.combat?.status === 'active' && next.combat.activeTurn === 'player') {
    if (guard++ > 50) {
      m.anomalies++;
      return { ...next, phase: 'run-over' as const };
    }
    const state = next.combat;
    const quakeCard = state.playerHand.find((c) => c.kind === 'quake');
    if (quakeCard) {
      next = applyCombatAction(next, { type: 'PLAYER_PLAY_QUAKE', cardId: quakeCard.id });
      continue;
    }

    const targets = getLegalPlayerClaimTargets(state);
    if (targets.length === 0) {
      m.deadHandTurns++;
      m.totalPlayerTurns++;
      m.unclaimedCardsPerTurn.push(state.playerHand.length);
      next = applyCombatAction(next, { type: 'PLAYER_PASS' });
      break;
    }
    const best = pickBestClaim(state, targets);
    if (!best || best.score <= 0) {
      m.voluntaryPassTurns++;
      m.totalPlayerTurns++;
      m.unclaimedCardsPerTurn.push(state.playerHand.length);
      next = applyCombatAction(next, { type: 'PLAYER_PASS' });
      break;
    }

    const category = suitCategory(best.suit);
    const targetEnemy = best.targetInstanceId ? state.enemies.find((e) => e.instanceId === best.targetInstanceId) : undefined;
    const before = {
      enemyHp: targetEnemy?.hp,
      playerHP: state.playerHP,
      playerGuard: state.playerGuard,
      enemyStack: targetEnemy ? (targetEnemy.statuses[category as 'weaken' | 'poison'] ?? 0) : undefined,
      playerStrength: state.playerStatuses.strength ?? 0,
    };

    next = applyCombatAction(next, {
      type: 'PLAYER_CLAIM',
      suit: best.suit,
      targetInstanceId: best.targetInstanceId,
      handCardIds: best.handCardIds,
    });
    const after = next.combat!;
    const afterEnemy = best.targetInstanceId ? after.enemies.find((e) => e.instanceId === best.targetInstanceId) : undefined;

    if (category === 'threat') {
      const dealt = before.enemyHp! - (afterEnemy?.hp ?? 0);
      m.claimMagnitudes.threat.push(dealt);
    } else if (category === 'boon') {
      m.claimMagnitudes.boon.push(after.playerHP - before.playerHP);
    } else if (category === 'guard') {
      m.guardBanked.push(after.playerGuard - before.playerGuard);
      m.claimMagnitudes.guard.push(after.playerGuard - before.playerGuard);
    } else if (category === 'weaken' || category === 'poison') {
      const afterStack = afterEnemy ? (afterEnemy.statuses[category] ?? 0) : 0;
      m.claimMagnitudes[category].push(afterStack - (before.enemyStack ?? 0));
    } else {
      m.claimMagnitudes.strength.push((after.playerStatuses.strength ?? 0) - before.playerStrength);
    }

    if (!after.unlimitedPlaysThisTurn && after.playsRemaining <= 0) {
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

function playRun(seed: number) {
  let run = createNewRun(seed);
  run = startFirstRoom(run);
  let roomsCleared = 0;
  let safety = 0;

  while (run.phase === 'combat' || run.phase === 'door-choice') {
    if (safety++ > 400) {
      m.anomalies++;
      return;
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
      run = playPlayerTurn(run);
      if (run.phase !== 'combat' || run.combat!.status !== 'active') break;
      run = runEnemyPhaseToNextDecision(run);
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

const numRuns = Number(process.argv[2] ?? 300);
const startSeed = Number(process.argv[3] ?? 1);

for (let i = 0; i < numRuns; i++) {
  playRun(startSeed + i);
}

const report = {
  config: { numRuns, startSeed, DECAY_TURNS_N },
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
  claimMagnitudes: Object.fromEntries(Object.entries(m.claimMagnitudes).map(([k, v]) => [k, { count: v.length, ...stats(v) }])),
  bigThreatSpikes: {
    total: m.claimMagnitudes.threat.length,
    ge8: m.claimMagnitudes.threat.filter((x) => x >= 8).length,
    ge12: m.claimMagnitudes.threat.filter((x) => x >= 12).length,
    ge16: m.claimMagnitudes.threat.filter((x) => x >= 16).length,
  },
  decayEvents: {
    total: m.decayEvents.length,
    byCategory: Object.fromEntries(
      Object.entries(
        m.decayEvents.reduce((acc, e) => {
          acc[e.category] = (acc[e.category] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      ),
    ),
    avgEnemiesPresent: stats(m.decayEvents.map((e) => e.enemiesPresent)),
  },
  guard: {
    banked: stats(m.guardBanked),
    wastedOnFade: stats(m.guardWasted),
    fadeEvents: m.guardWasted.length,
  },
  lockstep: {
    checksAcrossMultiEnemyGroups: m.lockstepChecks,
    violations: m.lockstepViolations,
    violationRate: m.lockstepChecks ? Number((m.lockstepViolations / m.lockstepChecks).toFixed(4)) : null,
  },
  roomClearRateByEnemyCount: Object.fromEntries(
    Object.entries(m.roomOutcomesByEnemyCount).map(([count, o]) => [
      count,
      { ...o, total: o.cleared + o.died, clearRate: Number((o.cleared / (o.cleared + o.died)).toFixed(3)) },
    ]),
  ),
};

console.log(JSON.stringify(report, null, 2));
