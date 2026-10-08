import { randomUUID } from "node:crypto";
import { profileManifestV1Schema } from "@oddpath/qa-execution-contract";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { chatAttachmentSchema } from "../chat/chat.schema.js";
import { qaExecutionRecipeRepository } from "../qa-requests/qa-execution-recipes.repository.js";
import { testSessionIntelligence } from "./test-sessions.intelligence.js";
import { nextTimelinePosition } from "../chat-history/chat-timeline.js";
import { conversationSummaryRefreshService } from "../conversation-summary/conversation-summary-refresh.service.js";
import { bump, hash, json, lockOwnedSession, parseProposal, sessionInclude, toDetail } from "./test-sessions.repository.js";

export function createTestSessionsWorker(deps: { database: typeof prisma; intelligence: typeof testSessionIntelligence; recipes: typeof qaExecutionRecipeRepository; refreshSummary?: (userId: string, chatId: string) => Promise<unknown> } = { database: prisma, intelligence: testSessionIntelligence, recipes: qaExecutionRecipeRepository, refreshSummary: conversationSummaryRefreshService.requestRefresh }) {
  const { database } = deps;
  // The repository only queues one active turn per session. Keep an in-process
  // fence too, so another polling lane cannot reclaim a locally running call
  // whose lease expired while the provider was still returning its result.
  const processingSessions = new Set<string>();
  async function processTurn() {
    const now = new Date();
    const candidate = await database.testSessionTurn.findFirst({
      where: { OR: [{ status: "PENDING", availableAt: { lte: now } }, { status: "PROCESSING", leaseExpiresAt: { lte: now } }],
        ...(processingSessions.size ? { sessionId: { notIn: [...processingSessions] } } : {}) },
      orderBy: [{ availableAt: "asc" }, { id: "asc" }],
    });
    if (!candidate || processingSessions.has(candidate.sessionId)) return;
    processingSessions.add(candidate.sessionId);
    try {
      await processCandidate(candidate, now);
    } finally {
      processingSessions.delete(candidate.sessionId);
    }
  }
  async function processCandidate(candidate: Prisma.TestSessionTurnGetPayload<{}>, now: Date) {
    const token = randomUUID();
    const claimed = await database.testSessionTurn.updateMany({
      // The safety checks below use this snapshot. A competing worker may have
      // claimed, called the provider, or retried the turn since it was read;
      // never steal that newer state using the broad eligibility predicate.
      where: {
        id: candidate.id, status: candidate.status, attempts: candidate.attempts,
        leaseToken: candidate.leaseToken, leaseExpiresAt: candidate.leaseExpiresAt,
        providerStartedAt: candidate.providerStartedAt, lastRetryKey: candidate.lastRetryKey,
        availableAt: candidate.availableAt,
        OR: [{ status: "PENDING", availableAt: { lte: now } }, { status: "PROCESSING", leaseExpiresAt: { lte: now } }],
      },
      data: { status: "PROCESSING", leaseToken: token, leaseExpiresAt: new Date(now.getTime() + Math.max(env.qaProcessingLeaseMs, 180_000)), attempts: { increment: 1 }, errorCode: null },
    });
    if (!claimed.count) return;
    try {
      if (candidate.status === "PROCESSING" && candidate.providerStartedAt) throw new AppError("The previous provider result is unknown. Retry explicitly.", 409, "SESSION_TURN_OUTCOME_UNKNOWN");
      // Expired leases are recoverable, but repeated process crashes must not bill forever.
      if (candidate.attempts >= 3) throw new AppError("Test reply retry limit reached. Send a new message to try again.", 409, "TEST_TURN_ATTEMPTS_EXHAUSTED");
      const row = await database.chat.findUnique({ where: { id: candidate.sessionId }, include: sessionInclude });
      if (!row?.testSession || !["TEST", "SESSION"].includes(row.kind) || row.testSession.archivedAt) throw new AppError("Conversation is no longer active.", 409, "TEST_SESSION_UNAVAILABLE");
      const message = row.messages.find(({ id }) => id === candidate.messageId);
      if (!message) throw new AppError("Test message was not found.", 404, "TEST_MESSAGE_NOT_FOUND");
      const attachments = chatAttachmentSchema.array().parse([
        ...(Array.isArray(message.attachment) ? message.attachment : []),
        ...message.attachments.map(({ assetId }) => ({ assetId })),
      ]);
      // Saved QA records are context only: attachments in the conversation never become evidence.
      const runs = row.projectId ? await database.qaRun.findMany({
        where: { request: { projectId: row.projectId, testSessionId: row.id } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 3,
        select: { id: true, requestId: true, status: true, outcome: true,
          results: { orderBy: { checklistItemId: "asc" }, take: 25, select: { checklistItemId: true, status: true, observedResult: true, notes: true } },
          evidence: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, kind: true, checklistItemId: true } },
          reviews: { orderBy: { createdAt: "desc" }, take: 1, select: { decision: true, comment: true } },
        },
      }) : [];
      const recordedResults = runs.map((run) => ({ ...run,
        results: run.results.map((entry) => ({ ...entry, observedResult: entry.observedResult?.slice(0, 300) ?? null, notes: entry.notes?.slice(0, 200) ?? null })),
        reviews: run.reviews.map((review) => ({ ...review, comment: review.comment?.slice(0, 1_000) ?? null })),
      }));
      const discussion = { ...toDetail(row), pendingProposal: parseProposal(row.testSession.pendingProposal) };
      const marked = await database.testSessionTurn.updateMany({ where: { id: candidate.id, status: "PROCESSING", leaseToken: token, leaseExpiresAt: { gt: new Date() } }, data: { providerStartedAt: new Date() } });
      if (!marked.count) return;
      const result = await deps.intelligence.discuss({ userId: row.userId, projectId: row.projectId || "", session: discussion, content: message.content, attachments, recordedResults, model: candidate.model || undefined,
        mode: message.mode === "test_cases" || message.mode === "bug_report" || message.mode === "edge_cases" || message.mode === "checklist" || message.mode === "screenshot_review" ? message.mode : "general" });
      const committed = await database.$transaction(async (tx) => {
        const current = await lockOwnedSession(tx, { userId: row.userId, projectId: row.projectId || "", sessionId: row.id });
        const lease = await tx.testSessionTurn.findFirst({ where: { id: candidate.id, leaseToken: token, status: "PROCESSING", leaseExpiresAt: { gt: new Date() } } });
        if (!lease) return false;
        if (current.testSession!.archivedAt) throw new AppError("Test conversation is archived.", 409, "TEST_SESSION_ARCHIVED");
        const action = result.response.proposalAction || (result.response.proposal ? "replace" : "keep");
        const proposed = action === "replace" ? result.response.proposal : null;
        const proposal = proposed ? {
          ...proposed, ready: proposed.ready && Boolean(proposed.target?.trim() && proposed.environment?.trim()),
          id: randomUUID(), sourceMessageIds: current.messages.filter(({ role }) => role === "USER").slice(-12).map(({ id }) => id),
        } : null;
        await tx.message.create({ data: { chatId: row.id, timelinePosition: await nextTimelinePosition(tx, row.id), role: "ASSISTANT", content: result.response.reply, mode: message.mode, model: result.model,
          metadata: json({ testTurnId: candidate.id, ...(proposal ? { proposalId: proposal.id } : {}) }) } });
        if (action !== "keep") await tx.testSession.update({ where: { id: row.id }, data: { pendingProposal: proposal ? json(proposal) : Prisma.JsonNull } });
        await tx.testSessionTurn.update({ where: { id: candidate.id }, data: { status: "SUCCEEDED", errorCode: null, completedAt: new Date(), leaseToken: null, leaseExpiresAt: null } });
        await bump(tx, row.id);
        return true;
      });
      if (committed && deps.refreshSummary) void deps.refreshSummary(row.userId, row.id).catch(() => { /* Summary failure cannot retry a committed turn. */ });
    } catch (error) {
      const errorCode = safeErrorCode(error);
      // Only transient provider failures retry. Validation, quota and permissions remain visible.
      const retry = candidate.attempts < 2 && ["MODEL_UNAVAILABLE", "AI_RATE_LIMITED"].includes(errorCode);
      await database.testSessionTurn.updateMany({ where: { id: candidate.id, status: "PROCESSING", leaseToken: token }, data: {
        status: retry ? "PENDING" : "FAILED", errorCode, availableAt: new Date(Date.now() + 5_000),
        completedAt: retry ? null : new Date(), leaseToken: null, leaseExpiresAt: null,
        ...(retry ? { providerStartedAt: null } : {}),
      } });
    }
  }

  async function reconcilePreparation(id: string) {
    const candidate = await database.testSessionPreparation.findUnique({ where: { id }, include: { session: { include: { chat: true } } } });
    if (!candidate?.session.chat.projectId) return;
    const scope = { userId: candidate.session.chat.userId, projectId: candidate.session.chat.projectId, sessionId: candidate.sessionId };
    try {
      const command = await database.$transaction(async (tx) => {
        const row = await lockOwnedSession(tx, scope);
        const preparation = row.testSession!.preparations.find((entry) => entry.id === id);
        if (!preparation || !["CHECKLIST", "RECIPE", "REVIEW"].includes(preparation.status)) return null;
        const request = row.testSession!.requests.find((entry) => entry.id === preparation.requestId);
        const setState = async (data: Prisma.TestSessionPreparationUpdateInput) => {
          await tx.testSessionPreparation.update({ where: { id }, data });
          await bump(tx, row.id);
        };
        if (!request || row.testSession!.archivedAt || row.testSession!.currentRequestId !== request.id) {
          await setState({ status: "STOPPED", errorCode: "TEST_REQUEST_NOT_CURRENT" });
          return null;
        }
        if (preparation.status === "CHECKLIST") {
          const operation = await tx.qaGenerationExecution.findFirst({ where: { requestId: request.id, kind: "CHECKLIST_GENERATION" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
          if (!operation) { await setState({ status: "FAILED", errorCode: "QA_GENERATION_MISSING" }); return null; }
          if (["PENDING", "PROCESSING"].includes(operation.status)) return null;
          if (operation.status === "FAILED") {
            await setState({ status: "FAILED", operationId: operation.id, errorCode: operation.errorCode || "QA_PROCESSING_FAILED" });
            return null;
          }
          if (!request.selectedArtifactId || !["READY_TO_RUN", "CHANGES_REQUESTED"].includes(request.phase)) {
            await setState({ status: "FAILED", errorCode: "QA_ARTIFACT_NOT_SELECTED" });
            return null;
          }
          await setState({ status: preparation.profileManifest ? "RECIPE" : "WAITING_PROFILE", operationId: null });
          return null;
        }
        if (!preparation.profileManifest) { await setState({ status: "WAITING_PROFILE" }); return null; }
        if (preparation.status === "RECIPE") {
          // Recovery of a failed review keeps its immutable Recipe, not a regenerated replacement.
          if (preparation.recipeId) {
            const assessment = await tx.qaExecutionRecipeAssessment.findFirst({ where: { recipeId: preparation.recipeId }, orderBy: { createdAt: "desc" } });
            if (!assessment) { await setState({ status: "FAILED", errorCode: "QA_RECIPE_ASSESSMENT_MISSING" }); return null; }
            if (assessment?.status === "FAILED") return { kind: "review" as const, requestId: request.id, recipeId: preparation.recipeId, assessmentId: assessment.id, preparation: { id, attempt: preparation.attempt } };
            await setState({ status: assessment?.status === "PENDING" ? "REVIEW" : "READY", errorCode: null });
            return null;
          }
          if (preparation.operationId) {
            const operation = await tx.qaGenerationExecution.findUnique({ where: { id: preparation.operationId } });
            if (!operation) { await setState({ status: "FAILED", errorCode: "QA_GENERATION_MISSING" }); return null; }
            if (["PENDING", "PROCESSING"].includes(operation.status)) return null;
            if (operation.status === "FAILED") { await setState({ status: "FAILED", errorCode: operation.errorCode || "QA_PROCESSING_FAILED" }); return null; }
            if (!operation.recipeId) { await setState({ status: "FAILED", errorCode: "QA_EXECUTION_RECIPE_NOT_FOUND" }); return null; }
            await setState({ recipeId: operation.recipeId, status: "REVIEW", errorCode: null });
            return null;
          }
          return { kind: "recipe" as const, requestId: request.id, artifactId: request.selectedArtifactId!, profileManifest: profileManifestV1Schema.parse(preparation.profileManifest),
            preparation: { id, attempt: preparation.attempt },
            idempotencyKeyHash: hash({ preparationId: id, attempt: preparation.attempt, artifactId: request.selectedArtifactId }) };
        }
        const assessment = preparation.recipeId ? await tx.qaExecutionRecipeAssessment.findFirst({ where: { recipeId: preparation.recipeId }, orderBy: { createdAt: "desc" } }) : null;
        if (!assessment) { await setState({ status: "FAILED", errorCode: "QA_RECIPE_ASSESSMENT_MISSING" }); return null; }
        if (assessment.status === "PENDING") return null;
        await setState({ status: assessment.status === "FAILED" ? "FAILED" : "READY", errorCode: assessment.errorCode });
        return null;
      });
      if (!command) return;
      const operationId = command.kind === "recipe"
        ? await deps.recipes.queueGeneration({ actor: { kind: "SYSTEM", transport: "SYSTEM" }, projectId: scope.projectId, requestId: command.requestId,
          artifactId: command.artifactId, profileManifest: command.profileManifest, idempotencyKeyHash: command.idempotencyKeyHash, preparation: command.preparation })
        : await deps.recipes.queueReviewRetry({ actor: { kind: "USER", transport: "WEB", userId: scope.userId }, projectId: scope.projectId,
          requestId: command.requestId, recipeId: command.recipeId, assessmentId: command.assessmentId, preparation: command.preparation });
      await database.$transaction(async (tx) => {
        const row = await lockOwnedSession(tx, scope);
        const current = row.testSession!.preparations.find((entry) => entry.id === id);
        if (!current || current.status !== "RECIPE" || current.attempt !== command.preparation.attempt || row.testSession!.currentRequestId !== command.requestId) return;
        await tx.testSessionPreparation.update({ where: { id }, data: { operationId, ...(command.kind === "review" ? { status: "REVIEW" } : {}) } });
        await bump(tx, row.id);
      });
    } catch (error) {
      // Unknown failures may occur after a committed queue write. Preserve the intent so
      // the next poll resolves its idempotency key instead of billing a new attempt.
      if (!(error instanceof AppError)) throw error;
      await database.$transaction(async (tx) => {
        const row = await lockOwnedSession(tx, scope);
        const current = row.testSession!.preparations.find((entry) => entry.id === id);
        if (!current || current.attempt !== candidate.attempt || current.status !== candidate.status) return;
        await tx.testSessionPreparation.update({ where: { id }, data: { status: "FAILED", errorCode: safeErrorCode(error) } });
        await bump(tx, row.id);
      });
    }
  }
  async function processPreparations(input: { shouldStop?: () => boolean } = {}) {
    const preparations = await database.testSessionPreparation.findMany({ where: { status: { in: ["CHECKLIST", "RECIPE", "REVIEW"] } }, orderBy: { updatedAt: "asc" }, take: 10 });
    for (const preparation of preparations) {
      if (input.shouldStop?.()) return;
      await reconcilePreparation(preparation.id);
    }
  }
  async function runOnce() {
    // Do not report a completed tick while its sibling is still committing.
    const results = await Promise.allSettled([processTurn(), processPreparations()]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  return { runOnce, processTurn, processPreparations, reconcilePreparation };
}

export function startTestSessionsLoop(input: {
  worker?: Pick<ReturnType<typeof createTestSessionsWorker>, "processTurn" | "processPreparations">;
  intervalMs?: number;
  turnConcurrency?: number;
  logger?: Pick<Console, "error">;
} = {}) {
  const worker = input.worker || createTestSessionsWorker();
  const turnConcurrency = input.turnConcurrency ?? Math.min(env.qaProcessingConcurrency, 8);
  if (!Number.isInteger(turnConcurrency) || turnConcurrency < 1 || turnConcurrency > 8) throw new RangeError("Session turn concurrency must be between 1 and 8.");
  let stopped = false;
  const timers = new Set<NodeJS.Timeout>();
  const pending = new Set<Promise<void>>();
  const startLane = (work: () => Promise<void>) => {
    const tick = () => {
      if (stopped) return;
      // Each lane schedules only after its work settles. Provider latency cannot
      // stall preparation reconciliation or the other bounded turn lanes.
      const task = (async () => { await work(); })()
        .catch(() => (input.logger || console).error(JSON.stringify({ event: "test_session_processing_failed" })))
        .finally(() => {
          pending.delete(task);
          if (!stopped) {
            const timer = setTimeout(() => { timers.delete(timer); tick(); }, input.intervalMs ?? env.qaProcessingPollIntervalMs);
            timers.add(timer);
            timer.unref?.();
          }
        });
      pending.add(task);
    };
    tick();
  };
  startLane(() => worker.processPreparations({ shouldStop: () => stopped }));
  for (let lane = 0; lane < turnConcurrency; lane += 1) startLane(() => worker.processTurn());
  return async () => {
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    await Promise.all([...pending]);
  };
}
function safeErrorCode(error: unknown) { return error instanceof AppError && /^[A-Z][A-Z0-9_]{0,63}$/u.test(error.code) ? error.code : "TEST_PROCESSING_FAILED"; }
