#!/usr/bin/env bun
/**
 * Phase 0 PoC — proves the full pipeline:
 *   Bun → Docker (CadQuery sidecar) → STL → manifold-3d (WASM) → metrics → diff JSON
 *
 * Run: bun run poc
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCadQueryDriver } from '../src/drivers/cadquery-driver.ts';
import { analyzeStl } from '../src/metrics/manifold.ts';
import type { Metrics } from '../src/core/types.ts';

const driver = createCadQueryDriver();
await driver.readyCheck();

async function metricsFor(label: string, fixturePath: string): Promise<Metrics> {
  const source = await Bun.file(fixturePath).text();
  const workDir = mkdtempSync(join(tmpdir(), `cadgate-poc-${label}-`));
  try {
    const result = await driver.run({
      source,
      filename: fixturePath,
      timeoutMs: 60_000,
      workDir,
    });
    if (!result.ok) {
      throw new Error(
        `[${label}] driver failed (kind=${result.error.kind}): ${result.error.message}\n${result.error.stderr ?? ''}`,
      );
    }
    return await analyzeStl(result.stlPath);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function resolveFixture(rel: string | undefined, fallback: string): string {
  const target = rel ?? fallback;
  if (target.startsWith('/')) return target;
  return join(process.cwd(), target);
}

const baseFixture = resolveFixture(process.argv[2], 'fixtures/cube_base.py');
const headFixture = resolveFixture(process.argv[3], 'fixtures/cube_head.py');

const [base, head] = await Promise.all([
  metricsFor('base', baseFixture),
  metricsFor('head', headFixture),
]);

const delta = {
  volumeDelta: head.volume - base.volume,
  volumeDeltaPct: ((head.volume - base.volume) / base.volume) * 100,
  surfaceAreaDelta: head.surfaceArea - base.surfaceArea,
  triCountDelta: head.triCount - base.triCount,
  bboxChanged:
    base.bbox.min.toString() !== head.bbox.min.toString() ||
    base.bbox.max.toString() !== head.bbox.max.toString(),
  watertightnessChanged: base.isWatertight !== head.isWatertight,
};

console.log(JSON.stringify({ base, head, delta }, null, 2));
