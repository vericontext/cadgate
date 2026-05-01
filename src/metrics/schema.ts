import { z } from 'zod';
import { MetricsDeltaSchema, MetricsSchema } from '../core/types.ts';
import { RunErrorKindSchema } from '../drivers/types.ts';
import { RenderPathsSchema } from '../render/types.ts';
import { RuleViolationSchema } from './dfm.ts';

export const CadLanguageSchema = z.enum(['cadquery', 'build123d', 'openscad', 'kcl']);

export const FileSideSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('absent') }),
  z.object({
    state: z.literal('ok'),
    metrics: MetricsSchema,
    renders: RenderPathsSchema.optional(),
  }),
  z.object({
    state: z.literal('failed'),
    error: z.object({
      kind: RunErrorKindSchema,
      message: z.string(),
    }),
  }),
]);
export type FileSide = z.infer<typeof FileSideSchema>;

export const DeltaSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('changed') }).extend(MetricsDeltaSchema.shape),
  z.object({ kind: z.literal('created'), metrics: MetricsSchema }),
  z.object({ kind: z.literal('deleted'), metrics: MetricsSchema }),
  z.object({ kind: z.literal('unavailable'), reason: z.string() }),
]);
export type Delta = z.infer<typeof DeltaSchema>;

export const FileResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('skipped'),
    path: z.string(),
    reason: z.string(),
  }),
  z.object({
    status: z.literal('analyzed'),
    path: z.string(),
    language: CadLanguageSchema,
    base: FileSideSchema,
    head: FileSideSchema,
    delta: DeltaSchema,
    dfmViolations: z.array(RuleViolationSchema).default([]),
  }),
]);
export type FileResult = z.infer<typeof FileResultSchema>;

export const CheckReportSchema = z.object({
  schemaVersion: z.literal('cadgate.check.v1'),
  base: z.string(),
  head: z.string(),
  files: z.array(FileResultSchema),
  summary: z.object({
    filesChanged: z.number().int(),
    filesFailed: z.number().int(),
    filesSkipped: z.number().int(),
    filesWithViolations: z.number().int().default(0),
  }),
});
export type CheckReport = z.infer<typeof CheckReportSchema>;
