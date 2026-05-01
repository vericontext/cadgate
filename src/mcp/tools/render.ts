import { join } from 'node:path';
import { type RenderPaths, type RenderView, RENDER_VIEWS } from '../../render/types.ts';
import type { Language } from '../types.ts';
import type { McpState } from '../state.ts';
import { mapRunError, runSourceToMetrics, type McpToolResult } from './_shared.ts';

export interface RenderOk {
  renders: Partial<RenderPaths>;
}

export async function render(
  state: McpState,
  args: {
    source: string;
    language?: Language;
    views?: RenderView[];
    timeoutMs: number;
  },
): Promise<McpToolResult<RenderOk>> {
  const renderer = await state.renderer();
  if (!renderer) {
    return {
      ok: false,
      error: {
        code: 'CHROMIUM_UNAVAILABLE',
        message:
          'Renderer not initialized. Start cadgate without --no-render and ensure Chromium is installed.',
      },
    };
  }

  const r = await runSourceToMetrics(state, {
    source: args.source,
    language: args.language,
    timeoutMs: args.timeoutMs,
  });
  if (!r.ok) return r;

  try {
    let allViews: RenderPaths;
    try {
      allViews = await renderer.renderViews(
        r.data.mesh,
        r.data.metrics.minWallHotspots,
        join(r.data.callDir, 'renders'),
      );
    } catch (err) {
      state.invalidateRenderer();
      return {
        ok: false,
        error: mapRunError('mesh_invalid', err instanceof Error ? err.message : String(err)),
      };
    }

    const requested = args.views ?? RENDER_VIEWS;
    const renders: Partial<RenderPaths> = {};
    for (const v of requested) renders[v] = allViews[v];
    return { ok: true, data: { renders } };
  } finally {
    r.data.dispose();
  }
}
