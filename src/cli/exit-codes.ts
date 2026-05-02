/**
 * Exit codes for CI agents and humans. The set is intentionally small —
 * specific failure modes are conveyed through the JSON `error.code` field.
 */
export const EXIT = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  INVALID_ARGS: 2,
  DOCKER_UNAVAILABLE: 3,
  CHECK_FAILED: 4,
  RULE_VIOLATION: 5,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export type ErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNKNOWN_COMMAND'
  | 'DOCKER_UNAVAILABLE'
  | 'IMAGE_MISSING'
  | 'DRIVER_TIMEOUT'
  | 'DRIVER_RUNTIME'
  | 'MESH_INVALID'
  | 'GIT_ERROR'
  | 'RULE_VIOLATION'
  | 'GITHUB_AUTH'
  | 'GITHUB_API'
  | 'JUDGE_AUTH'
  | 'JUDGE_API'
  | 'INTERNAL';

export function exitCodeForError(code: ErrorCode): ExitCode {
  switch (code) {
    case 'INVALID_ARGUMENT':
    case 'UNKNOWN_COMMAND':
      return EXIT.INVALID_ARGS;
    case 'DOCKER_UNAVAILABLE':
    case 'IMAGE_MISSING':
      return EXIT.DOCKER_UNAVAILABLE;
    case 'RULE_VIOLATION':
      return EXIT.RULE_VIOLATION;
    case 'DRIVER_TIMEOUT':
    case 'DRIVER_RUNTIME':
    case 'MESH_INVALID':
    case 'GIT_ERROR':
    case 'GITHUB_AUTH':
    case 'GITHUB_API':
    case 'JUDGE_AUTH':
    case 'JUDGE_API':
    case 'INTERNAL':
      return EXIT.GENERAL_ERROR;
  }
}
