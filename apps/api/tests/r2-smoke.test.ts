import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createR2SmokeFailureEvent,
  loadR2SmokeCliConfig,
  R2_MUTATION_SMOKE_CONFIRMATION,
  R2SmokeError,
  runR2MutationSmoke,
  type R2SmokeGateway,
} from "../src/operations/r2-smoke/index.ts";

const CORS_ORIGIN = "https://oddpath.eluthira.com";
const EU_ENDPOINT = `https://${"a".repeat(32)}.eu.r2.cloudflarestorage.com`;
const FIXED_UUID = "00000000-0000-4000-8000-000000000001";
const FIXED_PAYLOAD_UUID = "00000000-0000-4000-8000-000000000002";
const CONTENT_TYPE = "application/octet-stream";

describe("R2 smoke configuration", () => {
  it("requires exact destructive opt-in, complete credentials, and an EU endpoint", () => {
    const source = validConfigSource();
    const config = loadR2SmokeCliConfig(["--mode=eu-r2-mutation"], source);

    assert.deepEqual(config, {
      accessKeyId: "test-access-key",
      bucketName: "oddpath-private-staging",
      confirmation: R2_MUTATION_SMOKE_CONFIRMATION,
      corsOrigin: CORS_ORIGIN,
      endpoint: EU_ENDPOINT,
      mode: "eu-r2-mutation",
      region: "auto",
      secretAccessKey: "test-secret-key",
      timeoutMs: 15_000,
    });

    for (const [args, override] of [
      [[], {}],
      [["--mode=eu-r2-mutation"], { ODDPATH_R2_SMOKE_CONFIRMATION: "" }],
      [["--mode=other"], {}],
      [["--mode=eu-r2-mutation"], { R2_SECRET_ACCESS_KEY: "" }],
      [
        ["--mode=eu-r2-mutation"],
        { R2_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com` },
      ],
      [["--mode=eu-r2-mutation"], { R2_REGION: "eu" }],
      [["--mode=eu-r2-mutation"], { ODDPATH_R2_SMOKE_CORS_ORIGIN: "http://oddpath.eluthira.com" }],
    ] as const) {
      assert.throws(
        () => loadR2SmokeCliConfig(args, { ...source, ...override }),
        isConfigurationFailure
      );
    }
  });
});

describe("R2 mutation smoke", () => {
  it("verifies conditional writes, integrity, ranges, CORS, auth, and exact cleanup", async () => {
    const gateway = new FakeR2Gateway();
    const report = await runR2MutationSmoke({
      confirmation: R2_MUTATION_SMOKE_CONFIRMATION,
      corsOrigin: CORS_ORIGIN,
      fetchImpl: createR2Fetch(gateway),
      gateway,
      now: monotonicClock(),
      randomId: sequentialIds(),
    });

    assert.equal(report.status, "passed");
    assert.deepEqual(
      report.checks.map((check) => check.name),
      [
        "upload_presign",
        "cors_preflight",
        "conditional_presigned_put",
        "conditional_replay_rejected",
        "head_integrity",
        "sdk_bounded_range_get",
        "download_presign",
        "presigned_get",
        "presigned_range_get",
        "unsigned_get_rejected",
        "object_cleanup",
      ]
    );
    assert.equal(gateway.putRequests, 2);
    assert.equal(gateway.deleteAttempts, 2);
    assert.equal(gateway.stored, false);
    assert.ok(gateway.objectKeys.length > 0);
    assert.ok(
      gateway.objectKeys.every(
        (key) => key === `oddpath-smoke/r2-v1/${FIXED_UUID}.bin`
      )
    );

    const serialized = JSON.stringify(report);
    for (const sensitive of [
      "X-Amz-Signature",
      "signature-secret",
      FIXED_UUID,
      "oddpath-smoke",
      EU_ENDPOINT,
    ]) {
      assert.equal(serialized.includes(sensitive), false);
    }
  });

  it("bounds a hung dependency, then still performs idempotent cleanup", async () => {
    const gateway = new FakeR2Gateway();
    gateway.hangFirstPut = true;

    await assert.rejects(
      () =>
        runR2MutationSmoke({
          confirmation: R2_MUTATION_SMOKE_CONFIRMATION,
          corsOrigin: CORS_ORIGIN,
          fetchImpl: createR2Fetch(gateway),
          gateway,
          randomId: sequentialIds(),
          timeoutMs: 10,
        }),
      (error: unknown) => {
        assert.ok(error instanceof R2SmokeError);
        assert.equal(error.check, "conditional_presigned_put");
        assert.equal(error.reason, "timeout");
        return true;
      }
    );

    assert.equal(gateway.deleteAttempts, 2);
    assert.equal(gateway.stored, false);
  });

  it("retries transient cleanup failures without deleting any other key", async () => {
    const gateway = new FakeR2Gateway();
    gateway.deleteFailuresRemaining = 2;

    const report = await runR2MutationSmoke({
      confirmation: R2_MUTATION_SMOKE_CONFIRMATION,
      corsOrigin: CORS_ORIGIN,
      fetchImpl: createR2Fetch(gateway),
      gateway,
      randomId: sequentialIds(),
    });

    assert.equal(report.status, "passed");
    assert.equal(gateway.deleteAttempts, 4);
    assert.equal(gateway.stored, false);
    assert.ok(
      gateway.objectKeys.every(
        (key) => key === `oddpath-smoke/r2-v1/${FIXED_UUID}.bin`
      )
    );
  });

  it("never deletes a colliding key whose payload identity is different", async () => {
    const gateway = new FakeR2Gateway();
    gateway.stored = true;
    gateway.storedBytes = new TextEncoder().encode("foreign-smoke-payload");
    gateway.storedChecksumSha256 = "foreign-checksum";

    await assert.rejects(
      () =>
        runR2MutationSmoke({
          confirmation: R2_MUTATION_SMOKE_CONFIRMATION,
          corsOrigin: CORS_ORIGIN,
          fetchImpl: createR2Fetch(gateway),
          gateway,
          randomId: sequentialIds(),
        }),
      (error: unknown) => {
        assert.ok(error instanceof R2SmokeError);
        assert.equal(error.check, "object_cleanup");
        assert.equal(error.reason, "cleanup_failed");
        return true;
      }
    );

    assert.equal(gateway.deleteAttempts, 0);
    assert.equal(gateway.stored, true);
  });

  it("sanitizes unknown failures without serializing provider details", () => {
    const secret = "https://signed.invalid/object?X-Amz-Signature=secret-value";
    const event = createR2SmokeFailureEvent(new Error(secret));
    const serialized = JSON.stringify(event);

    assert.deepEqual(event, {
      event: "r2_smoke",
      failedCheck: "runner",
      reason: "invalid_response",
      status: "failed",
    });
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes("secret-value"), false);
  });
});

class FakeR2Gateway implements R2SmokeGateway {
  checksumSha256 = "";
  deleteAttempts = 0;
  deleteFailuresRemaining = 0;
  hangFirstPut = false;
  objectKeys: string[] = [];
  putRequests = 0;
  stored = false;
  storedBytes = new Uint8Array();
  storedChecksumSha256 = "";

  async createDownloadUrl(objectKey: string) {
    this.captureKey(objectKey);
    return "https://signed.invalid/private-object?X-Amz-Signature=signature-secret";
  }

  async createUploadUrl(input: {
    checksumSha256: string;
    contentLength: number;
    contentType: string;
    objectKey: string;
  }) {
    this.captureKey(input.objectKey);
    this.checksumSha256 = input.checksumSha256;
    return {
      headers: {
        "content-length": String(input.contentLength),
        "content-type": input.contentType,
        "if-none-match": "*",
        "x-amz-checksum-sha256": input.checksumSha256,
      },
      url: "https://signed.invalid/private-object?X-Amz-Signature=signature-secret",
    };
  }

  async deleteObject(objectKey: string) {
    this.captureKey(objectKey);
    this.deleteAttempts += 1;
    if (this.deleteFailuresRemaining > 0) {
      this.deleteFailuresRemaining -= 1;
      throw new Error("temporary provider failure with a secret");
    }
    this.stored = false;
    this.storedBytes = new Uint8Array();
  }

  async getObjectRange(
    objectKey: string,
    start: number,
    end: number
  ) {
    this.captureKey(objectKey);
    const bytes = this.storedBytes.slice(start, end + 1);
    return {
      bytes,
      contentLength: bytes.byteLength,
      contentRange: `bytes ${start}-${end}/${this.storedBytes.byteLength}`,
      contentType: CONTENT_TYPE,
    };
  }

  async inspectObject(objectKey: string) {
    this.captureKey(objectKey);
    if (!this.stored) return null;
    return {
      checksumSha256: this.storedChecksumSha256,
      contentLength: this.storedBytes.byteLength,
      contentType: CONTENT_TYPE,
    };
  }

  private captureKey(objectKey: string) {
    this.objectKeys.push(objectKey);
  }
}

function createR2Fetch(gateway: FakeR2Gateway): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method || "GET";
    const headers = new Headers(init?.headers);

    if (method === "OPTIONS") {
      return emptyResponse(204, {
        "access-control-allow-headers":
          "Content-Type, If-None-Match, x-amz-checksum-sha256",
        "access-control-allow-methods": "GET, HEAD, PUT",
        "access-control-allow-origin": CORS_ORIGIN,
      });
    }

    if (method === "PUT") {
      gateway.putRequests += 1;
      if (gateway.stored) {
        return emptyResponse(412, corsHeaders());
      }
      assert.equal(headers.get("if-none-match"), "*");
      assert.equal(headers.get("x-amz-checksum-sha256"), gateway.checksumSha256);
      assert.ok(init?.body instanceof Uint8Array);
      gateway.storedBytes = new Uint8Array(init.body);
      gateway.storedChecksumSha256 = gateway.checksumSha256;
      gateway.stored = true;
      if (gateway.hangFirstPut) {
        gateway.hangFirstPut = false;
        return new Promise<never>(() => undefined);
      }
      return emptyResponse(200, corsHeaders());
    }

    if (method === "GET" && !url.search) {
      return emptyResponse(403);
    }

    if (method === "GET" && headers.has("range")) {
      const end = 15;
      const body = gateway.storedBytes.slice(0, end + 1);
      return new Response(body, {
        headers: {
          ...corsHeaders(),
          "content-length": String(body.byteLength),
          "content-range": `bytes 0-${end}/${gateway.storedBytes.byteLength}`,
          "content-type": CONTENT_TYPE,
        },
        status: 206,
      });
    }

    if (method === "GET") {
      return new Response(gateway.storedBytes, {
        headers: {
          ...corsHeaders(),
          "content-length": String(gateway.storedBytes.byteLength),
          "content-type": CONTENT_TYPE,
        },
        status: 200,
      });
    }

    throw new Error("Unexpected request");
  }) as typeof fetch;
}

function corsHeaders() {
  return {
    "access-control-allow-origin": CORS_ORIGIN,
    "access-control-expose-headers": "ETag",
    etag: '"smoke-etag"',
  };
}

function emptyResponse(status: number, headers: Record<string, string> = {}) {
  return new Response(null, { headers, status });
}

function validConfigSource(): NodeJS.ProcessEnv {
  return {
    ODDPATH_R2_SMOKE_CONFIRMATION: R2_MUTATION_SMOKE_CONFIRMATION,
    ODDPATH_R2_SMOKE_CORS_ORIGIN: CORS_ORIGIN,
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_BUCKET_NAME: "oddpath-private-staging",
    R2_ENDPOINT: EU_ENDPOINT,
    R2_REGION: "auto",
    R2_SECRET_ACCESS_KEY: "test-secret-key",
  };
}

function monotonicClock() {
  let value = 0;
  return () => {
    value += 1;
    return value;
  };
}

function sequentialIds() {
  const ids = [FIXED_UUID, FIXED_PAYLOAD_UUID];
  return () => ids.shift() || "";
}

function isConfigurationFailure(error: unknown) {
  return (
    error instanceof R2SmokeError &&
    error.check === "configuration" &&
    error.reason === "invalid_configuration"
  );
}
