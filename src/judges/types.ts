import { z } from 'zod';
import type { Metrics, MetricsDelta } from '../core/types.ts';
import type { RuleViolation } from '../metrics/dfm.ts';
import type { RenderPaths } from '../render/types.ts';

export const JudgeVerdictSchema = z.object({
  verdict: z.enum(['pass', 'block', 'comment-only']),
  intentMatch: z.enum(['matches', 'differs', 'uncertain']),
  reasons: z.array(z.string().min(1)).min(1).max(8),
  noteForHuman: z.string().min(1).max(2000),
  modelId: z.string(),
  promptCacheHit: z.boolean().optional(),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

export interface JudgeRequest {
  filePath: string;
  prDescription: string | null;
  baseSource: string | null;
  headSource: string;
  baseMetrics: Metrics | null;
  headMetrics: Metrics;
  baseRenders: RenderPaths | null;
  headRenders: RenderPaths | null;
  delta: MetricsDelta | null;
  dfmViolations: RuleViolation[];
}

export type JudgeErrorCode =
  | 'JUDGE_AUTH'
  | 'JUDGE_API'
  | 'NO_VERDICT'
  | 'BAD_VERDICT_SHAPE';

export interface JudgeError {
  code: JudgeErrorCode;
  message: string;
}

export type JudgeResult =
  | { ok: true; verdict: JudgeVerdict }
  | { ok: false; error: JudgeError };

export interface JudgeDriver {
  readonly name: string;
  readonly modelId: string;
  judge(req: JudgeRequest): Promise<JudgeResult>;
}
