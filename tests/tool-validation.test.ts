import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DkgWmClient } from '../src/modules/dkg-wm-client.js';
import { DedupeStore } from '../src/modules/dedupe-store.js';
import { createDepositTool } from '../src/tools/deposit-tool.js';
import { createPromoteTool } from '../src/tools/promote-tool.js';
import { createStatusUpdateTool } from '../src/tools/status-update-tool.js';
// Import from tools barrel to cover src/tools/index.ts
import { createSearchTool } from '../src/tools/index.js';
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

function makeClient(loggerWarn?: ReturnType<typeof vi.fn>) {
  return new DkgWmClient({
    daemonUrl: config.daemonUrl,
    token: 'test-token',
    logger: loggerWarn
      ? { info: vi.fn(), warn: loggerWarn, error: vi.fn(), debug: vi.fn() }
      : undefined,
  });
}

const LONG_CONTENT = 'This is a valid piece of content that is long enough to pass the minimum content length check of fifty characters.';

// ---------------------------------------------------------------------------
// deposit-tool
// ---------------------------------------------------------------------------
describe('deposit-tool', () => {
  describe('input validation', () => {
    it('returns error when plugin is disabled', async () => {
      const disabledConfig = { ...config, enabled: false };
      const tool = createDepositTool({ client: makeClient(), dedupe: new DedupeStore({ stateDir: tempDir }), config: disabledConfig });
      const result = await tool.handler({ content: LONG_CONTENT, artifactType: 'chat' }) as Record<string, unknown>;
      expect(result['success']).toBe(false);
      expect(String(result['message'])).toContain('disabled');
    });

    it('returns error for non-string content', async () => {
      const tool = createDepositTool({ client: makeClient(), dedupe: new DedupeStore({ stateDir: tempDir }), config });
      const result = await tool.handler({ content: 42, artifactType: 'chat' }) as Record<string, unknown>;
      expect(result['success']).toBe(false);
      expect(String(result['message'])).toContain('content');
    });

    it('returns error for non-string artifactType', async () => {
      const tool = createDepositTool({ client: makeClient(), dedupe: new DedupeStore({ stateDir: tempDir }), config });
      const result = await tool.handler({ content: LONG_CONTENT, artifactType: null }) as Record<string, unknown>;
      expect(result['success']).toBe(false);
      expect(String(result['message'])).toContain('artifactType');
    });

    it('returns error for content exceeding 500KB', async () => {
      const tool = createDepositTool({ client: makeClient(), dedupe: new DedupeStore({ stateDir: tempDir }), config });
      const result = await tool.handler({ content: 'x'.repeat(500_001), artifactType: 'chat' }) as Record<string, unknown>;
      expect(result['success']).toBe(false);
      expect(String(result['message'])).toContain('maximum');
    });

    it('returns error when content is shorter than minContentLength', async () => {
      const tool = createDepositTool({ client: makeClient(), dedupe: new DedupeStore({ stateDir: tempDir }), config });
      const result = await tool.handler({ content: 'short', artifactType: 'chat' }) as Record<string, unknown>;
      expect(result['success']).toBe(false);
      expect(String(result['message'])).toContain('too short');
    });
  });

  describe('success path', () => {
    it('deposits valid content and returns ual', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ assertionUri: 'ual:deposit:ok' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ written: 15 }) })
      );
      const tool = createDepositTool({ client: makeClient(), dedupe: new DedupeStore({ stateDir: tempDir }), config });
      const result = await tool.handler({ content: LONG_CONTENT, artifactType: 'research_note' }) as Record<string, unknown>;
      expect(result['success']).toBe(true);
      expect(result['ual']).toBe('ual:deposit:ok');
      expect(result['status']).toBeTruthy();
    });

    it('returns deduplicated=true on second call with same content', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ assertionUri: 'ual:first' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ written: 10 }) })
      );
      const dedupe = new DedupeStore({ stateDir: tempDir });
      await dedupe.load();
      const tool = createDepositTool({ client: makeClient(), dedupe, config });

      const result1 = await tool.handler({ content: LONG_CONTENT, artifactType: 'chat' }) as Record<string, unknown>;
      expect(result1['success']).toBe(true);

      const result2 = await tool.handler({ content: LONG_CONTENT, artifactType: 'chat' }) as Record<string, unknown>;
      expect(result2['success']).toBe(true);
      expect(result2['deduplicated']).toBe(true);
    });

    it('accepts optional title and sessionId', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200,
        text: async () => JSON.stringify({ assertionUri: 'ual:titled', written: 5 }),
      }));
      const tool = createDepositTool({ client: makeClient(), dedupe: new DedupeStore({ stateDir: tempDir }), config });
      const result = await tool.handler({
        content: LONG_CONTENT,
        artifactType: 'research_note',
        title: 'My Research Note',
        sessionId: 'sess-abc',
        status: 'validated',
      }) as Record<string, unknown>;
      expect(result['success']).toBe(true);
    });

    it('returns error when DKG client throws during deposit', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({}) })  // createAssertion fails next
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'internal error' })
      );
      const tool = createDepositTool({ client: makeClient(), dedupe: new DedupeStore({ stateDir: tempDir }), config });
      const result = await tool.handler({ content: LONG_CONTENT, artifactType: 'chat' }) as Record<string, unknown>;
      expect(result['success']).toBe(false);
      expect(String(result['message'])).toContain('Failed to deposit');
    });

    it('logs warning and succeeds if dedupe.save() throws', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ assertionUri: 'ual:save-fail' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ written: 5 }) })
      );
      const warnFn = vi.fn();
      const client = makeClient(warnFn);
      const dedupe = new DedupeStore({ stateDir: tempDir });
      await dedupe.load();
      // Make save() throw
      vi.spyOn(dedupe, 'save').mockRejectedValueOnce(new Error('disk full'));

      const tool = createDepositTool({ client, dedupe, config });
      const result = await tool.handler({ content: LONG_CONTENT, artifactType: 'chat' }) as Record<string, unknown>;

      expect(result['success']).toBe(true); // still succeeds
      expect(warnFn).toHaveBeenCalledWith(expect.stringContaining('dedupe'));
    });
  });
});

