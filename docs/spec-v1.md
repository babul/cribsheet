# cribsheet — Specification

> **Superseded by [`spec-v4.md`](spec-v4.md),** which is the spec as implemented. This draft is
> kept verbatim for provenance; its §7 `init`, §7.2 exit codes and §4.3 normalization rules are
> known to be wrong. See [`spec-v3.md`](spec-v3.md) for why.

> Compile AGENTS.md from reusable markdown fragments — without clobbering your hand edits.

**Status:** draft v1
**Package:** `cribsheet` (npm), with `crib-sheet` held as an alias — see Appendix A

---

## 1. Purpose

Compile a set of hand-written markdown fragments into a single `AGENTS.md`, without destroying hand-written content in that file.

The tool is a **merge utility with safety guarantees**, not a generator. It never inspects the project, never infers anything, and never writes content the user did not author.

### 1.1 Design premises

- `AGENTS.md` is a **committed source file** that humans edit, not a build artifact. This is the core departure from `laravel/boost`, which treats its output as disposable and recommends gitignoring it.
- Fragments in `.ai/guidelines/` are **committed** and are copied by hand between projects. There is no external source of truth, no sync, no registry, no network access.
- The project may be **any type** — code, prose, research, ops notes. Nothing in the tool assumes a codebase, a language, or a `package.json`.

### 1.2 Non-goals (v1)

| Excluded | Reason |
|---|---|
| Templating / variable interpolation | Fragments are literal text |
| Project or dependency scanning | Tool is content-agnostic |
| Sibling output files (`CLAUDE.md`, `.cursor/rules`) | Out of scope |
| Linting, token budgeting, dead-link checks | Out of scope |
| Nested / path-scoped guidelines | Deferred to v2 (§10) |
| Shipped default guidelines | User supplies 100% of content |
| Override-by-key layering | Only one tier exists, so nothing to override |
| Fetching from git / npm / remote | No external source of truth |

---

## 2. File layout

```
<project root>/
├── AGENTS.md              # output — committed, hand-editable
└── .ai/
    ├── config.json        # optional
    └── guidelines/
        ├── 00-foundation.md
        ├── 10-git.md
        ├── 20-shortcuts.md
        └── writing/
            └── 30-tone.md
```

Everything the tool touches lives under `.ai/`. The project root gains no files other than the output.

---

## 3. Fragments

### 3.1 Discovery

- Recursive glob of `<guidelinesDir>/**/*.md`
- Only `.md` is recognised. Other extensions are ignored silently.
- Hidden files (leading `.`) are ignored.
- A fragment whose content is empty or whitespace-only after trimming is **skipped** — it contributes no separator and no body.

### 3.2 Ordering

Sort by **relative path string**, ascending, byte-comparison.

Ordering is controlled entirely by filename. The convention is a numeric prefix (`00-`, `10-`, `20-`) leaving gaps for insertion. There is no `order:` field, no config array, and no front matter.

**Rationale:** filename ordering is visible in `ls`, sorts identically in every tool, requires no parsing, and cannot drift out of sync with the folder. An explicit ordering list in config would mean that adding a file to the folder silently does nothing until config is also edited — a bad failure mode.

**Known consequence:** fragments copied in from another project will collide on prefixes. Resolution is a `mv`. This is accepted.

### 3.3 Format

Plain markdown. No front matter is parsed. No directives are interpreted. Fragment bodies are copied through **byte-for-byte**, including heading levels.

The tool does not demote, promote, or rewrite headings. A fragment containing `# Git conventions` emits `# Git conventions`.

---

## 4. Composition

### 4.1 Separator

Each fragment is preceded by a separator line naming its source path, relative to project root:

```
=== .ai/guidelines/10-git.md ===
```

Format: `=== ` + relative POSIX path + ` ===`, on its own line, followed by one blank line.

**Rationale:**
- Sits **outside** the markdown heading system, so fragment headings need no transformation.
- Visually obvious as non-prose — reads as a seam, not as authored content.
- Naming the path makes provenance actionable: a reader who wants to change that text knows exactly which file to open.

### 4.2 Assembly

```
=== <path A> ===

<body A>

=== <path B> ===

<body B>
```

Fragment bodies are trimmed of leading/trailing whitespace. Blocks are joined with one blank line between the end of a body and the next separator.

### 4.3 Normalization

