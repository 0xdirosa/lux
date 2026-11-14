'use strict';

const crypto = require('node:crypto');

function signatureOptionsFromEnv(env = process.env) {
  return {
    algorithm: env.AGENT_GAMES_HMAC_ALGORITHM || 'sha256',
    encoding: env.AGENT_GAMES_SIGNATURE_ENCODING || 'hex',
    prefix: env.AGENT_GAMES_SIGNATURE_PREFIX || '',
    keyEncoding: env.AGENT_GAMES_HMAC_KEY_ENCODING || 'utf8'
  };
}

function hmacKey(secret, keyEncoding = 'utf8') {
  if (typeof secret !== 'string' || secret.length === 0) throw new Error('HMAC secret is not configured');
  if (keyEncoding === 'utf8') return Buffer.from(secret, 'utf8');
  if (keyEncoding === 'hex') {
    const hex = secret.startsWith('0x') ? secret.slice(2) : secret;
    if (!hex.length || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) throw new Error('HMAC secret is not valid hex');
    return Buffer.from(hex, 'hex');
  }
  if (keyEncoding === 'base64' || keyEncoding === 'base64url') {
    const key = Buffer.from(secret, keyEncoding);
    if (!key.length) throw new Error('HMAC secret is not valid base64');
    return key;
  }
  throw new Error('unsupported HMAC key encoding');
}

function signatureFor(rawBody, secret, { algorithm = 'sha256', encoding = 'hex', prefix = '', keyEncoding = 'utf8' } = {}) {
  if (!Buffer.isBuffer(rawBody)) throw new TypeError('rawBody must be a Buffer');
  if (!['hex', 'base64', 'base64url'].includes(encoding)) throw new Error('unsupported signature encoding');
  const mac = crypto.createHmac(algorithm, hmacKey(secret, keyEncoding)).update(rawBody).digest(encoding);
  return `${prefix}${mac}`;
}

function verifySignature(rawBody, provided, secret, options = {}) {
  if (typeof provided !== 'string' || !provided.length) return false;
  try {
    const expected = signatureFor(rawBody, secret, options);
    const prefix = options.prefix || '';
    if (prefix && !provided.startsWith(prefix)) return false;
    const receivedMac = prefix ? provided.slice(prefix.length) : provided;
    const expectedMac = prefix ? expected.slice(prefix.length) : expected;
    const encoding = options.encoding || 'hex';
    if (encoding === 'hex' && (!/^[0-9a-f]+$/i.test(receivedMac) || receivedMac.length % 2 !== 0)) return false;
    let a, b;
    a = Buffer.from(receivedMac, encoding);
    b = Buffer.from(expectedMac, encoding);
    if (a.length !== b.length || a.length === 0) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

module.exports = { signatureFor, verifySignature, signatureOptionsFromEnv, hmacKey };
