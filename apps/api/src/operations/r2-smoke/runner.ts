import { createHash, randomUUID } from "node:crypto";

import { isExplicitHttpsOrigin } from "../../config/env/checks.js";
import {
  R2_MUTATION_SMOKE_CONFIRMATION,
  R2SmokeError,
  R2SmokeProbeError,
  type R2MutationSmokeOptions,
  type R2SmokeCheckResult,
  type R2SmokeReport,
} from "./types.js";

const CONTENT_TYPE = "application/octet-stream";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;
const PRESIGNED_URL_TTL_SECONDS = 300;
const RANGE_BYTES = 16;
const CLEANUP_ATTEMPTS = 3;
const SMOKE_KEY_PREFIX = "oddpath-smoke/r2-v1/";
const CORS_REQUEST_HEADERS = [
  "content-type",
  "if-none-match",
  "x-amz-checksum-sha256",
] as const;

export async function runR2MutationSmoke(
  options: R2MutationSmokeOptions
): Promise<R2SmokeReport> {
  assertOptions(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const context = new R2SmokeContext(
    options.now ?? Date.now,
    timeoutMs
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const createRandomId = options.randomId ?? randomUUID;
  const runId = createRandomId();
  const payloadId = createRandomId();
  if (!isUuidV4(runId) || !isUuidV4(payloadId) || runId === payloadId) {
    throw configurationFailure();
  }

  const objectKey = `${SMOKE_KEY_PREFIX}${runId}.bin`;
  const bytes = new TextEncoder().encode(`oddpath-r2-smoke-v1:${payloadId}`);
  const checksumSha256 = createHash("sha256").update(bytes).digest("base64");
  const rangeEnd = Math.min(RANGE_BYTES, bytes.byteLength) - 1;
  let primaryFailure: unknown;
  let hasPrimaryFailure = false;
  let putAttempted = false;

  try {
    const upload = await context.check("upload_presign", async () => {
      const signedRequest = await options.gateway.createUploadUrl({
        checksumSha256,
        contentLength: bytes.byteLength,
        contentType: CONTENT_TYPE,
        expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
        objectKey,
      });
      assertSignedUrl(signedRequest.url);
      assertUploadHeaders(
        signedRequest.headers,
        bytes.byteLength,
        checksumSha256
      );
      return signedRequest;
    });

    await context.check("cors_preflight", async (signal) => {
      const response = await request(
        fetchImpl,
        upload.url,
        {
          headers: {
            "access-control-request-headers": CORS_REQUEST_HEADERS.join(","),
            "access-control-request-method": "PUT",
            origin: options.corsOrigin,
          },
          method: "OPTIONS",
        },
        signal
      );
      try {
        assertExpectedStatus(response, [200, 204]);
        assertCors(response, options.corsOrigin);
        assertCorsPreflight(response);
      } finally {
        await cancelBody(response);
      }
    });

    await context.check("conditional_presigned_put", async (signal) => {
      const headers = new Headers(upload.headers);
      headers.set("origin", options.corsOrigin);
      putAttempted = true;
      const response = await request(
        fetchImpl,
        upload.url,
        { body: bytes, headers, method: "PUT" },
        signal
      );
      try {
        assertExpectedStatus(response, [200, 201]);
        assertCors(response, options.corsOrigin);
        assertExposedHeader(response, "etag");
      } finally {
        await cancelBody(response);
      }
    });

    await context.check("conditional_replay_rejected", async (signal) => {
      const headers = new Headers(upload.headers);
      headers.set("origin", options.corsOrigin);
      const response = await request(
        fetchImpl,
        upload.url,
        { body: bytes, headers, method: "PUT" },
        signal
      );
      try {
        assertExpectedStatus(response, [409, 412]);
        assertCors(response, options.corsOrigin);
      } finally {
        await cancelBody(response);
      }
    });

    await context.check("head_integrity", async (signal) => {
      const metadata = await options.gateway.inspectObject(objectKey, signal);
      if (
        !metadata ||
        metadata.checksumSha256 !== checksumSha256 ||
        metadata.contentLength !== bytes.byteLength ||
        metadata.contentType !== CONTENT_TYPE
      ) {
        throw new R2SmokeProbeError("integrity_failed");
      }
    });

    await context.check("sdk_bounded_range_get", async (signal) => {
      const result = await options.gateway.getObjectRange(
        objectKey,
        0,
        rangeEnd,
        RANGE_BYTES,
        signal
      );
      assertRangeResult(result, bytes, rangeEnd);
    });

    const downloadUrl = await context.check("download_presign", async () => {
      const signedUrl = await options.gateway.createDownloadUrl(
        objectKey,
        PRESIGNED_URL_TTL_SECONDS
      );
      assertSignedUrl(signedUrl);
      return signedUrl;
    });

    await context.check("presigned_get", async (signal) => {
      const response = await request(
        fetchImpl,
        downloadUrl,
        { headers: { origin: options.corsOrigin }, method: "GET" },
        signal
      );
      try {
        assertExpectedStatus(response, [200]);
        assertCors(response, options.corsOrigin);
        assertExactHeaderNumber(response, "content-length", bytes.byteLength);
        if (response.headers.get("content-type") !== CONTENT_TYPE) {
          throw new R2SmokeProbeError("integrity_failed");
        }
        const downloaded = await readResponseBodyBounded(
          response,
          bytes.byteLength
        );
        if (!bytesEqual(downloaded, bytes)) {
          throw new R2SmokeProbeError("integrity_failed");
        }
      } catch (error) {
        await cancelBody(response);
        throw error;
      }
    });

    await context.check("presigned_range_get", async (signal) => {
      const response = await request(
        fetchImpl,
        downloadUrl,
        {
          headers: {
            origin: options.corsOrigin,
            range: `bytes=0-${rangeEnd}`,
          },
          method: "GET",
        },
        signal
      );
      try {
        assertExpectedStatus(response, [206]);
        assertCors(response, options.corsOrigin);
        assertExactHeaderNumber(response, "content-length", rangeEnd + 1);
        if (
          response.headers.get("content-range") !==
          `bytes 0-${rangeEnd}/${bytes.byteLength}`
        ) {
          throw new R2SmokeProbeError("integrity_failed");
        }
        const downloaded = await readResponseBodyBounded(
          response,
          rangeEnd + 1
        );
        if (!bytesEqual(downloaded, bytes.subarray(0, rangeEnd + 1))) {
          throw new R2SmokeProbeError("integrity_failed");
        }
      } catch (error) {
        await cancelBody(response);
        throw error;
      }
    });

    await context.check("unsigned_get_rejected", async (signal) => {
      const unsignedUrl = stripSignature(downloadUrl);
      const response = await request(
        fetchImpl,
        unsignedUrl,
        { headers: { origin: options.corsOrigin }, method: "GET" },
        signal
      );
      try {
        if (![401, 403].includes(response.status)) {
          throw new R2SmokeProbeError("authorization_failed");
        }
      } finally {
        await cancelBody(response);
      }
    });
  } catch (error) {
    primaryFailure = error;
    hasPrimaryFailure = true;
  }

  try {
    await context.check("object_cleanup", async (signal) => {
      if (!putAttempted) return;
      try {
        const existing = await options.gateway.inspectObject(objectKey, signal);
        if (
          existing &&
          (existing.checksumSha256 !== checksumSha256 ||
            existing.contentLength !== bytes.byteLength ||
            existing.contentType !== CONTENT_TYPE)
        ) {
          // Never delete an object unless it has this run's independently
          // randomized payload identity. A key collision therefore fails safe.
          throw new Error("Cleanup target identity did not match this run.");
        }
        await retryDelete(options, objectKey, signal);
        if ((await options.gateway.inspectObject(objectKey, signal)) !== null) {
          throw new Error("Object remained after cleanup.");
        }

        // A second delete and absence check prove that the cleanup target is
        // exact and that provider-side deletion is idempotent.
        await retryDelete(options, objectKey, signal);
        if ((await options.gateway.inspectObject(objectKey, signal)) !== null) {
          throw new Error("Object reappeared after idempotent cleanup.");
        }
      } catch {
        throw new R2SmokeProbeError("cleanup_failed");
      }
    });
  } catch (cleanupFailure) {
    throw cleanupFailure;
  }

  if (hasPrimaryFailure) throw primaryFailure;
  return context.report();
}

class R2SmokeContext {
  private readonly checks: R2SmokeCheckResult[] = [];

  constructor(
    private readonly now: () => number,
    private readonly timeoutMs: number
  ) {}

  async check<T>(
    name: string,
    action: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const startedAt = this.now();
    try {
      const result = await withTimeout(action, this.timeoutMs);
      const duration = this.now() - startedAt;
      this.checks.push({
        durationMs: Number.isFinite(duration)
          ? Math.max(0, Math.round(duration))
          : 0,
        name,
      });
      return result;
    } catch (error) {
      if (error instanceof R2SmokeError) throw error;
      const reason = error instanceof R2SmokeProbeError
        ? error.reason
        : "provider_error";
      throw new R2SmokeError(name, reason);
    }
  }

  report(): R2SmokeReport {
    return {
      checks: [...this.checks],
      mode: "eu-r2-mutation",
      status: "passed",
    };
  }
}

async function retryDelete(
  options: R2MutationSmokeOptions,
  objectKey: string,
  signal: AbortSignal
) {
  let latestError: unknown;
  for (let attempt = 0; attempt < CLEANUP_ATTEMPTS; attempt += 1) {
    try {
      await options.gateway.deleteObject(objectKey, signal);
      return;
    } catch (error) {
      latestError = error;
      if (signal.aborted) throw error;
    }
  }
  throw latestError;
}

function assertOptions(options: R2MutationSmokeOptions) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    options.confirmation !== R2_MUTATION_SMOKE_CONFIRMATION ||
    !isExplicitHttpsOrigin(options.corsOrigin) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw configurationFailure();
  }
}

function assertSignedUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      !parsed.search
    ) {
      throw configurationFailure();
    }
  } catch (error) {
    if (error instanceof R2SmokeError) throw error;
    throw new R2SmokeProbeError("invalid_response");
  }
}

function assertUploadHeaders(
  headers: Readonly<Record<string, string>>,
  contentLength: number,
  checksumSha256: string
) {
  if (
    headers["content-length"] !== String(contentLength) ||
    headers["content-type"] !== CONTENT_TYPE ||
    headers["if-none-match"] !== "*" ||
    headers["x-amz-checksum-sha256"] !== checksumSha256
  ) {
    throw new R2SmokeProbeError("invalid_response");
  }
}

function assertRangeResult(
  result: {
    bytes: Uint8Array;
    contentLength: number;
    contentRange: string | null;
    contentType: string | null;
  },
  source: Uint8Array,
  rangeEnd: number
) {
  if (
    result.contentLength !== rangeEnd + 1 ||
    result.contentRange !== `bytes 0-${rangeEnd}/${source.byteLength}` ||
    result.contentType !== CONTENT_TYPE ||
    !bytesEqual(result.bytes, source.subarray(0, rangeEnd + 1))
  ) {
    throw new R2SmokeProbeError("integrity_failed");
  }
}

async function request(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal
) {
  try {
    return await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal,
    });
  } catch {
    throw new R2SmokeProbeError(signal.aborted ? "timeout" : "network_error");
  }
}

