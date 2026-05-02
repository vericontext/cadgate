import { join } from 'node:path';
import { diffMetrics } from '../../core/diff.ts';
import type { Metrics, MetricsDelta } from '../../core/types.ts';
import {
  type DfmRules,
  evaluateDfmRules,
  type RuleViolation,
} from '../../metrics/dfm.ts';
import type { JudgeRequest } from '../../judges/types.ts';
import type { RenderPaths } from '../../render/types.ts';
import type { JudgeName } from '../../judges/registry.ts';
import type { McpState } from '../state.ts';
import type { Language } from '../types.ts';
import {
  mapJudgeError,
  mapRunError,
  runSourceToMetrics,
  type McpToolResult,
  type SourceMetricsResult,
} from './_shared.ts';

export interface JudgeOk {
  verdict: 'pass' | 'block' | 'comment-only';
  intentMatch: 'matches' | 'differs' | 'uncertain';
  reasons: string[];
  noteForHuman: string;
  modelId: string;
  promptCacheHit: boolean;
  baseMetrics: Metrics | null;
  headMetrics: Metrics;
  delta: MetricsDelta | null;
  dfmViolations: RuleViolation[];
}

interface JudgeArgs {
  baseSource?: string;
  headSource: string;
  prDescription?: string;
  filePath: string;
  rules?: DfmRules;
  language?: Language;
  judge: JudgeName;
  model?: string;
  render: boolean;
  timeoutMs: number;
}

export async function judge(
  state: McpState,
  args: JudgeArgs,
): Promise<McpToolResult<JudgeOk>> {
  const driver = await state.judge(args.judge, args.model);
  if (!driver) {
    return {
      ok: false,
      error: {
        code: 'JUDGE_AUTH',
        message:
          'Anthropic API key not configured. Restart cadgate mcp serve with --anthropic-api-key or ANTHROPIC_API_KEY env.',
      },
    };
  }

  const headPromise = runSourceToMetrics(state, {
    source: args.headSource,
    language: args.language,
    timeoutMs: args.timeoutMs,
  });
  const basePromise: Promise<McpToolResult<SourceMetricsResult>> | null =
    args.baseSource !== undefined
      ? runSourceToMetrics(state, {
          source: args.baseSource,
          language: args.language,
          timeoutMs: args.timeoutMs,
        })
      : null;
  const headRes = await headPromise;
  const baseRes = basePromise ? await basePromise : null;

  const cleanup = () => {
    if (headRes.ok) headRes.data.dispose();
    if (baseRes && baseRes.ok) baseRes.data.dispose();
  };

  if (!headRes.ok) {
    cleanup();
    return headRes;
  }
  if (baseRes && !baseRes.ok) {
    cleanup();
    return baseRes;
  }

  let baseRenders: RenderPaths | null = null;
  let headRenders: RenderPaths | null = null;
  const renderer = args.render ? await state.renderer() : null;
  if (renderer) {
    try {
      headRenders = await renderer.renderViews(
        headRes.data.mesh,
        headRes.data.metrics.minWallHotspots,
        join(headRes.data.callDir, 'renders'),
      );
      if (baseRes && baseRes.ok) {
        baseRenders = await renderer.renderViews(
          baseRes.data.mesh,
          baseRes.data.metrics.minWallHotspots,
          join(baseRes.data.callDir, 'renders'),
        );
      }
    } catch (err) {
      state.invalidateRenderer();
      cleanup();
      return {
        ok: false,
        error: mapRunError('mesh_invalid', err instanceof Error ? err.message : String(err)),
      };
    }
  }

  const baseMetrics: Metrics | null = baseRes && baseRes.ok ? baseRes.data.metrics : null;
  const headMetrics = headRes.data.metrics;
  const delta = baseMetrics ? diffMetrics(baseMetrics, headMetrics) : null;
  const dfmViolations = args.rules
    ? evaluateDfmRules({ baseMetrics, headMetrics, delta, rules: args.rules })
    : [];

  const req: JudgeRequest = {
    filePath: args.filePath,
    prDescription: args.prDescription ?? null,
    baseSource: args.baseSource ?? null,
    headSource: args.headSource,
    baseMetrics,
    headMetrics,
    baseRenders,
    headRenders,
    delta,
    dfmViolations,
  };

  // Manifold lifetime is decoupled from the judge round-trip — the request
  // holds value-types only (metrics + render paths). Free the manifolds before
  // the network call so we don't hold WASM memory while we wait on Anthropic.
  cleanup();

  const result = await driver.judge(req);
  if (!result.ok) {
    return { ok: false, error: mapJudgeError(result.error) };
  }
  return {
    ok: true,
    data: {
      verdict: result.verdict.verdict,
      intentMatch: result.verdict.intentMatch,
      reasons: result.verdict.reasons,
      noteForHuman: result.verdict.noteForHuman,
      modelId: result.verdict.modelId,
      promptCacheHit: result.verdict.promptCacheHit ?? false,
      baseMetrics,
      headMetrics,
      delta,
      dfmViolations,
    },
  };
}
