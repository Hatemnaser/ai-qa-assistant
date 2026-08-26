import { randomUUID } from "node:crypto";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { logAuthEmailDeliveryFailed } from "../../lib/security-events.js";
import {
  authEmailService,
  buildEmailVerificationUrl,
  buildPasswordResetUrl,
  type AuthEmailService,
  type EmailVerificationLinkConfig,
  type PasswordResetLinkConfig,
} from "./auth.email.js";
import {
  buildAuthEmailPayloadContext,
  encryptAuthEmailPayload,
} from "./auth-email-outbox.crypto.js";
import {
  createEmailVerificationToken,
  createPasswordResetToken,
  createSessionToken,
  hashEmailVerificationToken,
  hashPassword,
  hashPasswordResetToken,
  hashSessionToken,
  LOGIN_DUMMY_PASSWORD_HASH,
  verifyPassword,
} from "./auth.security.js";
import { authRepository } from "./auth.repository.js";
import {
  assertRegistrationAllowed,
  getPublicRegistrationConfig,
  registrationPolicy as defaultRegistrationPolicy,
  type RegistrationPolicy,
} from "./registration-policy.js";
import type {
  AuthMessageResponse,
  AuthRequestContext,
  AuthRepository,
  AuthServiceResponse,
  AuthUserRecord,
  ForgotPasswordRequest,
  LoginRequest,
  PublicAuthUser,
  RegisterRequest,
  ResendVerificationRequest,
  ResetPasswordRequest,
  VerifyEmailRequest,
} from "./auth.types.js";

const DEFAULT_SESSION_DAYS = 7;
const REMEMBER_SESSION_DAYS = 30;
const PASSWORD_RESET_MESSAGE = "If an account exists for this email, a reset link has been sent.";
const REGISTRATION_VERIFICATION_MESSAGE = "Check your email to verify your account.";
const VERIFICATION_RESEND_MESSAGE = "If an unverified account exists for this email, a verification link has been sent.";

export interface AuthSecurity {
  createEmailVerificationToken(): string;
  createPasswordResetToken(): string;
  createSessionToken(): string;
  hashEmailVerificationToken(token: string): string;
  hashPassword(password: string): Promise<string>;
  hashPasswordResetToken(token: string): string;
  hashSessionToken(token: string): string;
  verifyPassword(password: string, passwordHash: string): Promise<boolean>;
}

export interface AuthServiceDependencies {
  authEmailResponseFloorMs?: number;
  emailDeliveryMode?: "direct" | "outbox";
  emailOutboxEncryptionSecret?: string;
  emailService?: AuthEmailService;
  emailVerificationLink?: Partial<EmailVerificationLinkConfig>;
  emailVerificationTokenTtlMinutes?: number;
  now?: () => Date;
  passwordResetLink?: Partial<PasswordResetLinkConfig>;
  passwordResetTokenTtlMinutes?: number;
  registrationPolicy?: RegistrationPolicy;
  repository: AuthRepository;
  security?: Partial<AuthSecurity>;
}

