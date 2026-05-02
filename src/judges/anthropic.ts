import Anthropic from '@anthropic-ai/sdk';
import { fromError } from 'zod-validation-error';
import type { RenderPaths, RenderView } from '../render/types.ts';
import { RENDER_VIEWS } from '../render/types.ts';
import { SUBMIT_VERDICT_TOOL, SYSTEM_PROMPT } from './prompt.ts';
import {
  type JudgeDriver,
  type JudgeError,
  type JudgeRequest,
  type JudgeResult,
  JudgeVerdictSchema,
} from './types.ts';

/**
 * Slim slice of the Anthropic Messages client we depend on. Tests pass a stub
 * implementing only this surface, so we don't have to mock the whole SDK.
 */
export interface AnthropicMessagesClient {
  messages: {
    create: (
      body: Anthropic.Messages.MessageCreateParamsNonStreaming,
    ) => Promise<Anthropic.Messages.Message>;
  };
}

export interface CreateAnthropicJudgeOptions {
  apiKey: string;
  model?: string;
  /** Optional client injection for tests. */
  client?: AnthropicMessagesClient;
  /** Override max_tokens (default 1024). */
  maxTokens?: number;
}

const DEFAULT_MODEL = 'claude-opus-4-7';

export function createAnthropicJudge(opts: CreateAnthropicJudgeOptions): JudgeDriver {
  const client: AnthropicMessagesClient =
    opts.client ?? new Anthropic({ apiKey: opts.apiKey });
  const modelId = opts.model ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? 1024;

  return {
    name: 'anthropic',
    modelId,
    async judge(req: JudgeRequest): Promise<JudgeResult> {
      try {
        const messages = await buildMessages(req);
        const resp = await client.messages.create({
          model: modelId,
          max_tokens: maxTokens,
          system: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          tools: [{ ...SUBMIT_VERDICT_TOOL, cache_control: { type: 'ephemeral' } }],
          tool_choice: { type: 'tool', name: SUBMIT_VERDICT_TOOL.name },
          messages,
        });
        const block = resp.content.find(
          (b): b is Anthropic.Messages.ToolUseBlock =>
            b.type === 'tool_use' && b.name === SUBMIT_VERDICT_TOOL.name,
        );
        if (!block) {
          return {
            ok: false,
            error: {
              code: 'NO_VERDICT',
              message: 'Model did not call submit_verdict.',
            },
          };
        }
        const cacheRead = resp.usage?.cache_read_input_tokens ?? 0;
        const parsed = JudgeVerdictSchema.safeParse({
          ...(block.input as Record<string, unknown>),
          modelId,
          promptCacheHit: cacheRead > 0,
        });
        if (!parsed.success) {
          return {
            ok: false,
            error: {
              code: 'BAD_VERDICT_SHAPE',
              message: fromError(parsed.error).toString(),
            },
          };
        }
        return { ok: true, verdict: parsed.data };
      } catch (err) {
        return { ok: false, error: classifyAnthropicError(err) };
      }
    },
  };
}

export function classifyAnthropicError(err: unknown): JudgeError {
  if (err instanceof Anthropic.AuthenticationError) {
    return { code: 'JUDGE_AUTH', message: err.message };
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return { code: 'JUDGE_AUTH', message: err.message };
  }
  if (err instanceof Anthropic.APIError) {
    return { code: 'JUDGE_API', message: err.message };
  }
  if (err instanceof Error) {
    return { code: 'JUDGE_API', message: err.message };
  }
  return { code: 'JUDGE_API', message: String(err) };
}

