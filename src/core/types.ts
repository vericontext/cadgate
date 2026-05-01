import { z } from 'zod';

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3Schema>;

export const BBoxSchema = z.object({
  min: Vec3Schema,
  max: Vec3Schema,
});
export type BBox = z.infer<typeof BBoxSchema>;

export const MetricsSchema = z.object({
  volume: z.number(),
  surfaceArea: z.number(),
  isWatertight: z.boolean(),
  bbox: BBoxSchema,
  triCount: z.number().int(),
});
export type Metrics = z.infer<typeof MetricsSchema>;

export const MetricsDeltaSchema = z.object({
  volumeDelta: z.number(),
  volumeDeltaPct: z.number(),
  surfaceAreaDelta: z.number(),
  triCountDelta: z.number().int(),
  bboxChanged: z.boolean(),
  watertightnessChanged: z.boolean(),
});
export type MetricsDelta = z.infer<typeof MetricsDeltaSchema>;
