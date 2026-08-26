export const R2_MUTATION_SMOKE_CONFIRMATION =
  "CREATE_VERIFY_DELETE_ODDPATH_R2_SMOKE_OBJECT";

export type R2SmokeFailureReason =
  | "authorization_failed"
  | "cleanup_failed"
  | "cors_failed"
  | "integrity_failed"
  | "invalid_configuration"
  | "invalid_response"
  | "network_error"
  | "provider_error"
  | "timeout"
  | "unexpected_status";

export interface R2SmokeCheckResult {
  durationMs: number;
  name: string;
}

export interface R2SmokeReport {
  checks: R2SmokeCheckResult[];
  mode: "eu-r2-mutation";
  status: "passed";
}

export interface R2SmokeObjectMetadata {
  checksumSha256: string | null;
  contentLength: number;
  contentType: string | null;
}

export interface R2SmokeRangeResult {
  bytes: Uint8Array;
  contentLength: number;
  contentRange: string | null;
  contentType: string | null;
}

export interface R2SmokeSignedRequest {
  headers: Readonly<Record<string, string>>;
  url: string;
}

export interface R2SmokeGateway {
  createDownloadUrl(
    objectKey: string,
    expiresInSeconds: number
  ): Promise<string>;
  createUploadUrl(input: {
    checksumSha256: string;
    contentLength: number;
    contentType: string;
    expiresInSeconds: number;
    objectKey: string;
  }): Promise<R2SmokeSignedRequest>;
  deleteObject(objectKey: string, signal: AbortSignal): Promise<void>;
  getObjectRange(
    objectKey: string,
    start: number,
    end: number,
    maximumBytes: number,
    signal: AbortSignal
  ): Promise<R2SmokeRangeResult>;
  inspectObject(
    objectKey: string,
    signal: AbortSignal
  ): Promise<R2SmokeObjectMetadata | null>;
}

export interface R2MutationSmokeOptions {
  confirmation: string;
  corsOrigin: string;
  fetchImpl?: typeof fetch;
  gateway: R2SmokeGateway;
  now?: () => number;
  randomId?: () => string;
  timeoutMs?: number;
}

export interface R2SmokeGatewayConfig {
  accessKeyId: string;
  bucketName: string;
  endpoint: string;
  region: "auto";
  secretAccessKey: string;
}

export interface R2SmokeCliConfig extends R2SmokeGatewayConfig {
  confirmation: typeof R2_MUTATION_SMOKE_CONFIRMATION;
  corsOrigin: string;
  mode: "eu-r2-mutation";
  timeoutMs: number;
}

export class R2SmokeError extends Error {
  constructor(
    readonly check: string,
    readonly reason: R2SmokeFailureReason
  ) {
    super(`R2 smoke check '${check}' failed (${reason}).`);
    this.name = "R2SmokeError";
  }
}

export class R2SmokeProbeError extends Error {
  constructor(readonly reason: R2SmokeFailureReason) {
    super(reason);
    this.name = "R2SmokeProbeError";
  }
}

export function r2SmokeConfigurationError() {
  return new R2SmokeError("configuration", "invalid_configuration");
}
