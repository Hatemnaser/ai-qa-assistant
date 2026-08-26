import type { R2SmokeReport } from "./types.js";
import { R2SmokeError } from "./types.js";

export function createR2SmokeSuccessEvent(report: R2SmokeReport) {
  return {
    checks: report.checks,
    event: "r2_smoke" as const,
    mode: report.mode,
    status: report.status,
  };
}

export function createR2SmokeFailureEvent(error: unknown) {
  const failure = error instanceof R2SmokeError
    ? { failedCheck: error.check, reason: error.reason }
    : { failedCheck: "runner", reason: "invalid_response" as const };

  // Never serialize an unknown provider error, endpoint, signed URL, object
  // key, response body, credential, stack trace, or request metadata.
  return {
    event: "r2_smoke" as const,
    ...failure,
    status: "failed" as const,
  };
}
