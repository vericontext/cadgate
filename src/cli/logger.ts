/**
 * Tiny stderr logger. Stdout is reserved for report payloads — never log there.
 *
 * Levels: error / warn / info / debug. Set the threshold via CADGATE_LOG.
 */
type Level = 'error' | 'warn' | 'info' | 'debug';

const ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

const ENABLED_LEVEL: Level = (() => {
  const raw = (Bun.env.CADGATE_LOG ?? 'info').toLowerCase();
  return raw in ORDER ? (raw as Level) : 'info';
})();

const COLOR = {
  red: (s: string) => (process.stderr.isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (process.stderr.isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (process.stderr.isTTY ? `\x1b[36m${s}\x1b[0m` : s),
  dim: (s: string) => (process.stderr.isTTY ? `\x1b[2m${s}\x1b[0m` : s),
};

function emit(level: Level, label: string, msg: string): void {
  if (ORDER[level] > ORDER[ENABLED_LEVEL]) return;
  process.stderr.write(`${label} ${msg}\n`);
}

export const logger = {
  error: (msg: string) => emit('error', COLOR.red('error'), msg),
  warn: (msg: string) => emit('warn', COLOR.yellow('warn '), msg),
  info: (msg: string) => emit('info', COLOR.cyan('info '), msg),
  debug: (msg: string) => emit('debug', COLOR.dim('debug'), msg),
};

export type Logger = typeof logger;
