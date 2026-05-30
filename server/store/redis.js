'use strict';

// Redis-backed challenge store.
// Requires REDIS_URL to be set (e.g. redis://localhost:6379).
// Challenges survive server restarts and work across multiple instances.

const { createClient } = require('redis');

let client;

async function getClient() {
  if (!client) {
    client = createClient({ url: process.env.REDIS_URL });
    client.on('error', err => console.error('Redis error:', err.message));
    await client.connect();
  }
  return client;
}

async function set(key, value, ttlMs) {
  const c = await getClient();
  await c.set(`vc:${key}`, JSON.stringify(value), { PX: ttlMs });
}

async function get(key) {
  const c = await getClient();
  const raw = await c.get(`vc:${key}`);
  return raw ? JSON.parse(raw) : null;
}

async function del(key) {
  const c = await getClient();
  await c.del(`vc:${key}`);
}

module.exports = { set, get, del };
