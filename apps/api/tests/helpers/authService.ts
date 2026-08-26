import { createAuthService, type AuthSecurity } from "../../src/modules/auth/auth.service.ts";
import type { AuthEmailService } from "../../src/modules/auth/auth.email.ts";
import type {
  AuthRepository,
  AuthSessionRecord,
  AuthUserRecord,
  CreateEmailVerificationTokenInput,
  CreatePasswordResetTokenInput,
  CreatePasswordUserInput,
  CreateSessionInput,
  ResetPasswordWithTokenInput,
  VerifyEmailWithTokenInput,
} from "../../src/modules/auth/auth.types.ts";
import type { RegistrationPolicy } from "../../src/modules/auth/registration-policy.ts";

export const NOW = new Date("2026-05-19T00:00:00.000Z");
export const EXPIRED_SESSION = new Date("2026-05-18T00:00:00.000Z");

const FUTURE_SESSION = new Date("2026-05-26T00:00:00.000Z");

export function setupAuthService(options: AuthServiceTestOptions = {}) {
  const repository = createFakeAuthRepository(options.users);
  const service = createAuthService({
    authEmailResponseFloorMs: options.authEmailResponseFloorMs,
    emailDeliveryMode: options.emailDeliveryMode,
    emailOutboxEncryptionSecret: options.emailOutboxEncryptionSecret,
    emailService: options.emailService,
    emailVerificationLink: options.emailVerificationLink,
    emailVerificationTokenTtlMinutes: options.emailVerificationTokenTtlMinutes,
    now: options.now || (() => NOW),
    passwordResetLink: options.passwordResetLink,
    passwordResetTokenTtlMinutes: options.passwordResetTokenTtlMinutes,
    registrationPolicy: options.registrationPolicy,
    repository,
    security: createFakeSecurity(options.security),
  });

  return {
    repository,
    service,
  };
}

export interface AuthServiceTestOptions {
  authEmailResponseFloorMs?: number;
  emailDeliveryMode?: "direct" | "outbox";
  emailOutboxEncryptionSecret?: string;
  emailService?: AuthEmailService;
  emailVerificationLink?: {
    appOrigin?: string;
    verificationPath?: string;
  };
  emailVerificationTokenTtlMinutes?: number;
  now?: () => Date;
  passwordResetLink?: {
    appOrigin?: string;
    resetPath?: string;
  };
  passwordResetTokenTtlMinutes?: number;
  registrationPolicy?: RegistrationPolicy;
  security?: Partial<AuthSecurity>;
  users?: AuthUserRecord[];
}

export function createUserRecord(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  const createdAt = overrides.createdAt ?? NOW;

  return {
    acceptedTermsAt: null,
    acceptedTermsVersion: null,
    createdAt,
    email: "person@example.com",
    emailVerifiedAt: NOW,
    id: "user-1",
    locale: "en",
    name: null,
    passwordHash: "stored-password-hash",
    updatedAt: createdAt,
    ...overrides,
  };
}

function createFakeSecurity(overrides: Partial<AuthSecurity> = {}): AuthSecurity {
  return {
    createEmailVerificationToken: () => "verification-token",
    createPasswordResetToken: () => "reset-token",
    createSessionToken: () => "session-token",
    hashEmailVerificationToken: (token) => `hashed-verification:${token}`,
    hashPassword: async (password) => `hashed-password:${password}`,
    hashPasswordResetToken: (token) => `hashed-reset:${token}`,
    hashSessionToken: (token) => `hashed-session:${token}`,
    verifyPassword: async () => true,
    ...overrides,
  };
}

type FakeEmailVerificationToken = CreateEmailVerificationTokenInput & {
  createdAt: Date;
  id: string;
  usedAt: Date | null;
};

type FakePasswordResetToken = CreatePasswordResetTokenInput & {
  createdAt: Date;
  id: string;
  usedAt: Date | null;
};

interface FakeAuthRepository extends AuthRepository {
  addSession(user: AuthUserRecord, overrides?: Partial<CreateSessionInput>): void;
  emailVerificationTokens: FakeEmailVerificationToken[];
  passwordResetTokens: FakePasswordResetToken[];
  sessions: CreateSessionInput[];
  users: AuthUserRecord[];
}

function createFakeAuthRepository(initialUsers: AuthUserRecord[] = []) {
  const repository: FakeAuthRepository = {
    emailVerificationTokens: [],
    passwordResetTokens: [],
    sessions: [] as CreateSessionInput[],
    users: [...initialUsers],

    addSession(user: AuthUserRecord, overrides: Partial<CreateSessionInput> = {}) {
      repository.sessions.push({
        expiresAt: FUTURE_SESSION,
        tokenHash: "hashed-session:session-token",
        userId: user.id,
        ...overrides,
      });
    },

    async createPasswordUser(input: CreatePasswordUserInput) {
      const user = createUserRecord({
        acceptedTermsAt: input.acceptedTermsAt,
        acceptedTermsVersion: input.acceptedTermsVersion,
        email: input.email,
        id: `user-${repository.users.length + 1}`,
        locale: input.locale,
        name: input.name ?? null,
        passwordHash: input.passwordHash,
        emailVerifiedAt: null,
      });

      repository.users.push(user);
      return user;
    },

    async createPasswordResetToken(input: CreatePasswordResetTokenInput) {
      for (const token of repository.passwordResetTokens) {
        if (token.userId === input.userId && !token.usedAt) {
          token.usedAt = input.now;
        }
      }

      repository.passwordResetTokens.push({
        ...input,
        createdAt: NOW,
        id: `reset-token-${repository.passwordResetTokens.length + 1}`,
        usedAt: null,
      });
    },

    async createEmailVerificationToken(input: CreateEmailVerificationTokenInput) {
      for (const token of repository.emailVerificationTokens) {
        if (token.userId === input.userId && !token.usedAt) {
          token.usedAt = input.now;
        }
      }

      repository.emailVerificationTokens.push({
        ...input,
        createdAt: NOW,
        id: `verification-token-${repository.emailVerificationTokens.length + 1}`,
        usedAt: null,
      });
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

    async resetPasswordWithToken(input: ResetPasswordWithTokenInput) {
      const token = repository.passwordResetTokens.find((item) => item.tokenHash === input.tokenHash);

      if (!token || token.usedAt || token.expiresAt <= input.now) {
        return false;
      }

      const user = repository.users.find((item) => item.id === token.userId);

      if (!user) {
        return false;
      }

      token.usedAt = input.now;
      user.passwordHash = input.newPasswordHash;
      repository.sessions = repository.sessions.filter((session) => session.userId !== token.userId);

      return true;
    },

    async verifyEmailWithToken(input: VerifyEmailWithTokenInput) {
      const token = repository.emailVerificationTokens.find((item) => item.tokenHash === input.tokenHash);

      if (!token || token.usedAt || token.expiresAt <= input.now) {
        return false;
      }

      const user = repository.users.find((item) => item.id === token.userId);

      if (!user) {
        return false;
      }

      token.usedAt = input.now;

      if (!user.emailVerifiedAt) {
        user.emailVerifiedAt = input.now;
      }

      for (const otherToken of repository.emailVerificationTokens) {
        if (otherToken.userId === token.userId && otherToken.id !== token.id && !otherToken.usedAt) {
          otherToken.usedAt = input.now;
        }
      }

      return true;
    },
  };

  return repository;
}
