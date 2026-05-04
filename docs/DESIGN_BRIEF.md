# Design Brief: OpenClaw Working Memory Adapter

**Integration slug:** `openclaw-working-memory`
**Package:** `dkg-openclaw-working-memory`
**Author:** drMurlly (`https://github.com/drMurlly`)
**Round:** DKG V10 Bounty Program — Round 1 (`cfi-dkgv10-r1`)

---

## 0. Differentiation from existing OriginTrail integrations

The DKG ecosystem already ships two first-party integrations adjacent to this submission's space. This integration is intentionally distinct from both, not redundant.

### vs. `cursor-mcp-dkg` (registry-listed, featured tier)

| Dimension | `cursor-mcp-dkg` | `openclaw-working-memory` (this) |
|---|---|---|
| **Install kind** | MCP server | OpenClaw agent-plugin |
| **Capture model** | Pull (client invokes tool) | Push (event-driven auto-capture on `agent_end` and `before_compaction`) |
| **Trigger** | User prompt asks the agent to write | Every assistant turn fires capture automatically; also fires before context compaction |
| **Target users** | Coding-assistant users (Cursor / Claude Code / Claude Desktop) | Autoresearch / bug-bounty research users (OpenClaw) |
| **Capture pipeline** | Generic write/read | Status-tagged + content-hash deduplicated + secret-redacted |
| **Provenance** | Generic | Session-scoped, agent-attributed, tool-call-tracked, project-scoped |

### vs. `@origintrail-official/dkg-adapter-openclaw` (existing OpenClaw adapter)

The existing OpenClaw adapter already captures conversational data into Working Memory. We coexist with it — we do NOT replace it.

| Dimension | Existing adapter (`@origintrail-official/dkg-adapter-openclaw`) | `openclaw-working-memory` (this) |
|---|---|---|
| **OpenClaw plugin slot** | Owns the **memory slot** (`registerMemoryCapability`) | Tool plugin + hook listener — does NOT touch memory slot |
| **Context Graph** | `agent-context` | `wm-artifacts` (separate) |
| **Assertion** | `chat-turns` (raw turn-by-turn history) | `artifacts` (structured artifact records) |
| **Storage shape** | Conversational trace | JSON-LD artifact records with status tags, content hash, provenance, project scope |
| **Curation** | None — every turn captured raw | Status classification (`draft`/`needs_sources`/`validated`/`ready_to_share`) |
| **Dedup** | None | SHA-256 content-hash dedup |
| **Secret redaction** | None | Strips API keys, private keys, bearer tokens before write |
| **Oracle-readiness** | Not designed for it | JSON-LD with `wm:` predicates, stable URN ids, UAL refs |
| **Promotion path** | Not exposed | `promote_artifact_to_shared_memory` tool with explicit user confirmation |

The two run side-by-side: the existing adapter preserves raw conversational context for recall, our plugin captures structured knowledge artifacts for accumulation and oracle-readiness. Different Context Graphs, different Assertions, no slot conflict.

This is the cleanest version of "additive integration": users keep what they have, gain new structured-memory capability on top.

---

## 1. Problem

OpenClaw agents produce valuable knowledge every session: research notes, code analyses, vulnerability findings, implementation plans, design decisions, and structured summaries. Today, all of it disappears when the session ends.

This creates a specific failure mode in long-horizon research workflows: the same research gets redone in every session. An agent auditing a smart contract protocol on Tuesday cannot reference the vulnerability taxonomy it built on Monday. An autoresearch loop running overnight produces findings that are gone by morning. There is no provenance — no record of which agent produced a finding, from which source, at what point in time.

The bottleneck is not reasoning capability. The bottleneck is that agents have no open, durable, attributable memory substrate to write into. Every closed-platform solution (ChatGPT memory, Claude projects, Cursor notes) is a walled garden — knowledge produced there is trapped there.

DKG v10 Working Memory is the first open alternative at production scale. This plugin wires it directly into OpenClaw, the agent environment where the work actually happens.

---

## 2. Target User and Credible First User

**Target user:** OpenClaw power users running long-horizon research, auditing, or knowledge-work agents — specifically people who run multi-session or multi-agent workflows where knowledge continuity matters.

**Credible first user: drMurlly (the maintainer)**, who runs active bug bounty research using OpenClaw agents on Immunefi and Code4rena audit contests. A typical session involves:

- An OpenClaw agent researching a smart contract protocol (reading docs, querying Solodit for past findings, analyzing code)
- Producing research notes: vulnerability hypotheses, attack surface maps, PoC approaches
- These notes vanish at session end — the next session starts from scratch

With this plugin active, every research note, vulnerability analysis, and audit finding is automatically captured in Working Memory with:
- The session and conversation IDs it came from
- The source tools that produced it (Solodit queries, static analysis outputs)
- A status tag (`draft`, `needs_sources`, `validated`) based on whether the finding is supported by evidence
- A stable URN so the agent can retrieve it in the next session without losing context

