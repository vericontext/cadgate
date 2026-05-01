import { defineCommand } from 'citty';
import pkg from '../../../package.json' with { type: 'json' };

export const versionCommand = defineCommand({
  meta: { name: 'version', description: 'Print CADGate version.' },
  run() {
    process.stdout.write(`cadgate ${pkg.version}\n`);
  },
});