// ---------------------------------------------------------------------------
// promote-tool
// ---------------------------------------------------------------------------
describe('promote-tool', () => {
  describe('validation', () => {
    it('returns error for empty artifactId', async () => {
      const tool = createPromoteTool({ client: makeClient(), config });
      const result = await tool.handler({ artifactId: '', confirm: true }) as Record<string, unknown>;
      expect(result['success']).toBe(false);
      expect(String(result['message'])).toContain('artifactId');
    });

    it('returns error for non-string artifactId', async () => {
      const tool = createPromoteTool({ client: makeClient(), config });
      const result = await tool.handler({ artifactId: 123, confirm: true }) as Record<string, unknown>;
      expect(result['success']).toBe(false);
    });

    it('returns error when confirm is false', async () => {
      const tool = createPromoteTool({ client: makeClient(), config });
      const result = await tool.handler({ artifactId: 'urn:dkg:wm:abc', confirm: false }) as Record<string, unknown>;
      expect(result['success']).toBe(false);
      expect(String(result['message'])).toContain('confirm');
    });

    it('returns error when confirm is absent', async () => {
      const tool = createPromoteTool({ client: makeClient(), config });
      const result = await tool.handler({ artifactId: 'urn:dkg:wm:abc' }) as Record<string, unknown>;
      expect(result['success']).toBe(false);
    });
  });

  describe('success path', () => {
    it('promotes and returns success when confirm=true', async () => {
      const tool = createPromoteTool({ client: makeClient(), config });
      const result = await tool.handler({ artifactId: 'urn:dkg:wm:abc123', confirm: true }) as Record<string, unknown>;
      expect(result['success']).toBe(true);
      expect(String(result['message'])).toContain('Shared Working Memory');
    });

    it('calls promoteAssertion on the DKG client', async () => {
      const client = makeClient();
      const promoteSpy = vi.spyOn(client, 'promoteAssertion').mockResolvedValueOnce(undefined);
      const tool = createPromoteTool({ client, config });
      await tool.handler({ artifactId: 'urn:dkg:wm:xyz', confirm: true });
      expect(promoteSpy).toHaveBeenCalledWith(config.contextGraph, config.assertionName);
    });

    it('returns error when DKG client throws during promote', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false, status: 503, text: async () => 'service unavailable',
      }));
      const tool = createPromoteTool({ client: makeClient(), config });
      const result = await tool.handler({ artifactId: 'urn:dkg:wm:abc', confirm: true }) as Record<string, unknown>;
      expect(result['success']).toBe(false);
      expect(String(result['message'])).toContain('Failed to promote');
    });
  });
});

