import type { ArtifactStatus, ArtifactType } from '../types/artifact.js';

const PLAN_TYPES = new Set<ArtifactType>(['plan', 'design_note']);
const AUDIT_TYPES = new Set<ArtifactType>(['vulnerability_finding', 'audit_note']);
const PLAN_KEYWORDS = /\[(plan|spec|design|proposal)\]/i;
const SOURCE_LINK = /https?:\/\//;
const SOURCE_MARKER = /\[source\]/i;

export function classifyStatus(
  content: string,
  type: ArtifactType,
  override?: ArtifactStatus,
): ArtifactStatus {
  if (override !== undefined) return override;

  if (PLAN_TYPES.has(type) || PLAN_KEYWORDS.test(content)) {
    return 'review_needed';
  }

  if (AUDIT_TYPES.has(type) && !SOURCE_LINK.test(content) && !SOURCE_MARKER.test(content)) {
    return 'needs_sources';
  }

  if (
    content.length > 300 &&
    !SOURCE_LINK.test(content) &&
    !SOURCE_MARKER.test(content)
  ) {
    return 'needs_sources';
  }

  return 'draft';
}
