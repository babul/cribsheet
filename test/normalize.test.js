import { test } from 'node:test';
import { normalize, toLF, ATX } from '../src/normalize.js';
import { EXIT } from '../src/errors.js';
import { throwsWithCode } from './helpers.js';

// --- ATX detection (review §5) -------------------------------------------

test('ATX detector matches CommonMark, not a naive pattern', (t) => {
  const yes = ['# Title', '###### Six', '#', '##', '#\tTabbed', '   # Indented', '## Closed ##'];
  const no = ['####### Seven', '#hashtag', '    # Four spaces is code', 'text # mid-line'];
  for (const line of yes) t.assert.ok(ATX.test(line), `should match: ${JSON.stringify(line)}`);
  for (const line of no) t.assert.ok(!ATX.test(line), `should not match: ${JSON.stringify(line)}`);
});

// --- line endings ---------------------------------------------------------

test('CRLF and bare CR normalise to LF, including inside fences', (t) => {
  t.assert.strictEqual(toLF('a\r\nb\rc\n'), 'a\nb\nc\n');
  t.assert.strictEqual(normalize('```\r\ncode\r\n```\r\n'), '```\ncode\n```');
});

test('a CRLF closing fence still closes', (t) => {
  // No rule inserts a blank line after a fence; only headings get spacing.
  t.assert.strictEqual(normalize('```js\r\nx\r\n```\r\nafter\r\n'), '```js\nx\n```\nafter');
});

// --- heading spacing ------------------------------------------------------

test('one blank line is inserted before and after a heading', (t) => {
  t.assert.strictEqual(normalize('text\n# H\nmore'), 'text\n\n# H\n\nmore');
});

test('no blank line is inserted before a heading at document start', (t) => {
  t.assert.strictEqual(normalize('# H\ntext'), '# H\n\ntext');
});

test('existing blank lines around a heading are not doubled', (t) => {
  t.assert.strictEqual(normalize('text\n\n# H\n\nmore'), 'text\n\n# H\n\nmore');
});

test('consecutive headings get exactly one blank line between them', (t) => {
  t.assert.strictEqual(normalize('# A\n## B\n### C'), '# A\n\n## B\n\n### C');
});

test('all six heading levels are spaced', (t) => {
  t.assert.strictEqual(normalize('t\n##### Five\nx'), 't\n\n##### Five\n\nx');
  t.assert.strictEqual(normalize('t\n###### Six\nx'), 't\n\n###### Six\n\nx');
});

test('seven hashes is a paragraph, not a heading', (t) => {
  t.assert.strictEqual(normalize('text\n####### Seven\nmore'), 'text\n####### Seven\nmore');
});

test('a hashtag at line start is not spaced', (t) => {
  t.assert.strictEqual(normalize('text\n#hashtag\nmore'), 'text\n#hashtag\nmore');
});

test('heading indentation is preserved', (t) => {
  t.assert.strictEqual(normalize('text\n   # H\nmore'), 'text\n\n   # H\n\nmore');
});

test('runs of blank lines collapse to one', (t) => {
  t.assert.strictEqual(normalize('a\n\n\n\n\nb'), 'a\n\nb');
});

// --- fenced code ----------------------------------------------------------

test('a # comment inside a bash fence is not spaced', (t) => {
  const src = 'text\n\n```bash\n# not a heading\necho hi\n```\n';
  t.assert.strictEqual(normalize(src), 'text\n\n```bash\n# not a heading\necho hi\n```');
});

test('a === line inside a fence is preserved byte-for-byte', (t) => {
  const src = '```\n=== .ai/guidelines/10-git.md ===\n```';
  t.assert.strictEqual(normalize(src), src);
});

test('tilde fences are handled', (t) => {
  const src = 'text\n\n~~~\n# literal\n~~~';
  t.assert.strictEqual(normalize(src), src);
});

test('blank lines inside a fence are preserved', (t) => {
  const src = '```\na\n\n\n\nb\n```';
  t.assert.strictEqual(normalize(src), src);
});

test('a shorter run does not close a longer fence', (t) => {
  const src = '````\n```\n# still code\n````';
  t.assert.strictEqual(normalize(src), src);
});

test('a longer run does close a shorter fence', (t) => {
  t.assert.strictEqual(normalize('```\nx\n`````\ntext\n# H\ny'), '```\nx\n`````\ntext\n\n# H\n\ny');
});

test('a closing fence may not carry an info string', (t) => {
  const src = '~~~\ncode\n~~~ not-a-close\n# literal\n~~~';
  t.assert.strictEqual(normalize(src), src);
});

test('a backtick fence info string containing a backtick is not a fence', (t) => {
  t.assert.strictEqual(normalize('``` `x`\ntext\n# H\ny'), '``` `x`\ntext\n\n# H\n\ny');
});

test('an unterminated fence is exit 3 and names the line', (t) => {
  throwsWithCode(t, () => normalize('a\n\n```\ncode\nmore'), EXIT.ERROR, /unterminated backtick fence opened on line 3/);
});

test('an unterminated tilde fence is exit 3', (t) => {
  throwsWithCode(t, () => normalize('~~~\ncode'), EXIT.ERROR, /unterminated tilde fence/);
});

// --- HTML blocks (review §2.3) -------------------------------------------

test('a # line inside an HTML block is not turned into a heading', (t) => {
  const src = 'text\n\n<div>\n# literal\n</div>';
  t.assert.strictEqual(normalize(src), src);
});

test('an HTML block ends at a blank line and normalisation resumes', (t) => {
  t.assert.strictEqual(normalize('<div>\nx\n</div>\n\ntext\n# H\ny'), '<div>\nx\n</div>\n\ntext\n\n# H\n\ny');
});

// --- indented code (review §2.2) -----------------------------------------

test('a # inside an indented code block is not a heading', (t) => {
  const src = 'text\n\n    # not a heading\n    echo hi';
  t.assert.strictEqual(normalize(src), src);
});

test('blank lines inside an indented code block are preserved', (t) => {
  const src = 'text\n\n    line one\n\n\n    line two';
  t.assert.strictEqual(normalize(src), src);
});

test('blank lines after an indented block still collapse', (t) => {
  t.assert.strictEqual(normalize('    code\n\n\n\ntext'), '    code\n\ntext');
});

// --- idempotence ----------------------------------------------------------

test('normalising twice changes nothing', (t) => {
  const samples = [
    'text\n# H\nmore',
    '```bash\n# c\n```\ntext',
    '<div>\n# x\n</div>\n\n# H\ntext',
    'a\n\n\n\nb\n\n### C\n',
    '    indented\n\n    code\n\ntext\n#### H',
    '~~~\n# lit\n~~~\n# real',
  ];
  for (const s of samples) {
    const once = normalize(s);
    t.assert.strictEqual(normalize(once), once, `not idempotent: ${JSON.stringify(s)}`);
  }
});
