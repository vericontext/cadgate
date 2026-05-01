import type { CadDriver } from './types.ts';
import { createDockerCadDriver, type DockerCadDriverOptions } from './docker-cad-driver.ts';

export type Build123dDriverOptions = Omit<DockerCadDriverOptions, 'language'>;

export function createBuild123dDriver(opts: Build123dDriverOptions = {}): CadDriver {
  return createDockerCadDriver({ ...opts, language: 'build123d' });
}
