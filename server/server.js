'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ---------------------------------------------------------------------------
// Pluggable backends
// Swap these requires to use a different transcription or deepfake service.
// See server/backends/*/README.md for the interface contract.
// ---------------------------------------------------------------------------
const transcriptionBackend =
  process.env.TRANSCRIPTION_BACKEND === 'none'
    ? null
    : require('./backends/transcription/openai');

const deepfakeBackend =
  process.env.DEEPFAKE_BACKEND === 'none'
    ? null
    : require('./backends/deepfake/aurigin');

// ---------------------------------------------------------------------------
// Challenge store
// Uses Redis when REDIS_URL is set, otherwise in-memory (lost on restart).
// ---------------------------------------------------------------------------
let store;
if (process.env.REDIS_URL) {
  store = require('./store/redis');
} else {
  store = require('./store/memory');
}

const app = express();
const tokens = require('./tokens');
const sessions = require('./sessions');
const { readIntEnv } = require('./env-utils');
const {
  extractContentWords,
  splitSentence,
  verifySplitSentenceTiming,
  normalizeWord,
  wordsMatch,
  getCaptchaConfig,
  getPromptText,
  getChallengeGenerationSpec,
  CHALLENGE_SEPARATOR,
  DEFAULT_DIFFICULTY,
} = require('./challenge-utils');

const PORT = process.env.PORT || 3000;
const CHALLENGE_EXPIRY = parseInt(process.env.CHALLENGE_EXPIRY_MS, 10) || 90 * 1000;
const SESSION_EXPIRY = parseInt(process.env.SESSION_EXPIRY_MS, 10) || 15 * 60 * 1000;
const VERIFICATION_TOKEN_TTL =
  parseInt(process.env.VERIFICATION_TOKEN_TTL_MS, 10) || 5 * 60 * 1000;

function minVerifyElapsedMs() {
  return readIntEnv('MIN_VERIFY_ELAPSED_MS', 2000);
}
function revealOffsetToleranceMs() {
  return readIntEnv('REVEAL_OFFSET_TOLERANCE_MS', 800);
}
function maxWordGapMs() {
  return readIntEnv('MAX_WORD_GAP_MS', 1000);
}
function minRevealOffsetMs() {
  return readIntEnv('MIN_REVEAL_OFFSET_MS', 500);
}

const CHALLENGE_PREFIX = 'ch:';

// ---------------------------------------------------------------------------
// Sentence generation via OpenAI
// ---------------------------------------------------------------------------
async function generateSentence(lang, difficulty = DEFAULT_DIFFICULTY, twoPart = true) {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseLang = (lang || 'en').split(/[-_]/)[0].toLowerCase();
  const spec = getChallengeGenerationSpec(difficulty, twoPart);

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for sentence generation');
  }

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You generate sentences for voice CAPTCHA verification. ' +
            spec.format,
        },
        {
          role: 'user',
          content: `Generate one sentence in the language with BCP-47 code: ${baseLang}`,
        },
      ],
      max_tokens: 80,
      temperature: 0.9,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }
  );

  const raw = response.data.choices[0].message.content.trim();
  const sentence = raw
    .replace(/^["""''„«»\s]+/, '')
    .replace(/["""''„«»\s]+$/, '')
    .replace(/[.!?]+$/, '');

  return { sentence, lang: baseLang, difficulty: spec.difficulty, twoPart: spec.twoPart };
}

// ---------------------------------------------------------------------------
// Security middleware
// ---------------------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'", 'blob:'],
    },
  },
}));

// CORS — supports comma-separated origins and file:// (null origin for local demo)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = process.env.ALLOWED_ORIGIN
    ? process.env.ALLOWED_ORIGIN.split(',').map(o => o.trim())
    : ['*'];

  if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Rate limiting
const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000;

