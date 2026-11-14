'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/server');
const { signatureFor, verifySignature } = require('../src/signature');

class MemoryStore {
  constructor() { this.tasks = new Map(); this.seen = new Set(); }
  getTask(id) { return this.tasks.get(id) || null; }
  getSeenProofTxs() { return this.seen; }
  markProofAccepted(tx) { this.seen.add(tx); }
  saveTask(id, requestHash, responseBody, responseSignature) {
    this.tasks.set(id, { requestHash, responseBody, responseSignature });
  }
}

const secret = 'test-secret';
const env = { AGENT_GAMES_HMAC_SECRET: secret, AGENT_GAMES_HMAC_ALGORITHM: 'sha256', AGENT_GAMES_SIGNATURE_ENCODING: 'hex', CLOCK_SKEW_SECONDS: '60' };
const signed = (value) => {
  const raw = Buffer.from(JSON.stringify(value));
  return { raw, signature: signatureFor(raw, secret, { algorithm: 'sha256', encoding: 'hex' }) };
};
const task = () => ({
  type: 'agent-games.proof-gatekeeper.v1', task_id: 'task-1', mode: 'practice',
  issued_at: new Date(Date.now() - 2000).toISOString(), deadline_at: new Date(Date.now() + 30_000).toISOString(),
  input: { registered_vk: '0xaa', proof_vk: '0xaa', minimum: '10', public_balance: '12', expiry_block: 100, current_block: 99, recipient: '0xbb', condition_recipient: '0xbb', amount: '3', max_transfer: '5', proof_tx: '0xcc' }
});

describe('HTTP agent endpoint', () => {
  it('keeps liveness available before secret setup but keeps readiness strict', async () => {
    const app = createApp({ env: {}, state: new MemoryStore() });
    const health = await request(app).get('/health');
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { status: 'ok', protocolVersion: 'v1', preflightReady: false, taskReady: false });
    const ready = await request(app).get('/ready');
    assert.equal(ready.status, 503);
    assert.equal(ready.body.status, 'not_ready');
  });

  it('authenticates and signs preflight response', async () => {
    const app = createApp({ env, state: new MemoryStore() });
    const payload = signed({ type: 'agent-games.preflight.v1', agent_id: 'agt_test', issued_at: new Date().toISOString(), nonce: 'n1' });
    const res = await request(app).post('/agent').set('content-type', 'application/json').set('x-agent-games-signature', payload.signature).send(payload.raw.toString('utf8'));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, protocolVersion: 'v1' });
    assert.equal(verifySignature(Buffer.from(res.text), res.headers['x-agent-games-signature'], secret, { algorithm: 'sha256', encoding: 'hex' }), true);
  });

  it('rejects a mismatched HMAC', async () => {
    const app = createApp({ env, state: new MemoryStore() });
    const res = await request(app).post('/agent').set('content-type', 'application/json').set('x-agent-games-signature', '00').send('{"type":"agent-games.preflight.v1"}');
    assert.equal(res.status, 401);
  });

  it('fails closed for tasks if the integration adapter is missing', async () => {
    const app = createApp({ env, state: new MemoryStore() });
    const payload = signed(task());
    const res = await request(app).post('/agent').set('content-type', 'application/json').set('x-agent-games-signature', payload.signature).send(payload.raw.toString('utf8'));
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'NOT_READY');
  });

  it('returns signed proof evidence and caches idempotent retries when an adapter is supplied', async () => {
    const store = new MemoryStore();
    const adapter = {
      verifyIncomingProof: async () => ({ verified: true, finalized: true, publicInputsMatch: true }),
      buildCircuitInputs: async () => ({ localTestOnly: '1' }),
      submitAgentProof: async () => ({ finalized: true })
    };
    const app = createApp({ env, state: store, adapter, prove: async () => ({ proof: { pi_a: ['a'] }, publicSignals: ['1', '2'] }) });
    const payload = signed(task());
    const first = await request(app).post('/agent').set('content-type', 'application/json').set('x-agent-games-signature', payload.signature).send(payload.raw.toString('utf8'));
    assert.equal(first.status, 200);
    assert.equal(first.body.decision, 'APPROVE');
    assert.equal(first.body.reason_code, 'VALID_CONDITION');
    assert.deepEqual(first.body.public_signals, ['1', '2']);
    assert.equal(verifySignature(Buffer.from(first.text), first.headers['x-agent-games-signature'], secret, { algorithm: 'sha256', encoding: 'hex' }), true);
    const second = await request(app).post('/agent').set('content-type', 'application/json').set('x-agent-games-signature', payload.signature).send(payload.raw.toString('utf8'));
    assert.equal(second.status, 200);
    assert.equal(second.text, first.text);
    assert.equal(second.headers['x-agent-games-signature'], first.headers['x-agent-games-signature']);
  });

  it('coalesces the same task while the first copy is still processing', async () => {
    const store = new MemoryStore();
    let releaseVerification;
    let signalEntered;
    const verificationGate = new Promise((resolve) => { releaseVerification = resolve; });
    const entered = new Promise((resolve) => { signalEntered = resolve; });
    let builds = 0;
    const adapter = {
      verifyIncomingProof: async () => { signalEntered(); await verificationGate; return { verified: true, finalized: true, publicInputsMatch: true }; },
      buildCircuitInputs: async () => { builds++; return { localTestOnly: '1' }; },
      submitAgentProof: async () => ({ finalized: true })
    };
    const app = createApp({ env, state: store, adapter, prove: async () => ({ proof: { pi_a: ['a'] }, publicSignals: ['1'] }) });
    const payload = signed(task());
    const send = () => request(app).post('/agent').set('content-type', 'application/json')
      .set('x-agent-games-signature', payload.signature).send(payload.raw.toString('utf8'));
    const firstPromise = send().then((response) => response);
    await entered;
    const secondPromise = send();
    releaseVerification();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.text, second.text);
    assert.equal(builds, 1);
  });
});