Applied to the assembled string, **outside fenced code blocks only**:

1. Normalize line endings: `\r\n` → `\n`, bare `\r` → `\n`
2. Ensure exactly one blank line before every ATX heading (`#` through `####`)
3. Ensure exactly one blank line after every ATX heading
4. Collapse runs of 3+ newlines to 2

Fence detection must handle both ``` and ~~~ delimiters, with 3 or more characters, and must respect the opening fence's length when matching the close. A `#` line or a `===` line inside a fence is content and must not be touched.

**This is the single most commonly botched detail in this category of tool. It must be covered by tests.**

---

## 5. Output format

### 5.1 Managed block

```markdown
Hand-written preamble. Never touched.

<!-- agents:begin -->
=== .ai/guidelines/00-foundation.md ===

...composed content...
<!-- agents:end sha=a3f9c2e81b04 -->

Hand-written notes below. Also never touched.
```

- Markers are **HTML comments** so they are invisible in every markdown renderer.
- The `sha` attribute carries a content hash (§6.1).
- Everything outside the markers is user territory and is preserved verbatim, including its position relative to the block.

### 5.2 Marker detection

Regex, single match, dotall:

```
<!--\s*agents:begin\s*-->(?<body>.*?)<!--\s*agents:end(?:\s+sha=(?<sha>[0-9a-f]+))?\s*-->
```

Tolerant of whitespace variation and a missing `sha` (a hand-added marker pair).

---

## 6. Safety

This section is the reason the tool exists. Each rule below addresses a failure `laravel/boost` does not defend against.

### 6.1 Hash guard

- **Hash input:** the trimmed content between the markers, excluding the marker lines.
- **Algorithm:** SHA-256, hex, truncated to 12 characters.
- **On compile:**
  1. If output file does not exist → create it containing only the block. `NEW`.
  2. If it exists with no markers → append the block at the end, separated by a blank line. `NEW`.
  3. If markers exist and the stored `sha` matches the hash of the current block body → safe to replace. `REPLACED` (or `UNCHANGED` if the newly composed content is identical).
  4. If markers exist with **no** `sha` → treat as unmanaged. Refuse, per (5).
  5. If markers exist and the stored `sha` **does not match** → the block was hand-edited. **Abort.** Print a diff of what would be lost. Exit 2. Proceed only with `--force`.

Case (5) is the whole point. A silent clobber of someone's hand edit is the failure that makes a tool untrustworthy.

### 6.2 Atomic write

Write to a sibling temp file in the same directory, `fsync`, then `rename` over the target. Never truncate-then-write in place.

An interrupted run must leave the original `AGENTS.md` fully intact.

### 6.3 Trailing newline

Output always ends with exactly one `\n`.

### 6.4 Orphaned block warning

If `output` is configured to a non-default path, and a file named `AGENTS.md` exists at the project root containing a begin marker, emit a warning. A stale managed block at the old path keeps being read by agents and is a silent-divergence hazard.

Warning only — never modify or delete the orphan.

---

## 7. CLI

| Command | Behaviour |
|---|---|
| `cribsheet` | Alias for `compile` |
| `cribsheet compile` | Compose and write |
| `cribsheet check` | Exit non-zero if output is stale or hand-edited. Writes nothing. |
| `cribsheet init` | Create `.ai/guidelines/` and a commented `.ai/config.json`. Never overwrites. |

### 7.1 Flags

| Flag | Applies to | Effect |
|---|---|---|
| `--dir <path>` | all | Override `guidelinesDir` |
| `--output <path>` | all | Override `output` |
| `--force` | compile | Overwrite despite hash mismatch |
| `--dry-run` | compile | Print resulting file to stdout, write nothing |
| `--diff` | compile | Show unified diff of the change, write nothing |
| `--quiet` | all | Suppress non-error output |

CLI flags override config file values.

### 7.2 Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, or `check` passed |
| 1 | `check` failed — output is stale and needs recompiling |
| 2 | Refused — hand-edited block detected, `--force` required |
| 3 | Error — unreadable directory, write failure, malformed config |

`check` returning 1 vs. 2 distinguishes "just run compile" from "a human needs to look at this."

### 7.3 Output on success

One line per outcome, naming the fragment count and the result:

```
AGENTS.md  REPLACED  (4 fragments, 2.1 KB)
```

