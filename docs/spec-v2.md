# cribsheet spec review — v2

> **Superseded by [`spec-v3.md`](spec-v3.md).** Kept for provenance.
> §3 (normalized hashing) is wrong and was withdrawn; §1.4 is not a defect; §§1.2, 1.5, 2.1, 4, 6.1
> and 6.2 are overstated. v3 Appendix A lists every correction. Read v3 instead.

Claude's review of [`spec-v1.md`](spec-v1.md), draft v1, dated 2026-09-19. No code exists yet;
this is a pre-implementation read for internal contradictions, undefined states, and decisions the
spec leaves open.

Section references (§) are to the spec.

---

## 1. Contradictions

These are defects in the document, not judgment calls. Each one makes two parts of the spec
disagree about what the tool does.

### 1.1 `init` generates a config that `compile` rejects

§7 says `init` creates "a commented `.ai/config.json`". JSON has no comment syntax, and §8 says a
malformed config is exit 3. The tool's own scaffold fails the tool's own parser on the next run.

**Resolution.** Three options, in order of preference:

1. `init` writes no config at all. Every key has a working default, so an absent file is the
   correct scaffold. Document the keys in the README.
2. Use JSONC via a tolerant parser, and state that in §8.
3. Name the file `.ai/config.jsonc` so the extension advertises the dialect.

### 1.2 §4.3 rule 1 is scoped wrong

The preamble scopes all four normalization rules to "outside fenced code blocks only", but CRLF→LF
conversion has to be global *and* has to run before fence detection. With CRLF intact, a closing
fence reads as `` ```\r `` and may not match its opener, which desynchronises the fence state
machine for the remainder of the file.

**Resolution.** Rule 1 is a pre-pass over the whole string. Rules 2–4 are the fence-aware set.
Restate §4.3 as "line endings are normalized first, globally; the following are applied outside
fenced code blocks".

### 1.3 §3.3 says "byte-for-byte"; §4.3 rewrites fragment bodies

§4.3 inserts and removes blank lines inside fragment bodies, and §4.2 trims them. The claim §3.3 is
actually making is narrower: heading *levels* are never rewritten.

**Resolution.** Replace "copied through byte-for-byte" with the specific guarantee — no heading
demotion or promotion, no directive interpretation, no front matter parsing — and cross-reference
§4.3 for the whitespace normalization that does apply.

### 1.4 §2's example layout contradicts §3.2's sort

§3.2 sorts by byte comparison of the relative path. `w` (0x77) is greater than every ASCII digit, so
`writing/30-tone.md` sorts after *every* top-level fragment regardless of its `30-` prefix.
Directory names dominate numeric prefixes; the `30-` in the §2 example is decorative.

**Resolution.** State the consequence in §3.2 — subdirectories sort as a unit and prefix numbering
is per-directory — and give the §2 example a prefixed directory name (`25-writing/`) so the layout
demonstrates the rule rather than contradicting it.

### 1.5 Normalizing the assembled string lets one fragment corrupt the rest

§4.3 applies normalization to the assembled string. A single unterminated ``` in an early fragment
puts every subsequent fragment inside a fence, silently disabling normalization for the rest of the
output. Unterminated fences are not mentioned anywhere in the spec.

**Resolution.** Normalize each fragment independently, before assembly. Fence state then cannot
cross a seam, and a malformed fence damages only its own fragment. Add an explicit rule for what an
unterminated fence does — the cheap answer is that it terminates at the end of its fragment.

---

## 2. Undefined states

Cases the spec does not cover that will be reached in ordinary use.

### 2.1 Managed block exists, guidelines directory is now empty

§7.3 defines `NOOP` as "no fragments found"; Appendix B covers an empty directory only for the case
where no output block exists. If a populated managed block exists and the fragment count drops to
zero, the choices are: leave the stale block (guidelines deleted, agents keep reading them), or
empty the block (silent deletion of committed content). Both are bad defaults, and the spec picks
neither.

**Recommendation.** Refuse with exit 2 and require an explicit flag (`--allow-empty`). Zero
fragments alongside a populated block is far more likely to be a wrong `--dir` or a bad `cwd` than
an intentional deletion. This is the same silent-divergence hazard §6.4 exists to warn about.

### 2.2 `check`'s exit code is defined for two of five states

§6.1 enumerates five output-file states. §7.2 maps only two onto `check` (stale → 1, hand-edited →
2). The table needs all five:

| §6.1 state | `compile` | `check` |
|---|---|---|
| Output file absent | `NEW`, 0 | ? |
| Exists, no markers | `NEW` (append), 0 | ? |
| Markers, sha matches, content differs | `REPLACED`, 0 | 1 |
| Markers, sha matches, content identical | `UNCHANGED`, 0 | 0 |
| Markers, no sha attribute | `REFUSED`, 2 | 2 |
| Markers, sha mismatch | `REFUSED`, 2 | 2 |

