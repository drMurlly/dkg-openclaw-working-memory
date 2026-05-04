export type ArtifactType =
  | 'chat'
  | 'research_note'
  | 'code_analysis'
  | 'markdown'
  | 'plan'
  | 'summary'
  | 'design_note'
  | 'implementation_log'
  | 'vulnerability_finding'
  | 'audit_note'
  | 'other';

export const ARTIFACT_TYPES: ArtifactType[] = [
  'chat', 'research_note', 'code_analysis', 'markdown',
  'plan', 'summary', 'design_note', 'implementation_log',
  'vulnerability_finding', 'audit_note', 'other',
];

export type ArtifactStatus =
  | 'draft'
  | 'review_needed'
  | 'needs_sources'
  | 'validated'
  | 'ready_to_share'
  | 'deprecated'
  | 'discarded';

export const ARTIFACT_STATUSES: ArtifactStatus[] = [
  'draft', 'review_needed', 'needs_sources',
  'validated', 'ready_to_share', 'deprecated', 'discarded',
];

export interface ProvenanceRecord {
  source: 'chat' | 'tool' | 'file' | 'manual' | 'api';
  sessionId?: string;
  conversationId?: string;
  toolCalls?: string[];
  filePaths?: string[];
  workspaceProject?: string;
  createdAt: string;
  capturedAt: string;
  modifiedAt?: string;
}

export interface DkgReceipt {
  contextGraph: string;
  assertionName: string;
  memoryLayer: 'working-memory';
  ual?: string;
  writeReceipt?: unknown;
}

export interface ArtifactRecord {
  artifactId: string;
  artifactType: ArtifactType;
  title: string;
  content: string;
  contentHash: string;
  status: ArtifactStatus;
  author: { id: string; displayName?: string };
  agent: { id: string; framework: 'openclaw'; version: string };
  provenance: ProvenanceRecord;
  dkg: DkgReceipt;
}

export interface RawCaptureInput {
  content: string;
  source: 'chat' | 'tool' | 'file' | 'manual' | 'api';
  artifactType?: ArtifactType;
  title?: string;
  status?: ArtifactStatus;
  sessionId?: string;
  conversationId?: string;
  toolCalls?: string[];
  filePaths?: string[];
  workspaceProject?: string;
}

export interface PluginConfig {
  daemonUrl: string;
  authTokenPath: string;
  enabled: boolean;
  contextGraph: string;
  assertionName: string;
  authorId: string;
  agentId: string;
  capture: {
    autoCapture: boolean;
    chat: boolean;
    files: boolean;
    toolOutputs: boolean;
    minContentLength: number;
    skipPatterns: string[];
  };
  redaction: { enabled: boolean };
  dedupe: { enabled: boolean; strategy: 'contentHash' };
  stateDir: string;
}
