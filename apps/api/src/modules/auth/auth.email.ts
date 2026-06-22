import { env } from "../../config/env.js";

export interface PasswordResetEmailMessage {
  expiresAt: Date;
  resetUrl: string;
  to: string;
}

export interface EmailVerificationEmailMessage {
  expiresAt: Date;
  to: string;
  verificationUrl: string;
}

export interface AuthEmailService {
  sendEmailVerificationEmail(message: EmailVerificationEmailMessage): Promise<void>;
  sendPasswordResetEmail(message: PasswordResetEmailMessage): Promise<void>;
}

export interface PasswordResetLinkConfig {
  appOrigin: string;
  resetPath: string;
}

export interface EmailVerificationLinkConfig {
  appOrigin: string;
  verificationPath: string;
}

export class InMemoryAuthEmailService implements AuthEmailService {
  readonly emailVerificationEmails: EmailVerificationEmailMessage[] = [];
  readonly passwordResetEmails: PasswordResetEmailMessage[] = [];

  async sendEmailVerificationEmail(message: EmailVerificationEmailMessage) {
    this.emailVerificationEmails.push({
      ...message,
    });
  }

  async sendPasswordResetEmail(message: PasswordResetEmailMessage) {
    this.passwordResetEmails.push({
      ...message,
    });
  }
}

export class NoopAuthEmailService implements AuthEmailService {
  async sendEmailVerificationEmail() {
    // Production email provider wiring is intentionally left to a later slice.
  }

  async sendPasswordResetEmail() {
    // Production email provider wiring is intentionally left to a later slice.
  }
}

export function buildPasswordResetUrl(
  token: string,
  config: PasswordResetLinkConfig = {
    appOrigin: env.appOrigin,
    resetPath: env.passwordResetPath,
  }
) {
  return buildSpaTokenUrl(token, {
    appOrigin: config.appOrigin,
    path: config.resetPath,
  });
}

export function buildEmailVerificationUrl(
  token: string,
  config: EmailVerificationLinkConfig = {
    appOrigin: env.appOrigin,
    verificationPath: env.emailVerificationPath,
  }
) {
  return buildSpaTokenUrl(token, {
    appOrigin: config.appOrigin,
    path: config.verificationPath,
  });
}

export function buildSpaTokenUrl(
  token: string,
  config: {
    appOrigin: string;
    path: string;
  }
) {
  const hashIndex = config.path.indexOf("#");

  if (hashIndex >= 0) {
    const basePath = config.path.slice(0, hashIndex) || "/";
    const hashFragment = config.path.slice(hashIndex + 1);
    const url = new URL(basePath, withTrailingSlash(config.appOrigin));
    const [hashPath, hashQuery = ""] = hashFragment.split("?", 2);
    const hashSearchParams = new URLSearchParams(hashQuery);

    hashSearchParams.set("token", token);
    const hashQueryString = hashSearchParams.toString();
    url.hash = `${hashPath}${hashQueryString ? `?${hashQueryString}` : ""}`;

    return url.toString();
  }

  const url = new URL(config.path, withTrailingSlash(config.appOrigin));
  url.searchParams.set("token", token);

  return url.toString();
}

export function createAuthEmailService() {
  if (env.nodeEnv === "production") {
    return new NoopAuthEmailService();
  }

  return new InMemoryAuthEmailService();
}

function withTrailingSlash(origin: string) {
  return origin.endsWith("/") ? origin : `${origin}/`;
}

export const authEmailService = createAuthEmailService();
