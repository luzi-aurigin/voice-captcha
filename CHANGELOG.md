# Changelog

All notable changes to this project will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Removed
- `research/` directory — standalone Aurigin Voice ID Python scripts removed (not part of the CAPTCHA product).
- `words` widget option and adapter prop — was documented but never implemented; challenges are server-generated sentences.

### Added
- **Pluggable backends** — transcription and deepfake detection are now swappable modules. See `server/backends/*/README.md`.
- **Redis challenge store** — set `REDIS_URL` for persistent, multi-instance challenge storage. Falls back to in-memory.
- **Rate limiting** — per-IP limits on `/api/challenge` and `/api/verify` via `express-rate-limit`. Configurable via env vars.
- **Helmet** — HTTP security headers added to all responses.
- **Optional OpenAI** — word verification is now truly optional. Set `TRANSCRIPTION_BACKEND=none` to skip it.
- **Docker setup** — `docker/Dockerfile` and `docker/docker-compose.yml` for one-command deployment with Redis.
- **React adapter** — `adapters/react/index.jsx` wraps the widget as a React component.
- **Vue 3 adapter** — `adapters/vue/VoiceCaptcha.vue` wraps the widget as a Vue component.
- **More widget callbacks** — `onRecordingStart`, `onRecordingStop`, `onVerificationStart`.
- **`minDuration` option** — configurable minimum recording length (default 2 s).
- **CSS custom properties** — all colours and border radii are now CSS variables on `.vc-wrapper`, making theming trivial.
- **Test suite** — Jest unit tests for word matching and integration tests for all API endpoints.
- `server/.env.example` — template with documentation for all environment variables.
- `CONTRIBUTING.md`, `SECURITY.md` — contribution guide and vulnerability disclosure policy.

### Changed
- Button is now disabled while a challenge is loading or verification is in progress.
- `onError` callback now receives `(error, serverResult?)` — the raw server response is passed as a second argument when available.
- `onSuccess` callback now receives the full server result object.
- CSS animation names namespaced to `vc-pulse` and `vc-spin` to avoid conflicts with host page styles.
- Server returns `deepfakeChecked: false` in the response when deepfake detection is disabled, so clients can distinguish "passed" from "skipped".

### Fixed
- Record button was not disabled during verification, allowing double-submissions.
- `keepFiles=true` was hardcoded in the frontend form data — removed; it's now server-only debug behaviour.

---

## [1.0.0] — Initial release

- `VoiceCaptcha` vanilla JS widget
- Express backend with OpenAI Whisper transcription and Aurigin deepfake detection
- In-memory challenge store with 5-minute TTL
- Demo page
