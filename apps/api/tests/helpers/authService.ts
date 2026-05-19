import { createAuthService, type AuthSecurity } from "../../src/modules/auth/auth.service.ts";
import type {
  AuthRepository,
  CreatePasswordUserInput,
  CreateSessionInput,
} from "../../src/modules/auth/auth.repository.ts";
import type { AuthSessionRecord, AuthUserRecord } from "../../src/modules/auth/auth.types.ts";

export const NOW = new Date("2026-05-19T00:00:00.000Z");
export const EXPIRED_SESSION = new Date("2026-05-18T00:00:00.000Z");

const FUTURE_SESSION = new Date("2026-05-26T00:00:00.000Z");

export function setupAuthService(options: AuthServiceTestOptions = {}) {
  const repository = createFakeAuthRepository(options.users);
  const service = createAuthService({
    now: options.now || (() => NOW),
    repository,
    security: createFakeSecurity(options.security),
  });

  return {
    repository,
    service,
  };
}

export interface AuthServiceTestOptions {
  now?: () => Date;
  security?: Partial<AuthSecurity>;
  users?: AuthUserRecord[];
}

export function createUserRecord(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  const createdAt = overrides.createdAt ?? NOW;

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
    addSession(user: AuthUserRecord, overrides?: Partial<CreateSessionInput>): void;
    sessions: CreateSessionInput[];
    users: AuthUserRecord[];
  };

  return repository;
}
