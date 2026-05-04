import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

interface DedupeEntry {
  ual?: string;
  timestamp: string;
}

interface StoreData {
  entries: Record<string, DedupeEntry>;
  assertionCreated: boolean;
}

export class DedupeStore {
  private entries = new Map<string, DedupeEntry>();
  private assertionCreated = false;
  private readonly filePath: string;

  constructor(options: { stateDir: string }) {
    this.filePath = join(options.stateDir, 'dedupe.json');
  }

  has(contentHash: string): boolean {
    return this.entries.has(contentHash);
  }

  add(contentHash: string, ual?: string): void {
    this.entries.set(contentHash, { ual, timestamp: new Date().toISOString() });
  }

  getRecord(contentHash: string): DedupeEntry | undefined {
    return this.entries.get(contentHash);
  }

  size(): number {
    return this.entries.size;
  }

  isAssertionCreated(): boolean {
    return this.assertionCreated;
  }

  markAssertionCreated(): void {
    this.assertionCreated = true;
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as StoreData;
      this.assertionCreated = data.assertionCreated ?? false;
      for (const [hash, entry] of Object.entries(data.entries ?? {})) {
        this.entries.set(hash, entry);
      }
    } catch {
      // file doesn't exist yet — start fresh
    }
  }

  async save(): Promise<void> {
    const data: StoreData = {
      entries: Object.fromEntries(this.entries),
      assertionCreated: this.assertionCreated,
    };
    try {
      await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT') {
        await mkdir(join(this.filePath, '..'), { recursive: true });
        await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
      } else {
        throw err;
      }
    }
  }
}
