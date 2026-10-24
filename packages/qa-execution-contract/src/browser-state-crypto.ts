import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { sealedBrowserStateSchema, MAX_BROWSER_STATE_BYTES } from './browser-state.js';

export interface BrowserStateKeys { activeVersion: string; keys: Record<string,string> }
export function validateBrowserStateKeys(keys: BrowserStateKeys) {
  if (!keys || typeof keys.activeVersion!=='string' || !keys.keys || Array.isArray(keys.keys) || !/^[a-zA-Z0-9_-]{1,40}$/u.test(keys.activeVersion) || !Object.hasOwn(keys.keys,keys.activeVersion)
    || Object.keys(keys.keys).length > 20 || Object.entries(keys.keys).some(([version,key]) => !/^[a-zA-Z0-9_-]{1,40}$/u.test(version) || !/^[a-f0-9]{64}$/u.test(key))) throw new Error('Invalid versioned browser-state keyring.');
  return keys;
}
function aad(context: Record<string, unknown>) { return Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(context).sort().map(key => [key,context[key]])))); }
export function sealBrowserState(value: unknown, context: Record<string, unknown>, keys: BrowserStateKeys) {
  validateBrowserStateKeys(keys);
  const body = Buffer.from(JSON.stringify(value)); if (body.length > MAX_BROWSER_STATE_BYTES) throw new Error('Browser state exceeds its limit.');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm',Buffer.from(keys.keys[keys.activeVersion]!,'hex'),iv);
  cipher.setAAD(aad(context)); const ciphertext = Buffer.concat([cipher.update(body),cipher.final()]); body.fill(0);
  return sealedBrowserStateSchema.parse({ keyVersion: keys.activeVersion, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') });
}
export function unsealBrowserState(raw: unknown, context: Record<string, unknown>, keys: BrowserStateKeys): unknown {
  validateBrowserStateKeys(keys); const packet = sealedBrowserStateSchema.parse(raw), key = keys.keys[packet.keyVersion];
  if (typeof key!=='string'||!Object.hasOwn(keys.keys,packet.keyVersion)) throw new Error('Browser-state key version is unavailable.');
  const decipher = createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(packet.iv,'base64url'));
  decipher.setAAD(aad(context)); decipher.setAuthTag(Buffer.from(packet.tag,'base64url'));
  const body = Buffer.concat([decipher.update(Buffer.from(packet.ciphertext,'base64url')),decipher.final()]);
  try { if (body.length > MAX_BROWSER_STATE_BYTES) throw new Error('Browser state exceeds its limit.'); return JSON.parse(body.toString('utf8')); }
  finally { body.fill(0); }
}
