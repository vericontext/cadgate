import { join } from 'node:path';
import {
  type CadDriver,
  type CadLanguage,
  DriverReadyError,
  type RunErrorKind,
  type RunRequest,
  type RunResult,
} from './types.ts';

export interface CadQueryDriverOptions {
  /** Docker image tag for the CadQuery sidecar. */
  image?: string;
  /** Forced platform for the container. arm64 hosts must run amd64 wheel. */
  platform?: string;
}

const DEFAULT_IMAGE = 'cadgate/cadquery-sidecar:0.1';
const DEFAULT_PLATFORM = 'linux/amd64';

const NETWORK_HINT_PATTERNS = [/Network is unreachable/i, /Temporary failure in name resolution/i];

export function createCadQueryDriver(opts: CadQueryDriverOptions = {}): CadDriver {
  const image = opts.image ?? DEFAULT_IMAGE;
  const platform = opts.platform ?? DEFAULT_PLATFORM;

  const language: CadLanguage = 'cadquery';
  const extensions = ['.py'] as const;

  let readyResolved = false;

  async function readyCheck(): Promise<void> {
    if (readyResolved) return;

    const dockerCheck = Bun.spawnSync(['docker', 'version', '--format', '{{.Server.Version}}'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (dockerCheck.exitCode !== 0) {
      throw new DriverReadyError(
        'docker_missing',
        'Docker daemon is not reachable.',
        'Start Docker Desktop, then re-run.',
      );
    }

    const imageCheck = Bun.spawnSync(['docker', 'image', 'inspect', image], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (imageCheck.exitCode !== 0) {
      throw new DriverReadyError(
        'image_missing',
        `Docker image ${image} is not built.`,
        'Run `bun run build:sidecar`.',
      );
    }

    readyResolved = true;
  }

  async function run(req: RunRequest): Promise<RunResult> {
    const started = performance.now();
    const scriptPath = join(req.workDir, 'script.py');
    const stlPath = join(req.workDir, 'out.stl');

    await Bun.write(scriptPath, req.source);

    const args = [
      'docker',
      'run',
      '--rm',
      `--platform=${platform}`,
      '--network=none',
      '-v',
      `${req.workDir}:/work`,
      image,
      '/work/script.py',
      '/work/out.stl',
    ];

    const timeoutSignal = AbortSignal.timeout(req.timeoutMs);
    const signal = req.signal ? AbortSignal.any([timeoutSignal, req.signal]) : timeoutSignal;

    const proc = Bun.spawn(args, {
      stdout: 'pipe',
      stderr: 'pipe',
      signal,
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    const durationMs = performance.now() - started;

    if (timeoutSignal.aborted) {
      return {
        ok: false,
        durationMs,
        error: { kind: 'timeout', message: `Driver timed out after ${req.timeoutMs}ms`, stderr },
      };
    }

    if (exitCode === 0) {
      return { ok: true, stlPath, durationMs, stderr: stderr || undefined };
    }

    const networkHint = NETWORK_HINT_PATTERNS.some((p) => p.test(stderr))
      ? ' (CADGate runs CAD code with --network=none for isolation. Pre-fetch external assets before commit.)'
      : '';

    let kind: RunErrorKind;
    let message: string;
    switch (exitCode) {
      case 2:
        kind = 'syntax';
        message = 'Script has a Python syntax error.';
        break;
      case 3:
        kind = 'runtime';
        message = `Runtime error during CadQuery execution.${networkHint}`;
        break;
      case 4:
        kind = 'no_result';
        message = 'Script did not assign a `result` Workplane / Assembly / Shape.';
        break;
      default:
        kind = 'unknown';
        message = `CadQuery sidecar exited with code ${exitCode}.`;
    }

    return {
      ok: false,
      durationMs,
      error: { kind, message, stderr },
    };
  }

  return { language, extensions, readyCheck, run };
}
