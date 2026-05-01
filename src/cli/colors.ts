/**
 * Shared ANSI helpers for stdout/stderr palettes. TTY check is captured at
 * factory time so callers don't pay it per render.
 */
type WritableStream = NodeJS.WriteStream;

type Colorizer = (s: string) => string;

const PALETTE = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
} as const;

const RESET = '\x1b[0m';
type ColorName = keyof typeof PALETTE;

export type Colors = Record<ColorName, Colorizer>;

export function makeColors(stream: WritableStream): Colors {
  const enable = stream.isTTY;
  const result = {} as Colors;
  for (const [name, code] of Object.entries(PALETTE)) {
    result[name as ColorName] = enable ? (s: string) => `${code}${s}${RESET}` : (s: string) => s;
  }
  return result;
}

export const stdoutColors = makeColors(process.stdout);
export const stderrColors = makeColors(process.stderr);
