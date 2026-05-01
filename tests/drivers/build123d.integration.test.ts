import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuild123dDriver } from '../../src/drivers/build123d-driver.ts';

const SKIP = Bun.env.CADGATE_SKIP_DOCKER === '1';

describe.skipIf(SKIP)('Build123dDriver (integration: requires Docker)', () => {
  const driver = createBuild123dDriver();

  test('readyCheck succeeds when image is built', async () => {
    await driver.readyCheck();
  });

  test(
    'runs a valid Build123d script and produces an STL',
    async () => {
      const workDir = mkdtempSync(join(tmpdir(), 'cadgate-b123d-'));
      try {
        const result = await driver.run({
          source: 'from build123d import Box\nresult = Box(10, 10, 10)\n',
          filename: 'box.py',
          timeoutMs: 60_000,
          workDir,
        });
        expect(result.ok).toBe(true);
        if (result.ok) expect(Bun.file(result.stlPath).size).toBeGreaterThan(80);
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
