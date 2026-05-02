import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import pkg from '../../package.json' with { type: 'json' };
import type { Logger } from '../cli/logger.ts';
import type { McpState } from './state.ts';
import { dfmCheck } from './tools/dfm-check.ts';
import { diff } from './tools/diff.ts';
import { judge } from './tools/judge.ts';
import { render } from './tools/render.ts';
import type { McpToolResult } from './tools/_shared.ts';
import { dfmInput, diffInput, judgeInput, renderInput, validateInput } from './types.ts';
import { validate } from './tools/validate.ts';

export interface CreateServerOptions {
  state: McpState;
  logger: Logger;
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

interface ToolCallResponse {
  [key: string]: unknown;
  structuredContent?: Record<string, unknown>;
  content: ContentBlock[];
  isError?: boolean;
}

export function createCadgateMcpServer({ state, logger }: CreateServerOptions): McpServer {
  const server = new McpServer({ name: 'cadgate', version: pkg.version });

  server.registerTool(
    'cad_validate',
    {
      description:
        'Run a CadQuery or Build123d source string in a sandboxed Docker sidecar; ' +
        'return mesh metrics (volume, surface area, watertight, bbox, min-wall-thickness, hotspots), ' +
        'optional DFM rule violations, and optional 6-view rendered PNG paths.',
      inputSchema: validateInput,
    },
    (args) => callTool(() => validate(state, args), logger),
  );

  server.registerTool(
    'cad_diff',
    {
      description:
        'Run two CAD sources (base + head) and return their metric delta (volume, surface area, ' +
        'watertightness, bbox, triangle count, min-wall regression).',
      inputSchema: diffInput,
    },
    (args) => callTool(() => diff(state, args), logger),
  );

  server.registerTool(
    'cad_dfm_check',
    {
      description:
        'Run a CAD source and evaluate it against a DFM rules YAML config (min-wall-thickness, ' +
        'watertight, mass-budget, etc). Returns the list of rule violations.',
      inputSchema: dfmInput,
    },
    (args) => callTool(() => dfmCheck(state, args), logger),
  );

  server.registerTool(
    'cad_render',
    {
      description:
        'Run a CAD source and produce up to 6 view-aligned PNG renders (front/back/top/bottom/' +
        'left/right). Returns local filesystem paths; files persist for the MCP server lifetime.',
      inputSchema: renderInput,
    },
    (args) => callTool(() => render(state, args), logger),
  );

  server.registerTool(
    'cad_judge',
    {
      description:
        'Run base + head CAD sources, render both, evaluate optional DFM rules, then ask an ' +
        'Anthropic LLM (Opus 4.7 or Sonnet 4.6) for a structured verdict ' +
        '(pass/block/comment-only), an intent-match assessment vs the PR description, ' +
        'a reasons[] list grounded in metrics + renders, and a one-paragraph note for the ' +
        'human reviewer. Returns the verdict alongside the underlying metrics, delta, and ' +
        'DFM violations so the agent can self-correct without a second tool call. ' +
        'Requires ANTHROPIC_API_KEY at server start; uses prompt caching (90% off on ' +
        're-runs against the same base). `timeoutMs` gates the engine, not the judge call.',
      inputSchema: judgeInput,
    },
    (args) => callTool(() => judge(state, args), logger),
  );

  return server;
}

async function callTool<T>(
  fn: () => Promise<McpToolResult<T>>,
  logger: Logger,
): Promise<ToolCallResponse> {
  try {
    const result = await fn();
    return respond(result, logger);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`tool threw INTERNAL: ${message}`);
    const payload = { ok: false, error: { code: 'INTERNAL', message } };
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(payload) }],
    };
  }
}

function respond<T>(result: McpToolResult<T>, logger: Logger): ToolCallResponse {
  if (result.ok) {
    const payload = { ok: true, ...((result.data as Record<string, unknown>) ?? {}) };
    const text = JSON.stringify(payload);
    const previewHint = makePreviewHint(payload);
    const content: ContentBlock[] = [{ type: 'text', text: previewHint ? `${text}\n\n${previewHint}` : text }];
    if (result.images) {
      for (const img of result.images) {
        content.push({ type: 'image', data: img.data, mimeType: img.mimeType });
      }
    }
    return { structuredContent: payload, content };
  }
  logger.warn(`tool error ${result.error.code}: ${result.error.message}`);
  const errPayload = { ok: false, error: result.error };
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(errPayload) }],
  };
}

/**
 * If the result references PNG paths (cad_render or cad_validate with renders),
 * emit a copy-pasteable `open` command so users on macOS can preview the renders
 * without depending on the MCP client to render image content blocks visually.
 */
function makePreviewHint(payload: Record<string, unknown>): string | null {
  const paths = collectPngPaths(payload);
  if (paths.length === 0) return null;
  if (paths.length === 1) return `Preview locally:\n  open ${paths[0]}`;
  // Use a glob spanning the common parent dir if all paths share one — keeps the hint short.
  const parent = commonParent(paths);
  if (parent) return `Preview locally:\n  open ${parent}/*.png`;
  return `Preview locally:\n  open ${paths.join(' ')}`;
}

function collectPngPaths(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value.endsWith('.png')) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectPngPaths(v, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectPngPaths(v, out);
  }
  return out;
}

function commonParent(paths: readonly string[]): string | null {
  if (paths.length === 0) return null;
  const segments = paths.map((p) => p.split('/'));
  const first = segments[0]!;
  let i = 0;
  for (; i < first.length; i++) {
    if (!segments.every((s) => s[i] === first[i])) break;
  }
  if (i === 0) return null;
  return first.slice(0, i).join('/').replace(/\/$/, '');
}
