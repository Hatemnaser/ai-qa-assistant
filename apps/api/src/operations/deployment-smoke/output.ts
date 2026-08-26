import type { DeploymentSmokeReport } from "./types.js";
import { DeploymentSmokeError } from "./types.js";

export function createDeploymentSmokeSuccessEvent(report: DeploymentSmokeReport) {
  return {
    checks: report.checks,
    event: "deployment_smoke" as const,
    mode: report.mode,
    status: report.status,
  };
}

export function createDeploymentSmokeFailureEvent(error: unknown) {
  const failure = error instanceof DeploymentSmokeError
    ? {
        failedCheck: error.check,
        reason: error.reason,
      }
    : {
        failedCheck: "runner",
        reason: "invalid_response" as const,
      };

  // Never copy the unknown error, its message/stack, request details, or any
  // runtime configuration into the operator-facing event.
  return {
    event: "deployment_smoke" as const,
    ...failure,
    status: "failed" as const,
  };
}
