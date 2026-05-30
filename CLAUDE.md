# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Server

```bash
cd server
npm install
npm start          # production
npm run dev        # development with hot-reload via nodemon
```

The server runs on `http://localhost:3000` by default. Open `demo/index.html` in a browser to use the demo (no separate build step needed — it's plain HTML/JS). The demo requires the server to be running.

**System dependency**: `ffmpeg` must be installed for audio conversion (`brew install ffmpeg` on macOS).

## Environment Variables (`server/.env`)

See [`server/.env.example`](server/.env.example) for the full list. Key variables:

```env
AURIGIN_API_KEY=...       # Required unless DEEPFAKE_BACKEND=none
OPENAI_API_KEY=...        # Required for challenge generation (GPT) and Whisper transcription
PORT=3000
ALLOWED_ORIGIN=http://localhost:8080   # Comma-separated origins, or * for all
TRANSCRIPTION_BACKEND=    # Set to "none" to skip Whisper (challenges still need OpenAI)
DEEPFAKE_BACKEND=         # Set to "none" to skip Aurigin deepfake check
REDIS_URL=                # Optional; in-memory store if unset
CAPTCHA_SECRET=           # Required for /api/siteverify token redemption
```

## Architecture

**Voice CAPTCHA (the product)**

- `src/voice-captcha.js` — `VoiceCaptcha` class; drop-in frontend widget
- `src/voice-captcha.css` — Widget styles (customizable via CSS variables on `.vc-wrapper`)
- `server/server.js` — Express backend; API calls to Aurigin and OpenAI happen here
- `server/challenge-utils.js` — Sentence splitting, word matching (`wordsMatch`), timing verification
- `server/sessions.js` — Browser sessions and HMAC proof verification
- `server/tokens.js` — Single-use verification tokens
- `server/store/` — Challenge persistence (memory or Redis)
- `server/backends/` — Pluggable transcription and deepfake adapters

**Verification flow:**
1. Frontend calls `POST /api/session` → receives `{ sessionId, sessionKey }`
2. Frontend calls `GET /api/challenge?sessionId=...` → receives `{ challengeId, sentence, words, promptText, ... }`
3. User records audio (WebM via MediaRecorder); for two-part challenges, `POST /api/challenge/reveal` reveals part 2 mid-recording
4. Frontend POSTs `multipart/form-data` with `audio`, `challengeId`, `sessionId`, `timestamp`, and HMAC `proof` to `POST /api/verify`
5. Server transcribes with OpenAI Whisper (WebM → MP3 via ffmpeg → Whisper API) unless `TRANSCRIPTION_BACKEND=none`
6. Server verifies content words via `wordsMatch` / `verifyWordsAlignment` in `server.js`, plus timing checks for split sentences
7. Server sends audio to Aurigin for deepfake detection unless `DEEPFAKE_BACKEND=none`
8. On success, server returns a single-use `verificationToken`
9. Protected actions must redeem `verificationToken` server-side via `POST /api/siteverify`

Challenges use the store abstraction (`server/store/memory.js` or `server/store/redis.js`) with default 90s TTL (`CHALLENGE_EXPIRY_MS`). Sessions default to 15 minutes.

## Aurigin API Reference

- **Deepfake detection**: `POST https://api.aurigin.ai/v1/predict` — response field is `data.global.result` (`bonafide` or `spoof`)

Auth header: `x-api-key: <key>`. Override base URL with `AURIGIN_API_URL`.

## Key Design Decisions

- The frontend sends audio as WebM; the backend converts to MP3 for Whisper and passes the original buffer to Aurigin.
- Word matching uses partial/substring logic (`wordsMatch` in `challenge-utils.js`; `verifyWordsAlignment` in `server.js`) to tolerate plurals and Whisper artifacts.
- The widget handles session creation and HMAC proofs internally; integrators using the widget do not implement signing manually.
- The `demo/` page opens as a plain file (`file://`) — the CORS middleware explicitly handles `null` origin for this case.
- Backend swapping: change the `require()` path in `server.js` lines 17–25. Env vars only disable backends (`none`), they do not select alternatives.

## Tests

```bash
cd server && npm test
```

Tests mock external services (OpenAI, Aurigin). No real API keys needed.
