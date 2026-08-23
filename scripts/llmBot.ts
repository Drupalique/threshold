// LLM-driven combat decision-maker for playtest-sim.ts's PLAYTEST_BOT=llm
// mode. Claude picks among the *precomputed* legal claim/feed options (or
// pass) via a forced tool call -- it never has to reconstruct suit-matching
// or targeting legality itself, which keeps a cheap model's job small and
// our parsing trivial (an index, or the literal string "pass").
import Anthropic from '@anthropic-ai/sdk';
import type { CombatState } from '../src/types/combat.ts';
import type { LegalClaimTarget } from '../src/engine/combatEngine.ts';
import { countPoolSetSize } from '../src/engine/combatEngine.ts';
import { SUIT_DEFINITIONS } from '../src/config/constants.ts';
import type { SuitId } from '../src/types/suits.ts';

const MODEL = process.env.PLAYTEST_LLM_MODEL ?? 'claude-haiku-4-5';
// On by default -- this mode exists to be watched, not just measured; the
// per-decision reasoning line is the whole point at n=1/10/25 scale.
const VERBOSE = process.env.PLAYTEST_LLM_VERBOSE !== '0';

const suitDef = (id: SuitId) => SUIT_DEFINITIONS.find((s) => s.id === id)!;

// Constructed lazily so importing this module never throws just because no
// credentials are configured -- playtest-sim.ts only calls pickLlmClaim at
// all when PLAYTEST_BOT=llm, and checks for a key upfront in that case.
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export type LlmChosenAction =
  | { kind: 'claim'; suit: SuitId; targetInstanceId?: string; handCardIds: string[] }
  | { kind: 'feed'; suit: SuitId; handCardIds: string[] };

interface FeedableSuit {
  suit: SuitId;
  handCardIds: string[];
}

interface ClaimOption {
  kind: 'claim';
  suit: SuitId;
  targetInstanceId?: string;
  poolSetSize: number;
  handCardIds: string[];
}

interface FeedOption {
  kind: 'feed';
  suit: SuitId;
  poolSetSize: number;
  handCardIds: string[];
}

type Option = ClaimOption | FeedOption;

function buildOptions(state: CombatState, targets: LegalClaimTarget[], feedableSuits: FeedableSuit[]): Option[] {
  const claims: ClaimOption[] = targets.map((t) => ({
    kind: 'claim',
    suit: t.suit,
    targetInstanceId: t.targetInstanceId,
    poolSetSize: t.poolSetSize,
    handCardIds: state.playerHand.filter((c) => c.kind === 'creature' && c.suit === t.suit).map((c) => c.id),
  }));
  const feeds: FeedOption[] = feedableSuits.map((f) => ({
    kind: 'feed',
    suit: f.suit,
    poolSetSize: countPoolSetSize(state.pool, f.suit),
    handCardIds: f.handCardIds,
  }));
  return [...claims, ...feeds];
}

