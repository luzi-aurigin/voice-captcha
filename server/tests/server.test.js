'use strict';

jest.mock('axios', () => ({
  post: jest.fn(),
}));

process.env.TRANSCRIPTION_BACKEND = 'none';
process.env.DEEPFAKE_BACKEND = 'none';
process.env.CAPTCHA_SECRET = 'test-captcha-secret';
process.env.MIN_VERIFY_ELAPSED_MS = '0';
process.env.MIN_REVEAL_OFFSET_MS = '0';
process.env.NODE_ENV = 'test';

const crypto = require('crypto');
const axios = require('axios');
const request = require('supertest');
const app = require('../server');
const sessions = require('../sessions');

beforeEach(() => {
  delete process.env.CAPTCHA_DIFFICULTY;
  delete process.env.CAPTCHA_TWO_PART;
  axios.post.mockReset();
  axios.post.mockImplementation((url) => {
    if (url.includes('chat/completions')) {
      return Promise.resolve({
        data: {
          choices: [{
            message: {
              content: 'apple mountain tiger | ocean castle river forest bridge valley sunset meadow',
            },
          }],
        },
      });
    }
    return Promise.reject(new Error(`Unexpected axios call: ${url}`));
  });
});

async function createSession() {
  const res = await request(app).post('/api/session');
  expect(res.status).toBe(200);
  return res.body;
}

async function getChallenge(sessionId, query = {}) {
  const params = new URLSearchParams({ sessionId, ...query });
  const res = await request(app).get(`/api/challenge?${params.toString()}`);
  expect(res.status).toBe(200);
  return res.body;
}

async function revealPart2(sessionId, sessionKey, challengeId, recordingOffsetMs = 1500) {
  const timestamp = Date.now();
  const proof = sessions.computeProof(sessionKey, challengeId, 'reveal', timestamp);
  return request(app)
    .post('/api/challenge/reveal')
    .send({ challengeId, sessionId, recordingOffsetMs, timestamp, proof });
}

async function verifyRecording(sessionId, sessionKey, challengeId) {
  const timestamp = Date.now();
  const proof = sessions.computeProof(sessionKey, challengeId, 'verify', timestamp);
  return request(app)
    .post('/api/verify')
    .field('challengeId', challengeId)
    .field('sessionId', sessionId)
    .field('timestamp', String(timestamp))
    .field('proof', proof)
    .attach('audio', Buffer.alloc(5000), { filename: 'test.webm', contentType: 'audio/webm' });
}

async function completeChallenge(sessionId, sessionKey) {
  const { challengeId } = await getChallenge(sessionId);
  const reveal = await revealPart2(sessionId, sessionKey, challengeId);
  expect(reveal.status).toBe(200);
  const verify = await verifyRecording(sessionId, sessionKey, challengeId);
  return { challengeId, reveal, verify };
}

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('POST /api/session', () => {
  it('returns sessionId and sessionKey', async () => {
    const { sessionId, sessionKey } = await createSession();
    expect(sessionId).toHaveLength(32);
    expect(sessionKey).toHaveLength(64);
  });
});

describe('GET /api/challenge', () => {
  it('requires a sessionId', async () => {
    const res = await request(app).get('/api/challenge');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/session/i);
  });

  it('returns only the first half initially for two-part challenges', async () => {
    const { sessionId } = await createSession();
    const res = await getChallenge(sessionId);
    expect(typeof res.challengeId).toBe('string');
    expect(typeof res.sentence).toBe('string');
    expect(res.sentence.split(/\s+/).length).toBeLessThan(10);
    expect(res.separator).toBe(' | ');
    expect(typeof res.promptText).toBe('string');
    expect(res.difficulty).toBeUndefined();
    expect(res.twoPart).toBeUndefined();
  });

  it('returns a full sentence for one-part challenges configured on the server', async () => {
    process.env.CAPTCHA_TWO_PART = 'false';
    axios.post.mockImplementationOnce((url) => {
      if (url.includes('chat/completions')) {
        return Promise.resolve({
          data: {
            choices: [{
              message: {
                content: 'apple mountain tiger ocean castle river forest bridge valley sunset meadow',
              },
            }],
          },
        });
      }
      return Promise.reject(new Error(`Unexpected axios call: ${url}`));
    });

    const { sessionId } = await createSession();
    const res = await getChallenge(sessionId);
    expect(res.separator).toBeUndefined();
    expect(res.sentence.split(/\s+/).length).toBeGreaterThan(5);
    expect(res.words.length).toBeGreaterThan(0);
  });

  it('uses server difficulty for sentence generation', async () => {
    process.env.CAPTCHA_DIFFICULTY = '8';
    const { sessionId } = await createSession();
    await getChallenge(sessionId);

    expect(axios.post).toHaveBeenCalled();
    const [, payload] = axios.post.mock.calls.find(([url]) => url.includes('chat/completions'));
    expect(payload.messages[0].content).toContain('8–12 words per clause');
  });

  it('ignores client difficulty and mode query params', async () => {
    const { sessionId } = await createSession();
    const res = await getChallenge(sessionId, { difficulty: '1', twoPart: 'false' });

    expect(res.separator).toBe(' | ');
    expect(axios.post).toHaveBeenCalled();
    const [, payload] = axios.post.mock.calls.find(([url]) => url.includes('chat/completions'));
    expect(payload.messages[0].content).toContain('5–8 words per clause');
  });
});

