# dkg-openclaw-working-memory

[![npm](https://img.shields.io/npm/v/dkg-openclaw-working-memory)](https://www.npmjs.com/package/dkg-openclaw-working-memory)
[![CI](https://github.com/drMurlly/dkg-openclaw-working-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/drMurlly/dkg-openclaw-working-memory/actions)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

OpenClaw plugin that automatically captures every substantive artifact an agent produces and deposits it into [DKG V10 Working Memory](https://github.com/OriginTrail/dkg) — giving your research agents persistent, queryable, attributable memory across sessions.

Built for the [OriginTrail DKG V10 Bounty Program](https://docs.origintrail.io/origintrail-v9-v10/origintrail-dkg-v10-bounty-program) — Round 1 (`cfi-dkgv10-r1`).

---

## Demo

**[▶ Watch demo video](https://github.com/drMurlly/dkg-openclaw-working-memory/releases/download/v1.0.4/dkg-demo-final-v2.mp4)** — 2 min 7 sec walkthrough: auto-capture, DKG write verification, SPARQL search, full test suite.

---

## What it does

Every time an OpenClaw agent completes a turn (`agent_end` hook) or a session is about to be compacted (`before_compaction` hook), this plugin inspects the assistant's output for substantive content — research notes, vulnerability findings, code analyses, implementation plans — and writes it to your private Working Memory on the local DKG node as a structured JSON-LD artifact. Each artifact gets:

- A **stable URN** (`urn:dkg:wm:<sha256-prefix>`) for cross-session retrieval
- A **UAL** (Unique Asset Locator) returned by the DKG node — the canonical oracle reference
- A **status tag** (`draft` / `needs_sources` / `validated` / `ready_to_share`) based on whether the content is supported by evidence
- Full **provenance**: session ID, agent ID, workspace project, timestamp
- **Content-hash deduplication** — identical content is never written twice, even across sessions
- **Secret redaction** — API keys, private keys, bearer tokens, PEM blocks, and `.env`-style secrets are stripped before any write

In subsequent sessions, the agent can query past artifacts via the `search_working_memory` tool, close the research loop without user re-explanation, and curate findings toward promotion to Shared Working Memory.

---

## Memory Layers

| Layer | How used |
|---|---|
| **Working Memory (WM)** | Every artifact lands here first. Private, free, persists across sessions. |
| **Shared Working Memory (SWM)** | Explicit promotion step via `promote_artifact_to_shared_memory`. Never automatic. Gossip-replicated to team peers. |
| **Verified Memory (VM)** | Out of scope for Round 1. Artifacts are pre-shaped for oracle consumption and VM promotion. |

Artifacts land in the `wm-artifacts` Context Graph — separate from the existing `@origintrail-official/dkg-adapter-openclaw`'s `agent-context` graph. Both plugins can be loaded simultaneously with no conflict.

---

## Prerequisites

- **Node.js** 22 or later
- **OpenClaw** installed and configured
- **DKG v10 node** running locally — the plugin communicates only with `127.0.0.1:9200` (or a configurable URL)
- **Auth token** at `~/.dkg/auth.token` (created by `dkg init`)

---

## Install

**Recommended — via OpenClaw plugin manager:**

```bash
openclaw plugins install dkg-openclaw-working-memory
openclaw gateway restart
```

**Alternative — direct npm install:**

```bash
npm install dkg-openclaw-working-memory
```

Then add the entry to `~/.openclaw/openclaw.json` (see Configure section below).

---

## Configure

The plugin is auto-loaded after installation. To customise behaviour, add the entry to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "dkg-openclaw-working-memory": {
        "package": "dkg-openclaw-working-memory",
        "config": {
          "dkg": {
            "nodeUrl": "http://127.0.0.1:9200",
            "authTokenPath": "~/.dkg/auth.token"
          },
          "capture": {
            "autoCapture": true,
            "minContentLength": 120,
            "skipPatterns": ["^(yes|no|ok|sure|thanks)"]
          },
          "contextGraph": "wm-artifacts",
          "assertionName": "artifacts",
          "authorId": "your-handle",
          "agentId": "openclaw-agent"
        }
      }
    }
  }
}
```

### Config reference

| Key | Default | Description |
|---|---|---|
| `dkg.nodeUrl` | `http://127.0.0.1:9200` | Local DKG node URL |
| `dkg.authTokenPath` | `~/.dkg/auth.token` | Path to bearer token file |
| `capture.autoCapture` | `true` | Enable automatic capture on `agent_end` and `before_compaction` hooks |
| `capture.minContentLength` | `120` | Minimum characters before auto-capturing |
| `capture.skipPatterns` | `[]` | Regex patterns — matching responses are skipped |
| `contextGraph` | `wm-artifacts` | Context Graph name in the DKG node |
| `assertionName` | `artifacts` | Assertion name within the Context Graph |
| `authorId` | `unknown` | Author identifier written into artifact provenance |
| `agentId` | `openclaw-agent` | Agent identifier written into artifact provenance |

All keys can also be set via environment variables:

| Env var | Overrides |
|---|---|
| `DKG_AUTH_TOKEN` | Token value directly (skips file read) |
| `DKG_DAEMON_URL` | `dkg.nodeUrl` |
| `DKG_WM_CONTEXT_GRAPH` | `contextGraph` |
| `DKG_WM_ASSERTION_NAME` | `assertionName` |
| `DKG_WM_AUTHOR_ID` | `authorId` |
| `DKG_WM_AGENT_ID` | `agentId` |
| `DKG_WM_CAPTURE_ENABLED` | Set to `false` to disable the plugin entirely |

---

## Automatic capture

With `autoCapture: true`, the plugin fires on two hooks:

- **`agent_end`** — fires after every assistant turn. If the output exceeds `minContentLength` characters and doesn't match any `skipPatterns`, it is captured automatically.
- **`before_compaction`** — fires before OpenClaw compacts the conversation context. All assistant messages long enough to exceed `minContentLength` are captured so no knowledge is lost during compaction.

For each captured message, the plugin:

1. Strips secrets (API keys, private keys, bearer tokens, PEM blocks, `.env`-style `KEY=value` pairs)
2. Checks the SHA-256 content hash against the local dedupe store — skips if already written
3. Classifies status (`draft` / `needs_sources` / `validated`)
4. Serializes as JSON-LD and writes to the `wm-artifacts` Context Graph
5. Stores the returned UAL in the dedupe index for cross-session deduplication

Capture failures (DKG node unreachable, write errors) are logged as warnings and **never disrupt the agent turn**.

---

## Manual deposit

Ask the agent:

> "Save this finding to Working Memory."

The agent calls `deposit_artifact_to_working_memory` with the content, artifact type, an optional title, and an optional status. Returns the artifact ID, UAL, and status.

---

## Retrieve past artifacts

At the start of a new session, ask the agent:

> "What do we know about Uniswap V4 reentrancy from past sessions?"

The agent calls `search_working_memory` with a SPARQL-backed query against the `wm-artifacts` Context Graph. Returns matching artifact records sorted by recency, including their status, content hash, and provenance.

---

## Curate and promote

Update artifact status conversationally:

> "Mark that reentrancy finding as validated."

Agent calls `update_artifact_status(artifactId, "validated")`.

Promote to Shared Working Memory (explicit user confirmation required):

> "Share the validated reentrancy finding with the team."

Agent calls `promote_artifact_to_shared_memory(artifactId, confirm=true)` — triggers `POST /api/assertion/{name}/promote`. The assertion becomes gossip-replicated to team peers.

**This is the only operation that touches Shared Working Memory. It is never called automatically.**

---

## Available tools

| Tool name | Description |
|---|---|
| `deposit_artifact_to_working_memory` | Manually deposit content with type, status, and title |
| `search_working_memory` | SPARQL-backed search by keyword, type, and status (1–100 results) |
| `update_artifact_status` | Change artifact status through the trust gradient |
| `promote_artifact_to_shared_memory` | Promote the assertion to Shared Working Memory (requires `confirm=true`) |

---

## Running tests

```bash
# Unit tests + mocked integration tests (216 tests)
npm test

# With coverage report
npm run test:coverage

# Live integration tests against a running DKG node (5 tests)
DKG_INTEGRATION_TEST=1 npm run test:live

# Watch mode during development
npm run test:watch
```

Current test status: **221 tests total** (216 unit/integration + 5 live), **98.62% statement coverage**, **100% function coverage**.

---

## Security

- **No external network calls.** Only communicates with the configured DKG node (default: `127.0.0.1:9200`).
- **Bearer token** read from `~/.dkg/auth.token` or `DKG_AUTH_TOKEN` env var. Never logged or transmitted externally. Comment lines (`# ...`) in the token file are stripped.
- **Secret redaction** strips: OpenAI-style `sk-` keys, GitHub PATs (`ghp_`, `ghr_`, `ghs_`), ETH private keys (hex 64-char), PEM blocks (`-----BEGIN ...-----`), bearer tokens, and `.env`-style `KEY=value` secrets — before any DKG write.
- **SPARQL injection prevention.** All user-supplied search strings are escaped (`\`, `"`, `\n`, `\r`, `\t`) before SPARQL interpolation. Status and type values are validated against a strict enum — invalid values are silently dropped, never injected.
- **Tool handlers return error responses** (`{success: false, message: ...}`) on DKG failures — they never throw unhandled exceptions that would disrupt the agent.
- **Input size limits.** Content capped at 500 KB; search queries truncated at 500 characters before SPARQL interpolation.
- **No `postinstall` / `preinstall` scripts** in the published npm package.
- **No `eval()` on remote input**, no dynamic remote module loading.
- **Published with `npm publish --provenance`** via GitHub Actions (OIDC-backed build attestation).
- **`npm audit --production`** clean at publish time.

---

## Known limitations

- Requires a local DKG v10 node (`>=10.0.0-rc.1`). Remote nodes are not supported in Round 1.
- Coexists with but does not replace `@origintrail-official/dkg-adapter-openclaw`. Both can be loaded simultaneously with no conflict.
- Verified Memory (on-chain anchoring) is Round 2 scope. Artifacts are pre-shaped for oracle consumption today.
- `promote_artifact_to_shared_memory` promotes the entire `artifacts` assertion, not an individual artifact triple — this matches the DKG v10 promotion model (assertions are the unit of promotion).

---

## Contributing

Issues and PRs welcome. The integration is structured for Round 2 extension — oracle pipeline consumption and `POST /api/shared-memory/publish` flows are the natural next additions.

---

## License

[Apache-2.0](LICENSE)

Maintainer: [drMurlly](https://github.com/drMurlly) — via GitHub issues.  
Support window: 6 months minimum post-registry-merge.
