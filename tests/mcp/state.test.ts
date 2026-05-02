import { afterEach, describe, expect, test } from 'bun:test';
import type { JudgeDriver } from '../../src/judges/types.ts';
import { createMcpState, type McpState } from '../../src/mcp/state.ts';

const silentLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

const stubA: JudgeDriver = {
  name: 'stub-a',
  modelId: 'stub-a',
  async judge() {
    throw new Error('not used');
  },
};

describe('McpState.judge()', () => {
  let state: McpState | null = null;

  afterEach(async () => {
    if (state) await state.shutdown();
    state = null;
  });

  test('returns null when no apiKey + no testing override', async () => {
    state = createMcpState({ logger: silentLogger, allowChromium: false });
    expect(await state.judge()).toBeNull();
  });

  test('returns the test override when judgeForTesting is set', async () => {
    state = createMcpState({
      logger: silentLogger,
      allowChromium: false,
      judgeForTesting: stubA,
    });
    expect(await state.judge()).toBe(stubA);
    expect(await state.judge('sonnet', 'override')).toBe(stubA);
  });

  test('caches the same driver across repeat calls with the same key (real api flow)', async () => {
    state = createMcpState({
      logger: silentLogger,
      allowChromium: false,
      apiKey: 'sk-test',
    });
    const a = await state.judge('opus');
    const b = await state.judge('opus');
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  test('different (name, model) combos cache separately', async () => {
    state = createMcpState({
      logger: silentLogger,
      allowChromium: false,
      apiKey: 'sk-test',
    });
    const opus = await state.judge('opus');
    const sonnet = await state.judge('sonnet');
    const opusCustom = await state.judge('opus', 'claude-opus-4-7-1m');
    expect(opus).not.toBe(sonnet);
    expect(opus).not.toBe(opusCustom);
    // But repeat lookups still return the cached instance.
    expect(await state.judge('sonnet')).toBe(sonnet);
  });

  test('invalidateJudge clears the cache', async () => {
    state = createMcpState({
      logger: silentLogger,
      allowChromium: false,
      apiKey: 'sk-test',
    });
    const before = await state.judge('opus');
    state.invalidateJudge();
    const after = await state.judge('opus');
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(before).not.toBe(after);
  });
});
