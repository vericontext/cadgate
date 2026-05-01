import { classifyError, type GithubClient } from './client.ts';

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export interface OrphanUpload {
  /** Repo-relative path under the orphan branch (e.g. "abc123/file.py/head/front.png"). */
  path: string;
  /** Local absolute path to the PNG file. */
  source: string;
}

export interface PushRendersOptions {
  github: GithubClient;
  owner: string;
  repo: string;
  /** Branch name to push to. Created as orphan if it doesn't exist. */
  branch: string;
  /** Commit message. */
  message: string;
  files: readonly OrphanUpload[];
}

export interface PushRendersResult {
  /** SHA of the commit. Use to build raw.githubusercontent.com URLs. */
  commitSha: string;
  /** Per-file URL: `https://raw.githubusercontent.com/{owner}/{repo}/{commitSha}/{path}`. */
  urlFor: (path: string) => string;
}

/** Atomically push N files to an orphan branch as a single commit. */
export async function pushRendersToOrphanBranch(opts: PushRendersOptions): Promise<PushRendersResult> {
  const { github, owner, repo, branch, message, files } = opts;
  if (files.length === 0) throw new Error('pushRendersToOrphanBranch: no files');

  try {
    const parentSha = await getOrCreateBranchTip(github, owner, repo, branch);
    const blobs = await Promise.all(
      files.map(async (f) => {
        const data = await Bun.file(f.source).bytes();
        const blob = await github.rest.git.createBlob({
          owner,
          repo,
          content: Buffer.from(data).toString('base64'),
          encoding: 'base64',
        });
        return { path: f.path, sha: blob.data.sha };
      }),
    );

    const baseTreeSha = parentSha
      ? (await github.rest.git.getCommit({ owner, repo, commit_sha: parentSha })).data.tree.sha
      : EMPTY_TREE_SHA;

    const tree = await github.rest.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree: blobs.map((b) => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })),
    });

    const commit = await github.rest.git.createCommit({
      owner,
      repo,
      message,
      tree: tree.data.sha,
      parents: parentSha ? [parentSha] : [],
    });

    const refName = `heads/${branch}`;
    if (parentSha) {
      await github.rest.git.updateRef({ owner, repo, ref: refName, sha: commit.data.sha });
    } else {
      await github.rest.git.createRef({
        owner,
        repo,
        ref: `refs/${refName}`,
        sha: commit.data.sha,
      });
    }

    return {
      commitSha: commit.data.sha,
      urlFor: (path) => `https://raw.githubusercontent.com/${owner}/${repo}/${commit.data.sha}/${path}`,
    };
  } catch (err) {
    throw classifyError(err);
  }
}

async function getOrCreateBranchTip(
  github: GithubClient,
  owner: string,
  repo: string,
  branch: string,
): Promise<string | null> {
  try {
    const ref = await github.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    return ref.data.object.sha;
  } catch (err) {
    if ((err as { status?: number })?.status === 404) return null;
    throw err;
  }
}
