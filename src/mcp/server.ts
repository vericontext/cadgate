import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import pkg from '../../package.json' with { type: 'json' };
import type { Logger } from '../cli/logger.ts';
import type { McpState } from './state.ts';
import { dfmCheck } from './tools/dfm-check.ts';
import { diff } from './tools/diff.ts';
import { render } from './tools/render.ts';
import type { McpToolResult } from './tools/_shared.ts';
import { dfmInput, diffInput, renderInput, validateInput } from './types.ts';
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
    const content: ContentBlock[] = [{ type: 'text', text: JSON.stringify(payload) }];
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
