import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedFiles, readFileAtRef, requireCleanWorktree } from './git.ts';
import { deltaFromSides } from './diff.ts';
import { pickDriverFor } from '../drivers/registry.ts';
import type { CadDriver } from '../drivers/types.ts';
import { analyzeStl } from '../metrics/manifold.ts';
import {
  type CheckReport,
  CheckReportSchema,
  type FileResult,
  type FileSide,
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
}

async function analyzeSide(
  driver: CadDriver,
  source: string | null,
  filename: string,
  workDir: string,
  timeoutMs: number,
): Promise<FileSide> {
  if (source === null) return { state: 'absent' };

  const sideDir = await mkdtemp(join(workDir, 'side-'));
  try {
    const result = await driver.run({ source, filename, timeoutMs, workDir: sideDir });
    if (!result.ok) {
      return {
        state: 'failed',
        error: { kind: result.error.kind, message: result.error.message },
      };
    }
    try {
      const metrics = await analyzeStl(result.stlPath);
      return { state: 'ok', metrics };
    } catch (err) {
      return {
        state: 'failed',
        error: {
          kind: 'mesh_invalid',
          message: err instanceof Error ? err.message : String(err),
        },
      };
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
      const driver = pickDriverFor(path, opts.drivers);
      if (!driver) {
        files.push({ status: 'skipped', path, reason: 'no driver for extension' });
        continue;
      }
      const fileDir = await mkdtemp(join(root, 'file-'));
      try {
        const [baseSource, headSource] = await Promise.all([
          readFileAtRef(opts.baseRef, path, opts.repoDir),
          readFileAtRef(opts.headRef, path, opts.repoDir),
        ]);

        const [base, head] = await Promise.all([
          analyzeSide(driver, baseSource, path, fileDir, opts.timeoutMs),
          analyzeSide(driver, headSource, path, fileDir, opts.timeoutMs),
        ]);

        files.push({
          status: 'analyzed',
          path,
          language: driver.language,
          base,
          head,
          delta: deltaFromSides(base, head),
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
