import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { analyzeStl, parseBinarySTL } from '../../src/metrics/manifold.ts';

const CUBE_STL = join(import.meta.dir, '..', 'fixtures', 'cube.stl');

describe('parseBinarySTL', () => {
  test('produces a well-formed mesh (multiple of 3 indices and 3 coords per vertex)', async () => {
    const bytes = await Bun.file(CUBE_STL).arrayBuffer();
    const mesh = parseBinarySTL(bytes);
    expect(mesh.triVerts.length % 3).toBe(0);
    expect(mesh.vertProperties.length % 3).toBe(0);
    expect(mesh.triVerts.length).toBeGreaterThan(0);
    expect(mesh.vertProperties.length).toBeGreaterThan(0);
  });
});

describe('analyzeStl', () => {
  test('20mm cube → volume=8000, surfaceArea=2400, watertight, bbox=[-10..10]', async () => {
    const r = await analyzeStl(CUBE_STL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    try {
      expect(r.metrics.volume).toBeCloseTo(8000, 3);
      expect(r.metrics.surfaceArea).toBeCloseTo(2400, 3);
      expect(r.metrics.isWatertight).toBe(true);
      expect(r.metrics.triCount).toBe(12);
      expect(r.metrics.bbox.min).toEqual([-10, -10, -10]);
      expect(r.metrics.bbox.max).toEqual([10, 10, 10]);
      expect(r.mesh.vertProperties.length).toBeGreaterThan(0);
      expect(r.mesh.triVerts.length).toBeGreaterThan(0);
    } finally {
      r.dispose();
      r.dispose(); // idempotent
    }
  });

  test('returns a typed error on missing STL', async () => {
    const r = await analyzeStl(join(import.meta.dir, '..', 'fixtures', 'does-not-exist.stl'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('mesh_invalid');
    }
  });
});
