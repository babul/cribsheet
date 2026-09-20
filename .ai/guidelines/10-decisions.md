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
