'use strict';

function parseUnsignedInteger(value, field) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid ${field}`);
    return BigInt(value);
  }
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  throw new Error(`invalid ${field}`);
}

function normalizeHex(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Checks only the public, deterministic trap predicates listed by Agent Games.
 * This is not sufficient to approve: the caller must also obtain an affirmative
 * result from the configured proof/on-chain adapter.
 */
function evaluateVisibleRules(task, seenProofTxs = new Set()) {
  if (!task || task.type !== 'agent-games.proof-gatekeeper.v1' || !task.input || typeof task.input !== 'object') {
    return { decision: 'REJECT', reason_code: 'INVALID_TASK' };
  }
  const x = task.input;
  let minimum, balance, expiry, current, amount, cap;
  try {
    minimum = parseUnsignedInteger(x.minimum, 'minimum');
    balance = parseUnsignedInteger(x.public_balance, 'public_balance');
    expiry = parseUnsignedInteger(x.expiry_block, 'expiry_block');
    current = parseUnsignedInteger(x.current_block, 'current_block');
    amount = parseUnsignedInteger(x.amount, 'amount');
    cap = parseUnsignedInteger(x.max_transfer, 'max_transfer');
  } catch (_) {
    return { decision: 'REJECT', reason_code: 'INVALID_TASK' };
  }

  if (!x.registered_vk || !x.proof_vk || normalizeHex(x.registered_vk) !== normalizeHex(x.proof_vk)) {
    return { decision: 'REJECT', reason_code: 'VK_SUBSTITUTION' };
  }
  if (balance < minimum) return { decision: 'REJECT', reason_code: 'THRESHOLD_MISMATCH' };

  const proofTx = normalizeHex(x.proof_tx);
  if (!proofTx) return { decision: 'REJECT', reason_code: 'INVALID_PROOF' };
  if (seenProofTxs.has(proofTx)) return { decision: 'REJECT', reason_code: 'PROOF_REUSED' };

  // Conservative conventional interpretation: an expiry is passed only when
  // current_block is strictly greater than expiry_block. The official rules do
  // not specify behavior for equality; confirm before scored play.
  if (current > expiry) return { decision: 'REJECT', reason_code: 'EXPIRED_CONDITION' };
  if (!x.recipient || !x.condition_recipient || normalizeHex(x.recipient) !== normalizeHex(x.condition_recipient)) {
    return { decision: 'REJECT', reason_code: 'RECIPIENT_MISMATCH' };
  }
  if (amount > cap) return { decision: 'REJECT', reason_code: 'AMOUNT_OVERFLOW' };

  return { decision: 'APPROVE', reason_code: 'VALID_CONDITION', proof_tx: x.proof_tx };
}

function validateTaskTime(task, nowMs = Date.now(), clockSkewSeconds = 60) {
  const issued = Date.parse(task?.issued_at);
  const deadline = Date.parse(task?.deadline_at);
  if (!Number.isFinite(issued) || !Number.isFinite(deadline)) return { ok: false, reason: 'INVALID_TASK_TIME' };
  if (issued > nowMs + clockSkewSeconds * 1000) return { ok: false, reason: 'TASK_FROM_FUTURE' };
  if (deadline <= nowMs) return { ok: false, reason: 'TASK_EXPIRED' };
  if (deadline - issued > 60_000) return { ok: false, reason: 'INVALID_TASK_DEADLINE' };
  return { ok: true };
}

module.exports = { evaluateVisibleRules, validateTaskTime, parseUnsignedInteger, normalizeHex };
