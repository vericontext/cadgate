import { stderrColors as C } from './colors.ts';

type Level = 'error' | 'warn' | 'info' | 'debug';

const ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

const ENABLED_LEVEL: Level = (() => {
  const raw = (Bun.env.CADGATE_LOG ?? 'info').toLowerCase();
  return raw in ORDER ? (raw as Level) : 'info';
})();

function emit(level: Level, label: string, msg: string): void {
  if (ORDER[level] > ORDER[ENABLED_LEVEL]) return;
  process.stderr.write(`${label} ${msg}\n`);
}

export const logger = {
  error: (msg: string) => emit('error', C.red('error'), msg),
  warn: (msg: string) => emit('warn', C.yellow('warn '), msg),
  info: (msg: string) => emit('info', C.cyan('info '), msg),
  debug: (msg: string) => emit('debug', C.dim('debug'), msg),
};

export type Logger = typeof logger;