async function buildMessages(
  req: JudgeRequest,
): Promise<Anthropic.Messages.MessageParam[]> {
  const messages: Anthropic.Messages.MessageParam[] = [];

  // --- Cached message: file path + base side. ---------------------------
  // The base ref is stable across re-pushes to the same PR, so caching the
  // base source + base metrics + base renders gives a 90% discount on
  // every retry within the cache TTL.
  const baseBlocks: Anthropic.Messages.ContentBlockParam[] = [];
  baseBlocks.push({
    type: 'text',
    text: `# CAD pull-request review\n\nFile: \`${req.filePath}\``,
  });
  if (req.baseSource !== null) {
    baseBlocks.push({
      type: 'text',
      text: `## base source\n\n\`\`\`\n${req.baseSource}\n\`\`\``,
    });
    baseBlocks.push({
      type: 'text',
      text: `## base metrics\n\n${formatMetrics(req.baseMetrics)}`,
    });
    if (req.baseRenders) {
      baseBlocks.push({ type: 'text', text: '## base renders (front, back, top, bottom, left, right)' });
      for (const v of RENDER_VIEWS) {
        baseBlocks.push(await pngBlock(req.baseRenders, v));
      }
    }
  } else {
    baseBlocks.push({
      type: 'text',
      text: '## base\n\nFile is **added** in this PR — no base side.',
    });
  }
  // Mark the *last* base block as the cache breakpoint. Anthropic caches the
  // full prefix up to and including the marked block.
  const lastBaseBlock = baseBlocks[baseBlocks.length - 1]!;
  attachCacheControl(lastBaseBlock);
  messages.push({ role: 'user', content: baseBlocks });

  // --- Uncached message: head side + delta + violations + intent. -------
  const headBlocks: Anthropic.Messages.ContentBlockParam[] = [];
  headBlocks.push({
    type: 'text',
    text: `## head source\n\n\`\`\`\n${req.headSource}\n\`\`\``,
  });
  headBlocks.push({
    type: 'text',
    text: `## head metrics\n\n${formatMetrics(req.headMetrics)}`,
  });
  if (req.delta) {
    headBlocks.push({
      type: 'text',
      text: `## delta (head − base)\n\n${formatDelta(req.delta)}`,
    });
  }
  headBlocks.push({
    type: 'text',
    text: `## DFM rule violations (engine output, ground truth)\n\n${formatViolations(
      req.dfmViolations,
    )}`,
  });
  headBlocks.push({
    type: 'text',
    text: `## PR description (human intent — NOT ground truth)\n\n${
      req.prDescription?.trim() ? req.prDescription.trim() : '(no PR description provided)'
    }`,
  });
  if (req.headRenders) {
    headBlocks.push({ type: 'text', text: '## head renders (front, back, top, bottom, left, right)' });
    for (const v of RENDER_VIEWS) {
      headBlocks.push(await pngBlock(req.headRenders, v));
    }
  }
  headBlocks.push({
    type: 'text',
    text: 'Now call `submit_verdict` with your structured judgment.',
  });
  messages.push({ role: 'user', content: headBlocks });

  return messages;
}

async function pngBlock(
  paths: RenderPaths,
  view: RenderView,
): Promise<Anthropic.Messages.ImageBlockParam> {
  const bytes = await Bun.file(paths[view]).bytes();
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/png',
      data: Buffer.from(bytes).toString('base64'),
    },
  };
}

function attachCacheControl(block: Anthropic.Messages.ContentBlockParam): void {
  // Only text and image blocks accept cache_control; the build above only
  // produces those, so this assertion is safe.
  (block as { cache_control?: { type: 'ephemeral' } }).cache_control = {
    type: 'ephemeral',
  };
}

function formatMetrics(m: import('../core/types.ts').Metrics | null): string {
  if (!m) return '(unavailable)';
  return [
    `volume: ${m.volume.toFixed(2)} mm³`,
    `surfaceArea: ${m.surfaceArea.toFixed(2)} mm²`,
    `isWatertight: ${m.isWatertight}`,
    `bbox: [${m.bbox.min.map((n) => n.toFixed(2)).join(', ')}] → [${m.bbox.max
      .map((n) => n.toFixed(2))
      .join(', ')}]`,
    `triCount: ${m.triCount}`,
    `minWallMm: ${m.minWallMm < 0 ? 'n/a (non-watertight)' : `${m.minWallMm.toFixed(2)} mm`}`,
    `minWallHotspots: ${m.minWallHotspots.length}`,
  ].join('\n');
}

function formatDelta(d: import('../core/types.ts').MetricsDelta): string {
  const sign = d.volumeDelta >= 0 ? '+' : '';
  return [
    `volumeDelta: ${sign}${d.volumeDelta.toFixed(2)} mm³ (${sign}${d.volumeDeltaPct.toFixed(1)}%)`,
    `surfaceAreaDelta: ${d.surfaceAreaDelta >= 0 ? '+' : ''}${d.surfaceAreaDelta.toFixed(2)} mm²`,
    `triCountDelta: ${d.triCountDelta >= 0 ? '+' : ''}${d.triCountDelta}`,
    `bboxChanged: ${d.bboxChanged}`,
    `watertightnessChanged: ${d.watertightnessChanged}`,
  ].join('\n');
}

function formatViolations(vs: import('../metrics/dfm.ts').RuleViolation[]): string {
  if (vs.length === 0) return '(none)';
  return vs.map((v) => `- [${v.severity}] ${v.ruleId}: ${v.message}`).join('\n');
}
