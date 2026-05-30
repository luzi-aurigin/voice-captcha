'use strict';

const FormData = require('form-data');
const axios = require('axios');

const DEFAULT_URL = 'https://api.aurigin.ai/v1/predict';

/**
 * Deepfake detection backend using Aurigin.ai.
 *
 * Required env: AURIGIN_API_KEY
 * Optional env: AURIGIN_API_URL (defaults to https://api.aurigin.ai/v1/predict)
 *
 * Returns: { prediction: 'bonafide' | 'spoof', confidence: number | null }
 */
async function detect(audioBuffer) {
  const apiKey = process.env.AURIGIN_API_KEY;
  if (!apiKey) throw new Error('AURIGIN_API_KEY is not set');

  const url = process.env.AURIGIN_API_URL || DEFAULT_URL;

  const form = new FormData();
  form.append('file', audioBuffer, { filename: 'recording.wav', contentType: 'audio/wav' });

  const response = await axios.post(url, form, {
    headers: { 'x-api-key': apiKey, ...form.getHeaders() },
    timeout: 30000,
  });

  const data = response.data;
  const prediction =
    data.global?.result ||
    data.prediction ||
    data.result?.prediction ||
    data.class ||
    'unknown';

  const confidence =
    data.global?.confidence ||
    data.confidence ||
    data.score ||
    null;

  return { prediction: prediction.toLowerCase(), confidence };
}

module.exports = { detect };
