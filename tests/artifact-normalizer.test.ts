import { describe, it, expect } from 'vitest';
import { normalizeArtifact } from '../src/modules/artifact-normalizer.js';
import type { PluginConfig, RawCaptureInput } from '../src/types/artifact.js';

const config: PluginConfig = {
  daemonUrl: 'http://127.0.0.1:9200',
  authTokenPath: '~/.dkg/auth.token',
  enabled: true,
  contextGraph: 'wm-artifacts',
  assertionName: 'artifacts',
  authorId: 'drMurlly',
  agentId: 'openclaw-agent',
  capture: { autoCapture: true, chat: true, files: true, toolOutputs: true, minContentLength: 50, skipPatterns: [] },
  redaction: { enabled: true },
  dedupe: { enabled: true, strategy: 'contentHash' },
  stateDir: '/tmp/test',
};

const longContent = 'This is a detailed research note about smart contract security. It covers reentrancy, integer overflow, and access control issues.';

describe('artifact-normalizer', () => {
  it('returns null for content shorter than minContentLength', () => {
    const raw: RawCaptureInput = { content: 'short', source: 'chat' };
    expect(normalizeArtifact(raw, config)).toBeNull();
  });

  it('returns null for content exactly at minContentLength - 1', () => {
    const raw: RawCaptureInput = { content: 'x'.repeat(49), source: 'chat' };
    expect(normalizeArtifact(raw, config)).toBeNull();
  });

  it('returns artifact for content at minContentLength', () => {
    const raw: RawCaptureInput = { content: 'x'.repeat(50), source: 'chat' };
    expect(normalizeArtifact(raw, config)).not.toBeNull();
  });

  it('all required fields are present', () => {
    const raw: RawCaptureInput = { content: longContent, source: 'chat' };
    const artifact = normalizeArtifact(raw, config)!;

    expect(artifact.artifactId).toBeTruthy();
    expect(artifact.artifactType).toBeTruthy();
    expect(artifact.title).toBeTruthy();
    expect(artifact.content).toBeTruthy();
    expect(artifact.contentHash).toBeTruthy();
    expect(artifact.status).toBeTruthy();
    expect(artifact.author.id).toBe('drMurlly');
    expect(artifact.agent.framework).toBe('openclaw');
    expect(artifact.provenance.source).toBe('chat');
    expect(artifact.provenance.createdAt).toBeTruthy();
    expect(artifact.dkg.contextGraph).toBe('wm-artifacts');
    expect(artifact.dkg.memoryLayer).toBe('working-memory');
  });

  it('same content produces same artifactId (stable IDs)', () => {
    const raw: RawCaptureInput = { content: longContent, source: 'chat' };
    const a1 = normalizeArtifact(raw, config)!;
    const a2 = normalizeArtifact(raw, config)!;
    expect(a1.artifactId).toBe(a2.artifactId);
    expect(a1.contentHash).toBe(a2.contentHash);
  });

  it('redacts secrets from content before returning', () => {
    const withSecret = longContent + ' My token: sk-' + 'x'.repeat(30);
    const raw: RawCaptureInput = { content: withSecret, source: 'chat' };
    const artifact = normalizeArtifact(raw, config)!;
    expect(artifact.content).not.toContain('sk-' + 'x'.repeat(30));
    expect(artifact.content).toContain('[REDACTED]');
  });

  it('auto-detects markdown type for .md files', () => {
    const raw: RawCaptureInput = {
      content: longContent,
      source: 'file',
      filePaths: ['docs/notes.md'],
    };
    const artifact = normalizeArtifact(raw, config)!;
    expect(artifact.artifactType).toBe('markdown');
  });

  it('uses provided artifactType', () => {
    const raw: RawCaptureInput = {
      content: longContent,
      source: 'manual',
      artifactType: 'vulnerability_finding',
    };
    const artifact = normalizeArtifact(raw, config)!;
    expect(artifact.artifactType).toBe('vulnerability_finding');
  });

  it('uses provided title', () => {
    const raw: RawCaptureInput = {
      content: longContent,
      source: 'manual',
      title: 'My Custom Title',
    };
    const artifact = normalizeArtifact(raw, config)!;
    expect(artifact.title).toBe('My Custom Title');
  });

  it('uses provided status override', () => {
    const raw: RawCaptureInput = {
      content: longContent,
      source: 'manual',
      status: 'validated',
    };
    const artifact = normalizeArtifact(raw, config)!;
    expect(artifact.status).toBe('validated');
  });

  it('populates workspaceProject from config.contextGraph when not provided', () => {
    const raw: RawCaptureInput = { content: longContent, source: 'chat' };
    const artifact = normalizeArtifact(raw, config)!;
    expect(artifact.provenance.workspaceProject).toBe('wm-artifacts');
  });

  it('returns null for content exceeding 500KB', () => {
    const raw: RawCaptureInput = { content: 'x'.repeat(500_001), source: 'chat' };
    expect(normalizeArtifact(raw, config)).toBeNull();
  });

  it('returns null for non-string content', () => {
    const raw = { content: null, source: 'chat' } as unknown as RawCaptureInput;
    expect(normalizeArtifact(raw, config)).toBeNull();
  });

  it('infers implementation_log type for source=file with non-.md paths', () => {
    const raw: RawCaptureInput = {
      content: longContent,
      source: 'file',
      filePaths: ['src/utils/helpers.ts', 'src/index.ts'],
    };
    const artifact = normalizeArtifact(raw, config)!;
    expect(artifact.artifactType).toBe('implementation_log');
  });

  it('infers research_note type for source=tool', () => {
    const raw: RawCaptureInput = { content: longContent, source: 'tool' };
    const artifact = normalizeArtifact(raw, config)!;
    expect(artifact.artifactType).toBe('research_note');
  });

  it('infers other type for source=api without explicit type', () => {
    const raw: RawCaptureInput = { content: longContent, source: 'api' };
    const artifact = normalizeArtifact(raw, config)!;
    expect(artifact.artifactType).toBe('other');
  });

  it('carries through sessionId and conversationId in provenance', () => {
    const raw: RawCaptureInput = {
      content: longContent,
      source: 'chat',
      sessionId: 'sess-999',
      conversationId: 'conv-777',
    };
    const artifact = normalizeArtifact(raw, config)!;
    expect(artifact.provenance.sessionId).toBe('sess-999');
    expect(artifact.provenance.conversationId).toBe('conv-777');
  });

  it('generates title from first 80 chars when no title provided', () => {
    const raw: RawCaptureInput = { content: longContent, source: 'chat' };
    const artifact = normalizeArtifact(raw, config)!;
    expect(artifact.title.length).toBeLessThanOrEqual(80);
    expect(artifact.title.length).toBeGreaterThan(0);
  });

  it('does not redact content when redaction is disabled', () => {
    const withKey = longContent + ' KEY=sk-' + 'x'.repeat(30);
    const noRedactConfig = { ...config, redaction: { enabled: false } };
    const artifact = normalizeArtifact({ content: withKey, source: 'chat' }, noRedactConfig)!;
    expect(artifact.content).toContain('sk-');
  });
});
