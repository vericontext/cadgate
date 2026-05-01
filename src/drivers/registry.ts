import { extname } from 'node:path';
import type { CadDriver, CadLanguage } from './types.ts';

const PY_LANGUAGE_PATTERNS: ReadonlyArray<[RegExp, CadLanguage]> = [
  [/^\s*(?:import\s+build123d\b|from\s+build123d\b)/m, 'build123d'],
  [/^\s*(?:import\s+cadquery\b|from\s+cadquery\b)/m, 'cadquery'],
];

export function pickDriverFor(
  filename: string,
  drivers: readonly CadDriver[],
  source?: string | null,
): CadDriver | null {
  const ext = extname(filename).toLowerCase();
  if (!ext) return null;

  if (ext === '.py') {
    if (source) {
      // Source provided — require a recognizable import to pick a driver.
      // No fallback: a `.py` file without `import cadquery` or `import build123d`
      // is not a CAD source, even if it has the right extension.
      for (const [pattern, language] of PY_LANGUAGE_PATTERNS) {
        if (pattern.test(source)) {
          return drivers.find((d) => d.language === language) ?? null;
        }
      }
      return null;
    }
    // No source available (e.g. file added/deleted in a PR with only one side) —
    // fall back to the first registered .py driver for back-compat.
    return drivers.find((d) => d.extensions.includes(ext)) ?? null;
  }

  return drivers.find((d) => d.extensions.includes(ext)) ?? null;
}