describe('POST /api/challenge/reveal', () => {
  it('returns the second half after signed reveal', async () => {
    const { sessionId, sessionKey } = await createSession();
    const { challengeId } = await getChallenge(sessionId);
    const res = await revealPart2(sessionId, sessionKey, challengeId);

    expect(res.status).toBe(200);
    expect(typeof res.body.sentencePart2).toBe('string');
    expect(Array.isArray(res.body.wordsPart2)).toBe(true);
    expect(res.body.wordsPart2.length).toBeGreaterThan(0);
  });

  it('rejects reveal without proof', async () => {
    const { sessionId } = await createSession();
    const { challengeId } = await getChallenge(sessionId);
    const res = await request(app)
      .post('/api/challenge/reveal')
      .send({ challengeId, sessionId, recordingOffsetMs: 1500, timestamp: Date.now() });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/proof/i);
  });

  it('rejects duplicate reveal', async () => {
    const { sessionId, sessionKey } = await createSession();
    const { challengeId } = await getChallenge(sessionId);
    await revealPart2(sessionId, sessionKey, challengeId);
    const res = await revealPart2(sessionId, sessionKey, challengeId, 2000);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already revealed/i);
  });

  it('rejects reveal for one-part challenges', async () => {
    process.env.CAPTCHA_TWO_PART = 'false';
    const { sessionId, sessionKey } = await createSession();
    const { challengeId } = await getChallenge(sessionId);
    const res = await revealPart2(sessionId, sessionKey, challengeId);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/split challenge/i);
  });
});

describe('POST /api/verify', () => {
  it('rejects verify before reveal', async () => {
    const { sessionId, sessionKey } = await createSession();
    const { challengeId } = await getChallenge(sessionId);
    const res = await verifyRecording(sessionId, sessionKey, challengeId);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not revealed/i);
  });

  it('returns verification token after reveal + verify', async () => {
    const { sessionId, sessionKey } = await createSession();
    const { verify } = await completeChallenge(sessionId, sessionKey);

    expect(verify.status).toBe(200);
    expect(verify.body.success).toBe(true);
    expect(verify.body.verificationToken).toHaveLength(64);
  });

  it('returns verification token for one-part challenges without reveal', async () => {
    process.env.CAPTCHA_TWO_PART = 'false';
    axios.post.mockImplementationOnce((url) => {
      if (url.includes('chat/completions')) {
        return Promise.resolve({
          data: {
            choices: [{
              message: {
                content: 'apple mountain tiger ocean castle river forest bridge valley sunset meadow',
              },
            }],
          },
        });
      }
      return Promise.reject(new Error(`Unexpected axios call: ${url}`));
    });

    const { sessionId, sessionKey } = await createSession();
    const { challengeId } = await getChallenge(sessionId);
    const verify = await verifyRecording(sessionId, sessionKey, challengeId);

    expect(verify.status).toBe(200);
    expect(verify.body.success).toBe(true);
    expect(verify.body.verificationToken).toHaveLength(64);
  });

  it('rejects invalid proof', async () => {
    const { sessionId, sessionKey } = await createSession();
    const { challengeId } = await getChallenge(sessionId);
    await revealPart2(sessionId, sessionKey, challengeId);

    const res = await request(app)
      .post('/api/verify')
      .field('challengeId', challengeId)
      .field('sessionId', sessionId)
      .field('timestamp', String(Date.now()))
      .field('proof', crypto.randomBytes(32).toString('hex'))
      .attach('audio', Buffer.alloc(5000), { filename: 'test.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(403);
  });

  it('rejects audio that is too small', async () => {
    const { sessionId, sessionKey } = await createSession();
    const { challengeId } = await getChallenge(sessionId);
    await revealPart2(sessionId, sessionKey, challengeId);
    const timestamp = Date.now();
    const proof = sessions.computeProof(sessionKey, challengeId, 'verify', timestamp);

    const res = await request(app)
      .post('/api/verify')
      .field('challengeId', challengeId)
      .field('sessionId', sessionId)
      .field('timestamp', String(timestamp))
      .field('proof', proof)
      .attach('audio', Buffer.alloc(100), { filename: 'test.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/short/i);
  });
});

describe('POST /api/siteverify', () => {
  async function getVerificationToken() {
    const { sessionId, sessionKey } = await createSession();
    const { verify } = await completeChallenge(sessionId, sessionKey);
    return verify.body.verificationToken;
  }

  it('redeems a valid token with the correct secret', async () => {
    const token = await getVerificationToken();
    const res = await request(app)
      .post('/api/siteverify')
      .send({ token, secret: 'test-captcha-secret' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects token reuse', async () => {
    const token = await getVerificationToken();
    await request(app).post('/api/siteverify').send({ token, secret: 'test-captcha-secret' });
    const res = await request(app).post('/api/siteverify').send({ token, secret: 'test-captcha-secret' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/demo/submit', () => {
  it('accepts submission with a valid verification token', async () => {
    const { sessionId, sessionKey } = await createSession();
    const { verify } = await completeChallenge(sessionId, sessionKey);

    const res = await request(app)
      .post('/api/demo/submit')
      .send({ verificationToken: verify.body.verificationToken, email: 'user@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
