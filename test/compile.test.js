import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { plan, compile, check, STATUS } from '../src/compile.js';
import { findBlock, hashBody, renderBlock } from '../src/markers.js';
import { EXIT } from '../src/errors.js';
import { tmpProject, throwsWithCode } from './helpers.js';

const G = '.ai/guidelines';
const cfg = (root) => ({
  root,
  output: path.join(root, 'AGENTS.md'),
  guidelinesDir: path.join(root, G),
  exclude: [],
});
const read = (root) => fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');

test('no output file: create with the block', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: '# Foundation\n\ntext' });
  const r = compile(cfg(root));
  t.assert.strictEqual(r.status, STATUS.NEW);
  const out = read(root);
  t.assert.match(out, /^<!-- cribsheet:begin -->/);
  t.assert.match(out, /=== \.ai\/guidelines\/00-a\.md ===/);
  t.assert.match(out, /<!-- cribsheet:end sha=[0-9a-f]{12} -->\n$/);
});

test('output exists without markers: append at the end, preserving it', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body', 'AGENTS.md': 'Hand written.\n' });
  compile(cfg(root));
  const out = read(root);
  t.assert.ok(out.startsWith('Hand written.\n\n<!-- cribsheet:begin -->'));
});

test('content before and after the block survives verbatim', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'one' });
  compile(cfg(root));
  const withText = `Preamble.\n\n${read(root).trimEnd()}\n\nPostscript.\n`;
  fs.writeFileSync(path.join(root, 'AGENTS.md'), withText);

  fs.writeFileSync(path.join(root, G, '00-a.md'), 'two');
  const r = compile(cfg(root));
  t.assert.strictEqual(r.status, STATUS.REPLACED);
  const out = read(root);
  t.assert.ok(out.startsWith('Preamble.\n\n'));
  t.assert.ok(out.endsWith('\n\nPostscript.\n'));
  t.assert.match(out, /two/);
});

test('recompiling unchanged fragments is UNCHANGED and writes nothing', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  compile(cfg(root));
  const before = fs.statSync(path.join(root, 'AGENTS.md')).mtimeMs;
  const r = compile(cfg(root));
  t.assert.strictEqual(r.status, STATUS.UNCHANGED);
  t.assert.strictEqual(fs.statSync(path.join(root, 'AGENTS.md')).mtimeMs, before);
});

test('a hand-edited block is refused with exit 2 and a diff', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  compile(cfg(root));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), read(root).replace('body', 'hand edited'));
  const err = throwsWithCode(t, () => compile(cfg(root)), EXIT.REFUSED, /hand-edited/);
  t.assert.match(err.diff, /-hand edited/);
});

test('--force overwrites a hand-edited block', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  compile(cfg(root));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), read(root).replace('body', 'hand edited'));
  const r = compile(cfg(root), { force: true });
  t.assert.strictEqual(r.status, STATUS.REPLACED);
  t.assert.match(read(root), /body/);
});

test('markers with no sha are refused with exit 2', (t) => {
  const root = tmpProject({
    [`${G}/00-a.md`]: 'body',
    'AGENTS.md': '<!-- cribsheet:begin -->\nstuff\n<!-- cribsheet:end -->\n',
  });
  throwsWithCode(t, () => compile(cfg(root)), EXIT.REFUSED, /markers but no sha/);
});

test('two begin markers are exit 3', (t) => {
  const root = tmpProject({
    [`${G}/00-a.md`]: 'body',
    'AGENTS.md': '<!-- cribsheet:begin -->\na\n<!-- cribsheet:end sha=abc123abc123 -->\n<!-- cribsheet:begin -->\n',
  });
  throwsWithCode(t, () => compile(cfg(root)), EXIT.ERROR, /2 cribsheet:begin markers/);
});

test('an end marker before a begin marker is exit 3', (t) => {
  const root = tmpProject({
    [`${G}/00-a.md`]: 'body',
    'AGENTS.md': '<!-- cribsheet:end sha=abc123abc123 -->\ntext\n<!-- cribsheet:begin -->\n',
  });
  throwsWithCode(t, () => compile(cfg(root)), EXIT.ERROR, /before cribsheet:begin/);
});

test('marker syntax inside a fence is documentation, not a block', (t) => {
  const root = tmpProject({
    [`${G}/00-a.md`]: 'body',
    'AGENTS.md': 'Docs:\n\n```markdown\n<!-- cribsheet:begin -->\n<!-- cribsheet:end -->\n```\n',
  });
  const r = compile(cfg(root));
  t.assert.strictEqual(r.status, STATUS.NEW); // appended, not matched
  t.assert.match(read(root), /```markdown\n<!-- cribsheet:begin -->/);
});

test('a marker inside an inline code span is not matched', (t) => {
  const root = tmpProject({
    [`${G}/00-a.md`]: 'body',
    'AGENTS.md': 'Example: `<!-- cribsheet:begin -->sample<!-- cribsheet:end -->` inline.\n',
  });
  const r = compile(cfg(root));
  t.assert.strictEqual(r.status, STATUS.NEW);
  t.assert.match(read(root), /Example: `<!-- cribsheet:begin -->sample/);
});

