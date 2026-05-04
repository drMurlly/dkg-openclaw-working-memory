import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DedupeStore } from '../src/modules/dedupe-store.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'dedupe-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('dedupe-store', () => {
  it('has() returns false before add()', () => {
    const store = new DedupeStore({ stateDir: tempDir });
    expect(store.has('sha256:abc123')).toBe(false);
  });

  it('has() returns true after add()', () => {
    const store = new DedupeStore({ stateDir: tempDir });
    store.add('sha256:abc123', 'ual:test:xyz');
    expect(store.has('sha256:abc123')).toBe(true);
  });

  it('getRecord() returns stored entry', () => {
    const store = new DedupeStore({ stateDir: tempDir });
    store.add('sha256:abc123', 'ual:test:xyz');
    const record = store.getRecord('sha256:abc123');
    expect(record).toBeTruthy();
    expect(record!.ual).toBe('ual:test:xyz');
    expect(record!.timestamp).toBeTruthy();
  });

  it('two different hashes tracked independently', () => {
    const store = new DedupeStore({ stateDir: tempDir });
    store.add('sha256:hash1', 'ual:1');
    store.add('sha256:hash2', 'ual:2');
    expect(store.has('sha256:hash1')).toBe(true);
    expect(store.has('sha256:hash2')).toBe(true);
    expect(store.has('sha256:hash3')).toBe(false);
  });

  it('isAssertionCreated() starts false', () => {
    const store = new DedupeStore({ stateDir: tempDir });
    expect(store.isAssertionCreated()).toBe(false);
  });

  it('markAssertionCreated() flips to true', () => {
    const store = new DedupeStore({ stateDir: tempDir });
    store.markAssertionCreated();
    expect(store.isAssertionCreated()).toBe(true);
  });

  it('persists and reloads entries', async () => {
    const store = new DedupeStore({ stateDir: tempDir });
    store.add('sha256:persistent', 'ual:persist:abc');
    store.markAssertionCreated();
    await store.save();

    const store2 = new DedupeStore({ stateDir: tempDir });
    await store2.load();
    expect(store2.has('sha256:persistent')).toBe(true);
    expect(store2.getRecord('sha256:persistent')!.ual).toBe('ual:persist:abc');
    expect(store2.isAssertionCreated()).toBe(true);
  });

  it('load() on non-existent file starts fresh (no error)', async () => {
    const store = new DedupeStore({ stateDir: join(tempDir, 'nonexistent') });
    await expect(store.load()).resolves.not.toThrow();
    expect(store.size()).toBe(0);
  });

  it('size() reflects added entries', () => {
    const store = new DedupeStore({ stateDir: tempDir });
    expect(store.size()).toBe(0);
    store.add('sha256:a');
    store.add('sha256:b');
    expect(store.size()).toBe(2);
  });
});
