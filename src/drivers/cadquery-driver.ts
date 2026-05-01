import type { CadDriver } from './types.ts';
import { createDockerCadDriver, type DockerCadDriverOptions } from './docker-cad-driver.ts';

export type CadQueryDriverOptions = Omit<DockerCadDriverOptions, 'language'>;

export function createCadQueryDriver(opts: CadQueryDriverOptions = {}): CadDriver {
  return createDockerCadDriver({ ...opts, language: 'cadquery' });
}
