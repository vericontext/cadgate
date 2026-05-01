import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCadQueryDriver } from '../../src/drivers/cadquery-driver.ts';

const SKIP = Bun.env.CADGATE_SKIP_DOCKER === '1';

describe.skipIf(SKIP)('CadQueryDriver (integration: requires Docker)', () => {
  const driver = createCadQueryDriver();

  test('readyCheck succeeds when image is built', async () => {
    await driver.readyCheck();
  });

  test('runs a valid CadQuery script and produces an STL', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'cadgate-it-'));
    try {
      const result = await driver.run({
        source: 'import cadquery as cq\nresult = cq.Workplane("XY").box(10, 10, 10)\n',
        filename: 'box.py',
        timeoutMs: 60_000,
        workDir,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const stat = Bun.file(result.stlPath);
        expect(stat.size).toBeGreaterThan(80);
      }
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  test('reports syntax errors with kind="syntax"', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'cadgate-it-'));
    try {
      const result = await driver.run({
        source: 'import cadquery as cq\nresult = cq.Workplane("XY".box(',
        filename: 'broken.py',
        timeoutMs: 60_000,
        workDir,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('syntax');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
