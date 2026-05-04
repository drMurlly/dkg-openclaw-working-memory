import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DkgWmClient } from '../src/modules/dkg-wm-client.js';
import { DedupeStore } from '../src/modules/dedupe-store.js';
import { normalizeArtifact } from '../src/modules/artifact-normalizer.js';
import { serializeToQuads } from '../src/modules/jsonld-serializer.js';
import { createDepositTool } from '../src/tools/deposit-tool.js';
import type { PluginConfig } from '../src/types/artifact.js';

let tempDir: string;
let config: PluginConfig;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'integration-test-'));
  config = {
    daemonUrl: 'http://127.0.0.1:9200',
    authTokenPath: '~/.dkg/auth.token',
    enabled: true,
    contextGraph: 'wm-artifacts',
    assertionName: 'artifacts',
    authorId: 'drMurlly',
    agentId: 'openclaw-agent',
    capture: {
      autoCapture: true,
      chat: true,
      files: true,
      toolOutputs: true,
      minContentLength: 50,
      skipPatterns: [],
    },
    redaction: { enabled: true },
    dedupe: { enabled: true, strategy: 'contentHash' },
    stateDir: tempDir,
  };
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(tempDir, { recursive: true, force: true });
});

function setupMockDkg(responses: Array<{ ok: boolean; status: number; body?: unknown }>) {
  let i = 0;
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
    const resp = responses[i] ?? responses[responses.length - 1];
    i++;
    return {
      ok: resp.ok,
      status: resp.status,
      text: async () => JSON.stringify(resp.body ?? {}),
    };
  }));
}

describe('E2E integration (mocked DKG daemon)', () => {
  it('full deposit flow: normalize → serialize → write → UAL stored', async () => {
    setupMockDkg([
      { ok: true, status: 200, body: {} },                                         // ensureContextGraph
      { ok: true, status: 200, body: { assertionUri: 'ual:dkg:test:abc123' } },    // createAssertion
      { ok: true, status: 200, body: { written: 20 } },                            // writeAssertion
    ]);

    const client = new DkgWmClient({ daemonUrl: config.daemonUrl, token: 'test-token' });
    const dedupe = new DedupeStore({ stateDir: tempDir });
    await dedupe.load();

    await client.ensureContextGraph(config.contextGraph);

    const content = 'The reentrancy vulnerability in Protocol X was identified through static analysis. The function allows re-entry before state update.';
    const raw = {
      content,
      source: 'manual' as const,
      artifactType: 'vulnerability_finding' as const,
      sessionId: 'session-abc',
    };

    const artifact = normalizeArtifact(raw, config)!;
    expect(artifact).not.toBeNull();

    const quads = serializeToQuads(artifact);
    expect(quads.some(q => q.object.includes('WorkingMemoryArtifact'))).toBe(true);

    const receipt = await client.createOrWriteAssertion({
      contextGraphId: config.contextGraph,
      name: config.assertionName,
      quads,
      assertionExists: dedupe.isAssertionCreated(),
    });

    expect(receipt.ual).toBe('ual:dkg:test:abc123');

    dedupe.markAssertionCreated();
    dedupe.add(artifact.contentHash, receipt.ual);
    await dedupe.save();

    // reload — UAL persisted
    const dedupe2 = new DedupeStore({ stateDir: tempDir });
    await dedupe2.load();
    expect(dedupe2.isAssertionCreated()).toBe(true);
    const record = dedupe2.getRecord(artifact.contentHash);
    expect(record?.ual).toBe('ual:dkg:test:abc123');
  });

  it('deposit tool: deduplicates repeated deposits', async () => {
    setupMockDkg([
      { ok: true, status: 200, body: {} },                                     // ensureContextGraph
      { ok: true, status: 200, body: { assertionUri: 'ual:dkg:first' } },      // createAssertion
      { ok: true, status: 200, body: { written: 5 } },                         // writeAssertion
    ]);

    const client = new DkgWmClient({ daemonUrl: config.daemonUrl, token: 'test-token' });
    const dedupe = new DedupeStore({ stateDir: tempDir });
    await dedupe.load();
    await client.ensureContextGraph(config.contextGraph);

    const tool = createDepositTool({ client, dedupe, config });
    const content = 'This is a substantial research note about smart contract vulnerabilities in DeFi protocols.';

    const result1 = await tool.handler({ content, artifactType: 'research_note' }) as Record<string, unknown>;
    expect(result1['success']).toBe(true);
    expect(result1['ual']).toBe('ual:dkg:first');

    // second call with same content → deduplicated
    const result2 = await tool.handler({ content, artifactType: 'research_note' }) as Record<string, unknown>;
    expect(result2['success']).toBe(true);
    expect(result2['deduplicated']).toBe(true);

    // fetch only called 3 times (exists + create + first write), not 4
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });

  it('deposit tool: secrets are not written to DKG', async () => {
    const capturedBodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      if (init.body) capturedBodies.push(JSON.parse(init.body as string));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ual: 'ual:test:secret-check' }),
      };
    }));

    const client = new DkgWmClient({ daemonUrl: config.daemonUrl, token: 'test-token' });
    const dedupe = new DedupeStore({ stateDir: tempDir });

    const fakeKey = 'sk-' + 'x'.repeat(30);
    const tool = createDepositTool({ client, dedupe, config });

    await tool.handler({
      content: `Research notes: found reentrancy issue. My OpenAI key is ${fakeKey} but ignore that.`,
      artifactType: 'research_note',
    });

    const allBodies = JSON.stringify(capturedBodies);
    expect(allBodies).not.toContain(fakeKey);
    expect(allBodies).toContain('[REDACTED]');
  });
});