function assertExpectedStatus(response: Response, expected: readonly number[]) {
  if (!expected.includes(response.status)) {
    throw new R2SmokeProbeError("unexpected_status");
  }
}

function assertCors(response: Response, expectedOrigin: string) {
  if (response.headers.get("access-control-allow-origin") !== expectedOrigin) {
    throw new R2SmokeProbeError("cors_failed");
  }
}

function assertCorsPreflight(response: Response) {
  const methods = parseHeaderTokens(response.headers.get("access-control-allow-methods"));
  const headers = parseHeaderTokens(response.headers.get("access-control-allow-headers"));
  if (
    !methods.has("put") ||
    (![...CORS_REQUEST_HEADERS].every((header) => headers.has(header)) &&
      !headers.has("*"))
  ) {
    throw new R2SmokeProbeError("cors_failed");
  }
}

function assertExposedHeader(response: Response, expectedHeader: string) {
  const exposed = parseHeaderTokens(
    response.headers.get("access-control-expose-headers")
  );
  if (!exposed.has(expectedHeader.toLowerCase()) && !exposed.has("*")) {
    throw new R2SmokeProbeError("cors_failed");
  }
}

function parseHeaderTokens(value: string | null) {
  return new Set(
    (value || "")
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean)
  );
}

function assertExactHeaderNumber(
  response: Response,
  name: string,
  expected: number
) {
  const value = response.headers.get(name);
  if (!value || !/^\d+$/.test(value) || Number(value) !== expected) {
    throw new R2SmokeProbeError("integrity_failed");
  }
}

async function readResponseBodyBounded(response: Response, maximumBytes: number) {
  if (!response.body) throw new R2SmokeProbeError("invalid_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new R2SmokeProbeError("integrity_failed");
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function cancelBody(response: Response) {
  if (response.body) await response.body.cancel().catch(() => undefined);
}

function stripSignature(signedUrl: string) {
  try {
    const parsed = new URL(signedUrl);
    if (!parsed.search) throw new Error("Missing signature.");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    throw new R2SmokeProbeError("invalid_response");
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

function isUuidV4(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function configurationFailure() {
  return new R2SmokeError("configuration", "invalid_configuration");
}

function withTimeout<T>(
  action: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new R2SmokeProbeError("timeout"));
    }, timeoutMs);

    Promise.resolve()
      .then(() => action(controller.signal))
      .then(
        (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        (error: unknown) => {
          clearTimeout(timeout);
          reject(error);
        }
      );
  });
}
