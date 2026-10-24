import { z } from 'zod';

// Deliberately supports cookies/localStorage only; never arbitrary profile files.
export const browserStorageStateSchema = z.object({
  cookies: z.array(z.object({
    name: z.string().max(1024), value: z.string().max(16384), domain: z.string().min(1).max(253), path: z.string().min(1).max(2048),
    expires: z.number().finite(), httpOnly: z.boolean(), secure: z.boolean(), sameSite: z.enum(['Strict','Lax','None']),
  }).strict()).max(300),
  origins: z.array(z.object({ origin: z.string().url().max(2000), localStorage: z.array(z.object({ name: z.string().max(1024), value: z.string().max(16384) }).strict()).max(250) }).strict()).max(21),
}).strict();
export const MAX_BROWSER_STATE_BYTES = 256 * 1024;
export const SAVED_LOGIN_MAX_MS = 7 * 24 * 60 * 60 * 1000;
export function browserCookieDomainAllowed(domain:string,allowedOrigins:string[]){
  const root=domain.replace(/^\./u,'').toLowerCase();
  return root.includes('.')&&allowedOrigins.some(origin=>{const host=new URL(origin).hostname;return host===root||(domain.startsWith('.')&&host.endsWith('.'+root));});
}
export function parseBrowserStorageState(raw: unknown, allowedOrigins: string[]) {
  const state = browserStorageStateSchema.parse(raw), origins = new Set(allowedOrigins);
  if (Buffer.byteLength(JSON.stringify(state), 'utf8') > MAX_BROWSER_STATE_BYTES
    || state.origins.some(entry => !origins.has(entry.origin))
    || state.cookies.some(cookie => !browserCookieDomainAllowed(cookie.domain,allowedOrigins)
      || !cookie.path.startsWith('/') || /[\u0000-\u0020\u007f]/u.test(cookie.domain))) throw new Error('Browser state is unsupported or outside the approved authentication origins.');
  return state;
}
export const sealedBrowserStateSchema = z.object({
  keyVersion: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/u),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u), tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  ciphertext: z.string().min(1).max(350000).regex(/^[A-Za-z0-9_-]+$/u),
}).strict();
export const browserStateTransferContextSchema = z.object({
  purpose: z.enum(['CAPTURE','RESTORE']), executionId: z.string().min(1).max(120), runtimeId: z.string().uuid(),
  claimId: z.string().uuid(), bindingHash: z.string().regex(/^[a-f0-9]{64}$/u),
  controlEpoch: z.string().uuid(), expiresAt: z.number().int().positive(),
}).strict();
export const browserStateTransferSchema = z.object({ context: browserStateTransferContextSchema, packet: sealedBrowserStateSchema }).strict();
export const savedLoginConsentSchema = z.object({ controlEpoch: z.string().uuid(), saveLogin: z.boolean() }).strict();
export type BrowserStateTransfer = z.infer<typeof browserStateTransferSchema>;