This is a real workflow that runs today. The plugin removes a real bottleneck that exists today. The first user is the maintainer — not a hypothetical future user.

**Secondary users:** Any OpenClaw user running research, architecture planning, or knowledge-accumulation workflows where session continuity matters.

---

## 3. Memory Layers Touched

| Layer | How Used |
|---|---|
| **Working Memory (WM)** | Primary layer. Every captured artifact lands here first. Private to the author agent. Free — no TRAC cost. Persists across sessions. |
| **Shared Working Memory (SWM)** | Exposed as an explicit promotion step. Agent calls `promote_artifact_to_shared_memory` via conversation after user confirmation. Gossip-replicated to team peers. Never automatic. |
| **Verified Memory (VM)** | Out of scope for Round 1. Artifacts are shaped so promotion to VM is a natural next step — not a rewrite. See Section 7. |

The three layers nest inside a **project** (the OpenClaw workspace), not the other way around. The Context Graph `wm-artifacts` belongs to the active workspace project, respecting the project-centric layering principle. Each artifact record carries the workspace/project identifier in its provenance so it can be associated with the correct project context when promoted.

---

## 4. V10 Primitives Used

| Primitive | How Used |
|---|---|
| **Context Graph** | `wm-artifacts` — created on first plugin use within the active workspace project. Scopes all artifact assertions to the project. |
| **Assertion** | `artifacts` — named RDF graph inside the Context Graph. Each artifact's JSON-LD triples are appended here. |
| **UAL** | Returned by `POST /api/assertion/create` and `/write`. Stored in `artifact.dkg.ual`. Stable permanent reference for oracle consumption. |
| **Integration** | This plugin is itself a registered Integration in the DKG v10 integrations registry (`openclaw-working-memory`). |
| **Curator** | The plugin never invokes Curator-authority operations (PUBLISH, SHARE) automatically. Curator authority on promotion flows is gated behind explicit user intent via agent conversation. |

**Not used:** Knowledge Asset, Knowledge Collection — these require TRAC and on-chain anchoring, which is Verified Memory territory (Round 2 scope).

---

## 5. LLM-Wiki / Autoresearch Mapping

Karpathy's LLM Wiki describes a knowledge substrate **natively legible to language models**, continuously curated by a mixture of humans and agents, where retrieval, writing, and verification collapse into a single loop.

This integration makes that concrete for OpenClaw:

**Write loop:** Every substantive artifact an agent produces is written to Working Memory in JSON-LD — a format natively queryable by language models via SPARQL. The agent writes to memory as naturally as it produces output.

**Retrieve loop:** At the start of each session, the agent runs `search_working_memory` with a SPARQL-backed query to surface past relevant artifacts. An autoresearch loop can reference yesterday's findings without the user re-explaining context. The memory loop closes.

**Curate loop:** Status tags (`draft` → `validated` → `ready_to_share`) are the agent-native curation mechanism. An agent reviews past artifacts, upgrades status through conversation, and marks validated knowledge for promotion. The curation is conversational — no UI required.

**Verify (later):** Artifacts tagged `ready_to_share` can be promoted to Shared Working Memory (gossip-replicated, team-visible) and eventually to Verified Memory (on-chain, TRAC-backed). The autoresearch loop produces verifiable knowledge.

**The concrete advance:** An OpenClaw bug-bounty research agent that runs today starts every session blind. With this plugin, it starts every session with access to every finding, hypothesis, and validated insight from every prior session. The knowledge substrate grows. Research compounds. The LLM Wiki is populated one session at a time, with full provenance preserved.

---

## 6. Terminology

All v10 terminology is used exactly as defined. No deviations.

| Term used | Meaning |
|---|---|
| Working Memory | Private, free, agent-populated pre-verification memory layer |
| Shared Working Memory | Team-visible, gossip-replicated pre-verification layer |
| Verified Memory | On-chain, permanent, consensus-verified layer (Round 2 scope) |
| Context Graph | Scoped knowledge domain; `wm-artifacts` belongs to the active workspace project |
| Assertion | Named RDF graph within a Context Graph; `artifacts` is the assertion name |
| UAL | Unique Asset Locator returned after every DKG write; stable cross-session reference |
| Integration | This plugin, registered in the DKG v10 integrations registry |
| Curator | Authority model for PUBLISH/SHARE — never invoked automatically by this plugin |
| PUBLISH | On-chain anchoring to Verified Memory — never invoked by this plugin |
| SHARE | Promotion to Shared Working Memory — only on explicit user instruction |

Not used: "Memory Explorer" (replaced by "Working Memory" per terminology discipline).

---

## 7. Promotion Path and Oracle-Readiness

### Promotion Path (WM → SWM → VM)

**Working Memory → Shared Working Memory (in scope, Round 1):**

