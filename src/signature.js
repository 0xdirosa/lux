'use strict';

const crypto = require('node:crypto');

function signatureFor(rawBody, secret, { algorithm = 'sha256', encoding = 'hex', prefix = '' } = {}) {
  if (!Buffer.isBuffer(rawBody)) throw new TypeError('rawBody must be a Buffer');
  if (typeof secret !== 'string' || secret.length === 0) throw new Error('HMAC secret is not configured');
  if (!['hex', 'base64', 'base64url'].includes(encoding)) throw new Error('unsupported signature encoding');
  const mac = crypto.createHmac(algorithm, Buffer.from(secret, 'utf8')).update(rawBody).digest(encoding);
  return `${prefix}${mac}`;
}

function verifySignature(rawBody, provided, secret, options = {}) {
  if (typeof provided !== 'string' || !provided.length) return false;
  const expected = signatureFor(rawBody, secret, options);
  const prefix = options.prefix || '';
  if (prefix && !provided.startsWith(prefix)) return false;
  const receivedMac = prefix ? provided.slice(prefix.length) : provided;
  const expectedMac = prefix ? expected.slice(prefix.length) : expected;
  let a, b;
  try {
    a = Buffer.from(receivedMac, options.encoding || 'hex');
    b = Buffer.from(expectedMac, options.encoding || 'hex');
  } catch (_) {
    return false;
  }
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { signatureFor, verifySignature };
