import type { OpenClawTool } from '../types/openclaw.js';
import type { PluginConfig } from '../types/artifact.js';
import { ARTIFACT_STATUSES, ARTIFACT_TYPES } from '../types/artifact.js';
import type { DkgWmClient } from '../modules/dkg-wm-client.js';

/**
 * Strip surrounding double-quotes from RDF N-Quads literal values returned by the DKG API.
 * The DKG SPARQL endpoint returns binding values in N-Quads serialization form:
 * the actual literal `validated` comes back as the string `"validated"`.
 */
function stripLit(v: unknown): string {
  if (typeof v !== 'string') return String(v ?? '');
  return v.replace(/^"(.*)"$/, '$1');
}

/** Priority order for deduplication: keep the highest-trust status when the same
 *  artifact appears with multiple status values (because DKG writes are append-only). */
const STATUS_PRIORITY: Record<string, number> = {
  draft: 0, review_needed: 1, needs_sources: 2,
  validated: 3, ready_to_share: 4, deprecated: 5, discarded: 6,
};

interface SearchArgs {
  query: string;
  status?: string;
  type?: string;
  limit?: number;
}

/** Maximum characters allowed in the user-supplied query string before truncation. */
const MAX_QUERY_LENGTH = 500;

/**
 * Escape a value for safe interpolation inside a SPARQL double-quoted string literal.
 * Covers all escape sequences defined by SPARQL 1.1 §19.8.
 */
function escapeSparqlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function buildSparqlQuery(args: SearchArgs): string {
  // Guard against NaN/Infinity from non-integer or non-numeric inputs
  const rawLimit = Number.isFinite(args.limit) ? (args.limit ?? 10) : 10;
  const limit = Math.min(Math.max(1, Math.floor(rawLimit)), 100);

  const filters: string[] = [];

  if (args.status && ARTIFACT_STATUSES.includes(args.status as never)) {
    filters.push(`FILTER(?status = "${escapeSparqlString(args.status)}")`);
  }
  if (args.type && ARTIFACT_TYPES.includes(args.type as never)) {
    filters.push(`FILTER(?type = "${escapeSparqlString(args.type)}")`);
  }
  if (args.query) {
    const escaped = escapeSparqlString(args.query);
    filters.push(
      `FILTER(CONTAINS(LCASE(STR(?content)), LCASE("${escaped}")) || ` +
      `CONTAINS(LCASE(STR(?name)), LCASE("${escaped}")))`
    );
  }

  const filterBlock = filters.length > 0 ? filters.join('\n  ') : '';

  // No GRAPH clause — the daemon scopes queries via contextGraphId + view API params.
  // Using a bare assertion name as a GRAPH URI would be fragile and implementation-dependent.
  return `
PREFIX wm: <https://ontology.origintrail.io/dkg/wm#>
PREFIX schema: <https://schema.org/>

SELECT ?id ?name ?type ?status ?contentHash ?capturedAt WHERE {
  ?id a wm:WorkingMemoryArtifact ;
      wm:status ?status ;
      wm:artifactType ?type ;
      wm:contentHash ?contentHash ;
      schema:name ?name ;
      wm:provenance [ wm:capturedAt ?capturedAt ] .
  OPTIONAL { ?id schema:text ?content }
  ${filterBlock}
}
ORDER BY DESC(?capturedAt)
LIMIT ${limit}
`.trim();
}

export function createSearchTool(options: {
  client: DkgWmClient;
  config: PluginConfig;
}): OpenClawTool {
  const { client, config } = options;

  return {
    name: 'search_working_memory',
    description:
      'Search past artifacts in Working Memory by keyword, type, or status. ' +
      'Use this at the start of a session to recall prior research, findings, or plans.',
    parameters: {
      query: {
        type: 'string',
        description: 'Natural language search query (matched against content and title).',
      },
      status: {
        type: 'string',
        enum: ARTIFACT_STATUSES,
        optional: true,
        description: 'Filter by artifact status.',
      },
      type: {
        type: 'string',
        enum: ARTIFACT_TYPES,
        optional: true,
        description: 'Filter by artifact type.',
      },
      limit: {
        type: 'number',
        optional: true,
        default: 10,
        description: 'Maximum number of results to return (1–100).',
      },
    },

    async handler(args: Record<string, unknown>): Promise<unknown> {
      // Trim and truncate query to prevent oversized SPARQL payloads
      const rawQuery = typeof args['query'] === 'string' ? args['query'].trim() : '';
      const query = rawQuery.slice(0, MAX_QUERY_LENGTH);
      const status = typeof args['status'] === 'string' ? args['status'] : undefined;
      const type = typeof args['type'] === 'string' ? args['type'] : undefined;
      const limit = typeof args['limit'] === 'number' ? args['limit'] : 10;

      const a: SearchArgs = { query, status, type, limit };
      const sparql = buildSparqlQuery(a);

      try {
        const results = await client.querySparql(sparql, {
          contextGraphId: config.contextGraph,
          view: 'working-memory',
        });

        // DKG returns bindings in N-Quads serialization form (values wrapped in `"..."`)
        const raw = results as Record<string, unknown>;
        const bindings = ((raw?.['result'] as Record<string, unknown>)?.['bindings'] as Array<Record<string, unknown>>) ?? [];

        // Deduplicate by artifact id — DKG assertion writes are append-only, so
        // update_artifact_status leaves both the old and new status quads in the store.
        // Keep the highest-trust status for each artifact.
        const byId = new Map<string, Record<string, string>>();
        for (const b of bindings) {
          const id = stripLit(b['id']);
          const status = stripLit(b['status']);
          const existing = byId.get(id);
          const prevPri = existing ? (STATUS_PRIORITY[existing['status'] ?? ''] ?? -1) : -1;
          const curPri = STATUS_PRIORITY[status] ?? -1;
          if (!existing || curPri >= prevPri) {
            byId.set(id, {
              id,
              name: stripLit(b['name']),
              type: stripLit(b['type']),
              status,
              contentHash: stripLit(b['contentHash']),
              capturedAt: stripLit(b['capturedAt']),
            });
          }
        }

        const artifacts = Array.from(byId.values());
        return {
          success: true,
          query,
          count: artifacts.length,
          artifacts,
          message: artifacts.length > 0
            ? `Found ${artifacts.length} artifact(s) in Working Memory.`
            : 'No matching artifacts found in Working Memory.',
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, query, message: `Search failed: ${msg}` };
      }
    },
  };
}
