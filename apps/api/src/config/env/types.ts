export type CookieSameSite = "lax" | "none" | "strict";
export type EmailProvider = "" | "noop" | "smtp";
export type RegistrationMode = "disabled" | "invite" | "public";

export type EnvSource = Record<string, string | undefined>;

export interface EnvLoadContext {
  nodeEnv: string;
  source: EnvSource;
}

export interface EnvValidationContext {
  appOriginProvided: boolean;
  corsOriginProvided: boolean;
  csrfSecretProvided: boolean;
  databaseUrlProvided: boolean;
  smtpPortProvided: boolean;
  trustProxyHopsProvided: boolean;
}
