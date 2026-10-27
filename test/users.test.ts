import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitEmails, parseUserId, publicUser } from '../src/users.ts';
import { SnapshotStore } from '../src/snapshot-store.ts';

test('author emails never include the signed-in user aliases for another profile', () => {
  const own = { id: 122, email: 'ME@example.com', commit_email: 'alias@example.com' };
  assert.deepEqual([...commitEmails(own, 122, ['extra@example.com'])], ['me@example.com', 'alias@example.com', 'extra@example.com']);
  assert.deepEqual([...commitEmails({ id: 55, public_email: 'other@example.com' }, 122, ['extra@example.com'])], ['other@example.com']);
  assert.equal(commitEmails({ id: 55, public_email: '' }, 122, ['extra@example.com']).size, 0);
});
test('search results contain only the public fields required by the picker', () => {
  const user = publicUser({ id: 1, name: 'User', username: 'user', web_url: 'https://gitlab.example/user', state: 'active', email: 'private@example.com', identities: [{ secret: true }] });
  assert.deepEqual(Object.keys(user).sort(), ['id', 'name', 'state', 'url', 'username']);
});
test('user IDs cannot contain paths, names, zero or invalid numeric values', () => {
  assert.equal(parseUserId(null), undefined); assert.equal(parseUserId('122'), 122);
  for (const value of ['../122', 'igonzalez', '0', '-1', '1.2', '1e2', '9007199254740992']) assert.throws(() => parseUserId(value), /Usuario inválido/);
});
test('snapshot cache isolates users, periods and legacy files on disk and in memory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gitpulse-users-'));
  t.after(async () => { assert.ok(root.startsWith(join(tmpdir(), 'gitpulse-users-'))); await rm(root, { recursive: true, force: true }); });
  const legacy = { version: 1, year: 2026, user: { id: 122 }, summary: { total: 7 } };
  await writeFile(join(root, '2026.json'), JSON.stringify(legacy));
  const store = new SnapshotStore(root);
  assert.equal((await store.get(2026, 122)).summary.total, 7);
  assert.equal(await store.get(2026, 55), null);
  await store.save({ ...legacy, user: { id: 55 }, summary: { total: 99 } });
  await store.save({ ...legacy, year: 'all', user: { id: 55 }, summary: { total: 199 } });
  assert.equal((await store.get(2026, 122)).summary.total, 7);
  assert.equal((await store.get(2026, 55)).summary.total, 99);
  const reloaded = new SnapshotStore(root);
  assert.equal((await reloaded.get(2026, 55)).summary.total, 99);
  assert.equal((await reloaded.get('all', 55)).summary.total, 199);
  assert.equal(await reloaded.get('all', 122), null);
});
