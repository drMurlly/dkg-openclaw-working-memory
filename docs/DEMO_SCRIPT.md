# Demo Script — dkg-openclaw-working-memory

**Total length:** ~4 minutes
**Purpose:** Recorded walkthrough for the DKG V10 Bounty Round 1 submission.

---

## 00:00 — Start the DKG node

```bash
dkg start
# Wait for: "DKG node is running at http://127.0.0.1:9200"
TOKEN=$(cat ~/.dkg/auth.token | grep -v '^#' | tr -d '\n')
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9200/api/status | jq '{name,version,nodeRole}'
# Expected: {"name":"...","version":"10.0.0-rc.x","nodeRole":"edge"}
```

**Narrator:** "The local DKG v10 node is running. This is where Working Memory artifacts will be stored."

---

## 00:30 — Show plugin configuration

```bash
cat ~/.openclaw/openclaw.json | jq '.plugins.entries["dkg-openclaw-working-memory"]'
```

Expected output:
```json
{
  "package": "dkg-openclaw-working-memory",
  "config": {
    "dkg": { "nodeUrl": "http://127.0.0.1:9200" },
    "capture": { "autoCapture": true, "minContentLength": 120 }
  }
}
```

**Narrator:** "The plugin is configured in OpenClaw with auto-capture enabled. The default minimum content length is 120 characters."

---

## 01:00 — Agent session: research note auto-captured

Open OpenClaw and send this prompt to the agent:

> "Research the reentrancy vulnerability pattern in DeFi smart contracts and write me a detailed research note covering: what it is, why it's dangerous, how to detect it, and a real-world example."

**Wait for the agent to produce a substantial response.**

**Show in the terminal:** The agent's response appears. Since `autoCapture: true`, the plugin fires on `agent_end` and deposits the artifact automatically.

Show the confirmation log in the terminal:
```
[dkg-wm] Artifact written to 'artifacts' — URI: ual:dkg:wm:...
```

**Narrator:** "The agent just produced a reentrancy research note. The plugin captured it automatically — no user action needed. The artifact is now in Working Memory with a stable UAL."

---

## 02:00 — Verify the artifact via SPARQL

```bash
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "http://127.0.0.1:9200/api/assertion/artifacts/query" \
  -d '{"contextGraphId":"wm-artifacts"}' | jq '{count: .count, sample: .quads[:3]}'
```

**Show:** The assertion exists on the DKG node with RDF quads including:
- `wm:status` = `"draft"` or `"needs_sources"`
- `wm:contentHash` = `"sha256:..."`
- `wm:capturedAt` = ISO-8601 timestamp

**Narrator:** "The artifact is in Working Memory with status tags and provenance as structured JSON-LD. The same RDF schema works unchanged after promotion to Verified Memory — no rewrite needed."

---

## 02:30 — In-agent retrieval via search_working_memory

Back in OpenClaw, in a **new session**, ask the agent:

> "What do we know about reentrancy from past sessions? Search working memory."

**Show:** The agent calls `search_working_memory(query="reentrancy")` and returns the artifact from the previous session.

**Narrator:** "The research loop closes. The agent retrieves prior findings without the user re-explaining context. Knowledge compounds across sessions."

---

## 03:00 — Manual deposit with explicit type

In OpenClaw, ask the agent:

> "Save this specific finding to Working Memory: the withdraw function calls the external contract before updating the balance. Mark it as a vulnerability finding."

**Show:** The agent calls `deposit_artifact_to_working_memory` with `artifactType: "vulnerability_finding"` and returns `{success: true, ual: "ual:...", status: "needs_sources"}`.

---

## 03:20 — Status update conversationally

In OpenClaw:

> "Mark that reentrancy finding as validated — I've verified it against the Euler Finance hack post-mortem."

**Show:** The agent calls `update_artifact_status(artifactId, "validated")` and returns `{success: true, newStatus: "validated"}`.

---

## 03:45 — Run the test suite

```bash
cd ~/dkg-openclaw-working-memory
npm test
```

**Show:**
```
Test Files  12 passed | 1 skipped (13)
     Tests  214 passed | 5 skipped (219)
  Duration  ~7s
```

```bash
# Also run live integration tests against the real node
DKG_INTEGRATION_TEST=1 npm run test:live
```

**Show:** All 5 live integration tests pass (status check, deposit + retrieval, SPARQL query, deduplication, secret redaction).

**Narrator:** "219 tests total. 98.97% statement coverage. 100% function coverage. All live integration tests pass against a real DKG v10 node."

---

## 04:00 — Done

**Narrator:** "OpenClaw Working Memory Adapter for DKG V10. Every research session now compounds. Knowledge persists with full provenance. Secrets never leave the machine unredacted."

---

## Setup Before Recording

```bash
# Install the plugin
npm install dkg-openclaw-working-memory

# Configure openclaw.json (see README.md)
# Minimum config:
# {
#   "plugins": { "entries": { "dkg-openclaw-working-memory": {
#     "package": "dkg-openclaw-working-memory",
#     "config": { "capture": { "autoCapture": true } }
#   }}}
# }

# Start the DKG node
dkg start

# Verify the node responds
TOKEN=$(cat ~/.dkg/auth.token | grep -v '^#' | tr -d '\n')
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9200/api/status | jq .

# Optionally verify context graph was created on first run
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:9200/api/context-graph/exists?name=wm-artifacts" | jq .
```
