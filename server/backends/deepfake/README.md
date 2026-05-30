# Deepfake Detection Backends

A deepfake detection backend determines whether recorded audio is genuine human speech or a synthetic/replayed voice.

## Interface

Each backend must export a single `detect` function:

```js
/**
 * @param {Buffer} audioBuffer - Raw audio bytes
 * @returns {Promise<{ prediction: 'bonafide' | 'spoof' | string, confidence: number | null }>}
 *   Resolve with a result object.
 *   Throw an Error to indicate a hard failure (verification will return 500).
 */
async function detect(audioBuffer) { ... }

module.exports = { detect };
```

The server considers `prediction === 'bonafide'` or `prediction === 'real'` a pass. All other values are treated as a fail.

## Built-in Backends

| File | Service | Env vars |
|------|---------|----------|
| `aurigin.js` | Aurigin.ai deepfake detection | `AURIGIN_API_KEY`, optional `AURIGIN_API_URL` |

## Swapping the Backend

Env vars only **disable** deepfake detection (`DEEPFAKE_BACKEND=none`). To use a different provider, change the `require` path in `server.js`:

```js
// Default (when DEEPFAKE_BACKEND is not "none")
const deepfakeBackend = require('./backends/deepfake/aurigin');

// Your custom backend
const deepfakeBackend = require('./backends/deepfake/my-backend');
```

## Writing a Custom Backend

Create a file that exports `{ detect }`.

Example — always-pass stub (for testing / when you don't have an API key):

```js
'use strict';

async function detect(_audioBuffer) {
  return { prediction: 'bonafide', confidence: 1.0 };
}

module.exports = { detect };
```

Example — custom in-house model via HTTP:

```js
'use strict';
const axios = require('axios');
const FormData = require('form-data');

async function detect(audioBuffer) {
  const form = new FormData();
  form.append('audio', audioBuffer, { filename: 'audio.webm' });

  const res = await axios.post(process.env.DEEPFAKE_API_URL, form, {
    headers: { 'Authorization': `Bearer ${process.env.DEEPFAKE_API_KEY}`, ...form.getHeaders() },
    timeout: 30000,
  });

  return {
    prediction: res.data.is_real ? 'bonafide' : 'spoof',
    confidence: res.data.score ?? null,
  };
}

module.exports = { detect };
```

## Disabling Deepfake Detection

Set `DEEPFAKE_BACKEND=none` in `.env` to skip deepfake checking (word verification only). Not recommended for production.
