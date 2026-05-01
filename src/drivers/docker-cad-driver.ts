import { join } from 'node:path';
import {
  type CadDriver,
  type CadLanguage,
  DriverReadyError,
  type RunErrorKind,
  type RunRequest,
  type RunResult,
} from './types.ts';

export interface DockerCadDriverOptions {
  language: CadLanguage;
  /** Docker image tag for the CAD sidecar. */
  image?: string;
  /** Forced platform for the container. arm64 hosts must run amd64 wheel. */
  platform?: string;
}

const DEFAULT_IMAGES: Record<CadLanguage, string> = {
  cadquery: 'kiyeonj21/cadquery-sidecar:0.2',
  build123d: 'kiyeonj21/build123d-sidecar:0.2',
  openscad: 'kiyeonj21/openscad-sidecar:0.2',
  kcl: 'kiyeonj21/kcl-sidecar:0.2',
};
const DEFAULT_PLATFORM = 'linux/amd64';

const NETWORK_HINT_PATTERNS = [/Network is unreachable/i, /Temporary failure in name resolution/i];

export function createDockerCadDriver(opts: DockerCadDriverOptions): CadDriver {
  const image = opts.image ?? DEFAULT_IMAGES[opts.language];
  const platform = opts.platform ?? DEFAULT_PLATFORM;
  const language = opts.language;
  const extensions = ['.py'] as const;
  const driverLabel = language === 'cadquery' ? 'CadQuery' : 'Build123d';

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
    try {
      await readyCheck();
    } catch (err) {
      if (err instanceof DriverReadyError) {
        return {
          ok: false,
          durationMs: performance.now() - started,
          error: {
            kind: err.kind,
            message: err.remediation ? `${err.message} ${err.remediation}` : err.message,
          },
        };
      }
      throw err;
    }
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

    const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe', signal });

    const [, stderr] = await Promise.all([
      Bun.readableStreamToText(proc.stdout),
      Bun.readableStreamToText(proc.stderr),
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
        message = `Runtime error during ${driverLabel} execution.${networkHint}`;
        break;
      case 4:
        kind = 'no_result';
        message = `Script did not produce a ${driverLabel} result object (assign \`result\` or call show_object()).`;
        break;
      default:
        kind = 'unknown';
        message = `${driverLabel} sidecar exited with code ${exitCode}.`;
    }

    return { ok: false, durationMs, error: { kind, message, stderr } };
  }

  return { language, extensions, readyCheck, run };
}
