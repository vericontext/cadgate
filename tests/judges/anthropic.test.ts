import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, test } from 'bun:test';
import {
  type AnthropicMessagesClient,
  createAnthropicJudge,
} from '../../src/judges/anthropic.ts';
import type { JudgeRequest } from '../../src/judges/types.ts';
import type { Metrics } from '../../src/core/types.ts';

function metrics(): Metrics {
  return {
    volume: 8000,
    surfaceArea: 2400,
    isWatertight: true,
    bbox: { min: [-10, -10, -10], max: [10, 10, 10] },
    triCount: 12,
    minWallMm: 20,
    minWallHotspots: [],
  };
}

function judgeRequest(): JudgeRequest {
  return {
    filePath: 'parts/box.py',
    prDescription: 'Make the cube slightly bigger.',
    baseSource: 'import cadquery as cq\nresult = cq.Workplane("XY").box(20, 20, 20)\n',
    headSource: 'import cadquery as cq\nresult = cq.Workplane("XY").box(22, 22, 22)\n',
    baseMetrics: metrics(),
    headMetrics: { ...metrics(), volume: 10648, surfaceArea: 2904 },
    baseRenders: null,
    headRenders: null,
    delta: {
      volumeDelta: 2648,
      volumeDeltaPct: 33.1,
      surfaceAreaDelta: 504,
      triCountDelta: 0,
      bboxChanged: true,
      watertightnessChanged: false,
    },
    dfmViolations: [],
  };
}

interface CapturedRequest {
  body?: Anthropic.Messages.MessageCreateParamsNonStreaming;
}

function stubClient(
  respond: () => Anthropic.Messages.Message | Promise<Anthropic.Messages.Message>,
  captured: CapturedRequest = {},
): AnthropicMessagesClient {
  return {
    messages: {
      async create(body) {
        captured.body = body;
        return await respond();
      },
    },
  };
}

function passResponse(): Anthropic.Messages.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-4-7',
    stop_reason: 'tool_use',
    stop_sequence: null,
    container: null,
    context_management: null,
    stop_details: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
    },
    content: [
      {
        type: 'tool_use',
        id: 'tool_test',
        name: 'submit_verdict',
        caller: { type: 'direct' },
        input: {
          verdict: 'pass',
          intentMatch: 'matches',
          reasons: ['Bbox grew uniformly to 22mm; matches "slightly bigger" intent.'],
          noteForHuman: 'The box was uniformly enlarged from 20mm to 22mm, matching the PR description. No DFM issues.',
        },
      },
    ],
  } as unknown as Anthropic.Messages.Message;
}

describe('createAnthropicJudge', () => {
  test('happy path — returns parsed verdict and sets cache_control on system + tool', async () => {
    const captured: CapturedRequest = {};
    const driver = createAnthropicJudge({
      apiKey: 'sk-test',
      client: stubClient(passResponse, captured),
    });
    const result = await driver.judge(judgeRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdict.verdict).toBe('pass');
    expect(result.verdict.intentMatch).toBe('matches');
    expect(result.verdict.modelId).toBe('claude-opus-4-7');
    expect(result.verdict.promptCacheHit).toBe(false);
    expect(result.verdict.reasons.length).toBeGreaterThan(0);

    expect(captured.body).toBeDefined();
    const body = captured.body!;
    expect(body.model).toBe('claude-opus-4-7');
    expect(Array.isArray(body.system)).toBe(true);
    const systemBlock = (body.system as Anthropic.Messages.TextBlockParam[])[0]!;
    expect(systemBlock.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.tools).toBeDefined();
    expect((body.tools as Anthropic.Messages.Tool[])[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'submit_verdict' });
    // No temperature on Opus 4.7 — must NOT be sent.
    expect((body as unknown as Record<string, unknown>).temperature).toBeUndefined();
    // Base side message should have a cache_control breakpoint on its last block.
    const firstMsg = body.messages[0]!;
    const baseContent = firstMsg.content as Anthropic.Messages.ContentBlockParam[];
    const lastBaseBlock = baseContent[baseContent.length - 1]! as { cache_control?: unknown };
    expect(lastBaseBlock.cache_control).toEqual({ type: 'ephemeral' });
  });

  test('cache hit flag — promptCacheHit true when cache_read_input_tokens > 0', async () => {
    const driver = createAnthropicJudge({
      apiKey: 'sk-test',
      client: stubClient(() => {
        const r = passResponse();
        r.usage.cache_read_input_tokens = 1234;
        return r;
      }),
    });
    const result = await driver.judge(judgeRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdict.promptCacheHit).toBe(true);
  });

  test('NO_VERDICT — model returned text only, no submit_verdict call', async () => {
    const driver = createAnthropicJudge({
      apiKey: 'sk-test',
      client: stubClient(() => {
        const r = passResponse();
        r.content = [{ type: 'text', text: 'I refuse', citations: null }] as Anthropic.Messages.ContentBlock[];
        return r;
      }),
    });
    const result = await driver.judge(judgeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NO_VERDICT');
  });

  test('BAD_VERDICT_SHAPE — tool_use block has invalid input', async () => {
    const driver = createAnthropicJudge({
      apiKey: 'sk-test',
      client: stubClient(() => {
        const r = passResponse();
        const block = r.content[0] as Anthropic.Messages.ToolUseBlock;
        block.input = { verdict: 'definitely-not-an-enum-value', reasons: [], noteForHuman: '' };
        return r;
      }),
    });
    const result = await driver.judge(judgeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('BAD_VERDICT_SHAPE');
  });

  test('JUDGE_AUTH — Anthropic AuthenticationError is classified as JUDGE_AUTH', async () => {
    const driver = createAnthropicJudge({
      apiKey: 'sk-test',
      client: stubClient(() => {
        throw new Anthropic.AuthenticationError(
          401,
          { error: { type: 'authentication_error', message: 'invalid x-api-key' } },
          'invalid x-api-key',
          new Headers(),
        );
      }),
    });
    const result = await driver.judge(judgeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('JUDGE_AUTH');
  });

  test('JUDGE_API — generic APIError is classified as JUDGE_API', async () => {
    const driver = createAnthropicJudge({
      apiKey: 'sk-test',
      client: stubClient(() => {
        throw new Anthropic.RateLimitError(
          429,
          { error: { type: 'rate_limit_error', message: 'slow down' } },
          'slow down',
          new Headers(),
        );
      }),
    });
    const result = await driver.judge(judgeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('JUDGE_API');
  });

  test('respects custom model id', async () => {
    const captured: CapturedRequest = {};
    const driver = createAnthropicJudge({
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      client: stubClient(passResponse, captured),
    });
    expect(driver.modelId).toBe('claude-sonnet-4-6');
    const result = await driver.judge(judgeRequest());
    expect(result.ok).toBe(true);
    expect(captured.body?.model).toBe('claude-sonnet-4-6');
  });
});
