'use strict';

// In-memory challenge store. Challenges are lost on server restart.
// For production, use the Redis store instead (set REDIS_URL in .env).

const store = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of store.entries()) {
    if (entry._expiresAt && now > entry._expiresAt) store.delete(id);
  }
}, 60_000).unref();

async function set(key, value, ttlMs) {
  store.set(key, { ...value, _expiresAt: Date.now() + ttlMs });
}

async function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry._expiresAt && Date.now() > entry._expiresAt) {
    store.delete(key);
    return null;
  }
  const { _expiresAt, ...rest } = entry;
  return rest;
}

async function del(key) {
  store.delete(key);
}

module.exports = { set, get, del };