"Exists, no markers" is the genuinely ambiguous row: 1 if a markerless file is a fresh start, 2 if
it means a block was lost. Pick one and say why.

### 2.3 Two begin markers, or `end` before `begin`

The §5.2 regex is non-greedy and single-match. Two begin markers means the first pair matches and
the second block silently persists as unmanaged content that agents still read. An `end` marker with
no preceding `begin` fails to match at all, so §6.1 case (2) applies and a *second* block is appended
below the orphaned marker.

**Recommendation.** Both are exit 3. Count marker occurrences before matching rather than relying on
the regex to do it.

### 2.4 Marker syntax inside a fence in user territory

The §5.2 regex has no concept of code blocks. The example block in §5.1, pasted into a real
`AGENTS.md` as documentation, breaks that file. This is immediately relevant: cribsheet's own
`AGENTS.md` cannot document cribsheet.

**Recommendation.** Run the same fence scanner used by §4.3 over the output file and ignore markers
found inside fences. Add to the test matrix.

---

## 3. The most likely real-world false refusal

Prettier, `end-of-file-fixer`, `trailing-whitespace`, and most markdown formatters will reformat
`AGENTS.md` and break the stored sha on a change no human made. Compile then refuses on every run
until someone passes `--force`, which trains people to reach for `--force` reflexively — destroying
the exact guarantee the tool is built to provide.

The spec has no answer for this and needs one in §6.

**Recommendation, in order:**

1. **Hash the normalized form on both sides.** Run the §4.3 normalization over the extracted block
   body before hashing it, so cosmetic reformatting is hash-invariant and only semantic hand edits
   trip the guard. This is the real fix.
2. Document adding `AGENTS.md` to `.prettierignore` and to any formatting pre-commit hook.

**Related:** `--force` currently destroys hand edits with no recovery path. §6.1(5) prints a diff
when it refuses; `--force` should print the same diff, and should write the clobbered block to
`AGENTS.md.orig` before renaming.

---

## 4. Open decisions

Each of these is underspecified rather than wrong. Implementation cannot proceed without picking.

**`exclude`: globs or literal paths?** The §8 example is a bare filename. Literal-only matching
means excluding a subdirectory requires enumerating every file in it, and files added there later
are silently included — precisely the drift failure §3.2 cites when rejecting a config-based
ordering array. *Recommendation:* support globs, and say which dialect.

**Heading rules stop at `####`.** `#####` and `######` are valid ATX and would get inconsistent
spacing. No stated reason for the cap. *Recommendation:* `#` through `######`.

**Four-space indented code blocks are unprotected.** §4.3 specifies fence detection carefully, then
a `# comment` inside a four-space-indented shell snippet gets blank lines injected around it. Same
bug class, second syntax. *Recommendation:* treat a four-space-indented run following a blank line
as code, or state explicitly that indented code blocks are out of scope and why.

**ATX detection needs a definition.** CommonMark requires a space after the `#` and permits up to
three leading spaces; four or more makes it an indented code block. A naive `/^#+/` mangles
`#hashtag` lines. *Recommendation:* specify the regex in §4.3.

**Rule execution order.** Rule 4 must run last, or rules 2 and 3 double-space consecutive headings.
The numbering implies it; make it explicit.

**stdout vs stderr.** `--dry-run` writes the file to stdout, `--diff` writes a diff, §7.3 writes a
status line, §6.4 writes a warning. No stream is assigned. *Recommendation:* machine-consumable
output (the composed file, the diff) on stdout; status lines and warnings on stderr. Also define
`--dry-run --diff` together, and confirm `--quiet` does not suppress the §6.4 warning — it is not an
error, but it is the one thing the user most needs to see.

**`--version`, `--help`, and unknown-flag exit code.** None are in §7. Exit 3 is described as I/O
and config failures; usage errors need their own home (conventionally 2, but that is taken — so
either 3 or a new 4).

**`init` when `.ai/` already exists.** "Never overwrites" does not say whether that is exit 0 with a
message or exit 3.

**`output` path traversal.** Nothing constrains `output` or `guidelinesDir` to the project root.
`"output": "../../../etc/something"` should be exit 3.

---

## 5. Two structural objections

### 5.1 §8.1's upward walk has no stop condition

"Walk up from CWD looking for `.ai/`" will find a monorepo root's `.ai/`, or `~/.ai/`, and write to
the wrong `AGENTS.md` without saying so. Ruling out `.git` as a *discovery* marker is right; the
tool still needs a *boundary*.

**Recommendation.** Stop at `$HOME` and at the filesystem root. Print the resolved project root in
the §7.3 status line so a wrong resolution is visible rather than silent.

