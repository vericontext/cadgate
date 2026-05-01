import { describe, expect, test } from 'bun:test';
import { type DfmRules, evaluateDfmRules } from '../../src/metrics/dfm.ts';
import type { Metrics, MetricsDelta } from '../../src/core/types.ts';

const goodMetrics: Metrics = {
  volume: 8000,
  surfaceArea: 2400,
  isWatertight: true,
  bbox: { min: [-10, -10, -10], max: [10, 10, 10] },
  triCount: 12,
  minWallMm: 20,
  minWallHotspots: [],
};

const thinMetrics: Metrics = { ...goodMetrics, minWallMm: 0.5 };
const nonWatertight: Metrics = { ...goodMetrics, isWatertight: false, minWallMm: -1 };

const rules: DfmRules = {
  version: 1,
  rules: [
    { id: 'min-wall-thickness', minMm: 1.2, severity: 'error', enabled: true },
    { id: 'watertight', severity: 'error', enabled: true },
    { id: 'mass-budget', densityGcm3: 1.24, maxG: 50, severity: 'error', enabled: true },
    { id: 'regression-volume', maxAbsDeltaPct: 5, severity: 'error', enabled: true },
  ],
};

describe('evaluateDfmRules', () => {
  test('passes when all metrics are within rules', () => {
    const generousRules: DfmRules = {
      ...rules,
      rules: rules.rules.map((r) => (r.id === 'mass-budget' ? { ...r, maxG: 500 } : r)),
    };
    const v = evaluateDfmRules({
      baseMetrics: goodMetrics,
      headMetrics: goodMetrics,
      delta: null,
      rules: generousRules,
    });
    expect(v).toEqual([]);
  });

  test('flags thin walls', () => {
    const v = evaluateDfmRules({
      baseMetrics: null,
      headMetrics: thinMetrics,
      delta: null,
      rules,
    });
    const ids = v.map((x) => x.ruleId);
    expect(ids).toContain('min-wall-thickness');
  });

  test('flags non-watertight as both min-wall and watertight failures', () => {
    const v = evaluateDfmRules({
      baseMetrics: null,
      headMetrics: nonWatertight,
      delta: null,
      rules,
    });
    const ids = v.map((x) => x.ruleId);
    expect(ids).toContain('watertight');
    expect(ids).toContain('min-wall-thickness');
  });

  test('flags mass over budget', () => {
    const v = evaluateDfmRules({
      baseMetrics: null,
      headMetrics: goodMetrics, // 8000 mm³ × 1.24 = 9.92g — under 50g
      delta: null,
      rules,
    });
    expect(v.find((x) => x.ruleId === 'mass-budget')).toBeUndefined();

    const heavy: Metrics = { ...goodMetrics, volume: 100_000 };
    const v2 = evaluateDfmRules({
      baseMetrics: null,
      headMetrics: heavy,
      delta: null,
      rules,
    });
    expect(v2.find((x) => x.ruleId === 'mass-budget')).toBeDefined();
  });

  test('flags regression-volume only when delta exceeds limit', () => {
    const smallDelta: MetricsDelta = {
      volumeDelta: 100,
      volumeDeltaPct: 1,
      surfaceAreaDelta: 0,
      triCountDelta: 0,
      bboxChanged: false,
      watertightnessChanged: false,
    };
    const bigDelta: MetricsDelta = { ...smallDelta, volumeDeltaPct: 12 };

    const ok = evaluateDfmRules({
      baseMetrics: goodMetrics,
      headMetrics: goodMetrics,
      delta: smallDelta,
      rules,
    });
    expect(ok.find((x) => x.ruleId === 'regression-volume')).toBeUndefined();

    const fail = evaluateDfmRules({
      baseMetrics: goodMetrics,
      headMetrics: goodMetrics,
      delta: bigDelta,
      rules,
    });
    expect(fail.find((x) => x.ruleId === 'regression-volume')).toBeDefined();
  });

  test('skips disabled rules', () => {
    const allDisabled: DfmRules = {
      ...rules,
      rules: rules.rules.map((r) => ({ ...r, enabled: false })),
    };
    const v = evaluateDfmRules({
      baseMetrics: null,
      headMetrics: thinMetrics,
      delta: null,
      rules: allDisabled,
    });
    expect(v).toEqual([]);
  });
});
