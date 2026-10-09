import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "../src/lib/errors.ts";
import { createTestSessionsWorker, startTestSessionsLoop } from "../src/modules/test-sessions/test-sessions.worker.ts";
import { hash } from "../src/modules/test-sessions/test-sessions.repository.ts";
import { fixture, preparation, PROFILE, PROPOSAL, request, session, SCOPE, NOW } from "./test-sessions.fixture.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function settled(signal: Promise<unknown>) {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([signal, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Worker did not make independent progress.")), 2_000);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function turnFixture(overrides: Record<string, unknown> = {}) {
  const f = fixture();
  const candidate = { id: "turn-1", sessionId: SCOPE.sessionId, messageId: "message-1", model: null, attempts: 0, status: "PENDING",
    availableAt: NOW, leaseToken: null, leaseExpiresAt: null, providerStartedAt: null, lastRetryKey: null, ...overrides };
  let leaseAvailable = true;
  f.tx.testSessionTurn.findFirst = f.record("turn.findFirst", (input: any) => input.where.id ? leaseAvailable ? candidate : null : candidate);
  f.tx.chat.findUnique = f.record("chat.findUnique", f.row);
  const providerCalls: any[] = [];
  const { id: _id, sourceMessageIds: _sources, ...proposal } = PROPOSAL;
  const intelligence = { async discuss(input: any) { providerCalls.push(input); return { response: { reply: "Please confirm Prepare.", proposal }, model: "test-model" }; } };
  const recipes = { async queueGeneration() { assert.fail("Conversational turns cannot generate Recipes"); }, async queueReviewRetry() { assert.fail("Conversational turns cannot approve or retry Recipes"); } } as any;
  const worker = createTestSessionsWorker({ database: f.database, intelligence, recipes });
  return { ...f, worker, candidate, providerCalls, intelligence, loseLease() { leaseAvailable = false; } };
}

function preparationFixture(overrides: Record<string, unknown> = {}) {
  const f = fixture();
  const current = preparation(overrides);
  f.row.testSession.currentRequestId = "request-1";
  f.row.testSession.requests = [request()];
  f.row.testSession.preparations = [current];
  f.tx.testSessionPreparation.findUnique = f.record("preparation.findUnique", { ...current, session: { chat: f.row } });
  const commands: Array<{ kind: string; input: any }> = [];
  const recipes = {
    async queueGeneration(input: any) { commands.push({ kind: "recipe", input }); return "recipe-operation"; },
    async queueReviewRetry(input: any) { commands.push({ kind: "review", input }); return "review-operation"; },
  } as any;
  const worker = createTestSessionsWorker({ database: f.database, recipes, intelligence: { async discuss() { assert.fail("Preparation is not conversational AI"); } } });
  return { ...f, current, commands, recipes, worker };
}

