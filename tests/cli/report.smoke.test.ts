import { describe, expect, test } from 'bun:test';
import type { CheckReport } from '../../src/metrics/schema.ts';
import { renderMarkdown, STICKY_MARKER } from '../../src/github/markdown.ts';

const baseMetrics = {
  volume: 8000,
  surfaceArea: 2400,
  isWatertight: true,
  bbox: { min: [-10, -10, -10] as [number, number, number], max: [10, 10, 10] as [number, number, number] },
  triCount: 12,
  minWallMm: 20,
  minWallHotspots: [],
};
const headMetrics = { ...baseMetrics, volume: 100, minWallMm: 0.5 };

const report: CheckReport = {
  schemaVersion: 'cadgate.check.v1',
  base: 'main',
  head: 'feat/housing',
  files: [
    {
      status: 'analyzed',
      path: 'parts/housing.py',
      language: 'cadquery',
      base: { state: 'ok', metrics: baseMetrics },
      head: {
        state: 'ok',
        metrics: headMetrics,
        renders: {
          front: '/tmp/front.png',
          back: '/tmp/back.png',
          top: '/tmp/top.png',
          bottom: '/tmp/bottom.png',
          left: '/tmp/left.png',
          right: '/tmp/right.png',
        },
      },
      delta: {
        kind: 'changed',
        volumeDelta: -7900,
        volumeDeltaPct: -98.75,
        surfaceAreaDelta: 0,
        triCountDelta: 0,
        bboxChanged: false,
        watertightnessChanged: false,
      },
      dfmViolations: [
        { ruleId: 'min-wall-thickness', severity: 'error', message: 'min wall 0.50mm < 1.2mm' },
        { ruleId: 'regression-volume', severity: 'error', message: 'volume changed -98.8% (limit ±5%)' },
      ],
    },
  ],
  summary: { filesChanged: 1, filesFailed: 0, filesSkipped: 0, filesWithViolations: 1 },
};

describe('renderMarkdown', () => {
  const md = renderMarkdown(report, (p) => `https://example.com/${p.replace(/^\//, '')}`);

  test('starts with sticky marker', () => {
    expect(md.startsWith(STICKY_MARKER)).toBe(true);
  });

  test('reflects violation count in headline', () => {
    expect(md).toContain('1 violation');
  });

  test('lists each DFM violation', () => {
    expect(md).toContain('min-wall-thickness');
    expect(md).toContain('regression-volume');
  });

  test('renders all 6 view image links', () => {
    for (const view of ['front', 'back', 'top', 'bottom', 'left', 'right']) {
      expect(md).toContain(`https://example.com/tmp/${view}.png`);
    }
  });

  test('summary table includes language and min-wall', () => {
    expect(md).toContain('| `parts/housing.py` | cadquery |');
    expect(md).toContain('0.50 mm'); // min-wall in red text per formatter
  });

  test('passes-only report shows the success headline', () => {
    const okReport: CheckReport = {
      ...report,
      files: [
        {
          ...(report.files[0] as Extract<CheckReport['files'][number], { status: 'analyzed' }>),
          dfmViolations: [],
        },
      ],
      summary: { filesChanged: 1, filesFailed: 0, filesSkipped: 0, filesWithViolations: 0 },
    };
    const okMd = renderMarkdown(okReport, (p) => p);
    expect(okMd).toContain('all checks passed');
  });
});
