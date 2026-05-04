import type { ArtifactRecord } from '../types/artifact.js';
import type { RdfQuad } from './dkg-wm-client.js';

const CONTEXT = {
  dkg: 'https://ontology.origintrail.io/dkg/1.0#',
  wm: 'https://ontology.origintrail.io/dkg/wm#',
  schema: 'https://schema.org/',
};

const WM = 'https://ontology.origintrail.io/dkg/wm#';
const SCHEMA = 'https://schema.org/';
const DKG = 'https://ontology.origintrail.io/dkg/1.0#';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

/** Escape a string value for use as an N-Quads literal object. */
function lit(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/**
 * Serialize an ArtifactRecord to the RDF quad format expected by the DKG v10 daemon.
 * Each quad has { subject, predicate, object } where object is either a URI or
 * an N-Quads literal (string wrapped in double-quotes).
 */
export function serializeToQuads(artifact: ArtifactRecord): RdfQuad[] {
  const s = artifact.artifactId;
  const provenanceId = `${s}/provenance`;
  const agentId = `urn:agent:${artifact.agent.id}`;
  const authorId = `urn:author:${artifact.author.id}`;

  const quads: RdfQuad[] = [
    // Core type
    { subject: s, predicate: RDF_TYPE, object: `${WM}WorkingMemoryArtifact` },
    // Artifact fields
    { subject: s, predicate: `${WM}artifactType`, object: lit(artifact.artifactType) },
    { subject: s, predicate: `${WM}status`, object: lit(artifact.status) },
    { subject: s, predicate: `${WM}contentHash`, object: lit(artifact.contentHash) },
    { subject: s, predicate: `${SCHEMA}name`, object: lit(artifact.title) },
    { subject: s, predicate: `${SCHEMA}text`, object: lit(artifact.content) },
    { subject: s, predicate: `${SCHEMA}author`, object: authorId },
    // DKG metadata
    { subject: s, predicate: `${DKG}contextGraph`, object: lit(artifact.dkg.contextGraph) },
    { subject: s, predicate: `${DKG}assertionName`, object: lit(artifact.dkg.assertionName) },
    { subject: s, predicate: `${DKG}memoryLayer`, object: lit(artifact.dkg.memoryLayer) },
    // Agent
    { subject: s, predicate: `${WM}agent`, object: agentId },
    { subject: agentId, predicate: RDF_TYPE, object: `${WM}Agent` },
    { subject: agentId, predicate: `${WM}framework`, object: lit(artifact.agent.framework) },
    { subject: agentId, predicate: `${SCHEMA}version`, object: lit(artifact.agent.version) },
    // Provenance
    { subject: s, predicate: `${WM}provenance`, object: provenanceId },
    { subject: provenanceId, predicate: RDF_TYPE, object: `${WM}ProvenanceRecord` },
    { subject: provenanceId, predicate: `${WM}source`, object: lit(artifact.provenance.source) },
    { subject: provenanceId, predicate: `${WM}sessionId`, object: lit(artifact.provenance.sessionId ?? 'unknown') },
    { subject: provenanceId, predicate: `${SCHEMA}dateCreated`, object: lit(artifact.provenance.createdAt) },
    { subject: provenanceId, predicate: `${WM}capturedAt`, object: lit(artifact.provenance.capturedAt) },
    { subject: provenanceId, predicate: `${WM}modifiedAt`, object: lit(artifact.provenance.modifiedAt ?? artifact.provenance.capturedAt) },
  ];

  if (artifact.provenance.conversationId) {
    quads.push({ subject: provenanceId, predicate: `${WM}conversationId`, object: lit(artifact.provenance.conversationId) });
  }
  if (artifact.provenance.workspaceProject) {
    quads.push({ subject: provenanceId, predicate: `${WM}workspaceProject`, object: lit(artifact.provenance.workspaceProject) });
  }
  if (artifact.dkg.ual) {
    quads.push({ subject: s, predicate: `${WM}ual`, object: lit(artifact.dkg.ual) });
  }

  return quads;
}

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

export function serializeStatusUpdateQuads(
  artifactId: string,
  newStatus: string,
  modifiedAt: string,
): RdfQuad[] {
  const provenanceId = `${artifactId}/provenance`;
  return [
    { subject: artifactId, predicate: `${WM}status`, object: lit(newStatus) },
    { subject: provenanceId, predicate: `${WM}modifiedAt`, object: lit(modifiedAt) },
  ];
}
