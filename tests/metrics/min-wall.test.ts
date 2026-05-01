import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { analyzeStl } from '../../src/metrics/manifold.ts';
import { computeMinWall } from '../../src/metrics/min-wall.ts';

const CUBE_STL = join(import.meta.dir, '..', 'fixtures', 'cube.stl');

describe('computeMinWall', () => {
  test('20mm cube reports 20mm minimum wall', async () => {
    const r = await analyzeStl(CUBE_STL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    try {
      const result = computeMinWall(r.mesh, { isWatertight: r.metrics.isWatertight });
      expect(result.minWallMm).toBeCloseTo(20, 1);
      expect(result.hotspots.length).toBeGreaterThan(0);
      expect(result.hotspots[0]!.thicknessMm).toBeLessThanOrEqual(result.hotspots.at(-1)!.thicknessMm);
      expect(result.trianglesAnalyzed).toBe(12);
    } finally {
      r.dispose();
    }
  });

  test('non-watertight input returns sentinel -1', async () => {
    const r = await analyzeStl(CUBE_STL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    try {
      const result = computeMinWall(r.mesh, { isWatertight: false });
      expect(result.minWallMm).toBe(-1);
      expect(result.hotspots).toEqual([]);
    } finally {
      r.dispose();
    }
  });
});
