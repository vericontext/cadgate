import { defineCommand } from 'citty';
import { resolve } from 'node:path';
import { type CheckReport, CheckReportSchema } from '../../metrics/schema.ts';
import { createGithub, GithubError } from '../../github/client.ts';
import { renderMarkdown } from '../../github/markdown.ts';
import {
  type OrphanUpload,
  pushRendersToOrphanBranch,
} from '../../github/orphan-branch.ts';
import { postOrUpdateStickyComment } from '../../github/sticky-comment.ts';
import { detectOutputMode, formatError, type OutputMode } from '../output.ts';
import { type ErrorCode, EXIT, exitCodeForError } from '../exit-codes.ts';

const DEFAULT_RENDERS_NAMESPACE = 'cadgate-renders';

const postPrCommand = defineCommand({
  meta: {
    name: 'post-pr',
    description: 'Post or update a sticky CADGate comment on a GitHub PR.',
  },
  args: {
    report: {
      type: 'string',
      description: 'Path to a CheckReport JSON file. Reads stdin if omitted.',
    },
    owner: { type: 'string', description: 'GitHub repository owner.' },
    repo: { type: 'string', description: 'GitHub repository name.' },
    pr: { type: 'string', description: 'Pull request number.' },
    token: {
      type: 'string',
      description: 'GitHub token. Falls back to $GITHUB_TOKEN.',
    },
    'renders-namespace': {
      type: 'string',
      default: DEFAULT_RENDERS_NAMESPACE,
      description: 'Custom git ref namespace to push render PNGs to (kept outside refs/heads to skip the GitHub "branch" banner).',
    },
    'inline-images': {
      type: 'boolean',
      description: 'Embed PNGs as base64 data URLs (private-repo fallback).',
    },
  },
  async run({ args }) {
    const mode = detectOutputMode('json'); // post-pr is non-interactive; default JSON for errors

    const ownerArg = args.owner ?? envOwner();
    const repoArg = args.repo ?? envRepo();
    const prArg = args.pr ?? Bun.env.CADGATE_PR_NUMBER;
    const token = args.token ?? Bun.env.GITHUB_TOKEN;
    if (!ownerArg) fail('--owner missing (set GITHUB_REPOSITORY=owner/repo)', 'INVALID_ARGUMENT', mode);
    if (!repoArg) fail('--repo missing', 'INVALID_ARGUMENT', mode);
    if (!prArg) fail('--pr missing', 'INVALID_ARGUMENT', mode);
    if (!token) fail('--token / GITHUB_TOKEN missing', 'INVALID_ARGUMENT', mode);
    const pr = Number.parseInt(prArg, 10);
    if (!Number.isFinite(pr)) fail(`--pr must be an integer, got ${prArg}`, 'INVALID_ARGUMENT', mode);

    const reportText = args.report ? await Bun.file(resolve(args.report)).text() : await readStdin();
    let report: CheckReport;
    try {
      report = CheckReportSchema.parse(JSON.parse(reportText));
    } catch (err) {
      fail(`Invalid CheckReport JSON: ${err instanceof Error ? err.message : String(err)}`, 'INVALID_ARGUMENT', mode);
    }

    const github = createGithub({ token });

    const renderFiles = collectRenderUploads(report);

    let resolveImage: (path: string) => string;
    if (renderFiles.length === 0) {
      resolveImage = (path) => path;
    } else if (args['inline-images']) {
      const inlineMap = new Map<string, string>();
      for (const f of renderFiles) {
        const data = await Bun.file(f.source).bytes();
        inlineMap.set(f.source, `data:image/png;base64,${Buffer.from(data).toString('base64')}`);
      }
      resolveImage = (path) => inlineMap.get(path) ?? path;
    } else {
      try {
        const uploaded = await pushRendersToOrphanBranch({
          github,
          owner: ownerArg,
          repo: repoArg,
          refSubpath: `${args['renders-namespace']}/pr-${pr}`,
          message: `cadgate: PR #${pr} renders`,
          files: renderFiles,
        });
        const sourceToPath = new Map(renderFiles.map((f) => [f.source, f.path]));
        resolveImage = (absSource) => {
          const path = sourceToPath.get(absSource);
          return path ? uploaded.urlFor(path) : absSource;
        };
      } catch (err) {
        const ge = err instanceof GithubError ? err : null;
        const code: ErrorCode = ge?.kind === 'auth' ? 'GITHUB_AUTH' : 'GITHUB_API';
        const msg = err instanceof Error ? err.message : String(err);
        fail(`Render upload failed: ${msg}`, code, mode);
      }
    }

    const body = renderMarkdown(report, resolveImage);

    try {
      const result = await postOrUpdateStickyComment({
        github,
        owner: ownerArg,
        repo: repoArg,
        pr,
        body,
      });
      process.stdout.write(
        JSON.stringify({ ok: true, action: result.updated ? 'updated' : 'created', url: result.url }) +
          '\n',
      );
    } catch (err) {
      const ge = err instanceof GithubError ? err : null;
      const code: ErrorCode = ge?.kind === 'auth' ? 'GITHUB_AUTH' : 'GITHUB_API';
      const msg = err instanceof Error ? err.message : String(err);
      fail(`Comment post failed: ${msg}`, code, mode);
    }
  },
});

export const reportCommand = defineCommand({
  meta: { name: 'report', description: 'CADGate report distribution (PR comments).' },
  subCommands: { 'post-pr': postPrCommand },
});

function collectRenderUploads(report: CheckReport): OrphanUpload[] {
  const out: OrphanUpload[] = [];
  for (const file of report.files) {
    if (file.status !== 'analyzed') continue;
    for (const side of ['base', 'head'] as const) {
      const fs = file[side];
      if (fs.state !== 'ok' || !fs.renders) continue;
      const safeFile = file.path.replace(/[^a-zA-Z0-9._-]+/g, '_');
      for (const view of ['front', 'back', 'top', 'bottom', 'left', 'right'] as const) {
        out.push({
          source: fs.renders[view],
          path: `${report.head}/${safeFile}/${side}/${view}.png`,
        });
      }
    }
  }
  return out;
}

async function readStdin(): Promise<string> {
  return new Response(Bun.stdin.stream()).text();
}

function envOwner(): string | undefined {
  const repo = Bun.env.GITHUB_REPOSITORY;
  return repo?.split('/')[0];
}

function envRepo(): string | undefined {
  const repo = Bun.env.GITHUB_REPOSITORY;
  return repo?.split('/')[1];
}

function fail(message: string, code: ErrorCode, mode: OutputMode): never {
  process.stderr.write(formatError(message, mode, code) + '\n');
  process.exit(exitCodeForError(code));
}
