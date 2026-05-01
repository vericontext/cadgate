import { diffMetrics } from '../../core/diff.ts';
import type { Metrics, MetricsDelta } from '../../core/types.ts';
import type { Language } from '../types.ts';
import type { McpState } from '../state.ts';
import { runSourceToMetrics, type McpToolResult } from './_shared.ts';

export interface DiffOk {
  baseMetrics: Metrics;
  headMetrics: Metrics;
  delta: MetricsDelta;
}

export async function diff(
  state: McpState,
  args: {
    baseSource: string;
    headSource: string;
    language?: Language;
    timeoutMs: number;
  },
): Promise<McpToolResult<DiffOk>> {
  const [baseRes, headRes] = await Promise.all([
    runSourceToMetrics(state, {
      source: args.baseSource,
      language: args.language,
      timeoutMs: args.timeoutMs,
    }),
    runSourceToMetrics(state, {
      source: args.headSource,
      language: args.language,
      timeoutMs: args.timeoutMs,
    }),
  ]);

  try {
    if (!baseRes.ok) return baseRes;
    if (!headRes.ok) return headRes;
    return {
      ok: true,
      data: {
        baseMetrics: baseRes.data.metrics,
        headMetrics: headRes.data.metrics,
        delta: diffMetrics(baseRes.data.metrics, headRes.data.metrics),
      },
    };
  } finally {
    if (baseRes.ok) baseRes.data.dispose();
    if (headRes.ok) headRes.data.dispose();
  }
}
