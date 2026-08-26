export const AUTHENTICATED_MUTATION_CONFIRMATION =
  "CREATE_AND_DELETE_ODDPATH_SMOKE_PROJECT";

export const MAX_SMOKE_EMAIL_LENGTH = 320;
export const MAX_SMOKE_PASSWORD_LENGTH = 1_024;

export type DeploymentSmokeMode = "authenticated-mutation" | "read-only";

export interface DeploymentSmokeCheckResult {
  durationMs: number;
  name: string;
}

export interface DeploymentSmokeReport {
  checks: DeploymentSmokeCheckResult[];
  mode: DeploymentSmokeMode;
  status: "passed";
}

export interface ReadOnlyDeploymentSmokeOptions {
  baseUrl: string;
  csrfHeaderName?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  webOrigin?: string;
}

export interface AuthenticatedMutationDeploymentSmokeOptions
  extends Omit<ReadOnlyDeploymentSmokeOptions, "webOrigin"> {
  confirmation: string;
  credentials: {
    email: string;
    password: string;
  };
  randomId?: () => string;
  webOrigin: string;
}

interface BaseDeploymentSmokeCliConfig {
  baseUrl: string;
  csrfHeaderName: string;
  timeoutMs: number;
  webOrigin?: string;
}

export type DeploymentSmokeCliConfig =
  | BaseDeploymentSmokeCliConfig & {
      mode: "read-only";
    }
  | BaseDeploymentSmokeCliConfig & {
      credentials: {
        email: string;
        password: string;
      };
      mode: "authenticated-mutation";
      mutationConfirmation: string;
      webOrigin: string;
    };

export type DeploymentSmokeFailureReason =
  | "cleanup_failed"
  | "invalid_configuration"
  | "invalid_json"
  | "invalid_response"
  | "network_error"
  | "response_too_large"
  | "timeout"
  | "unexpected_content_type"
  | "unexpected_status";

export class DeploymentSmokeError extends Error {
  constructor(
    readonly check: string,
    readonly reason: DeploymentSmokeFailureReason
  ) {
    super(`Deployment smoke check '${check}' failed (${reason}).`);
    this.name = "DeploymentSmokeError";
  }
}

export class SmokeProbeError extends Error {
  constructor(readonly reason: DeploymentSmokeFailureReason) {
    super(reason);
    this.name = "SmokeProbeError";
  }
}

export function configurationError() {
  return new DeploymentSmokeError("configuration", "invalid_configuration");
}