describe("Test durable turn worker crash recovery", () => {
  it("does not replay an expired provider call whose outcome is unknown", async () => {
    const f = turnFixture({ status: "PROCESSING", attempts: 1, providerStartedAt: NOW });
    await f.worker.processTurn();
    assert.equal(f.providerCalls.length, 0);
    const update = f.calls.filter(({ operation }) => operation === "turn.updateMany").at(-1)!.input;
    assert.equal(update.data.status, "FAILED");
    assert.equal(update.data.errorCode, "SESSION_TURN_OUTCOME_UNKNOWN");
    assert.equal(f.calls.some(({ operation }) => operation === "message.create"), false);
  });
  it("keeps a pending proposal on a normal response and allocates only one assistant position", async () => {
    const f = turnFixture();
    f.intelligence.discuss = async () => ({ response: { reply: "Here is the report.", proposalAction: "keep" }, model: "test-model" }) as any;
    await f.worker.processTurn();
    assert.equal(f.calls.some(({ operation, input }) => operation === "testSession.update" && 'pendingProposal' in input.data), false);
    assert.equal(f.call("message.create").data.timelinePosition, 2);
    assert.equal(f.call("message.create").data.content, "Here is the report.");
  });
  it("claims recoverable pending or expired work atomically, and commits only its live lease", async () => {
    const f = turnFixture({ status: "PROCESSING", attempts: 1 });
    await f.worker.processTurn();
    const claim = f.call("turn.updateMany");
    assert.deepEqual(claim.where.OR.map((entry: any) => entry.status), ["PENDING", "PROCESSING"]);
    assert.deepEqual(claim.data.attempts, { increment: 1 });
    assert.equal(typeof claim.data.leaseToken, "string");
    assert.ok(claim.data.leaseExpiresAt > new Date());
    const leaseCheck = f.calls.filter(({ operation }) => operation === "turn.findFirst").at(-1)!.input;
    assert.equal(leaseCheck.where.leaseToken, claim.data.leaseToken);
    assert.ok(leaseCheck.where.leaseExpiresAt.gt instanceof Date);
    assert.equal(f.call("turn.update").data.status, "SUCCEEDED");
    assert.equal(f.call("turn.update").data.leaseToken, null);
    assert.equal(f.providerCalls.length, 1);
    assert.equal(f.providerCalls[0].userId, SCOPE.userId);
    assert.equal(f.providerCalls[0].projectId, SCOPE.projectId);
    assert.deepEqual(f.call("run.findMany").where, { request: { projectId: SCOPE.projectId, testSessionId: SCOPE.sessionId } });
    assert.equal(f.call("run.findMany").take, 3);
  });

  it("does not bill or write a reply after another worker wins the claim", async () => {
    const f = turnFixture();
    f.tx.testSessionTurn.updateMany = f.record("turn.updateMany", { count: 0 });
    await f.worker.processTurn();
    assert.equal(f.providerCalls.length, 0);
    assert.deepEqual(f.writes().map(({ operation }) => operation), ["turn.updateMany"]);
  });

  for (const [label, competingState] of [
    ["started a provider call whose lease is now expired", { status: "PROCESSING", attempts: 1, leaseToken: "other-worker", leaseExpiresAt: NOW, providerStartedAt: NOW }],
    ["exhausted transient attempts and returned to pending", { attempts: 3 }],
    ["explicitly retried the turn with a fresh retry identity", { lastRetryKey: "explicit-retry" }],
  ] as const) {
    it(`rejects a stale pending snapshot after another worker ${label}`, async () => {
      const f = turnFixture();
      // The first read still returns f.candidate, but persistence now contains
      // a newer eligible state. Evaluate the actual claim predicate against it.
      const stored: Record<string, any> = { ...f.candidate, ...competingState };
      const matches = (where: Record<string, any>): boolean => Object.entries(where).every(([key, value]) => {
        if (value === undefined) return true;
        if (key === "OR") return value.some(matches);
        if (value instanceof Date) return stored[key] instanceof Date && stored[key].getTime() === value.getTime();
        if (value !== null && typeof value === "object" && "lte" in value) return stored[key] instanceof Date && stored[key] <= value.lte;
        return stored[key] === value;
      });
      f.tx.testSessionTurn.updateMany = f.record("turn.updateMany", ({ where, data }: any) => {
        if (!matches(where)) return { count: 0 };
        const attempts = stored.attempts + (data.attempts?.increment || 0);
        Object.assign(stored, data, { attempts });
        return { count: 1 };
      });

      await f.worker.processTurn();

      assert.equal(f.providerCalls.length, 0);
      assert.equal(f.calls.some(({ operation }) => operation === "chat.findUnique" || operation === "message.create"), false);
      assert.deepEqual(stored, { ...f.candidate, ...competingState }, "The newer turn is left for a fresh read, not mutated by a stale worker");
      assert.deepEqual(f.writes().map(({ operation }) => operation), ["turn.updateMany"]);
    });
  }

  it("discards an AI result after its lease expires or is replaced", async () => {
    const f = turnFixture();
    f.loseLease();
    await f.worker.processTurn();
    assert.equal(f.providerCalls.length, 1);
    assert.equal(f.calls.some(({ operation }) => ["message.create", "testSession.update", "turn.update"].includes(operation)), false);
  });

  for (const attempts of [0, 1, 2]) {
    it(`bounds transient retries at provider attempt ${attempts + 1}`, async () => {
      const f = turnFixture({ attempts });
      f.intelligence.discuss = async () => { throw new AppError("private upstream text", 429, "AI_RATE_LIMITED"); };
      const before = Date.now();
      await f.worker.processTurn();
      const failure = f.calls.filter(({ operation }) => operation === "turn.updateMany").at(-1)!.input;
      assert.equal(failure.data.status, attempts < 2 ? "PENDING" : "FAILED");
      assert.equal(failure.data.errorCode, "AI_RATE_LIMITED");
      assert.equal(failure.where.leaseToken, f.call("turn.updateMany").data.leaseToken);
      assert.equal(failure.data.leaseToken, null);
      assert.ok(failure.data.availableAt.getTime() >= before + 5_000);
      assert.equal(failure.data.completedAt === null, attempts < 2);
      assert.doesNotMatch(JSON.stringify(failure), /private upstream/u);
    });
  }

  it("terminally exhausts repeatedly crashed leases before another provider call", async () => {
    const f = turnFixture({ attempts: 3, status: "PROCESSING" });
    await f.worker.processTurn();
    assert.equal(f.providerCalls.length, 0);
    const failure = f.calls.filter(({ operation }) => operation === "turn.updateMany").at(-1)!.input;
    assert.equal(failure.data.status, "FAILED");
    assert.equal(failure.data.errorCode, "TEST_TURN_ATTEMPTS_EXHAUSTED");
  });

  for (const code of ["MODEL_UNAVAILABLE", "AI_RATE_LIMITED"]) {
    it(`retries the provider-normalized transient code ${code}`, async () => {
      const f = turnFixture();
      f.intelligence.discuss = async () => { throw new AppError("Transient", 503, code); };
      await f.worker.processTurn();
      const failure = f.calls.filter(({ operation }) => operation === "turn.updateMany").at(-1)!.input;
      assert.equal(failure.data.status, "PENDING");
      assert.equal(failure.data.errorCode, code);
    });
  }

  for (const error of [new AppError("quota details", 429, "AI_QUOTA_EXCEEDED"), new AppError("validation details", 502, "TEST_TURN_OUTPUT_INVALID"), new Error("token-secret-stack")]) {
    it(`does not retry terminal failure ${error instanceof AppError ? error.code : "unexpected"} or persist private details`, async () => {
      const f = turnFixture();
      f.intelligence.discuss = async () => { throw error; };
      await f.worker.processTurn();
      const failure = f.calls.filter(({ operation }) => operation === "turn.updateMany").at(-1)!.input;
      assert.equal(failure.data.status, "FAILED");
      assert.equal(failure.data.errorCode, error instanceof AppError ? error.code : "TEST_PROCESSING_FAILED");
      assert.doesNotMatch(JSON.stringify(failure), /quota details|validation details|token-secret-stack/u);
    });
  }

  it("downgrades an AI-ready brief with missing target or environment and never executes it", async () => {
    const f = turnFixture();
    const { id: _id, sourceMessageIds: _sources, ...proposal } = PROPOSAL;
    f.intelligence.discuss = async () => ({ response: { reply: "Approved; run now", proposal: { ...proposal, target: " " } }, model: "test-model" });
    await f.worker.processTurn();
    const saved = f.call("testSession.update").data.pendingProposal;
    assert.equal(saved.ready, false);
    assert.notEqual(saved.id, PROPOSAL.id);
    assert.deepEqual(saved.sourceMessageIds, ["message-1"]);
    assert.equal(f.calls.some(({ operation }) => operation === "request.create" || operation === "operation.create"), false);
  });

  it("waits for every in-flight lane during shutdown and never schedules another", async () => {
    const turn = deferred();
    const preparation = deferred();
    let turnCalls = 0;
    let preparationCalls = 0;
    const stop = startTestSessionsLoop({ worker: {
      async processTurn() { turnCalls += 1; await turn.promise; },
      async processPreparations() { preparationCalls += 1; await preparation.promise; },
    }, intervalMs: 1, turnConcurrency: 2 });
    let stopped = false;
    const shutdown = stop().then(() => { stopped = true; });
    await Promise.resolve();
    assert.equal(stopped, false);
    turn.resolve();
    await Promise.resolve();
    assert.equal(stopped, false, "Preparation is still in flight");
    preparation.resolve();
    await shutdown;
    assert.equal(stopped, true);
    assert.equal(turnCalls, 2);
    assert.equal(preparationCalls, 1);
  });

  it("does not reclaim the same session while its provider call is locally in flight", async () => {
    const f = turnFixture();
    const started = deferred();
    const release = deferred();
    f.intelligence.discuss = async () => {
      f.providerCalls.push("in-flight"); started.resolve(); await release.promise;
      return { response: { reply: "Finished.", proposalAction: "keep" }, model: "test-model" } as any;
    };
    const first = f.worker.processTurn();
    await settled(started.promise);
    try {
      await f.worker.processTurn();
      assert.equal(f.providerCalls.length, 1);
      const queries = f.calls.filter(({ operation, input }) => operation === "turn.findFirst" && !input.where.id);
      assert.deepEqual(queries[1]!.input.where.sessionId, { notIn: [SCOPE.sessionId] });
      assert.equal(f.calls.filter(({ operation, input }) => operation === "turn.updateMany" && input.data.attempts).length, 1);
    } finally {
      release.resolve(); await first;
    }
  });

  it("releases the local session fence when the atomic claim loses", async () => {
    const f = turnFixture();
    let claims = 0;
    f.tx.testSessionTurn.updateMany = f.record("turn.updateMany", () => ({ count: ++claims === 1 ? 0 : 1 }));
    await f.worker.processTurn();
    await f.worker.processTurn();
    assert.equal(f.providerCalls.length, 1);
    assert.equal(f.call("turn.update").data.status, "SUCCEEDED");
  });

  it("releases the local session fence if persistence fails before claiming a turn", async () => {
    const f = turnFixture();
    let claims = 0;
    f.tx.testSessionTurn.updateMany = f.record("turn.updateMany", () => {
      if (++claims === 1) throw new Error("Claim persistence unavailable");
      return { count: 1 };
    });
    await assert.rejects(f.worker.processTurn(), /Claim persistence unavailable/u);
    await f.worker.processTurn();
    assert.equal(f.providerCalls.length, 1);
  });

  it("waits for a pending provider before surfacing a sibling preparation tick failure", async () => {
    const f = turnFixture();
    const started = deferred();
    const release = deferred();
    f.intelligence.discuss = async () => {
      started.resolve(); await release.promise;
      return { response: { reply: "Finished.", proposalAction: "keep" }, model: "test-model" } as any;
    };
    f.tx.testSessionPreparation.findMany = async () => { throw new Error("Preparation read unavailable"); };
    let rejected = false;
    const tick = f.worker.runOnce().catch((error: unknown) => {
      rejected = true; assert.match(String(error), /Preparation read unavailable/u);
    });
    await settled(started.promise);
    assert.equal(rejected, false);
    release.resolve();
    await tick;
    assert.equal(rejected, true);
    assert.equal(f.call("turn.update").data.status, "SUCCEEDED");
  });
});

