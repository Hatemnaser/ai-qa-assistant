import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EXPIRED_SESSION, createUserRecord, setupAuthService } from "./helpers/authService.ts";

describe("auth service", () => {
  it("registers a password user and creates a hashed session", async () => {
    const { repository, service } = setupAuthService();

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
    const { repository, service } = setupAuthService({
      users: [
        createUserRecord({
          email: "taken@example.com",
        }),
      ],
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
    const { repository, service } = setupAuthService({
      security: {
        async verifyPassword(password, passwordHash) {
          assert.equal(password, "Password1");
          assert.equal(passwordHash, "stored-password-hash");
          return true;
        },
      },
      users: [
        createUserRecord({
          email: "person@example.com",
          passwordHash: "stored-password-hash",
        }),
      ],
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
    const { repository, service } = setupAuthService({
      security: {
        async verifyPassword() {
          return false;
        },
      },
      users: [
        createUserRecord({
          email: "person@example.com",
          passwordHash: "stored-password-hash",
        }),
      ],
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
    const { service } = setupAuthService();

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
    const { repository, service } = setupAuthService({
      users: [user],
    });
    repository.addSession(user);

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
    const { repository, service } = setupAuthService({
      users: [user],
    });
    repository.addSession(user, {
      expiresAt: EXPIRED_SESSION,
    });

    await assert.rejects(() => service.getCurrentUser("session-token"), {
      code: "SESSION_REQUIRED",
      statusCode: 401,
    });
    assert.equal(repository.sessions.length, 0);
  });

  it("logs out by deleting the matching session token hash", async () => {
    const user = createUserRecord();
    const { repository, service } = setupAuthService({
      users: [user],
    });
    repository.addSession(user);

    const response = await service.logout("session-token");

    assert.deepEqual(response, {
      ok: true,
    });
    assert.equal(repository.sessions.length, 0);
  });
});
