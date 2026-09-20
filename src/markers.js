import crypto from 'node:crypto';
import { error } from './errors.js';
import { scanProtected } from './normalize.js';

export const BEGIN = '<!-- cribsheet:begin -->';
export const endMarker = (sha) => `<!-- cribsheet:end sha=${sha} -->`;

// Markers must stand alone on their own line. That requirement is what keeps a
// marker inside an inline code span from being mistaken for a real one.
const BEGIN_RE = /^\s*<!--\s*cribsheet:begin\s*-->\s*$/;
const END_RE = /^\s*<!--\s*cribsheet:end(?:\s+sha=([0-9a-f]+))?\s*-->\s*$/;

/** SHA-256 of the trimmed block body, hex, truncated to 12 (spec §6.1). */
export const hashBody = (body) =>
  crypto.createHash('sha256').update(body.trim(), 'utf8').digest('hex').slice(0, 12);

/**
 * Locate the managed block in an existing output file.
 *
 * Returns null when the file has no markers. Throws exit 3 for duplicate or
 * inverted markers (review §3.3) — both mean a human should look.
 */
export function findBlock(text, label = 'output') {
  const { isProtected } = scanProtected(text, label);
  const raw = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

  const begins = [];
  const ends = [];
  const starts = [];
  let offset = 0;
  for (let i = 0; i < raw.length; i++) {
    starts.push(offset);
    offset += raw[i].length;
    if (isProtected[i]) continue; // a marker inside a fence is documentation
    const line = raw[i];
    if (BEGIN_RE.test(line)) begins.push(i);
    const m = line.match(END_RE);
    if (m) ends.push({ line: i, sha: m[1] ?? null });
  }

  if (begins.length === 0 && ends.length === 0) return null;
  if (begins.length > 1) {
    throw error(
      `${label} has ${begins.length} cribsheet:begin markers (lines ${begins.map((n) => n + 1).join(', ')}). ` +
        `Only one managed block is supported; the others would be read by agents and never updated.`,
    );
  }
  if (ends.length > 1) {
    throw error(
      `${label} has ${ends.length} cribsheet:end markers (lines ${ends.map((e) => e.line + 1).join(', ')}).`,
    );
  }
  if (begins.length === 0) {
    throw error(`${label} has an cribsheet:end marker on line ${ends[0].line + 1} with no cribsheet:begin.`);
  }
  if (ends.length === 0) {
    throw error(`${label} has an cribsheet:begin marker on line ${begins[0] + 1} with no cribsheet:end.`);
  }
  if (ends[0].line < begins[0]) {
    throw error(
      `${label} has cribsheet:end (line ${ends[0].line + 1}) before cribsheet:begin (line ${begins[0] + 1}).`,
    );
  }

  const b = begins[0];
  const e = ends[0].line;
  // Slice the ORIGINAL text so everything outside the markers survives
  // byte-for-byte, including its line endings (spec §5.1).
  const endContentEnd = starts[e] + raw[e].replace(/\r?\n$/, '').length;
  const bodyLines = raw.slice(b + 1, e).join('');

  return {
    sha: ends[0].sha,
    body: bodyLines.replace(/\r?\n$/, ''),
    before: text.slice(0, starts[b]),
    after: text.slice(endContentEnd),
  };
}

/** Wrap composed content in markers, stamped with its hash. */
export function renderBlock(body) {
  const trimmed = body.trim();
  return `${BEGIN}\n${trimmed}\n${endMarker(hashBody(trimmed))}`;
}
