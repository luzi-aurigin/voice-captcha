'use strict';

const crypto = require('crypto');

const TOKEN_PREFIX = 'vt:';

/**
 * Issue a single-use verification token stored server-side.
 * Returned to the client after a successful /api/verify; must be redeemed
 * by the protected backend via /api/siteverify (or consume() in-process).
 */
async function issue(store, ttlMs) {
  const token = crypto.randomBytes(32).toString('hex');
  await store.set(`${TOKEN_PREFIX}${token}`, { issuedAt: Date.now() }, ttlMs);
  return token;
}

/**
 * Validate and consume a verification token (single-use).
 * Returns true if the token was valid, false otherwise.
 */
async function consume(store, token) {
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    return false;
  }

  const key = `${TOKEN_PREFIX}${token}`;
  const entry = await store.get(key);
  if (!entry) return false;

  await store.del(key);
  return true;
}

module.exports = { issue, consume };
