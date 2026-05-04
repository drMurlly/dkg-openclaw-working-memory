import type { ArtifactRecord } from '../types/artifact.js';

const CONTEXT = {
  dkg: 'https://ontology.origintrail.io/dkg/1.0#',
  wm: 'https://ontology.origintrail.io/dkg/wm#',
  schema: 'https://schema.org/',
};

export function serializeToJsonLd(artifact: ArtifactRecord): Record<string, unknown> {
  return {
    '@context': CONTEXT,
    '@id': artifact.artifactId,
    '@type': 'wm:WorkingMemoryArtifact',
    'wm:artifactType': artifact.artifactType,
    'wm:status': artifact.status,
    'wm:contentHash': artifact.contentHash,
    'schema:name': artifact.title,
    'schema:text': artifact.content,
    'schema:author': { '@id': `urn:author:${artifact.author.id}` },
    'wm:agent': {
      '@id': `urn:agent:${artifact.agent.id}`,
      'wm:framework': artifact.agent.framework,
      'schema:version': artifact.agent.version,
    },
    'wm:provenance': {
      '@type': 'wm:ProvenanceRecord',
      'wm:source': artifact.provenance.source,
      'wm:sessionId': artifact.provenance.sessionId ?? 'unknown',
      'wm:conversationId': artifact.provenance.conversationId,
      'wm:workspaceProject': artifact.provenance.workspaceProject,
      'schema:dateCreated': artifact.provenance.createdAt,
      'wm:capturedAt': artifact.provenance.capturedAt,
      'wm:modifiedAt': artifact.provenance.modifiedAt,
    },
    'dkg:contextGraph': artifact.dkg.contextGraph,
    'dkg:assertionName': artifact.dkg.assertionName,
    'dkg:memoryLayer': artifact.dkg.memoryLayer,
    ...(artifact.dkg.ual ? { 'wm:ual': artifact.dkg.ual } : {}),
  };
}

export function serializeStatusUpdate(
  artifactId: string,
  newStatus: string,
  modifiedAt: string,
): Record<string, unknown> {
  return {
    '@context': CONTEXT,
    '@id': artifactId,
    '@type': 'wm:WorkingMemoryArtifact',
    'wm:status': newStatus,
    'wm:provenance': {
      '@type': 'wm:ProvenanceRecord',
      'wm:modifiedAt': modifiedAt,
    },
  };
}
