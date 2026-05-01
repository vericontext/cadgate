import { z } from 'zod';

export type CadLanguage = 'cadquery' | 'build123d' | 'openscad' | 'kcl';

export interface RunRequest {
  source: string;
  filename: string;
  timeoutMs: number;
  workDir: string;
  signal?: AbortSignal;
}

export const RunErrorKindSchema = z.enum([
  'timeout',
  'syntax',
  'runtime',
  'no_result',
  'docker_missing',
  'image_missing',
  'mesh_invalid',
  'unknown',
]);
export type RunErrorKind = z.infer<typeof RunErrorKindSchema>;

export interface RunError {
  kind: RunErrorKind;
  message: string;
  stderr?: string;
}

export type RunResult =
  | { ok: true; stlPath: string; durationMs: number; stderr?: string }
  | { ok: false; error: RunError; durationMs: number };

export interface CadDriver {
  readonly language: CadLanguage;
  readonly extensions: readonly string[];
  /** Cheap repeated calls; throws a typed error if the driver is unusable. */
  readyCheck(): Promise<void>;
  run(req: RunRequest): Promise<RunResult>;
}

export class DriverReadyError extends Error {
  constructor(
    public readonly kind: 'docker_missing' | 'image_missing' | 'unknown',
    message: string,
    public readonly remediation?: string,
  ) {
    super(message);
    this.name = 'DriverReadyError';
  }
}
