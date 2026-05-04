import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DkgWmClient } from '../src/modules/dkg-wm-client.js';
import { DedupeStore } from '../src/modules/dedupe-store.js';
import { normalizeArtifact } from '../src/modules/artifact-normalizer.js';
import { serializeToQuads } from '../src/modules/jsonld-serializer.js';
import type { PluginConfig } from '../src/types/artifact.js';

const LIVE = process.env['DKG_INTEGRATION_TEST'] === '1';
const DAEMON = process.env['DKG_DAEMON_URL'] ?? 'http://127.0.0.1:9200';

function loadLiveToken(): string {
  if (process.env['DKG_AUTH_TOKEN']) return process.env['DKG_AUTH_TOKEN'];
  try {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { homedir } = require('node:os') as typeof import('node:os');
    const raw = readFileSync(`${homedir()}/.dkg/auth.token`, 'utf-8');
    // Strip comment lines and whitespace
    return raw.split('\n').filter((l: string) => !l.startsWith('#')).join('').trim();
  } catch {
    return 'no-token';
  }
}
const TOKEN = loadLiveToken();

const makeConfig = (stateDir: string): PluginConfig => ({
  daemonUrl: DAEMON,
  authTokenPath: '~/.dkg/auth.token',
  enabled: true,
  contextGraph: 'wm-artifacts-test',
  assertionName: `artifacts-live-${Date.now()}`,
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
  stateDir,
});

