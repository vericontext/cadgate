import { stdoutColors as C } from './colors.ts';
import type { CheckReport, FileResult } from '../metrics/schema.ts';
import type { ErrorCode } from './exit-codes.ts';

export type OutputMode = 'text' | 'json';

export function detectOutputMode(explicit?: string): OutputMode {
  if (explicit === 'json') return 'json';
  if (explicit === 'text') return 'text';
  if (explicit && explicit !== 'auto') {
    throw new Error(`Unknown --report mode: ${explicit}`);
  }
  return process.stdout.isTTY ? 'text' : 'json';
}

export function formatReport(report: CheckReport, mode: OutputMode): string {
  if (mode === 'json') {
    return JSON.stringify(report, null, 2);
  }
  return renderTextReport(report);
}

export function formatError(message: string, mode: OutputMode, code?: ErrorCode): string {
  if (mode === 'json') {
    return JSON.stringify(
      { error: { code: code ?? 'INTERNAL', message } },
      null,
      2,
    );
  }
  return `Error: ${message}`;
}

function renderTextReport(report: CheckReport): string {
  const lines: string[] = [];
  lines.push(
    C.bold(`CADGate ${report.base}…${report.head}`) +
      C.dim(`  (${report.files.length} files)`),
  );
  for (const file of report.files) {
    lines.push(...renderFileLines(file), ...renderViolationLines(file));
  }
  lines.push('');
  const { filesChanged, filesFailed, filesSkipped, filesWithViolations } = report.summary;
  const parts: string[] = [];
  if (filesWithViolations > 0) parts.push(C.red(`✗ ${filesWithViolations} rule violations`));
  if (filesFailed > 0) parts.push(C.red(`✗ ${filesFailed} failed`));
  if (parts.length === 0) parts.push(C.green('✓ all checks passed'));
  lines.push(
    `${parts.join('  ')}  ${C.dim(`(${filesChanged} changed, ${filesSkipped} skipped)`)}`,
  );
  return lines.join('\n');
}

function formatMinWall(metrics: { minWallMm: number }): string {
  if (metrics.minWallMm < 0) return C.dim(' min-wall=n/a');
  return ` min-wall=${metrics.minWallMm.toFixed(2)}mm`;
}

function renderFileLines(file: FileResult): string[] {
  if (file.status === 'skipped') {
    return [`  ${C.dim('—')} ${file.path} ${C.dim(`(skipped: ${file.reason})`)}`];
  }
  const head = `  ${file.path} ${C.dim(`[${file.language}]`)}`;
  const delta = file.delta;
  switch (delta.kind) {
    case 'changed': {
      const sign = delta.volumeDelta >= 0 ? '+' : '';
      const pct = `${sign}${delta.volumeDeltaPct.toFixed(1)}%`;
      const watertight = delta.watertightnessChanged ? C.red(' watertight changed') : '';
      const headSide = file.head.state === 'ok' ? formatMinWall(file.head.metrics) : '';
      return [head, `      Δvolume ${sign}${delta.volumeDelta.toFixed(1)}mm³ (${pct})${watertight}${headSide}`];
    }
    case 'created':
      return [head, `      ${C.green('+ created')} volume=${delta.metrics.volume.toFixed(1)}mm³${formatMinWall(delta.metrics)}`];
    case 'deleted':
      return [head, `      ${C.yellow('- deleted')} volume=${delta.metrics.volume.toFixed(1)}mm³`];
    case 'unavailable':
      return [head, `      ${C.red(`✗ ${delta.reason}`)}`];
  }
}

function renderViolationLines(file: FileResult): string[] {
  if (file.status !== 'analyzed' || file.dfmViolations.length === 0) return [];
  return file.dfmViolations.map((v) => {
    const tag = v.severity === 'error' ? C.red(`! ${v.ruleId}`) : C.yellow(`~ ${v.ruleId}`);
    return `      ${tag}: ${v.message}`;
  });
}
