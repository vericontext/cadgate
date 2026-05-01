import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import type { CadDriver, RunErrorKind } from '../../drivers/types.ts';
import { pickDriverFor } from '../../drivers/registry.ts';
import { analyzeStl, type ParsedMesh } from '../../metrics/manifold.ts';
import type { ManifoldInstance } from '../../metrics/manifold.ts';
import type { Metrics } from '../../core/types.ts';
import type { McpState } from '../state.ts';
import type { Language } from '../types.ts';

export type McpErrorCode =
  | 'NO_DRIVER'
  | 'DRIVER_TIMEOUT'
  | 'SYNTAX_ERROR'
  | 'RUNTIME_ERROR'
  | 'NO_RESULT'
  | 'DOCKER_UNAVAILABLE'
  | 'DOCKER_IMAGE_MISSING'
  | 'MESH_INVALID'
  | 'CHROMIUM_UNAVAILABLE'
  | 'INTERNAL';

export interface McpError {
  code: McpErrorCode;
  message: string;
}

export type McpToolResult<T> = { ok: true; data: T } | { ok: false; error: McpError };

const RUN_KIND_TO_MCP: Record<RunErrorKind, McpErrorCode> = {
  timeout: 'DRIVER_TIMEOUT',
  syntax: 'SYNTAX_ERROR',
  runtime: 'RUNTIME_ERROR',
  no_result: 'NO_RESULT',
  docker_missing: 'DOCKER_UNAVAILABLE',
  image_missing: 'DOCKER_IMAGE_MISSING',
  mesh_invalid: 'MESH_INVALID',
  unknown: 'INTERNAL',
};

export function mapRunError(kind: RunErrorKind, message: string): McpError {
  return { code: RUN_KIND_TO_MCP[kind], message };
}

function chooseDriver(
  drivers: readonly CadDriver[],
  language: Language | undefined,
  source: string,
): CadDriver | null {
  if (language) {
    return drivers.find((d) => d.language === language) ?? null;
  }
  return pickDriverFor('src.py', drivers, source);
}

export interface SourceMetricsResult {
  metrics: Metrics;
  mesh: ParsedMesh;
  manifold: ManifoldInstance;
  dispose: () => void;
  /** Per-call workdir; safe to write extra artifacts (e.g. renders) under it. */
  callDir: string;
}

export async function runSourceToMetrics(
  state: McpState,
  args: { source: string; language?: Language; timeoutMs: number },
): Promise<McpToolResult<SourceMetricsResult>> {
  const driver = chooseDriver(state.drivers(), args.language, args.source);
  if (!driver) {
    return {
      ok: false,
      error: {
        code: 'NO_DRIVER',
        message:
          'Could not detect cadquery vs build123d. Pass `language` explicitly or include `import cadquery` / `import build123d`.',
      },
    };
  }

  const callDir = await state.callDir();
  const sideDir = await mkdtemp(join(callDir, 'side-'));

  const runResult = await driver.run({
    source: args.source,
    filename: 'src.py',
    timeoutMs: args.timeoutMs,
    workDir: sideDir,
  });
  if (!runResult.ok) {
    return { ok: false, error: mapRunError(runResult.error.kind, runResult.error.message) };
  }

  const meshResult = await analyzeStl(runResult.stlPath);
  if (!meshResult.ok) {
    return { ok: false, error: mapRunError(meshResult.error.kind, meshResult.error.message) };
  }

  return {
    ok: true,
    data: {
      metrics: meshResult.metrics,
      mesh: meshResult.mesh,
      manifold: meshResult.manifold,
      dispose: meshResult.dispose,
      callDir,
    },
  };
}
