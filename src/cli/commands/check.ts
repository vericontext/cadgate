import { defineCommand } from 'citty';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fromError } from 'zod-validation-error';
import { runCheck } from '../../core/runner.ts';
import { GitError } from '../../core/git.ts';
import { createCadQueryDriver } from '../../drivers/cadquery-driver.ts';
import { createBuild123dDriver } from '../../drivers/build123d-driver.ts';
import { isJudgeName, pickJudge } from '../../judges/registry.ts';
import type { JudgeDriver } from '../../judges/types.ts';
import { type DfmRules, DfmRulesSchema } from '../../metrics/dfm.ts';
import { Renderer, detectChromium } from '../../render/engine.ts';
import { logger } from '../logger.ts';
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
    render: {
      type: 'string',
      default: 'auto',
      description: '6-view PNG rendering: true | false | auto (auto = detect Chromium).',
    },
    'render-out': {
      type: 'string',
      description: 'Persist rendered PNGs to this directory (otherwise tmp + cleaned up).',
    },
    judge: {
      type: 'string',
      default: 'none',
      description: 'LLM judge: none | opus | sonnet. Opt-in (uses ANTHROPIC_API_KEY).',
    },
    'judge-model': {
      type: 'string',
      description: 'Override the judge model id (e.g. claude-opus-4-7-1m).',
    },
    'pr-description': {
      type: 'string',
      description: 'PR description text passed to the judge.',
    },
    'pr-description-file': {
      type: 'string',
      description: 'Path to a file containing the PR description (alt to --pr-description).',
    },
    'anthropic-api-key': {
      type: 'string',
      description: 'Anthropic API key (otherwise read from ANTHROPIC_API_KEY env).',
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

    let judge: JudgeDriver | undefined;
    let prDescription: string | undefined;
    if (args.judge && args.judge !== 'none') {
      if (!isJudgeName(args.judge)) {
        fail(
          `--judge must be one of: none, opus, sonnet (got "${args.judge}")`,
          'INVALID_ARGUMENT',
          mode,
        );
      }
      const apiKey = args['anthropic-api-key'] ?? Bun.env.ANTHROPIC_API_KEY;
      const picked = pickJudge(args.judge, { apiKey, model: args['judge-model'] });
      if (!picked.ok) {
        fail(picked.reason, 'JUDGE_AUTH', mode);
      }
      judge = picked.driver;
      if (args['pr-description-file']) {
        try {
          prDescription = await Bun.file(resolve(args['pr-description-file'])).text();
        } catch (err) {
          fail(
            `Failed to read --pr-description-file: ${err instanceof Error ? err.message : String(err)}`,
            'INVALID_ARGUMENT',
            mode,
          );
        }
      } else if (args['pr-description']) {
        prDescription = args['pr-description'];
      }
    }

    const renderMode = args.render;
    const wantsRender =
      renderMode === 'true' || (renderMode === 'auto' && detectChromium() !== null);
    let renderer: Renderer | undefined;
    if (wantsRender) {
      const r = new Renderer();
      const init = await r.init({ noSandbox: Bun.env.CI === 'true' });
      if (init.ok) {
        renderer = r;
      } else {
        if (renderMode === 'true') {
          fail(`Renderer init failed: ${init.reason}${init.message ? ` — ${init.message}` : ''}`, 'INTERNAL', mode);
        }
        logger.warn(`rendering disabled (${init.reason})`);
      }
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
        renderer,
        rendersOut: args['render-out'] ? resolve(args['render-out']) : undefined,
        judge,
        prDescription,
        logger,
      });
    } catch (err) {
      if (err instanceof GitError) {
        fail(err.message + (err.remediation ? `\n  ${err.remediation}` : ''), 'GIT_ERROR', mode);
      }
      throw err;
    }

    if (renderer) await renderer.close();

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