describe("Test session independent polling lanes", () => {
  it("progresses preparation and another session while the first conversational provider is pending", async () => {
    const f = fixture();
    const other = session({ id: "session-2", testSession: { ...f.row.testSession, id: "session-2" } });
    const rows = new Map([[f.row.id, f.row], [other.id, other]]);
    const turns: any[] = [f.row, other].map((row, index) => ({ id: `turn-${index + 1}`, sessionId: row.id, messageId: "message-1", model: null, attempts: 0, status: "PENDING" }));
    f.tx.chat.findUnique = f.record("chat.findUnique", ({ where }: any) => rows.get(where.id));
    f.tx.chat.findFirst = f.record("chat.findFirst", ({ where }: any) => rows.get(where.id));
    f.tx.testSessionTurn.findFirst = f.record("turn.findFirst", ({ where }: any) => {
      const turn = where.id
        ? turns.find((entry) => entry.id === where.id && entry.leaseToken === where.leaseToken && entry.status === "PROCESSING")
        : turns.find((entry) => entry.status === "PENDING" && !where.sessionId?.notIn.includes(entry.sessionId));
      return turn ? { ...turn } : null;
    });
    f.tx.testSessionTurn.updateMany = f.record("turn.updateMany", ({ where, data }: any) => {
      const turn = turns.find((entry) => entry.id === where.id);
      if (!turn || (data.attempts && turn.status !== "PENDING") || (where.leaseToken && where.leaseToken !== turn.leaseToken)) return { count: 0 };
      const attempts = turn.attempts + (data.attempts?.increment || 0);
      Object.assign(turn, data, { attempts });
      return { count: 1 };
    });
    f.tx.testSessionTurn.update = f.record("turn.update", ({ where, data }: any) => Object.assign(turns.find((entry) => entry.id === where.id)!, data));
    const current = preparation();
    f.row.testSession.currentRequestId = "request-1";
    f.row.testSession.requests = [request()];
    f.row.testSession.preparations = [current];
    f.tx.testSessionPreparation.findMany = f.record("preparation.findMany", [current]);
    f.tx.testSessionPreparation.findUnique = f.record("preparation.findUnique", { ...current, session: { chat: f.row } });
    f.tx.qaGenerationExecution.findFirst = f.record("operation.findFirst", { id: "checklist-operation", status: "SUCCEEDED" });
    const preparationAdvanced = deferred();
    f.tx.testSessionPreparation.update = f.record("preparation.update", ({ data }: any) => {
      Object.assign(current, data); preparationAdvanced.resolve(); return current;
    });
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const otherFinished = deferred();
    const providerSessions: string[] = [];
    const worker = createTestSessionsWorker({ database: f.database, recipes: {} as any, intelligence: {
      async discuss(input: any) {
        providerSessions.push(input.session.id);
        if (input.session.id === f.row.id) { firstStarted.resolve(); await releaseFirst.promise; }
        else otherFinished.resolve();
        return { response: { reply: "Discussion only.", proposal: null, proposalAction: "keep" }, model: "test-model" };
      },
    } });
    const stop = startTestSessionsLoop({ worker, intervalMs: 1, turnConcurrency: 2 });
    try {
      await settled(firstStarted.promise);
      await settled(Promise.all([preparationAdvanced.promise, otherFinished.promise]));
      assert.equal(turns[0]!.status, "PROCESSING", "First provider has not returned");
      assert.equal(current.status, "RECIPE");
      assert.deepEqual(providerSessions, [f.row.id, other.id]);
      assert.equal(f.calls.some(({ operation }) => operation === "request.create"), false);
    } finally {
      const stopping = stop();
      releaseFirst.resolve();
      await stopping;
    }
    assert.deepEqual(turns.map(({ status }) => status), ["SUCCEEDED", "SUCCEEDED"]);
    assert.equal(f.calls.filter(({ operation }) => operation === "message.create").length, 2);
  });

  it("bounds turn concurrency and does not overlap preparation polling", async () => {
    const releaseTurns = deferred();
    const releasePreparation = deferred();
    const preparationStartedAgain = deferred();
    let turns = 0;
    let preparations = 0;
    let activePreparation = 0;
    const stop = startTestSessionsLoop({ intervalMs: 1, turnConcurrency: 2, worker: {
      async processTurn() { turns += 1; await releaseTurns.promise; },
      async processPreparations() {
        assert.equal(activePreparation, 0);
        activePreparation += 1;
        preparations += 1;
        if (preparations === 1) await releasePreparation.promise;
        else preparationStartedAgain.resolve();
        activePreparation -= 1;
      },
    } });
    try {
      assert.equal(turns, 2);
      assert.equal(preparations, 1);
      releasePreparation.resolve();
      await settled(preparationStartedAgain.promise);
      assert.equal(turns, 2, "Pending turns cannot launch unbounded provider calls");
    } finally {
      const stopping = stop(); releasePreparation.resolve(); releaseTurns.resolve(); await stopping;
    }
  });

  it("logs a failed preparation tick safely and retries without waiting for a provider", async () => {
    const releaseTurn = deferred();
    const retried = deferred();
    const errors: string[] = [];
    let preparations = 0;
    const stop = startTestSessionsLoop({ intervalMs: 1, turnConcurrency: 1, logger: { error: (value: string) => errors.push(value) }, worker: {
      async processTurn() { await releaseTurn.promise; },
      async processPreparations() { if (++preparations === 1) throw new Error("private persistence details"); retried.resolve(); },
    } });
    try {
      await settled(retried.promise);
      assert.deepEqual(errors, ['{"event":"test_session_processing_failed"}']);
    } finally {
      const stopping = stop(); releaseTurn.resolve(); await stopping;
    }
  });

  it("rejects unbounded or invalid turn lane configuration before starting work", () => {
    for (const turnConcurrency of [0, -1, 1.5, 9, Infinity]) {
      assert.throws(() => startTestSessionsLoop({ turnConcurrency }), RangeError);
    }
  });
});