export function createAuthService({
  authEmailResponseFloorMs = env.authEmailResponseFloorMs,
  emailDeliveryMode = env.emailProvider === "smtp" ? "outbox" : "direct",
  emailOutboxEncryptionSecret = env.emailOutboxEncryptionSecret,
  emailService = authEmailService,
  emailVerificationLink = {},
  emailVerificationTokenTtlMinutes = env.emailVerificationTokenTtlMinutes,
  now = () => new Date(),
  passwordResetLink = {},
  passwordResetTokenTtlMinutes = env.passwordResetTokenTtlMinutes,
  registrationPolicy = defaultRegistrationPolicy,
  repository,
  security,
}: AuthServiceDependencies) {
  const authSecurity: AuthSecurity = {
    createEmailVerificationToken,
    createPasswordResetToken,
    createSessionToken,
    hashEmailVerificationToken,
    hashPassword,
    hashPasswordResetToken,
    hashSessionToken,
    verifyPassword,
    ...security,
  };

  async function register(input: RegisterRequest, _context: AuthRequestContext): Promise<AuthMessageResponse> {
    const responseStartedAt = Date.now();
    assertRegistrationAllowed(input, registrationPolicy);

    const existingUser = await repository.findUserByEmail(input.email);

    if (existingUser) {
      // Keep the public response and expensive password work uniform. An
      // eligible unverified account receives a fresh link; verified accounts
      // are left unchanged.
      await authSecurity.hashPassword(input.password);
      if (existingUser.passwordHash && !existingUser.emailVerifiedAt) {
        await sendEmailVerification(existingUser);
      }
      await waitForAuthEmailResponseFloor(responseStartedAt, authEmailResponseFloorMs);
      return { message: REGISTRATION_VERIFICATION_MESSAGE };
    }

    const passwordHash = await authSecurity.hashPassword(input.password);
    const acceptedTermsAt = now();
    let user: AuthUserRecord;
    try {
      user = await repository.createPasswordUser({
        acceptedTermsAt,
        acceptedTermsVersion: registrationPolicy.currentTermsVersion,
        email: input.email,
        locale: input.locale,
        name: input.name,
        passwordHash,
      });
    } catch (error) {
      if (isUniqueEmailConflict(error)) {
        await waitForAuthEmailResponseFloor(responseStartedAt, authEmailResponseFloorMs);
        return { message: REGISTRATION_VERIFICATION_MESSAGE };
      }
      throw error;
    }

    await sendEmailVerification(user);
    await waitForAuthEmailResponseFloor(responseStartedAt, authEmailResponseFloorMs);

    return {
      message: REGISTRATION_VERIFICATION_MESSAGE,
    };
  }

  async function login(input: LoginRequest, context: AuthRequestContext): Promise<AuthServiceResponse> {
    const user = await repository.findUserByEmail(input.email);

    // Do one real scrypt verification even when no password credential exists.
    // This reduces login email enumeration through the obvious fast-failure path.
    const passwordHash = user?.passwordHash || LOGIN_DUMMY_PASSWORD_HASH;
    const isPasswordValid = await authSecurity.verifyPassword(input.password, passwordHash);

    if (!user?.passwordHash || !isPasswordValid) {
      throwInvalidCredentialsError();
    }

    if (!user.emailVerifiedAt) {
      throwEmailNotVerifiedError();
    }

    return createSessionResponse(user, input.remember, context);
  }

  async function requestPasswordReset(input: ForgotPasswordRequest) {
    const responseStartedAt = Date.now();
    const user = await repository.findUserByEmail(input.email);

    if (user?.passwordHash) {
      const token = authSecurity.createPasswordResetToken();
      const issuedAt = now();
      const expiresAt = addMinutes(issuedAt, passwordResetTokenTtlMinutes);

      const resetUrl = buildPasswordResetUrl(token, {
        appOrigin: passwordResetLink.appOrigin || env.appOrigin,
        resetPath: passwordResetLink.resetPath || env.passwordResetPath,
      });
      const emailJob = createEncryptedEmailJob({
        expiresAt,
        kind: "PASSWORD_RESET",
        url: resetUrl,
        userId: user.id,
      });

      await repository.createPasswordResetToken({
        emailJob: emailDeliveryMode === "outbox" ? emailJob : undefined,
        expiresAt,
        now: issuedAt,
        tokenHash: authSecurity.hashPasswordResetToken(token),
        userId: user.id,
      });

      if (emailDeliveryMode === "direct") {
        await safeSendPasswordResetEmail(emailService, {
          expiresAt,
          resetUrl,
          to: user.email,
        });
      }
    }

    await waitForAuthEmailResponseFloor(responseStartedAt, authEmailResponseFloorMs);

    return {
      message: PASSWORD_RESET_MESSAGE,
    };
  }

  async function verifyEmail(input: VerifyEmailRequest) {
    const tokenHash = authSecurity.hashEmailVerificationToken(input.token);
    const wasVerified = await repository.verifyEmailWithToken({
      now: now(),
      tokenHash,
    });

    if (!wasVerified) {
      throwInvalidVerificationTokenError();
    }

    return {
      ok: true,
    };
  }

  async function resendVerification(input: ResendVerificationRequest) {
    const responseStartedAt = Date.now();
    const user = await repository.findUserByEmail(input.email);

    if (user?.passwordHash && !user.emailVerifiedAt) {
      await sendEmailVerification(user);
    }

    await waitForAuthEmailResponseFloor(responseStartedAt, authEmailResponseFloorMs);

    return {
      message: VERIFICATION_RESEND_MESSAGE,
    };
  }

  async function resetPassword(input: ResetPasswordRequest) {
    const tokenHash = authSecurity.hashPasswordResetToken(input.token);
    const newPasswordHash = await authSecurity.hashPassword(input.newPassword);
    const wasReset = await repository.resetPasswordWithToken({
      newPasswordHash,
      now: now(),
      tokenHash,
    });

    if (!wasReset) {
      throwInvalidResetTokenError();
    }

    return {
      ok: true,
    };
  }

  async function getCurrentUser(sessionToken: string): Promise<PublicAuthUser> {
    const tokenHash = authSecurity.hashSessionToken(sessionToken);
    const session = await repository.findSessionByTokenHash(tokenHash);

    if (!session) {
      throwSessionRequiredError();
    }

    if (session.expiresAt <= now()) {
      await repository.deleteSessionByTokenHash(tokenHash);
      throwSessionRequiredError();
    }

    return toPublicUser(session.user);
  }

  async function getOptionalCurrentUser(sessionToken: string | undefined): Promise<PublicAuthUser | null> {
    if (!sessionToken) {
      return null;
    }

    try {
      return await getCurrentUser(sessionToken);
    } catch (error) {
      if (error instanceof AppError && error.code === "SESSION_REQUIRED") {
        return null;
      }

      throw error;
    }
  }

  async function logout(sessionToken: string | undefined) {
    if (sessionToken) {
      await repository.deleteSessionByTokenHash(authSecurity.hashSessionToken(sessionToken));
    }

    return {
      ok: true,
    };
  }

  async function sendEmailVerification(user: AuthUserRecord) {
    const token = authSecurity.createEmailVerificationToken();
    const issuedAt = now();
    const expiresAt = addMinutes(issuedAt, emailVerificationTokenTtlMinutes);

    const verificationUrl = buildEmailVerificationUrl(token, {
      appOrigin: emailVerificationLink.appOrigin || env.appOrigin,
      verificationPath: emailVerificationLink.verificationPath || env.emailVerificationPath,
    });
    const emailJob = createEncryptedEmailJob({
      expiresAt,
      kind: "EMAIL_VERIFICATION",
      url: verificationUrl,
      userId: user.id,
    });

    await repository.createEmailVerificationToken({
      emailJob: emailDeliveryMode === "outbox" ? emailJob : undefined,
      expiresAt,
      now: issuedAt,
      tokenHash: authSecurity.hashEmailVerificationToken(token),
      userId: user.id,
    });

    if (emailDeliveryMode === "direct") {
      await safeSendEmailVerificationEmail(emailService, {
        expiresAt,
        to: user.email,
        verificationUrl,
      });
    }
  }

  function createEncryptedEmailJob(input: {
    expiresAt: Date;
    kind: "EMAIL_VERIFICATION" | "PASSWORD_RESET";
    url: string;
    userId: string;
  }) {
    const id = randomUUID();
    const context = buildAuthEmailPayloadContext({
      jobId: id,
      kind: input.kind,
      userId: input.userId,
    });

    return {
      encryptedPayload: encryptAuthEmailPayload(
        {
          expiresAt: input.expiresAt.toISOString(),
          url: input.url,
        },
        {
          context,
          secret: emailOutboxEncryptionSecret,
        }
      ),
      id,
    };
  }

  async function createSessionResponse(
    user: AuthUserRecord,
    remember: boolean,
    context: AuthRequestContext
  ): Promise<AuthServiceResponse> {
    const token = authSecurity.createSessionToken();
    const tokenHash = authSecurity.hashSessionToken(token);
    const expiresAt = addDays(now(), remember ? REMEMBER_SESSION_DAYS : DEFAULT_SESSION_DAYS);

    await repository.createSession({
      ...context,
      expiresAt,
      tokenHash,
      userId: user.id,
    });

    return {
      response: {
        session: {
          expiresAt: expiresAt.toISOString(),
        },
        user: toPublicUser(user),
      },
      sessionExpiresAt: expiresAt,
      sessionToken: token,
    };
  }

  return {
    getRegistrationConfig: () => getPublicRegistrationConfig(registrationPolicy),
    getCurrentUser,
    getOptionalCurrentUser,
    login,
    logout,
    register,
    requestPasswordReset,
    resendVerification,
    resetPassword,
    verifyEmail,
  };
}

