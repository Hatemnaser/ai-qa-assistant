import { AppError } from "../../lib/errors.js";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "./auth.security.js";
import { authRepository, type AuthRepository } from "./auth.repository.js";
import type {
  AuthRequestContext,
  AuthResponse,
  AuthUserRecord,
  ForgotPasswordRequest,
  LoginRequest,
  PublicAuthUser,
  RegisterRequest,
} from "./auth.types.js";

const DEFAULT_SESSION_DAYS = 7;
const REMEMBER_SESSION_DAYS = 30;
const PASSWORD_RESET_MESSAGE =
  "If an account exists for that email, password reset instructions will be sent.";

export interface AuthSecurity {
  createSessionToken(): string;
  hashPassword(password: string): Promise<string>;
  hashSessionToken(token: string): string;
  verifyPassword(password: string, passwordHash: string): Promise<boolean>;
}

export interface AuthServiceDependencies {
  now?: () => Date;
  repository: AuthRepository;
  security?: Partial<AuthSecurity>;
}

export function createAuthService({ now = () => new Date(), repository, security }: AuthServiceDependencies) {
  const authSecurity: AuthSecurity = {
    createSessionToken,
    hashPassword,
    hashSessionToken,
    verifyPassword,
    ...security,
  };

  async function register(input: RegisterRequest, context: AuthRequestContext): Promise<AuthResponse> {
    const existingUser = await repository.findUserByEmail(input.email);

    if (existingUser) {
      throw new AppError("An account with this email already exists.", 409, "EMAIL_ALREADY_REGISTERED");
    }

    const passwordHash = await authSecurity.hashPassword(input.password);
    const user = await repository.createPasswordUser({
      email: input.email,
      locale: input.locale,
      name: input.name,
      passwordHash,
    });

    return createSessionResponse(user, false, context);
  }

  async function login(input: LoginRequest, context: AuthRequestContext): Promise<AuthResponse> {
    const user = await repository.findUserByEmail(input.email);

    if (!user?.passwordHash) {
      throwInvalidCredentialsError();
    }

    const isPasswordValid = await authSecurity.verifyPassword(input.password, user.passwordHash);

    if (!isPasswordValid) {
      throwInvalidCredentialsError();
    }

    return createSessionResponse(user, input.remember, context);
  }

  async function requestPasswordReset(input: ForgotPasswordRequest) {
    await repository.findUserByEmail(input.email);

    return {
      message: PASSWORD_RESET_MESSAGE,
    };
  }

  async function createSessionResponse(
    user: AuthUserRecord,
    remember: boolean,
    context: AuthRequestContext
  ): Promise<AuthResponse> {
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
      session: {
        expiresAt: expiresAt.toISOString(),
        token,
      },
      user: toPublicUser(user),
    };
  }

  return {
    login,
    register,
    requestPasswordReset,
  };
}

function toPublicUser(user: AuthUserRecord): PublicAuthUser {
  return {
    createdAt: user.createdAt.toISOString(),
    email: user.email,
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

function throwInvalidCredentialsError(): never {
  throw new AppError("Invalid email or password.", 401, "INVALID_CREDENTIALS");
}

export const authService = createAuthService({
  repository: authRepository,
});
