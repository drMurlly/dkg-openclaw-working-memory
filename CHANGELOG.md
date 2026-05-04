# Changelog

All notable changes to `dkg-openclaw-working-memory` will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Initial plugin implementation
- Automatic artifact capture on `agent_end` hook
- `deposit_artifact_to_working_memory` tool
- `search_working_memory` tool
- `update_artifact_status` tool
- `promote_artifact_to_shared_memory` tool
- `list_working_memory_artifacts` tool
- Secret redaction layer (API keys, private keys, bearer tokens, PEM blocks, `.env`-style secrets)
- SHA-256 content-hash deduplication
- Status classification (`draft` / `needs_sources` / `validated` / `ready_to_share`)
- JSON-LD serialization with `wm:` and `schema:` predicates for oracle-readiness
- Full provenance tracking (session ID, conversation ID, agent ID, tool calls)
- UAL storage for stable cross-session artifact references
- Unit tests for all core modules
- Mocked E2E integration test
- Live integration test suite (`npm run test:live`)
- GitHub Actions CI with npm provenance publishing

---

[Unreleased]: https://github.com/drMurlly/dkg-openclaw-working-memory/compare/HEAD...HEAD
