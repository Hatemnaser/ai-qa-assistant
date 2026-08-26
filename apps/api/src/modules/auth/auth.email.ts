import nodemailer, { type SendMailOptions } from "nodemailer";

import { env, type AppEnv } from "../../config/env.js";

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

export interface AuthEmailTransporter {
  sendMail(message: SendMailOptions): Promise<unknown>;
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
    // Explicitly configured no-op delivery for local development only.
  }

  async sendPasswordResetEmail() {
    // Explicitly configured no-op delivery for local development only.
  }
}

export class SmtpAuthEmailService implements AuthEmailService {
  constructor(
    private readonly config: {
      from: string;
      transporter: AuthEmailTransporter;
    }
  ) {}

  async sendEmailVerificationEmail(message: EmailVerificationEmailMessage) {
    await this.config.transporter.sendMail({
      from: this.config.from,
      subject: "Verify your Oddpath email",
      text: buildEmailVerificationText(message),
      to: message.to,
    });
  }

  async sendPasswordResetEmail(message: PasswordResetEmailMessage) {
    await this.config.transporter.sendMail({
      from: this.config.from,
      subject: "Reset your Oddpath password",
      text: buildPasswordResetText(message),
      to: message.to,
    });
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

export function createSmtpTransporter(config: AppEnv = env): AuthEmailTransporter {
  return nodemailer.createTransport(buildSmtpTransportOptions(config));
}

export function buildSmtpTransportOptions(config: AppEnv = env) {
  return {
    auth: {
      pass: config.smtpPass,
      user: config.smtpUser,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    host: config.smtpHost,
    port: config.smtpPort,
    requireTLS: !config.smtpSecure,
    secure: config.smtpSecure,
    socketTimeout: 30_000,
  };
}

export function createAuthEmailService(config: AppEnv = env) {
  if (config.emailProvider === "smtp") {
    return new SmtpAuthEmailService({
      from: config.emailFrom,
      transporter: createSmtpTransporter(config),
    });
  }

  if (config.emailProvider === "noop") {
    return new NoopAuthEmailService();
  }

  return new InMemoryAuthEmailService();
}

function withTrailingSlash(origin: string) {
  return origin.endsWith("/") ? origin : `${origin}/`;
}

function buildPasswordResetText(message: PasswordResetEmailMessage) {
  return [
    "We received a request to reset your Oddpath password.",
    `Open this link to choose a new password: ${message.resetUrl}`,
    `This link expires at ${message.expiresAt.toISOString()}.`,
    "If you did not request a password reset, you can ignore this email.",
  ].join("\n\n");
}

function buildEmailVerificationText(message: EmailVerificationEmailMessage) {
  return [
    "Please verify your Oddpath email address.",
    `Open this link to verify your email: ${message.verificationUrl}`,
    `This link expires at ${message.expiresAt.toISOString()}.`,
    "If you did not create an account, you can ignore this email.",
  ].join("\n\n");
}

export const authEmailService = createAuthEmailService();
