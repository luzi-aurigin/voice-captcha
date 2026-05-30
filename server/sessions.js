'use strict';

const crypto = require('crypto');
const { readIntEnv } = require('./env-utils');

const SESSION_PREFIX = 'sess:';
const PROOF_MAX_SKEW_MS = readIntEnv('PROOF_MAX_SKEW_MS', 60 * 1000);

/**
 * Create a browser-bound session. The sessionKey must stay in the client that
 * created the session — it is required to sign verify requests.
 */
async function create(store, ttlMs) {
  const sessionId = crypto.randomBytes(16).toString('hex');
  const sessionKey = crypto.randomBytes(32).toString('hex');
  await store.set(`${SESSION_PREFIX}${sessionId}`, { sessionKey, createdAt: Date.now() }, ttlMs);
  return { sessionId, sessionKey };
}

async function get(store, sessionId) {
  if (!sessionId || typeof sessionId !== 'string' || !/^[a-f0-9]{32}$/.test(sessionId)) {
    return null;
  }
  return store.get(`${SESSION_PREFIX}${sessionId}`);
}

function computeProof(sessionKey, challengeId, action, timestamp) {
  return crypto
    .createHmac('sha256', sessionKey)
    .update(`${challengeId}:${action}:${timestamp}`)
    .digest('hex');
}

function verifyProof(sessionKey, challengeId, action, timestamp, proof) {
  if (!proof || typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof)) {
    return false;
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > PROOF_MAX_SKEW_MS) {
    return false;
  }

  const expected = computeProof(sessionKey, challengeId, action, ts);
  try {
    return crypto.timingSafeEqual(Buffer.from(proof, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

module.exports = { create, get, computeProof, verifyProof, SESSION_PREFIX };
