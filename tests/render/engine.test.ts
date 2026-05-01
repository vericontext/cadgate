import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectChromium, Renderer } from '../../src/render/engine.ts';
import { analyzeStl } from '../../src/metrics/manifold.ts';

const SKIP = Bun.env.CADGATE_SKIP_CHROMIUM === '1' || detectChromium() === null;
const CUBE_STL = join(import.meta.dir, '..', 'fixtures', 'cube.stl');

describe.skipIf(SKIP)('Renderer (integration: requires Chromium)', () => {
  const renderer = new Renderer();
  let workDir: string;

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'cadgate-render-test-'));
    const init = await renderer.init();
    if (!init.ok) throw new Error(`Renderer init failed: ${init.reason}`);
  }, 60_000);

  afterAll(async () => {
    await renderer.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  test(
    'produces 6 non-trivial PNGs for the 20mm cube',
    async () => {
      const m = await analyzeStl(CUBE_STL);
      expect(m.ok).toBe(true);
      if (!m.ok) return;
      try {
        const outDir = join(workDir, 'cube');
        const paths = await renderer.renderViews(m.mesh, m.metrics.minWallHotspots, outDir);
        const written = readdirSync(outDir).sort();
        expect(written).toEqual(['back.png', 'bottom.png', 'front.png', 'left.png', 'right.png', 'top.png']);
        for (const view of ['front', 'back', 'top', 'bottom', 'left', 'right'] as const) {
          const size = statSync(paths[view]).size;
          expect(size).toBeGreaterThan(2_000);
        }
      } finally {
        m.dispose();
      }
    },
    60_000,
  );
});
