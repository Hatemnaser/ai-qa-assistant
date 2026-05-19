import type { z } from "zod";

import type {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
} from "./auth.schema.js";

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export interface AuthRequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthUserRecord {
  createdAt: Date;
  email: string;
  id: string;
  locale: string;
  name: string | null;
  passwordHash: string | null;
  updatedAt: Date;
}

export interface PublicAuthUser {
  createdAt: string;
  email: string;
  id: string;
  locale: string;
  name: string | null;
}

export interface AuthSessionResponse {
  expiresAt: string;
  token: string;
}

export interface AuthResponse {
  session: AuthSessionResponse;
  user: PublicAuthUser;
}
