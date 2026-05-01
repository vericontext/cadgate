import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import bundleAssetPath from './page-script.bundled.js' with { type: 'file' };
import type { ParsedMesh } from '../metrics/manifold.ts';
import type { MinWallHotspot } from '../core/types.ts';
import { RENDER_VIEWS, type RenderPaths, type RenderView } from './types.ts';

export type InitResult =
  | { ok: true }
  | { ok: false; reason: 'chromium-not-found' | 'disabled' | 'launch-failed'; message?: string };

const CHROMIUM_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
];

const CHROME_FLAGS_BASE = [
  '--enable-unsafe-swiftshader',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--headless=new',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
];

export function detectChromium(): string | null {
  if (Bun.env.CADGATE_CHROMIUM) {
    return existsSync(Bun.env.CADGATE_CHROMIUM) ? Bun.env.CADGATE_CHROMIUM : null;
  }
  return CHROMIUM_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

export interface RendererOptions {
  /** Override Chromium executable path. Defaults to detection. */
  executablePath?: string;
  /** Add --no-sandbox (CI runners with no user namespace). */
  noSandbox?: boolean;
}

export class Renderer {
  private browser: import('puppeteer-core').Browser | null = null;
  private page: import('puppeteer-core').Page | null = null;

  async init(opts: RendererOptions = {}): Promise<InitResult> {
    const executable = opts.executablePath ?? detectChromium();
    if (!executable) {
      return { ok: false, reason: 'chromium-not-found' };
    }

    let puppeteer: typeof import('puppeteer-core');
    try {
      puppeteer = await import('puppeteer-core');
    } catch (err) {
      return {
        ok: false,
        reason: 'launch-failed',
        message: `puppeteer-core import failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const args = [...CHROME_FLAGS_BASE];
    if (opts.noSandbox) args.push('--no-sandbox');

    try {
      this.browser = await puppeteer.launch({ executablePath: executable, args, headless: true });
      this.page = await this.browser.newPage();
      await this.page.setViewport({ width: 1024, height: 1024, deviceScaleFactor: 1 });
      const bundleSource = await Bun.file(bundleAssetPath).text();
      await this.page.setContent('<!doctype html><html><body style="margin:0"></body></html>', {
        waitUntil: 'load',
      });
      await this.page.addScriptTag({ content: bundleSource });
      return { ok: true };
    } catch (err) {
      await this.close();
      return {
        ok: false,
        reason: 'launch-failed',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async renderViews(
    mesh: ParsedMesh,
    hotspots: readonly MinWallHotspot[],
    outDir: string,
  ): Promise<RenderPaths> {
    if (!this.page) throw new Error('Renderer not initialized');
    await mkdir(outDir, { recursive: true });

    const meshArg = {
      vertProperties: Array.from(mesh.vertProperties),
      triVerts: Array.from(mesh.triVerts),
      hotspots: hotspots.map((h) => ({ point: h.point, thicknessMm: h.thicknessMm })),
    };

    const paths = {} as RenderPaths;
    for (const view of RENDER_VIEWS) {
      const dataUrl = await this.page.evaluate(
        ({ mesh, view }: { mesh: typeof meshArg; view: RenderView }) => {
          // Runs inside Chromium; cadgateRender is set by the bundled page-script.
          return (globalThis as unknown as {
            cadgateRender: (req: typeof mesh & { view: RenderView }) => string;
          }).cadgateRender({ ...mesh, view });
        },
        { mesh: meshArg, view },
      );
      const png = pngFromDataUrl(dataUrl);
      const file = join(outDir, `${view}.png`);
      await writeFile(file, png);
      paths[view] = file;
    }
    return paths;
  }

  async close(): Promise<void> {
    if (this.page) {
      try {
        await this.page.close();
      } catch {
        /* ignore */
      }
      this.page = null;
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        /* ignore */
      }
      this.browser = null;
    }
  }
}

function pngFromDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const b64 = dataUrl.slice(comma + 1);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
