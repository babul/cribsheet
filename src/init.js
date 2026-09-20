import fs from 'node:fs';
import path from 'node:path';
import { error } from './errors.js';
import { DEFAULTS } from './config.js';

/**
 * Create `.ai/guidelines/`. Idempotent and never overwrites, so running it
 * twice is safe and exits 0 (review §5).
 */
export function init(root) {
  const created = [];
  const existed = [];

  for (const rel of ['.ai', '.ai/guidelines']) {
    const full = path.join(root, rel);
    let stat = null;
    try {
      stat = fs.statSync(full);
    } catch (e) {
      if (e.code !== 'ENOENT') throw error(`cannot inspect ${rel}: ${e.message}`);
    }
    if (stat && !stat.isDirectory()) {
      throw error(`${rel} exists but is not a directory; cribsheet cannot use it`);
    }
    if (stat) {
      existed.push(rel);
      continue;
    }
    try {
      fs.mkdirSync(full, { recursive: true });
    } catch (e) {
      throw error(`cannot create ${rel}: ${e.message}`);
    }
    created.push(rel);
  }

  // No config file is written: every key has a working default, and a
  // scaffolded config would have to track the schema forever (review §1.1).
  return { created, existed, keys: DEFAULTS };
}
