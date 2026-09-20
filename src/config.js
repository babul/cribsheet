import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { error } from './errors.js';

export const DEFAULTS = {
  output: 'AGENTS.md',
  guidelinesDir: '.ai/guidelines',
  exclude: [],
};

const CONFIG_PATH = '.ai/config.json';

/**
 * Walk up from `cwd` looking for `.ai/`, stopping before $HOME and at the
 * filesystem root (review §6.1). Falls back to `cwd` when nothing is found.
 */
export function findProjectRoot(cwd = process.cwd()) {
  const home = path.resolve(os.homedir());
  let dir = path.resolve(cwd);

  for (;;) {
    if (dir === home) break;
    if (isDirectory(path.join(dir, '.ai'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(cwd);
}

/** Read and validate `.ai/config.json`. An absent file means all defaults. */
export function loadConfig(root) {
  const file = path.join(root, CONFIG_PATH);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { ...DEFAULTS };
    throw error(`cannot read ${CONFIG_PATH}: ${e.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw error(`${CONFIG_PATH} is not valid JSON: ${e.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw error(`${CONFIG_PATH} must contain a JSON object`);
  }

  // Unknown keys are an error, not a warning (spec §8).
  const unknown = Object.keys(parsed).filter((k) => !(k in DEFAULTS));
  if (unknown.length) {
    throw error(
      `${CONFIG_PATH} has unknown key${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. ` +
        `Known keys: ${Object.keys(DEFAULTS).join(', ')}`,
    );
  }

  for (const key of ['output', 'guidelinesDir']) {
    if (key in parsed && (typeof parsed[key] !== 'string' || parsed[key].trim() === '')) {
      throw error(`${CONFIG_PATH}: "${key}" must be a non-empty string`);
    }
  }
  if ('exclude' in parsed) {
    const v = parsed.exclude;
    if (!Array.isArray(v) || v.some((p) => typeof p !== 'string')) {
      throw error(`${CONFIG_PATH}: "exclude" must be an array of strings`);
    }
  }

  return { ...DEFAULTS, ...parsed };
}

/**
 * Resolve a configured path against the project root, rejecting absolute
 * paths and anything that escapes the root once symlinks are followed
 * (review §5, "Path traversal").
 */
export function resolveWithinRoot(root, value, label) {
  if (path.isAbsolute(value)) {
    throw error(`${label} must be relative to the project root, got "${value}"`);
  }
  const resolved = path.resolve(root, value);
  const realRoot = realpathNearest(root);
  const realTarget = realpathNearest(resolved);

  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
    throw error(`${label} resolves outside the project root: "${value}"`);
  }
  return resolved;
}

/** Full resolution: root + config + CLI overrides, all validated. */
export function resolveConfig({ cwd = process.cwd(), overrides = {} } = {}) {
  const root = findProjectRoot(cwd);
  const merged = { ...loadConfig(root), ...stripUndefined(overrides) };

  const guidelinesDir = resolveWithinRoot(root, merged.guidelinesDir, 'guidelinesDir');
  const output = resolveWithinRoot(root, merged.output, 'output');

  // §3.5: the output must not be discoverable as its own input.
  const realDir = realpathNearest(guidelinesDir);
  const realOut = realpathNearest(output);
  if (realOut === realDir || realOut.startsWith(realDir + path.sep)) {
    throw error(
      `output "${merged.output}" is inside guidelinesDir "${merged.guidelinesDir}"; ` +
        `it would be read back as a fragment on the next compile`,
    );
  }

  return { root, output, guidelinesDir, exclude: merged.exclude };
}

function stripUndefined(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** realpath() of the nearest existing ancestor, with the missing tail re-appended. */
function realpathNearest(p) {
  let dir = path.resolve(p);
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(dir), ...tail.slice().reverse());
    } catch (e) {
      if (e.code !== 'ENOENT') throw error(`cannot resolve path "${p}": ${e.message}`);
      const parent = path.dirname(dir);
      if (parent === dir) return path.resolve(p);
      tail.push(path.basename(dir));
      dir = parent;
    }
  }
}
