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
    lines.push(...renderFileLines(file));
  }
  lines.push('');
  const { filesChanged, filesFailed, filesSkipped } = report.summary;
  const status =
    filesFailed > 0 ? C.red(`✗ ${filesFailed} failed`) : C.green('✓ all checks passed');
  lines.push(`${status}  ${C.dim(`(${filesChanged} changed, ${filesSkipped} skipped)`)}`);
  return lines.join('\n');
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
      return [head, `      Δvolume ${sign}${delta.volumeDelta.toFixed(1)}mm³ (${pct})${watertight}`];
    }
    case 'created':
      return [head, `      ${C.green('+ created')} volume=${delta.metrics.volume.toFixed(1)}mm³`];
    case 'deleted':
      return [head, `      ${C.yellow('- deleted')} volume=${delta.metrics.volume.toFixed(1)}mm³`];
    case 'unavailable':
      return [head, `      ${C.red(`✗ ${delta.reason}`)}`];
  }
}
