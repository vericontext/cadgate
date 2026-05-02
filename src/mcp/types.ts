import { z } from 'zod';
import { DfmRulesSchema } from '../metrics/dfm.ts';
import { RenderViewSchema } from '../render/types.ts';

export const LanguageSchema = z.enum(['cadquery', 'build123d']);
export type Language = z.infer<typeof LanguageSchema>;

/**
 * zod raw shapes — the MCP SDK consumes ZodRawShape, not z.object(...).
 *
 * Important: every field gets a *fresh* zod instance. Reusing the same
 * instance across multiple fields causes zod-to-json-schema to dedupe
 * via `$ref`, which some MCP clients can't resolve and end up dropping
 * the field at the wire layer.
 */

export const validateInput = {
  source: z.string().min(1),
  language: LanguageSchema.optional(),
  rules: DfmRulesSchema.optional(),
  render: z.boolean().default(false),
  timeoutMs: z.number().int().positive().default(60000),
};

export const diffInput = {
  baseSource: z.string().min(1),
  headSource: z.string().min(1),
  language: LanguageSchema.optional(),
  timeoutMs: z.number().int().positive().default(60000),
};

export const dfmInput = {
  source: z.string().min(1),
  rules: DfmRulesSchema,
  language: LanguageSchema.optional(),
  timeoutMs: z.number().int().positive().default(60000),
};

export const renderInput = {
  source: z.string().min(1),
  language: LanguageSchema.optional(),
  views: z.array(RenderViewSchema).min(1).optional(),
  /**
   * Embed each PNG as a base64 image content block. Default is `false` because
   * not every MCP client surfaces tool image content to the user (Claude
   * Desktop in late 2026 sends images to the model's vision context but does
   * not render them in chat). Set `true` when you want the model to *analyze*
   * the image (vision use case) regardless of whether the user sees it.
   */
  inline: z.boolean().default(false),
  timeoutMs: z.number().int().positive().default(60000),
};
