import path from 'node:path';
import { EXIT, refused } from './errors.js';
import { discover } from './discover.js';
import { compose } from './compose.js';
import { findBlock, renderBlock, hashBody } from './markers.js';
import { readOrNull, writeAtomic } from './write.js';
import { unifiedDiff } from './diff.js';

export const STATUS = {
  NEW: 'NEW',
  REPLACED: 'REPLACED',
  UNCHANGED: 'UNCHANGED',
  REFUSED: 'REFUSED',
  NOOP: 'NOOP',
};

/** Decide what compile would do, without touching the filesystem. */
export function plan(config, { force = false, allowEmpty = false } = {}) {
  const { root, output, guidelinesDir, exclude } = config;
  const label = path.relative(root, output) || path.basename(output);
  const { fragments, warnings } = discover({ root, guidelinesDir, exclude });
  const existing = readOrNull(output);
  const base = { label, warnings, fragmentCount: fragments.length, existing, output };

  if (fragments.length === 0) {
    const block = existing === null ? null : findBlock(existing, label);
    if (block && block.body.trim() !== '' && !allowEmpty) {
      return {
        ...base,
        status: STATUS.REFUSED,
        exit: EXIT.REFUSED,
        reason:
          `no fragments were found, but ${label} still holds a managed block. ` +
          `Refusing to leave guidelines that no longer exist in place. ` +
          `Check --dir, or pass --allow-empty to clear the block.`,
      };
    }
    return { ...base, status: STATUS.NOOP, exit: EXIT.OK, text: null };
  }

  const block = renderBlock(compose(fragments));

  if (existing === null) {
    return { ...base, status: STATUS.NEW, exit: EXIT.OK, text: `${block}\n` };
  }

  const found = findBlock(existing, label);

  if (found === null) {
    // Append at the end, one blank line clear of whatever is already there.
    const sep = existing.trim() === '' ? '' : existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
    const head = existing.trim() === '' ? '' : existing;
    return { ...base, status: STATUS.NEW, exit: EXIT.OK, text: `${head}${sep}${block}\n` };
  }

  if (found.sha === null) {
    return {
      ...base,
      status: STATUS.REFUSED,
      exit: EXIT.REFUSED,
      reason: `${label} has markers but no sha. Treating it as unmanaged rather than guessing what is safe to replace.`,
      lostDiff: unifiedDiff(found.body, compose(fragments), `${label} (current)`, `${label} (would become)`),
    };
  }

  const actual = hashBody(found.body);
  if (actual !== found.sha && !force) {
    return {
      ...base,
      status: STATUS.REFUSED,
      exit: EXIT.REFUSED,
      reason: `${label} has been hand-edited inside the managed block (sha ${found.sha} != ${actual}). Re-run with --force to overwrite.`,
      lostDiff: unifiedDiff(found.body, compose(fragments), `${label} (current)`, `${label} (would become)`),
    };
  }

  // §3.1: the trailing-newline rule applies only where the block reaches EOF.
  const after = found.after === '' ? '\n' : found.after;
  const text = `${found.before}${block}${after}`;

  return {
    ...base,
    status: text === existing ? STATUS.UNCHANGED : STATUS.REPLACED,
    exit: EXIT.OK,
    text,
  };
}

/** Plan, then write if there is anything to write. */
export function compile(config, options = {}) {
  const result = plan(config, options);
  if (result.status === STATUS.REFUSED) throw refusedFrom(result);
  if (result.text === null || result.status === STATUS.UNCHANGED) return result;
  if (options.dryRun || options.diff) return result;

  writeAtomic(result.output, result.text, result.existing);
  return result;
}

/**
 * `check` never writes. Exit 2 only when markers are present and cannot be
 * verified; everything else that is not clean is 1 (review §3.2).
 */
export function check(config, options = {}) {
  const result = plan(config, options);
  if (result.status === STATUS.REFUSED) throw refusedFrom(result);
  const clean = result.status === STATUS.UNCHANGED || result.status === STATUS.NOOP;
  return { ...result, exit: clean ? EXIT.OK : EXIT.STALE };
}

function refusedFrom(result) {
  const err = refused(result.reason);
  err.diff = result.lostDiff;
  return err;
}

export { EXIT };
