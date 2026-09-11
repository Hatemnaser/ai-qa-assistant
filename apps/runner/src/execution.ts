import { createHash } from "node:crypto";

import {
  executionTaskV1Schema,
  type ExecutionFailureV1,
  type ExecutionItemSubmissionV1,
} from "@oddpath/qa-execution-contract";

import {
  buildPublicManifest,
  type RunnerProfileConfig,
} from "./config.js";
import {
  OddpathApiError,
  type ClaimedExecution,
  type ExecutionLease,
  type OddpathClient,
} from "./http-client.js";
import {
  executeRecipeItem,
  type RecipeItemExecutionResult,
  type SemanticBrowserSession,
} from "./interpreter.js";

type ExecutionClient = Pick<
  OddpathClient,
  | "accept"
  | "completeEvidenceUpload"
  | "fail"
  | "finish"
  | "heartbeat"
  | "initiateEvidenceUpload"
  | "recordItem"
  | "uploadEvidenceBytes"
>;

export interface ExecutionLogger {
  error(message: string): void;
  info(message: string): void;
  warn(message: string): void;
}

export interface ExecuteClaimOptions {
  allowProduction: boolean;
  client: ExecutionClient;
  createSession: (profile: RunnerProfileConfig) => Promise<SemanticBrowserSession>;
  heartbeatIntervalMs?: number;
  logger?: ExecutionLogger;
  now?: () => Date;
  profiles: RunnerProfileConfig[];
}

export async function executeClaim(
  claimed: ClaimedExecution,
  {
    allowProduction,
    client,
    createSession,
    heartbeatIntervalMs = 12_000,
    logger = console,
    now = () => new Date(),
    profiles,
  }: ExecuteClaimOptions
) {
  const lease: ExecutionLease = {
    claimId: claimed.claim.claimId,
    leaseToken: claimed.claim.leaseToken,
  };
  let heartbeat: LeaseHeartbeat | undefined;
  let session: SemanticBrowserSession | undefined;

  try {
    const task = validateClaim(claimed, profiles, now());
    const profile = requireProfile(profiles, task.profile.profileKey);
    if (profile.environmentKind === "PRODUCTION" && !allowProduction) {
      throw new RunnerExecutionError(
        "PRODUCTION_NOT_ALLOWED",
        "This runner was not started with explicit production permission."
      );
    }

    const accepted = await client.accept(task.executionId, lease);
    let runVersion = accepted.runVersion;
    heartbeat = new LeaseHeartbeat({
      client,
      executionId: task.executionId,
      initialLeaseExpiresAt: claimed.claim.leaseExpiresAt,
      intervalMs: heartbeatIntervalMs,
      lease,
      now,
    });
    heartbeat.start();
    session = await createSession(profile);
    logger.info(`Executing Oddpath run ${task.runId} with profile ${profile.key}.`);

    const recipeItems = new Map(
      task.recipe.bundle.items.map((item) => [item.checklistItemId, item])
    );
    for (const checklistItem of task.artifact.items) {
      heartbeat.assertActive();
      assertBeforeDeadline(task.deadlineAt, now());
      const recipeItem = recipeItems.get(checklistItem.id);
      if (!recipeItem) {
        throw new RunnerExecutionError(
          "RUNNER_TASK_INVALID",
          "The execution recipe does not cover the selected checklist."
        );
      }
      const result = await executeRecipeItem({
        assertActive: () => {
          heartbeat?.assertActive();
          assertBeforeDeadline(task.deadlineAt, now());
        },
        item: recipeItem,
        profile,
        session,
      });
      const evidence = await buildEvidence({
        checklistItem,
        claimed,
        client,
        lease,
        profile,
        result,
        session,
      });
      heartbeat.assertActive();
      const submission: ExecutionItemSubmissionV1 = {
        evidence,
        expectedRunVersion: runVersion,
        notes: result.notes,
        observedResult: result.observedResult,
        status: result.status,
      };
      const receipt = await client.recordItem(
        task.executionId,
        checklistItem.id,
        lease,
        submission,
        idempotencyKey(lease.claimId, "item", checklistItem.id)
      );
      runVersion = receipt.runVersion;
      logger.info(`Recorded ${result.status} for checklist item ${checklistItem.id}.`);
    }

    heartbeat.assertActive();
    const receipt = await client.finish(
      task.executionId,
      lease,
      { expectedRunVersion: runVersion },
      idempotencyKey(lease.claimId, "finish", task.runId)
    );
    logger.info(`Oddpath run ${task.runId} finished with request phase ${receipt.requestPhase}.`);
    return receipt;
  } catch (error) {
    if (error instanceof LeaseLostError) {
      logger.warn(`Execution ${claimed.claim.executionId} stopped because its lease was lost.`);
      return null;
    }
    const failure = toExecutionFailure(error);
    logger.error(`Execution ${claimed.claim.executionId} failed with ${failure.code}.`);
    try {
      return await client.fail(
        claimed.claim.executionId,
        lease,
        failure,
        idempotencyKey(lease.claimId, "fail", failure.code)
      );
    } catch (reportError) {
      if (isLeaseLost(reportError)) {
        logger.warn(`Execution ${claimed.claim.executionId} could not report failure after its lease was lost.`);
        return null;
      }
      throw reportError;
    }
  } finally {
    await session?.close().catch(() => {});
    await heartbeat?.stop();
  }
}

