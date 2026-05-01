#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty';
import { checkCommand } from './commands/check.ts';
import { versionCommand } from './commands/version.ts';
import { logger } from './logger.ts';
import { EXIT } from './exit-codes.ts';

const main = defineCommand({
  meta: {
    name: 'cadgate',
    version: '0.0.1',
    description: 'Validate AI-generated CAD-as-code PRs.',
  },
  subCommands: {
    check: checkCommand,
    version: versionCommand,
  },
});

await runMain(main).catch((err: unknown) => {
  // citty already prints help-friendly errors for usage problems and exits 1.
  // Anything that bubbles to here is unexpected.
  logger.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(EXIT.GENERAL_ERROR);
});
