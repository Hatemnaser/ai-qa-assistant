import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sessionDecision, type DecisionInput } from '../src/features/test-sessions/decisionPresentation';

const idle: DecisionInput = { loading: false, readError: false, hasProject: true, archived: false, working: false, proposal: false, recovery: false, canSelect: false, approvalAvailable: false, evidence: false, reviewAvailable: false };
describe('one session decision, independent of saved history', () => {
  it('leaves an approved record in history, replacing it only with an actual proposal', () => {
    assert.equal(sessionDecision(idle), 'none');
    assert.equal(sessionDecision({ ...idle, proposal: true }), 'proposal');
  });
  it('prioritizes a proposal over previous failure or unresolved review', () => {
    assert.equal(sessionDecision({ ...idle, proposal: true, recovery: true, reviewAvailable: true }), 'proposal');
    assert.equal(sessionDecision({ ...idle, reviewAvailable: true }), 'review');
  });
  it('never uses a historical record to hide active work', () => {
    assert.equal(sessionDecision({ ...idle, working: true, proposal: true, reviewAvailable: true }), 'working');
  });
  it('fails closed during reads, and distinguishes no project from read failure', () => {
    assert.equal(sessionDecision({ ...idle, approvalAvailable: true, loading: true }), 'loading');
    assert.equal(sessionDecision({ ...idle, approvalAvailable: true, readError: true, hasProject: false }), 'read-error');
    assert.equal(sessionDecision({ ...idle, hasProject: false }), 'project');
  });
  it('keeps archive restoration, checklist ownership, approval and evidence as separate decisions', () => {
    assert.equal(sessionDecision({ ...idle, archived: true, proposal: true }), 'archived');
    assert.equal(sessionDecision({ ...idle, canSelect: true, approvalAvailable: true }), 'checklist');
    assert.equal(sessionDecision({ ...idle, approvalAvailable: true }), 'approval');
    assert.equal(sessionDecision({ ...idle, evidence: true, reviewAvailable: true }), 'evidence');
  });
});
