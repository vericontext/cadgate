import type { Metrics, MetricsDelta } from './types.ts';
import type { Delta, FileSide } from '../metrics/schema.ts';

function vec3Equal(a: readonly number[], b: readonly number[]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function diffMetrics(base: Metrics, head: Metrics): MetricsDelta {
  const volumeDelta = head.volume - base.volume;
  return {
    volumeDelta,
    volumeDeltaPct: base.volume === 0 ? 0 : (volumeDelta / base.volume) * 100,
    surfaceAreaDelta: head.surfaceArea - base.surfaceArea,
    triCountDelta: head.triCount - base.triCount,
    bboxChanged: !vec3Equal(base.bbox.min, head.bbox.min) || !vec3Equal(base.bbox.max, head.bbox.max),
    watertightnessChanged: base.isWatertight !== head.isWatertight,
  };
}

export function deltaFromSides(base: FileSide, head: FileSide): Delta {
  if (base.state === 'failed') {
    return { kind: 'unavailable', reason: `base: ${base.error.kind} — ${base.error.message}` };
  }
  if (head.state === 'failed') {
    return { kind: 'unavailable', reason: `head: ${head.error.kind} — ${head.error.message}` };
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
