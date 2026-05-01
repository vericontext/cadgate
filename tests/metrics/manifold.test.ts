import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { analyzeStl, parseBinarySTL } from '../../src/metrics/manifold.ts';

const CUBE_STL = join(import.meta.dir, '..', 'fixtures', 'cube.stl');

describe('parseBinarySTL', () => {
  test('parses a 20mm cube into 8 unique vertices and 12 triangles', async () => {
    const bytes = await Bun.file(CUBE_STL).arrayBuffer();
    const mesh = parseBinarySTL(bytes);
    expect(mesh.triVerts.length).toBe(36); // 12 triangles × 3 indices
    expect(mesh.vertProperties.length).toBe(24); // 8 unique verts × 3 floats
  });
});

describe('analyzeStl', () => {
  test('20mm cube → volume=8000, surfaceArea=2400, watertight, bbox=[-10..10]', async () => {
    const m = await analyzeStl(CUBE_STL);
    expect(m.volume).toBeCloseTo(8000, 3);
    expect(m.surfaceArea).toBeCloseTo(2400, 3);
    expect(m.isWatertight).toBe(true);
    expect(m.triCount).toBe(12);
    expect(m.bbox.min).toEqual([-10, -10, -10]);
    expect(m.bbox.max).toEqual([10, 10, 10]);
  });
});
