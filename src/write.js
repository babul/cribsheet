import fs from 'node:fs';
import path from 'node:path';
import { error, refused } from './errors.js';

/**
 * Replace `target` atomically: temp file in the same directory, fsync, rename.
 *
 * `expected` is the file content read earlier in the run. It is re-read
 * immediately before the rename and compared, so an editor that saved during
 * the run is not silently clobbered (review §3.6). This narrows the race, it
 * does not close it — nothing can, without writer coordination.
 */
export function writeAtomic(target, content, expected) {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.${path.basename(target)}.cribsheet-${process.pid}.tmp`);

  const current = readOrNull(target);
  if (current !== expected) {
    throw refused(
      `${path.basename(target)} changed on disk while cribsheet was running. ` +
        `Nothing was written. Re-run to pick up the new content.`,
    );
  }

  // The output path is configured, so its parent is the user's intent, not ours.
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    throw error(`cannot create ${dir}: ${e.message}`);
  }

  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', current === null ? 0o666 : fs.statSync(target).mode);
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
  } catch (e) {
    if (fd !== undefined) closeQuietly(fd);
    unlinkQuietly(tmp);
    throw error(`cannot write ${target}: ${e.message}`);
  }
  closeQuietly(fd);

  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    unlinkQuietly(tmp);
    throw error(`cannot replace ${target}: ${e.message}`);
  }

  // Durability of the rename itself lives in the directory entry.
  try {
    const dfd = fs.openSync(dir, 'r');
    fs.fsyncSync(dfd);
    fs.closeSync(dfd);
  } catch {
    /* fsync on a directory is not portable; the rename already happened */
  }
}

export function readOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw error(`cannot read ${file}: ${e.message}`);
  }
}

const closeQuietly = (fd) => { try { fs.closeSync(fd); } catch { /* already closed */ } };
const unlinkQuietly = (p) => { try { fs.unlinkSync(p); } catch { /* never created */ } };
