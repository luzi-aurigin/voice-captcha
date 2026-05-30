'use strict';

function readIntEnv(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
}

module.exports = { readIntEnv };
