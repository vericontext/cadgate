import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuild123dDriver } from '../drivers/build123d-driver.ts';
import { createCadQueryDriver } from '../drivers/cadquery-driver.ts';
import type { CadDriver } from '../drivers/types.ts';
import { Renderer, detectChromium } from '../render/engine.ts';
import type { Logger } from '../cli/logger.ts';

export interface McpStateOptions {
  logger: Logger;
  /** If false (or Chromium not detected), renderer() always returns null. */
  allowChromium?: boolean;
}

export interface McpState {
  /** Synchronously returns the cached driver list (built once). */
  drivers(): readonly CadDriver[];
  /** Lazy Chromium init. Cached after first call (including null on init failure). */
  renderer(): Promise<Renderer | null>;
  /** Force the next renderer() call to re-init — call after a Chromium crash. */
  invalidateRenderer(): void;
  /** Allocate a per-tool-call workdir under the server-lifetime root. */
  callDir(): Promise<string>;
  /** Idempotent shutdown — closes Chromium, removes the work root. */
  shutdown(): Promise<void>;
}

export function createMcpState(opts: McpStateOptions): McpState {
  const { logger, allowChromium = true } = opts;

  let cachedDrivers: readonly CadDriver[] | null = null;

  let rendererPromise: Promise<Renderer | null> | null = null;

  let workRoot: string | null = null;
  let workRootPromise: Promise<string> | null = null;

  let didShutdown = false;

  function ensureDrivers(): readonly CadDriver[] {
    if (!cachedDrivers) {
      cachedDrivers = [createCadQueryDriver(), createBuild123dDriver()];
    }
    return cachedDrivers;
  }

  async function ensureRenderer(): Promise<Renderer | null> {
    if (!allowChromium) return null;
    if (!rendererPromise) {
      rendererPromise = (async () => {
        if (!detectChromium()) {
          logger.warn('Chromium not found; rendering disabled.');
          return null;
        }
        const r = new Renderer();
        const init = await r.init({ noSandbox: Bun.env.CI === 'true' });
        if (!init.ok) {
          logger.warn(`renderer init failed (${init.reason})${init.message ? `: ${init.message}` : ''}`);
          return null;
        }
        return r;
      })();
    }
    return rendererPromise;
  }

  async function ensureWorkRoot(): Promise<string> {
    if (workRoot) return workRoot;
    if (!workRootPromise) {
      workRootPromise = mkdtemp(join(tmpdir(), 'cadgate-mcp-'))
        // realpath() resolves the macOS /tmp → /private/tmp symlink so paths
        // returned to clients line up with how the filesystem MCP server (and
        // anything else doing `realpath` on its allow-roots) sees them.
        .then((p) => realpath(p))
        .then((p) => {
          workRoot = p;
          logger.info(`mcp work root: ${p}`);
          return p;
        });
    }
    return workRootPromise;
  }

  return {
    drivers: ensureDrivers,
    renderer: ensureRenderer,
    invalidateRenderer() {
      rendererPromise = null;
    },
    async callDir(): Promise<string> {
      const root = await ensureWorkRoot();
      return mkdtemp(join(root, 'call-'));
    },
    async shutdown(): Promise<void> {
      if (didShutdown) return;
      didShutdown = true;
      if (rendererPromise) {
        try {
          const r = await rendererPromise;
          if (r) await r.close();
        } catch (err) {
          logger.warn(`renderer close failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        rendererPromise = null;
      }
      if (workRoot) {
        try {
          await rm(workRoot, { recursive: true, force: true });
        } catch (err) {
          logger.warn(`work root cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        workRoot = null;
      }
    },
  };
}
