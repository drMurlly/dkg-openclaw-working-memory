import { describe, it, expect } from 'vitest';
import { serializeToJsonLd, serializeStatusUpdate } from '../src/modules/jsonld-serializer.js';
import type { ArtifactRecord } from '../src/types/artifact.js';

const artifact: ArtifactRecord = {
  artifactId: 'urn:dkg:wm:abc123def456abcd',
  artifactType: 'research_note',
  title: 'Reentrancy Vulnerability in Protocol X',
  content: 'Detailed analysis of reentrancy vulnerability...',
  contentHash: 'sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  status: 'draft',
  author: { id: 'drMurlly' },
  agent: { id: 'openclaw-agent', framework: 'openclaw', version: '1.0.0' },
  provenance: {
    source: 'chat',
    sessionId: 'session-123',
    createdAt: '2026-05-04T12:00:00.000Z',
    capturedAt: '2026-05-04T12:00:00.000Z',
    workspaceProject: 'wm-artifacts',
  },
  dkg: {
    contextGraph: 'wm-artifacts',
    assertionName: 'artifacts',
    memoryLayer: 'working-memory',
  },
};

describe('jsonld-serializer', () => {
  it('@id matches artifact.artifactId', () => {
    const jsonld = serializeToJsonLd(artifact);
    expect(jsonld['@id']).toBe('urn:dkg:wm:abc123def456abcd');
  });

  it('@type is wm:WorkingMemoryArtifact', () => {
    const jsonld = serializeToJsonLd(artifact);
    expect(jsonld['@type']).toBe('wm:WorkingMemoryArtifact');
  });

  it('wm:status field is present and correct', () => {
    const jsonld = serializeToJsonLd(artifact);
    expect(jsonld['wm:status']).toBe('draft');
  });

  it('wm:contentHash field is present', () => {
    const jsonld = serializeToJsonLd(artifact);
    expect(jsonld['wm:contentHash']).toBe(artifact.contentHash);
  });

  it('wm:provenance block present with wm:source', () => {
    const jsonld = serializeToJsonLd(artifact);
    const prov = jsonld['wm:provenance'] as Record<string, unknown>;
    expect(prov).toBeTruthy();
    expect(prov['wm:source']).toBe('chat');
    expect(prov['wm:sessionId']).toBe('session-123');
  });

  it('@context has wm, dkg, schema prefixes', () => {
    const jsonld = serializeToJsonLd(artifact);
    const ctx = jsonld['@context'] as Record<string, string>;
    expect(ctx['wm']).toBe('https://ontology.origintrail.io/dkg/wm#');
    expect(ctx['dkg']).toBe('https://ontology.origintrail.io/dkg/1.0#');
    expect(ctx['schema']).toBe('https://schema.org/');
  });

  it('schema:author has @id with author prefix', () => {
    const jsonld = serializeToJsonLd(artifact);
    const author = jsonld['schema:author'] as Record<string, string>;
    expect(author['@id']).toBe('urn:author:drMurlly');
  });

  it('wm:ual not present when artifact has no UAL', () => {
    const jsonld = serializeToJsonLd(artifact);
    expect('wm:ual' in jsonld).toBe(false);
  });

  it('wm:ual present when artifact has UAL', () => {
    const withUal = { ...artifact, dkg: { ...artifact.dkg, ual: 'ual:dkg:test123' } };
    const jsonld = serializeToJsonLd(withUal);
    expect(jsonld['wm:ual']).toBe('ual:dkg:test123');
  });

  it('serializeStatusUpdate produces correct structure', () => {
    const update = serializeStatusUpdate('urn:dkg:wm:abc123', 'validated', '2026-05-04T13:00:00.000Z');
    expect(update['@id']).toBe('urn:dkg:wm:abc123');
    expect(update['@type']).toBe('wm:WorkingMemoryArtifact');
    expect(update['wm:status']).toBe('validated');
  });
});
