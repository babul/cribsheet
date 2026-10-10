<!-- cribsheet:begin -->
=== .ai/guidelines/00-foundation.md ===

# cribsheet

Merges hand-written markdown fragments into a managed block in `AGENTS.md`, preserving everything
outside that block byte-for-byte.

**The principle everything else serves: refuse rather than guess.** Silent corruption of a file
someone hand-edited is the failure this tool exists to prevent. A visible refusal is always
preferable to a quiet wrong answer, and a refusal that fires on valid input is its own failure —
it teaches people to route around refusals.

`docs/spec-v4.md` is the authoritative spec and matches `src/`. If they disagree, that is a bug in
one of them. `docs/spec-v3.md` holds the reasoning behind the decisions; v1 and v2 are superseded
and kept only for provenance.

This file is a fragment. `AGENTS.md` is generated from `.ai/guidelines/` — edit the fragment, then
run `cribsheet`. Editing the managed block directly will make the next compile refuse.

=== .ai/guidelines/10-decisions.md ===

## Decisions that look like bugs

Each of these is deliberate and was reached by counterexample. Changing one back needs a better
argument than "this looks wrong".

- **The block hash covers raw bytes and is never normalised first.** Normalising makes
  `# H\n\nText` and `# H\nText` hash identically, so a real hand edit is silently discarded — while
  still not absorbing the paragraph reflow a formatter actually produces. Exclude `AGENTS.md` from
  formatters instead.
- **Four markdown contexts are protected, not one:** fenced code, HTML blocks, indented code, and
  inline code spans. HTML blocks matter because inserting a blank line before a `#` inside `<div>`
  terminates the block and creates a real heading.
- **Unterminated fences refuse; indented code over-protects.** Refusing on ambiguous indentation
  would need the CommonMark block parser that refusing was meant to avoid. Over-protection is
  cosmetic; under-protection deletes lines from someone's code.
- **Exit 4 (bad invocation) is separate from exit 3 (broken environment)** so CI can tell an
  operator where to look. `check` returns 2 only when markers exist and cannot be verified;
  everything else unclean is 1.
- **`init` writes no config file.** Unknown keys are a hard error, so a scaffolded config would
  have to track the schema forever — a key rename would break every scaffolded project on upgrade.
- **`output` inside `guidelinesDir` is rejected,** not left for the user to exclude by hand. A
  forgotten exclusion there makes the tool ingest its own output.

=== .ai/guidelines/20-code.md ===

## Code

- **Zero runtime dependencies.** Node 22.5+ supplies `path.matchesGlob` and `node:crypto`; the unified
  diff is hand-rolled. A trust-first tool with a large transitive tree undercuts its own pitch.
  Adding a dependency is a spec change, not an implementation detail.
- ESM, Node 22.5+. No build step, no transpiler.
- **Errors carry their exit code.** Throw `CribError` (see `src/errors.js`); never call
  `process.exit` outside `bin/`.
- **Warnings are collected and returned, never printed** outside `bin/`. The library has no opinion
  about streams; the CLI decides.
- **stdout carries payloads only** — the composed file, a diff, `--help`, `--version`. Status lines
  and warnings go to stderr, so redirection and piping work.
- Modules are single-purpose and flow one way: `config` → `discover` → `normalize` → `compose` →
  `markers` → `compile` → `write`. Nothing lower reaches back up.

=== .ai/guidelines/30-testing.md ===

## Tests

`node --test`, no framework. Fixtures are built with `tmpProject()` from `test/helpers.js`.

- **A failing test is evidence something is wrong, not proof of the thing it claims.** Read what it
  actually measures before changing the code — in this repo two early failures were wrong
  expectations, not bugs.
- **Idempotence is a regression net, not coverage.** `compile(compile(x)) == compile(x)` passes
  forever on output that is consistently mangled the same way. Every normalization rule needs its
  own expected-output fixture.
- Assert exit codes, not just throws. The distinction between 1, 2, 3 and 4 is a contract.
- Cover the negative case whenever you add a match: a glob test needs the path it must *not* match.
<!-- cribsheet:end sha=1533b0f1c4a0 -->
