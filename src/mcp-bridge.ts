// Extends the user's existing MCP in this process only; its source is untouched.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const root = process.env.GITLAB_MCP_PATH!;
const { buildServer } = await import(pathToFileURL(resolve(root, 'src/server.ts')).href);
const { GitLabClient } = await import(pathToFileURL(resolve(root, 'src/client.ts')).href);
const server = buildServer();
const api = new GitLabClient({ baseUrl: process.env.GITLAB_URL!, token: process.env.GITLAB_TOKEN!, fetchImpl: (input: any, init: any) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }) });

server.tool('gitlab_dashboard_users', 'Search visible GitLab profiles by name or username. Read-only.', {
  search: z.string().trim().min(2).max(100),
}, async ({ search }: any) => {
  const response = await api.rawRequest('/users', { query: { search, per_page: 20, page: 1 } });
  const users = await response.json();
  return { content: [{ type: 'text', text: JSON.stringify({ users: users.map((user: any) => ({ id: user.id, username: user.username, name: user.name, web_url: user.web_url, state: user.state })), hasMore: Boolean(response.headers.get('x-next-page')) || users.length === 20 }) }] };
});
server.tool('gitlab_dashboard_user', 'Read a visible GitLab user profile by ID for contribution attribution.', {
  userId: z.number().int().positive(),
}, async ({ userId }: any) => ({ content: [{ type: 'text', text: JSON.stringify(await api.request(`/users/${userId}`)) }] }));

server.tool('gitlab_activity_page', 'Read a page of activity for the local contribution dashboard. Read-only, fixed GitLab endpoints.', {
  kind: z.enum(['events', 'projects', 'contributed', 'commits', 'merge_requests', 'issues', 'project']),
  userId: z.number().int().positive(), projectId: z.number().int().positive().optional(),
  since: z.string(), until: z.string(), page: z.number().int().min(1).max(500),
  author: z.string().optional(),
}, async ({ kind, userId, projectId, since, until, page, author }: any) => {
  const query: Record<string, any> = { per_page: 100, page };
  let endpoint = '';
  switch (kind) {
    case 'events': endpoint = `/users/${userId}/events`; Object.assign(query, { after: new Date(Date.parse(since) - 86400000).toISOString().slice(0, 10), before: new Date(Date.parse(until) + 86400000).toISOString().slice(0, 10), sort: 'desc' }); break;
    case 'projects': endpoint = '/projects'; Object.assign(query, { membership: true, simple: true }); break;
    case 'contributed': endpoint = `/users/${userId}/contributed_projects`; query.simple = true; break;
    case 'project': endpoint = `/projects/${projectId}`; break;
    case 'commits': endpoint = `/projects/${projectId}/repository/commits`; Object.assign(query, { all: true, with_stats: true, since, until, author }); break;
    case 'merge_requests': endpoint = '/merge_requests'; Object.assign(query, { scope: 'all', author_id: userId, state: 'all', created_after: since, created_before: until }); break;
    case 'issues': endpoint = '/issues'; Object.assign(query, { scope: 'all', author_id: userId, state: 'all', created_after: since, created_before: until }); break;
  }
  if (['commits', 'project'].includes(kind) && !projectId) throw new Error('projectId is required');
  const response = await api.rawRequest(endpoint, { query });
  const data = await response.json();
  const nextHeader = response.headers.get('x-next-page');
  const linkNext = /[?&]page=(\d+)[^>]*>;\s*rel="next"/.exec(response.headers.get('link') || '');
  // Commits omit pagination totals; a full page must be followed even without headers.
  const next = nextHeader ? Number(nextHeader) : linkNext ? Number(linkNext[1]) : nextHeader === null && Array.isArray(data) && data.length === 100 ? page + 1 : null;
  return { content: [{ type: 'text', text: JSON.stringify({ data, next }) }] };
});
await server.connect(new StdioServerTransport());
