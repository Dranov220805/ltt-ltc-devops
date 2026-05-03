const mongoose = require('mongoose');

const MONGO_READY_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

/** @type {import('ioredis').default | null} */
let redisSessionClient = null;

/** Safe one-line target e.g. redis://host:6379 */
let redisEndpointSummary = '';

/** Last Redis attach failure message (sessions not using Redis) */
let redisUnavailableReason = '';

/** @type {'unset'|'live'|'failed'} */
let redisAttachKind = 'unset';

/**
 * @param {string} raw
 */
function summarizeMongoUri(raw) {
  const s = String(raw || '').trim().replace(/^['"]|['"]$/g, '');
  if (!s) return '';
  const rest = s.replace(/^mongodb(\+srv)?:\/\//i, '');
  const at = rest.indexOf('@');
  const hostPath = at >= 0 ? rest.slice(at + 1) : rest;
  const host = hostPath.split('/')[0].split('?')[0];
  const dbPart = hostPath.includes('/') ? hostPath.split('/')[1]?.split('?')[0] : '';
  return dbPart ? `${host} ù ${dbPart}` : host;
}

/**
 * @param {string} raw
 */
function summarizeRedisUrl(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(rediss?):\/\/(?:[^/@]*@)?([^/:]+)(?::(\d+))?/i);
  if (!m) return '';
  const scheme = m[1].toLowerCase();
  const host = m[2];
  const port = m[3] || '6379';
  return `${scheme}://${host}:${port}`;
}

/**
 * @param {import('ioredis').default} client
 * @param {string} endpointSummary
 */
function attachRedisSessionClient(client, endpointSummary) {
  redisSessionClient = client;
  redisEndpointSummary = endpointSummary;
  redisUnavailableReason = '';
  redisAttachKind = 'live';
}

function setRedisUnset() {
  redisSessionClient = null;
  redisEndpointSummary = '';
  redisUnavailableReason = '';
  redisAttachKind = 'unset';
}

/**
 * @param {string} endpointSummary
 * @param {string} reason
 */
function setRedisUnavailable(endpointSummary, reason) {
  redisSessionClient = null;
  redisEndpointSummary = endpointSummary;
  redisUnavailableReason = String(reason || 'unavailable');
  redisAttachKind = 'failed';
}

function mongoDriverStateLabel() {
  const rs = mongoose.connection.readyState;
  return MONGO_READY_STATES[rs] ?? `state-${rs}`;
}

/**
 * @param {{ appUsesMongo: boolean }} opts
 */
function getSnapshot(opts) {
  const mongoUri = process.env.MONGO_URI || '';
  const uriSummary = summarizeMongoUri(mongoUri) || 'localhost default';

  let database;
  if (opts.appUsesMongo) {
    const conn = mongoose.connection;
    const hostPart = conn.host ? `${conn.host}${conn.port ? `:${conn.port}` : ''}` : uriSummary;
    const dbName = conn.name || '';
    database = {
      label: 'Database',
      backend: 'mongodb',
      status: mongoDriverStateLabel(),
      detail: dbName ? `${hostPart} ∑ ${dbName}` : hostPart
    };
  } else {
    database = {
      label: 'Database',
      backend: 'in-memory',
      status: mongoDriverStateLabel(),
      detail: uriSummary
    };
  }

  const redisUrl = String(process.env.REDIS_URL || '').trim();
  const sessionSecret = String(process.env.SESSION_SECRET || '').trim();

  let redis;
  if (!redisUrl || !sessionSecret) {
    redis = {
      label: 'Sessions',
      backend: 'none',
      status: 'not configured',
      detail: 'REDIS_URL or SESSION_SECRET unset'
    };
  } else if (redisAttachKind === 'live' && redisSessionClient) {
    redis = {
      label: 'Sessions',
      backend: 'redis',
      status: redisSessionClient.status || 'unknown',
      detail: redisEndpointSummary || summarizeRedisUrl(redisUrl)
    };
  } else {
    redis = {
      label: 'Sessions',
      backend: 'none',
      status: 'unavailable',
      detail:
        redisUnavailableReason ||
        (redisEndpointSummary || summarizeRedisUrl(redisUrl) || '(endpoint)')
    };
  }

  return { database, redis };
}

/**
 * Extra fields merged into JSON API responses (productController meta).
 */
function getMetaAugment() {
  const dataSource = require('./dataSource');
  const snap = getSnapshot({ appUsesMongo: dataSource.isMongo });
  return {
    database: {
      backend: snap.database.backend,
      mongoose: snap.database.status,
      info: snap.database.detail
    },
    redis: {
      backend: snap.redis.backend,
      status: snap.redis.status,
      info: snap.redis.detail
    }
  };
}

module.exports = {
  summarizeMongoUri,
  summarizeRedisUrl,
  attachRedisSessionClient,
  setRedisUnset,
  setRedisUnavailable,
  getSnapshot,
  getMetaAugment
};
