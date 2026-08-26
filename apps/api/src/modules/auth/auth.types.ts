import type { z } from "zod";

import type {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resendVerificationRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
} from "./auth.schema.js";

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;
export type ResendVerificationRequest = z.infer<typeof resendVerificationRequestSchema>;

export interface AuthRequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthUserRecord {
  acceptedTermsAt: Date | null;
  acceptedTermsVersion: string | null;
  createdAt: Date;
  email: string;
  emailVerifiedAt: Date | null;
  id: string;
  locale: string;
  name: string | null;
  passwordHash: string | null;
  updatedAt: Date;
}

export interface PublicAuthUser {
  createdAt: string;
  email: string;
  emailVerifiedAt: string | null;
  id: string;
  locale: string;
  name: string | null;
}

export interface AuthSessionResponse {
  expiresAt: string;
}

export interface AuthResponse {
  session: AuthSessionResponse;
  user: PublicAuthUser;
}

export interface AuthMessageResponse {
  message: string;
}

export interface AuthServiceResponse {
  response: AuthResponse;
  sessionExpiresAt: Date;
  sessionToken: string;
}

export interface AuthSessionRecord {
  expiresAt: Date;
  id: string;
  user: AuthUserRecord;
  userId: string;
}

export interface CreatePasswordUserInput {
  acceptedTermsAt: Date;
  acceptedTermsVersion: string;
  email: string;
  locale: string;
  name?: string;
  passwordHash: string;
}

export interface CreateSessionInput extends AuthRequestContext {
  expiresAt: Date;
  tokenHash: string;
  userId: string;
}

export interface CreateAuthEmailJobInput {
  encryptedPayload: string;
  id: string;
}

export interface CreatePasswordResetTokenInput {
  emailJob?: CreateAuthEmailJobInput;
  expiresAt: Date;
  now: Date;
  tokenHash: string;
  userId: string;
}

export interface CreateEmailVerificationTokenInput {
  emailJob?: CreateAuthEmailJobInput;
  expiresAt: Date;
  now: Date;
  tokenHash: string;
  userId: string;
}

export interface ResetPasswordWithTokenInput {
  newPasswordHash: string;
  now: Date;
  tokenHash: string;
}

export interface VerifyEmailWithTokenInput {
  now: Date;
  tokenHash: string;
}

export interface AuthRepository {
  createPasswordUser(input: CreatePasswordUserInput): Promise<AuthUserRecord>;
  createEmailVerificationToken(input: CreateEmailVerificationTokenInput): Promise<void>;
  createPasswordResetToken(input: CreatePasswordResetTokenInput): Promise<void>;
  createSession(input: CreateSessionInput): Promise<void>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null>;
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  resetPasswordWithToken(input: ResetPasswordWithTokenInput): Promise<boolean>;
  verifyEmailWithToken(input: VerifyEmailWithTokenInput): Promise<boolean>;
}
