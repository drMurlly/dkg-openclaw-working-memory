# dkg-openclaw-working-memory

OpenClaw plugin that automatically captures every substantive artifact an agent produces and deposits it into [DKG V10 Working Memory](https://github.com/OriginTrail/dkg) — giving your research agents persistent, queryable, attributable memory across sessions.

Built for the [OriginTrail DKG V10 Bounty Program](https://docs.origintrail.io/origintrail-v9-v10/origintrail-dkg-v10-bounty-program) — Round 1 (`cfi-dkgv10-r1`).

---

## What it does

Every time an OpenClaw agent completes a turn (`agent_end` hook), this plugin inspects the assistant's output for substantive content — research notes, vulnerability findings, code analyses, implementation plans — and writes it to your private Working Memory on the local DKG node as a structured JSON-LD artifact. Each artifact gets:

- A **stable URN** (`urn:dkg:wm:<sha256-prefix>`) for cross-session retrieval
- A **UAL** (Unique Asset Locator) returned by the DKG node — the canonical oracle reference
- A **status tag** (`draft` / `needs_sources` / `validated` / `ready_to_share`) based on whether the content is supported by evidence
- Full **provenance**: session ID, conversation ID, agent ID, tool calls that produced the content
- **Content-hash deduplication** — identical content is never written twice
- **Secret redaction** — API keys, private keys, bearer tokens, PEM blocks, and `.env`-style secrets are stripped before any write

In subsequent sessions, the agent can query past artifacts via the `search_working_memory` tool, close the research loop without user re-explanation, and curate findings toward promotion to Shared Working Memory.

---

## Memory Layers

| Layer | How used |
|---|---|
| **Working Memory (WM)** | Every artifact lands here first. Private, free, persists across sessions. |
| **Shared Working Memory (SWM)** | Explicit promotion step via `promote_artifact_to_shared_memory`. Never automatic. Gossip-replicated to team peers. |
| **Verified Memory (VM)** | Out of scope for Round 1. Artifacts are pre-shaped for oracle consumption and VM promotion. |

Artifacts land in the `wm-artifacts` Context Graph (separate from the existing `@origintrail-official/dkg-adapter-openclaw`'s `agent-context` graph — no conflict).

---

## Prerequisites

- **Node.js** 22 or later (`node --version`)
- **npm** 10 or later
- **OpenClaw** installed and configured
- **DKG v10 node** running locally (`dkg start`) — the plugin communicates only with `127.0.0.1:9200`
- **Auth token** at `~/.dkg/auth.token` (created by `dkg init`)

---

## Install

```bash
npm install dkg-openclaw-working-memory
```

---

## Configure

Add the plugin to your OpenClaw config at `~/.openclaw/openclaw.json`:

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
            "minContentLength": 200,
            "skipPatterns": ["^(yes|no|ok|sure|thanks)"]
          },
          "contextGraph": "wm-artifacts"
        }
      }
    }
  }
}
```

### Config options

| Key | Default | Description |
|---|---|---|
| `dkg.nodeUrl` | `http://127.0.0.1:9200` | Local DKG node URL |
| `dkg.authTokenPath` | `~/.dkg/auth.token` | Path to bearer token file |
| `capture.autoCapture` | `true` | Enable automatic capture on `agent_end` |
| `capture.minContentLength` | `200` | Minimum characters before auto-capturing |
| `capture.skipPatterns` | `[]` | Regex patterns — matching responses are skipped |
| `contextGraph` | `wm-artifacts` | Context Graph name in DKG |

---

## Automatic capture

With `autoCapture: true`, the plugin fires on every `agent_end` event. If the assistant's output exceeds `minContentLength` characters and doesn't match any `skipPatterns`, it is:

1. Redacted of secrets
2. Content-hash checked against the local dedupe store — skipped if already written
3. Classified for status (`draft` / `needs_sources` / `validated`)
4. Serialized as JSON-LD and written to the `wm-artifacts` Context Graph via `POST /api/assertion/{name}/write`
5. The returned UAL is stored in the artifact record for future retrieval

The agent will see a brief confirmation: `[WM] Artifact captured — UAL: <ual> | Status: draft`.

---

## Manual deposit

Ask the agent:

> "Save this finding to Working Memory."

The agent calls `deposit_artifact_to_working_memory` with the content, an optional title, and an optional status. Returns the UAL.

---

## Retrieve past artifacts

At the start of a new session, ask the agent:

> "What do we know about Uniswap V4 reentrancy from past sessions?"

The agent calls `search_working_memory` with a SPARQL-backed query against the `wm-artifacts` Context Graph. Returns matching artifact records sorted by recency, including their status, provenance, and UAL.

---

## Curate and promote

Update artifact status conversationally:

> "Mark that reentrancy finding as validated."

Agent calls `update_artifact_status(artifactId, "validated")`.

Promote to Shared Working Memory (explicit confirmation required):

> "Share the validated reentrancy finding with the team."

Agent calls `promote_artifact_to_shared_memory(artifactId)` — triggers `POST /api/assertion/{name}/promote`. The artifact becomes gossip-replicated to team peers' Shared Working Memory views.

**This is the only operation that touches Shared Working Memory. It is never called automatically.**

---

## Running tests

```bash
# Unit tests + mocked integration tests
npm test

# Live integration tests (requires DKG node running)
DKG_INTEGRATION_TEST=1 DKG_DAEMON_URL=http://127.0.0.1:9200 npm run test:live
```

All tests must pass before submitting the registry PR.

---

## Security

- **No external network calls.** Only communicates with `127.0.0.1:9200`.
- **Bearer token** read from `~/.dkg/auth.token` or `DKG_AUTH_TOKEN` env var. Never logged or transmitted externally.
- **Secret redaction** strips: API keys, private keys (`-----BEGIN`), bearer tokens, `.env`-style `KEY=value` pairs, hex/base58 private key patterns — before any DKG write.
- **No postinstall / preinstall scripts** in the published npm package.
- **No `eval()` on remote input**, no dynamic remote module loading.
- **Published with `npm publish --provenance`** via GitHub Actions (OIDC-backed build attestation).
- **`npm audit --production`** clean at publish time.

---

## Known limitations

- Requires a local DKG v10 node (`>=10.0.0-rc.1`). Remote nodes are not supported in Round 1.
- Coexists with but does not replace `@origintrail-official/dkg-adapter-openclaw`. Both can be loaded simultaneously.
- Verified Memory (on-chain anchoring) is Round 2 scope. Artifacts are pre-shaped for oracle consumption today.

---

## Contributing

Issues and PRs welcome. The integration is structured for Round 2 extension — oracle pipeline consumption and `POST /api/shared-memory/publish` flows are the natural next additions.

---

## License

[Apache-2.0](LICENSE)

Maintainer: [drMurlly](https://github.com/drMurlly) — via GitHub issues.
Support window: 6 months minimum post-registry-merge.
