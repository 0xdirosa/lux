'use strict';

require('dotenv').config();
const crypto = require('node:crypto');
const { signatureFor, verifySignature, signatureOptionsFromEnv } = require('../src/signature');

async function main() {
  const endpoint = process.env.AGENT_GAMES_ENDPOINT_URL || process.argv[2];
  const secret = process.env.AGENT_GAMES_HMAC_SECRET;
  if (!endpoint) throw new Error('Set AGENT_GAMES_ENDPOINT_URL or pass the endpoint URL as the first argument.');
  if (!secret) throw new Error('AGENT_GAMES_HMAC_SECRET is not set.');

  const url = new URL(endpoint);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new Error('Use HTTPS for public endpoints; HTTP is permitted only for localhost tests.');
  }
  if (url.pathname === '/' || !url.pathname) {
    throw new Error('Register the full handler path, normally /agent, not just the domain root.');
  }

  const now = new Date().toISOString();
  const payload = {
    type: 'agent-games.preflight.v1',
    agent_id: 'local-preflight-check',
    issued_at: now,
    nonce: crypto.randomBytes(16).toString('hex')
  };
  const rawRequest = Buffer.from(JSON.stringify(payload), 'utf8');
  const signatureOptions = signatureOptionsFromEnv(process.env);
  const requestSignature = signatureFor(rawRequest, secret, signatureOptions);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agent-games-signature': requestSignature
    },
    body: rawRequest,
    signal: AbortSignal.timeout(15_000)
  });
  const rawResponse = Buffer.from(await response.arrayBuffer());
  const responseSignature = response.headers.get('x-agent-games-signature');
  const signatureValid = verifySignature(rawResponse, responseSignature, secret, signatureOptions);
  let body;
  try { body = JSON.parse(rawResponse.toString('utf8')); } catch (_) { body = null; }
  const bodyValid = body?.ok === true && body?.protocolVersion === 'v1';

  console.log(`HTTP status: ${response.status}`);
  console.log(`Response signature: ${signatureValid ? 'valid' : 'invalid or missing'}`);
  console.log(`Preflight body: ${bodyValid ? 'valid' : 'unexpected'}`);
  if (!response.ok || !signatureValid || !bodyValid) process.exitCode = 1;
  else console.log('Synthetic preflight check: PASS');
}

main().catch((error) => {
  console.error(`Synthetic preflight check: FAIL (${error.message})`);
  process.exitCode = 1;
});
