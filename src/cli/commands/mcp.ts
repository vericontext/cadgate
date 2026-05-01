import { defineCommand } from 'citty';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createCadgateMcpServer } from '../../mcp/server.ts';
import { createMcpState } from '../../mcp/state.ts';
import { logger } from '../logger.ts';

const serveCommand = defineCommand({
  meta: {
    name: 'serve',
    description: 'Run an MCP stdio server exposing CADGate tools to AI agents.',
  },
  args: {
    'no-render': {
      type: 'boolean',
      description: 'Disable Chromium init even if available.',
    },
  },
  async run({ args }) {
    const state = createMcpState({ logger, allowChromium: !args['no-render'] });
    const server = createCadgateMcpServer({ state, logger });
    const transport = new StdioServerTransport();

    let shuttingDown = false;
    const onShutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info('mcp shutdown');
      try {
        await server.close();
      } catch {
        /* ignore */
      }
      await state.shutdown();
      process.exit(0);
    };
    process.on('SIGINT', onShutdown);
    process.on('SIGTERM', onShutdown);

    await server.connect(transport);
    logger.info(`mcp server connected (cadgate ${process.env.npm_package_version ?? ''})`);
    // Block until transport closes / signal received.
    await new Promise<void>(() => {});
  },
});

export const mcpCommand = defineCommand({
  meta: { name: 'mcp', description: 'CADGate MCP server.' },
  subCommands: { serve: serveCommand },
});
