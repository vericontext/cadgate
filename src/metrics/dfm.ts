import { z } from 'zod';
import type { Metrics, MetricsDelta } from '../core/types.ts';

const Severity = z.enum(['error', 'warn']);
export type Severity = z.infer<typeof Severity>;

const RuleBase = {
  severity: Severity.default('error'),
  enabled: z.boolean().default(true),
};

const MinWallRuleSchema = z.object({
  ...RuleBase,
  id: z.literal('min-wall-thickness'),
  minMm: z.number().positive(),
});

const MaxOverhangRuleSchema = z.object({
  ...RuleBase,
  id: z.literal('max-overhang-angle'),
  maxDegrees: z.number().min(0).max(90),
  enabled: z.boolean().default(false), // not implemented in Phase 2a
});

const WatertightRuleSchema = z.object({
  ...RuleBase,
  id: z.literal('watertight'),
});

const MassBudgetRuleSchema = z.object({
  ...RuleBase,
  id: z.literal('mass-budget'),
  densityGcm3: z.number().positive(),
  maxG: z.number().positive(),
});

const RegressionVolumeRuleSchema = z.object({
  ...RuleBase,
  id: z.literal('regression-volume'),
  maxAbsDeltaPct: z.number().nonnegative(),
});

export const DfmRuleSchema = z.discriminatedUnion('id', [
  MinWallRuleSchema,
  MaxOverhangRuleSchema,
  WatertightRuleSchema,
  MassBudgetRuleSchema,
  RegressionVolumeRuleSchema,
]);
export type DfmRule = z.infer<typeof DfmRuleSchema>;

export const DfmRulesSchema = z.object({
  version: z.literal(1),
  material: z.string().optional(),
  process: z.string().optional(),
  rules: z.array(DfmRuleSchema),
});
export type DfmRules = z.infer<typeof DfmRulesSchema>;

export const RuleViolationSchema = z.object({
  ruleId: z.string(),
  severity: Severity,
  message: z.string(),
});
export type RuleViolation = z.infer<typeof RuleViolationSchema>;

export interface DfmInput {
  baseMetrics: Metrics | null;
  headMetrics: Metrics;
  delta: MetricsDelta | null;
  rules: DfmRules;
}

function massGrams(metrics: Metrics, densityGcm3: number): number {
  // volume is in mm³; density in g/cm³ = g per 1000 mm³.
  return (metrics.volume * densityGcm3) / 1000;
}

export function evaluateDfmRules(input: DfmInput): RuleViolation[] {
  const violations: RuleViolation[] = [];
  for (const rule of input.rules.rules) {
    if (!rule.enabled) continue;
    const v = evaluate(rule, input);
    if (v) violations.push(v);
  }
  return violations;
}

function evaluate(rule: DfmRule, input: DfmInput): RuleViolation | null {
  const head = input.headMetrics;
  switch (rule.id) {
    case 'min-wall-thickness': {
      if (head.minWallMm < 0) {
        return {
          ruleId: rule.id,
          severity: rule.severity,
          message: `Cannot evaluate min-wall on non-watertight mesh.`,
        };
      }
      if (head.minWallMm < rule.minMm) {
        return {
          ruleId: rule.id,
          severity: rule.severity,
          message: `min wall ${head.minWallMm.toFixed(2)}mm < ${rule.minMm}mm`,
        };
      }
      return null;
    }
    case 'watertight':
      return head.isWatertight
        ? null
        : { ruleId: rule.id, severity: rule.severity, message: 'mesh is not watertight' };
    case 'mass-budget': {
      const grams = massGrams(head, rule.densityGcm3);
      return grams <= rule.maxG
        ? null
        : {
            ruleId: rule.id,
            severity: rule.severity,
            message: `mass ${grams.toFixed(1)}g (@ ${rule.densityGcm3} g/cm³) > ${rule.maxG}g`,
          };
    }
    case 'regression-volume': {
      if (!input.delta) return null;
      const abs = Math.abs(input.delta.volumeDeltaPct);
      return abs <= rule.maxAbsDeltaPct
        ? null
        : {
            ruleId: rule.id,
            severity: rule.severity,
            message: `volume changed ${input.delta.volumeDeltaPct.toFixed(1)}% (limit ±${rule.maxAbsDeltaPct}%)`,
          };
    }
    case 'max-overhang-angle':
      return null; // Phase 2b
  }
}
