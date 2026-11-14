'use strict';

const fs = require('node:fs');
const path = require('node:path');

class StateStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.state = { tasks: {}, acceptedProofTxs: [] };
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.state = {
        tasks: parsed.tasks && typeof parsed.tasks === 'object' ? parsed.tasks : {},
        acceptedProofTxs: Array.isArray(parsed.acceptedProofTxs) ? parsed.acceptedProofTxs : []
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`cannot read state file: ${error.message}`);
    }
  }

  getTask(taskId) { return this.state.tasks[taskId] || null; }
  getSeenProofTxs() { return new Set(this.state.acceptedProofTxs); }

  saveTask(taskId, requestHash, responseBody, responseSignature) {
    this.state.tasks[taskId] = { requestHash, responseBody, responseSignature, savedAt: new Date().toISOString() };
    this.persist();
  }

  markProofAccepted(proofTx) {
    if (!this.state.acceptedProofTxs.includes(proofTx)) {
      this.state.acceptedProofTxs.push(proofTx);
      this.persist();
    }
  }

  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.state), { mode: 0o600 });
    fs.renameSync(temp, this.filePath);
  }
}

module.exports = { StateStore };
