import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setImmediate } from "node:timers/promises";

import type { ExecutionItemSubmissionV1 } from "@oddpath/qa-execution-contract";

import { executeClaim, idempotencyKey, type ExecuteClaimOptions } from "../src/execution.js";
import { OddpathApiError } from "../src/http-client.js";
import { BrowserSessionUnavailableError, type SemanticBrowserSession } from "../src/interpreter.js";
import { claimedExecution, managedClaimedExecution, executionReceipt, testConfig } from "./fixtures.js";
import { hashCanonicalJson } from '../src/config.js';

const originalEmail = process.env.ODDPATH_TEST_EMAIL;
afterEach(() => {
  if (originalEmail === undefined) delete process.env.ODDPATH_TEST_EMAIL;
  else process.env.ODDPATH_TEST_EMAIL = originalEmail;
});

describe("runner execution lifecycle", () => {
  it("accepts, executes, records evidence, and finishes with monotonic run versions", async () => {
    process.env.ODDPATH_TEST_EMAIL = "private@example.test";
    const config = testConfig();
    const claimed = claimedExecution(config);
    const session = new FakeSession();
    const submissions: ExecutionItemSubmissionV1[] = [];
    const calls: string[] = [];
    const client = {
      async accept() { calls.push("accept"); return executionReceipt(1); },
      async completeEvidenceUpload() { throw new Error("unexpected upload completion"); },
      async fail() { throw new Error("unexpected failure"); },
      async finish(_executionId: string, _lease: unknown, input: { expectedRunVersion: number }) {
        calls.push(`finish:${input.expectedRunVersion}`);
        return executionReceipt(3, "SUCCEEDED");
      },
      async heartbeat() { return executionReceipt(1); },
      async initiateEvidenceUpload() { throw new Error("unexpected upload initiation"); },
      async recordItem(
        _executionId: string,
        _itemId: string,
        _lease: unknown,
        input: ExecutionItemSubmissionV1
      ) {
        calls.push(`record:${input.expectedRunVersion}`);
        submissions.push(input);
        return executionReceipt(2);
      },
      async uploadEvidenceBytes() { throw new Error("unexpected upload bytes"); },
    };

    await executeClaim(claimed, {
      allowProduction: false,
      client,
      createSession: async () => session,
      logger: silentLogger,
      profiles: config.profiles,
    });

    assert.deepEqual(calls, ["accept", "record:1", "finish:2"]);
    assert.equal(submissions[0]?.status, "PASS");
    assert.equal(submissions[0]?.evidence[0]?.kind, "TEXT");
    assert.deepEqual(submissions[0]?.observation?.completedStepRefs,claimed.task.recipe.bundle.items[0]?.steps.map(step=>step.ref));
    assert.equal(submissions[0]?.observation?.failedStepRef,null);
    assert.ok(Date.parse(submissions[0]!.observation!.finishedAt)>=Date.parse(submissions[0]!.observation!.startedAt));
    assert.equal(JSON.stringify(submissions).includes("private@example.test"), false);
    assert.equal(session.filledValue, "private@example.test");
    assert.equal(session.closed, true);
  });

  it("fails a production claim before opening a browser unless the CLI gate is explicit", async () => {
    const config = testConfig("PRODUCTION");
    const claimed = claimedExecution(config);
    let accepted = false;
    let browserOpened = false;
    let failure: { code: string; message: string } | undefined;
    const client = {
      async accept() { accepted = true; return executionReceipt(1); },
      async completeEvidenceUpload() { throw new Error("unexpected"); },
      async fail(_executionId: string, _lease: unknown, input: { code: string; message: string }) {
        failure = input;
        return {
          ...executionReceipt(2, "FAILED"),
          requestPhase: "READY_TO_RUN" as const,
        };
      },
      async finish() { throw new Error("unexpected"); },
      async heartbeat() { return executionReceipt(1); },
      async initiateEvidenceUpload() { throw new Error("unexpected"); },
      async recordItem() { throw new Error("unexpected"); },
      async uploadEvidenceBytes() { throw new Error("unexpected"); },
    };

    await executeClaim(claimed, {
      allowProduction: false,
      client,
      createSession: async () => { browserOpened = true; return new FakeSession(); },
      logger: silentLogger,
      profiles: config.profiles,
    });

    assert.equal(accepted, false);
    assert.equal(browserOpened, false);
    assert.equal(failure?.code, "PRODUCTION_NOT_ALLOWED");
  });

  it("derives stable, operation-scoped idempotency keys", () => {
    const first = idempotencyKey("claim-1", "item", "item-1");
    assert.equal(first, idempotencyKey("claim-1", "item", "item-1"));
    assert.notEqual(first, idempotencyKey("claim-1", "finish", "item-1"));
    assert.match(first, /^[A-Za-z0-9._:-]{8,200}$/u);
  });

  it("keeps the first submitted result and evidence when later screenshot capture fails without finishing", async () => {
    const fixture = recoveryFixture();
    fixture.claimed.task.artifact.items[1]!.evidenceRequirements[0]!.kind = "SCREENSHOT";
    fixture.session.screenshot = async () => {
      fixture.calls.push("screenshot");
      throw new Error("Synthetic browser capture failure");
    };

    const receipt = await executeClaim(fixture.claimed, fixture.options);

    assert.equal(receipt?.status, "FAILED");
    assert.deepEqual(fixture.calls, ["accept", "record:item-1", "screenshot", "fail:RUNNER_EXECUTION_FAILED"]);
    assertOnlyFirstSubmission(fixture);
    assert.equal(fixture.session.closed, true);
  });

  it("stops on lease expiry after the first submission without executing or recording another item", async () => {
    const fixture = recoveryFixture();
    let currentTime = new Date(fixture.claimed.claim.leaseExpiresAt).getTime() - 1;
    const recordItem = fixture.client.recordItem;
    fixture.client.recordItem = async (...args) => {
      const receipt = await recordItem(...args);
      currentTime += 1;
      return receipt;
    };
    let navigations = 0;
    const navigate = fixture.session.navigate.bind(fixture.session);
    fixture.session.navigate = async (url) => {
      navigations += 1;
      await navigate(url);
    };

    const receipt = await executeClaim(fixture.claimed, {
      ...fixture.options,
      now: () => new Date(currentTime),
    });

    assert.equal(receipt, null);
    assert.deepEqual(fixture.calls, ["accept", "record:item-1"]);
    assert.equal(navigations, 1);
    assertOnlyFirstSubmission(fixture);
    assert.equal(fixture.session.closed, true);
  });

  it("stops after cancellation invalidates the heartbeat lease without submitting the in-flight TEXT item", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const fixture = recoveryFixture();
    const enteredSecondItem = deferredSignal();
    const resumeSecondItem = deferredSignal();
    const navigate = fixture.session.navigate.bind(fixture.session);
    fixture.session.navigate = async (url) => {
      if (url.endsWith("/recovery-2")) {
        enteredSecondItem.resolve();
        await resumeSecondItem.promise;
      }
      await navigate(url);
    };
    fixture.client.heartbeat = async () => {
      fixture.calls.push("heartbeat:lease-lost");
      // Owner cancellation clears the lease; the Runner API rejects its renewal.
      throw new OddpathApiError("Execution lease was lost.", 409, "QA_EXECUTION_LEASE_LOST");
    };
    const execution = executeClaim(fixture.claimed, { ...fixture.options, heartbeatIntervalMs: 10 });
    await enteredSecondItem.promise;
    try {
      t.mock.timers.tick(10);
      // Drain the rejected heartbeat before allowing the in-flight browser step to settle.
      await setImmediate();
    } finally {
      resumeSecondItem.resolve();
    }

    assert.equal(await execution, null);
    assert.deepEqual(fixture.calls, ["accept", "record:item-1", "heartbeat:lease-lost"]);
    assertOnlyFirstSubmission(fixture);
    assert.equal(fixture.session.closed, true);
  });
});

