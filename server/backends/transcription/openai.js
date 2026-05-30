'use strict';

const FormData = require('form-data');
const axios = require('axios');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const { exec } = require('child_process');

async function convertToMP3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = `ffmpeg -i "${inputPath}" -acodec libmp3lame -ab 128k "${outputPath}" -y`;
    exec(cmd, (error) => {
      if (error) reject(error);
      else resolve(outputPath);
    });
  });
}

/**
 * Transcription backend using OpenAI Whisper.
 *
 * Required env: OPENAI_API_KEY
 * System dep:   ffmpeg (for WebM → MP3 conversion)
 *
 * Returns: { text: string } | null
 */
async function transcribe(audioBuffer, { language = null } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error('Empty audio buffer');
  }

  const id = crypto.randomBytes(8).toString('hex');
  const inputPath = path.join(os.tmpdir(), `vc_input_${id}.webm`);
  const outputPath = path.join(os.tmpdir(), `vc_output_${id}.mp3`);

  try {
    fs.writeFileSync(inputPath, audioBuffer);
    await convertToMP3(inputPath, outputPath);

    const mp3Buffer = fs.readFileSync(outputPath);
    const form = new FormData();
    form.append('file', mp3Buffer, { filename: 'audio.mp3', contentType: 'audio/mpeg' });
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    if (language) form.append('language', language);

    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: { 'Authorization': `Bearer ${apiKey.trim()}`, ...form.getHeaders() },
      timeout: 30000,
    });

    const data = response.data;
    const text = typeof data === 'string' ? data : (data.text || '');
    const words = data.words || [];
    const segments = data.segments || [];
    const avgLogprob = segments.length > 0
      ? segments.reduce((s, seg) => s + (seg.avg_logprob || 0), 0) / segments.length
      : null;
    const noSpeechProb = segments.length > 0
      ? Math.max(...segments.map(s => s.no_speech_prob || 0))
      : null;

    return {
      text: text.trim(),
      words,
      avgLogprob,
      noSpeechProb,
    };
  } finally {
    for (const p of [inputPath, outputPath]) {
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
    }
  }
}

module.exports = { transcribe };
