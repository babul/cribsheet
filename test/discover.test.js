import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { discover } from '../src/discover.js';
import { tmpProject } from './helpers.js';

const G = '.ai/guidelines';
const setup = (tree, exclude = []) => {
  const root = tmpProject(tree);
  return { root, ...discover({ root, guidelinesDir: path.join(root, G), exclude }) };
};
const names = (fragments) => fragments.map((f) => f.relFromDir);

test('fragments sort by relative path, byte order', (t) => {
  const { fragments } = setup({
    [`${G}/20-shortcuts.md`]: 'c',
    [`${G}/00-foundation.md`]: 'a',
    [`${G}/10-git.md`]: 'b',
  });
  t.assert.deepStrictEqual(names(fragments), ['00-foundation.md', '10-git.md', '20-shortcuts.md']);
});

test('a subdirectory sorts as a unit, not by its numeric prefix', (t) => {
  const { fragments } = setup({
    [`${G}/00-a.md`]: 'a',
    [`${G}/writing/30-tone.md`]: 'tone',
    [`${G}/z-last.md`]: 'z',
    [`${G}/40-later.md`]: 'later',
  });
  t.assert.deepStrictEqual(names(fragments), [
    '00-a.md',
    '40-later.md',
    'writing/30-tone.md',
    'z-last.md',
  ]);
});

test('nested fragments carry a root-relative path for the separator', (t) => {
  const { fragments } = setup({ [`${G}/writing/30-tone.md`]: 'tone' });
  t.assert.strictEqual(fragments[0].relFromRoot, '.ai/guidelines/writing/30-tone.md');
});

test('empty and whitespace-only fragments are skipped', (t) => {
  const { fragments } = setup({
    [`${G}/00-a.md`]: 'a',
    [`${G}/10-empty.md`]: '',
    [`${G}/20-blank.md`]: '   \n\n\t\n',
  });
  t.assert.deepStrictEqual(names(fragments), ['00-a.md']);
});

test('non-markdown extensions are ignored silently', (t) => {
  const { fragments, warnings } = setup({
    [`${G}/00-a.md`]: 'a',
    [`${G}/notes.txt`]: 'x',
    [`${G}/data.json`]: '{}',
  });
  t.assert.deepStrictEqual(names(fragments), ['00-a.md']);
  t.assert.deepStrictEqual(warnings, []);
});

test('a case-variant .MD is skipped but warned about', (t) => {
  const { fragments, warnings } = setup({ [`${G}/00-a.md`]: 'a', [`${G}/READ.MD`]: 'x' });
  t.assert.deepStrictEqual(names(fragments), ['00-a.md']);
  t.assert.match(warnings.join('\n'), /only lowercase \.md is recognised/);
});

test('hidden files and hidden directories are ignored', (t) => {
  const { fragments } = setup({
    [`${G}/00-a.md`]: 'a',
    [`${G}/.secret.md`]: 'x',
    [`${G}/.drafts/10-wip.md`]: 'x',
  });
  t.assert.deepStrictEqual(names(fragments), ['00-a.md']);
});

test('a missing guidelines directory warns and yields nothing', (t) => {
  const root = tmpProject({ 'README.md': 'x' });
  const { fragments, warnings } = discover({ root, guidelinesDir: path.join(root, G) });
  t.assert.deepStrictEqual(fragments, []);
  t.assert.match(warnings.join('\n'), /guidelines directory not found/);
});

test('an empty guidelines directory yields nothing without warning', (t) => {
  const root = tmpProject({ 'README.md': 'x' });
  fs.mkdirSync(path.join(root, G), { recursive: true });
  const { fragments, warnings } = discover({ root, guidelinesDir: path.join(root, G) });
  t.assert.deepStrictEqual(fragments, []);
  t.assert.deepStrictEqual(warnings, []);
});

// --- exclude globs (review §5) -------------------------------------------

test('a bare filename is root-anchored and does not match at depth', (t) => {
  const { fragments } = setup(
    { [`${G}/90-draft.md`]: 'x', [`${G}/writing/90-draft.md`]: 'y' },
    ['90-draft.md'],
  );
  t.assert.deepStrictEqual(names(fragments), ['writing/90-draft.md']);
});

test('**/name matches at every depth', (t) => {
  const { fragments } = setup(
    { [`${G}/90-draft.md`]: 'x', [`${G}/writing/90-draft.md`]: 'y', [`${G}/00-a.md`]: 'a' },
    ['**/90-draft.md'],
  );
  t.assert.deepStrictEqual(names(fragments), ['00-a.md']);
});

test('dir/** excludes a whole subtree', (t) => {
  const { fragments } = setup(
    { [`${G}/00-a.md`]: 'a', [`${G}/writing/30-tone.md`]: 'x', [`${G}/writing/deep/40-x.md`]: 'y' },
    ['writing/**'],
  );
  t.assert.deepStrictEqual(names(fragments), ['00-a.md']);
});

test('a bare directory name excludes nothing and warns', (t) => {
  const { fragments, warnings } = setup(
    { [`${G}/00-a.md`]: 'a', [`${G}/writing/30-tone.md`]: 'x' },
    ['writing'],
  );
  t.assert.deepStrictEqual(names(fragments), ['00-a.md', 'writing/30-tone.md']);
  t.assert.match(warnings.join('\n'), /matched no fragment: "writing"/);
});

test('an exclude pattern matching nothing warns but does not fail', (t) => {
  const { fragments, warnings } = setup({ [`${G}/00-a.md`]: 'a' }, ['gone.md']);
  t.assert.deepStrictEqual(names(fragments), ['00-a.md']);
  t.assert.match(warnings.join('\n'), /matched no fragment: "gone.md"/);
});

test('excluding every fragment yields none', (t) => {
  const { fragments, warnings } = setup({ [`${G}/00-a.md`]: 'a', [`${G}/10-b.md`]: 'b' }, ['**']);
  t.assert.deepStrictEqual(names(fragments), []);
  t.assert.deepStrictEqual(warnings, []);
});

// --- symlinks -------------------------------------------------------------

test('symlinked fragments are skipped and reported', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'a', 'outside/shared.md': 'shared' });
  fs.symlinkSync(path.join(root, 'outside/shared.md'), path.join(root, G, '10-link.md'));
  const { fragments, warnings } = discover({ root, guidelinesDir: path.join(root, G) });
  t.assert.deepStrictEqual(names(fragments), ['00-a.md']);
  t.assert.match(warnings.join('\n'), /skipped symlink/);
});

test('a symlink loop does not hang', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'a' });
  fs.symlinkSync(path.join(root, G), path.join(root, G, 'loop'));
  const { fragments } = discover({ root, guidelinesDir: path.join(root, G) });
  t.assert.deepStrictEqual(names(fragments), ['00-a.md']);
});
