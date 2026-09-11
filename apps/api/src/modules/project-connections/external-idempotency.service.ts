import { createHash } from "node:crypto";

import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60_000;

export interface ExternalIdempotencyResponse<T> {
  body: T;
  status: number;
}

export interface ExternalIdempotencyResult<T> extends ExternalIdempotencyResponse<T> {
  replayed: boolean;
}

export interface ExternalIdempotencyInput {
  credentialId: string;
  key?: string;
  operation: string;
  request: unknown;
}

export function createExternalIdempotencyService(
  database: typeof prisma = prisma,
  now: () => Date = () => new Date()
) {
  async function execute<T>(
    input: ExternalIdempotencyInput,
    action: () => Promise<ExternalIdempotencyResponse<T>>
  ): Promise<ExternalIdempotencyResult<T>> {
    const key = requireIdempotencyKey(input.key);

    const keyHash = sha256(key);
    const requestHash = sha256(canonicalJson(input.request));
    const lookup = {
      credentialId_operation_keyHash: {
        credentialId: input.credentialId,
        keyHash,
        operation: input.operation,
      },
    };
    const existing = await database.externalIdempotencyRecord.findUnique({ where: lookup });
    if (existing) return replayExisting<T>(existing, requestHash);

    let record: { id: string };
    try {
      record = await database.externalIdempotencyRecord.create({
        data: {
          credentialId: input.credentialId,
          expiresAt: new Date(now().getTime() + IDEMPOTENCY_RETENTION_MS),
          keyHash,
          operation: input.operation,
          protocolVersion: 2,
          requestHash,
          state: "PENDING",
        },
        select: { id: true },
      });
    } catch (error) {
      const raced = await database.externalIdempotencyRecord.findUnique({ where: lookup });
      if (!raced) throw error;
      return replayExisting<T>(raced, requestHash);
    }

    try {
      const response = await action();
      const body = toJsonValue(response.body);
      const completed = await database.externalIdempotencyRecord.updateMany({
        data: {
          completedAt: now(),
          responseBody: body,
          responseStatus: response.status,
          state: "COMPLETED",
        },
        where: { id: record.id, responseStatus: null, state: "PENDING" },
      });
      if (completed.count !== 1) {
        throw new AppError(
          "Idempotent operation completion could not be recorded.",
          409,
          "IDEMPOTENCY_COMPLETION_CONFLICT"
        );
      }
      return { body: response.body, replayed: false, status: response.status };
    } catch (error) {
      if (error instanceof AppError && error.code !== "IDEMPOTENCY_COMPLETION_CONFLICT") {
        await database.externalIdempotencyRecord.updateMany({
          data: {
            completedAt: now(),
            responseBody: toJsonValue({
              code: error.code,
              error: error.expose ? error.message : "The operation could not be completed.",
            }),
            responseStatus: error.statusCode,
            state: "COMPLETED",
          },
          where: { id: record.id, responseStatus: null, state: "PENDING" },
        });
      }
      // An unknown failure may have happened after the domain transaction
      // committed. Keep the reservation in-progress rather than risk replaying
      // a mutation whose acknowledgement was lost.
      throw error;
    }
  }

  return { execute };
}

export const externalIdempotencyService = createExternalIdempotencyService();

export function validateIdempotencyKey(value: string | undefined) {
  if (value === undefined || value === "") return undefined;
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new AppError(
      "Idempotency-Key must be 8-200 URL-safe characters.",
      400,
      "IDEMPOTENCY_KEY_INVALID"
    );
  }
  return value;
}

export function requireIdempotencyKey(value: string | undefined) {
  const key = validateIdempotencyKey(value);
  if (!key) {
    throw new AppError(
      "Idempotency-Key is required for external mutations.",
      400,
      "IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  return key;
}

function replayExisting<T>(
  record: {
    requestHash: string;
    responseBody: unknown;
    responseStatus: number | null;
    state: "PENDING" | "COMPLETED" | "LEGACY_AMBIGUOUS";
  },
  requestHash: string
): ExternalIdempotencyResult<T> {
  if (record.requestHash !== requestHash) {
    throw new AppError(
      "Idempotency-Key was already used for a different request.",
      409,
      "IDEMPOTENCY_KEY_REUSED"
    );
  }
  if (record.state === "LEGACY_AMBIGUOUS") {
    throw new AppError(
      "This legacy idempotent operation has an ambiguous outcome and cannot be replayed automatically.",
      409,
      "IDEMPOTENCY_LEGACY_AMBIGUOUS"
    );
  }
  if (record.state === "PENDING" || record.responseStatus === null || record.responseBody === null) {
    throw new AppError(
      "The idempotent operation is still processing.",
      409,
      "IDEMPOTENCY_IN_PROGRESS"
    );
  }
  if (record.responseStatus >= 400) {
    const body = record.responseBody as { code?: unknown; error?: unknown };
    throw new AppError(
      typeof body.error === "string" ? body.error : "The operation could not be completed.",
      record.responseStatus,
      typeof body.code === "string" ? body.code : "IDEMPOTENT_OPERATION_FAILED"
    );
  }
  return {
    body: record.responseBody as T,
    replayed: true,
    status: record.responseStatus,
  };
}

function canonicalJson(value: unknown) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)])
    );
  }
  return value;
}

function toJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
