import { extname } from 'node:path';
import type { CadDriver } from './types.ts';

export function pickDriverFor(filename: string, drivers: readonly CadDriver[]): CadDriver | null {
  const ext = extname(filename).toLowerCase();
  if (!ext) return null;
  for (const driver of drivers) {
    if (driver.extensions.includes(ext)) return driver;
  }
  return null;
}