app.use('/api/session', rateLimit({
  windowMs,
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use('/api/challenge', rateLimit({
  windowMs,
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use('/api/verify', rateLimit({
  windowMs,
  max: parseInt(process.env.RATE_LIMIT_VERIFY_MAX, 10) || 20,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use('/api/siteverify', rateLimit({
  windowMs,
  max: parseInt(process.env.RATE_LIMIT_VERIFY_MAX, 10) || 20,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, '../demo')));
app.use('/src', express.static(path.join(__dirname, '../src')));

// File upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) cb(null, true);
    else cb(new Error('Only audio files are allowed'), false);
  },
});

// ---------------------------------------------------------------------------
// Word verification with Whisper alignment scores
// ---------------------------------------------------------------------------

// Maximum no_speech_prob across all segments before we reject outright.
const MAX_NO_SPEECH_PROB = parseFloat(process.env.MAX_NO_SPEECH_PROB || '0.6');

/**
 * Verify expected words against a transcription result that may include
 * Whisper alignment data (words[], avgLogprob, noSpeechProb).
 *
 * Returns { match, confidence, wordResults, avgLogprob }
 */
function verifyWordsAlignment(result, expectedWords) {
  if (!expectedWords || expectedWords.length === 0) {
    return { match: true, confidence: 1, wordResults: [], avgLogprob: result.avgLogprob };
  }

  if (result.noSpeechProb != null && result.noSpeechProb > MAX_NO_SPEECH_PROB) {
    return { match: false, confidence: 0, reason: 'no_speech', avgLogprob: result.avgLogprob };
  }

  const expected = expectedWords.map(normalizeWord);

  // Text-based gate (primary — reliable regardless of probability field quirks)
  const cleaned = (result.text || '').toLowerCase()
    .replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
  const spokenText = cleaned.split(/\s+/).filter(w => w.length > 0);

  // Build best-probability map from alignment data for confidence scoring
  const probMap = new Map();
  if (result.words && result.words.length > 0) {
    for (const sw of result.words) {
      const key = normalizeWord(sw.word);
      const prob = typeof sw.probability === 'number' ? sw.probability : null;
      if (prob !== null && (!probMap.has(key) || prob > probMap.get(key))) {
        probMap.set(key, prob);
      }
    }
  }

  const wordResults = expected.map(exp => {
    const found = spokenText.some(sp => wordsMatch(sp, exp));

    // Confidence: best alignment probability for this word, else 1 if found in text, else 0
    let probability = null;
    for (const [key, prob] of probMap) {
      if (wordsMatch(key, exp)) {
        probability = probability === null ? prob : Math.max(probability, prob);
      }
    }
    if (probability === null) probability = found ? 1.0 : 0;

    return { word: exp, found, probability };
  });

  const allMatch = wordResults.every(r => r.found);
  const confidence = wordResults.reduce((s, r) => s + r.probability, 0) / wordResults.length;

  return { match: allMatch, confidence, wordResults, avgLogprob: result.avgLogprob };
}

async function verifyChallengeWords(audioBuffer, expectedWords, lang) {
  if (!transcriptionBackend || !expectedWords || expectedWords.length === 0) {
    return { match: true, confidence: null, wordResults: [], avgLogprob: null, result: null };
  }

  const result = await transcriptionBackend.transcribe(audioBuffer, { language: lang });

  if (!result || !result.text || result.text.trim().length === 0) {
    return {
      match: false,
      confidence: 0,
      wordResults: [],
      avgLogprob: null,
      result: null,
      reason: 'transcription_failed',
    };
  }

  const alignment = verifyWordsAlignment(result, expectedWords);
  if (!alignment.match && alignment.reason !== 'no_speech') {
    alignment.reason = alignment.reason || 'words_mismatch';
  }
  alignment.result = result;
  return alignment;
}

async function loadBoundChallenge(sessionId, challengeId) {
  const session = await sessions.get(store, sessionId);
  if (!session) {
    return { error: { status: 400, body: { error: 'Invalid or expired session', message: 'Session not found or expired. Please refresh the page.' } } };
  }

  const challenge = await store.get(`${CHALLENGE_PREFIX}${challengeId}`);
  if (!challenge) {
    return { error: { status: 400, body: { error: 'Invalid or expired challenge', message: 'Challenge not found or expired. Please request a new challenge.' } } };
  }

  if (challenge.sessionId !== sessionId) {
    return { error: { status: 403, body: { error: 'Session mismatch', message: 'This challenge belongs to a different session.' } } };
  }

  if (Date.now() - challenge.createdAt > CHALLENGE_EXPIRY) {
    await store.del(`${CHALLENGE_PREFIX}${challengeId}`);
    return { error: { status: 400, body: { error: 'Challenge expired', message: 'Challenge has expired. Please request a new challenge.' } } };
  }

  return { session, challenge };
}

async function respondWithVerificationToken(res, payload) {
  const verificationToken = await tokens.issue(store, VERIFICATION_TOKEN_TTL);
  return res.json({ ...payload, verificationToken });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    transcription: transcriptionBackend ? 'enabled' : 'disabled',
    deepfake: deepfakeBackend ? 'enabled' : 'disabled',
  });
});

app.post('/api/session', async (_req, res) => {
  try {
    const session = await sessions.create(store, SESSION_EXPIRY);
    res.json({
      sessionId: session.sessionId,
      sessionKey: session.sessionKey,
      expiresInMs: SESSION_EXPIRY,
    });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session', message: error.message });
  }
});

app.get('/api/challenge', async (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({
        error: 'Session required',
        message: 'Create a session via POST /api/session before requesting a challenge.',
      });
    }

    const session = await sessions.get(store, sessionId);
    if (!session) {
      return res.status(400).json({
        error: 'Invalid or expired session',
        message: 'Session not found or expired. Please refresh the page.',
      });
    }

    const challengeId = crypto.randomBytes(16).toString('hex');

    // Language: explicit param > Accept-Language header > 'en'
    const rawLang =
      req.query.lang ||
      (req.headers['accept-language'] || '').split(',')[0].split(';')[0].trim() ||
      'en';
    const { difficulty, twoPart } = getCaptchaConfig();

    const { sentence: generated, lang } = await generateSentence(rawLang, difficulty, twoPart);
    let part1;
    let part2;
    if (twoPart) {
      ({ part1, part2 } = splitSentence(generated));
    } else {
      part1 = generated.trim();
      part2 = '';
    }
    const sentenceFull = twoPart ? `${part1} ${part2}`.trim() : part1;

    const wordsPart1 = extractContentWords(part1);
    const wordsPart2 = twoPart ? extractContentWords(part2) : [];
    const createdAt = Date.now();

    await store.set(
      `${CHALLENGE_PREFIX}${challengeId}`,
      {
        sessionId,
        lang,
        difficulty,
        twoPart,
        sentenceFull,
        sentencePart1: part1,
        sentencePart2: part2,
        wordsPart1,
        wordsPart2,
        part2Revealed: !twoPart,
        part2RevealOffsetMs: twoPart ? null : 0,
        part2RevealedAt: twoPart ? null : createdAt,
        createdAt,
      },
      CHALLENGE_EXPIRY
    );

    const payload = {
      challengeId,
      sentence: twoPart ? part1 : sentenceFull,
      words: twoPart ? wordsPart1 : [...wordsPart1, ...wordsPart2],
      promptText: getPromptText(difficulty, twoPart),
      lang,
      expiresAt: createdAt + CHALLENGE_EXPIRY,
    };
    if (twoPart) {
      payload.separator = CHALLENGE_SEPARATOR;
    }
    res.json(payload);
  } catch (error) {
    console.error('Error generating challenge:', error);
    res.status(500).json({ error: 'Failed to generate challenge', message: error.message });
  }
});

app.post('/api/challenge/reveal', async (req, res) => {
  try {
    const { challengeId, sessionId, recordingOffsetMs: offsetRaw, timestamp, proof } = req.body || {};

    if (!challengeId || !sessionId) {
      return res.status(400).json({ error: 'Challenge and session required' });
    }
    if (!proof || !timestamp) {
      return res.status(400).json({ error: 'Proof required', message: 'Signed proof and timestamp are required.' });
    }

    const recordingOffsetMs = Number(offsetRaw);
    if (!Number.isFinite(recordingOffsetMs) || recordingOffsetMs < minRevealOffsetMs()) {
      return res.status(400).json({
        error: 'Invalid recording offset',
        message: 'Recording offset is missing or too early.',
      });
    }

    const loaded = await loadBoundChallenge(sessionId, challengeId);
    if (loaded.error) return res.status(loaded.error.status).json(loaded.error.body);

    const { session, challenge } = loaded;

    if (!challenge.twoPart) {
      return res.status(400).json({
        error: 'Not a split challenge',
        message: 'This challenge does not have a second half to reveal.',
      });
    }

    if (!sessions.verifyProof(session.sessionKey, challengeId, 'reveal', timestamp, proof)) {
      return res.status(403).json({ error: 'Invalid proof', message: 'Request signature verification failed.' });
    }

    if (challenge.part2Revealed) {
      return res.status(400).json({
        error: 'Already revealed',
        message: 'The second half was already revealed for this challenge.',
      });
    }

    const now = Date.now();
    if (now - challenge.createdAt < minVerifyElapsedMs()) {
      return res.status(400).json({
        error: 'Too fast',
        message: 'Please speak the first words before continuing.',
      });
    }

    await store.set(
      `${CHALLENGE_PREFIX}${challengeId}`,
      {
        ...challenge,
        part2Revealed: true,
        part2RevealOffsetMs: Math.round(recordingOffsetMs),
        part2RevealedAt: now,
      },
      Math.max(1000, CHALLENGE_EXPIRY - (now - challenge.createdAt))
    );

    return res.json({
      sentencePart2: challenge.sentencePart2,
      wordsPart2: challenge.wordsPart2,
      sentence: challenge.sentenceFull,
      promptText: getPromptText(challenge.difficulty, challenge.twoPart, { revealed: true }),
    });
  } catch (error) {
    console.error('Reveal error:', error);
    return res.status(500).json({ error: 'Failed to reveal challenge', message: error.message });
  }
});

app.post('/api/verify', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const { challengeId, sessionId, timestamp, proof } = req.body;

    if (!challengeId) {
      return res.status(400).json({ error: 'Challenge ID required' });
    }
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }
    if (!proof || !timestamp) {
      return res.status(400).json({
        error: 'Proof required',
        message: 'Signed proof and timestamp are required.',
      });
    }

    const loaded = await loadBoundChallenge(sessionId, challengeId);
    if (loaded.error) return res.status(loaded.error.status).json(loaded.error.body);

    const { session, challenge } = loaded;

    if (!sessions.verifyProof(session.sessionKey, challengeId, 'verify', timestamp, proof)) {
      return res.status(403).json({
        error: 'Invalid proof',
        message: 'Request signature verification failed.',
      });
    }

    if (challenge.twoPart && (!challenge.part2Revealed || challenge.part2RevealOffsetMs == null)) {
      return res.status(400).json({
        error: 'Challenge incomplete',
        message: 'The second half was not revealed during recording. Please try again.',
      });
    }

    if (req.file.size < 1000) {
      return res.status(400).json({ error: 'Audio too short', message: 'Recording must be at least 3 seconds long' });
    }

    // Single-use: delete before processing
    await store.del(`${CHALLENGE_PREFIX}${challengeId}`);

    const allWords = [...challenge.wordsPart1, ...challenge.wordsPart2];
    const alignmentResult = await verifyChallengeWords(req.file.buffer, allWords, challenge.lang);

    if (!alignmentResult.match) {
      return res.status(400).json({
        success: false,
        error: alignmentResult.reason === 'no_speech' ? 'No speech detected' : 'Words do not match',
        message: alignmentResult.reason === 'no_speech'
          ? 'No speech was detected in the recording. Please try again.'
          : 'The spoken words do not match the challenge. Please try again.',
        alignment: {
          wordResults: alignmentResult.wordResults,
          confidence: alignmentResult.confidence,
          avgLogprob: alignmentResult.avgLogprob,
        },
      });
    }

    if (transcriptionBackend && alignmentResult.result && challenge.twoPart) {
      const timing = verifySplitSentenceTiming(
        alignmentResult.result,
        challenge.wordsPart1,
        challenge.wordsPart2,
        challenge.part2RevealOffsetMs,
        revealOffsetToleranceMs(),
        maxWordGapMs()
      );

      if (!timing.match) {
        const messages = {
          no_alignment: 'Could not verify speech timing. Please try again.',
          part1_after_reveal: 'The first half must be spoken before the rest of the sentence appears.',
          part2_before_reveal: 'The second half was spoken too early. Please follow the on-screen prompt.',
          words_mismatch: 'The spoken words do not match the challenge. Please try again.',
          word_gap_exceeded: 'Speech had too long a pause between words. Please speak the sentence continuously.',
        };

        return res.status(400).json({
          success: false,
          error: 'Timing verification failed',
          message: messages[timing.reason] || 'Speech timing verification failed. Please try again.',
          timing,
        });
      }
    }

    if (!deepfakeBackend) {
      return respondWithVerificationToken(res, {
        success: true,
        prediction: 'bonafide',
        confidence: null,
        wordsVerified: alignmentResult.match,
        alignment: {
          confidence: alignmentResult.confidence,
          avgLogprob: alignmentResult.avgLogprob,
          wordResults: alignmentResult.wordResults,
        },
        deepfakeChecked: false,
      });
    }

    const { prediction, confidence } = await deepfakeBackend.detect(req.file.buffer);

    const passed = prediction === 'bonafide' || prediction === 'real';

    if (!passed) {
      return res.json({
        success: false,
        prediction,
        confidence,
        wordsVerified: alignmentResult.match,
        alignment: {
          confidence: alignmentResult.confidence,
          avgLogprob: alignmentResult.avgLogprob,
          wordResults: alignmentResult.wordResults,
        },
        deepfakeChecked: true,
        error: 'Deepfake detected',
        message: 'Audio did not pass authenticity check.',
      });
    }

    return respondWithVerificationToken(res, {
      success: true,
      prediction,
      confidence,
      wordsVerified: alignmentResult.match,
      alignment: {
        confidence: alignmentResult.confidence,
        avgLogprob: alignmentResult.avgLogprob,
        wordResults: alignmentResult.wordResults,
      },
      deepfakeChecked: true,
    });

  } catch (error) {
    console.error('Verification error:', error.message);

    if (error.response) {
      return res.status(error.response.status || 500).json({
        error: 'Upstream service error',
        message: error.response.data?.message || 'Verification service returned an error',
      });
    }
    if (error.request) {
      return res.status(503).json({ error: 'Service unavailable', message: 'Could not reach verification service' });
    }
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * Redeem a verification token server-side (reCAPTCHA siteverify-style).
 * Your backend must call this with CAPTCHA_SECRET — never expose the secret to browsers.
 */
app.post('/api/siteverify', async (req, res) => {
  try {
    const { token, secret } = req.body || {};
    const captchaSecret = process.env.CAPTCHA_SECRET;

    if (!captchaSecret) {
      return res.status(503).json({
        success: false,
        error: 'CAPTCHA_SECRET is not configured on the verification server',
      });
    }

    if (!secret || secret !== captchaSecret) {
      return res.status(403).json({ success: false, error: 'Invalid secret' });
    }

    if (!token) {
      return res.status(400).json({ success: false, error: 'Token required' });
    }

    const valid = await tokens.consume(store, token);
    if (!valid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired verification token',
      });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Siteverify error:', error.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * Demo form handler — shows the required server-side token check before accepting an action.
 */
app.post('/api/demo/submit', async (req, res) => {
  try {
    const { verificationToken, email } = req.body || {};

    if (!verificationToken) {
      return res.status(400).json({
        success: false,
        error: 'Verification token required',
        message: 'Complete the voice CAPTCHA before submitting.',
      });
    }

    const valid = await tokens.consume(store, verificationToken);
    if (!valid) {
      return res.status(403).json({
        success: false,
        error: 'Invalid or expired verification token',
        message: 'Voice verification is missing or expired. Please try again.',
      });
    }

    return res.json({
      success: true,
      message: 'Account created successfully.',
      email: email || null,
    });
  } catch (error) {
    console.error('Demo submit error:', error.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large', message: 'Audio exceeds 10 MB limit' });
  }
  if (error && error.message === 'Only audio files are allowed') {
    return res.status(400).json({ error: 'Invalid file type', message: 'Only audio files are accepted' });
  }
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error', message: error.message });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Voice Captcha server running on port ${PORT}`);
    if (!process.env.AURIGIN_API_KEY && deepfakeBackend) {
      console.warn('WARNING: AURIGIN_API_KEY is not set — deepfake detection will fail');
    }
    if (!process.env.OPENAI_API_KEY && transcriptionBackend) {
      console.warn('WARNING: OPENAI_API_KEY is not set — word verification will fail');
    }
    if (!process.env.CAPTCHA_SECRET) {
      console.warn('WARNING: CAPTCHA_SECRET is not set — /api/siteverify will reject requests');
    }
  });
}

module.exports = app;
