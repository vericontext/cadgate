import { defineCommand } from 'citty';
import { resolve } from 'node:path';
import { runCheck } from '../../core/runner.ts';
import { GitError } from '../../core/git.ts';
import { createCadQueryDriver } from '../../drivers/cadquery-driver.ts';
import { DriverReadyError } from '../../drivers/types.ts';
import { detectOutputMode, formatError, formatReport, type OutputMode } from '../output.ts';
import { type ErrorCode, EXIT, exitCodeForError } from '../exit-codes.ts';

export const checkCommand = defineCommand({
  meta: {
    name: 'check',
    description: 'Validate CAD-as-code changes between two git refs.',
  },
  args: {
    base: {
      type: 'string',
      required: true,
      description: 'Base git ref (the merge target).',
    },
    head: {
      type: 'string',
      default: 'HEAD',
      description: 'Head git ref (the PR branch tip).',
    },
    repo: {
      type: 'string',
      default: '.',
      description: 'Path to the git repository.',
    },
    report: {
      type: 'string',
      default: 'auto',
      description: 'Output format: text | json | auto (TTY → text, pipe → json).',
    },
    timeout: {
      type: 'string',
      default: '60000',
      description: 'Per-file driver timeout in ms.',
    },
    'allow-dirty': {
      type: 'boolean',
      description: 'Allow uncommitted edits in the worktree.',
    },
  },
  async run({ args }) {
    const mode = detectOutputMode(args.report);
    const repoDir = resolve(args.repo);
    const timeoutMs = Number.parseInt(args.timeout, 10);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      fail('--timeout must be a positive integer (ms)', 'INVALID_ARGUMENT', mode);
    }

    const driver = createCadQueryDriver();
    try {
      await driver.readyCheck();
    } catch (err) {
      if (err instanceof DriverReadyError) {
        const code: ErrorCode = err.kind === 'image_missing' ? 'IMAGE_MISSING' : 'DOCKER_UNAVAILABLE';
        fail(`${err.message}${err.remediation ? `\n  ${err.remediation}` : ''}`, code, mode);
      }
      throw err;
    }

    let report;
    try {
      report = await runCheck({
        baseRef: args.base,
        headRef: args.head,
        repoDir,
        drivers: [driver],
        timeoutMs,
        allowDirty: args['allow-dirty'],
      });
    } catch (err) {
      if (err instanceof GitError) {
        fail(err.message + (err.remediation ? `\n  ${err.remediation}` : ''), 'GIT_ERROR', mode);
      }
      throw err;
    }

    process.stdout.write(formatReport(report, mode) + '\n');
    if (report.summary.filesFailed > 0) {
      process.exit(EXIT.CHECK_FAILED);
    }
  },
});

function fail(message: string, code: ErrorCode, mode: OutputMode): never {
  process.stderr.write(formatError(message, mode, code) + '\n');
  process.exit(exitCodeForError(code));
}
