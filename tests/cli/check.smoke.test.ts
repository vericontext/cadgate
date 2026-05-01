import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { CheckReportSchema } from '../../src/metrics/schema.ts';

const SKIP = Bun.env.CADGATE_SKIP_DOCKER === '1';
const REPO = join(import.meta.dir, '..', '..');
const CLI = join(REPO, 'src', 'cli', 'index.ts');
const FIX = join(REPO, 'fixtures');

async function gitRepo(setup: (dir: string) => void): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'cadgate-cli-'));
  await $`git -C ${dir} init -q`.quiet();
  await $`git -C ${dir} config user.email test@test`.quiet();
  await $`git -C ${dir} config user.name test`.quiet();
  setup(dir);
  return dir;
}

describe.skipIf(SKIP)('cadgate check (smoke: requires Docker)', () => {
  test('reports volume delta for a base→head CadQuery commit pair', async () => {
    const dir = await gitRepo((d) => {
      copyFileSync(join(FIX, 'cube_base.py'), join(d, 'part.py'));
    });
    try {
      await $`git -C ${dir} add part.py`.quiet();
      await $`git -C ${dir} commit -q -m base`.quiet();
      copyFileSync(join(FIX, 'cube_head.py'), join(dir, 'part.py'));
      await $`git -C ${dir} commit -aqm head`.quiet();

      const proc = Bun.spawn(['bun', CLI, 'check', '--base', 'HEAD~1', '--head', 'HEAD', '--repo', dir, '--report', 'json'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const out = await new Response(proc.stdout).text();
      const code = await proc.exited;

      expect(code).toBe(0);
      const parsed = JSON.parse(out);
      const report = CheckReportSchema.parse(parsed);
      expect(report.summary.filesChanged).toBe(1);
      expect(report.summary.filesFailed).toBe(0);
      const file = report.files[0]!;
      expect(file.status).toBe('analyzed');
      if (file.status === 'analyzed' && file.delta.kind === 'changed') {
        expect(file.delta.volumeDeltaPct).toBeCloseTo(33.1, 0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  test('exits 4 with summary.filesFailed > 0 on a broken commit', async () => {
    const dir = await gitRepo((d) => {
      copyFileSync(join(FIX, 'cube_base.py'), join(d, 'part.py'));
    });
    try {
      await $`git -C ${dir} add part.py`.quiet();
      await $`git -C ${dir} commit -q -m base`.quiet();
      copyFileSync(join(FIX, 'broken.py'), join(dir, 'part.py'));
      await $`git -C ${dir} commit -aqm bad`.quiet();

      const proc = Bun.spawn(['bun', CLI, 'check', '--base', 'HEAD~1', '--head', 'HEAD', '--repo', dir, '--report', 'json'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const out = await new Response(proc.stdout).text();
      const code = await proc.exited;

      expect(code).toBe(4);
      const report = CheckReportSchema.parse(JSON.parse(out));
      expect(report.summary.filesFailed).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
