import { error } from './errors.js';

/** ATX heading: up to 3 leading spaces, 1-6 hashes, then space, tab, or EOL. */
export const ATX = /^ {0,3}#{1,6}(?:[ \t]|$)/;

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const INDENT4 = /^(?: {4,}|\t)/;
const HTML_OPEN = /^ {0,3}<[!/?]?[a-zA-Z][a-zA-Z0-9-]*/;
const BLANK = /^[ \t]*$/;

/** Line endings are normalised globally, before anything scans for fences. */
export const toLF = (text) => text.replace(/\r\n?/g, '\n');

/**
 * Classify every line as inside-a-protected-block or not.
 *
 * Protected means fenced code or an HTML block: content that must survive
 * byte-for-byte. Indented code is handled separately — see `normalize`.
 */
export function scanProtected(text, label) {
  const lines = toLF(text).split('\n');
  return { lines, isProtected: classify(lines, label) };
}

function classify(lines, label) {
  const protectedLine = new Array(lines.length).fill(false);
  let fence = null; // { char, len }
  let html = false;
  let fenceOpenedAt = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (fence) {
      protectedLine[i] = true;
      const close = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) fence = null;
      continue;
    }

    const open = line.match(FENCE_OPEN);
    // A backtick fence's info string may not contain a backtick (CommonMark §4.5).
    if (open && !(open[2][0] === '`' && open[3].includes('`'))) {
      fence = { char: open[2][0], len: open[2].length };
      fenceOpenedAt = i;
      protectedLine[i] = true;
      continue;
    }

    if (html) {
      if (BLANK.test(line)) {
        html = false; // a blank line ends an HTML block; the blank itself is a boundary
      } else {
        protectedLine[i] = true;
        continue;
      }
    }

    const atBoundary = i === 0 || BLANK.test(lines[i - 1]);
    if (atBoundary && HTML_OPEN.test(line)) {
      html = true;
      protectedLine[i] = true;
    }
  }

  if (fence) {
    throw error(
      `${label}: unterminated ${fence.char === '`' ? 'backtick' : 'tilde'} fence opened on line ` +
        `${fenceOpenedAt + 1}. An unclosed fence swallows every fragment after it; close it, ` +
        `or escape the delimiter.`,
    );
  }
  return protectedLine;
}

/**
 * A blank line sitting between two indented-code lines is content, not spacing.
 * Collapsing it would change the code, so it is preserved.
 */
function blankIsCodeInterior(lines, i, isProtected) {
  let up = i - 1;
  while (up >= 0 && BLANK.test(lines[up])) up--;
  let down = i + 1;
  while (down < lines.length && BLANK.test(lines[down])) down++;
  if (up < 0 || down >= lines.length) return false;
  if (isProtected[up] || isProtected[down]) return false;
  return INDENT4.test(lines[up]) && INDENT4.test(lines[down]);
}

/**
 * Normalise one fragment body.
 *
 * Runs as a single line-oriented pass: four sequential regex passes over the
 * whole string would shift the offsets the protected-region scan computed.
 */
export function normalize(text, label = 'fragment') {
  const lines = toLF(text).split('\n');
  const isProtected = classify(lines, label);
  const out = [];

  let pendingBlanks = 0;
  let wantBlankAfterHeading = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isProtected[i]) {
      flushBlanks();
      out.push(line);
      wantBlankAfterHeading = false;
      continue;
    }

    if (BLANK.test(line)) {
      if (blankIsCodeInterior(lines, i, isProtected)) {
        flushBlanks();
        out.push(line);
      } else {
        pendingBlanks++;
      }
      continue;
    }

    const isHeading = ATX.test(line);
    if ((isHeading || wantBlankAfterHeading) && out.length > 0 && pendingBlanks === 0) {
      pendingBlanks = 1; // one blank line before a heading, and after one
    }
    flushBlanks();
    out.push(line);
    wantBlankAfterHeading = isHeading;
  }

  // Runs of blank lines at the end collapse away; §6.3 re-adds the single \n.
  return out.join('\n').replace(/\s+$/, '');

  function flushBlanks() {
    if (pendingBlanks > 0 && out.length > 0) out.push(''); // at most one blank line
    pendingBlanks = 0;
  }
}
