import type { Metrics, MetricsDelta } from './types.ts';
import type { Delta, FileSide } from '../metrics/schema.ts';

export function diffMetrics(base: Metrics, head: Metrics): MetricsDelta {
  const volumeDelta = head.volume - base.volume;
  const volumeDeltaPct = base.volume === 0 ? 0 : (volumeDelta / base.volume) * 100;
  const bboxChanged =
    base.bbox.min.toString() !== head.bbox.min.toString() ||
    base.bbox.max.toString() !== head.bbox.max.toString();
  return {
    volumeDelta,
    volumeDeltaPct,
    surfaceAreaDelta: head.surfaceArea - base.surfaceArea,
    triCountDelta: head.triCount - base.triCount,
    bboxChanged,
    watertightnessChanged: base.isWatertight !== head.isWatertight,
  };
}

/**
 * Compute the delta variant that goes into a FileResult given the analysis
 * outcome of base and head sides.
 */
export function deltaFromSides(base: FileSide, head: FileSide): Delta {
  if (base.state === 'failed' || head.state === 'failed') {
    return {
      kind: 'unavailable',
      reason:
        base.state === 'failed'
          ? `base: ${base.error.kind} — ${base.error.message}`
          : head.state === 'failed'
            ? `head: ${head.error.kind} — ${head.error.message}`
            : 'unknown',
    };
  }
  if (base.state === 'absent' && head.state === 'ok') {
    return { kind: 'created', metrics: head.metrics };
  }
  if (base.state === 'ok' && head.state === 'absent') {
    return { kind: 'deleted', metrics: base.metrics };
  }
  if (base.state === 'ok' && head.state === 'ok') {
    return { kind: 'changed', ...diffMetrics(base.metrics, head.metrics) };
  }
  return { kind: 'unavailable', reason: 'both sides absent' };
}
