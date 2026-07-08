# Changelog

All notable changes to LanzoRouter will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-08

### Added
- Initial fork from LanzoRouter
- Comprehensive `.env.example` with all OAuth credentials
- GitHub Actions CI workflow (Node 20.x, 22.x)
- Quick Start guide in README
- Repository metadata (homepage, bugs, repository URLs)
- Passwordless SSH setup for remote sync operations
- CLI commands: `lanzo` and `lanzorouter`

### Changed
- Rebranded from LanzoRouter to LanzoRouter
- All OAuth secrets moved to environment variables
- Package name: `lanzorouter` → `lanzorouter`
- CLI package: `lanzorouter-cli` → `lanzorouter-cli`
- Clean git history (secrets sanitized)

### Removed
- Hardcoded OAuth client IDs and secrets
- Build artifacts containing secrets

### Security
- All sensitive credentials now use environment variables
- SSH key-based authentication for remote operations
- GitHub secret scanning protection enabled

---

## Legacy (LanzoRouter)

This project was forked from LanzoRouter v1.0.35 with permission.
For LanzoRouter's original changelog, see upstream repository.
