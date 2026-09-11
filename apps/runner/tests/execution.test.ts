import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setImmediate } from "node:timers/promises";

import type { ExecutionItemSubmissionV1 } from "@oddpath/qa-execution-contract";

import { executeClaim, idempotencyKey, type ExecuteClaimOptions } from "../src/execution.js";
import { OddpathApiError } from "../src/http-client.js";
import type { SemanticBrowserSession } from "../src/interpreter.js";
import { claimedExecution, executionReceipt, testConfig } from "./fixtures.js";

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

class FakeSession implements SemanticBrowserSession {
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
