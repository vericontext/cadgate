import { createAnthropicJudge } from './anthropic.ts';
import type { JudgeDriver } from './types.ts';

export type JudgeName = 'none' | 'opus' | 'sonnet';

export interface PickJudgeOptions {
  /** Anthropic API key. Required for opus / sonnet. */
  apiKey?: string;
  /** Explicit model id override (e.g. 'claude-opus-4-7-1m'). */
  model?: string;
}

const ALIAS_TO_MODEL: Record<Exclude<JudgeName, 'none'>, string> = {
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
};

export type PickJudgeResult =
  | { ok: true; driver: JudgeDriver }
  | { ok: false; reason: string };

export function pickJudge(name: JudgeName, opts: PickJudgeOptions): PickJudgeResult {
  if (name === 'none') return { ok: false, reason: 'judge disabled' };
  const defaultModel = ALIAS_TO_MODEL[name];
  if (!defaultModel) {
    return { ok: false, reason: `unknown judge name: ${name}` };
  }
  if (!opts.apiKey) {
    return {
      ok: false,
      reason:
        'ANTHROPIC_API_KEY not set. Pass --anthropic-api-key or export ANTHROPIC_API_KEY.',
    };
  }
  const driver = createAnthropicJudge({
    apiKey: opts.apiKey,
    model: opts.model ?? defaultModel,
  });
  return { ok: true, driver };
}

export function isJudgeName(value: string): value is JudgeName {
  return value === 'none' || value === 'opus' || value === 'sonnet';
}
