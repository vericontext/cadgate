import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuild123dDriver } from '../drivers/build123d-driver.ts';
import { createCadQueryDriver } from '../drivers/cadquery-driver.ts';
import type { CadDriver } from '../drivers/types.ts';
import { type JudgeName, pickJudge } from '../judges/registry.ts';
import type { JudgeDriver } from '../judges/types.ts';
import { Renderer, detectChromium } from '../render/engine.ts';
import type { Logger } from '../cli/logger.ts';

export interface McpStateOptions {
  logger: Logger;
  /** If false (or Chromium not detected), renderer() always returns null. */
  allowChromium?: boolean;
  /** Anthropic API key for cad_judge. If absent, judge() returns null. */
  apiKey?: string;
  /** Test-only: bypass real Anthropic init, return this driver from judge(). */
  judgeForTesting?: JudgeDriver;
}

export interface McpState {
  /** Synchronously returns the cached driver list (built once). */
  drivers(): readonly CadDriver[];
  /** Lazy Chromium init. Cached after first call (including null on init failure). */
  renderer(): Promise<Renderer | null>;
  /** Force the next renderer() call to re-init — call after a Chromium crash. */
  invalidateRenderer(): void;
  /**
   * Lazy LLM judge init. Returns null when no api key is configured. Cached
   * per (name, model) combo across the server lifetime.
   */
  judge(name?: JudgeName, modelOverride?: string): Promise<JudgeDriver | null>;
  /** Force the next judge() call to re-init — symmetric with invalidateRenderer. */
  invalidateJudge(): void;
  /** Allocate a per-tool-call workdir under the server-lifetime root. */
  callDir(): Promise<string>;
  /** Idempotent shutdown — closes Chromium, removes the work root. */
  shutdown(): Promise<void>;
}

export function createMcpState(opts: McpStateOptions): McpState {
  const { logger, allowChromium = true, apiKey, judgeForTesting } = opts;

  let cachedDrivers: readonly CadDriver[] | null = null;

  let rendererPromise: Promise<Renderer | null> | null = null;

  let judgeCache = new Map<string, Promise<JudgeDriver | null>>();

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

  async function ensureJudge(
    name: JudgeName = 'opus',
    modelOverride?: string,
  ): Promise<JudgeDriver | null> {
    if (judgeForTesting) return judgeForTesting;
    const key = `${name}:${modelOverride ?? ''}`;
    let cached = judgeCache.get(key);
    if (!cached) {
      cached = (async () => {
        if (!apiKey) return null;
        const picked = pickJudge(name, { apiKey, model: modelOverride });
        if (!picked.ok) {
          logger.warn(`judge init failed (${name}): ${picked.reason}`);
          return null;
        }
        return picked.driver;
      })();
      judgeCache.set(key, cached);
    }
    return cached;
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
    judge: ensureJudge,
    invalidateJudge() {
      judgeCache = new Map();
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
