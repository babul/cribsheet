import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { findProjectRoot, loadConfig, resolveConfig, DEFAULTS } from '../src/config.js';
import { EXIT } from '../src/errors.js';
import { tmpProject, throwsWithCode } from './helpers.js';

test('absent config yields all defaults', (t) => {
  const root = tmpProject({ '.ai/guidelines/00-a.md': 'a' });
  t.assert.deepStrictEqual(loadConfig(root), DEFAULTS);
});

test('project root is found by walking up to .ai/', (t) => {
  const root = tmpProject({ '.ai/guidelines/00-a.md': 'a' });
  const deep = path.join(root, 'src', 'nested', 'deeper');
  fs.mkdirSync(deep, { recursive: true });
  t.assert.strictEqual(findProjectRoot(deep), root);
});

test('project root falls back to cwd when no .ai/ exists', (t) => {
  const root = tmpProject({ 'README.md': 'x' });
  t.assert.strictEqual(findProjectRoot(root), root);
});

test('the walk stops at $HOME and does not adopt ~/.ai', (t) => {
  const home = tmpProject({ '.ai/guidelines/00-a.md': 'a' });
  const project = path.join(home, 'projects', 'thing');
  fs.mkdirSync(project, { recursive: true });

  const prev = process.env.HOME;
  process.env.HOME = home;
  t.after(() => { process.env.HOME = prev; });

  t.assert.strictEqual(findProjectRoot(project), project);
});

test('unknown config key is exit 3 and names the key', (t) => {
  const root = tmpProject({ '.ai/config.json': '{"outputs":"AGENTS.md"}' });
  throwsWithCode(t, () => loadConfig(root), EXIT.ERROR, /unknown key: outputs/);
});

test('wrong exclude type is exit 3', (t) => {
  const root = tmpProject({ '.ai/config.json': '{"exclude":"90-draft.md"}' });
  throwsWithCode(t, () => loadConfig(root), EXIT.ERROR, /"exclude" must be an array of strings/);
});

test('malformed JSON is exit 3', (t) => {
  const root = tmpProject({ '.ai/config.json': '{"output":}' });
  throwsWithCode(t, () => loadConfig(root), EXIT.ERROR, /not valid JSON/);
});

test('a JSON array config is exit 3', (t) => {
  const root = tmpProject({ '.ai/config.json': '[]' });
  throwsWithCode(t, () => loadConfig(root), EXIT.ERROR, /must contain a JSON object/);
});

test('absolute path in config is exit 3', (t) => {
  const root = tmpProject({ '.ai/config.json': '{"output":"/etc/passwd"}' });
  throwsWithCode(t, () => resolveConfig({ cwd: root }), EXIT.ERROR, /must be relative/);
});

test('path traversal out of the root is exit 3', (t) => {
  const root = tmpProject({ '.ai/config.json': '{"output":"../../escaped.md"}' });
  throwsWithCode(t, () => resolveConfig({ cwd: root }), EXIT.ERROR, /outside the project root/);
});

test('a symlink inside the root pointing outside is exit 3', (t) => {
  const outside = tmpProject({ 'elsewhere/keep.md': 'x' });
  const root = tmpProject({ '.ai/guidelines/00-a.md': 'a' });
  fs.symlinkSync(path.join(outside, 'elsewhere'), path.join(root, 'link'));

  throwsWithCode(
    t,
    () => resolveConfig({ cwd: root, overrides: { output: 'link/out.md' } }),
    EXIT.ERROR,
    /outside the project root/,
  );
});

test('output inside guidelinesDir is rejected as self-input', (t) => {
  const root = tmpProject({ '.ai/config.json': '{"output":".ai/guidelines/generated.md"}' });
  throwsWithCode(t, () => resolveConfig({ cwd: root }), EXIT.ERROR, /would be read back as a fragment/);
});

test('CLI overrides beat config values', (t) => {
  const root = tmpProject({ '.ai/config.json': '{"output":"AGENTS.md"}' });
  const cfg = resolveConfig({ cwd: root, overrides: { output: 'docs/AGENTS.md' } });
  t.assert.strictEqual(cfg.output, path.join(root, 'docs/AGENTS.md'));
});

test('undefined overrides do not clobber config', (t) => {
  const root = tmpProject({ '.ai/config.json': '{"output":"docs/A.md"}' });
  const cfg = resolveConfig({ cwd: root, overrides: { output: undefined } });
  t.assert.strictEqual(cfg.output, path.join(root, 'docs/A.md'));
});