async function buildEvidence(input: {
  checklistItem: ClaimedExecution["task"]["artifact"]["items"][number];
  claimed: ClaimedExecution;
  client: ExecutionClient;
  lease: ExecutionLease;
  profile: RunnerProfileConfig;
  result: RecipeItemExecutionResult;
  session: SemanticBrowserSession;
}): Promise<ExecutionItemSubmissionV1["evidence"]> {
  const supported = new Set(buildPublicManifest(input.profile).evidenceKinds);
  const evidence: ExecutionItemSubmissionV1["evidence"] = [];
  const requirements = input.checklistItem.evidenceRequirements.filter(
    ({ kind }) => supported.has(kind)
  );
  let screenshot: Uint8Array | undefined;

  for (const requirement of requirements) {
    if (requirement.kind === "TEXT") {
      evidence.push({
        kind: "TEXT",
        requirementId: requirement.id,
        textContent: formatTextEvidence(input.checklistItem.title, input.result),
      });
      continue;
    }
    screenshot ||= await input.session.screenshot();
    const assetId = await uploadScreenshot({
      bytes: screenshot,
      checklistItemId: input.checklistItem.id,
      claimed: input.claimed,
      client: input.client,
      lease: input.lease,
      requirementId: requirement.id,
    });
    evidence.push({ assetId, kind: "SCREENSHOT", requirementId: requirement.id });
  }

  if (evidence.length === 0 && supported.has("TEXT")) {
    evidence.push({
      kind: "TEXT",
      requirementId: null,
      textContent: formatTextEvidence(input.checklistItem.title, input.result),
    });
  }
  if (evidence.length === 0) {
    throw new RunnerExecutionError(
      "RUNNER_EVIDENCE_UNSUPPORTED",
      "The runner cannot produce evidence for one or more checklist items."
    );
  }
  return evidence;
}

async function uploadScreenshot(input: {
  bytes: Uint8Array;
  checklistItemId: string;
  claimed: ClaimedExecution;
  client: ExecutionClient;
  lease: ExecutionLease;
  requirementId: string;
}) {
  const checksumSha256 = createHash("sha256").update(input.bytes).digest("base64");
  const keyMaterial = `${input.checklistItemId}:${input.requirementId}:${checksumSha256}`;
  const initiation = await input.client.initiateEvidenceUpload(
    input.claimed.task.executionId,
    input.lease,
    {
      checklistItemId: input.checklistItemId,
      checksumSha256,
      declaredMimeType: "image/png",
      expectedSizeBytes: input.bytes.byteLength,
      originalName: screenshotName(input.claimed.task.executionId, input.requirementId),
      requirementId: input.requirementId,
    },
    idempotencyKey(input.lease.claimId, "upload-init", keyMaterial)
  );
  await input.client.uploadEvidenceBytes(initiation, input.bytes);
  await input.client.completeEvidenceUpload(
    input.claimed.task.executionId,
    initiation.asset.id,
    input.lease,
    checksumSha256,
    idempotencyKey(input.lease.claimId, "upload-complete", initiation.asset.id)
  );
  return initiation.asset.id;
}

function validateClaim(
  claimed: ClaimedExecution,
  profiles: RunnerProfileConfig[],
  now: Date
) {
  const task = executionTaskV1Schema.parse(claimed.task);
  if (
    claimed.claim.executionId !== task.executionId
    || claimed.claim.artifactId !== task.artifact.id
    || claimed.claim.artifactRevision !== task.artifact.revision
    || claimed.claim.recipeHash !== task.recipe.hash
  ) {
    throw new RunnerExecutionError(
      "RUNNER_TASK_INVALID",
      "The execution claim does not match its immutable task."
    );
  }
  const profile = requireProfile(profiles, task.profile.profileKey);
  const localManifest = buildPublicManifest(profile);
  if (localManifest.manifestHash !== task.profile.manifestHash) {
    throw new RunnerExecutionError(
      "RUNNER_PROFILE_CHANGED",
      "The local runner profile changed after execution approval."
    );
  }
  assertBeforeDeadline(task.deadlineAt, now);
  return task;
}

