import { defineCommand } from 'citty';

export const versionCommand = defineCommand({
  meta: { name: 'version', description: 'Print CADGate version.' },
  run() {
    // Version is injected at build time via citty meta — citty itself prints
    // the version when invoked with --version. This subcommand just echoes it.
    const version = '0.0.1';
    process.stdout.write(`cadgate ${version}\n`);
  },
});