function renderState(state: CombatState, options: Option[]): string {
  const lines: string[] = [];
  lines.push(`Turn ${state.turnNumber}, ${state.playsRemaining} play(s) remaining this turn.`);
  lines.push(`Your HP: ${state.playerHP}/${state.playerHPMax}, Guard: ${state.playerGuard}`);
  const statusParts = Object.entries(state.playerStatuses)
    .filter(([, v]) => (v ?? 0) > 0)
    .map(([k, v]) => `${k}+${v}`);
  if (statusParts.length) lines.push(`Your statuses: ${statusParts.join(', ')}`);

  lines.push('');
  lines.push('Enemies:');
  for (const e of state.enemies) {
    const statusStr = Object.entries(e.statuses)
      .filter(([, v]) => (v ?? 0) > 0)
      .map(([k, v]) => `${k}+${v}`)
      .join(', ');
    lines.push(`  [${e.instanceId}] ${e.name} HP ${e.hp}/${e.hpMax} Guard ${e.guard}${statusStr ? ` (${statusStr})` : ''}`);
  }

  lines.push('');
  lines.push('Legal options this turn (claiming/feeding a suit always commits every matching card in your hand):');
  options.forEach((opt, i) => {
    const category = suitDef(opt.suit).category;
    if (opt.kind === 'claim') {
      const targetName = opt.targetInstanceId ? state.enemies.find((e) => e.instanceId === opt.targetInstanceId)?.name : null;
      lines.push(
        `  ${i}: claim ${suitDef(opt.suit).name} (${category}, pool set size ${opt.poolSetSize}) with ${opt.handCardIds.length} hand card(s)${targetName ? ` -> ${targetName}` : ''}`,
      );
    } else {
      lines.push(
        `  ${i}: feed ${opt.handCardIds.length} ${suitDef(opt.suit).name} card(s) into the pool (${category}, currently ${opt.poolSetSize} -> ${opt.poolSetSize + opt.handCardIds.length}) -- resolves no effect now, banks a bigger future claim`,
      );
    }
  });

  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are playing THRESHOLD, a card-claiming combat game. Each turn you may either claim one of the listed pool sets with matching hand cards (claim magnitude = pool set size x hand cards committed), feed matching hand cards face-up into a pool pile instead of claiming it (grows or seeds that pile for a bigger future claim, but resolves no effect right now), or pass. Threat claims damage the chosen enemy; boon heals you; guard shields you from the next enemy attack; weaken/poison debuffs an enemy; strength buffs you. Unclaimed piles (including ones you've fed) decay after a few turns and hit every entity in the room, including enemies, so leaving something to decay isn't automatically bad -- it can hurt an enemy too, but a fed pile is also a bigger decay hit if you never come back to claim it. Feeding is most attractive for a hand card whose suit has nothing worth claiming right now, when you expect to draw more of that suit soon. Your goal is to clear the room (defeat every enemy) while staying alive. Choose the single best action for this turn.`;

const CHOOSE_ACTION_TOOL: Anthropic.Tool = {
  name: 'choose_action',
  description: "Pick this turn's action: pass, or the index of one of the listed claim/feed options.",
  input_schema: {
    type: 'object',
    properties: {
      choice: {
        type: 'string',
        description: "'pass', or the option index as a string, e.g. '0'.",
      },
      reasoning: {
        type: 'string',
        description: 'One brief sentence explaining the choice.',
      },
    },
    required: ['choice'],
  },
};

let callCount = 0;
let fallbackCount = 0;

export function llmStats() {
  return { model: MODEL, callCount, fallbackCount };
}

/**
 * Returns the chosen claim/feed, or null for pass. Falls back to null
 * (pass) -- never the heuristic bot -- on any API/parsing failure, so a
 * transient 429/network blip degrades a single turn's decision rather than
 * crashing the batch; `fallbackCount` tracks how often that happened so
 * it's visible in the report, not silently absorbed.
 */
export async function pickLlmClaim(
  state: CombatState,
  targets: LegalClaimTarget[],
  feedableSuits: FeedableSuit[] = [],
): Promise<LlmChosenAction | null> {
  const options = buildOptions(state, targets, feedableSuits);
  callCount++;

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: [CHOOSE_ACTION_TOOL],
      tool_choice: { type: 'tool', name: 'choose_action' },
      messages: [{ role: 'user', content: renderState(state, options) }],
    });

    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const input = toolUse?.input as { choice?: string; reasoning?: string } | undefined;
    const choice = input?.choice?.trim();

    if (VERBOSE) console.error(`  [llm] ${choice ?? '(no choice)'} -- ${input?.reasoning ?? ''}`);

    if (!choice || choice.toLowerCase() === 'pass') return null;

    const index = Number(choice);
    const option = Number.isInteger(index) ? options[index] : undefined;
    if (!option) {
      fallbackCount++;
      if (VERBOSE) console.error(`  [llm] unrecognized choice "${choice}" -- passing`);
      return null;
    }
    return option.kind === 'claim'
      ? { kind: 'claim', suit: option.suit, targetInstanceId: option.targetInstanceId, handCardIds: option.handCardIds }
      : { kind: 'feed', suit: option.suit, handCardIds: option.handCardIds };
  } catch (err) {
    fallbackCount++;
    if (VERBOSE) console.error(`  [llm] API call failed (${(err as Error).message}) -- passing`);
    return null;
  }
}
