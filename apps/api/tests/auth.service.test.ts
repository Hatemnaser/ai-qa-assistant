import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createAuthService,
  type AuthSecurity,
} from "../src/modules/auth/auth.service.ts";
import type {
  AuthRepository,
  CreatePasswordUserInput,
  CreateSessionInput,
} from "../src/modules/auth/auth.repository.ts";
import type { AuthSessionRecord, AuthUserRecord } from "../src/modules/auth/auth.types.ts";

describe("auth service", () => {
  it("registers a password user and creates a hashed session", async () => {
    const repository = createFakeAuthRepository();
    const service = createAuthService({
      now: () => new Date("2026-05-19T00:00:00.000Z"),
      repository,
      security: createFakeSecurity(),
    });

    const response = await service.register(
      {
        email: "person@example.com",
        locale: "en",
        name: "Person",
        password: "Password1",
      },
      {
        ipAddress: "127.0.0.1",
        userAgent: "test-agent",
      }
    );

    assert.equal(repository.users.length, 1);
    assert.equal(repository.users[0].passwordHash, "hashed-password:Password1");
    assert.equal(repository.sessions.length, 1);
    assert.equal(repository.sessions[0].tokenHash, "hashed-session:session-token");
    assert.equal(repository.sessions[0].userAgent, "test-agent");
    assert.equal(response.sessionToken, "session-token");
    assert.equal(response.response.session.expiresAt, "2026-05-26T00:00:00.000Z");
    assert.deepEqual(response.response.user, {
      createdAt: "2026-05-19T00:00:00.000Z",
      email: "person@example.com",
      id: "user-1",
      locale: "en",
      name: "Person",
    });
  });

  it("rejects duplicate registrations", async () => {
    const repository = createFakeAuthRepository([
      createUserRecord({
        email: "taken@example.com",
      }),
    ]);
    const service = createAuthService({
      repository,
      security: createFakeSecurity(),
    });

    await assert.rejects(
      () =>
        service.register(
          {
            email: "taken@example.com",
            locale: "en",
            password: "Password1",
          },
          {}
        ),
      {
        code: "EMAIL_ALREADY_REGISTERED",
        statusCode: 409,
      }
    );
    assert.equal(repository.sessions.length, 0);
  });

  it("logs in existing password users and supports remember sessions", async () => {
    const repository = createFakeAuthRepository([
      createUserRecord({
        email: "person@example.com",
        passwordHash: "stored-password-hash",
      }),
    ]);
    const service = createAuthService({
      now: () => new Date("2026-05-19T00:00:00.000Z"),
      repository,
      security: createFakeSecurity({
        async verifyPassword(password, passwordHash) {
          assert.equal(password, "Password1");
          assert.equal(passwordHash, "stored-password-hash");
          return true;
        },
      }),
    });

    const response = await service.login(
      {
        email: "person@example.com",
        password: "Password1",
        remember: true,
      },
      {}
    );

    assert.equal(repository.sessions.length, 1);
    assert.equal(response.response.session.expiresAt, "2026-06-18T00:00:00.000Z");
  });

  it("does not create a session for invalid credentials", async () => {
    const repository = createFakeAuthRepository([
      createUserRecord({
        email: "person@example.com",
        passwordHash: "stored-password-hash",
      }),
    ]);
    const service = createAuthService({
      repository,
      security: createFakeSecurity({
        async verifyPassword() {
          return false;
        },
      }),
    });

    await assert.rejects(
      () =>
        service.login(
          {
            email: "person@example.com",
            password: "wrong-password",
            remember: false,
          },
          {}
        ),
      {
        code: "INVALID_CREDENTIALS",
        statusCode: 401,
      }
    );
    assert.equal(repository.sessions.length, 0);
  });

  it("keeps password reset responses generic", async () => {
    const repository = createFakeAuthRepository();
    const service = createAuthService({
      repository,
      security: createFakeSecurity(),
    });

    const response = await service.requestPasswordReset({
      email: "missing@example.com",
    });

    assert.deepEqual(response, {
      message: "If an account exists for that email, password reset instructions will be sent.",
    });
  });

  it("returns the current user for a valid session token", async () => {
    const user = createUserRecord({
      email: "person@example.com",
    });
    const repository = createFakeAuthRepository([user]);
    repository.sessions.push({
      expiresAt: new Date("2026-05-26T00:00:00.000Z"),
      tokenHash: "hashed-session:session-token",
      userId: user.id,
    });
    const service = createAuthService({
      now: () => new Date("2026-05-19T00:00:00.000Z"),
      repository,
      security: createFakeSecurity(),
    });

    const response = await service.getCurrentUser("session-token");

    assert.deepEqual(response, {
      createdAt: "2026-05-19T00:00:00.000Z",
      email: "person@example.com",
      id: "user-1",
      locale: "en",
      name: null,
    });
  });

  it("removes expired sessions before rejecting them", async () => {
    const user = createUserRecord();
    const repository = createFakeAuthRepository([user]);
    repository.sessions.push({
      expiresAt: new Date("2026-05-18T00:00:00.000Z"),
      tokenHash: "hashed-session:session-token",
      userId: user.id,
    });
    const service = createAuthService({
      now: () => new Date("2026-05-19T00:00:00.000Z"),
      repository,
      security: createFakeSecurity(),
    });

    await assert.rejects(() => service.getCurrentUser("session-token"), {
      code: "SESSION_REQUIRED",
      statusCode: 401,
    });
    assert.equal(repository.sessions.length, 0);
  });

  it("logs out by deleting the matching session token hash", async () => {
    const user = createUserRecord();
    const repository = createFakeAuthRepository([user]);
    repository.sessions.push({
      expiresAt: new Date("2026-05-26T00:00:00.000Z"),
      tokenHash: "hashed-session:session-token",
      userId: user.id,
    });
    const service = createAuthService({
      repository,
      security: createFakeSecurity(),
    });

    const response = await service.logout("session-token");

    assert.deepEqual(response, {
      ok: true,
    });
    assert.equal(repository.sessions.length, 0);
  });
});