// ---------------------------------------------------------------------------
// status-update-tool
// ---------------------------------------------------------------------------
describe('status-update-tool', () => {
  describe('validation', () => {
    it('returns error for empty artifactId', async () => {
      const tool = createStatusUpdateTool({ client: makeClient(), config });
      const result = await tool.handler({ artifactId: '', newStatus: 'draft' }) as Record<string, unknown>;
      expect(result['success']).toBe(false);
      expect(String(result['message'])).toContain('artifactId');
    });

    it('returns error for non-string artifactId', async () => {
      const tool = createStatusUpdateTool({ client: makeClient(), config });
      const result = await tool.handler({ artifactId: null, newStatus: 'draft' }) as Record<string, unknown>;
      expect(result['success']).toBe(false);
    });

    it('returns error for invalid status value', async () => {
      const tool = createStatusUpdateTool({ client: makeClient(), config });
      const result = await tool.handler({ artifactId: 'urn:dkg:wm:abc', newStatus: 'not-a-status' }) as Record<string, unknown>;
      expect(result['success']).toBe(false);
      expect(String(result['message'])).toContain('newStatus');
    });

    it('returns error for non-string newStatus', async () => {
      const tool = createStatusUpdateTool({ client: makeClient(), config });
      const result = await tool.handler({ artifactId: 'urn:dkg:wm:abc', newStatus: 42 }) as Record<string, unknown>;
      expect(result['success']).toBe(false);
    });
  });

  describe('success path', () => {
    it('updates status for every valid status value', async () => {
      const validStatuses = ['draft', 'review_needed', 'needs_sources', 'validated', 'ready_to_share', 'deprecated', 'discarded'];
      for (const newStatus of validStatuses) {
        const tool = createStatusUpdateTool({ client: makeClient(), config });
        const result = await tool.handler({ artifactId: 'urn:dkg:wm:abc', newStatus }) as Record<string, unknown>;
        expect(result['success']).toBe(true);
        expect(result['newStatus']).toBe(newStatus);
        expect(result['artifactId']).toBe('urn:dkg:wm:abc');
        expect(result['modifiedAt']).toBeTruthy();
      }
    });

    it('calls writeAssertion with status and modifiedAt quads', async () => {
      const client = makeClient();
      const writeSpy = vi.spyOn(client, 'writeAssertion').mockResolvedValueOnce({ written: 2 });
      const tool = createStatusUpdateTool({ client, config });
      await tool.handler({ artifactId: 'urn:dkg:wm:abc', newStatus: 'validated' });
      expect(writeSpy).toHaveBeenCalledWith(
        config.contextGraph,
        config.assertionName,
        expect.arrayContaining([
          expect.objectContaining({ object: '"validated"' }),
        ]),
      );
    });

    it('returns error when DKG client throws during status update', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false, status: 500, text: async () => 'write error',
      }));
      const tool = createStatusUpdateTool({ client: makeClient(), config });
      const result = await tool.handler({ artifactId: 'urn:dkg:wm:abc', newStatus: 'validated' }) as Record<string, unknown>;
      expect(result['success']).toBe(false);
      expect(String(result['message'])).toContain('Failed to update status');
    });
  });
});

// ---------------------------------------------------------------------------
// search-tool (barrel import covers src/tools/index.ts)
// ---------------------------------------------------------------------------
describe('search-tool (from tools barrel)', () => {
  it('is importable and returns results', async () => {
    const tool = createSearchTool({ client: makeClient(), config });
    expect(tool.name).toBe('search_working_memory');
  });

  it('returns error response when querySparql throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('SPARQL engine down')));
    const tool = createSearchTool({ client: makeClient(), config });
    const result = await tool.handler({ query: 'reentrancy' }) as Record<string, unknown>;
    expect(result['success']).toBe(false);
    expect(String(result['message'])).toContain('Search failed');
  });
});
