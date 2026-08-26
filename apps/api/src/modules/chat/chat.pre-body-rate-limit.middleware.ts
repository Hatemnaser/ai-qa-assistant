import type { NextFunction, Request, RequestHandler, Response } from "express";

import { env } from "../../config/env.js";
import {
  logChatRateLimited,
  type ChatRateLimitReason,
} from "../../lib/security-events.js";
import {
  CHAT_RATE_LIMITED_MESSAGE,
  isChatIpRateLimited,
} from "./chat.rateLimit.js";

const IN_FLIGHT_RETRY_AFTER_SECONDS = 1;

interface ChatPreBodyGateOptions {
  globalMaxInFlight?: number;
  isIpRateLimited?: typeof isChatIpRateLimited;
  logRateLimited?: typeof logChatRateLimited;
  perIpMaxInFlight?: number;
}

type AdmissionResult =
  | { admitted: true; release: () => void }
  | { admitted: false; reason: "global_in_flight" | "ip_in_flight" };

/**
 * Bounds the number of request bodies that Express may parse concurrently.
 * The process-wide bound also caps the number of live per-IP entries.
 */
class ChatInFlightAdmissionGate {
  private globalInFlight = 0;
  private readonly perIpInFlight = new Map<string, number>();

  constructor(
    private readonly globalMaxInFlight: number,
    private readonly perIpMaxInFlight: number
  ) {
    assertPositiveSafeInteger(globalMaxInFlight, "globalMaxInFlight");
    assertPositiveSafeInteger(perIpMaxInFlight, "perIpMaxInFlight");

    if (perIpMaxInFlight > globalMaxInFlight) {
      throw new Error("perIpMaxInFlight must not exceed globalMaxInFlight.");
    }
  }

  admit(ipAddress: string): AdmissionResult {
    if (this.globalInFlight >= this.globalMaxInFlight) {
      return { admitted: false, reason: "global_in_flight" };
    }

    const currentForIp = this.perIpInFlight.get(ipAddress) ?? 0;
    if (currentForIp >= this.perIpMaxInFlight) {
      return { admitted: false, reason: "ip_in_flight" };
    }

    this.globalInFlight += 1;
    this.perIpInFlight.set(ipAddress, currentForIp + 1);

    let released = false;
    return {
      admitted: true,
      release: () => {
        if (released) return;
        released = true;

        this.globalInFlight = Math.max(0, this.globalInFlight - 1);
        const nextForIp = (this.perIpInFlight.get(ipAddress) ?? 1) - 1;

        if (nextForIp <= 0) {
          this.perIpInFlight.delete(ipAddress);
          return;
        }

        this.perIpInFlight.set(ipAddress, nextForIp);
      },
    };
  }
}

/**
 * Runs before express.json so oversized/slow bodies cannot bypass coarse rate
 * limiting or create an unbounded number of simultaneous JSON buffers.
 */
export function createChatPreBodyGateMiddleware(
  options: ChatPreBodyGateOptions = {}
): RequestHandler {
  const globalMaxInFlight = options.globalMaxInFlight ?? env.chatInFlightGlobalMax;
  const perIpMaxInFlight = options.perIpMaxInFlight ?? env.chatInFlightPerIpMax;
  const checkIpRateLimit = options.isIpRateLimited ?? isChatIpRateLimited;
  const writeRateLimitEvent = options.logRateLimited ?? logChatRateLimited;
  const admissionGate = new ChatInFlightAdmissionGate(
    globalMaxInFlight,
    perIpMaxInFlight
  );

  return function chatPreBodyGate(req: Request, res: Response, next: NextFunction) {
    // express.json is mounted as middleware and can parse bodies on non-POST
    // methods too. Gate every POST attempt plus any other body-bearing method
    // so method substitution cannot bypass the memory bound.
    if (req.method !== "POST" && !requestHasBody(req)) {
      next();
      return;
    }

    const ipAddress = readIpAddress(req);

    if (checkIpRateLimit({ ipAddress })) {
      rejectBeforeBody(req, res, writeRateLimitEvent, {
        ipAddress,
        reason: "ip_rate",
        retryAfterSeconds: Math.ceil(env.chatRateLimitWindowMs / 1000),
      });
      return;
    }

    const admission = admissionGate.admit(ipAddress);
    if (!admission.admitted) {
      rejectBeforeBody(req, res, writeRateLimitEvent, {
        ipAddress,
        reason: admission.reason,
        retryAfterSeconds: IN_FLIGHT_RETRY_AFTER_SECONDS,
      });
      return;
    }

    // Both events can fire for one response; release is intentionally
    // idempotent so the counters remain exact on normal and aborted requests.
    res.once("finish", admission.release);
    res.once("close", admission.release);
    next();
  };
}

function rejectBeforeBody(
  req: Request,
  res: Response,
  writeRateLimitEvent: typeof logChatRateLimited,
  input: {
    ipAddress: string;
    reason: ChatRateLimitReason;
    retryAfterSeconds: number;
  }
) {
  writeRateLimitEvent({
    identityType: "anonymous",
    ipAddress: input.ipAddress,
    reason: input.reason,
  });

  // No downstream parser has attached a data listener. Do not drain an
  // attacker-controlled body indefinitely; close this connection after the
  // bounded response so unread bytes can never contaminate a keep-alive request.
  req.pause();
  res.shouldKeepAlive = false;
  res.setHeader("Connection", "close");
  res.setHeader("Retry-After", String(Math.max(1, input.retryAfterSeconds)));
  res.status(429).json({
    code: "RATE_LIMITED",
    error: CHAT_RATE_LIMITED_MESSAGE,
    message: CHAT_RATE_LIMITED_MESSAGE,
  });
}

function readIpAddress(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown-ip";
}

function requestHasBody(req: Request) {
  const transferEncoding = req.headers["transfer-encoding"];
  const contentLength = req.headers["content-length"];

  return transferEncoding !== undefined || (contentLength !== undefined && contentLength !== "0");
}

function assertPositiveSafeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
}

export const enforceChatPreBodyGate = createChatPreBodyGateMiddleware();
