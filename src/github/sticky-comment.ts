import { classifyError, type GithubClient } from './client.ts';
import { STICKY_MARKER } from './markdown.ts';

export interface PostOrUpdateOptions {
  github: GithubClient;
  owner: string;
  repo: string;
  pr: number;
  body: string;
  /** Override marker to look up an existing comment. Defaults to STICKY_MARKER. */
  marker?: string;
}

export interface PostOrUpdateResult {
  commentId: number;
  url: string;
  updated: boolean;
}

export async function postOrUpdateStickyComment(opts: PostOrUpdateOptions): Promise<PostOrUpdateResult> {
  const marker = opts.marker ?? STICKY_MARKER;
  try {
    const existing = await findExistingComment(opts, marker);
    if (existing) {
      const updated = await opts.github.rest.issues.updateComment({
        owner: opts.owner,
        repo: opts.repo,
        comment_id: existing.id,
        body: opts.body,
      });
      return { commentId: updated.data.id, url: updated.data.html_url, updated: true };
    }
    const created = await opts.github.rest.issues.createComment({
      owner: opts.owner,
      repo: opts.repo,
      issue_number: opts.pr,
      body: opts.body,
    });
    return { commentId: created.data.id, url: created.data.html_url, updated: false };
  } catch (err) {
    throw classifyError(err);
  }
}

interface ExistingComment {
  id: number;
}

async function findExistingComment(
  opts: PostOrUpdateOptions,
  marker: string,
): Promise<ExistingComment | null> {
  const iter = opts.github.rest.paginate.iterator(
    opts.github.rest.issues.listComments,
    { owner: opts.owner, repo: opts.repo, issue_number: opts.pr, per_page: 100 },
  );
  for await (const page of iter) {
    for (const comment of page.data) {
      if (comment.body?.includes(marker)) return { id: comment.id };
    }
  }
  return null;
}
