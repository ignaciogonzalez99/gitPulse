import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parse } from 'smol-toml';

export async function loadConfig() {
  try {
    const file = await readFile(resolve('.env'), 'utf8');
    for (const line of file.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  let saved: any = {};
  try {
    const file = process.env.CODEX_CONFIG_PATH || resolve(process.env.CODEX_HOME || resolve(homedir(), '.codex'), 'config.toml');
    saved = (parse(await readFile(file, 'utf8')) as any).mcp_servers?.gitlab || {};
  } catch { /* Environment configuration can be used independently. */ }
  const path = resolve(process.env.GITLAB_MCP_PATH || saved.cwd || resolve('..', 'gitlab-mcp', 'gitlab-mcp'));
  const url = process.env.GITLAB_URL || saved.env?.GITLAB_URL || 'https://gitlab.com';
  const token = process.env.GITLAB_TOKEN || saved.env?.GITLAB_TOKEN;
  if (!token) throw new Error('No hay credenciales de GitLab. Configura GITLAB_TOKEN en .env o el MCP gitlab en Codex.');
  return { path, url, token, port: Number(process.env.PORT || 4173), emails: (process.env.COMMIT_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean) };
}
