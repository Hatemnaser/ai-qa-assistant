import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AuthEmailService,
  EmailVerificationEmailMessage,
  PasswordResetEmailMessage,
} from "../src/modules/auth/auth.email.ts";
import { EXPIRED_SESSION, createUserRecord, setupAuthService } from "./helpers/authService.ts";

describe("auth service", () => {
  it("registers a password user as unverified and sends a hashed verification token", async () => {
    const emailService = createFakeEmailService();
    const { repository, service } = setupAuthService({
      emailService,
      emailVerificationLink: {
        appOrigin: "http://app.example.test",
        verificationPath: "/verify-email",
      },
      emailVerificationTokenTtlMinutes: 20,
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
    assert.equal(repository.users[0].emailVerifiedAt, null);
    assert.equal(repository.sessions.length, 0);
    assert.deepEqual(response, {
      message: "Check your email to verify your account.",
    });
    assert.equal(repository.emailVerificationTokens.length, 1);
    assert.equal(repository.emailVerificationTokens[0].tokenHash, "hashed-verification:verification-token");
    assert.notEqual(repository.emailVerificationTokens[0].tokenHash, "verification-token");
    assert.equal(repository.emailVerificationTokens[0].expiresAt.toISOString(), "2026-05-19T00:20:00.000Z");
    assert.equal(emailService.verificationMessages.length, 1);
    assert.equal(emailService.verificationMessages[0].to, "person@example.com");
    assert.equal(new URL(emailService.verificationMessages[0].verificationUrl).searchParams.get("token"), "verification-token");
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

  it("rejects unverified password users after validating their password", async () => {
    const { repository, service } = setupAuthService({
      users: [
        createUserRecord({
          email: "person@example.com",
          emailVerifiedAt: null,
          passwordHash: "stored-password-hash",
        }),
      ],
    });

    await assert.rejects(
      () =>
        service.login(
          {
            email: "person@example.com",
            password: "Password1",
            remember: false,
          },
          {}
        ),
      {
        code: "EMAIL_NOT_VERIFIED",
        statusCode: 403,
      }
    );
    assert.equal(repository.sessions.length, 0);
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

  it("keeps missing-user login failures generic", async () => {
    const { repository, service } = setupAuthService({
      users: [],
    });

    await assert.rejects(
      () =>
        service.login(
          {
            email: "missing@example.com",
            password: "Password1",
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

  it("keeps password reset responses generic for existing and missing users", async () => {
    const { service } = setupAuthService({
      users: [
        createUserRecord({
          email: "person@example.com",
        }),
      ],
    });

    const existingResponse = await service.requestPasswordReset({
      email: "person@example.com",
    });

    const missingResponse = await service.requestPasswordReset({
      email: "missing@example.com",
    });

    assert.deepEqual(existingResponse, {
      message: "If an account exists for this email, a reset link has been sent.",
    });
    assert.deepEqual(missingResponse, existingResponse);
  });

  it("creates a hashed password reset token without storing the raw token", async () => {
    const emailService = createFakeEmailService();
    const { repository, service } = setupAuthService({
      emailService,
      passwordResetLink: {
        appOrigin: "http://app.example.test",
        resetPath: "/reset-password",
      },
      passwordResetTokenTtlMinutes: 20,
      users: [
        createUserRecord({
          email: "person@example.com",
        }),
      ],
    });

    await service.requestPasswordReset({
      email: "person@example.com",
    });

    assert.equal(repository.passwordResetTokens.length, 1);
    assert.equal(repository.passwordResetTokens[0].tokenHash, "hashed-reset:reset-token");
    assert.notEqual(repository.passwordResetTokens[0].tokenHash, "reset-token");
    assert.equal(repository.passwordResetTokens[0].expiresAt.toISOString(), "2026-05-19T00:20:00.000Z");
    assert.equal(emailService.messages.length, 1);
    assert.equal(emailService.messages[0].to, "person@example.com");
    assert.equal(new URL(emailService.messages[0].resetUrl).searchParams.get("token"), "reset-token");
  });

  it("verifies an email with a valid token and does not allow reuse", async () => {
    const user = createUserRecord({
      emailVerifiedAt: null,
    });
    const { repository, service } = setupAuthService({
      users: [user],
    });
    await repository.createEmailVerificationToken({
      expiresAt: new Date("2026-05-19T00:30:00.000Z"),
      now: new Date("2026-05-19T00:00:00.000Z"),
      tokenHash: "hashed-verification:valid-token",
      userId: user.id,
    });

    const response = await service.verifyEmail({
      token: "valid-token",
    });

    assert.deepEqual(response, {
      ok: true,
    });
    assert.equal(user.emailVerifiedAt?.toISOString(), "2026-05-19T00:00:00.000Z");
    assert.equal(repository.emailVerificationTokens[0].usedAt?.toISOString(), "2026-05-19T00:00:00.000Z");

    await assert.rejects(
      () =>
        service.verifyEmail({
          token: "valid-token",
        }),
      {
        code: "INVALID_VERIFICATION_TOKEN",
        statusCode: 400,
      }
    );
  });

  it("rejects expired and already-used email verification tokens with the same generic error", async () => {
    const user = createUserRecord({
      emailVerifiedAt: null,
    });
    const { repository, service } = setupAuthService({
      users: [user],
    });
    await repository.createEmailVerificationToken({
      expiresAt: EXPIRED_SESSION,
      now: new Date("2026-05-17T00:00:00.000Z"),
      tokenHash: "hashed-verification:expired-token",
      userId: user.id,
    });
    await repository.createEmailVerificationToken({
      expiresAt: new Date("2026-05-19T00:30:00.000Z"),
      now: new Date("2026-05-18T00:00:00.000Z"),
      tokenHash: "hashed-verification:used-token",
      userId: user.id,
    });
    repository.emailVerificationTokens[1].usedAt = new Date("2026-05-18T00:01:00.000Z");

    for (const token of ["expired-token", "used-token", "missing-token"]) {
      await assert.rejects(
        () =>
          service.verifyEmail({
            token,
          }),
        {
          code: "INVALID_VERIFICATION_TOKEN",
          statusCode: 400,
        }
      );
    }

    assert.equal(user.emailVerifiedAt, null);
  });

  it("resends verification emails generically only for existing unverified users", async () => {
    const emailService = createFakeEmailService();
    const verifiedUser = createUserRecord({
      email: "verified@example.com",
      id: "verified-user",
    });
    const unverifiedUser = createUserRecord({
      email: "unverified@example.com",
      emailVerifiedAt: null,
      id: "unverified-user",
    });
    const { repository, service } = setupAuthService({
      emailService,
      users: [verifiedUser, unverifiedUser],
    });
    await repository.createEmailVerificationToken({
      expiresAt: new Date("2026-05-19T00:30:00.000Z"),
      now: new Date("2026-05-18T00:00:00.000Z"),
      tokenHash: "hashed-verification:old-token",
      userId: unverifiedUser.id,
    });

    const existingResponse = await service.resendVerification({
      email: "unverified@example.com",
    });
    const missingResponse = await service.resendVerification({
      email: "missing@example.com",
    });
    const verifiedResponse = await service.resendVerification({
      email: "verified@example.com",
    });

    assert.deepEqual(existingResponse, {
      message: "If an unverified account exists for this email, a verification link has been sent.",
    });
    assert.deepEqual(missingResponse, existingResponse);
    assert.deepEqual(verifiedResponse, existingResponse);
    assert.equal(emailService.verificationMessages.length, 1);
    assert.equal(emailService.verificationMessages[0].to, "unverified@example.com");
    assert.equal(repository.emailVerificationTokens.length, 2);
    assert.equal(repository.emailVerificationTokens[0].usedAt?.toISOString(), "2026-05-19T00:00:00.000Z");
    assert.equal(repository.emailVerificationTokens[1].tokenHash, "hashed-verification:verification-token");
  });

  it("resets a password with a valid token and invalidates old sessions", async () => {
    const user = createUserRecord({
      passwordHash: "hashed-password:OldPassword1",
    });
    const { repository, service } = setupAuthService({
      users: [user],
    });
    repository.addSession(user, {
      tokenHash: "hashed-session:old-session",
    });
    await repository.createPasswordResetToken({
      expiresAt: new Date("2026-05-19T00:30:00.000Z"),
      tokenHash: "hashed-reset:valid-token",
      userId: user.id,
    });

    const response = await service.resetPassword({
      newPassword: "NewPassword1",
      token: "valid-token",
    });

    assert.deepEqual(response, {
      ok: true,
    });
    assert.equal(user.passwordHash, "hashed-password:NewPassword1");
    assert.equal(repository.sessions.length, 0);
    assert.equal(repository.passwordResetTokens[0].usedAt?.toISOString(), "2026-05-19T00:00:00.000Z");
  });

  it("rejects expired password reset tokens", async () => {
    const user = createUserRecord();
    const { repository, service } = setupAuthService({
      users: [user],
    });
    await repository.createPasswordResetToken({
      expiresAt: EXPIRED_SESSION,
      tokenHash: "hashed-reset:expired-token",
      userId: user.id,
    });

    await assert.rejects(
      () =>
        service.resetPassword({
          newPassword: "NewPassword1",
          token: "expired-token",
        }),
      {
        code: "INVALID_RESET_TOKEN",
        statusCode: 400,
      }
    );
    assert.equal(user.passwordHash, "stored-password-hash");
  });

  it("rejects already-used password reset tokens", async () => {
    const user = createUserRecord();
    const { repository, service } = setupAuthService({
      users: [user],
    });
    await repository.createPasswordResetToken({
      expiresAt: new Date("2026-05-19T00:30:00.000Z"),
      tokenHash: "hashed-reset:used-token",
      userId: user.id,
    });
    repository.passwordResetTokens[0].usedAt = new Date("2026-05-19T00:01:00.000Z");

    await assert.rejects(
      () =>
        service.resetPassword({
          newPassword: "NewPassword1",
          token: "used-token",
        }),
      {
        code: "INVALID_RESET_TOKEN",
        statusCode: 400,
      }
    );
    assert.equal(user.passwordHash, "stored-password-hash");
  });

  it("does not allow a password reset token to be reused", async () => {
    const user = createUserRecord();
    const { repository, service } = setupAuthService({
      users: [user],
    });
    await repository.createPasswordResetToken({
      expiresAt: new Date("2026-05-19T00:30:00.000Z"),
      tokenHash: "hashed-reset:single-use-token",
      userId: user.id,
    });

    await service.resetPassword({
      newPassword: "NewPassword1",
      token: "single-use-token",
    });

    await assert.rejects(
      () =>
        service.resetPassword({
          newPassword: "AnotherPassword1",
          token: "single-use-token",
        }),
      {
        code: "INVALID_RESET_TOKEN",
        statusCode: 400,
      }
    );
  });

  it("rejects the old password and accepts the new password after reset", async () => {
    const user = createUserRecord({
      passwordHash: "hashed-password:OldPassword1",
    });
    const { repository, service } = setupAuthService({
      security: {
        async verifyPassword(password, passwordHash) {
          return passwordHash === `hashed-password:${password}`;
        },
      },
      users: [user],
    });
    await repository.createPasswordResetToken({
      expiresAt: new Date("2026-05-19T00:30:00.000Z"),
      tokenHash: "hashed-reset:login-token",
      userId: user.id,
    });

    await service.resetPassword({
      newPassword: "NewPassword1",
      token: "login-token",
    });

    await assert.rejects(
      () =>
        service.login(
          {
            email: "person@example.com",
            password: "OldPassword1",
            remember: false,
          },
          {}
        ),
      {
        code: "INVALID_CREDENTIALS",
        statusCode: 401,
      }
    );

    const response = await service.login(
      {
        email: "person@example.com",
        password: "NewPassword1",
        remember: false,
      },
      {}
    );

    assert.equal(response.response.user.id, user.id);
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
      emailVerifiedAt: "2026-05-19T00:00:00.000Z",
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

function createFakeEmailService() {
  const emailService = {
    messages: [] as PasswordResetEmailMessage[],
    verificationMessages: [] as EmailVerificationEmailMessage[],

    async sendEmailVerificationEmail(message: EmailVerificationEmailMessage) {
      emailService.verificationMessages.push(message);
    },

    async sendPasswordResetEmail(message: PasswordResetEmailMessage) {
      emailService.messages.push(message);
    },
  } satisfies AuthEmailService & {
    messages: PasswordResetEmailMessage[];
    verificationMessages: EmailVerificationEmailMessage[];
  };

  return emailService;
}
