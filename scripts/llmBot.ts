// LLM-driven combat decision-maker for playtest-sim.ts's PLAYTEST_BOT=llm
// mode. Claude picks among the *precomputed* legal play options (or pass)
// via a forced tool call -- it never has to reconstruct suit-matching or
// targeting legality itself, which keeps a cheap model's job small and our
// parsing trivial (an index, or the literal string "pass").
//
// Scope is deliberately narrow: only the per-turn play/pass decision goes
// through the model. Reward, door, and rest-room choices always stay on
// playtest-sim.ts's heuristic pickers, so this file needs no changes when
// the enemy roster grows (config/enemies.ts) or a new non-combat room kind
// is added (e.g. rest rooms) -- combat state (enemy name/HP/guard/statuses,
// legal plays and their magnitudes) is rendered generically, never
// hardcoded to a specific suit or enemy def.
import Anthropic from '@anthropic-ai/sdk';
import type { CombatState } from '../src/types/combat.ts';
import type { LegalPlayTarget } from '../src/engine/combatEngine.ts';
import { SUIT_DEFINITIONS } from '../src/config/constants.ts';
import type { SuitId } from '../src/types/suits.ts';

const MODEL = process.env.PLAYTEST_LLM_MODEL ?? 'claude-haiku-4-5';
// On by default -- this mode exists to be watched, not just measured; the
// per-decision reasoning line is the whole point at n=1/10/25 scale.
const VERBOSE = process.env.PLAYTEST_LLM_VERBOSE !== '0';

const suitDef = (id: SuitId) => SUIT_DEFINITIONS.find((s) => s.id === id)!;

// Constructed lazily so importing this module never throws just because no
// credentials are configured -- playtest-sim.ts only calls pickLlmPlay at
// all when PLAYTEST_BOT=llm, and checks for a key upfront in that case.
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export interface LlmChosenPlay {
  suit: SuitId;
  targetInstanceId?: string;
  handCardIds: string[];
}

interface Option {
  suit: SuitId;
  targetInstanceId?: string;
  tableSetSize: number;
  handCardIds: string[];
}

function buildOptions(state: CombatState, targets: LegalPlayTarget[]): Option[] {
  return targets.map((t) => ({
    suit: t.suit,
    targetInstanceId: t.targetInstanceId,
    tableSetSize: t.tableSetSize,
    handCardIds: state.playerHand.filter((c) => c.kind === 'creature' && c.suit === t.suit).map((c) => c.id),
  }));
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
  lines.push('Legal plays this turn (playing a suit always commits every matching card in your hand):');
  options.forEach((opt, i) => {
    const category = suitDef(opt.suit).category;
    const targetName = opt.targetInstanceId ? state.enemies.find((e) => e.instanceId === opt.targetInstanceId)?.name : null;
    const magnitude = opt.handCardIds.length * (opt.tableSetSize + opt.handCardIds.length);
    lines.push(
      `  ${i}: play ${opt.handCardIds.length} ${suitDef(opt.suit).name} (${category}, ${opt.tableSetSize} already on the table -> magnitude ${magnitude})${targetName ? ` -> ${targetName}` : ''}`,
    );
  });

  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are playing THRESHOLD, a card combat game. Each turn you may either play matching hand cards of one suit onto the shared table, or pass. Playing a suit multiplies your hand cards against the table's count of that suit -- including the cards this exact play adds -- so magnitude = hand cards played x (cards already on the table + cards you're adding). There is no decay and no way to play cards without an effect; every play does something, even into an empty table. Threat plays damage the chosen enemy; boon heals you; guard banks a shield that absorbs your next incoming damage and never expires on its own; weaken/poison debuffs an enemy; strength buffs you. Your goal is to clear the room (defeat every enemy) while staying alive. Choose the single best play for this turn.`;

const CHOOSE_ACTION_TOOL: Anthropic.Tool = {
  name: 'choose_action',
  description: "Pick this turn's action: pass, or the index of one of the listed play options.",
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
 * Returns the chosen play, or null for pass. Falls back to null (pass) --
 * never the heuristic bot -- on any API/parsing failure, so a transient
 * 429/network blip degrades a single turn's decision rather than crashing
 * the batch; `fallbackCount` tracks how often that happened so it's visible
 * in the report, not silently absorbed.
 */
export async function pickLlmPlay(state: CombatState, targets: LegalPlayTarget[]): Promise<LlmChosenPlay | null> {
  const options = buildOptions(state, targets);
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
    return { suit: option.suit, targetInstanceId: option.targetInstanceId, handCardIds: option.handCardIds };
  } catch (err) {
    fallbackCount++;
    if (VERBOSE) console.error(`  [llm] API call failed (${(err as Error).message}) -- passing`);
    return null;
  }
}
