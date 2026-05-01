import { join } from 'node:path';
import { evaluateDfmRules, type RuleViolation, type DfmRules } from '../../metrics/dfm.ts';
import type { Metrics } from '../../core/types.ts';
import type { RenderPaths } from '../../render/types.ts';
import type { Language } from '../types.ts';
import type { McpState } from '../state.ts';
import { mapRunError, runSourceToMetrics, type McpToolResult } from './_shared.ts';

export interface ValidateOk {
  metrics: Metrics;
  violations?: RuleViolation[];
  renders?: RenderPaths;
}

export async function validate(
  state: McpState,
  args: {
    source: string;
    language?: Language;
    rules?: DfmRules;
    render: boolean;
    timeoutMs: number;
  },
): Promise<McpToolResult<ValidateOk>> {
  const r = await runSourceToMetrics(state, {
    source: args.source,
    language: args.language,
    timeoutMs: args.timeoutMs,
  });
  if (!r.ok) return r;

  try {
    const out: ValidateOk = { metrics: r.data.metrics };

    if (args.rules) {
      out.violations = evaluateDfmRules({
        baseMetrics: null,
        headMetrics: r.data.metrics,
        delta: null,
        rules: args.rules,
      });
    }

    if (args.render) {
      const renderer = await state.renderer();
      if (!renderer) {
        return {
          ok: false,
          error: {
            code: 'CHROMIUM_UNAVAILABLE',
            message: 'Renderer not initialized. Start cadgate without --no-render and ensure Chromium is installed.',
          },
        };
      }
      try {
        out.renders = await renderer.renderViews(
          r.data.mesh,
          r.data.metrics.minWallHotspots,
          join(r.data.callDir, 'renders'),
        );
      } catch (err) {
        state.invalidateRenderer();
        return {
          ok: false,
          error: mapRunError('mesh_invalid', err instanceof Error ? err.message : String(err)),
        };
      }
    }

    return { ok: true, data: out };
  } finally {
    r.data.dispose();
  }
}
