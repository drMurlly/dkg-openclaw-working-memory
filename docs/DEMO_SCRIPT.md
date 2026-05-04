# Demo Script — dkg-openclaw-working-memory

**Total length:** ~4 minutes  
**Purpose:** Recorded walkthrough for the DKG V10 Bounty Round 1 submission.

---

## 00:00 — Start the DKG node

```bash
dkg start
# Wait for: "DKG node is running at http://127.0.0.1:9200"
TOKEN=$(cat ~/.dkg/auth.token)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9200/api/status | jq .
# Show: {"status":"running","version":"10.0.0-rc.x",...}
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

**Narrator:** "The plugin is configured in OpenClaw with auto-capture enabled."

---

## 01:00 — Agent session: research note auto-captured

Open OpenClaw and send this prompt to the agent:

> "Research the reentrancy vulnerability pattern in DeFi smart contracts and write me a detailed research note covering: what it is, why it's dangerous, how to detect it, and a real-world example."

**Wait for the agent to produce a substantial response.**

**Show in the terminal:** The agent's response appears. Since `autoCapture: true`, the plugin fires on `agent_end` and deposits the artifact automatically.

Show the confirmation log in the terminal:
```
[dkg-wm] Artifact written to 'artifacts' — UAL: ual:dkg:...
```

**Narrator:** "The agent just produced a reentrancy research note. The plugin captured it automatically — no user action needed."

---

## 02:00 — Query the artifact via SPARQL

```bash
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -X POST http://127.0.0.1:9200/api/assertion/artifacts/query \
  -d '{
    "query": "PREFIX wm: <https://ontology.origintrail.io/dkg/wm#> PREFIX schema: <https://schema.org/> SELECT ?id ?status ?contentHash ?capturedAt WHERE { ?id a wm:WorkingMemoryArtifact ; wm:status ?status ; wm:contentHash ?contentHash ; wm:provenance [ wm:capturedAt ?capturedAt ] } ORDER BY DESC(?capturedAt) LIMIT 5"
  }' | jq .
```

**Show:** The artifact appears in the SPARQL results with:
- `wm:status` = `"needs_sources"` or `"draft"`
- `wm:contentHash` = `"sha256:..."`
- `wm:capturedAt` = ISO-8601 timestamp

**Narrator:** "The artifact is in Working Memory with status tags and provenance. SPARQL works unchanged — this same query works after promotion to Verified Memory."

---

## 02:45 — In-agent retrieval via search_working_memory

Back in OpenClaw, ask the agent:

> "What do we know about reentrancy from past sessions? Search working memory."

**Show:** The agent calls `search_working_memory` and returns the artifact from the previous session.

**Narrator:** "The research loop closes. The agent can reference past findings without the user re-explaining context."

---

## 03:15 — Status update conversationally

In OpenClaw:

> "Mark that reentrancy research note as validated."

**Show:** The agent calls `update_artifact_status(artifactId, "validated")`.

Then query again to show `wm:status` is now `"validated"`.

---

## 03:45 — Run the test suite

```bash
cd ~/dkg-openclaw-working-memory
npm test
```

**Show:** All 73 tests pass.

```
Test Files  8 passed | 1 skipped (9)
     Tests  73 passed | 4 skipped (77)
```

**Narrator:** "Full test suite green. The 4 skipped tests are the live integration tests — those run separately against the real node."

---

## 04:00 — Done

**Narrator:** "OpenClaw Working Memory Adapter for DKG V10. Every research session now compounds. Knowledge persists. Provenance is preserved."

---

## Setup Before Recording

```bash
# Install the plugin
npm install dkg-openclaw-working-memory

# Configure openclaw.json (see README.md)

# Start the DKG node
dkg start

# Verify the node responds
TOKEN=$(cat ~/.dkg/auth.token)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9200/api/status | jq .

# Clear any existing artifacts from previous test runs (optional)
# (artifacts persist — this is the feature, not a bug)
```
