import { describe, it, expect } from 'vitest';
import { buildProvenance } from '../src/modules/provenance-builder.js';
import type { PluginConfig, RawCaptureInput } from '../src/types/artifact.js';

const baseConfig: PluginConfig = {
  daemonUrl: 'http://127.0.0.1:9200',
  authTokenPath: '~/.dkg/auth.token',
  enabled: true,
  contextGraph: 'wm-artifacts',
  assertionName: 'artifacts',
  authorId: 'test-author',
  agentId: 'test-agent',
  capture: { autoCapture: true, chat: true, files: true, toolOutputs: true, minContentLength: 10, skipPatterns: [] },
  redaction: { enabled: true },
  dedupe: { enabled: true, strategy: 'contentHash' },
  stateDir: '/tmp/test-state',
};

const baseRaw: RawCaptureInput = {
  content: 'Test content for provenance',
  source: 'chat',
};

describe('provenance-builder', () => {
  it('produces a sha256: prefixed content hash', () => {
    const { contentHash } = buildProvenance('test content', baseRaw, baseConfig);
    expect(contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('produces a urn:dkg:wm: prefixed artifact ID', () => {
    const { artifactId } = buildProvenance('test content', baseRaw, baseConfig);
    expect(artifactId).toMatch(/^urn:dkg:wm:[a-f0-9]{16}$/);
  });

  it('is deterministic — same content → same hash and id', () => {
    const result1 = buildProvenance('exact same content', baseRaw, baseConfig);
    const result2 = buildProvenance('exact same content', baseRaw, baseConfig);
    expect(result1.contentHash).toBe(result2.contentHash);
    expect(result1.artifactId).toBe(result2.artifactId);
  });

  it('different content → different hash', () => {
    const r1 = buildProvenance('content A', baseRaw, baseConfig);
    const r2 = buildProvenance('content B', baseRaw, baseConfig);
    expect(r1.contentHash).not.toBe(r2.contentHash);
  });

  it('sets sessionId to "unknown" when missing', () => {
    const { provenance } = buildProvenance('content', baseRaw, baseConfig);
    expect(provenance.sessionId).toBe('unknown');
  });

  it('preserves provided sessionId', () => {
    const raw: RawCaptureInput = { ...baseRaw, sessionId: 'session-123' };
    const { provenance } = buildProvenance('content', raw, baseConfig);
    expect(provenance.sessionId).toBe('session-123');
  });

  it('sets createdAt and capturedAt as ISO-8601', () => {
    const { provenance } = buildProvenance('content', baseRaw, baseConfig);
    expect(new Date(provenance.createdAt).toISOString()).toBe(provenance.createdAt);
    expect(new Date(provenance.capturedAt).toISOString()).toBe(provenance.capturedAt);
  });
});
