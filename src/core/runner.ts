import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedFiles, readFileAtRef, requireCleanWorktree } from './git.ts';
import { deltaFromSides } from './diff.ts';
import { pickDriverFor } from '../drivers/registry.ts';
import type { CadDriver } from '../drivers/types.ts';
import { type DfmRules, evaluateDfmRules, type RuleViolation } from '../metrics/dfm.ts';
import { analyzeStl } from '../metrics/manifold.ts';
import type { Metrics, MetricsDelta } from './types.ts';
import type { Renderer } from '../render/engine.ts';
import type { RenderPaths } from '../render/types.ts';
import {
  type CheckReport,
  CheckReportSchema,
  type FileResult,
  type FileSide,
  type Delta,
} from '../metrics/schema.ts';

export interface RunCheckOptions {
  baseRef: string;
  headRef: string;
  repoDir: string;
  drivers: readonly CadDriver[];
  /** Per-file driver timeout in ms. */
  timeoutMs: number;
  /** Allow uncommitted edits in worktree. */
  allowDirty?: boolean;
  /** Override workDir root (otherwise mkdtemp under tmpdir()). */
  workDirRoot?: string;
  /** Validated DFM rules (caller does YAML loading + zod parsing). */
  rules?: DfmRules;
  /** Already-initialized renderer; if absent, no renders are produced. */
  renderer?: Renderer;
  /** Override directory for persisted renders. Default: under workDir (cleaned up). */
  rendersOut?: string;
}

function evaluateForFile(
  base: FileSide,
  head: FileSide,
  delta: Delta,
  rules: DfmRules | undefined,
): RuleViolation[] {
  if (!rules || head.state !== 'ok') return [];
  const baseMetrics: Metrics | null = base.state === 'ok' ? base.metrics : null;
  const fileDelta: MetricsDelta | null = delta.kind === 'changed' ? delta : null;
  return evaluateDfmRules({ baseMetrics, headMetrics: head.metrics, delta: fileDelta, rules });
}

async function analyzeSide(
  driver: CadDriver,
  source: string | null,
  filename: string,
  workDir: string,
  timeoutMs: number,
  rendersDir?: string,
  renderer?: Renderer,
): Promise<FileSide> {
  if (source === null) return { state: 'absent' };

  const sideDir = await mkdtemp(join(workDir, 'side-'));
  try {
    const runResult = await driver.run({ source, filename, timeoutMs, workDir: sideDir });
    if (!runResult.ok) {
      return {
        state: 'failed',
        error: { kind: runResult.error.kind, message: runResult.error.message },
      };
    }
    const meshResult = await analyzeStl(runResult.stlPath);
    if (!meshResult.ok) {
      return { state: 'failed', error: meshResult.error };
    }
    try {
      let renders: RenderPaths | undefined;
      if (renderer && rendersDir) {
        renders = await renderer.renderViews(
          meshResult.mesh,
          meshResult.metrics.minWallHotspots,
          rendersDir,
        );
      }
      return { state: 'ok', metrics: meshResult.metrics, renders };
    } finally {
      meshResult.dispose();
    }
  } finally {
    await rm(sideDir, { recursive: true, force: true });
  }
}

export async function runCheck(opts: RunCheckOptions): Promise<CheckReport> {
  await requireCleanWorktree(opts.repoDir, opts.allowDirty ?? false);

  const paths = await changedFiles(opts.baseRef, opts.headRef, opts.repoDir);
  const root = opts.workDirRoot ?? (await mkdtemp(join(tmpdir(), 'cadgate-')));

  const files: FileResult[] = [];
  try {
    for (const path of paths) {
      const [baseSource, headSource] = await Promise.all([
        readFileAtRef(opts.baseRef, path, opts.repoDir),
        readFileAtRef(opts.headRef, path, opts.repoDir),
      ]);

      const driver = pickDriverFor(path, opts.drivers, headSource ?? baseSource);
      if (!driver) {
        files.push({ status: 'skipped', path, reason: 'no driver for extension' });
        continue;
      }
      const fileDir = await mkdtemp(join(root, 'file-'));
      try {
        const safeName = path.replace(/[^a-zA-Z0-9._-]+/g, '_');
        const baseRenders =
          opts.renderer && opts.rendersOut ? join(opts.rendersOut, safeName, 'base') : undefined;
        const headRenders =
          opts.renderer && opts.rendersOut ? join(opts.rendersOut, safeName, 'head') : undefined;

        const [base, head] = await Promise.all([
          analyzeSide(driver, baseSource, path, fileDir, opts.timeoutMs, baseRenders, opts.renderer),
          analyzeSide(driver, headSource, path, fileDir, opts.timeoutMs, headRenders, opts.renderer),
        ]);

        const delta = deltaFromSides(base, head);
        files.push({
          status: 'analyzed',
          path,
          language: driver.language,
          base,
          head,
          delta,
          dfmViolations: evaluateForFile(base, head, delta, opts.rules),
        });
      } finally {
        await rm(fileDir, { recursive: true, force: true });
      }
    }
  } finally {
    if (!opts.workDirRoot) {
      await rm(root, { recursive: true, force: true });
    }
  }

  const summary = {
    filesChanged: files.length,
    filesFailed: files.filter(
      (f) =>
        f.status === 'analyzed' && (f.base.state === 'failed' || f.head.state === 'failed'),
    ).length,
    filesSkipped: files.filter((f) => f.status === 'skipped').length,
    filesWithViolations: files.filter(
      (f) =>
        f.status === 'analyzed' && f.dfmViolations.some((v) => v.severity === 'error'),
    ).length,
  };

  const report: CheckReport = {
    schemaVersion: 'cadgate.check.v1',
    base: opts.baseRef,
    head: opts.headRef,
    files,
    summary,
  };
  return CheckReportSchema.parse(report);
}
