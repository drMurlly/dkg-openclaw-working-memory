# Changelog

All notable changes to `dkg-openclaw-working-memory` will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.2] - 2026-05-05

### Fixed

- **OpenClaw plugin discovery:** Added `"openclaw": { "extensions": ["./dist/index.js"] }` to `package.json` so `openclaw plugins install` can discover and load the extension entry point correctly.

---

## [1.0.1] - 2026-05-04

### Fixed

- **SPARQL injection:** All user-supplied query strings now escaped for `\`, `"`, `\n`, `\r`, `\t` before SPARQL interpolation; status and type filter values validated against enum (invalid values dropped, never injected).
- **N-Quads `lit()` escaping:** Added `\r` and `\t` escaping to cover all SPARQL 1.1 §19.8 special characters.
- **GRAPH clause removed from search SPARQL:** Bare assertion name is not a valid named graph URI; daemon scopes via `contextGraphId` + API params — no GRAPH clause needed.
- **Tool error wrapping:** All four tool handlers now catch DKG client errors and return `{success: false, message: ...}` instead of throwing — agent turns are never disrupted.
- **409 Conflict handling:** `ensureContextGraph` and `createAssertion` now match 409 by HTTP status code alone (not message text) — robust across DKG node implementations.
- **Uninitialized state guard:** `capture()` returns immediately if `client`, `dedupe`, or `config` are not yet set — safe to call before `register()` completes.
- **`before_compaction` safety:** `messages` validated with `Array.isArray()`; each message's `role` and `text` fields guarded against missing/wrong-type values.
- **Tilde expansion anchored:** Auth token path tilde expansion uses `/^~/` regex (anchored to start of string) instead of string replace.
- **NaN/Infinity limit guard:** `Number.isFinite()` check prevents `LIMIT NaN` or `LIMIT Infinity` in generated SPARQL.
- **Query truncation:** Search query strings trimmed and truncated to 500 characters before SPARQL interpolation.
- **CI lockfile:** Regenerated `package-lock.json` to resolve `vitest@1.6.0`/`1.6.1` peer dependency mismatch that failed `npm ci`.

### Changed

- **219 tests** (214 unit/integration + 5 live), up from 73 at initial tag.
- **98.97% statement coverage**, **93.25% branch coverage**, **100% function coverage**.
- Documentation fully audited: corrected `minContentLength` default (120, not 200), added `agentId` / `DKG_WM_AGENT_ID`, accurate test counts, expanded security sections.

---

## [1.0.0] - 2026-05-04

### Added

**Core plugin:**
- OpenClaw plugin class with `register(api)` method — compatible with OpenClaw plugin API
- Auto-capture on `agent_end` hook: every assistant turn ≥ 120 chars is automatically deposited into Working Memory
- `before_compaction` hook: captures substantive assistant messages before the conversation context is compacted, preventing knowledge loss
- Uninitialized-state guard in `capture()` — safe to call before `register()` completes

**Tools (4):**
- `deposit_artifact_to_working_memory` — manual deposit with custom type, status, and title; returns UAL
- `search_working_memory` — SPARQL-backed search by keyword, type, and status; results capped at 100; query length capped at 500 chars
- `update_artifact_status` — conversational status curation (draft → validated → ready_to_share)
- `promote_artifact_to_shared_memory` — explicit, user-confirmed promotion to Shared Working Memory (`confirm=true` required)

All tool handlers return `{success: false, message: ...}` on DKG errors — they never throw, ensuring agent turns are never disrupted.

**Security and hardening:**
- Secret redaction layer: strips OpenAI-style `sk-` keys, GitHub PATs (`ghp_`, `ghr_`, `ghs_`), ETH hex private keys, PEM blocks, bearer tokens, and `.env`-style `KEY=value` secrets before any DKG write
- SPARQL injection prevention: user-supplied query strings are escaped (`\`, `"`, `\n`, `\r`, `\t`) before SPARQL interpolation; status and type validated against enum before use
- Input size limits: content capped at 500 KB; SPARQL query strings truncated at 500 chars
- `NaN`/`Infinity` guard on the `limit` parameter — `LIMIT NaN` in SPARQL is impossible
- N-Quads `lit()` function escapes all SPARQL 1.1 §19.8 special characters: `\\`, `"`, `\r`, `\n`, `\t`
- Bearer token file parser strips `# comment` lines (matches real DKG node token file format)
- Tilde expansion in token path anchored to start of string (`/^~/`)
- 409 Conflict responses swallowed by HTTP status code alone — no fragile message-text match needed

**DKG client (`DkgWmClient`):**
- Full HTTP client for all DKG v10 API endpoints with bearer token auth
- `createContextGraph`, `ensureContextGraph` (idempotent), `createAssertion`, `writeAssertion`, `createOrWriteAssertion`
- `queryAssertion`, `getAssertionHistory`, `promoteAssertion`, `querySparql`, `getStatus`
- Typed error classes: `DkgAuthError`, `DkgUnavailableError`, `DkgApiError`
- Exponential-backoff retry (up to 3 attempts) on `DkgUnavailableError` (502, 503, ECONNREFUSED); never retries 4xx or auth errors
- 30-second per-request timeout via `AbortController`

**Modules:**
- `artifact-normalizer`: builds canonical `ArtifactRecord` from raw capture input; validates content type, size, and minimum length
- `provenance-builder`: attaches author, agent, session IDs, SHA-256 content hash, timestamps, workspace project
- `status-classifier`: assigns `draft` / `review_needed` / `needs_sources` / `validated` based on content heuristics
- `jsonld-serializer`: serializes to JSON-LD and RDF quads using `wm:` + `schema:` ontology for oracle-readiness
- `secret-redactor`: single-pass compiled regex redaction
- `dedupe-store`: in-memory + file-backed SHA-256 content-hash deduplication with `assertionCreated` state and ENOENT recovery

**Configuration:**
- Full config loading from `~/.openclaw/openclaw.json` with env var overrides (`DKG_AUTH_TOKEN`, `DKG_DAEMON_URL`, `DKG_WM_CONTEXT_GRAPH`, `DKG_WM_ASSERTION_NAME`, `DKG_WM_AUTHOR_ID`, `DKG_WM_CAPTURE_ENABLED`)

**Testing:**
- 219 tests total across 13 test files (214 unit/integration pass; 5 live integration tests gated by `DKG_INTEGRATION_TEST=1`)
- **98.97% statement coverage**, **93.25% branch coverage**, **100% function coverage** (via `@vitest/coverage-v8`)
- Live integration test suite verified against a real DKG v10 node (`10.0.0-rc.4-dev`)
- Mocked E2E integration tests covering full deposit → dedupe → retrieval flow

**CI/CD:**
- GitHub Actions CI workflow: `npm ci` + build + lint + test + audit on every push and PR
- GitHub Actions publish workflow: `npm publish --provenance` on version tag push (OIDC-backed build attestation)
- `npm audit --production` clean (0 vulnerabilities in production dependencies)

---

[1.0.2]: https://github.com/drMurlly/dkg-openclaw-working-memory/releases/tag/v1.0.2
[1.0.1]: https://github.com/drMurlly/dkg-openclaw-working-memory/releases/tag/v1.0.1
[1.0.0]: https://github.com/drMurlly/dkg-openclaw-working-memory/releases/tag/v1.0.0