function requireProfile(profiles: RunnerProfileConfig[], profileKey: string) {
  const profile = profiles.find(({ key }) => key === profileKey);
  if (!profile) {
    throw new RunnerExecutionError(
      "RUNNER_PROFILE_NOT_FOUND",
      "The approved runner profile is not configured locally."
    );
  }
  return profile;
}

function assertBeforeDeadline(deadlineAt: string, now: Date) {
  if (new Date(deadlineAt).getTime() <= now.getTime()) {
    throw new RunnerExecutionError(
      "EXECUTION_DEADLINE_EXCEEDED",
      "The execution deadline elapsed before the runner could finish."
    );
  }
}

function formatTextEvidence(title: string, result: RecipeItemExecutionResult) {
  const completed = result.completedStepRefs.length;
  const suffix = result.failedStepRef
    ? ` The first incomplete step was ${result.failedStepRef}.`
    : " All declared steps completed.";
  return `${title}: ${result.status}. ${completed} step(s) completed.${suffix}`;
}

function screenshotName(executionId: string, requirementId: string) {
  const safe = `${executionId}-${requirementId}`
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .slice(0, 140);
  return `oddpath-${safe || "evidence"}.png`;
}

export function idempotencyKey(claimId: string, operation: string, material: string) {
  const digest = createHash("sha256")
    .update(`${claimId}\u0000${operation}\u0000${material}`)
    .digest("hex")
    .slice(0, 40);
  return `odp.runner.${operation}.${digest}`;
}

class RunnerExecutionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RunnerExecutionError";
  }
}

class LeaseLostError extends Error {
  constructor() {
    super("The execution lease was lost.");
    this.name = "LeaseLostError";
  }
}

class LeaseHeartbeat {
  readonly #client: Pick<OddpathClient, "heartbeat">;
  readonly #controller = new AbortController();
  readonly #executionId: string;
  readonly #intervalMs: number;
  readonly #lease: ExecutionLease;
  readonly #now: () => Date;
  #failure: Error | null = null;
  #leaseExpiresAt: number;
  #loop: Promise<void> | null = null;

  constructor(input: {
    client: Pick<OddpathClient, "heartbeat">;
    executionId: string;
    initialLeaseExpiresAt: string;
    intervalMs: number;
    lease: ExecutionLease;
    now: () => Date;
  }) {
    this.#client = input.client;
    this.#executionId = input.executionId;
    this.#intervalMs = input.intervalMs;
    this.#lease = input.lease;
    this.#leaseExpiresAt = new Date(input.initialLeaseExpiresAt).getTime();
    this.#now = input.now;
  }

  start() {
    this.#loop ||= this.#run();
  }

  assertActive() {
    if (this.#failure) throw this.#failure;
    if (this.#now().getTime() >= this.#leaseExpiresAt) throw new LeaseLostError();
  }

  async stop() {
    this.#controller.abort();
    await this.#loop;
  }

  async #run() {
    while (!this.#controller.signal.aborted) {
      const continued = await abortableDelay(this.#intervalMs, this.#controller.signal);
      if (!continued) return;
      try {
        const receipt = await this.#client.heartbeat(this.#executionId, this.#lease);
        if (!receipt.leaseExpiresAt) throw new LeaseLostError();
        this.#leaseExpiresAt = new Date(receipt.leaseExpiresAt).getTime();
      } catch (error) {
        if (isLeaseLost(error) || this.#now().getTime() >= this.#leaseExpiresAt) {
          this.#failure = new LeaseLostError();
          return;
        }
        // A transient heartbeat failure is retried quickly while the known lease remains valid.
        const continuedAfterFailure = await abortableDelay(1_000, this.#controller.signal);
        if (!continuedAfterFailure) return;
      }
    }
  }
}

function isLeaseLost(error: unknown) {
  return error instanceof LeaseLostError
    || (error instanceof OddpathApiError
      && ["QA_EXECUTION_LEASE_LOST", "QA_EXECUTION_NOT_FOUND"].includes(error.code));
}

function toExecutionFailure(error: unknown): ExecutionFailureV1 {
  if (error instanceof RunnerExecutionError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof OddpathApiError) {
    return {
      code: "RUNNER_PROTOCOL_ERROR",
      message: "The local runner could not complete the Oddpath protocol exchange.",
    };
  }
  return {
    code: "RUNNER_EXECUTION_FAILED",
    message: "The local runner could not complete this execution.",
  };
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, milliseconds);
    function onAbort() {
      clearTimeout(timer);
      resolve(false);
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
