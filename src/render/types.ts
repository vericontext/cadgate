import { z } from 'zod';

export const RenderViewSchema = z.enum(['front', 'back', 'top', 'bottom', 'left', 'right']);
export type RenderView = z.infer<typeof RenderViewSchema>;

export const RENDER_VIEWS: readonly RenderView[] = [
  'front',
  'back',
  'top',
  'bottom',
  'left',
  'right',
] as const;

export const RenderPathsSchema = z.object({
  front: z.string(),
  back: z.string(),
  top: z.string(),
  bottom: z.string(),
  left: z.string(),
  right: z.string(),
});
export type RenderPaths = z.infer<typeof RenderPathsSchema>;
