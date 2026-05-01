import { z } from 'zod';
import { DfmRulesSchema } from '../metrics/dfm.ts';
import { RenderViewSchema } from '../render/types.ts';

export const LanguageSchema = z.enum(['cadquery', 'build123d']);
export type Language = z.infer<typeof LanguageSchema>;

const sourceField = z.string().min(1);
const timeoutField = z.number().int().positive().default(60000);

/** zod raw shapes — the MCP SDK consumes ZodRawShape, not z.object(...). */

export const validateInput = {
  source: sourceField,
  language: LanguageSchema.optional(),
  rules: DfmRulesSchema.optional(),
  render: z.boolean().default(false),
  timeoutMs: timeoutField,
};

export const diffInput = {
  baseSource: sourceField,
  headSource: sourceField,
  language: LanguageSchema.optional(),
  timeoutMs: timeoutField,
};

export const dfmInput = {
  source: sourceField,
  rules: DfmRulesSchema,
  language: LanguageSchema.optional(),
  timeoutMs: timeoutField,
};

export const renderInput = {
  source: sourceField,
  language: LanguageSchema.optional(),
  views: z.array(RenderViewSchema).min(1).optional(),
  timeoutMs: timeoutField,
};
