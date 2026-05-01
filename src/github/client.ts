import { Octokit } from '@octokit/rest';
import { graphql as graphqlBase } from '@octokit/graphql';

export type GithubErrorKind = 'auth' | 'not-found' | 'rate-limit' | 'unknown';

export class GithubError extends Error {
  constructor(
    public readonly kind: GithubErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'GithubError';
  }
}

export interface GithubClient {
  rest: Octokit;
  graphql: typeof graphqlBase;
}

export function createGithub({ token }: { token: string }): GithubClient {
  if (!token) throw new GithubError('auth', 'Missing GitHub token.');
  const rest = new Octokit({ auth: token });
  const graphql = graphqlBase.defaults({ headers: { authorization: `token ${token}` } });
  return { rest, graphql };
}

/** Map Octokit thrown errors to a typed GithubError so callers can branch. */
export function classifyError(err: unknown): GithubError {
  if (err instanceof GithubError) return err;
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) {
    return new GithubError(
      'auth',
      `GitHub auth failed (${status}). Check that GITHUB_TOKEN has repo + pull-request permissions.`,
    );
  }
  if (status === 404) return new GithubError('not-found', `GitHub resource not found.`);
  if (status === 429) return new GithubError('rate-limit', `GitHub API rate-limited.`);
  const msg = err instanceof Error ? err.message : String(err);
  return new GithubError('unknown', msg);
}
