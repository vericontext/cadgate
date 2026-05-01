import { $ } from 'bun';

export class GitError extends Error {
  constructor(
    message: string,
    public readonly remediation?: string,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

/**
 * Files changed between base and head (three-dot diff = changes since merge-base,
 * which matches GitHub PR semantics).
 */
export async function changedFiles(
  baseRef: string,
  headRef: string,
  repoDir: string,
): Promise<string[]> {
  const cmd = $`git -C ${repoDir} diff --name-only ${`${baseRef}...${headRef}`}`.quiet();
  const out = await cmd.nothrow();
  if (out.exitCode !== 0) {
    throw new GitError(
      `git diff failed (exit ${out.exitCode}): ${out.stderr.toString().trim()}`,
      `Verify ${baseRef} and ${headRef} are valid refs in ${repoDir}.`,
    );
  }
  return out.stdout
    .toString()
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Read a file at a specific git ref. Returns null if the path doesn't exist
 * at that ref (i.e. created/deleted between base and head).
 */
export async function readFileAtRef(
  ref: string,
  path: string,
  repoDir: string,
): Promise<string | null> {
  const out = await $`git -C ${repoDir} show ${`${ref}:${path}`}`.quiet().nothrow();
  if (out.exitCode === 0) return out.stdout.toString();
  const stderr = out.stderr.toString();
  if (/exists on disk, but not in/.test(stderr) || /does not exist/.test(stderr)) {
    return null;
  }
  throw new GitError(
    `git show ${ref}:${path} failed: ${stderr.trim()}`,
    `Path may be invalid at ref ${ref}.`,
  );
}

/**
 * Reject when the worktree has uncommitted edits, unless allowDirty is true.
 * Important so `--head HEAD` doesn't silently use stale committed source.
 */
export async function requireCleanWorktree(repoDir: string, allowDirty: boolean): Promise<void> {
  if (allowDirty) return;
  const out = await $`git -C ${repoDir} status --porcelain`.quiet().nothrow();
  if (out.exitCode !== 0) {
    throw new GitError(`git status failed: ${out.stderr.toString().trim()}`);
  }
  const dirty = out.stdout.toString().trim();
  if (dirty.length > 0) {
    throw new GitError(
      'Working tree has uncommitted changes. Refusing to run with stale base/head.',
      'Commit or stash changes, or pass --allow-dirty.',
    );
  }
}
