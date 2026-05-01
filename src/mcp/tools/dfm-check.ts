import { evaluateDfmRules, type DfmRules, type RuleViolation } from '../../metrics/dfm.ts';
import type { Language } from '../types.ts';
import type { McpState } from '../state.ts';
import { runSourceToMetrics, type McpToolResult } from './_shared.ts';

export interface DfmCheckOk {
  violations: RuleViolation[];
}

export async function dfmCheck(
  state: McpState,
  args: {
    source: string;
    rules: DfmRules;
    language?: Language;
    timeoutMs: number;
  },
): Promise<McpToolResult<DfmCheckOk>> {
  const r = await runSourceToMetrics(state, {
    source: args.source,
    language: args.language,
    timeoutMs: args.timeoutMs,
  });
  if (!r.ok) return r;

  try {
    const violations = evaluateDfmRules({
      baseMetrics: null,
      headMetrics: r.data.metrics,
      delta: null,
      rules: args.rules,
    });
    return { ok: true, data: { violations } };
  } finally {
    r.data.dispose();
  }
}
