export type ApiAdapterErrorCode =
  | "INVALID_RESPONSE"
  | "NETWORK_UNAVAILABLE"
  | "REQUEST_FAILED";

export class ApiAdapterError extends Error {
  readonly code: ApiAdapterErrorCode;
  readonly status?: number;

  constructor(code: ApiAdapterErrorCode, options: { status?: number } = {}) {
    super(code);
    this.name = "ApiAdapterError";
    this.code = code;
    this.status = options.status;
  }
}

export function isFetchNetworkError(error: unknown) {
  return error instanceof TypeError
    || (error instanceof Error && error.message === "Failed to fetch");
}
