import {
  executionClaimReceiptV1Schema,
  executionClaimResponseV1Schema,
  executionReceiptV1Schema,
  executionTaskV1Schema,
  runnerRegistrationReceiptV1Schema,
  type ExecutionClaimRequestV1,
  type ExecutionFailureV1,
  type ExecutionFinishV1,
  type ExecutionItemSubmissionV1,
  type ExecutionReceiptV1,
  type ExecutionTaskV1,
  type RunnerRegistrationV1,
  type RunnerRegistrationReceiptV1,
} from "@oddpath/qa-execution-contract";
import { z, type ZodType } from "zod";

const errorResponseSchema = z.object({
  code: z.string().optional(),
  error: z.string().optional(),
}).passthrough();

const receiptResponseSchema = z.object({ receipt: executionReceiptV1Schema }).strict();

const uploadAssetSchema = z.object({ id: z.string().trim().min(1).max(120) }).passthrough();
const uploadInitiationSchema = z.object({
  asset: uploadAssetSchema,
  upload: z.object({
    expiresAt: z.string().datetime({ offset: true }),
    headers: z.record(z.string()),
    method: z.literal("PUT"),
    url: z.string().url(),
  }).strict(),
}).strict();
const uploadCompletionSchema = z.object({ asset: uploadAssetSchema }).strict();

export interface ExecutionLease {
  claimId: string;
  leaseToken: string;
}

export interface ClaimedExecution {
  claim: z.infer<typeof executionClaimReceiptV1Schema>;
  task: ExecutionTaskV1;
}

export interface EvidenceUploadInput {
  checklistItemId: string;
  checksumSha256: string;
  declaredMimeType: "image/jpeg" | "image/png" | "image/webp";
  expectedSizeBytes: number;
  originalName: string;
  requirementId: string;
}

export type EvidenceUploadInitiation = z.infer<typeof uploadInitiationSchema>;

export class OddpathApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status: number, code = "ODDPATH_API_ERROR") {
    super(message);
    this.name = "OddpathApiError";
    this.code = code;
    this.status = status;
  }
}

export interface OddpathClientOptions {
  delay?: (milliseconds: number) => Promise<void>;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
  serverUrl: string;
  token: string;
}

export class OddpathClient {
  readonly #delay: (milliseconds: number) => Promise<void>;
  readonly #fetch: typeof fetch;
  readonly #requestTimeoutMs: number;
  readonly #serverOrigin: string;
  readonly #token: string;

  constructor({
    delay = defaultDelay,
    fetch: fetchImplementation = fetch,
    requestTimeoutMs = 15_000,
    serverUrl,
    token,
  }: OddpathClientOptions) {
    this.#delay = delay;
    this.#fetch = fetchImplementation;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#serverOrigin = new URL(serverUrl).origin;
    this.#token = token;
  }