function recoveryFixture() {
  const config = testConfig();
  const claimed = claimedExecution(config);
  claimed.task.artifact.items = [1, 2, 3].map((ordinal) => ({
    clientRef: `recovery-${ordinal}`,
    evidenceRequirements: [{
      description: "Record the observed state.",
      id: `requirement-${ordinal}`,
      kind: "TEXT",
      required: true,
    }],
    expectedResult: "The recovery heading is visible.",
    id: `item-${ordinal}`,
    ordinal: ordinal - 1,
    title: `Recovery item ${ordinal}`,
  }));
  claimed.task.recipe.bundle.items = [1, 2, 3].map((ordinal) => ({
    checklistItemId: `item-${ordinal}`,
    steps: [
      { action: "navigate", path: `/recovery-${ordinal}`, ref: `open-${ordinal}`, waitUntil: "domcontentloaded" },
      {
        action: "expect",
        expectation: { kind: "visible", locator: { by: "role", name: "Recovery", role: "heading" } },
        ref: `verify-${ordinal}`,
      },
    ],
  }));
  const calls: string[] = [];
  const submissions: Array<{ itemId: string; submission: ExecutionItemSubmissionV1 }> = [];
  const session = new FakeSession();
  const client: ExecuteClaimOptions["client"] = {
    async accept() { calls.push("accept"); return executionReceipt(1); },
    async completeEvidenceUpload() { calls.push("upload:complete"); throw new Error("Unexpected upload"); },
    async fail(_executionId, _lease, failure, key) {
      calls.push(`fail:${failure.code}`);
      assert.equal(key, idempotencyKey(claimed.claim.claimId, "fail", failure.code));
      return { ...executionReceipt(3, "FAILED"), requestPhase: "READY_TO_RUN" };
    },
    async finish() { calls.push("finish"); return executionReceipt(5, "SUCCEEDED"); },
    async heartbeat() { calls.push("heartbeat"); return executionReceipt(2); },
    async initiateEvidenceUpload() { calls.push("upload:init"); throw new Error("Unexpected upload"); },
    async recordItem(_executionId, itemId, _lease, submission, key) {
      calls.push(`record:${itemId}`);
      assert.equal(key, idempotencyKey(claimed.claim.claimId, "item", itemId));
      submissions.push({ itemId, submission: structuredClone(submission) });
      return executionReceipt(submission.expectedRunVersion + 1);
    },
    async uploadEvidenceBytes() { calls.push("upload:bytes"); throw new Error("Unexpected upload"); },
  };
  const options: ExecuteClaimOptions = {
    allowProduction: false,
    client,
    createSession: async () => session,
    logger: silentLogger,
    profiles: config.profiles,
  };
  return { calls, claimed, client, options, session, submissions };
}

