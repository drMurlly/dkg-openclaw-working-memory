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

function makeClientAndTool() {
  const mockFn = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ results: [] }),
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
});