async function waitForAuthEmailResponseFloor(startedAt: number, floorMs: number) {
  const remainingMs = floorMs - (Date.now() - startedAt);

  if (remainingMs <= 0) return;

  await new Promise<void>((resolve) => {
    setTimeout(resolve, remainingMs);
  });
}

function toPublicUser(user: AuthUserRecord): PublicAuthUser {
  return {
    createdAt: user.createdAt.toISOString(),
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() || null,
    id: user.id,
    locale: user.locale,
    name: user.name,
  };
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function addMinutes(date: Date, minutes: number) {
  const nextDate = new Date(date);
  nextDate.setMinutes(nextDate.getMinutes() + minutes);
  return nextDate;
}

async function safeSendEmailVerificationEmail(
  emailService: AuthEmailService,
  message: Parameters<AuthEmailService["sendEmailVerificationEmail"]>[0]
) {
  try {
    await emailService.sendEmailVerificationEmail(message);
  } catch {
    // Keep register/resend responses token-safe even if email delivery fails.
    logAuthEmailDeliveryFailed({ operation: "email_verification" });
  }
}

async function safeSendPasswordResetEmail(
  emailService: AuthEmailService,
  message: Parameters<AuthEmailService["sendPasswordResetEmail"]>[0]
) {
  try {
    await emailService.sendPasswordResetEmail(message);
  } catch {
    // Keep forgot-password responses generic and non-enumerating even if email delivery fails.
    logAuthEmailDeliveryFailed({ operation: "password_reset" });
  }
}

function throwInvalidCredentialsError(): never {
  throw new AppError("Invalid email or password.", 401, "INVALID_CREDENTIALS");
}

function throwEmailNotVerifiedError(): never {
  throw new AppError("Please verify your email before signing in.", 403, "EMAIL_NOT_VERIFIED");
}

function throwSessionRequiredError(): never {
  throw new AppError("Authentication is required.", 401, "SESSION_REQUIRED");
}

function throwInvalidResetTokenError(): never {
  throw new AppError("Invalid or expired reset token.", 400, "INVALID_RESET_TOKEN");
}

function throwInvalidVerificationTokenError(): never {
  throw new AppError("Invalid or expired verification token.", 400, "INVALID_VERIFICATION_TOKEN");
}

function isUniqueEmailConflict(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    (error as Record<string, unknown>).code === "P2002"
  );
}

export const authService = createAuthService({
  repository: authRepository,
});
