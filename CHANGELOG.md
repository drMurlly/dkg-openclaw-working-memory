# Changelog

All notable changes to `dkg-openclaw-working-memory` will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-05-04

### Added
- OpenClaw plugin class with `register(api)` method — compatible with OpenClaw plugin API
- Auto-capture on `agent_end` hook: every assistant turn ≥ 120 chars is automatically deposited into Working Memory
- `before_compaction` hook: captures substantive context before it is compacted away
- **Tool: `deposit_artifact_to_working_memory`** — manual deposit with custom type, status, and title
- **Tool: `search_working_memory`** — SPARQL-backed artifact search by keyword, type, and status
- **Tool: `update_artifact_status`** — conversational status curation (draft → validated → ready_to_share)
- **Tool: `promote_artifact_to_shared_memory`** — explicit, user-confirmed promotion to Shared Working Memory
- Secret redaction layer: strips API keys, GitHub PATs, ETH private keys, PEM blocks, bearer tokens, and key=value secrets before any DKG write
- SHA-256 content-hash deduplication with file-backed persistence across sessions
- Status classification: `draft` / `review_needed` / `needs_sources` / `validated` / `ready_to_share`
- JSON-LD serialization with `wm:` and `schema:` ontology prefixes for oracle-readiness
- Full provenance tracking: session ID, conversation ID, workspace project, timestamps
- UAL storage on every DKG write — stable cross-session artifact references
- `DkgWmClient`: HTTP client for all DKG v10 API endpoints with bearer token auth and typed errors
- `DedupeStore`: in-memory + file-backed deduplication store with `assertionCreated` state
- Unit tests for all 7 core modules (73 assertions)
- Mocked E2E integration test (full deposit → dedupe → retrieval flow)
- Live integration test suite gated by `DKG_INTEGRATION_TEST=1`
- GitHub Actions CI workflow (lint + test + audit on push/PR)
- GitHub Actions publish workflow (npm publish --provenance on version tag)
- Apache-2.0 license

---

[1.0.0]: https://github.com/drMurlly/dkg-openclaw-working-memory/releases/tag/v1.0.0
