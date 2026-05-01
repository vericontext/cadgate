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

  if (ext === '.py' && source) {
    for (const [pattern, language] of PY_LANGUAGE_PATTERNS) {
      if (pattern.test(source)) {
        const driver = drivers.find((d) => d.language === language);
        if (driver) return driver;
      }
    }
  }

  return drivers.find((d) => d.extensions.includes(ext)) ?? null;
}
