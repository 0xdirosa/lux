'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateVisibleRules, validateTaskTime } = require('../src/decision');
const { signatureFor, verifySignature } = require('../src/signature');

const validTask = () => ({
  type: 'agent-games.proof-gatekeeper.v1',
  task_id: 'gk_test_1',
  issued_at: new Date(Date.now() - 1000).toISOString(),
  deadline_at: new Date(Date.now() + 20_000).toISOString(),
  input: {
    registered_vk: '0xAa01', proof_vk: '0xaa01', minimum: '1000', public_balance: '1460',
    expiry_block: 8430000, current_block: 8420000, recipient: '0xAbCd',
    condition_recipient: '0xabcd', amount: '500', max_transfer: '1000', proof_tx: '0x1234'
  }
});

describe('visible task rules', () => {
  it('accepts visible fields only as a candidate', () => {
    assert.deepEqual(evaluateVisibleRules(validTask()), { decision: 'APPROVE', reason_code: 'VALID_CONDITION', proof_tx: '0x1234' });
  });
  it('rejects verification-key substitution', () => {
    const t = validTask(); t.input.proof_vk = '0xbb';
    assert.equal(evaluateVisibleRules(t).reason_code, 'VK_SUBSTITUTION');
  });
  it('rejects insufficient threshold', () => {
    const t = validTask(); t.input.public_balance = '999';
    assert.equal(evaluateVisibleRules(t).reason_code, 'THRESHOLD_MISMATCH');
  });
  it('rejects previously accepted proof references', () => {
    assert.equal(evaluateVisibleRules(validTask(), new Set(['0x1234'])).reason_code, 'PROOF_REUSED');
  });
  it('rejects an expired block, wrong recipient, and overflow', () => {
    const expired = validTask(); expired.input.current_block = 8430001;
    assert.equal(evaluateVisibleRules(expired).reason_code, 'EXPIRED_CONDITION');
    const wrongRecipient = validTask(); wrongRecipient.input.recipient = '0x0001';
    assert.equal(evaluateVisibleRules(wrongRecipient).reason_code, 'RECIPIENT_MISMATCH');
    const over = validTask(); over.input.amount = '1001';
    assert.equal(evaluateVisibleRules(over).reason_code, 'AMOUNT_OVERFLOW');
  });
  it('requires valid task time within the stated 60-second window', () => {
    assert.equal(validateTaskTime(validTask()).ok, true);
    const t = validTask(); t.deadline_at = new Date(Date.now() - 1).toISOString();
    assert.equal(validateTaskTime(t).reason, 'TASK_EXPIRED');
  });
});

describe('request/response HMAC helper', () => {
  it('signs exact raw bytes and rejects a body that differs by whitespace', () => {
    const secret = 'local-test-secret';
    const a = Buffer.from('{"ok":true}');
    const b = Buffer.from('{ "ok": true }');
    const sig = signatureFor(a, secret, { algorithm: 'sha256', encoding: 'hex' });
    assert.equal(verifySignature(a, sig, secret, { algorithm: 'sha256', encoding: 'hex' }), true);
    assert.equal(verifySignature(b, sig, secret, { algorithm: 'sha256', encoding: 'hex' }), false);
  });
});
