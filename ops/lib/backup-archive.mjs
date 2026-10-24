import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, appendFile, link, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { basename, dirname } from 'node:path';
import { requireCondition, syncDirectory } from './private-files.mjs';

const MAGIC = 'ODDPATH_BACKUP_V1\n';
export const ARCHIVE_NAME = /^oddpath-(\d{8}T\d{9}Z)-[a-f0-9-]{36}\.opb$/;
export const MAX_ARCHIVE_BYTES = 5 * 1024 ** 3;
export function backupHeader(key, now = new Date(), scope = 'CLOSED_DATABASE_ONLY') {
  requireCondition(Buffer.isBuffer(key) && key.length === 32, 'BACKUP_KEY_INVALID');
  requireCondition(['CLOSED_DATABASE_ONLY','FULL_SYSTEM','KEY_ESCROW'].includes(scope), 'BACKUP_SCOPE_INVALID');
  const metadata = { version: scope === 'CLOSED_DATABASE_ONLY' ? 1 : 2, id: randomUUID(), createdAt: now.toISOString(), scope,
    keyId: createHash('sha256').update(key).digest('hex').slice(0, 16), iv: randomBytes(12).toString('base64url') };
  return { metadata, bytes: Buffer.from(MAGIC + JSON.stringify(metadata) + '\n') };
}
export function archiveName(metadata) { return `oddpath-${metadata.createdAt.replace(/[-:.]/g, '')}-${metadata.id}.opb`; }

/** The dump streams straight into authenticated encryption; never to plaintext. */
export async function encryptDump(input, part, destination, key, { signal, header = backupHeader(key) } = {}) {
  const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(header.metadata.iv, 'base64url'));
  cipher.setAAD(header.bytes);
  const output = createWriteStream(part, { flags: 'wx', mode: 0o600 });
  output.write(header.bytes);
  let bytes = header.bytes.length + 16;
  const bounded = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    callback(bytes > MAX_ARCHIVE_BYTES ? new Error('BACKUP_ARCHIVE_SIZE_INVALID') : null, chunk);
  } });
  await pipeline(input, bounded, cipher, output, { signal });
  await appendFile(part, cipher.getAuthTag());
  const file = await open(part, 'r+'); try { await file.sync(); } finally { await file.close(); }
  // Exclusive publication: an existing valid backup is never overwritten.
  await link(part, destination); await unlink(part); await syncDirectory(dirname(destination));
  return header.metadata;
}

export async function readHeader(file, expectedScope = 'CLOSED_DATABASE_ONLY') {
  const info = await file.stat();
  requireCondition(info.isFile() && info.size > 80 && info.size <= MAX_ARCHIVE_BYTES, 'BACKUP_ARCHIVE_SIZE_INVALID');
  const prefix = Buffer.alloc(Math.min(2048, info.size));
  const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
  requireCondition(prefix.subarray(0, MAGIC.length).toString() === MAGIC, 'BACKUP_FORMAT_INVALID');
  const end = prefix.indexOf(10, MAGIC.length);
  requireCondition(end > MAGIC.length && end < bytesRead, 'BACKUP_HEADER_INVALID');
  let metadata; try { metadata = JSON.parse(prefix.subarray(MAGIC.length, end).toString()); } catch { throw new Error('BACKUP_HEADER_INVALID'); }
  requireCondition(metadata.scope === expectedScope && metadata.version === (expectedScope === 'CLOSED_DATABASE_ONLY' ? 1 : 2) &&
    /^[a-f0-9-]{36}$/.test(metadata.id) && /^[a-f0-9]{16}$/.test(metadata.keyId) &&
    typeof metadata.createdAt === 'string' && new Date(metadata.createdAt).toISOString() === metadata.createdAt &&
    typeof metadata.iv === 'string' && Buffer.from(metadata.iv, 'base64url').length === 12, 'BACKUP_HEADER_INVALID');
  return { metadata, bytes: prefix.subarray(0, end + 1), size: info.size };
}

/** Authenticate ALL bytes before any restored DB connection or mutation. */
export async function decryptDump(archive, destination, key, { signal, expectedScope = 'CLOSED_DATABASE_ONLY' } = {}) {
  const file = await open(archive, 'r');
  try {
    const header = await readHeader(file, expectedScope), tag = Buffer.alloc(16);
    requireCondition(header.metadata.keyId === createHash('sha256').update(key).digest('hex').slice(0, 16), 'BACKUP_KEY_MISMATCH');
    requireCondition(basename(archive) === archiveName(header.metadata), 'BACKUP_FILENAME_MISMATCH');
    await file.read(tag, 0, 16, header.size - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.metadata.iv, 'base64url'));
    decipher.setAAD(header.bytes); decipher.setAuthTag(tag);
    await pipeline(file.createReadStream({ start: header.bytes.length, end: header.size - 17, autoClose: false }), decipher,
      createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal });
    return header.metadata;
  } finally { await file.close(); }
}

export function dateFromArchiveName(name) {
  const matched = ARCHIVE_NAME.exec(name); if (!matched) return undefined;
  const s = matched[1], iso = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}:${s.slice(13,15)}.${s.slice(15,18)}Z`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && date.toISOString() === iso ? date : undefined;
}
