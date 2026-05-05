# Demo — dkg-openclaw-working-memory

**Demo video:** [▶ Watch (2m07s)](https://github.com/drMurlly/dkg-openclaw-working-memory/releases/download/v1.0.4/dkg-demo-final-v2.mp4)

Recorded terminal walkthrough produced with [asciinema](https://asciinema.org) + [agg](https://github.com/asciinema/agg) + ffmpeg narration. American English female voice (gTTS). No manual steps — the entire session is scripted and fully automated.

---

## What the video shows

### 0:00 — Title card

> *"dkg-openclaw-working-memory — an OpenClaw plugin that captures research artifacts into DKG V10 Working Memory automatically."*

---

### 0:02 — DKG v10 node running

```bash
TOKEN=$(cat ~/.dkg/auth.token | grep -v '^#' | tr -d '\n')
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9200/api/status \
  | python3 /tmp/dkg_parse_status.py
# Output: {"name": "...", "version": "10.0.0-rc.4-dev", "nodeRole": "edge"}
```

The local DKG v10 node is live and authenticated. Bearer token is read from `~/.dkg/auth.token` with comment lines stripped.

---

### 0:12 — Plugin installed at v1.0.4

```bash
openclaw plugins list 2>&1 | grep -A 3 "dkg-openclaw"
```

Shows `dkg-openclaw-working-memory@1.0.4` loaded and active. Auto-capture is on with `minContentLength: 120` chars.

> *"The plugin loads from npm at version 1.0.4. Auto-capture is on — every assistant response is deposited automatically."*

---

### 0:26 — Agent turn: auto-capture fires on `agent_end` hook

```bash
openclaw agent --agent main \
  --message "Research note: explain reentrancy vulnerabilities in DeFi smart contracts. ..." \
  --json 2>/dev/null | python3 /tmp/dkg_parse_agent.py
```

A research prompt about reentrancy vulnerabilities is sent to the OpenClaw agent. The agent produces a substantive response (> 120 chars). The `agent_end` hook fires, the plugin captures the artifact, and deposits it into the `wm-artifacts` Context Graph automatically.

> *"We send a research prompt about reentrancy vulnerabilities in DeFi. When the agent responds, the agent_end hook fires and deposits the artifact into Working Memory — with no manual action required."*

---

### 0:54 — Artifact verified in Working Memory via DKG API

```bash
curl -s -X POST "http://127.0.0.1:9200/api/assertion/artifacts/query" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"contextGraphId":"wm-artifacts","sparql":"SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 5"}' \
  | python3 /tmp/dkg_parse_quads.py
# Output: 79 total triples in assertion
#   status: "draft"
#   artifactType: "research_note"
#   contentHash: "sha256:..."
```

The assertion holds **79 RDF triples**: content hash, status tag, and full provenance in the Working Memory ontology (`wm:` + `schema:` predicates).

> *"The assertion holds seventy-nine RDF triples: content hash, status tag, and full provenance — all in the Working Memory ontology."*

---

### 1:06 — SPARQL search via `search_working_memory` tool

```bash
AGENT=$(curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9200/api/agent/identity \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['agentAddress'])")

curl -s -X POST "http://127.0.0.1:9200/api/query" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sparql\":\"SELECT ?id ?status ?type WHERE { ... }\", \
       \"contextGraphId\":\"wm-artifacts\", \
       \"agentAddress\":\"$AGENT\"}" \
  | python3 /tmp/dkg_parse_sparql.py
# Output: 4 artifact(s) found
#   {'id': '...urn:dkg:wm:...', 'status': 'draft', 'type': 'research_note'}
```

The `search_working_memory` tool queries via `POST /api/query` with the agent's address for scoping. Returns all stored artifacts with their status tags — knowledge that persists across sessions.

> *"The search working memory tool runs a SPARQL query, scoped with the agent address. Four artifacts returned with their status tags — knowledge that persists across sessions."*

---

### 1:34 — Full test suite: 216 tests, all passing

```bash
cd /home/selon/dkg-openclaw-working-memory && npm test 2>&1 | tail -9
```

```
Test Files  13 passed (13)
     Tests  216 passed (216)
  Duration  ~7s
```

> *"The full test suite: two hundred and sixteen tests — all passing."*

---

### 1:48 — Live integration tests against the real DKG v10 node

```bash
DKG_INTEGRATION_TEST=1 npm run test:live 2>&1 | tail -7
```

All 5 live integration tests pass: node status check, deposit + read-back, SPARQL query, content-hash deduplication, secret redaction.

> *"Five live integration tests against the real DKG V10 node. All pass."*

---

### 1:57 — Done

```
dkg-openclaw-working-memory v1.0.4
Every research session now compounds.
Knowledge persists with full provenance.
Secrets never leave the machine unredacted.

npm: dkg-openclaw-working-memory@1.0.4 (with SLSA provenance)
github: drMurlly/dkg-openclaw-working-memory
```

> *"dkg-openclaw-working-memory is published on npm with SLSA provenance. Every research session now compounds."*

---

## Production details

| Property | Value |
|---|---|
| Total length | 2 min 7 sec |
| Recording tool | asciinema + agg |
| Narration | gTTS (`lang='en', tld='com'`), American English female voice |
| Video encoding | libx264, yuv420p, CRF 18 |
| Audio | AAC 192 kbps, 8 non-overlapping narration segments via ffmpeg `adelay`+`amix` |
| File size | ~5.1 MB |
| Hosted at | GitHub release v1.0.4 |
