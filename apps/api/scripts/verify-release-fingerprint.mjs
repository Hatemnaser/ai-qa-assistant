import { createHash } from 'node:crypto';
import { lstat, readFile, readlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const ROOT_INPUTS = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.node-version', '.npmrc', '.gitignore', '.dockerignore', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml', 'render.yaml']);

export function isReleaseInput(path) {
  return !/\.md$/i.test(path) && (ROOT_INPUTS.has(path) || ['apps/', 'packages/', 'deploy/', 'ops/', '.github/workflows/'].some(prefix => path.startsWith(prefix)));
}

/** The caller obtains paths using git ls-files --cached --others --exclude-standard -z. */
export async function fingerprintSourceFiles(root, paths) {
  const files = [];
  for (const path of [...new Set(paths)].filter(isReleaseInput).sort()) {
    const absolute = resolve(root, path), inside = relative(root, absolute);
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error('Invalid release fingerprint input path');
    try {
      const info = await lstat(absolute);
      if (!info.isFile() && !info.isSymbolicLink()) throw new Error(`Unsupported release input: ${path}`);
      const kind = info.isSymbolicLink() ? 'symlink' : 'file';
      const contents = kind === 'symlink' ? await readlink(absolute) : await readFile(absolute);
      files.push({ path, kind, sha256: createHash('sha256').update(contents).digest('hex') });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Preserve pre-existing Working Tree deletions in the fingerprint too.
      files.push({ path, kind: 'missing', sha256: null });
    }
  }
  if (!files.length) throw new Error('No maintained release inputs were discovered');
  return { algorithm: 'SHA256', digest: createHash('sha256').update(JSON.stringify(files)).digest('hex'), fileCount: files.length, files };
}

export function changedFingerprintPaths(before, after) {
  const old = new Map(before.files.map(file => [file.path, JSON.stringify(file)]));
  const current = new Map(after.files.map(file => [file.path, JSON.stringify(file)]));
  return [...new Set([...old.keys(), ...current.keys()])].filter(path => old.get(path) !== current.get(path)).sort();
}
