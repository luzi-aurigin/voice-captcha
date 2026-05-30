# Voice Captcha

A voice-based CAPTCHA with deepfake detection. Users speak a generated sentence aloud; the server transcribes it, checks speech timing (for split-sentence challenges), and verifies the audio is genuine human speech using [Aurigin.ai](https://aurigin.ai).

Drop the widget into any web page in under 5 minutes. The widget handles sessions, HMAC proofs, and optional two-part sentence reveal automatically. Swap the transcription and deepfake backends to fit your stack.

## Demo

<video src="docs/voice-captcha-demo.mp4" controls style="max-width: 100%; border-radius: 8px; margin-bottom: 1rem;"></video>

---

## Features

- **Drop-in widget** — one `<script>` tag, no build step
- **Deepfake detection** — verifies audio is genuine human speech
- **Sentence verification** — OpenAI Whisper confirms the challenge was spoken
- **Split-sentence flow** — optional two-part reveal to resist replay attacks
- **Pluggable backends** — swap Aurigin or OpenAI for any compatible service
- **Framework adapters** — React and Vue wrappers included
- **Themeable** — CSS custom properties for colours, fonts, and radii
- **Dark mode** — automatic via `prefers-color-scheme`
- **Rate limited** — per-IP limits out of the box
- **Production ready** — Docker + Redis setup for multi-instance deployments

---

## Quick start

### 1. Start the backend

```bash
cd server
cp .env.example .env
# Edit .env: set AURIGIN_API_KEY and OPENAI_API_KEY
npm install
npm start
```

The server runs on `http://localhost:3000`.

> **System requirement**: `ffmpeg` must be installed for audio conversion.
>
> - macOS: `brew install ffmpeg`
> - Ubuntu/Debian: `sudo apt-get install ffmpeg`
> - Windows: [ffmpeg.org/download.html](https://ffmpeg.org/download.html)

> **API keys**: `OPENAI_API_KEY` is required for challenge sentence generation (GPT) and Whisper transcription. Set `TRANSCRIPTION_BACKEND=none` to skip Whisper only — challenges still need OpenAI unless you replace `generateSentence()` in `server.js`.

### 2. Add the widget

```html
<link rel="stylesheet" href="path/to/voice-captcha.css">
<script src="path/to/voice-captcha.js"></script>

<div id="voice-captcha-container"></div>

<script>
  const captcha = new VoiceCaptcha({
    apiEndpoint: 'http://localhost:3000/api/verify',
    onSuccess: (result) => console.log('Verified!', result),
    onError: (err) => console.error('Failed:', err.message),
  });
  captcha.init('voice-captcha-container');
</script>
```

The widget creates a session, fetches a challenge, signs verify/reveal requests with HMAC, and returns a `verificationToken` on success. Open `demo/index.html` (with the server running) for a full working example including token redemption.

---

## How verification works

```mermaid
sequenceDiagram
  participant Browser
  participant CaptchaServer
  participant YourBackend

  Browser->>CaptchaServer: POST /api/session
  CaptchaServer-->>Browser: sessionId, sessionKey
  Browser->>CaptchaServer: GET /api/challenge?sessionId=
  CaptchaServer-->>Browser: challengeId, sentence, promptText
  Note over Browser: Record audio; optional reveal for part 2
  Browser->>CaptchaServer: POST /api/verify (audio, proof, timestamp)
  CaptchaServer-->>Browser: verificationToken
  Browser->>YourBackend: form submit + verificationToken
  YourBackend->>CaptchaServer: POST /api/siteverify (secret + token)
  CaptchaServer-->>YourBackend: success
```



When integrating manually (without the widget), you must implement the same session and HMAC proof flow. The widget does this for you.

---

## Installation

### CDN

```html
<!-- Replace x.x.x with the latest version -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/voice-captcha@x.x.x/src/voice-captcha.css">
<script src="https://cdn.jsdelivr.net/npm/voice-captcha@x.x.x/src/voice-captcha.js"></script>
```

### npm

```bash
npm install voice-captcha
```

```js
import VoiceCaptcha from 'voice-captcha';
import 'voice-captcha/src/voice-captcha.css';
```

### React

```jsx
import VoiceCaptchaWidget from 'voice-captcha/adapters/react';
import 'voice-captcha/src/voice-captcha.css';

<VoiceCaptchaWidget
  apiEndpoint="https://your-server.com/api/verify"
  onSuccess={(result) => console.log('Passed', result)}
  onError={(err) => console.error('Failed', err)}
/>
```

### Vue 3

```vue
<script setup>
import VoiceCaptcha from 'voice-captcha/adapters/vue/VoiceCaptcha.vue';
import 'voice-captcha/src/voice-captcha.css';
</script>

<template>
  <VoiceCaptcha
    api-endpoint="https://your-server.com/api/verify"
    @success="onSuccess"
    @error="onError"
  />
</template>
```

---

## Widget API

### Constructor options


| Option                | Type     | Default              | Description                                                              |
| --------------------- | -------- | -------------------- | ------------------------------------------------------------------------ |
| `apiEndpoint`         | string   | `/api/verify`        | Backend verify URL (session/challenge/reveal URLs are derived from this) |
| `challengeEndpoint`   | string   | derived              | Override the challenge URL                                               |
| `revealEndpoint`      | string   | derived              | Override the reveal URL                                                  |
| `sessionEndpoint`     | string   | derived              | Override the session URL                                                 |
| `lang`                | string   | `navigator.language` | BCP-47 language hint for challenges                                      |
| `minDuration`         | number   | `2`                  | Minimum recording length (seconds)                                       |
| `silenceThreshold`    | number   | `0.02`               | VAD level below which audio counts as silence                            |
| `silenceDelay`        | number   | `1500`               | Milliseconds of silence before auto-stop                                 |
| `privacyUrl`          | string   | —                    | HTTPS URL for the Privacy link in the widget footer                      |
| `termsUrl`            | string   | —                    | HTTPS URL for the Terms link in the widget footer                        |
| `onSuccess`           | function | `() => {}`           | Called with server result (includes `verificationToken`) on pass         |
| `onError`             | function | `() => {}`           | Called with `(error, result?)` on fail                                   |
| `onRecordingStart`    | function | `() => {}`           | Called when recording begins                                             |
| `onRecordingStop`     | function | `() => {}`           | Called with `{ duration }` when recording stops                          |
| `onVerificationStart` | function | `() => {}`           | Called when upload starts                                                |


### Methods


| Method                   | Description                                                       |
| ------------------------ | ----------------------------------------------------------------- |
| `init(containerId)`      | Render the widget into the given element ID                       |
| `reset()`                | Load a new challenge and reset the widget                         |
| `getVerificationToken()` | Returns the single-use token after a successful verify, or `null` |


---

## Backend setup

### Environment variables

See `[server/.env.example](server/.env.example)` for the full reference. Key variables:


| Variable                    | Required | Description                                                      |
| --------------------------- | -------- | ---------------------------------------------------------------- |
| `AURIGIN_API_KEY`           | Yes*     | Aurigin deepfake detection                                       |
| `OPENAI_API_KEY`            | Yes**    | GPT sentence generation + Whisper transcription                  |
| `PORT`                      | No       | Server port (default `3000`)                                     |
| `ALLOWED_ORIGIN`            | No       | Comma-separated CORS origins, or `*`                             |
| `REDIS_URL`                 | No       | Redis URL for production (e.g. `redis://localhost:6379`)         |
| `RATE_LIMIT_MAX`            | No       | Max session/challenge requests per IP per window (default `100`) |
| `RATE_LIMIT_VERIFY_MAX`     | No       | Max verify/siteverify requests per IP per window (default `20`)  |
| `CHALLENGE_EXPIRY_MS`       | No       | Challenge TTL in ms (default `90000`)                            |
| `SESSION_EXPIRY_MS`         | No       | Browser session TTL in ms (default `900000`)                     |
| `VERIFICATION_TOKEN_TTL_MS` | No       | Verification token TTL in ms (default `300000`)                  |
| `CAPTCHA_SECRET`            | Yes*     | Secret for `/api/siteverify` token redemption                    |
| `DEEPFAKE_BACKEND`          | No       | Set to `none` to disable deepfake detection                      |
| `TRANSCRIPTION_BACKEND`     | No       | Set to `none` to skip Whisper (challenges still need OpenAI)     |
| `MAX_NO_SPEECH_PROB`        | No       | Reject near-silent audio (default `0.6`)                         |
| `PROOF_MAX_SKEW_MS`         | No       | HMAC proof clock skew tolerance (default `60000`)                |


*AURIGIN required unless `DEEPFAKE_BACKEND=none`. `CAPTCHA_SECRET` required for production integrations using `/api/siteverify`.

**Required for challenge generation. Omitting it causes `/api/challenge` to fail unless you replace sentence generation.

### Docker (recommended for production)

```bash
cd docker
cp ../server/.env.example .env
# Edit .env
docker compose up -d
```

Includes Redis for challenge persistence across restarts and instances. See `[docker/README.md](docker/README.md)`.

### Redis

Without Redis, challenges are stored in memory and lost on restart. For production:

```env
REDIS_URL=redis://localhost:6379
```

---

## Pluggable backends

Voice Captcha ships with Aurigin (deepfake) and OpenAI Whisper (transcription) as defaults. Both are swappable by adding a file and changing one `require` in `server.js`. Environment variables (`TRANSCRIPTION_BACKEND`, `DEEPFAKE_BACKEND`) only disable backends (`none`); they do not select alternatives.

### Swap the transcription backend

```js
// server/server.js — change one line
const transcriptionBackend = require('./backends/transcription/my-groq-backend');
```

See `[server/backends/transcription/README.md](server/backends/transcription/README.md)` for the interface and example implementations (Groq, local faster-whisper, etc.).

### Swap the deepfake backend

```js
const deepfakeBackend = require('./backends/deepfake/my-backend');
```

See `[server/backends/deepfake/README.md](server/backends/deepfake/README.md)`.

---

## Customisation

### Theming

Override CSS custom properties on `.vc-wrapper`:

```css
#my-captcha .vc-wrapper {
  --vc-primary:       #7c3aed;  /* button + words colour */
  --vc-primary-hover: #6d28d9;
  --vc-success:       #059669;
  --vc-error:         #dc2626;
  --vc-radius:        12px;
  --vc-font:          'Inter', sans-serif;
}
```

### Privacy and Terms links

Pass `privacyUrl` and/or `termsUrl` (must be `http://` or `https://`). Links open in a new tab. If neither is set, the footer shows branding only.

```js
const captcha = new VoiceCaptcha({
  apiEndpoint: '...',
  privacyUrl: 'https://yoursite.com/privacy',
  termsUrl: 'https://yoursite.com/terms',
});
```

---

## API reference

The widget implements this flow automatically. Use these endpoints directly only for custom clients.

### `POST /api/session`

Creates a browser-bound session. The returned `sessionKey` must stay in the client — it signs verify and reveal requests.

```json
// Response
{
  "sessionId": "32-char-hex",
  "sessionKey": "64-char-hex",
  "expiresInMs": 900000
}
```

### `GET /api/challenge?sessionId=<id>&lang=<optional>`

Returns a challenge bound to the session.

```json
{
  "challengeId": "32-char-hex",
  "sentence": "the quiet harbor waits",
  "words": ["quiet", "harbor", "waits"],
  "promptText": "Say the sentence aloud",
  "lang": "en",
  "expiresAt": 1710000000000,
  "separator": " | "
}
```

For two-part challenges (`CAPTCHA_TWO_PART=true`), `sentence` is part 1 only. Part 2 is revealed via `POST /api/challenge/reveal` during recording. The `words` array lists content words to verify (derived from the sentence, not a fixed word pool).

### `POST /api/challenge/reveal`

Reveals the second half of a split-sentence challenge. JSON body:

```json
{
  "challengeId": "...",
  "sessionId": "...",
  "recordingOffsetMs": 1200,
  "timestamp": 1710000000000,
  "proof": "hmac-sha256-hex"
}
```

Proof: `HMAC-SHA256(sessionKey, challengeId + ":reveal:" + timestamp)`.

### `POST /api/verify`

Verifies audio. `multipart/form-data`:


| Field         | Description                                                     |
| ------------- | --------------------------------------------------------------- |
| `audio`       | WebM from browser MediaRecorder                                 |
| `challengeId` | From challenge response                                         |
| `sessionId`   | From session response                                           |
| `timestamp`   | Unix ms timestamp                                               |
| `proof`       | `HMAC-SHA256(sessionKey, challengeId + ":verify:" + timestamp)` |


```json
{
  "success": true,
  "prediction": "bonafide",
  "confidence": 0.97,
  "wordsVerified": true,
  "deepfakeChecked": true,
  "verificationToken": "64-char-hex-string"
}
```

On success, a single-use `verificationToken` is returned. Your protected backend must redeem it before accepting the user action (see below).

### `POST /api/siteverify`

Redeem a verification token server-side (similar to reCAPTCHA siteverify). **Call this from your backend only** — never expose `CAPTCHA_SECRET` to the browser.

```json
// Request
{ "token": "<verificationToken>", "secret": "<CAPTCHA_SECRET>" }

// Response
{ "success": true }
```

Tokens expire after `VERIFICATION_TOKEN_TTL_MS` (default 5 minutes) and are single-use.

```js
// Example: validate in your signup handler
const resp = await fetch('https://your-captcha-server/api/siteverify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    token: req.body.verificationToken,
    secret: process.env.CAPTCHA_SECRET,
  }),
});
const { success } = await resp.json();
if (!success) return res.status(403).json({ error: 'CAPTCHA failed' });
```

### `GET /health`

```json
{
  "status": "ok",
  "timestamp": "...",
  "transcription": "enabled",
  "deepfake": "enabled"
}
```

---

## Browser support


| Browser           | Support                         |
| ----------------- | ------------------------------- |
| Chrome / Edge     | Full                            |
| Safari 14.1+      | Full                            |
| Firefox           | Full                            |
| Safari < 14.1     | Partial (MediaRecorder limited) |
| Internet Explorer | Not supported                   |


---

## Development

```bash
# Run server in dev mode with hot-reload
cd server && npm run dev

# Run tests
cd server && npm test

# Open demo (server must be running)
open demo/index.html
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add backends, write tests, and open PRs.

---

## Security

See [SECURITY.md](SECURITY.md) for vulnerability disclosure and deployment hardening checklist.

---

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

- [Aurigin.ai](https://aurigin.ai) for deepfake detection
- [OpenAI Whisper](https://openai.com/research/whisper) for transcription
- [MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) for in-browser audio capture