1. Agent captures artifact → deposited in `wm-artifacts` Context Graph with `status: "draft"`
2. Agent retrieves artifact via `search_working_memory` in a later session
3. User instructs agent to validate a finding: "mark this one as validated"
4. Agent calls `update_artifact_status(artifactId, "validated")`
5. User instructs agent to share a finding with the team: "this is ready for the team"
6. Agent calls `promote_artifact_to_shared_memory(artifactId)` — plugin calls `POST /api/assertion/{name}/promote`
7. Assertion becomes gossip-replicated; team peers' agents can read it via their Shared Working Memory views

This entire flow is **conversational** — no UI buttons, no manual steps.

**Shared Working Memory → Verified Memory (Round 2 scope, forward-compatible):**

Artifacts in SWM have:
- Clean JSON-LD provenance with stable UAL references
- `wm:contentHash` for integrity verification
- `wm:status` queryable as an RDF predicate

In Round 2, a context oracle can:
1. Query SWM for artifacts with `wm:status = "validated"` using SPARQL
2. Resolve each artifact by its UAL
3. Propose consensus verification via `POST /api/verify`
4. Anchor to Verified Memory via `POST /api/shared-memory/publish`

No rewrite of artifact structure is needed. The JSON-LD schema is forward-compatible today.

### Oracle-Readiness

Every Working Memory artifact has:
- **Stable URN:** `urn:dkg:wm:<sha256-prefix>` — resolvable without session context
- **UAL field:** populated from DKG node response — canonical oracle reference
- **`wm:contentHash`:** enables oracles to verify content integrity
- **`wm:status`:** queryable RDF predicate for filtering promotion-ready artifacts
- **`schema:dateCreated` / `wm:capturedAt`:** temporal ordering for oracle pipelines
- **`wm:provenanceSource`:** provenance chain back to the originating tool/session

A context oracle querying this integration's artifacts in Round 2:

```sparql
PREFIX wm: <https://ontology.origintrail.io/dkg/wm#>
PREFIX schema: <https://schema.org/>

SELECT ?id ?ual ?status ?content ?capturedAt WHERE {
  ?id a wm:WorkingMemoryArtifact ;
      wm:status ?status ;
      wm:ual ?ual ;
      schema:text ?content ;
      wm:capturedAt ?capturedAt .
  FILTER(?status IN ("validated", "ready_to_share"))
}
ORDER BY DESC(?capturedAt)
```

This query works today against Working Memory and works unchanged after promotion to Verified Memory.

---

## 8. Security Notes

- **No Curator authority invoked automatically.** The plugin only calls `POST /api/assertion/create` and `POST /api/assertion/{name}/write` automatically. `POST /api/assertion/{name}/promote` is exposed as an explicit tool but is never called without user instruction via agent conversation.
- **No PUBLISH or SHARE operations** are ever invoked automatically.
- **Bearer token** read from `~/.dkg/auth.token` (local file) or `DKG_AUTH_TOKEN` env var. Never transmitted outside localhost. Comment lines in token files are stripped correctly.
- **Network egress:** Only to `http://127.0.0.1:9200`. No external network calls.
- **Secret redaction:** Strips OpenAI-style `sk-` keys, GitHub PATs, ETH private keys (hex 64-char), PEM blocks, bearer tokens, and `.env`-style `KEY=value` secrets from all artifact content before any DKG write.
- **SPARQL injection prevention:** All user-supplied search strings are escaped (`\`, `"`, `\n`, `\r`, `\t`) before interpolation into SPARQL string literals. Status and type filter values are validated against a strict enum — unrecognised values are dropped, never injected. N-Quads literal escaping covers all SPARQL 1.1 §19.8 special characters.
- **Tool error safety:** All four tool handlers catch DKG client errors and return `{success: false, message: ...}` — they never throw unhandled exceptions that could disrupt the agent turn.
- **Input size limits:** Artifact content is capped at 500 KB; search query strings are truncated at 500 characters before SPARQL interpolation.
- **No dynamic code loading:** No `eval`, no remote module fetch. Static TypeScript compiled to ESM.
- **npm audit --production clean** at time of publish.
- **Published with `npm publish --provenance`** via GitHub Actions (OIDC-backed build attestation).

---

## 9. Maintenance Commitment

**Maintainer:** drMurlly (`https://github.com/drMurlly`)  
**Contact:** via GitHub issues on the integration repo  
**Support window:** 6 months minimum post-registry-merge  
**Update policy:** Will track DKG v10 API changes (RC → GA) and publish new npm versions within 2 weeks of breaking changes  
**Round 2 eligibility:** This integration explicitly structures artifacts for Round 2 follow-on — Verified Memory promotion and context oracle readiness are pre-wired into the data model. The same repo will be extended in Round 2 to add oracle pipeline consumption and `POST /api/shared-memory/publish` flows.
