import { normalize } from './normalize.js';

/** `=== <path> ===` on its own line, then a blank line (spec §4.1). */
export const separator = (relPath) => `=== ${relPath} ===`;

/**
 * Compose fragments into the managed block body.
 *
 * Each fragment is normalised on its own before assembly, so an error names
 * the file it came from. Unterminated fences are rejected during that pass,
 * which is what keeps one fragment from leaking a fence into the next.
 */
export function compose(fragments) {
  return fragments
    .map((f) => `${separator(f.relFromRoot)}\n\n${normalize(f.raw, f.relFromRoot)}`)
    .join('\n\n');
}
