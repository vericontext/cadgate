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

const COLOR = {
  red: (s: string) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s),
};

function renderTextReport(report: CheckReport): string {
  const lines: string[] = [];
  lines.push(
    COLOR.bold(`CADGate ${report.base}…${report.head}`) +
      COLOR.dim(`  (${report.files.length} files)`),
  );
  for (const file of report.files) {
    lines.push(...renderFileLines(file));
  }
  lines.push('');
  const { filesChanged, filesFailed, filesSkipped } = report.summary;
  const status =
    filesFailed > 0
      ? COLOR.red(`✗ ${filesFailed} failed`)
      : COLOR.green('✓ all checks passed');
  lines.push(
    `${status}  ${COLOR.dim(`(${filesChanged} changed, ${filesSkipped} skipped)`)}`,
  );
  return lines.join('\n');
}

function renderFileLines(file: FileResult): string[] {
  if (file.status === 'skipped') {
    return [`  ${COLOR.dim('—')} ${file.path} ${COLOR.dim(`(skipped: ${file.reason})`)}`];
  }
  const head = `  ${file.path} ${COLOR.dim(`[${file.language}]`)}`;
  const delta = file.delta;
  switch (delta.kind) {
    case 'changed': {
      const sign = delta.volumeDelta >= 0 ? '+' : '';
      const pct = `${sign}${delta.volumeDeltaPct.toFixed(1)}%`;
      const watertight = delta.watertightnessChanged
        ? COLOR.red(' watertight changed')
        : '';
      return [
        head,
        `      Δvolume ${sign}${delta.volumeDelta.toFixed(1)}mm³ (${pct})${watertight}`,
      ];
    }
    case 'created':
      return [head, `      ${COLOR.green('+ created')} volume=${delta.metrics.volume.toFixed(1)}mm³`];
    case 'deleted':
      return [head, `      ${COLOR.yellow('- deleted')} volume=${delta.metrics.volume.toFixed(1)}mm³`];
    case 'unavailable':
      return [head, `      ${COLOR.red(`✗ ${delta.reason}`)}`];
  }
}
