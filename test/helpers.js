import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A throwaway project directory, realpath-normalised so symlinked tmp dirs compare cleanly. */
export function tmpProject(tree = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cribsheet-')));
  for (const [rel, contents] of Object.entries(tree)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return dir;
}

/** Assert that `fn` throws a CribError carrying `code`, and return the error. */
export function throwsWithCode(t, fn, code, matcher) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  t.assert.ok(err, 'expected a throw');
  t.assert.strictEqual(err.code, code, `expected exit ${code}, got ${err.code}: ${err.message}`);
  if (matcher) t.assert.match(err.message, matcher);
  return err;
}