  register(input: RunnerRegistrationV1): Promise<RunnerRegistrationReceiptV1> {
    return this.#request("/api/integrations/v1/runner/v1/registration", {
      body: input,
      method: "PUT",
      retry: "safe",
      schema: runnerRegistrationReceiptV1Schema,
    });
  }

  async claim(input: ExecutionClaimRequestV1): Promise<ClaimedExecution | null> {
    const response = await this.#request("/api/integrations/v1/runner/v1/executions/claim", {
      body: input,
      method: "POST",
      retry: "none",
      schema: executionClaimResponseV1Schema,
    });
    return response.claim === null
      ? null
      : { claim: response.claim, task: executionTaskV1Schema.parse(response.task) };
  }

  async accept(executionId: string, lease: ExecutionLease) {
    const response = await this.#request(executionPath(executionId, "accept"), {
      lease,
      method: "POST",
      retry: "safe",
      schema: receiptResponseSchema,
    });
    return response.receipt;
  }

  async heartbeat(executionId: string, lease: ExecutionLease) {
    const response = await this.#request(executionPath(executionId, "heartbeat"), {
      lease,
      method: "POST",
      retry: "safe",
      schema: receiptResponseSchema,
    });
    return response.receipt;
  }

  async recordItem(
    executionId: string,
    checklistItemId: string,
    lease: ExecutionLease,
    input: ExecutionItemSubmissionV1,
    idempotencyKey: string
  ): Promise<ExecutionReceiptV1> {
    const response = await this.#request(
      `/api/integrations/v1/runner/v1/executions/${pathSegment(executionId)}/items/${pathSegment(checklistItemId)}`,
      {
        body: input,
        idempotencyKey,
        lease,
        method: "PUT",
        retry: "safe",
        schema: receiptResponseSchema,
      }
    );
    return response.receipt;
  }

  async finish(
    executionId: string,
    lease: ExecutionLease,
    input: ExecutionFinishV1,
    idempotencyKey: string
  ): Promise<ExecutionReceiptV1> {
    const response = await this.#request(executionPath(executionId, "finish"), {
      body: input,
      idempotencyKey,
      lease,
      method: "POST",
      retry: "safe",
      schema: receiptResponseSchema,
    });
    return response.receipt;
  }

  async fail(
    executionId: string,
    lease: ExecutionLease,
    input: ExecutionFailureV1,
    idempotencyKey: string
  ): Promise<ExecutionReceiptV1> {
    const response = await this.#request(executionPath(executionId, "fail"), {
      body: input,
      idempotencyKey,
      lease,
      method: "POST",
      retry: "safe",
      schema: receiptResponseSchema,
    });
    return response.receipt;
  }

  initiateEvidenceUpload(
    executionId: string,
    lease: ExecutionLease,
    input: EvidenceUploadInput,
    idempotencyKey: string
  ) {
    return this.#request(executionPath(executionId, "evidence/uploads"), {
      body: input,
      idempotencyKey,
      lease,
      method: "POST",
      retry: "safe",
      schema: uploadInitiationSchema,
    });
  }

  completeEvidenceUpload(
    executionId: string,
    assetId: string,
    lease: ExecutionLease,
    checksumSha256: string,
    idempotencyKey: string
  ) {
    return this.#request(
      executionPath(executionId, `evidence/uploads/${pathSegment(assetId)}/complete`),
      {
        body: { checksumSha256 },
        idempotencyKey,
        lease,
        method: "POST",
        retry: "safe",
        schema: uploadCompletionSchema,
      }
    );
  }

  async uploadEvidenceBytes(initiation: EvidenceUploadInitiation, bytes: Uint8Array) {
    const target = new URL(initiation.upload.url);
    if (
      !["http:", "https:"].includes(target.protocol)
      || target.username
      || target.password
    ) {
      throw new OddpathApiError("The evidence upload URL is not HTTP(S).", 0, "UPLOAD_URL_INVALID");
    }
    const headers = new Headers(initiation.upload.headers);
    for (const sensitiveHeader of [
      "authorization",
      "cookie",
      "idempotency-key",
      "proxy-authorization",
      "x-oddpath-claim-id",
      "x-oddpath-execution-lease",
    ]) {
      headers.delete(sensitiveHeader);
    }
    const response = await this.#fetchWithTimeout(target, {
      body: Buffer.from(bytes),
      headers,
      method: "PUT",
    });
    if (!response.ok) {
      throw new OddpathApiError(
        `Evidence upload failed with HTTP ${response.status}.`,
        response.status,
        "EVIDENCE_UPLOAD_FAILED"
      );
    }
  }

  async #request<T>(
    path: string,
    options: {
      body?: unknown;
      idempotencyKey?: string;
      lease?: ExecutionLease;
      method: "POST" | "PUT";
      retry: "none" | "safe";
      schema: ZodType<T>;
    }
  ): Promise<T> {
    const attempts = options.retry === "safe" ? 4 : 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const headers = new Headers({
          accept: "application/json",
          authorization: `Bearer ${this.#token}`,
        });
        if (options.body !== undefined) headers.set("content-type", "application/json");
        if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);
        if (options.lease) {
          headers.set("x-oddpath-claim-id", options.lease.claimId);
          headers.set("x-oddpath-execution-lease", options.lease.leaseToken);
        }
        const response = await this.#fetchWithTimeout(new URL(path, this.#serverOrigin), {
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          headers,
          method: options.method,
        });
        const payload = await readJson(response);
        if (!response.ok) {
          const parsedError = errorResponseSchema.safeParse(payload);
          const error = new OddpathApiError(
            parsedError.success && parsedError.data.error
              ? parsedError.data.error
              : `Oddpath returned HTTP ${response.status}.`,
            response.status,
            parsedError.success && parsedError.data.code
              ? parsedError.data.code
              : "ODDPATH_API_ERROR"
          );
          if (attempt + 1 < attempts && isRetryableResponse(error)) {
            lastError = error;
            await this.#delay(retryDelay(attempt));
            continue;
          }
          throw error;
        }
        const parsed = options.schema.safeParse(payload);
        if (!parsed.success) {
          throw new OddpathApiError(
            "Oddpath returned an invalid protocol response.",
            response.status,
            "ODDPATH_PROTOCOL_INVALID"
          );
        }
        return parsed.data;
      } catch (error) {
        if (error instanceof OddpathApiError) throw error;
        lastError = error;
        if (attempt + 1 >= attempts) break;
        await this.#delay(retryDelay(attempt));
      }
    }
    throw new OddpathApiError(
      lastError instanceof Error ? `Oddpath could not be reached: ${lastError.message}` : "Oddpath could not be reached.",
      0,
      "ODDPATH_UNREACHABLE"
    );
  }

  async #fetchWithTimeout(input: URL, init: RequestInit) {
    const signal = AbortSignal.timeout(this.#requestTimeoutMs);
    return this.#fetch(input, { ...init, signal });
  }
}

function executionPath(executionId: string, suffix: string) {
  return `/api/integrations/v1/runner/v1/executions/${pathSegment(executionId)}/${suffix}`;
}

function pathSegment(value: string) {
  return encodeURIComponent(value);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new OddpathApiError(
      "Oddpath returned a non-JSON protocol response.",
      response.status,
      "ODDPATH_PROTOCOL_INVALID"
    );
  }
}

function isRetryableResponse(error: OddpathApiError) {
  return [429, 502, 503, 504].includes(error.status)
    || (error.status === 409 && error.code === "IDEMPOTENCY_IN_PROGRESS");
}

function retryDelay(attempt: number) {
  return Math.min(2_000, 200 * (2 ** attempt));
}

function defaultDelay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