### 5.2 §6.4 contradicts §1's stated design premise

"It never inspects the project" is the tool's declared character, and §6.4 is project inspection. It
is also narrow: it looks only for the hardcoded name `AGENTS.md` at the root, so migrating
`docs/A.md` → `AGENTS.md` leaves an undetected orphan at the old path.

**Recommendation.** Either drop §6.4 as scope creep, or restate the §1 premise as "never infers
content from the project" — which is the guarantee that actually matters — and accept §6.4 as a
deliberate, documented heuristic with known blind spots.

---

## 6. Test matrix

### 6.1 Rows to remove or rewrite

**"Fragment with `===` line inside a fence → not treated as a separator."** Nothing in the tool ever
*parses* separators; they are write-only. There is no code path this test can exercise. The real
fence risk is heading spacing, which the following row already covers. Delete.

**"Interrupted write → original file intact."** Not testable as written without fault injection or
killing a child process mid-run. Either specify the mechanism or replace it with a unit test
asserting the write sequence is temp → fsync → rename and that no `open(O_TRUNC)` touches the
target.

### 6.2 Rows to add

In rough order of value:

| Case | Expected |
|---|---|
| **Compile twice over arbitrary fragments** | Second run is `UNCHANGED` |
| Unterminated fence in one fragment, content follows | Later fragments still normalized |
| Four-space indented block containing `#` | Not spaced as a heading |
| `#####` / `######` headings | Spaced consistently with `#`–`####` |
| Two begin markers in output | Exit 3 |
| `agents:end` before `agents:begin` | Exit 3, no second block appended |
| Marker syntax inside a fence in user territory | Ignored, not matched |
| Managed block populated, zero fragments | Refuse (per §2.1) |
| `check` when output file is missing | Per §2.2 table |
| `--force` on sha mismatch | Overwrites, prints diff, writes `.orig` |
| Output reformatted by Prettier, then compile | Per §3 — no false refusal |
| `.MD` / `.Md` extension | Defined (recognised or ignored, but stated) |
| Hidden *directory* under guidelines | Defined |
| Symlinked fragment; symlink loop | Defined, no hang |
| `exclude` with a wrong type (`"x.md"` not `["x.md"]`) | Exit 3 |
| `output` resolving outside project root | Exit 3 |

The first row is the highest-value test in the suite and is absent from the current matrix.
`compile(compile(x)) == compile(x)` as a property over generated fragments covers the entire
normalization class in one test — every blank-line rule, every fence case, and the trailing-newline
guarantee — and it is the invariant most likely to break during refactoring.

---

## 7. Reconsider: the separator format

§4.1's `=== path ===` separator is explicitly visible, while §5.1 argues for HTML comment markers
precisely *because* they are invisible. The split is deliberate and the stated rationale is coherent:
a reader who wants to change the text should see where it came from.

The cost is that every separator is prose an agent reads and pays tokens for, and it is the only
content in the output that no human authored — which sits awkwardly against §1's "never writes
content the user did not author".

`<!-- .ai/guidelines/10-git.md -->` keeps provenance for anyone editing the raw file and costs
nothing in the rendered view. The tradeoff to weigh explicitly: invisible seams mean a reader in a
markdown preview pane cannot tell managed content from hand-written content, which is exactly the
distinction the tool exists to protect.

No recommendation — but the decision deserves a sentence in §4.1 acknowledging the token cost and
the §1 tension, rather than only the case in favour.

---

## 8. Smaller notes

- **Hash strength.** 12 hex characters is 48 bits — appropriate for accident detection, not
  adversarial. Worth one line in §6.1 so the question does not come up in review.
- **§5.2 `sha` length.** The pattern `[0-9a-f]+` does not pin the length. A 40-character sha is a
  different tool's output, not a mismatch, and deserves a distinct error.
- **§6.2 durability.** Also `fsync` the containing directory after `rename`, and preserve the
  target's existing mode — a fresh temp file under the default umask silently changes permissions on
  rename.
- **§3.2 path separators.** State that sorting uses POSIX-normalized paths, matching §4.1.
  Otherwise Windows `\` (0x5C) sorts differently from `/` (0x2F).
- **§3.1 glob and dotfiles.** `guidelinesDir` defaults to a path with a leading-dot segment, and
  most glob implementations exclude dot segments by default. The interaction between "hidden files
  are ignored" and a hidden base directory needs stating.
- **§9 dependency budget.** Node 22 provides `fs.glob` and `node:crypto`; `--diff` is the only line
  item that tempts a dependency. A trust-first tool with a large transitive tree undercuts its own
  pitch. State the budget in §9.
- **Appendix A.** A stub `crib-sheet` package should carry a real README pointing at `cribsheet`;
  empty placeholder packages are occasionally flagged as spam.
