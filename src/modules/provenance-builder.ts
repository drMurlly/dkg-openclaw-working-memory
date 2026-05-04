import { createHash } from 'node:crypto';
import type { ProvenanceRecord, RawCaptureInput, PluginConfig } from '../types/artifact.js';

export interface ProvenanceResult {
  contentHash: string;
  artifactId: string;
  provenance: ProvenanceRecord;
}

export function buildProvenance(
  content: string,
  raw: RawCaptureInput,
  _config: PluginConfig,
): ProvenanceResult {
  const hex = createHash('sha256').update(content, 'utf8').digest('hex');
  const contentHash = `sha256:${hex}`;
  const artifactId = `urn:dkg:wm:${hex.slice(0, 16)}`;
  const now = new Date().toISOString();

  const provenance: ProvenanceRecord = {
    source: raw.source,
    sessionId: raw.sessionId ?? 'unknown',
    conversationId: raw.conversationId,
    toolCalls: raw.toolCalls,
    filePaths: raw.filePaths,
    workspaceProject: raw.workspaceProject,
    createdAt: now,
    capturedAt: now,
  };

  return { contentHash, artifactId, provenance };
}
