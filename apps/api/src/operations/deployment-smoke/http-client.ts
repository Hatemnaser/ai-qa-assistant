import { SmokeProbeError } from "./types.js";

const MAX_JSON_RESPONSE_BYTES = 64 * 1024;
const SMOKE_USER_AGENT = "Oddpath-Deployment-Smoke/1.0";

export interface SmokeHttpResult {
  body: unknown;
  response: Response;
  setCookies: string[];
}

interface SmokeHttpClientOptions {
  baseUrl: string;
  csrfHeaderName: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  webOrigin?: string;
}

interface SmokeRequestOptions {
  body?: unknown;
  expectedStatus: number | readonly number[];
  method?: "DELETE" | "GET" | "POST" | "PUT";
  origin?: string;
}

export class SmokeHttpClient {
  private readonly baseUrl: string;
  private readonly cookies = new Map<string, string>();
  private readonly csrfHeaderName: string;
  private csrfToken?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly webOrigin?: string;

  constructor(options: SmokeHttpClientOptions) {
    this.baseUrl = options.baseUrl;
    this.csrfHeaderName = options.csrfHeaderName;
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs;
    this.webOrigin = options.webOrigin;
  }

  hasCookie(name: string) {
    return this.cookies.has(name);
  }

  setCsrfToken(token: string) {
    this.csrfToken = token;
  }

  async requestJson(path: string, options: SmokeRequestOptions): Promise<SmokeHttpResult> {
    const method = options.method ?? "GET";
    const headers = new Headers({
      accept: "application/json",
      "user-agent": SMOKE_USER_AGENT,
    });
    const cookie = this.cookieHeader();
    if (cookie) headers.set("cookie", cookie);
    const origin = options.origin ?? (method === "GET" ? undefined : this.webOrigin);
    if (origin) headers.set("origin", origin);
    if (options.body !== undefined) headers.set("content-type", "application/json");
    if (method !== "GET") {
      if (!this.csrfToken) throw new SmokeProbeError("invalid_response");
      headers.set(this.csrfHeaderName, this.csrfToken);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(new URL(path, `${this.baseUrl}/`), {
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        headers,
        method,
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      throw new SmokeProbeError(isAbortError(error) ? "timeout" : "network_error");
    }

    try {
      const setCookies = readSetCookieHeaders(response.headers);
      this.captureCookies(setCookies);

      const expectedStatuses = typeof options.expectedStatus === "number"
        ? [options.expectedStatus]
        : options.expectedStatus;
      if (!expectedStatuses.includes(response.status)) {
        throw new SmokeProbeError("unexpected_status");
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() || "";
      if (!contentType.startsWith("application/json")) {
        throw new SmokeProbeError("unexpected_content_type");
      }

      const text = await readBoundedResponseText(response);
      try {
        return {
          body: JSON.parse(text) as unknown,
          response,
          setCookies,
        };
      } catch {
        throw new SmokeProbeError("invalid_json");
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private captureCookies(setCookies: readonly string[]) {
    for (const header of setCookies) {
      const pair = header.split(";", 1)[0] || "";
      const separatorIndex = pair.indexOf("=");
      if (separatorIndex <= 0) continue;
      const name = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();
      if (!name) continue;

      if (!value || /(?:^|;)\s*max-age=0(?:;|$)/i.test(header)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  private cookieHeader() {
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

async function readBoundedResponseText(response: Response) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    if (Number(declaredLength) > MAX_JSON_RESPONSE_BYTES) {
      throw new SmokeProbeError("response_too_large");
    }
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytesRead += chunk.value.byteLength;
    if (bytesRead > MAX_JSON_RESPONSE_BYTES) {
      await reader.cancel();
      throw new SmokeProbeError("response_too_large");
    }
    text += decoder.decode(chunk.value, { stream: true });
  }

  return text + decoder.decode();
}

function readSetCookieHeaders(headers: Headers) {
  const nodeHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof nodeHeaders.getSetCookie === "function") {
    return nodeHeaders.getSetCookie();
  }

  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}
