import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpProject } from './helpers.js';

const BIN = fileURLToPath(new URL('../bin/cribsheet.js', import.meta.url));
const G = '.ai/guidelines';

function run(cwd, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

// execFileSync only captures stderr on failure, so success paths get their own runner.
function runBoth(cwd, args = []) {
  const script =
    `const {spawnSync}=require('child_process');` +
    `const r=spawnSync(process.execPath,[${JSON.stringify(BIN)},...${JSON.stringify(args)}],{cwd:${JSON.stringify(cwd)},encoding:'utf8'});` +
    `process.stdout.write(JSON.stringify({code:r.status,stdout:r.stdout,stderr:r.stderr}));`;
  return JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }));
}

test('--help exits 0 on stdout', (t) => {
  const root = tmpProject({});
  const r = runBoth(root, ['--help']);
  t.assert.strictEqual(r.code, 0);
  t.assert.match(r.stdout, /Usage:/);
  t.assert.strictEqual(r.stderr, '');
});

test('--version exits 0 on stdout', (t) => {
  const root = tmpProject({});
  const r = runBoth(root, ['--version']);
  t.assert.strictEqual(r.code, 0);
  t.assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('an unknown flag is exit 4 on stderr', (t) => {
  const root = tmpProject({});
  const r = runBoth(root, ['--nope']);
  t.assert.strictEqual(r.code, 4);
  t.assert.match(r.stderr, /Usage:/);
  t.assert.strictEqual(r.stdout, '');
});

test('an unknown command is exit 4', (t) => {
  const r = runBoth(tmpProject({}), ['frobnicate']);
  t.assert.strictEqual(r.code, 4);
  t.assert.match(r.stderr, /unknown command "frobnicate"/);
});

test('--dry-run with --diff is a usage error, exit 4', (t) => {
  const r = runBoth(tmpProject({}), ['--dry-run', '--diff']);
  t.assert.strictEqual(r.code, 4);
  t.assert.match(r.stderr, /pick one/);
});

test('the status line goes to stderr, never stdout', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  const r = runBoth(root, []);
  t.assert.strictEqual(r.code, 0);
  t.assert.strictEqual(r.stdout, '');
  t.assert.match(r.stderr, /AGENTS\.md {2}NEW {2}\(1 fragment,/);
});

test('--dry-run puts only the file on stdout and writes nothing', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  const r = runBoth(root, ['--dry-run']);
  t.assert.strictEqual(r.code, 0);
  t.assert.match(r.stdout, /^<!-- cribsheet:begin -->/);
  t.assert.match(r.stdout, /<!-- cribsheet:end sha=[0-9a-f]{12} -->\n$/);
  t.assert.strictEqual(fs.existsSync(path.join(root, 'AGENTS.md')), false);
});

test('--diff puts a unified diff on stdout and writes nothing', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  const r = runBoth(root, ['--diff']);
  t.assert.match(r.stdout, /^--- AGENTS\.md \(current\)/m);
  t.assert.match(r.stdout, /^\+.*cribsheet:begin/m);
  t.assert.strictEqual(fs.existsSync(path.join(root, 'AGENTS.md')), false);
});

test('--quiet drops the status line but keeps warnings', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body', [`${G}/READ.MD`]: 'x' });
  const r = runBoth(root, ['--quiet']);
  t.assert.strictEqual(r.code, 0);
  t.assert.doesNotMatch(r.stderr, /NEW/);
  t.assert.match(r.stderr, /only lowercase \.md is recognised/);
});

test('check is exit 1 when stale and 0 when fresh', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  t.assert.strictEqual(runBoth(root, ['check']).code, 1);
  runBoth(root, []);
  t.assert.strictEqual(runBoth(root, ['check']).code, 0);
});

test('check is exit 2 on a hand-edited block and prints a diff', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  runBoth(root, []);
  const f = path.join(root, 'AGENTS.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('body', 'edited'));
  const r = runBoth(root, ['check']);
  t.assert.strictEqual(r.code, 2);
  t.assert.match(r.stderr, /hand-edited/);
  t.assert.match(r.stderr, /-edited/);
});

test('a hand edit moved into its fragment: check is exit 1, then compile is exit 0', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  runBoth(root, []);
  const f = path.join(root, 'AGENTS.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('body', 'edited'));
  fs.writeFileSync(path.join(root, G, '00-a.md'), 'edited');
  t.assert.strictEqual(runBoth(root, ['check']).code, 1);
  t.assert.strictEqual(runBoth(root, []).code, 0);
  t.assert.strictEqual(runBoth(root, ['check']).code, 0);
});

test('a malformed config is exit 3', (t) => {
  const root = tmpProject({ '.ai/config.json': '{"nope":1}', [`${G}/00-a.md`]: 'b' });
  const r = runBoth(root, []);
  t.assert.strictEqual(r.code, 3);
  t.assert.match(r.stderr, /unknown key: nope/);
});

test('init creates the tree, is idempotent, and lists the keys', (t) => {
  const root = tmpProject({});
  const first = runBoth(root, ['init']);
  t.assert.strictEqual(first.code, 0);
  t.assert.ok(fs.existsSync(path.join(root, G)));
  t.assert.match(first.stderr, /guidelinesDir = "\.ai\/guidelines"/);
  t.assert.strictEqual(fs.existsSync(path.join(root, '.ai/config.json')), false);

  const second = runBoth(root, ['init']);
  t.assert.strictEqual(second.code, 0);
  t.assert.match(second.stderr, /already exists, left alone/);
});

test('init is exit 3 when .ai exists as a file', (t) => {
  const root = tmpProject({ '.ai': 'not a directory' });
  const r = runBoth(root, ['init']);
  t.assert.strictEqual(r.code, 3);
  t.assert.match(r.stderr, /not a directory/);
});

test('an orphaned AGENTS.md block warns when output is elsewhere', (t) => {
  const root = tmpProject({
    [`${G}/00-a.md`]: 'body',
    'AGENTS.md': '<!-- cribsheet:begin -->\nold\n<!-- cribsheet:end sha=abc123abc123 -->\n',
  });
  const r = runBoth(root, ['--output', 'docs/AGENTS.md']);
  t.assert.strictEqual(r.code, 0);
  t.assert.match(r.stderr, /Agents will keep reading the stale one/);
});

test('an output path outside the root is exit 3', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  const r = runBoth(root, ['--output', '../escaped.md']);
  t.assert.strictEqual(r.code, 3);
  t.assert.match(r.stderr, /outside the project root/);
});
