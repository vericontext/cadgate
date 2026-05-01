import { defineCommand } from 'citty';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fromError } from 'zod-validation-error';
import { runCheck } from '../../core/runner.ts';
import { GitError } from '../../core/git.ts';
import { createCadQueryDriver } from '../../drivers/cadquery-driver.ts';
import { createBuild123dDriver } from '../../drivers/build123d-driver.ts';
import { type DfmRules, DfmRulesSchema } from '../../metrics/dfm.ts';
import { detectOutputMode, formatError, formatReport, type OutputMode } from '../output.ts';
import { type ErrorCode, EXIT, exitCodeForError } from '../exit-codes.ts';

async function loadRules(
  repoDir: string,
  explicitPath: string | undefined,
): Promise<{ ok: true; rules: DfmRules | null } | { ok: false; error: string }> {
  let rulesPath = explicitPath ? resolve(explicitPath) : null;
  if (!rulesPath) {
    let dir = repoDir;
    while (true) {
      const candidate = resolve(dir, '.cadgate', 'rules.yaml');
      if (existsSync(candidate)) {
        rulesPath = candidate;
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  if (!rulesPath) return { ok: true, rules: null };
  try {
    const text = await Bun.file(rulesPath).text();
    const parsed = Bun.YAML.parse(text);
    const result = DfmRulesSchema.safeParse(parsed);
    if (!result.success) {
      return {
        ok: false,
        error: `${rulesPath}\n${fromError(result.error).toString()}`,
      };
    }
    return { ok: true, rules: result.data };
  } catch (err) {
    return {
      ok: false,
      error: `${rulesPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

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
    rules: {
      type: 'string',
      description:
        'Path to DFM rules YAML. Defaults to .cadgate/rules.yaml searched up from --repo.',
    },
  },
  async run({ args }) {
    const mode = detectOutputMode(args.report);
    const repoDir = resolve(args.repo);
    const timeoutMs = Number.parseInt(args.timeout, 10);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      fail('--timeout must be a positive integer (ms)', 'INVALID_ARGUMENT', mode);
    }

    const drivers = [createCadQueryDriver(), createBuild123dDriver()];

    const rulesResult = await loadRules(repoDir, args.rules);
    if (!rulesResult.ok) {
      fail(`Invalid rules YAML: ${rulesResult.error}`, 'INVALID_ARGUMENT', mode);
    }

    let report;
    try {
      report = await runCheck({
        baseRef: args.base,
        headRef: args.head,
        repoDir,
        drivers,
        timeoutMs,
        allowDirty: args['allow-dirty'],
        rules: rulesResult.rules ?? undefined,
      });
    } catch (err) {
      if (err instanceof GitError) {
        fail(err.message + (err.remediation ? `\n  ${err.remediation}` : ''), 'GIT_ERROR', mode);
      }
      throw err;
    }

    process.stdout.write(formatReport(report, mode) + '\n');
    if (report.summary.filesWithViolations > 0) {
      process.exit(EXIT.RULE_VIOLATION);
    }
    if (report.summary.filesFailed > 0) {
      process.exit(EXIT.CHECK_FAILED);
    }
  },
});

function fail(message: string, code: ErrorCode, mode: OutputMode): never {
  process.stderr.write(formatError(message, mode, code) + '\n');
  process.exit(exitCodeForError(code));
}