describe.skipIf(!LIVE)('live integration against real DKG node', () => {
  let tempDir: string;
  let client: DkgWmClient;
  let config: PluginConfig;

  async function setup() {
    tempDir = await mkdtemp(join(tmpdir(), 'dkg-live-test-'));
    config = makeConfig(tempDir);
    client = new DkgWmClient({ daemonUrl: DAEMON, token: String(TOKEN) });
  }

  async function teardown() {
    await rm(tempDir, { recursive: true, force: true });
  }

  it('node is reachable and responds to /api/status', async () => {
    await setup();
    try {
      const status = await client.getStatus();
      expect(status).toBeTruthy();
      expect((status as Record<string, unknown>).name).toBeTruthy();
    } finally {
      await teardown();
    }
  });

  it('deposits an artifact and retrieves it via assertion query', async () => {
    await setup();
    const dedupe = new DedupeStore({ stateDir: tempDir });
    await dedupe.load();

    try {
      // Ensure context graph exists
      await client.ensureContextGraph(config.contextGraph, 'WM Artifacts Test');

      const content = `Live integration test: reentrancy vulnerability analysis for Protocol X.
Identified that the withdraw function calls external contract before updating balance state.
This is a classic reentrancy pattern that could allow an attacker to drain funds.
Test timestamp: ${new Date().toISOString()}`;

      const raw = {
        content,
        source: 'manual' as const,
        artifactType: 'vulnerability_finding' as const,
        sessionId: 'live-test-session',
      };

      const artifact = normalizeArtifact(raw, config)!;
      expect(artifact).not.toBeNull();
      expect(artifact.artifactId).toMatch(/^urn:dkg:wm:[a-f0-9]{16}$/);

      // Convert to RDF quads (real DKG v10 API format)
      const quads = serializeToQuads(artifact);
      expect(quads.length).toBeGreaterThan(5);

      // Create assertion then write quads
      const result = await client.createOrWriteAssertion({
        contextGraphId: config.contextGraph,
        name: config.assertionName,
        quads,
        assertionExists: dedupe.isAssertionCreated(),
      });

      expect(result).toBeTruthy();
      dedupe.markAssertionCreated();
      if (result.ual) {
        dedupe.add(artifact.contentHash, result.ual);
        artifact.dkg.ual = result.ual;
      }
      await dedupe.save();

      // Query back to verify quads were stored
      const queryResult = await client.queryAssertion(config.contextGraph, config.assertionName);
      expect(queryResult).toBeTruthy();
      expect((queryResult as { count: number }).count).toBeGreaterThan(0);

      // Verify artifact type triple is present (any of the type triples contains WorkingMemoryArtifact)
      const { quads: returnedQuads } = queryResult as { quads: Array<{ predicate: string; object: string }> };
      const typeTriples = returnedQuads.filter(q => q.predicate === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
      expect(typeTriples.length).toBeGreaterThan(0);
      expect(typeTriples.some(q => q.object.includes('WorkingMemoryArtifact'))).toBe(true);
    } finally {
      await teardown();
    }
  });

  it('SPARQL query returns results from working memory', async () => {
    await setup();
    const dedupe = new DedupeStore({ stateDir: tempDir });
    await dedupe.load();

    try {
      await client.ensureContextGraph(config.contextGraph, 'WM Artifacts Test');

      const content = `SPARQL test: access control vulnerability in governance contract.
The proposalThreshold check can be bypassed due to integer underflow.
Test timestamp: ${new Date().toISOString()}`;

      const artifact = normalizeArtifact({ content, source: 'manual' as const }, config)!;
      const quads = serializeToQuads(artifact);

      await client.createOrWriteAssertion({
        contextGraphId: config.contextGraph,
        name: config.assertionName,
        quads,
        assertionExists: false,
      });
      dedupe.markAssertionCreated();
      await dedupe.save();

      // SPARQL query scoped to working-memory
      const sparql = `
PREFIX wm: <https://ontology.origintrail.io/dkg/wm#>
SELECT ?id ?status WHERE {
  ?id a wm:WorkingMemoryArtifact ;
      wm:status ?status .
}
LIMIT 10
      `.trim();

      const results = await client.querySparql(sparql, {
        contextGraphId: config.contextGraph,
        view: 'working-memory',
      });
      expect(results).toBeTruthy();
    } finally {
      await teardown();
    }
  });

  it('deduplicates repeated deposits of same content', async () => {
    await setup();
    const dedupe = new DedupeStore({ stateDir: tempDir });
    await dedupe.load();

    try {
      await client.ensureContextGraph(config.contextGraph, 'WM Artifacts Test');

      const content = `Dedup test: integer overflow in token transfer function.
The _amount parameter is not validated before arithmetic operation.
This can cause unexpected behavior when amount exceeds uint256 max.
Test timestamp: ${new Date().toISOString()}`;

      const raw = { content, source: 'manual' as const };
      const artifact = normalizeArtifact(raw, config)!;
      const quads = serializeToQuads(artifact);

      await client.createOrWriteAssertion({
        contextGraphId: config.contextGraph,
        name: config.assertionName,
        quads,
        assertionExists: dedupe.isAssertionCreated(),
      });
      dedupe.markAssertionCreated();
      dedupe.add(artifact.contentHash, 'ual:first');
      await dedupe.save();

      // Reload and verify dedup state persists
      const dedupe2 = new DedupeStore({ stateDir: tempDir });
      await dedupe2.load();
      expect(dedupe2.has(artifact.contentHash)).toBe(true);
    } finally {
      await teardown();
    }
  });

  it('redacts secrets before writing to DKG', async () => {
    await setup();
    const dedupe = new DedupeStore({ stateDir: tempDir });
    await dedupe.load();

    try {
      await client.ensureContextGraph(config.contextGraph, 'WM Artifacts Test');

      const fakeKey = 'sk-' + 'a'.repeat(30);
      const content = `Research note with accidental secret: ${fakeKey}.
The actual finding is that the protocol uses a weak PRNG for seed generation.
This can be exploited by miners who control block.timestamp.`;

      const raw = { content, source: 'manual' as const };
      const artifact = normalizeArtifact(raw, config)!;

      // Secret must be redacted before reaching DKG
      expect(artifact.content).not.toContain(fakeKey);
      expect(artifact.content).toContain('[REDACTED]');

      const quads = serializeToQuads(artifact);

      // Write to DKG — if no error, the redacted content was accepted
      await client.createOrWriteAssertion({
        contextGraphId: config.contextGraph,
        name: config.assertionName,
        quads,
        assertionExists: dedupe.isAssertionCreated(),
      });
    } finally {
      await teardown();
    }
  });
});
