import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JudgeDriver, JudgeRequest } from '../../src/judges/types.ts';
import { createCadgateMcpServer } from '../../src/mcp/server.ts';
import { createMcpState, type McpState } from '../../src/mcp/state.ts';

const SKIP = Bun.env.CADGATE_SKIP_DOCKER === '1';
const FIX = join(import.meta.dir, '..', '..', 'fixtures');

const silentLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

interface ToolResp {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ payload: { ok: boolean; [k: string]: unknown }; isError: boolean }> {
  const raw = (await client.callTool({ name, arguments: args })) as ToolResp;
  const text = raw.content[0]?.text ?? '{}';
  return { payload: JSON.parse(text), isError: !!raw.isError };
}

describe.skipIf(SKIP)('MCP server (in-process)', () => {
  let state: McpState;
  let client: Client;
  let capturedJudgeReq: JudgeRequest | null = null;

  const stubJudge: JudgeDriver = {
    name: 'stub',
    modelId: 'stub-model',
    async judge(req) {
      capturedJudgeReq = req;
      return {
        ok: true,
        verdict: {
          verdict: 'pass',
          intentMatch: 'matches',
          reasons: ['stub reason'],
          noteForHuman: 'stub note',
          modelId: 'stub-model',
          promptCacheHit: false,
        },
      };
    },
  };

  beforeAll(async () => {
    state = createMcpState({
      logger: silentLogger,
      allowChromium: false,
      judgeForTesting: stubJudge,
    });
    const server = createCadgateMcpServer({ state, logger: silentLogger });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  }, 30_000);

  afterAll(async () => {
    await client.close();
    await state.shutdown();
  });

  test('tools/list returns the five expected tools', async () => {
    const res = await client.listTools();
    const names = res.tools.map((t) => t.name).sort();
    expect(names).toEqual(['cad_dfm_check', 'cad_diff', 'cad_judge', 'cad_render', 'cad_validate']);
  });

  test('cad_judge inputSchema lists baseSource + headSource as discrete fields (no $ref dedupe)', async () => {
    const res = await client.listTools();
    const judgeTool = res.tools.find((t) => t.name === 'cad_judge');
    expect(judgeTool).toBeDefined();
    const props = (judgeTool!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(props.baseSource).toBeDefined();
    expect(props.headSource).toBeDefined();
    // Each must be its own object schema, not a $ref.
    expect((props.baseSource as Record<string, unknown>).$ref).toBeUndefined();
    expect((props.headSource as Record<string, unknown>).$ref).toBeUndefined();
  });

  test(
    'cad_validate with a 20mm cube returns volume ≈ 8000 + watertight',
    async () => {
      const source = readFileSync(join(FIX, 'cube_base.py'), 'utf8');
      const { payload, isError } = await callTool(client, 'cad_validate', { source });
      expect(isError).toBe(false);
      expect(payload.ok).toBe(true);
      const metrics = payload.metrics as { volume: number; isWatertight: boolean };
      expect(metrics.volume).toBeCloseTo(8000, 0);
      expect(metrics.isWatertight).toBe(true);
    },
    120_000,
  );

  test(
    'cad_dfm_check flags a min-wall violation on a 0.5mm-walled box',
    async () => {
      const source = readFileSync(join(FIX, 'violating_thin_wall.py'), 'utf8');
      const { payload, isError } = await callTool(client, 'cad_dfm_check', {
        source,
        rules: {
          version: 1,
          rules: [{ id: 'min-wall-thickness', minMm: 1.2, severity: 'error', enabled: true }],
        },
      });
      expect(isError).toBe(false);
      expect(payload.ok).toBe(true);
      const violations = payload.violations as Array<{ ruleId: string; severity: string }>;
      expect(violations.length).toBe(1);
      expect(violations[0]!.ruleId).toBe('min-wall-thickness');
    },
    180_000,
  );

  test(
    'cad_diff returns +33% volume between cube_base and cube_head',
    async () => {
      const baseSource = readFileSync(join(FIX, 'cube_base.py'), 'utf8');
      const headSource = readFileSync(join(FIX, 'cube_head.py'), 'utf8');
      const { payload, isError } = await callTool(client, 'cad_diff', { baseSource, headSource });
      expect(isError).toBe(false);
      expect(payload.ok).toBe(true);
      const delta = payload.delta as { volumeDeltaPct: number };
      expect(delta.volumeDeltaPct).toBeCloseTo(33.1, 0);
    },
    180_000,
  );

  test('source without cadquery/build123d imports → NO_DRIVER error', async () => {
    const { payload, isError } = await callTool(client, 'cad_validate', {
      source: "print('not a CAD script')\n",
    });
    expect(isError).toBe(true);
    expect(payload.ok).toBe(false);
    expect((payload.error as { code: string }).code).toBe('NO_DRIVER');
  });

  test(
    'cad_judge with stub driver returns verdict + ground truth and captures JudgeRequest',
    async () => {
      capturedJudgeReq = null;
      const baseSource = readFileSync(join(FIX, 'cube_base.py'), 'utf8');
      const headSource = readFileSync(join(FIX, 'cube_head.py'), 'utf8');
      const { payload, isError } = await callTool(client, 'cad_judge', {
        baseSource,
        headSource,
        prDescription: 'Make the cube slightly bigger.',
        render: false,
      });
      expect(isError).toBe(false);
      expect(payload.ok).toBe(true);
      expect(payload.verdict).toBe('pass');
      expect(payload.modelId).toBe('stub-model');
      const headMetrics = payload.headMetrics as { volume: number };
      expect(headMetrics.volume).toBeCloseTo(10648, 0);
      const delta = payload.delta as { volumeDeltaPct: number };
      expect(delta.volumeDeltaPct).toBeCloseTo(33.1, 0);
      expect(payload.dfmViolations).toEqual([]);

      expect(capturedJudgeReq).not.toBeNull();
      expect(capturedJudgeReq!.baseSource).toBe(baseSource);
      expect(capturedJudgeReq!.baseMetrics).not.toBeNull();
      expect(capturedJudgeReq!.delta).not.toBeNull();
      expect(capturedJudgeReq!.baseRenders).toBeNull();
      expect(capturedJudgeReq!.headRenders).toBeNull();
      expect(capturedJudgeReq!.prDescription).toBe('Make the cube slightly bigger.');
    },
    180_000,
  );
});

describe('cad_judge auth (engine-free)', () => {
  let state: McpState;
  let client: Client;

  beforeAll(async () => {
    state = createMcpState({ logger: silentLogger, allowChromium: false });
    // No apiKey, no judgeForTesting — judge() returns null.
    const server = createCadgateMcpServer({ state, logger: silentLogger });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  }, 15_000);

  afterAll(async () => {
    await client.close();
    await state.shutdown();
  });

  test('cad_judge without configured judge returns JUDGE_AUTH', async () => {
    const { payload, isError } = await callTool(client, 'cad_judge', {
      headSource: 'import cadquery as cq\nresult = cq.Workplane("XY").box(20, 20, 20)\n',
      render: false,
    });
    expect(isError).toBe(true);
    expect(payload.ok).toBe(false);
    expect((payload.error as { code: string }).code).toBe('JUDGE_AUTH');
  });
});
