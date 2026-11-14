'use strict';

require('dotenv').config();
const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const { signatureFor, verifySignature } = require('./signature');
const { evaluateVisibleRules, validateTaskTime, normalizeHex } = require('./decision');
const { StateStore } = require('./state');

class NotReadyError extends Error {}

function signatureOptions(env) {
  return {
    algorithm: env.AGENT_GAMES_HMAC_ALGORITHM || 'sha256',
    encoding: env.AGENT_GAMES_SIGNATURE_ENCODING || 'hex',
    prefix: env.AGENT_GAMES_SIGNATURE_PREFIX || ''
  };
}

function loadAdapter(adapterPath) {
  if (!adapterPath) return null;
  const loaded = require(path.resolve(adapterPath));
  const adapter = loaded.default || loaded;
  for (const name of ['verifyIncomingProof', 'buildCircuitInputs', 'submitAgentProof']) {
    if (typeof adapter[name] !== 'function') throw new Error(`adapter missing ${name}()`);
  }
  return adapter;
}

function makeRawBodyParser(maxBodyBytes) {
  return express.raw({ type: 'application/json', limit: maxBodyBytes });
}

function createApp({ env = process.env, state, adapter, prove } = {}) {
  const app = express();
  const store = state || new StateStore(env.STATE_FILE || './data/state.json');
  const secret = env.AGENT_GAMES_HMAC_SECRET || '';
  const sigOptions = signatureOptions(env);
  const skew = Number(env.CLOCK_SKEW_SECONDS || 60);
  const maxBody = Number(env.MAX_BODY_BYTES || 65536);
  const inFlightTasks = new Map();
  const reservedProofTxs = new Set();
  const proofFunction = prove || (async (inputs) => {
    const snarkjs = require('snarkjs');
    const wasm = path.resolve(env.GATEKEEPER_WASM || './circuits/gatekeeper.wasm');
    const zkey = path.resolve(env.GATEKEEPER_ZKEY || './circuits/gatekeeper_final.zkey');
    return snarkjs.groth16.fullProve(inputs, wasm, zkey);
  });

  app.disable('x-powered-by');
  app.get('/health', (_req, res) => {
    const ready = Boolean(secret && adapter);
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'not_ready',
      protocolVersion: 'v1',
      proofAdapterConfigured: Boolean(adapter),
      hmacSecretConfigured: Boolean(secret)
    });
  });

  app.post('/agent', makeRawBodyParser(maxBody), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: 'application/json required' });
    if (!secret) return res.status(503).json({ error: 'NOT_READY' });
    if (!verifySignature(req.body, req.get('x-agent-games-signature'), secret, sigOptions)) {
      return res.status(401).json({ error: 'INVALID_SIGNATURE' });
    }

    let task;
    try { task = JSON.parse(req.body.toString('utf8')); }
    catch (_) { return sendSigned(res, 400, { error: 'INVALID_JSON' }, secret, sigOptions); }

    if (task?.type === 'agent-games.preflight.v1') {
      return sendSigned(res, 200, { ok: true, protocolVersion: 'v1' }, secret, sigOptions);
    }
    if (task?.type !== 'agent-games.proof-gatekeeper.v1' || typeof task.task_id !== 'string' || !task.task_id) {
      return sendSigned(res, 400, { error: 'INVALID_TASK' }, secret, sigOptions);
    }

    const requestHash = crypto.createHash('sha256').update(req.body).digest('hex');
    const existing = store.getTask(task.task_id);
    if (existing) return sendCachedOrConflict(res, existing, requestHash, secret, sigOptions);

    const active = inFlightTasks.get(task.task_id);
    if (active) {
      if (active.requestHash !== requestHash) return sendSigned(res, 409, { error: 'TASK_ID_REUSED_WITH_DIFFERENT_BODY' }, secret, sigOptions);
      const result = await active.promise;
      return sendResult(res, result);
    }

    const promise = processTask({ task, requestHash, store, adapter, proofFunction, reservedProofTxs, env, secret, sigOptions, skew });
    inFlightTasks.set(task.task_id, { requestHash, promise });
    try {
      const result = await promise;
      return sendResult(res, result);
    } finally {
      inFlightTasks.delete(task.task_id);
    }
  });

  app.use((error, _req, res, _next) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'BODY_TOO_LARGE' });
    return res.status(400).json({ error: 'BAD_REQUEST' });
  });
  return app;
}

