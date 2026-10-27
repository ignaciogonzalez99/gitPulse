import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { Period } from './analytics.ts';

export class SnapshotStore {
  private memory = new Map<string, any>();
  constructor(private root = resolve('.cache')) {}
  private key(year: Period, userId: number) { return `${userId}:${year}`; }
  private file(year: Period, userId: number) { return resolve(this.root, 'users', String(userId), `${year}.json`); }
  async get(year: Period, userId: number) {
    const key = this.key(year, userId);
    if (this.memory.has(key)) return this.memory.get(key);
    // Old files are accepted only for the same numeric user ID.
    for (const file of [this.file(year, userId), resolve(this.root, `${year}.json`)]) {
      try {
        const data = JSON.parse(await readFile(file, 'utf8'));
        if (data.version === 1 && data.user?.id === userId && data.year === year) {
          this.memory.set(key, data); return data;
        }
      } catch {}
    }
    return null;
  }
  async save(snapshot: any) {
    const file = this.file(snapshot.year, snapshot.user.id);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(snapshot), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
    this.memory.set(this.key(snapshot.year, snapshot.user.id), snapshot);
  }
}
