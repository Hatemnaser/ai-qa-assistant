import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPrismaAuthRepository } from "../src/modules/auth/auth.repository.ts";

const NOW = new Date("2026-08-19T10:00:00.000Z");
const EXPIRES_AT = new Date("2026-08-19T10:30:00.000Z");

describe("auth repository token serialization", () => {
  it("serializes concurrent password-reset issuance so only the newest token and job remain active", async () => {
    const fake = createAuthDatabase();
    const repository = createPrismaAuthRepository(fake.database as never);

    await Promise.all([
      repository.createPasswordResetToken({
        emailJob: { encryptedPayload: "ciphertext-a", id: "job-a" },
        expiresAt: EXPIRES_AT,
        now: NOW,
        tokenHash: "hash-a",
        userId: "user-1",
      }),
      repository.createPasswordResetToken({
        emailJob: { encryptedPayload: "ciphertext-b", id: "job-b" },
        expiresAt: EXPIRES_AT,
        now: NOW,
        tokenHash: "hash-b",
        userId: "user-1",
      }),
    ]);

    assert.equal(fake.state.tokens.length, 2);
    assert.equal(fake.state.tokens.filter((token) => token.usedAt === null).length, 1);
    assert.equal(fake.state.jobs.filter((job) => job.status === "PENDING").length, 1);
    const cancelled = fake.state.jobs.find((job) => job.status === "CANCELLED");
    assert.ok(cancelled);
    assert.equal(cancelled.encryptedPayload, null);
    assert.equal(fake.state.lockAcquisitions, 2);
  });

  it("invalidates every reset token and queued reset email after a successful password change", async () => {
    const fake = createAuthDatabase({
      jobs: [
        createJob("job-a", "token-a"),
        createJob("job-b", "token-b"),
      ],
      tokens: [
        createToken("token-a", "hash-a"),
        createToken("token-b", "hash-b"),
      ],
    });
    const repository = createPrismaAuthRepository(fake.database as never);

    const reset = await repository.resetPasswordWithToken({
      newPasswordHash: "new-password-hash",
      now: NOW,
      tokenHash: "hash-a",
    });

    assert.equal(reset, true);
    assert.ok(fake.state.tokens.every((token) => token.usedAt?.getTime() === NOW.getTime()));
    assert.ok(fake.state.jobs.every((job) => job.status === "CANCELLED"));
    assert.ok(fake.state.jobs.every((job) => job.encryptedPayload === null));
    assert.equal(fake.state.passwordHash, "new-password-hash");
    assert.equal(fake.state.sessionsDeleted, true);
    assert.ok(
      fake.state.operations.indexOf("lock") <
        fake.state.operations.indexOf("passwordResetToken:updateMany")
    );
  });
});

interface FakeToken {
  expiresAt: Date;
  id: string;
  tokenHash: string;
  usedAt: Date | null;
  userId: string;
}

interface FakeJob {
  encryptedPayload: string | null;
  id: string;
  kind: "PASSWORD_RESET";
  lockedAt: Date | null;
  passwordResetTokenId: string;
  status: "PENDING" | "PROCESSING" | "SENT" | "FAILED" | "CANCELLED";
  userId: string;
}

function createToken(id: string, tokenHash: string): FakeToken {
  return {
    expiresAt: EXPIRES_AT,
    id,
    tokenHash,
    usedAt: null,
    userId: "user-1",
  };
}

function createJob(id: string, passwordResetTokenId: string): FakeJob {
  return {
    encryptedPayload: `ciphertext-${id}`,
    id,
    kind: "PASSWORD_RESET",
    lockedAt: null,
    passwordResetTokenId,
    status: "PENDING",
    userId: "user-1",
  };
}

function createAuthDatabase(initial: { jobs?: FakeJob[]; tokens?: FakeToken[] } = {}) {
  const state = {
    jobs: [...(initial.jobs ?? [])],
    lockAcquisitions: 0,
    operations: [] as string[],
    passwordHash: "old-password-hash",
    sessionsDeleted: false,
    tokens: [...(initial.tokens ?? [])],
  };
  let lockTail = Promise.resolve();
  let tokenNumber = state.tokens.length;

  const database = {
    async $transaction<T>(callback: (tx: Record<string, unknown>) => Promise<T>) {
      let releaseLock: (() => void) | undefined;
      const tx = {
        async $executeRaw() {
          const previousLock = lockTail;
          lockTail = new Promise<void>((resolve) => {
            releaseLock = resolve;
          });
          await previousLock;
          state.lockAcquisitions += 1;
          state.operations.push("lock");
          return 1;
        },
        authEmailJob: {
          async create(input: { data: Record<string, unknown> }) {
            const data = input.data;
            state.jobs.push({
              encryptedPayload: String(data.encryptedPayload),
              id: String(data.id),
              kind: "PASSWORD_RESET",
              lockedAt: null,
              passwordResetTokenId: String(data.passwordResetTokenId),
              status: "PENDING",
              userId: String(data.userId),
            });
            return data;
          },
          async updateMany(input: {
            data: { encryptedPayload?: null; lockedAt?: null; status?: FakeJob["status"] };
            where: { kind?: FakeJob["kind"]; status?: { in: FakeJob["status"][] }; userId?: string };
          }) {
            state.operations.push("authEmailJob:updateMany");
            let count = 0;
            for (const job of state.jobs) {
              if (input.where.userId && job.userId !== input.where.userId) continue;
              if (input.where.kind && job.kind !== input.where.kind) continue;
              if (input.where.status && !input.where.status.in.includes(job.status)) continue;
              if (input.data.encryptedPayload === null) job.encryptedPayload = null;
              if (input.data.lockedAt === null) job.lockedAt = null;
              if (input.data.status) job.status = input.data.status;
              count += 1;
            }
            return { count };
          },
        },
        emailVerificationToken: {
          async findUnique() {
            return null;
          },
          async updateMany() {
            return { count: 0 };
          },
        },
        passwordResetToken: {
          async create(input: { data: Omit<FakeToken, "id" | "usedAt"> }) {
            const token = {
              ...input.data,
              id: `token-${++tokenNumber}`,
              usedAt: null,
            };
            state.tokens.push(token);
            return token;
          },
          async findUnique(input: { where: { tokenHash: string } }) {
            return state.tokens.find((token) => token.tokenHash === input.where.tokenHash) ?? null;
          },
          async updateMany(input: {
            data: { usedAt: Date };
            where: {
              expiresAt?: { gt: Date };
              id?: string;
              usedAt: null;
              userId?: string;
            };
          }) {
            state.operations.push("passwordResetToken:updateMany");
            let count = 0;
            for (const token of state.tokens) {
              if (input.where.id && token.id !== input.where.id) continue;
              if (input.where.userId && token.userId !== input.where.userId) continue;
              if (token.usedAt !== null) continue;
              if (input.where.expiresAt && token.expiresAt <= input.where.expiresAt.gt) continue;
              token.usedAt = input.data.usedAt;
              count += 1;
            }
            return { count };
          },
        },
        session: {
          async deleteMany() {
            state.sessionsDeleted = true;
            return { count: 1 };
          },
        },
        user: {
          async update(input: { data: { passwordHash: string } }) {
            state.passwordHash = input.data.passwordHash;
            return { id: "user-1" };
          },
        },
      };

      try {
        return await callback(tx);
      } finally {
        releaseLock?.();
      }
    },
  };

  return { database, state };
}
