import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DkgWmClient } from '../src/modules/dkg-wm-client.js';
import { createSearchTool } from '../src/tools/search-tool.js';
import type { PluginConfig } from '../src/types/artifact.js';

const config: PluginConfig = {
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
  stateDir: '/tmp/test',
};

function makeClientAndTool(bindingsOverride?: Array<Record<string, unknown>>) {
  const bindings = bindingsOverride ?? [];
  const mockFn = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    // Realistic DKG SPARQL response shape: { result: { bindings: [...] }, phases: {...} }
    text: async () => JSON.stringify({ result: { bindings }, phases: { execute: 1, serverTotal: 1 } }),
  });
  vi.stubGlobal('fetch', mockFn);
  // Pre-seed agentAddress so querySparql does not make an extra /api/agent/identity call in tests
  const client = new DkgWmClient({ daemonUrl: config.daemonUrl, token: 'test', agentAddress: '0xtest' });
  const tool = createSearchTool({ client, config });
  return { tool, mockFn };
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe('search-tool', () => {
  describe('SPARQL injection prevention', () => {
    it('escapes double quotes in query text', async () => {
      const { tool, mockFn } = makeClientAndTool();

      await tool.handler({ query: 'test "injection" attack' });

      const [, init] = mockFn.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { sparql: string };
      expect(body.sparql).toContain('\\"injection\\"');
      expect(body.sparql).not.toContain('"injection"');
    });

    it('escapes backslashes in query text', async () => {
      const { tool, mockFn } = makeClientAndTool();

      await tool.handler({ query: 'test\\path\\traversal' });

      const [, init] = mockFn.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { sparql: string };
      expect(body.sparql).toContain('\\\\');
    });

    it('escapes newlines in query text', async () => {
      const { tool, mockFn } = makeClientAndTool();

      await tool.handler({ query: 'line one\nline two' });

      const [, init] = mockFn.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { sparql: string };
      expect(body.sparql).toContain('\\n');
      expect(body.sparql).not.toMatch(/LCASE\([^)]*\n/);
    });

    it('escapes carriage returns in query text', async () => {
      const { tool, mockFn } = makeClientAndTool();

      await tool.handler({ query: 'line\rreturn' });

      const [, init] = mockFn.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { sparql: string };
      expect(body.sparql).toContain('\\r');
    });

    it('escapes tabs in query text', async () => {
      const { tool, mockFn } = makeClientAndTool();

      await tool.handler({ query: 'col1\tcol2' });

      const [, init] = mockFn.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { sparql: string };
      expect(body.sparql).toContain('\\t');
    });

    it('rejects unknown status values from SPARQL filter', async () => {
      const { tool, mockFn } = makeClientAndTool();

      // Status not in enum — should be silently dropped from filter, not injected
      await tool.handler({ query: 'test', status: 'malicious" || 1=1 //' });

      const [, init] = mockFn.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { sparql: string };
      expect(body.sparql).not.toContain('malicious');
    });

    it('rejects unknown type values from SPARQL filter', async () => {
      const { tool, mockFn } = makeClientAndTool();

      await tool.handler({ query: 'test', type: 'bad_type" UNION SELECT' });

      const [, init] = mockFn.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { sparql: string };
      expect(body.sparql).not.toContain('UNION');
    });
  });

  describe('limit clamping', () => {
    it('clamps negative limit to 1', async () => {
      const { tool, mockFn } = makeClientAndTool();

      await tool.handler({ query: 'test', limit: -5 });

      const [, init] = mockFn.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { sparql: string };
      expect(body.sparql).toContain('LIMIT 1');
    });

    it('clamps limit above 100 to 100', async () => {
      const { tool, mockFn } = makeClientAndTool();

      await tool.handler({ query: 'test', limit: 9999 });

      const [, init] = mockFn.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { sparql: string };
      expect(body.sparql).toContain('LIMIT 100');
    });
  });

  describe('non-string query argument', () => {
    it('treats non-string query as empty string (no filter injected)', async () => {
      const { tool, mockFn } = makeClientAndTool();

      await tool.handler({ query: 42 });

      const [, init] = mockFn.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { sparql: string };
      expect(body.sparql).not.toContain('FILTER(CONTAINS');
    });
  });

  describe('limit edge cases', () => {
    it('treats NaN limit as 10 (default) — LIMIT 10 in SPARQL', async () => {
      const { tool, mockFn } = makeClientAndTool();

      await tool.handler({ query: 'test', limit: NaN });

      const [, init] = mockFn.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { sparql: string };
      expect(body.sparql).toContain('LIMIT 10');
      expect(body.sparql).not.toContain('LIMIT NaN');
    });

    it('treats Infinity limit as default 10 (non-finite falls back to default)', async () => {
      const { tool, mockFn } = makeClientAndTool();

      await tool.handler({ query: 'test', limit: Infinity });

      const [, init] = mockFn.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { sparql: string };
      // Infinity is not finite → falls back to default of 10
      expect(body.sparql).toContain('LIMIT 10');
      expect(body.sparql).not.toContain('LIMIT Infinity');
    });

    it('query string is trimmed and truncated to 500 chars', async () => {
      const { tool, mockFn } = makeClientAndTool();
      const longQuery = 'a'.repeat(600);

      await tool.handler({ query: longQuery });

      const [, init] = mockFn.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { sparql: string };
      // Truncated to 500 'a' chars
      expect(body.sparql).toContain('a'.repeat(500));
      expect(body.sparql).not.toContain('a'.repeat(501));
    });

    it('SPARQL query does not contain a GRAPH clause', async () => {
      const { tool, mockFn } = makeClientAndTool();

      await tool.handler({ query: 'vulnerability' });

      const [, init] = mockFn.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { sparql: string };
      expect(body.sparql).not.toContain('GRAPH');
    });
  });

  describe('response parsing', () => {
    it('returns count and artifacts array at top level', async () => {
      const bindings = [
        { id: 'urn:dkg:wm:abc', name: '"My Note"', type: '"research_note"', status: '"draft"', contentHash: '"sha256:abc"', capturedAt: '"2026-01-01T00:00:00.000Z"' },
      ];
      const { tool } = makeClientAndTool(bindings);
      const result = await tool.handler({ query: 'note' }) as Record<string, unknown>;
      expect(result['success']).toBe(true);
      expect(result['count']).toBe(1);
      expect(Array.isArray(result['artifacts'])).toBe(true);
      expect((result['artifacts'] as unknown[]).length).toBe(1);
    });

    it('strips surrounding double-quotes from N-Quads literal values', async () => {
      const bindings = [
        { id: 'urn:dkg:wm:abc', name: '"My Research Note"', type: '"research_note"', status: '"validated"', contentHash: '"sha256:abc"', capturedAt: '"2026-01-01T00:00:00.000Z"' },
      ];
      const { tool } = makeClientAndTool(bindings);
      const result = await tool.handler({ query: 'test' }) as Record<string, unknown>;
      const arts = result['artifacts'] as Array<Record<string, string>>;
      expect(arts[0]!['status']).toBe('validated');
      expect(arts[0]!['name']).toBe('My Research Note');
      expect(arts[0]!['type']).toBe('research_note');
      expect(arts[0]!['contentHash']).toBe('sha256:abc');
    });

    it('deduplicates by artifact id — keeps highest-priority status', async () => {
      // Same artifact appears twice: once as "draft", once as "validated" (after status update)
      const bindings = [
        { id: 'urn:dkg:wm:abc', name: '"Note"', type: '"chat"', status: '"validated"', contentHash: '"sha256:abc"', capturedAt: '"2026-01-01T00:00:00.000Z"' },
        { id: 'urn:dkg:wm:abc', name: '"Note"', type: '"chat"', status: '"draft"', contentHash: '"sha256:abc"', capturedAt: '"2026-01-01T00:00:00.000Z"' },
      ];
      const { tool } = makeClientAndTool(bindings);
      const result = await tool.handler({ query: 'test' }) as Record<string, unknown>;
      const arts = result['artifacts'] as Array<Record<string, string>>;
      expect(arts.length).toBe(1);
      expect(arts[0]!['status']).toBe('validated');
      expect(result['count']).toBe(1);
    });

    it('returns count 0 and empty artifacts when no bindings', async () => {
      const { tool } = makeClientAndTool([]);
      const result = await tool.handler({ query: 'nothing' }) as Record<string, unknown>;
      expect(result['success']).toBe(true);
      expect(result['count']).toBe(0);
      expect(result['artifacts']).toEqual([]);
      expect(typeof result['message']).toBe('string');
    });

    it('preserves multiple distinct artifacts without deduplication', async () => {
      const bindings = [
        { id: 'urn:dkg:wm:aaa', name: '"Note A"', type: '"chat"', status: '"draft"', contentHash: '"sha256:aaa"', capturedAt: '"2026-01-01T00:00:00.000Z"' },
        { id: 'urn:dkg:wm:bbb', name: '"Note B"', type: '"research_note"', status: '"validated"', contentHash: '"sha256:bbb"', capturedAt: '"2026-01-02T00:00:00.000Z"' },
      ];
      const { tool } = makeClientAndTool(bindings);
      const result = await tool.handler({ query: 'note' }) as Record<string, unknown>;
      expect(result['count']).toBe(2);
      expect((result['artifacts'] as unknown[]).length).toBe(2);
    });
  });
});