test('empty guidelines dir with no output is NOOP, exit 0, no write', (t) => {
  const root = tmpProject({ 'README.md': 'x' });
  fs.mkdirSync(path.join(root, G), { recursive: true });
  const r = compile(cfg(root));
  t.assert.strictEqual(r.status, STATUS.NOOP);
  t.assert.strictEqual(fs.existsSync(path.join(root, 'AGENTS.md')), false);
});

test('missing guidelines dir is NOOP with a warning, exit 0', (t) => {
  const root = tmpProject({ 'README.md': 'x' });
  const r = compile(cfg(root));
  t.assert.strictEqual(r.status, STATUS.NOOP);
  t.assert.match(r.warnings.join('\n'), /guidelines directory not found/);
});

test('a populated block with zero fragments is refused (review §3.4)', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  compile(cfg(root));
  fs.rmSync(path.join(root, G, '00-a.md'));
  throwsWithCode(t, () => compile(cfg(root)), EXIT.REFUSED, /still holds a managed block/);
});

test('--allow-empty clears the block instead of refusing', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  compile(cfg(root));
  fs.rmSync(path.join(root, G, '00-a.md'));
  const r = compile(cfg(root), { allowEmpty: true });
  t.assert.strictEqual(r.status, STATUS.NOOP);
});

test('CRLF fragments normalise to LF in the block', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'line one\r\nline two\r\n' });
  compile(cfg(root));
  t.assert.ok(!read(root).includes('\r'));
});

test('CRLF in user territory is preserved byte-for-byte', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'one' });
  compile(cfg(root));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), `Head\r\n\r\n${read(root).trimEnd()}\r\n\r\nTail\r\n`);
  fs.writeFileSync(path.join(root, G, '00-a.md'), 'two');
  compile(cfg(root));
  const out = read(root);
  t.assert.ok(out.startsWith('Head\r\n\r\n'), 'CRLF preamble kept');
  t.assert.ok(out.endsWith('\r\nTail\r\n'), 'CRLF postscript kept');
});

test('output always ends with exactly one newline when the block is last', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  compile(cfg(root));
  t.assert.match(read(root), /-->\n$/);
  t.assert.ok(!read(root).endsWith('\n\n'));
});

test('the hash covers the trimmed block body', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  compile(cfg(root));
  const block = findBlock(read(root), 'AGENTS.md');
  t.assert.strictEqual(block.sha, hashBody(block.body));
});

test('nested fragments are included and ordered by full relative path', (t) => {
  const root = tmpProject({
    [`${G}/00-a.md`]: 'A',
    [`${G}/writing/30-tone.md`]: 'TONE',
    [`${G}/40-later.md`]: 'LATER',
  });
  compile(cfg(root));
  const out = read(root);
  t.assert.ok(out.indexOf('00-a.md') < out.indexOf('40-later.md'));
  t.assert.ok(out.indexOf('40-later.md') < out.indexOf('writing/30-tone.md'));
});

// --- check ----------------------------------------------------------------

test('check passes on fresh output', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  compile(cfg(root));
  t.assert.strictEqual(check(cfg(root)).exit, EXIT.OK);
});

test('check on stale output is exit 1', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  compile(cfg(root));
  fs.writeFileSync(path.join(root, G, '00-a.md'), 'changed');
  t.assert.strictEqual(check(cfg(root)).exit, EXIT.STALE);
});

test('check with a missing output file is exit 1', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  t.assert.strictEqual(check(cfg(root)).exit, EXIT.STALE);
});

test('check on a markerless file is exit 1, not 2', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body', 'AGENTS.md': 'hand written\n' });
  t.assert.strictEqual(check(cfg(root)).exit, EXIT.STALE);
});

test('check on a hand-edited block is exit 2', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  compile(cfg(root));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), read(root).replace('body', 'edited'));
  throwsWithCode(t, () => check(cfg(root)), EXIT.REFUSED);
});

test('check writes nothing', (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  check(cfg(root));
  t.assert.strictEqual(fs.existsSync(path.join(root, 'AGENTS.md')), false);
});

// --- concurrency ----------------------------------------------------------

test('a file changed between plan and write is refused, not clobbered', async (t) => {
  const root = tmpProject({ [`${G}/00-a.md`]: 'body' });
  compile(cfg(root));
  const stale = read(root);
  fs.writeFileSync(path.join(root, G, '00-a.md'), 'changed');
  const p = plan(cfg(root));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), `${stale}\nsaved by an editor\n`);
  const { writeAtomic } = await import('../src/write.js');
  throwsWithCode(t, () => writeAtomic(p.output, p.text, p.existing), EXIT.REFUSED, /changed on disk/);
  t.assert.match(read(root), /saved by an editor/);
});

// --- idempotence ----------------------------------------------------------

test('compile is idempotent over a realistic fragment set', (t) => {
  const root = tmpProject({
    [`${G}/00-foundation.md`]: '# Foundation\ntext\n',
    [`${G}/10-git.md`]: '## Git\n\n```bash\n# not a heading\ngit status\n```\n',
    [`${G}/writing/30-tone.md`]: '<div>\n# literal\n</div>\n\n### Tone\nbe brief',
  });
  compile(cfg(root));
  const first = read(root);
  compile(cfg(root));
  t.assert.strictEqual(read(root), first);
  t.assert.strictEqual(compile(cfg(root)).status, STATUS.UNCHANGED);
});