function assertOnlyFirstSubmission(fixture: ReturnType<typeof recoveryFixture>) {
  // This is an acknowledged fake-client write, not proof of database persistence.
  assert.equal(fixture.submissions.length, 1);
  const first = fixture.submissions[0]!;
  assert.equal(first.itemId, "item-1");
  assert.equal(first.submission.status, "PASS");
  assert.equal(first.submission.expectedRunVersion, 1);
  assert.deepEqual(first.submission.evidence, [{
    kind: "TEXT",
    requirementId: "requirement-1",
    textContent: "Recovery item 1: PASS. 2 step(s) completed. All declared steps completed.",
  }]);
}

function deferredSignal() {
  let resolve!: () => void;
  const promise = new Promise<void>((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}

const silentLogger = {
  error() {},
  info() {},
  warn() {},
};

describe('managed v2 immutable execution', () => {
  function fixture() {
    const base = recoveryFixture(), claimed = managedClaimedExecution(), calls = base.calls;
    const options: ExecuteClaimOptions = { ...base.options, profiles: [], createSession: async () => { calls.push('browser'); return base.session; },
      managedV2: { profileHashes: [claimed.task.profile.manifestHash!], async beforeSteps() { calls.push('start-once'); }, async assertRuntimeLive() {}, async terminate() { calls.push('terminate'); } } };
    return { ...base, claimed, options };
  }
  for(const completed of [false,true]) it(`requires completed human preparation before manual execution (${completed})`,async()=>{
    const f=fixture(),task=f.claimed.task;task.profile.authentication={kind:'MANUAL'};
    const {manifestHash,...manifest}=task.profile;task.profile.manifestHash=hashCanonicalJson(manifest);
    task.approval.profileManifestHash=task.profile.manifestHash;
    const {bindingHash,...approval}=task.approval;
    task.approval.bindingHash=hashCanonicalJson({...approval,authentication:task.profile.authentication,executionLimits:task.profile.executionLimits,candidate:task.profile.target.candidate});
    f.options.managedV2!.profileHashes=[task.profile.manifestHash];f.options.managedV2!.humanPreparationCompleted=completed;
    await executeClaim(f.claimed,f.options);
    assert.deepEqual(f.calls,completed?['accept','start-once','browser','record:item-1','finish','terminate']:['fail:RUNNER_TASK_INVALID','terminate']);
  });
  it('accepts exact canonical authority and durably fences execution before opening the managed session', async () => {
    const f = fixture(); await executeClaim(f.claimed, f.options);
    assert.deepEqual(f.calls, ['accept', 'start-once', 'browser', 'record:item-1', 'finish', 'terminate']);
    assert.equal(f.session.closed, true); assert.equal(f.session.url, 'https://example.com/checkout');
  });
  for (const field of ['binding', 'profile', 'expiry'] as const) it(`rejects invalid ${field} before acceptance or browser steps`, async () => {
    const f = fixture();
    if (field === 'binding') f.claimed.task.approval.bindingHash = 'f'.repeat(64);
    if (field === 'profile') f.options.managedV2!.profileHashes = ['f'.repeat(64)];
    if (field === 'expiry') f.options.now = () => new Date(f.claimed.task.deadlineAt);
    await executeClaim(f.claimed, f.options);
    assert.deepEqual(f.calls, ['fail:RUNNER_TASK_INVALID', 'terminate']);
  });
  it('does not execute a step when the durable start fence refuses replay', async () => {
    const f = fixture(); f.options.managedV2!.beforeSteps = async () => { throw new Error('Already started'); };
    await executeClaim(f.claimed, f.options);
    assert.deepEqual(f.calls, ['accept', 'fail:RUNNER_EXECUTION_FAILED', 'terminate']);
  });
  it('does not record an assertion FAIL when the browser runtime has crashed', async () => {
    const f = fixture(); let checks = 0;
    f.session.expect = async () => { throw new Error('Browser closed during expectation'); };
    f.options.managedV2!.assertRuntimeLive = async () => { if (++checks > 1) throw new Error('Runtime crashed'); };
    await executeClaim(f.claimed, f.options);
    assert.deepEqual(f.calls, ['accept', 'start-once', 'browser', 'fail:RUNNER_EXECUTION_FAILED', 'terminate']);
    assert.equal(f.submissions.length, 0);
  });
  it('kills the managed runtime on heartbeat lease loss during an in-flight step', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture(), entered = deferredSignal(), release = deferredSignal();
    f.session.navigate = async () => { entered.resolve(); await release.promise; };
    f.client.heartbeat = async () => { throw new OddpathApiError('Cancelled', 409, 'QA_EXECUTION_LEASE_LOST'); };
    f.options.managedV2!.terminate = async () => { f.calls.push('terminate'); release.resolve(); };
    const execution = executeClaim(f.claimed, { ...f.options, heartbeatIntervalMs: 10 });
    await entered.promise; t.mock.timers.tick(10); await setImmediate();
    assert.equal(await execution, null);
    assert.deepEqual(f.calls, ['accept', 'start-once', 'browser', 'terminate', 'terminate']);
    assert.equal(f.submissions.length, 0);
  });
  it('reports a crashed page as infrastructure failure even while runtime health stays LIVE', async () => {
    const f = fixture();
    f.session.expect = async () => { f.session.unavailable = true; throw Error('Renderer crashed'); };
    await executeClaim(f.claimed, f.options);
    assert.deepEqual(f.calls, ['accept', 'start-once', 'browser', 'fail:BROWSER_SESSION_UNAVAILABLE', 'terminate']);
    assert.equal(f.submissions.length, 0); assert.equal(f.session.closed, true);
  });
  it('preserves an earlier PASS and fails the execution if the page disconnects before finish', async () => {
    const f = fixture(), record = f.client.recordItem;
    f.client.recordItem = async (...args) => { const receipt = await record(...args); f.session.unavailable = true; return receipt; };
    await executeClaim(f.claimed, f.options);
    assert.deepEqual(f.calls, ['accept', 'start-once', 'browser', 'record:item-1', 'fail:BROWSER_SESSION_UNAVAILABLE', 'terminate']);
    assert.equal(f.submissions.length, 1); assert.equal(f.submissions[0]!.submission.status, 'PASS');
    assert.equal(f.submissions[0]!.submission.evidence[0]!.kind, 'TEXT');
  });
  it('still records a failed expectation when the managed page is healthy', async () => {
    const f = fixture(); f.session.expect = async () => { throw Error('Expectation mismatch'); };
    await executeClaim(f.claimed, f.options);
    assert.deepEqual(f.calls, ['accept', 'start-once', 'browser', 'record:item-1', 'finish', 'terminate']);
    assert.equal(f.submissions[0]!.submission.status, 'FAIL');
  });
  it('rejects production mutation despite an explicit production permission', async () => {
    const f = fixture(), task = f.claimed.task;
    task.profile.environmentKind = task.profile.target.environmentKind = 'PRODUCTION';
    const { revision, revisionId, targetId, targetHash, ...definition } = task.profile.target;
    task.profile.target.targetHash = hashCanonicalJson(definition);
    const { manifestHash, ...manifest } = task.profile; task.profile.manifestHash = hashCanonicalJson(manifest);
    task.recipe.bundle.items[0]!.steps.push({ action: 'click', ref: 'save', locator: { by: 'role', role: 'button', name: 'Save' } });
    task.recipe.hash = f.claimed.claim.recipeHash = hashCanonicalJson(task.recipe.bundle);
    task.approval.profileManifestHash = task.profile.manifestHash; task.approval.targetHash = task.profile.target.targetHash; task.approval.recipeHash = task.recipe.hash;
    const { bindingHash, ...approval } = task.approval;
    task.approval.bindingHash = hashCanonicalJson({ ...approval, authentication: task.profile.authentication, executionLimits: task.profile.executionLimits, candidate: task.profile.target.candidate });
    f.options.managedV2!.profileHashes = [task.profile.manifestHash];
    await executeClaim(f.claimed, { ...f.options, allowProduction: true });
    assert.deepEqual(f.calls, ['fail:PRODUCTION_NOT_ALLOWED', 'terminate']);
  });
});

class FakeSession implements SemanticBrowserSession {
  unavailable = false;
  assertHealthy() { if (this.unavailable) throw new BrowserSessionUnavailableError(); }
  closed = false;
  filledValue = "";
  url = "about:blank";

  async check() {}
  async click() {}
  async close() { this.closed = true; }
  currentUrl() { return this.url; }
  async expect() {}
  async fill(_locator: unknown, value: string) { this.filledValue = value; }
  async hover() {}
  async navigate(url: string) { this.url = url; }
  async press() {}
  async screenshot() { return new Uint8Array([1, 2, 3]); }
  async select() {}
}
