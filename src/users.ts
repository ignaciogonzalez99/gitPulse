import { connectMcp } from './mcp.ts';
import { loadConfig } from './config.ts';

export function publicUser(user: any) {
  return { id: user.id, username: user.username, name: user.name, url: user.web_url || user.url, state: user.state };
}
export function parseUserId(value: string | null): number | undefined {
  if (value === null || value === '') return undefined;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Usuario inválido.');
  return Number(value);
}
export function commitEmails(user: any, authenticatedId: number, extraEmails: string[]) {
  return new Set<string>([user.email, user.commit_email, user.public_email, ...(user.id === authenticatedId ? extraEmails : [])]
    .filter((email): email is string => typeof email === 'string' && email.trim().length > 0)
    .map(email => email.trim().toLowerCase()));
}
let current: { user: any; expires: number } | undefined;
let pending: Promise<any> | undefined;
export async function currentUser() {
  if (current && current.expires > Date.now()) return current.user;
  if (!pending) pending = (async () => {
    const mcp = await connectMcp(await loadConfig());
    try {
      const user = await mcp.call('gitlab_get_current_user');
      current = { user, expires: Date.now() + 5 * 60_000 };
      return user;
    } finally { await mcp.close(); }
  })().finally(() => { pending = undefined; });
  return pending;
}
export async function searchUsers(query: string) {
  const search = query.trim().replace(/^@/, '');
  if (search.length < 2 || search.length > 100) throw new Error('Escribe entre 2 y 100 caracteres para buscar un usuario.');
  const mcp = await connectMcp(await loadConfig());
  try {
    const data = await mcp.call('gitlab_dashboard_users', { search });
    return { users: data.users.map(publicUser), hasMore: data.hasMore };
  } finally { await mcp.close(); }
}