async function processTask({ task, requestHash, store, adapter, proofFunction, reservedProofTxs, env, secret, sigOptions, skew }) {
  const timing = validateTaskTime(task, Date.now(), skew);
  if (!timing.ok) return signedResult(400, { error: timing.reason }, secret, sigOptions);
  if (!adapter) return signedResult(503, { error: 'NOT_READY', detail: 'proof and incoming-verification adapter is not configured' }, secret, sigOptions);

  const accepted = store.getSeenProofTxs();
  const seen = new Set([...accepted, ...reservedProofTxs]);
  let decision = evaluateVisibleRules(task, seen);
  const reserved = decision.decision === 'APPROVE' ? normalizeHex(task.input.proof_tx) : '';
  if (reserved) reservedProofTxs.add(reserved);

  try {
    if (decision.decision === 'APPROVE') {
      let incoming;
      try { incoming = await adapter.verifyIncomingProof(task); }
      catch (_) { incoming = null; }
      if (!incoming || incoming.verified !== true || incoming.finalized !== true || incoming.publicInputsMatch !== true) {
        decision = { decision: 'REJECT', reason_code: env.UNVERIFIED_REASON_CODE || 'PROOF_UNVERIFIED', proof_tx: task.input?.proof_tx };
      }
    }

    const inputs = await adapter.buildCircuitInputs(task, decision);
    if (!inputs || typeof inputs !== 'object') throw new NotReadyError('adapter returned no circuit inputs');
    const generated = await proofFunction(inputs);
    if (!generated || !generated.proof || !Array.isArray(generated.publicSignals)) throw new NotReadyError('Groth16 proof generation failed');
    const submitted = await adapter.submitAgentProof({ proof: generated.proof, publicSignals: generated.publicSignals, task, decision });
    if (!submitted || submitted.finalized !== true) throw new NotReadyError('agent proof did not reach Finalized');

    const response = {
      decision: decision.decision,
      reason_code: decision.reason_code,
      proof: generated.proof,
      public_signals: generated.publicSignals,
      ...(decision.proof_tx ? { proof_tx: decision.proof_tx } : {})
    };
    const responseBody = Buffer.from(JSON.stringify(response), 'utf8');
    const responseSignature = signatureFor(responseBody, secret, sigOptions);
    if (decision.decision === 'APPROVE' && task.input?.proof_tx) store.markProofAccepted(normalizeHex(task.input.proof_tx));
    store.saveTask(task.task_id, requestHash, responseBody.toString('utf8'), responseSignature);
    return { status: 200, body: responseBody, signature: responseSignature };
  } catch (error) {
    const detail = error instanceof NotReadyError ? error.message : 'proof processing failed';
    return signedResult(503, { error: 'NOT_READY', detail }, secret, sigOptions);
  } finally {
    if (reserved) reservedProofTxs.delete(reserved);
  }
}

function signedResult(status, object, secret, options) {
  const body = Buffer.from(JSON.stringify(object), 'utf8');
  return { status, body, signature: signatureFor(body, secret, options) };
}

function sendSigned(res, status, object, secret, options) {
  return sendResult(res, signedResult(status, object, secret, options));
}

function sendResult(res, result) {
  res.status(result.status);
  res.set('content-type', 'application/json; charset=utf-8');
  res.set('x-agent-games-signature', result.signature);
  res.set('cache-control', 'no-store');
  return res.send(result.body);
}

function sendCachedOrConflict(res, existing, requestHash, secret, sigOptions) {
  if (existing.requestHash !== requestHash) {
    return sendSigned(res, 409, { error: 'TASK_ID_REUSED_WITH_DIFFERENT_BODY' }, secret, sigOptions);
  }
  return sendResult(res, {
    status: 200,
    body: Buffer.from(existing.responseBody, 'utf8'),
    signature: existing.responseSignature
  });
}

if (require.main === module) {
  let adapter;
  try { adapter = loadAdapter(process.env.AGENT_GAMES_ADAPTER); }
  catch (error) {
    console.error(`Adapter configuration error: ${error.message}`);
    process.exit(1);
  }
  const app = createApp({ adapter });
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  app.listen(port, host, () => console.log(`Gatekeeper listening on ${host}:${port}; adapter=${Boolean(adapter)}`));
}

module.exports = { createApp, loadAdapter, processTask, sendSigned, signedResult };
