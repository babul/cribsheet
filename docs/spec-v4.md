# cribsheet — Specification

> Compile AGENTS.md from reusable markdown fragments — without clobbering your hand edits.

**Status:** v2, as implemented
**Package:** `cribsheet` (npm), with `crib-sheet` held as an alias — see Appendix A

Supersedes [`spec-v1.md`](spec-v1.md). Every decision recorded here was argued in
[`spec-v3.md`](spec-v3.md); this document states the conclusions without the reasoning, and matches
the code in `src/`. Where the two disagree, that is a bug in one of them — [Appendix C](#appendix-c--changes-from-v1)
lists what moved.

---

## 1. Purpose

Compile a set of hand-written markdown fragments into a single `AGENTS.md`, without destroying
hand-written content in that file.

The tool is a **merge utility with safety guarantees**, not a generator. It never infers content
from the project and never writes text the user did not author, beyond its own separators and
markers.

### 1.1 Design premises

- `AGENTS.md` is a **committed source file** that humans edit, not a build artifact.
- Fragments in `.ai/guidelines/` are **committed** and copied by hand between projects. No sync, no
  registry, no network.
- The project may be **any type** — code, prose, research, ops notes. Nothing assumes a codebase.
- When the tool cannot act safely, it **refuses**. Silent corruption is the failure mode it exists
  to prevent, and a visible refusal is always preferable to a quiet wrong answer.

### 1.2 Non-goals

| Excluded | Reason |
|---|---|
| Templating / variable interpolation | Fragments are literal text |
| Project or dependency scanning | Tool is content-agnostic |
| Sibling output files (`CLAUDE.md`, `.cursor/rules`) | Out of scope |
| Linting, token budgeting, dead-link checks | Out of scope |
| Nested / path-scoped guidelines | Deferred (§10) |
| Shipped default guidelines | User supplies 100% of content |
| Fetching from git / npm / remote | No external source of truth |

---

## 2. File layout

```
<project root>/
├── AGENTS.md              # output — committed, hand-editable
└── .ai/
    ├── config.json        # optional; not created by init
    └── guidelines/
        ├── 00-foundation.md
        ├── 10-git.md
        ├── 20-shortcuts.md
        └── 25-writing/
            └── 30-tone.md
```

The subdirectory carries its own numeric prefix because directories sort as a unit (§3.2). A bare
`writing/` would sort after every top-level file beginning with a byte below `w`, regardless of the
numbering inside it.

---

## 3. Fragments

### 3.1 Discovery

Recursive walk of `<guidelinesDir>`:

- Only the exact lowercase extension `.md` is recognised.
- Other extensions are ignored silently. A **case-variant** extension (`.MD`, `.Md`) is ignored with
  a warning — it is a near-miss, and a silent drop would be indistinguishable from a bug.
- Entries whose name begins with `.` are ignored, **files and directories alike**.
- **Symlinks are skipped with a warning**, files and directories both. The walk is hand-rolled
  rather than `readdirSync({recursive:true})` precisely because that call descends into symlinked
  directories, which turns a symlink loop into a hang.
- A fragment that is empty or whitespace-only after trimming is **skipped** — no separator, no body.
- An unreadable directory or file is exit 3.

### 3.2 Ordering

Sort by the **POSIX path relative to `guidelinesDir`**, ascending, compared as UTF-8 **bytes** (not
UTF-16 code units — they differ above the BMP).

Ordering is controlled entirely by filename. The convention is a numeric prefix (`00-`, `10-`,
`20-`) leaving gaps for insertion. There is no `order:` field, no config array, no front matter.

**Rationale:** filename ordering is visible in `ls`, sorts identically in every tool, requires no
parsing, and cannot drift out of sync with the folder. An ordering list in config would mean adding
a file silently does nothing until config is also edited.

**Consequence:** a directory name is compared against sibling *filenames*, so numeric prefixes order
files only *within* a directory. Prefix your directories too if you want them interleaved.

### 3.3 Format

Plain markdown. No front matter is parsed, no directives interpreted.

**The tool never rewrites heading levels.** A fragment containing `# Git conventions` emits
`# Git conventions`; nothing is demoted or promoted. Whitespace *is* adjusted — see §§4.2–4.3.

---

## 4. Composition

### 4.1 Separator

Each fragment is preceded by a line naming its source path relative to the project root:

```
=== .ai/guidelines/10-git.md ===
```

Format: `=== ` + relative POSIX path + ` ===`, on its own line, followed by one blank line.

**Rationale:** it sits outside the markdown heading system, so fragment headings need no
transformation; it reads as a seam rather than authored prose; and naming the path makes provenance
actionable.

**Accepted cost:** unlike the §5.1 markers, the separator is *visible* in rendered output and is
text no human wrote, which is in tension with §1. The trade is deliberate — an invisible seam would
leave a reader in a preview pane unable to tell managed content from their own, which is the
distinction this tool exists to protect.

### 4.2 Assembly

```
=== <path A> ===

<body A>

=== <path B> ===

<body B>
```

Each fragment body is normalised (§4.3) **on its own, before assembly**, so an error names the file
it came from. Bodies are stripped of leading and trailing **blank lines** — not arbitrary
whitespace, which would eat the four-space indent of a leading indented code block. Blocks are
joined with one blank line.

### 4.3 Normalization

Applied per fragment, in this order:

1. **Line endings, globally:** `\r\n` → `\n`, bare `\r` → `\n`. This runs first and is *not*
   scoped to unprotected regions: a fence whose closing line still carries `\r` will not match its
   opener, and the scanner desyncs.
2. **A single line-oriented pass** carrying protected-context state, which:
   - ensures exactly one blank line before each ATX heading, except at the start of the fragment;
   - ensures exactly one blank line after each ATX heading;
   - emits at most one consecutive blank line.

Four sequential regex passes over the whole string is the obvious implementation and the wrong one:
each pass shifts the offsets the protected-region scan computed. One pass holds state and output
together.

#### 4.3.1 ATX headings

```
/^ {0,3}#{1,6}(?:[ \t]|$)/
```

Up to three leading spaces, one to six `#`, then a space, a tab, or end of line. Four or more
leading spaces is an indented code block, not a heading. Seven `#` is a paragraph. `#hashtag` is a
paragraph. `#` and `#\tTitle` are headings. A heading's own leading spaces are preserved.

#### 4.3.2 Protected contexts

Four kinds of content are literal and must survive byte-for-byte. All four are handled:

- **Fenced code.** Opener: up to three leading spaces, then three or more `` ` `` or `~`. A backtick
  fence whose info string contains a backtick is not a fence. Closer: same character, **at least**
  the opening length, followed only by spaces or tabs. A closer may not carry an info string.
- **HTML blocks.** A line at a block boundary matching `/^ {0,3}<[!/?]?[a-zA-Z][a-zA-Z0-9-]*/` opens
  one; a blank line closes it. Without this, inserting a blank line before `# literal` inside
  `<div>…</div>` *terminates the HTML block* and turns the line into a real heading.
- **Indented code.** The ATX pattern already cannot match a four-space-indented line, so headings
  are safe by construction. The remaining exposure is blank lines: a blank line between two
  indented-code lines is content, and is preserved rather than collapsed.
- **Inline code spans.** Relevant to marker detection, not normalization — a code span cannot begin
  a line with `#`. See §5.2.

**Unterminated fences are exit 3**, naming the fragment and the opening line. Normalising fragments
independently is not a fix: CommonMark ends an unclosed fence at the *document* boundary, so the
composed `AGENTS.md` would still render every later fragment as code. Refusing is the only honest
option.

**On indented code specifically:** the scanner is conservative rather than clever. Classifying a
four-space-indented line correctly needs list and paragraph-continuation context — most of a
CommonMark block parser. Over-protecting (preserving a blank line that could have been collapsed)
is cosmetic; under-protecting corrupts. The scanner over-protects.

---

## 5. Output format

### 5.1 Managed block

```markdown
Hand-written preamble. Never touched.

<!-- cribsheet:begin -->
=== .ai/guidelines/00-foundation.md ===

...composed content...
<!-- cribsheet:end sha=a3f9c2e81b04 -->

Hand-written notes below. Also never touched.
```

- Markers are **HTML comments**, invisible in every renderer.
- The `sha` carries a content hash (§6.1).
- Everything outside the markers is user territory, preserved **byte-for-byte including its line
  endings**. A CRLF preamble stays CRLF.

### 5.2 Marker detection

Markers must be **standalone lines**:

```
/^\s*<!--\s*cribsheet:begin\s*-->\s*$/
/^\s*<!--\s*cribsheet:end(?:\s+sha=([0-9a-f]+))?\s*-->\s*$/
```

The marker names the tool, not the file's subject. `AGENTS.md` is a multi-tool convention, so a
generic `agents:` marker invites a collision in which two tools claim the same block; a
tool-specific one lets several coexist in one file. It also stays accurate when `output` points
somewhere that is not an agents file at all.

The standalone-line requirement is what stops `` `<!-- cribsheet:begin -->x<!-- cribsheet:end -->` `` in a
code span from being read as a block. Detection also runs the §4.3.2 context scanner over the output
file and **ignores markers inside fenced or HTML blocks**, so a file may document the marker syntax
— including this specification, and cribsheet's own `AGENTS.md`.

Malformed marker sets are exit 3, not a guess:

| Condition | Result |
|---|---|
| No markers at all | Not an error; §6.1 case 2 |
| Two or more `cribsheet:begin` | Exit 3 |
| Two or more `cribsheet:end` | Exit 3 |
| `begin` with no `end`, or `end` with no `begin` | Exit 3 |
| `end` appearing before `begin` | Exit 3 |

---

## 6. Safety

### 6.1 Hash guard

- **Hash input:** the trimmed content between the markers, excluding the marker lines. The **raw**
  bytes — deliberately not normalised first. Normalising before hashing would make
  `# H\n\nText` and `# H\nText` hash identically and silently discard a real hand edit, while still
  failing to absorb the paragraph reflow a formatter actually produces.
- **Algorithm:** SHA-256, hex, truncated to 12 characters. 48 bits — sized for accident detection,
  not adversaries.
- **On compile:**

| # | State | Result |
|---|---|---|
| 1 | Output file does not exist | Create it containing only the block. `NEW` |
| 2 | Exists, no markers | Append the block at the end, one blank line clear. `NEW` |
| 3 | Markers, stored `sha` matches the current body | Replace. `REPLACED`, or `UNCHANGED` if identical |
| 4 | Markers, **no** `sha` | Unmanaged. Refuse, exit 2 |
| 5 | Markers, stored `sha` does **not** match, body differs from the composition | Hand-edited. Refuse, print the diff, exit 2. `--force` overrides |
| 5a | Markers, stored `sha` does **not** match, body equals the composition | Replace. The hashed content is unchanged; the `sha` is updated. `REPLACED`. Nothing can be lost |
| 6 | Zero fragments **and** a populated block exists | Refuse, exit 2. `--allow-empty` overrides |

Cases 5 and 6 are the point. Case 6 catches a wrong `--dir`, a bad working directory, or a botched
merge — situations where compiling would leave agents reading guidelines that no longer exist.

Case 5a is the end of recovering from case 5. Once the hand edit has been moved into a fragment,
the block's trimmed body is byte-identical to the composition. The rewrite leaves that content
as it is and updates the `sha` (re-rendering may also tidy whitespace at the block's edges and the
marker lines, which the hash ignores), so it needs no `--force`. The comparison uses the same trimmed raw bytes the hash covers,
never a normalised form, so any difference at all is still case 5.

**On formatters.** Prettier and friends will reformat `AGENTS.md` and break the sha on a change no
human made, and case 5 will fire. Exclude the output from your formatters — add it to
`.prettierignore` and to any formatting pre-commit hook. Do not "solve" this by normalising the hash
input; see above.

### 6.2 Atomic write

1. Create the output's parent directory if missing — the path is configured, so it is intended.
2. **Re-read the target and compare it to what was read at the start of the run.** If it changed,
   refuse with exit 2 and write nothing: an editor saved during the run, and the rename would
   silently discard it. This narrows the race, it does not close it.
3. Write a sibling temp file in the same directory, inheriting the target's existing mode so a
   rename does not silently change permissions.
4. `fsync` the file, `rename` over the target, then `fsync` the directory.

Never truncate-then-write in place. An interrupted run leaves the original intact up to the rename;
after it, the new file is complete.

### 6.3 Trailing newline

Output ends with exactly one `\n` **when the tool created the file, or when the managed block
reaches EOF**. Otherwise the user's existing suffix bytes are preserved unchanged — enforcing a
trailing newline against hand-written content would violate §5.1.

### 6.4 Orphaned block warning

If `output` is configured away from the default and `AGENTS.md` at the project root still contains a
begin marker, warn. A stale managed block keeps being read by agents.

Warning only — never modify or delete the orphan. This is the one place the tool looks at a file it
was not asked about; §1's premise is "never infers *content* from the project", which this respects.

---

## 7. CLI

| Command | Behaviour |
|---|---|
| `cribsheet` | Alias for `compile` |
| `cribsheet compile` | Compose and write |
| `cribsheet check` | Exit non-zero if stale or hand-edited. Writes nothing |
| `cribsheet init` | Create `.ai/guidelines/`. Idempotent; writes no config |

### 7.1 Flags

| Flag | Applies to | Effect |
|---|---|---|
| `--dir <path>` | all | Override `guidelinesDir` |
| `--output <path>` | all | Override `output` |
| `--force` | compile | Overwrite despite a hash mismatch |
| `--allow-empty` | compile | Clear the block when no fragments are found |
| `--dry-run` | compile | Print the resulting file to stdout, write nothing |
| `--diff` | compile | Print a unified diff to stdout, write nothing |
| `--quiet` | all | Suppress the status line |
| `--help`, `--version` | — | Print to stdout, exit 0 |

CLI flags override config values. `--dry-run` and `--diff` together is a usage error: both claim
stdout, and silently picking one would surprise.

### 7.2 Streams

- **stdout** carries payloads only: the composed file under `--dry-run`, the diff under `--diff`,
  and `--help` / `--version`. Nothing else, so `cribsheet --dry-run > new.md` and
  `cribsheet --diff | git apply` both work.
- **stderr** carries the status line, all warnings, the case-5 refusal diff, and errors. The refusal
  diff is on stderr because it explains an exit 2; it is not a payload anyone requested.
- `--quiet` suppresses **the status line only**. Warnings and errors always print — warnings exist
  to surface silent-divergence hazards, so a flag that hid them would defeat the feature.

### 7.3 Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, or `check` passed |
| 1 | `check` failed — output is stale, run `compile` |
| 2 | Refused — a human should look |
| 3 | Error — unreadable directory, write failure, malformed config, malformed markers |
| 4 | Usage — the command line is wrong; nothing was attempted |

**Invariant:** `check` returns **2** only when markers are present and their integrity cannot be
verified. Everything else that is not clean is **1**. So 1 means "run compile" and 2 means "read the
diff first".

| State | `compile` | `check` |
|---|---|---|
| Output absent | `NEW`, 0 | 1 |
| Exists, no markers | `NEW`, 0 | 1 |
| Markers, sha matches, content differs | `REPLACED`, 0 | 1 |
| Markers, sha matches, content identical | `UNCHANGED`, 0 | 0 |
| Markers, no sha | `REFUSED`, 2 | 2 |
| Markers, sha mismatch, body differs from the composition | `REFUSED`, 2 | 2 |
| Markers, sha mismatch, body equals the composition | `REPLACED`, 0 | 1 |
| Zero fragments, no block | `NOOP`, 0 | 0 |
| Zero fragments, populated block | `REFUSED`, 2 | 2 |

Exit 4 is distinct from 3 because they route differently: 3 says the repository or environment is
broken, 4 says the invocation is. Merging them sends a CI operator to inspect the repo when the
fault is the command line.

### 7.4 Status line

One line on stderr:

```
AGENTS.md  REPLACED  (4 fragments, 2.1 KB)
```

Statuses: `NEW`, `REPLACED`, `UNCHANGED`, `REFUSED`, `NOOP`. `check` reports `STALE` where compile
would report `NEW` or `REPLACED`.

---

## 8. Configuration

`.ai/config.json`, optional. **`init` does not create it** — every key has a working default, and a
scaffolded config would have to track the schema forever, breaking every scaffolded project on a
future key rename. The keys are documented in the README and printed by `init`.

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
| `exclude` | string[] | `[]` | Anchored globs, relative to `guidelinesDir` |

**Deliberately absent:** ordering array (§3.2), marker strings, separator format, normalization
toggles, file extensions. A configurable output *format* would mean two projects' files parse
differently and the tool's own scanner must handle both.

Unknown keys are an error, not a warning. So are wrong value types. A typo that silently does
nothing is worse than a failed run.

### 8.1 Exclude semantics

Patterns match the POSIX path relative to `guidelinesDir`, anchored at its root.

| Pattern | Matches |
|---|---|
| `90-draft.md` | the top-level file only — **not** `writing/90-draft.md` |
| `**/90-draft.md` | that name at any depth |
| `writing/**` | the whole subtree |
| `writing` | nothing; a file literally named `writing` |

`*` does not cross `/`; `**` does. Matching is case-sensitive, consistent with §3.2. No negation and
no brace expansion — both can be added later, neither can be removed.

**A pattern matching no fragment warns.** §8 makes a typo'd *key* a hard error; a typo'd *pattern*
has the same failure mode and must not be silent. It is not fatal, because deleting a
previously-excluded fragment is legitimate, and the warning survives `--quiet`.

### 8.2 Project root resolution

Walk up from CWD looking for `.ai/`, **stopping before `$HOME` and at the filesystem root**. If
none is found, use CWD. Do not look for `package.json` or `.git` — the tool must work in non-code
projects. Without the `$HOME` boundary the walk would adopt a monorepo root's or a home
directory's `.ai/` and write to the wrong file.

### 8.3 Path containment

`output` and `guidelinesDir` must resolve inside the project root.

- Absolute paths are exit 3; §8 defines both keys as relative.
- Relative paths are resolved and checked by **real path**, so a symlink inside the root pointing
  outside it is caught.
- The same constraint applies to `--dir` and `--output`. `--dry-run` and `--diff` validate
  identically, so the flags cannot be used to probe for files outside the root.
- `output` resolving **inside `guidelinesDir`** is exit 3: the first compile would create a new
  discoverable fragment and every later compile would ingest its own output.

---

## 9. Distribution

- Published to npm, runnable via `npx` and installable globally.
- **Zero runtime dependencies.** Node 22.5+ supplies `path.matchesGlob` and `node:crypto`; the unified
  diff is hand-rolled. A trust-first tool with a large transitive tree undercuts its own pitch.
- **Node 22.5+**, ESM. Tests use `node:test`.
- **No `postinstall` hook.** Hooks that write into a working tree are viewed with suspicion, and
  many teams run `--ignore-scripts`.
- Recommended integration is `check` in CI or a pre-commit hook, not an automatic write. The output
  is committed; silent mutation is wrong.

---

## 10. Deferred

**Path-scoped guidelines.** Rather than nested `AGENTS.md` files, an index pattern: fragments
declare globs, and the tool maintains a small always-loaded index mapping globs to fragment paths.
The agent consults the index and loads only what matches the file it is working on.

Cheaper in tokens than N nested files, works with every agent today, and the index is derived on
every compile so it cannot drift. This is the one place front matter becomes justified (`paths:`),
since globs cannot be encoded in a filename.

---

## Appendix A — Naming

**Settled:** `cribsheet`. Both `cribsheet` and `crib-sheet` were unpublished as of 2026-09-19, so
the name clears npm's similarity check in either form. Claim both — publish the hyphenated form as
a stub pointing at the real package, with a real README, so a wrong guess does not land on a 404.

**On npm's similarity check:** names are normalized by stripping punctuation and case, so `foo-bar`
and `foobar` collide. Two names rejected on this basis:

- `fieldguide` — collides with `field-guide` (design-system docs generator, v3.1.0, 2025-05)
- `agentsmd` — blocked by typosquat protection, unclaimable unscoped

The exact rules are not publicly documented, so confirm by publishing a stub `0.0.1` first.

**Also verified clear** as fallbacks: `keycard`, `dogtag`, `agentfile`, `agents-cli`.

Existing tools worth differentiating against: `bearings`, `agentseed`, `@agents-dev/cli`,
`@agents-mdx/cli`, `@momo792/agentsmd`. All generate content by scanning a project. None treats the
output as a committed, hand-edited file — that gap is this tool's pitch and belongs in the first
line of the README.

---

## Appendix B — Test matrix

Implemented in `test/`; 103 cases at time of writing.

**Output states**

| Case | Expected |
|---|---|
| No output file | Create with block |
| Output exists, no markers | Append at end, existing content preserved |
| Markers, sha matches, content changed | Replace in place |
| Markers, sha matches, content identical | `UNCHANGED`, no write |
| Markers, sha mismatch | Refuse, exit 2, diff printed |
| Markers, no sha attribute | Refuse, exit 2 |
| `--force` on sha mismatch | Overwrites |
| Content before *and* after block | Both preserved, positions intact |
| CRLF in user territory | Preserved byte-for-byte |
| Output ends without / with extra newline, block not last | Suffix bytes unchanged |
| Block reaches EOF | Exactly one trailing `\n` |
| Two begin markers; two ends; end before begin | Exit 3 |
| Marker syntax inside a fence | Ignored |
| Marker syntax inside an inline code span | Ignored |
| File modified between plan and rename | Refuse, exit 2, original intact |

**Fragments**

| Case | Expected |
|---|---|
| Empty / whitespace-only fragment | Skipped entirely |
| Empty guidelines dir | `NOOP`, no write, exit 0 |
| Missing guidelines dir | `NOOP` with warning, exit 0 |
| Populated block, zero fragments | Refuse, exit 2 |
| `--allow-empty` with zero fragments | `NOOP` |
| Nested subdirectory fragment | Included, sorted by full relative path |
| Directory vs. sibling filenames | Sorts as a unit, not by inner prefix |
| Hidden file; hidden directory | Ignored |
| `.MD` / `.Md` | Ignored with warning |
| Non-markdown extension | Ignored silently |
| Symlinked fragment | Skipped with warning |
| Symlink loop | No hang |

**Normalization**

| Case | Expected |
|---|---|
| CRLF fragment; bare CR | Normalized to LF |
| CRLF closing fence | Still closes |
| `# H1` heading | Level unchanged |
| Heading at fragment start | No blank line inserted before |
| Consecutive headings | Exactly one blank line between |
| `#####`, `######` | Spaced consistently |
| `#######`; `#hashtag` | Not headings |
| `#` alone; `#\tTitle` | Headings |
| Three-space-indented heading | Heading; indentation preserved |
| Runs of blank lines | Collapse to one |
| `#` inside a bash fence | Not spaced |
| `===` inside a fence | Byte-identical |
| `~~~` fence | Handled |
| Shorter run inside a longer fence | Does not close |
| Longer run closing a shorter fence | Closes |
| Closing fence with an info string | Does not close |
| Backtick fence whose info holds a backtick | Not a fence |
| Unterminated fence | Exit 3, names the line |
| `# literal` inside `<div>` | Not turned into a heading |
| HTML block ended by a blank line | Normalization resumes |
| `#` inside an indented code block | Not a heading |
| Blank lines inside an indented code block | Preserved |
| Normalize twice; compile twice | Identical output, `UNCHANGED` |

**Config and CLI**

| Case | Expected |
|---|---|
| Unknown config key; wrong value type | Exit 3 |
| Malformed JSON; non-object JSON | Exit 3 |
| Absolute path in config | Exit 3 |
| Path escaping the root; symlink escaping the root | Exit 3 |
| `output` inside `guidelinesDir` | Exit 3 |
| Root found by walking up | Correct root |
| `~/.ai` above the project | Not adopted |
| Anchored glob cases (§8.1, four rows) | As tabulated |
| Exclude matching nothing | Warns, exit 0, survives `--quiet` |
| Exclude matching everything | Zero fragments |
| Unknown flag; unknown command; `--dry-run --diff` | Exit 4, usage on stderr |
| `--help`, `--version` | stdout, exit 0 |
| Status line | stderr, never stdout |
| `--dry-run`, `--diff` | Payload on stdout, nothing written |
| `--quiet` | Status suppressed, warnings kept |
| `check` fresh / stale / missing file / markerless / hand-edited | 0 / 1 / 1 / 1 / 2 |
| `init` twice | Exit 0, nothing overwritten, no config written |
| `.ai` exists as a file | Exit 3 |
| Orphaned block at default path | Warns |

---

## Appendix C — Changes from v1

Reasoning for each is in [`spec-v3.md`](spec-v3.md).

**Contradictions resolved**

- `init` no longer writes a "commented `.ai/config.json`" — JSON has no comments and §8 rejected the
  file it produced. It now writes no config at all (§8).
- Line-ending conversion moved out of the fence-scoped rules and made global (§4.3).
- "Byte-for-byte" narrowed to the guarantee actually offered: heading levels are never rewritten
  (§3.3).
- §2's example directory gained a numeric prefix, so the layout demonstrates §3.2 instead of
  working by coincidence.

**Added**

- Exit 4 for usage errors (§7.3), and the `check` invariant and full state table.
- HTML blocks, inline code spans and indented code as protected contexts (§4.3.2).
- Unterminated fences are exit 3 (§4.3.2); duplicate and inverted markers are exit 3 (§5.2).
- Markers must be standalone lines and are ignored inside protected contexts (§5.2).
- Zero fragments against a populated block is a refusal, with `--allow-empty` (§6.1 case 6).
- Re-verification before rename, parent-directory creation, mode preservation, directory `fsync`
  (§6.2).
- Trailing-newline carve-out for user territory (§6.3).
- Path containment, `$HOME` boundary, and output-inside-guidelines rejection (§§8.2–8.3).
- Exclude glob semantics and the no-match warning (§8.1).
- Stream discipline, `--allow-empty`, `--help`, `--version` (§§7.1–7.2).
- Symlink and case-variant-extension handling (§3.1).
- ATX heading detector specified exactly; cap raised from `####` to `######` (§4.3.1).
- Zero-dependency and Node 22 commitments (§9).

**Changed after v4 was first written**

- Markers renamed from `agents:begin` / `agents:end` to `cribsheet:begin` / `cribsheet:end`
  (§5.2). Done before publication, when the only file carrying them was this repo's own
  `AGENTS.md`. Deferring would have made it a migration: existing files would stop being
  recognised and compile would append a second block below the unrecognised first one.
  v1-v3 still show the old name; they record what was proposed and reviewed at the time.

**Explicitly not changed**

- The hash input stays raw. Normalising it first — proposed and withdrawn in review — makes a real
  hand edit hash identically to the pre-edit content (§6.1).
- The `=== path ===` separator format stays, with its cost now stated (§4.1).
- §6.4's orphan warning stays; §1's premise was reworded to accommodate it.