Statuses: `NEW`, `REPLACED`, `UNCHANGED`, `REFUSED`, `NOOP` (no fragments found).

---

## 8. Configuration

`.ai/config.json`, optional. Absent file means all defaults.

```json
{
  "output": "AGENTS.md",
  "guidelinesDir": ".ai/guidelines",
  "exclude": ["90-draft.md"]
}
```

| Key | Type | Default | Notes |
|---|---|---|---|
| `output` | string | `AGENTS.md` | Relative to project root |
| `guidelinesDir` | string | `.ai/guidelines` | Relative to project root |
| `exclude` | string[] | `[]` | Paths relative to `guidelinesDir` |

**Deliberately absent:** ordering array (§3.2), marker strings, separator format, normalization toggles, file extensions. Configurable output *format* would mean two projects' files parse differently and the tool's own regex must handle both.

Unknown keys are an error, not a warning — a typo'd key that silently does nothing is worse than a failed run.

### 8.1 Project root resolution

Walk up from CWD looking for `.ai/`. If none found, use CWD. Do **not** look for `package.json`, `.git`, or any other marker — the tool must work in non-code projects.

---

## 9. Distribution

- Published to npm, runnable via `npx` and installable globally.
- **No `postinstall` hook.** Hooks that write into a user's working tree are viewed with suspicion, and many teams run `--ignore-scripts`. Document an opt-in instead.
- Recommended integration is `check` in CI or a pre-commit hook, not an automatic write. The output is committed; silent mutation is wrong.

---

## 10. Deferred to v2

**Path-scoped guidelines.** Rather than nested `AGENTS.md` files, adopt an index pattern: fragments declare globs, and the tool maintains a small always-loaded index table mapping globs to fragment paths. The agent consults the index and loads only what matches the file it's working on.

Cheaper in tokens than N nested files, works with every agent today without depending on nested-file support, and the index is derived on every compile so it cannot drift.

If adopted, this is the one place front matter becomes justified (`paths:`), since globs cannot be encoded in a filename.

---

## Appendix A — Naming

**Settled:** `cribsheet`. Both `cribsheet` and `crib-sheet` were unpublished as of 2026-09-19, so the name clears npm's similarity check in either form. Claim both — publish the hyphenated form as a stub pointing at the real package so a wrong guess doesn't land on a 404.

**On npm's similarity check:** names are normalized by stripping punctuation and case before comparison, so `foo-bar` and `foobar` collide. Two names rejected on this basis during selection:

- `fieldguide` — collides with `field-guide` (a design-system docs generator, v3.1.0, last published 2025-05)
- `agentsmd` — blocked by typosquat protection, unclaimable unscoped

The exact matching rules aren't publicly documented, so confirm by publishing a stub `0.0.1` before building anything on the name.

**Also verified clear** as fallbacks: `keycard`, `dogtag`, `agentfile`, `agents-cli`.

Existing tools in the space worth differentiating against: `bearings`, `agentseed`, `@agents-dev/cli`, `@agents-mdx/cli`, `@momo792/agentsmd`. All of them generate content by scanning a project. None of them treat the output as a committed, hand-edited file — that gap is this tool's entire pitch and belongs in the first line of the README.

---

## Appendix B — Test matrix

| Case | Expected |
|---|---|
| No output file | Create with block |
| Output exists, no markers | Append block at end |
| Markers present, sha matches, content changed | Replace in place |
| Markers present, sha matches, content identical | `UNCHANGED`, no write |
| Markers present, sha mismatch | Refuse, exit 2 |
| Markers present, no sha attribute | Refuse, exit 2 |
| Content before *and* after block | Both preserved, positions intact |
| Fragment with `# H1` heading | Emitted unchanged |
| Fragment with `===` line inside a fence | Not treated as a separator |
| Fragment with `# comment` inside a bash fence | Not spaced as a heading |
| Fragment with `~~~` fence | Handled as a fence |
| Empty / whitespace-only fragment | Skipped entirely |
| Empty guidelines dir | `NOOP`, no write, exit 0 |
| Missing guidelines dir | `NOOP` with warning, exit 0 |
| Nested subdirectory fragment | Included, sorted by full relative path |
| CRLF fragment | Normalized to LF |
| Interrupted write | Original file intact |
| `check` on stale output | Exit 1 |
| `check` on hand-edited block | Exit 2 |
| Unknown config key | Exit 3 |