function createFakeSecurity(overrides: Partial<AuthSecurity> = {}): AuthSecurity {
  return {
    createSessionToken: () => "session-token",
    hashPassword: async (password) => `hashed-password:${password}`,
    hashSessionToken: (token) => `hashed-session:${token}`,
    verifyPassword: async () => true,
    ...overrides,
  };
}

function createFakeAuthRepository(initialUsers: AuthUserRecord[] = []) {
  const repository = {
    sessions: [] as CreateSessionInput[],
    users: [...initialUsers],

    async createPasswordUser(input: CreatePasswordUserInput) {
      const user = createUserRecord({
        email: input.email,
        id: `user-${repository.users.length + 1}`,
        locale: input.locale,
        name: input.name ?? null,
        passwordHash: input.passwordHash,
      });

      repository.users.push(user);
      return user;
    },

    async createSession(input: CreateSessionInput) {
      repository.sessions.push(input);
    },

    async deleteSessionByTokenHash(tokenHash: string) {
      repository.sessions = repository.sessions.filter((session) => session.tokenHash !== tokenHash);
    },

    async findSessionByTokenHash(tokenHash: string) {
      const session = repository.sessions.find((item) => item.tokenHash === tokenHash);

      if (!session) {
        return null;
      }

      const user = repository.users.find((item) => item.id === session.userId);

      if (!user) {
        return null;
      }

      return {
        expiresAt: session.expiresAt,
        id: "session-1",
        user,
        userId: session.userId,
      } satisfies AuthSessionRecord;
    },

    async findUserByEmail(email: string) {
      return repository.users.find((user) => user.email === email) ?? null;
    },
  } satisfies AuthRepository & {
    sessions: CreateSessionInput[];
    users: AuthUserRecord[];
  };

  return repository;
}

function createUserRecord(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  const createdAt = overrides.createdAt ?? new Date("2026-05-19T00:00:00.000Z");

  return {
    createdAt,
    email: "person@example.com",
    id: "user-1",
    locale: "en",
    name: null,
    passwordHash: "stored-password-hash",
    updatedAt: createdAt,
    ...overrides,
  };
}
