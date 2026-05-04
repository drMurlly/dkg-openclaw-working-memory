import { describe, it, expect } from 'vitest';
import { serializeToJsonLd, serializeToQuads, serializeStatusUpdateQuads } from '../src/modules/jsonld-serializer.js';
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

  it('serializeStatusUpdateQuads produces correct quads', () => {
    const quads = serializeStatusUpdateQuads('urn:dkg:wm:abc123', 'validated', '2026-05-04T13:00:00.000Z');
    expect(Array.isArray(quads)).toBe(true);
    const statusQuad = quads.find(q => q.predicate.includes('status'));
    expect(statusQuad).toBeDefined();
    expect(statusQuad!.subject).toBe('urn:dkg:wm:abc123');
    expect(statusQuad!.object).toBe('"validated"');
  });
});

describe('serializeToQuads', () => {
  it('returns an array of RDF quads', () => {
    const quads = serializeToQuads(artifact);
    expect(Array.isArray(quads)).toBe(true);
    expect(quads.length).toBeGreaterThan(10);
  });

  it('includes rdf:type = wm:WorkingMemoryArtifact triple', () => {
    const quads = serializeToQuads(artifact);
    const typeQuad = quads.find(
      q => q.predicate === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' &&
           q.object.includes('WorkingMemoryArtifact'),
    );
    expect(typeQuad).toBeDefined();
    expect(typeQuad!.subject).toBe(artifact.artifactId);
  });

  it('wraps string values as N-Quads literals (double-quoted)', () => {
    const quads = serializeToQuads(artifact);
    const statusQuad = quads.find(q => q.predicate.includes('status'));
    expect(statusQuad!.object).toBe('"draft"');
  });

  it('includes all core artifact fields', () => {
    const quads = serializeToQuads(artifact);
    const predicates = quads.map(q => q.predicate);
    expect(predicates.some(p => p.includes('artifactType'))).toBe(true);
    expect(predicates.some(p => p.includes('contentHash'))).toBe(true);
    expect(predicates.some(p => p.includes('schema.org/name'))).toBe(true);
    expect(predicates.some(p => p.includes('schema.org/text'))).toBe(true);
  });

  it('includes provenance node with capturedAt', () => {
    const quads = serializeToQuads(artifact);
    const capturedAtQuad = quads.find(q => q.predicate.includes('capturedAt'));
    expect(capturedAtQuad).toBeDefined();
    expect(capturedAtQuad!.object).toContain('2026-05-04');
  });

  it('includes agent node with framework', () => {
    const quads = serializeToQuads(artifact);
    const frameworkQuad = quads.find(q => q.predicate.includes('framework'));
    expect(frameworkQuad).toBeDefined();
    expect(frameworkQuad!.object).toBe('"openclaw"');
  });

  it('includes conversationId quad when conversationId is set', () => {
    const withConversation = {
      ...artifact,
      provenance: { ...artifact.provenance, conversationId: 'conv-abc-123' },
    };
    const quads = serializeToQuads(withConversation);
    const convQuad = quads.find(q => q.predicate.includes('conversationId'));
    expect(convQuad).toBeDefined();
    expect(convQuad!.object).toBe('"conv-abc-123"');
  });

  it('omits conversationId quad when conversationId is absent', () => {
    const quads = serializeToQuads(artifact); // artifact has no conversationId
    expect(quads.some(q => q.predicate.includes('conversationId'))).toBe(false);
  });

  it('includes ual quad when dkg.ual is set', () => {
    const withUal = { ...artifact, dkg: { ...artifact.dkg, ual: 'ual:dkg:abc123' } };
    const quads = serializeToQuads(withUal);
    const ualQuad = quads.find(q => q.predicate.includes('ual'));
    expect(ualQuad).toBeDefined();
    expect(ualQuad!.object).toBe('"ual:dkg:abc123"');
  });

  it('omits ual quad when dkg.ual is absent', () => {
    const quads = serializeToQuads(artifact); // artifact has no ual
    expect(quads.some(q => q.predicate.includes('wm#ual'))).toBe(false);
  });

  it('escapes special characters in literal values', () => {
    const withSpecial = {
      ...artifact,
      title: 'Title with "quotes" and \\backslash and\nnewline',
    };
    const quads = serializeToQuads(withSpecial);
    const nameQuad = quads.find(q => q.predicate.includes('schema.org/name'));
    expect(nameQuad!.object).toContain('\\"quotes\\"');
    expect(nameQuad!.object).toContain('\\\\backslash');
    expect(nameQuad!.object).toContain('\\n');
  });
});