describe("Test durable preparation chain", () => {
  it("does not reconcile further preparation records after shutdown was requested", async () => {
    const f = preparationFixture();
    let stopping = false;
    f.tx.testSessionPreparation.findMany = f.record("preparation.findMany", [{ id: "preparation-1" }, { id: "preparation-2" }]);
    f.tx.qaGenerationExecution.findFirst = async () => { stopping = true; return { id: "checklist-operation", status: "SUCCEEDED" }; };
    await f.worker.processPreparations({ shouldStop: () => stopping });
    assert.equal(f.calls.filter(({ operation }) => operation === "preparation.findUnique").length, 1);
    assert.equal(f.call("preparation.update").data.status, "RECIPE");
  });
  for (const profileManifest of [null, PROFILE]) {
    it(`moves a successful checklist to ${profileManifest ? "Recipe generation" : "waiting for Runner setup"}`, async () => {
      const f = preparationFixture({ profileManifest });
      f.tx.qaGenerationExecution.findFirst = async () => ({ id: "checklist-operation", status: "SUCCEEDED" });
      await f.worker.reconcilePreparation("preparation-1");
      assert.equal(f.call("preparation.update").data.status, profileManifest ? "RECIPE" : "WAITING_PROFILE");
      assert.equal(f.commands.length, 0);
    });
  }

  it("keeps active checklist work pending without starting duplicate generation", async () => {
    const f = preparationFixture();
    f.tx.qaGenerationExecution.findFirst = async () => ({ id: "checklist-operation", status: "PROCESSING" });
    await f.worker.reconcilePreparation("preparation-1");
    assert.equal(f.writes().length, 0);
    assert.equal(f.commands.length, 0);
  });

  it("queues Recipe generation with deterministic preparation/attempt identity, never run approval", async () => {
    const f = preparationFixture({ status: "RECIPE" });
    await f.worker.reconcilePreparation("preparation-1");
    assert.deepEqual(f.commands, [{ kind: "recipe", input: {
      actor: { kind: "SYSTEM", transport: "SYSTEM" }, projectId: SCOPE.projectId, requestId: "request-1", artifactId: "artifact-1",
      preparation: { id: "preparation-1", attempt: 1 },
      profileManifest: PROFILE, idempotencyKeyHash: hash({ preparationId: "preparation-1", attempt: 1, artifactId: "artifact-1" }),
    } }]);
    assert.equal(f.call("preparation.update").data.operationId, "recipe-operation");
  });

  it("recovers Recipe generation completion into review without regenerating the immutable Recipe", async () => {
    const f = preparationFixture({ status: "RECIPE", operationId: "recipe-operation" });
    f.tx.qaGenerationExecution.findUnique = async () => ({ id: "recipe-operation", status: "SUCCEEDED", recipeId: "recipe-1" });
    await f.worker.reconcilePreparation("preparation-1");
    assert.deepEqual(f.call("preparation.update").data, { recipeId: "recipe-1", status: "REVIEW", errorCode: null });
    assert.equal(f.commands.length, 0);
  });

  it("retries failed review against the exact prior assessment and Recipe", async () => {
    const f = preparationFixture({ status: "RECIPE", recipeId: "recipe-1" });
    f.tx.qaExecutionRecipeAssessment.findFirst = async () => ({ id: "assessment-1", status: "FAILED" });
    await f.worker.reconcilePreparation("preparation-1");
    assert.deepEqual(f.commands, [{ kind: "review", input: {
      actor: { kind: "USER", transport: "WEB", userId: SCOPE.userId }, projectId: SCOPE.projectId,
      requestId: "request-1", recipeId: "recipe-1", assessmentId: "assessment-1",
      preparation: { id: "preparation-1", attempt: 1 },
    } }]);
    assert.deepEqual(f.call("preparation.update").data, { operationId: "review-operation", status: "REVIEW" });
  });

  for (const status of ["PENDING", "FAILED", "PASSED", "SUGGESTIONS"]) {
    it(`handles ${status} assessment without claiming human approval`, async () => {
      const f = preparationFixture({ status: "REVIEW", recipeId: "recipe-1" });
      f.tx.qaExecutionRecipeAssessment.findFirst = async () => ({ id: "assessment-1", status, errorCode: status === "FAILED" ? "QA_RECIPE_REVIEW_INVALID" : null });
      await f.worker.reconcilePreparation("preparation-1");
      if (status === "PENDING") assert.equal(f.writes().length, 0);
      else assert.equal(f.call("preparation.update").data.status, status === "FAILED" ? "FAILED" : "READY");
      assert.equal(f.commands.length, 0);
      assert.equal(f.calls.some(({ operation }) => operation === "request.update"), false);
    });
  }

  it("fails visibly for missing operation or assessment instead of waiting forever or claiming readiness", async () => {
    for (const overrides of [{ status: "CHECKLIST" }, { status: "RECIPE", operationId: "missing" }, { status: "REVIEW", recipeId: "recipe-1" }, { status: "RECIPE", recipeId: "recipe-1" }]) {
      const f = preparationFixture(overrides);
      await f.worker.reconcilePreparation("preparation-1");
      assert.equal(f.call("preparation.update").data.status, "FAILED");
      assert.match(f.call("preparation.update").data.errorCode, /MISSING$/u);
      assert.equal(f.commands.length, 0);
    }
  });

  it("stops preparation after archiving or switching the current request", async () => {
    const f = preparationFixture({ status: "RECIPE" });
    f.row.testSession.currentRequestId = "request-new";
    await f.worker.reconcilePreparation("preparation-1");
    assert.deepEqual(f.call("preparation.update").data, { status: "STOPPED", errorCode: "TEST_REQUEST_NOT_CURRENT" });
    assert.equal(f.commands.length, 0);
  });

  it("does not attach an old queued operation to a newer preparation attempt", async () => {
    const f = preparationFixture({ status: "RECIPE" });
    f.recipes.queueGeneration = async () => { f.current.attempt += 1; return "stale-operation"; };
    await f.worker.reconcilePreparation("preparation-1");
    assert.equal(f.writes().length, 0);
  });

  it("preserves resumable intent on ambiguous database failure and reuses the idempotency key", async () => {
    const f = preparationFixture({ status: "RECIPE" });
    const commands: any[] = [];
    f.recipes.queueGeneration = async (input: any) => { commands.push(input); throw new Error("Connection lost after commit"); };
    await assert.rejects(f.worker.reconcilePreparation("preparation-1"), /Connection lost/u);
    assert.equal(f.writes().length, 0);
    f.recipes.queueGeneration = async (input: any) => { commands.push(input); return "existing-operation"; };
    await f.worker.reconcilePreparation("preparation-1");
    assert.equal(commands[0].idempotencyKeyHash, commands[1].idempotencyKeyHash);
    assert.deepEqual(commands[0].preparation, commands[1].preparation);
    assert.equal(f.call("preparation.update").data.operationId, "existing-operation");
  });
});
