# Transcription Backends

A transcription backend converts audio to text. Voice Captcha uses transcription to verify that the user spoke the challenge sentence.

## Interface

Each backend must export a single `transcribe` function:

```js
/**
 * @param {Buffer} audioBuffer  - Raw audio bytes (WebM from browser MediaRecorder)
 * @param {object} opts
 * @param {string}  opts.language - BCP-47 language hint for transcription (optional)
 * @returns {Promise<object>}
 *   Resolve with a result object. Throw an Error on hard failure (verification returns 500).
 */
async function transcribe(audioBuffer, opts) { ... }

module.exports = { transcribe };
```

### Return contract

The server always uses `text`. For split-sentence challenges (`CAPTCHA_TWO_PART=true`), it also requires word-level alignment:

| Field | Required | Description |
|-------|----------|-------------|
| `text` | Yes | Full transcription string |
| `words` | For two-part flow | Array of `{ word, start, end, probability? }` (seconds) |
| `noSpeechProb` | Recommended | Whisper `no_speech_prob`; reject silent audio above `MAX_NO_SPEECH_PROB` |
| `avgLogprob` | Optional | Average log probability for confidence scoring |

A backend that returns only `{ text }` works for single-part word matching but **fails split-sentence timing checks** (`reason: 'no_alignment'`).

## Built-in Backends

| File | Service | Env var required | System dep |
|------|---------|-----------------|------------|
| `openai.js` | OpenAI Whisper API | `OPENAI_API_KEY` | `ffmpeg` |

## Swapping the Backend

Env vars only **disable** transcription (`TRANSCRIPTION_BACKEND=none`). To use a different provider, change the `require` path in `server.js`:

```js
// Default (when TRANSCRIPTION_BACKEND is not "none")
const transcriptionBackend = require('./backends/transcription/openai');

// Your custom backend
const transcriptionBackend = require('./backends/transcription/my-backend');
```

## Writing a Custom Backend

Create a file in this directory (or anywhere) that exports `{ transcribe }`.

Example — local `faster-whisper` via a subprocess (text-only; no split-sentence timing):

```js
'use strict';
const { execFile } = require('child_process');

async function transcribe(audioBuffer, opts = {}) {
  // Write buffer to temp file, call faster-whisper CLI, return text
  return { text: 'the transcribed text' };
}

module.exports = { transcribe };
```

Example — Groq Whisper (text-only template; not shipped in this repo):

```js
'use strict';
const Groq = require('groq-sdk');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

async function transcribe(audioBuffer, opts = {}) {
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const tmpPath = path.join(os.tmpdir(), `vc_${crypto.randomBytes(4).toString('hex')}.webm`);
  fs.writeFileSync(tmpPath, audioBuffer);
  try {
    const result = await client.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: 'whisper-large-v3',
    });
    return { text: result.text };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

module.exports = { transcribe };
```

## Disabling Word Verification

Set `TRANSCRIPTION_BACKEND=none` in `.env`. The server skips Whisper and accepts all challenges on word matching alone. Deepfake detection (if enabled) still runs.

Note: **Challenge sentence generation still requires `OPENAI_API_KEY`** unless you replace `generateSentence()` in `server.js`.
