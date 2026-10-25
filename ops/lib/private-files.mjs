import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export function requireCondition(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

export async function privateDirectory(path) {
  requireCondition(typeof path === 'string' && isAbsolute(path), 'OPS_ABSOLUTE_DIRECTORY_REQUIRED');
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  requireCondition(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === resolve(path), 'OPS_UNSAFE_DIRECTORY');
  if (process.platform !== 'win32') requireCondition((info.mode & 0o077) === 0, 'OPS_DIRECTORY_PERMISSIONS');
  return resolve(path);
}

export async function readPrivate(path, maxBytes = 16_384) {
  requireCondition(typeof path === 'string' && isAbsolute(path), 'OPS_ABSOLUTE_FILE_REQUIRED');
  requireCondition(await realpath(path) === resolve(path), 'OPS_SYMLINK_FILE');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    requireCondition(info.isFile() && info.size <= maxBytes, 'OPS_INVALID_PRIVATE_FILE');
    if (process.platform !== 'win32') requireCondition((info.mode & 0o077) === 0, 'OPS_FILE_PERMISSIONS');
    return await file.readFile();
  } finally { await file.close(); }
}

/** Same-directory replacement; a crash cannot leave a half-written status. */
export async function atomicJson(path, value, { beforeCommit } = {}) {
  await privateDirectory(dirname(path));
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value) + '\n'); await file.sync(); }
    finally { await file.close(); }
    // Recheck publication authority after asynchronous disk work, immediately
    // before enqueuing rename. The caller retains its local fence through fsync.
    beforeCommit?.();
    await rename(temp, path); await syncDirectory(dirname(path));
  }
  finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function syncDirectory(path) {
  // Linux is the deployment target. Windows cannot open a directory for fsync.
  if (process.platform === 'win32') return;
  const file = await open(path, 'r'); try { await file.sync(); } finally { await file.close(); }
}
