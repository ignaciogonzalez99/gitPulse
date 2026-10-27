import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { loadConfig } from './config.ts';

export async function connectMcp(config: Awaited<ReturnType<typeof loadConfig>>) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--import', 'tsx', fileURLToPath(new URL('./mcp-bridge.ts', import.meta.url))], cwd: resolve('.'),
    env: { GITLAB_MCP_PATH: config.path, GITLAB_URL: config.url, GITLAB_TOKEN: config.token }, stderr: 'pipe' });
  transport.stderr?.on('data', () => {});
  const client = new Client({ name: 'gitlab-exposer', version: '1.0.0' });
  await client.connect(transport);
  return {
    async call(name: string, args: Record<string, unknown> = {}): Promise<any> {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
      if (result.isError) throw new Error('GitLab no pudo completar la consulta. Comprueba acceso y permisos.');
      const block = (result.content as any[]).find(x => x.type === 'text');
      if (!block) throw new Error('Respuesta MCP sin datos.');
      return JSON.parse(block.text);
    },
    close: () => client.close(),
  };
}
