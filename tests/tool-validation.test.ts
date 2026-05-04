import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DkgWmClient } from '../src/modules/dkg-wm-client.js';
import { DedupeStore } from '../src/modules/dedupe-store.js';
import { createDepositTool } from '../src/tools/deposit-tool.js';
import { createPromoteTool } from '../src/tools/promote-tool.js';
import { createStatusUpdateTool } from '../src/tools/status-update-tool.js';
import type { PluginConfig } from '../src/types/artifact.js';

let tempDir: string;
let config: PluginConfig;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'tool-val-test-'));
  config = {
    daemonUrl: 'http://127.0.0.1:9200',
    authTokenPath: '~/.dkg/auth.token',
    enabled: true,
    contextGraph: 'wm-artifacts',
    assertionName: 'artifacts',
    authorId: 'drMurlly',
    agentId: 'openclaw-agent',
    capture: { autoCapture: false, chat: true, files: true, toolOutputs: true, minContentLength: 50, skipPatterns: [] },
    redaction: { enabled: true },
    dedupe: { enabled: true, strategy: 'contentHash' },
    stateDir: tempDir,
  };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ assertionUri: 'ual:test', written: 1 }),
  }));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(tempDir, { recursive: true, force: true });
});

function makeClient() {
  return new DkgWmClient({ daemonUrl: config.daemonUrl, token: 'test-token' });
}

describe('deposit-tool input validation', () => {
  it('rejects non-string content', async () => {
    const tool = createDepositTool({ client: makeClient(), dedupe: new DedupeStore({ stateDir: tempDir }), config });
    const result = await tool.handler({ content: 42, artifactType: 'chat' }) as Record<string, unknown>;
    expect(result['success']).toBe(false);
    expect(String(result['message'])).toContain('content');
  });

  it('rejects content exceeding 500KB', async () => {
    const tool = createDepositTool({ client: makeClient(), dedupe: new DedupeStore({ stateDir: tempDir }), config });
    const result = await tool.handler({ content: 'x'.repeat(500_001), artifactType: 'chat' }) as Record<string, unknown>;
    expect(result['success']).toBe(false);
    expect(String(result['message'])).toContain('maximum');
  });

  it('rejects non-string artifactType', async () => {
    const tool = createDepositTool({ client: makeClient(), dedupe: new DedupeStore({ stateDir: tempDir }), config });
    const result = await tool.handler({ content: 'valid content that is long enough to pass', artifactType: null }) as Record<string, unknown>;
    expect(result['success']).toBe(false);
    expect(String(result['message'])).toContain('artifactType');
  });
});

describe('promote-tool input validation', () => {
  it('rejects empty artifactId', async () => {
    const tool = createPromoteTool({ client: makeClient(), config });
    const result = await tool.handler({ artifactId: '', confirm: true }) as Record<string, unknown>;
    expect(result['success']).toBe(false);
    expect(String(result['message'])).toContain('artifactId');
  });

  it('rejects non-string artifactId', async () => {
    const tool = createPromoteTool({ client: makeClient(), config });
    const result = await tool.handler({ artifactId: 123, confirm: true }) as Record<string, unknown>;
    expect(result['success']).toBe(false);
  });

  it('rejects confirm=false', async () => {
    const tool = createPromoteTool({ client: makeClient(), config });
    const result = await tool.handler({ artifactId: 'urn:dkg:wm:abc', confirm: false }) as Record<string, unknown>;
    expect(result['success']).toBe(false);
  });
});

describe('status-update-tool input validation', () => {
  it('rejects empty artifactId', async () => {
    const tool = createStatusUpdateTool({ client: makeClient(), config });
    const result = await tool.handler({ artifactId: '', newStatus: 'draft' }) as Record<string, unknown>;
    expect(result['success']).toBe(false);
    expect(String(result['message'])).toContain('artifactId');
  });

  it('rejects invalid status value', async () => {
    const tool = createStatusUpdateTool({ client: makeClient(), config });
    const result = await tool.handler({ artifactId: 'urn:dkg:wm:abc', newStatus: 'definitely-not-a-status' }) as Record<string, unknown>;
    expect(result['success']).toBe(false);
    expect(String(result['message'])).toContain('newStatus');
  });
});
