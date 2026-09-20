# cribsheet spec review — v3

Claude's review of [`spec-v1.md`](spec-v1.md), draft v1, dated 2026-09-19. No code exists yet;
this is a pre-implementation read for internal contradictions, undefined states, and decisions the
spec leaves open. Section references (§) are to the spec unless prefixed with *v2*, which refers to
the previous revision of this review.

> The decisions recorded here are now implemented in [`spec-v4.md`](spec-v4.md) and in `src/`.
> This document holds the reasoning; v4 holds the conclusions.

**Supersedes [`spec-v2.md`](spec-v2.md).** That file is kept for provenance — only its
heading and a superseding notice were added, its findings are untouched. It
contains one actively harmful recommendation and several overstatements, catalogued in
[Appendix A](#appendix-a--what-changed-from-v2) below. Where the two documents disagree,
this one is correct — the differences were established by counterexample, not by preference.

Those corrections came out of a Codex cross-review of v1 and v2, which supplied the seven
findings listed as added in Appendix A and overturned two of v2's conclusions. Every concrete
claim it made — the hash collision in §4.1, the sort order in §9, the trimming behaviour in
§2.2 — was reproduced before being accepted here.

---

## Priority summary

| # | Finding | Section | Severity |
|---|---|---|---|
| 1 | `init` writes a config `compile` rejects | §1.1 | Blocks first run |
| 2 | Markdown context is unprotected in four forms, not one | §2 | Silent content corruption |
| 3 | Output can become its own input | §3.5 | Runaway corruption |
| 4 | Trailing-newline rule mutates user territory | §3.1 | Violates core guarantee |
| 5 | Body trimming destroys leading indented code | §2.2 | Silent content corruption |
| 6 | Unterminated fence swallows the rest of the document | §2.5 | Silent content corruption |
| 7 | Formatters will trip the hash guard | §4 | Trains users to `--force` |
| 8 | `check` exit code undefined for 2 of 5 states | §3.2 | Blocks CI integration |
| 9 | TOCTOU between hash check and rename | §3.6 | Data loss |
| 10 | Duplicate / inverted markers | §3.3 | Data loss |

§§1.1 and 3.2 are settled, as are all eight items in §5 — each records the decision and its
reasoning. The eight findings above are ratified as written; §2.2 records the one that needed a
fork.

---

## 1. Contradictions

Defects in the document itself — two sections disagreeing about what the tool does.

### 1.1 `init` generates a config that `compile` rejects

§7 says `init` creates "a commented `.ai/config.json`". JSON has no comment syntax, and §8 says a
malformed config is exit 3. The tool's own scaffold fails the tool's own parser on the next run.

**Decision: `init` writes no config at all.** Every key has a working default, so an absent file is
the correct scaffold. `init` creates `.ai/guidelines/` and stops; it prints the three keys and their
defaults to stderr, and the README documents them — where the documentation can be richer than JSON
comments would allow. §7's "and a commented `.ai/config.json`" is struck, and §8's config stays
plain `.json` parsed by `JSON.parse`. No dependency, no dialect question.

Rationale beyond avoiding the parser:

- **Schema drift.** §8 makes unknown keys a hard error. A scaffolded config listing every key means
  every project `init` touches carries a file that must stay in lockstep with the tool's schema
  forever. Renaming a key in a later version then breaks every scaffolded project with exit 3 — a
  breaking change delivered through a file the user never chose to create. An absent config cannot
  drift.
- **Character.** §1 says the user supplies 100% of the content. Generating a config full of
  commented defaults is the generator-shaped behaviour the spec defines itself against.

**Rejected alternatives,** recorded so they are not re-proposed:

- *JSONC via a tolerant parser,* stated explicitly in §8.
- *Name the file `.ai/config.jsonc`* so the extension advertises the dialect. This does not avoid the
  parser: `.jsonc` is not parseable by `JSON.parse`, so it is the option above plus a rename. It buys
  correct editor highlighting and costs either a dependency against §9's budget or a hand-rolled
  stripper — the kind that looks like ten lines and then mishandles `//` inside a string literal.

If a config file is wanted purely as a discoverability hint, `{}` is the compromise: valid JSON, no
keys to drift, and it still marks where configuration goes.

### 1.2 §4.3 rule 1 is scoped wrong

The preamble scopes all four normalization rules to "outside fenced code blocks only". Line-ending
conversion cannot be one of them: Appendix B requires a CRLF fragment to be normalized to LF, and
CRLF inside a fence is exactly where that requirement bites.

**Resolution.** Move rule 1 out of the fence-scoped set and apply it globally. Rules 2–4 are the
fence-aware set.

*Note:* it is not strictly necessary that LF conversion run *before* fence scanning — a scanner can
recognise CRLF, CR and LF directly, all three being CommonMark line endings. Global conversion as a
pre-pass is simply the cheapest way to get there, and it removes a class of implementation bug where
a closing fence reads as `` ```\r `` and fails to match.

### 1.3 §3.3 says "byte-for-byte"; §4.2 and §4.3 rewrite fragment bodies

§4.2 trims bodies and §4.3 inserts and removes blank lines inside them. The guarantee §3.3 is
actually making is narrower: heading *levels* are never rewritten.

**Resolution.** Replace "copied through byte-for-byte" with the specific promise — no heading
demotion or promotion, no directive interpretation, no front matter parsing — and cross-reference
§§4.2–4.3 for the whitespace handling that does apply.

---

## 2. Markdown context is unprotected in four forms

§4.3 protects fenced code blocks and says so emphatically. Fences are one of four contexts in which
a line that looks like a heading, a separator or a marker is actually literal content. The other
three are unaddressed, and they are the same bug class.

This is the dominant risk in the spec: every case below silently corrupts committed content, and
none of them error.

### 2.1 Fenced blocks — closing rules underspecified

§4.3 says the scanner "must respect the opening fence's length when matching the close". That is
ambiguous between *equal to* and *at least*. CommonMark requires a closer of the same character, of
**at least** the opening length, followed only by spaces or tabs, indented at most three spaces.

Input that breaks a loose scanner:

```
~~~
code
~~~ not-a-close
# literal
~~~
```

A scanner accepting line 3 as the closer treats `# literal` as a heading and spaces it. State the
closing rules explicitly. ([CommonMark §4.5](https://spec.commonmark.org/0.31.2/#fenced-code-blocks))

### 2.2 Indented code blocks — unprotected, and destroyed by §4.2 trimming

Two separate defects hit the same construct.

**Normalization.** A `# comment` inside a four-space-indented shell snippet is not inside a fence, so
§4.3 rules 2–3 inject blank lines around it.

**Trimming.** §4.2 trims bodies of "leading/trailing whitespace". A fragment that *begins* with an
indented code block loses the first line's four spaces to the trim, and the line stops being code
entirely:

```
    echo one
    echo two
```

becomes `echo one\n    echo two` — line 1 is now a paragraph, line 2 is still code.

**Decision.** Trim leading and trailing *blank lines*, not arbitrary whitespace.

For normalization, the scanner refuses rather than guesses. A four-space-indented line it cannot
confidently classify — because classifying one correctly needs list and paragraph-continuation
context, which is most of a CommonMark block parser — is exit 3, naming the line and asking for a
fenced block instead. This is the same move as §2.5: refuse rather than corrupt silently.

Rejected: a real parser (`micromark`, `remark`) would classify correctly, but costs a dependency
against §9's budget and more machinery than the rest of the tool combined. Also rejected: fences
only, declaring indented code unsupported — the unsupported case would corrupt silently, which is
the failure this tool exists to prevent.
([CommonMark §4.4](https://spec.commonmark.org/0.31.2/#indented-code-blocks))

### 2.3 HTML blocks — unprotected

```
<div>
# literal
</div>
```

Inserting a blank line before `# literal` *terminates* the type-6 HTML block, and the line becomes a
real heading. Normalization does not merely touch this content, it changes the document's meaning.
([CommonMark §4.6](https://spec.commonmark.org/0.31.2/#html-blocks))

### 2.4 Inline code spans — unprotected in §5.2

Marker detection has no concept of code context at all. Both of these break a file:

- A fenced block in user territory containing the §5.1 example. Immediately relevant: cribsheet's
  own `AGENTS.md` cannot document cribsheet.
- A single-line code span: `` `<!-- agents:begin -->sample<!-- agents:end -->` ``. The regex captures
  `sample`, compile refuses, and `--force` overwrites the middle of the example.

**Resolution.** Require markers to be standalone lines, and run the same context scanner used by
§4.3 over the output file before matching. A fence-only fix does not cover the code-span case.

### 2.5 Unterminated fences swallow the rest of the document

A single stray ``` in an early fragment puts everything after it inside a fence. The spec does not
mention unterminated fences anywhere.

Normalizing each fragment independently before assembly is *not* a sufficient fix. It stops the
normalizer from desyncing, but the composed `AGENTS.md` still contains an unterminated fence, and
CommonMark ends it at the document boundary — every later separator and body still renders as code.

**Resolution.** **Reject unterminated fences** in a fragment with exit 3. A fragment boundary is an
invention of this tool; it has no standing in the rendered document, so scanner-state tricks cannot
repair the output. Refusing is the only honest option.

---

## 3. Undefined states

### 3.1 §6.3's trailing-newline rule mutates user territory

§5.1 promises everything outside the markers is "preserved verbatim". §6.3 requires output to end
with exactly one `\n`. When the hand-written suffix ends in two newlines, or none, those two rules
disagree, and §6.3 wins by editing content the user authored.

**Resolution.** Preserve the existing suffix bytes. Apply the final-newline rule only when creating
the file, or when the managed block itself reaches EOF.

### 3.2 `check`'s exit code is undefined for two of five states

§6.1 enumerates five output-file states. §7.2 covers three of them — case 3 in both its clean and
stale forms, and the two refusal cases — and says nothing about cases 1 and 2. The table needs all of them:

| §6.1 state | `compile` | `check` |
|---|---|---|
| Output file absent | `NEW`, 0 | **1** |
| Exists, no markers | `NEW` (append), 0 | **1** |
| Markers, sha matches, content differs | `REPLACED`, 0 | 1 |
| Markers, sha matches, content identical | `UNCHANGED`, 0 | 0 |
| Markers, no sha attribute | `REFUSED`, 2 | 2 |
| Markers, sha mismatch | `REFUSED`, 2 | 2 |

**Output file absent → 1.** Compile would create it, so `check` should say "run compile". There is an
argument for 3 — a missing committed file is arguably an error rather than staleness — but 1 already
fails CI and nothing operational depends on the distinction.

**Exists, no markers → 1.** This is the real judgment call. The tool holds no state, so it cannot
distinguish "never compiled into" from "someone deleted the managed block, markers and all". The same
bytes carry both meanings, and the choice is which false positive to ship:

- *Exit 1* — a user who deliberately deleted the block to stop managing the file gets "run compile"
  from CI, runs it, and the block comes back. Self-explanatory and recoverable.
- *Exit 2* — a project adopting cribsheet with a hand-written `AGENTS.md` already in place is told a
  human needs to look, on its first CI run, when nothing is wrong.

Exit 1 is the better trade. Its false positive lands on deliberate de-management, which is rare and
where the user can simply drop the check; exit 2's lands on first-time adoption, which is common and
where the tool has no credibility yet to spend.

**Resolution — state the rule, not just the rows.** §7.2 should carry the invariant:

> `check` returns **2** only when markers are present and their integrity cannot be verified.
> Everything else that is not clean is **1**.

An invariant survives states the table does not yet contain. A six-row table has to be extended by
intuition every time a case is added, which is how the two blanks arose in the first place.

*Knock-on:* under §3.4's recommendation (populated block, zero fragments → refuse), that state is
markers-present-and-unverifiable, so it returns 2 and the rule holds. If the spec's current `NOOP`
behaviour is kept there instead, `check` returns 0 on a file whose guidelines no longer exist — the
one state this rule would otherwise let through silently.

### 3.3 Duplicate and inverted markers

The §5.2 regex is non-greedy and single-match. Two begin markers means the first pair matches and the
second block persists as unmanaged content agents still read. An `end` with no preceding `begin`
fails to match entirely, so §6.1 case (2) applies and a *second* block is appended below the orphan.

**Resolution.** Both are exit 3. Count marker occurrences before matching rather than relying on the
regex to notice.

### 3.4 Managed block populated, zero fragments

Appendix B's "Empty guidelines dir → `NOOP`, no write, exit 0" row carries no qualification, so read
literally the spec *does* decide this case: leave the stale block in place.

That decision deserves challenging rather than clarifying. Zero fragments alongside a populated block
is far more often a wrong `--dir`, a bad `cwd` from §8.1's unbounded walk, or a botched merge than an
intentional deletion — and the failure mode is that deleted guidelines keep being read by agents,
which is the same silent-divergence hazard §6.4 exists to warn about.

**Recommendation.** Refuse with exit 2 and require `--allow-empty`. If the current behaviour is kept,
say in §7.3 that `NOOP` can leave stale managed content behind.

### 3.5 Output can become its own input

Nothing prevents `output` from resolving inside `guidelinesDir`. With
`"output": ".ai/guidelines/generated.md"`, the first compile creates a new discoverable fragment, and
every later compile ingests its own prior output — markers, separators and all.

**Resolution.** Reject an output path that is an eligible fragment input, comparing resolved real
paths so symlinks and `..` segments cannot alias around the check.

### 3.6 TOCTOU between the hash check and the rename

§6.2's atomic rename guarantees no torn file. It does not prevent lost updates: compile reads the
file and verifies the hash, an editor saves new hand-written notes, compile renames its prepared
temp file over that save. No mismatch is ever observed, and the guard that §6 is built around never
fires.

**Resolution.** Re-read and re-verify the entire target immediately before the rename and abort on
any change. State the residual race explicitly — it narrows the window, it does not close it, and
absent writer coordination nothing can.

---

## 4. Formatters will trip the hash guard

Prettier, `end-of-file-fixer` and `trailing-whitespace` will reformat `AGENTS.md` and break the stored
sha on a change no human made. Compile then refuses every run until someone passes `--force`, which
trains people to reach for `--force` reflexively — destroying the exact guarantee the tool exists to
provide. The spec has no answer and needs one in §6.

**Recommendation: exclude `AGENTS.md` from formatters.** Document it for `.prettierignore` and for
formatting pre-commit hooks, and keep §6.1's hash input exactly as specified.

### 4.1 Why not normalize before hashing

v2 of this review recommended running the §4.3 rules over the extracted block body before
hashing, so cosmetic reflows would be hash-invariant. **That recommendation is wrong and is withdrawn.**
It fails in both directions:

*It destroys real edits.* A human deleting the blank line in `# H\n\nText` produces `# H\nText`, which
§4.3 normalizes straight back:

| body | raw hash | normalized hash |
|---|---|---|
| `# H\n\nText` | `4dfd85f4b479` | `4dfd85f4b479` |
| `# H\nText` | `3913eb24b97c` | `4dfd85f4b479` |

The hand edit hashes identically and is silently overwritten without `--force` — precisely the failure
§6.1 case (5) calls "the whole point".

*It does not achieve its purpose.* Prettier's characteristic change to markdown prose is reflowing
paragraphs to a print width. `alpha beta` → `alpha\nbeta` is untouched by §4.3, which only adjusts
heading spacing and collapses newline runs, so the hash breaks anyway.

The proposal therefore weakens the guard and still leaves the problem it was aimed at.

### 4.2 `--force` should not destroy silently

§6.1(5) prints a diff when it refuses. `--force` should print the same diff, and should write the
clobbered block to `AGENTS.md.orig` before renaming. Right now the escape hatch is unrecoverable.

---

## 5. Decisions

Underspecified rather than wrong — implementation could not proceed without picking. All eight are
now settled; each records the decision and its reasoning.

**Decided: `exclude` takes anchored globs.** Literal-only matching would mean excluding a
subdirectory requires enumerating every file in it, with files added there later silently included —
precisely the drift failure §3.2 cites when rejecting a config-based ordering array.

Patterns match the POSIX path relative to `guidelinesDir`, anchored at its root, which is what §8's
"paths relative to `guidelinesDir`" already implies:

- `*` does not cross `/`; `**` does.
- `90-draft.md` matches only the root-level file, **not** `writing/90-draft.md`. Use `**/90-draft.md`
  to match at any depth.
- `writing/**` excludes a subtree. Bare `writing` matches only a file literally named `writing` —
  the common trip-up, and worth an example in the README.
- Matching is case-sensitive, consistent with §3.2's byte-ordered sort.
- No negation and no brace expansion. If they are wanted later they can be added; they cannot be
  removed.

*Implementation:* Node 22's `path.matchesGlob` gives exactly these semantics with no dependency and
no runtime warning (verified on 22.22.2). It is still flagged experimental, so `picomatch` — one
package, no transitive dependencies — is the fallback. Either keeps §9's budget intact.

*Consequence worth recording:* **a pattern matching nothing should warn.** §8 makes a typo'd config
*key* a hard error, on the stated grounds that silently doing nothing is worse than failing. A
typo'd exclude *pattern* has the identical failure mode and is currently silent. It should not be a
hard error — deleting a fragment you previously excluded is legitimate and would break CI on a
correct repo — but it should warn on stderr, and the warning must survive `--quiet`. An `exclude`
broad enough to match every fragment also lands in §3.4, so the two should agree.

Globs do not resolve §3.5: an output path inside `guidelinesDir` is still rejected outright rather
than something the user is expected to exclude by hand, because a forgotten exclusion there corrupts
silently.

**Decided: heading rules cover `#` through `######`.** CommonMark defines six levels; the cap at
four is arbitrary and would space one document inconsistently. Extending costs nothing.

**Decided: the ATX detector is `/^ {0,3}#{1,6}(?:[ \t]|$)/`,** applied per line, outside protected
contexts. This is the CommonMark rule: up to three leading spaces, one to six `#`, then a space, a
tab, or end of line. Verified against the cases that break naive patterns:

| Line | Heading? | Why |
|---|---|---|
| `# Title`, `###### Six` | yes | one to six hashes |
| `####### Seven` | no | seven hashes is a paragraph |
| `#`, `##` | yes | bare hash is an empty heading |
| `#\tTitle` | yes | tab is a valid separator |
| `#hashtag` | no | no separator |
| `   # Indented` | yes | three spaces permitted |
| `    # Code` | no | four spaces is an indented code block (§2.2) |

`/^#+/` mangles `#hashtag`; `/^#{1,6} /` misses the tab and bare forms. Blank-line insertion must
preserve the heading's own leading spaces.
([CommonMark §4.2](https://spec.commonmark.org/0.31.2/#atx-headings))

**Decided: the pipeline is ordered, and rules 2–4 run as one line-oriented pass.**

1. Global pre-pass: `\r\n` and bare `\r` → `\n` (§1.2).
2. Single pass over lines, maintaining protected-context state (fenced, indented, HTML — §2):
   ensure one blank line before each heading except at document start; ensure one blank line after
   each heading; emit at most one consecutive blank line. Protected lines pass through untouched.
3. Trailing newline per §6.3, subject to §3.1's user-territory carve-out.

Four sequential regex passes over the whole string is the obvious implementation and the wrong one:
each pass shifts the offsets the protected-region scan computed, so the regions must be recomputed
between passes or they silently drift. A single line pass holds the state and the output together.
Order still matters within it — blank-line collapsing must observe insertions, not precede them, or
consecutive headings end up double-spaced.

**Decided: stdout carries payloads, stderr carries everything else.**

- **stdout:** only machine-consumable output — the composed file under `--dry-run`, the unified diff
  under `--diff`. Nothing else, ever, so `cribsheet --dry-run > new.md` and `cribsheet --diff |
  git apply` both work.
- **stderr:** the §7.3 status line, all warnings (§6.4, `exclude` no-match), the §6.1(5) refusal
  diff, and errors. The refusal diff goes to stderr despite being a diff because it explains an
  exit 2; it is not a payload anyone asked for.
- **`--quiet` suppresses the status line only.** Warnings and errors always print. Warnings exist
  precisely to surface silent-divergence hazards, so a flag that hides them defeats the feature.
- **`--dry-run --diff` together is a usage error.** They are two different stdout payloads and
  silently picking one would surprise. Reject rather than define precedence.

**Decided: `--help` and `--version` exit 0 on stdout; usage errors exit 4.**

`--help` and `--version` print to stdout because they are the output the user asked for. Unknown
flags, unknown subcommands and mutually exclusive flags print usage to stderr and exit **4**, a new
code.

Exit 3 means the repository or environment is broken — unreadable directory, write failure,
malformed config. A usage error means the command line is wrong and nothing was attempted. Folding
them together would tell a CI operator to go looking at the repo when the fault is in the invocation.
This is the same reasoning §7.2 already applies in separating 1 from 2.

**Decided: `init` is idempotent and exits 0.** It creates whatever is missing, leaves whatever
exists, and reports per path which it did. Running it twice should be safe and boring; making a
harmless repeat exit 3 would discourage putting it in a setup script, and "never overwrites" already
supplies the safety. The one genuine error is `.ai` existing as a file rather than a directory —
exit 3.

**Decided: `output` and `guidelinesDir` must resolve inside the project root.** Absolute paths in
config are rejected outright with exit 3, since §8 defines both keys as relative. Relative paths are
resolved, then checked against the root by real path — resolving symlinks, so a link inside the root
pointing outside is caught — and rejected with exit 3 if they escape.

The same constraint applies to `--dir` and `--output`. Allowing the CLI to escape while config
cannot would be inconsistent, and containment is the right default for a tool whose entire pitch is
not destroying files; anyone who needs to write elsewhere can run the tool from there. `--dry-run`
and `--diff` validate identically even though they write nothing, so the flags cannot be used to
discover whether a path outside the root exists.

See also §3.5, which rejects an output path inside `guidelinesDir` for a different reason, and §9's
note on symlinked fragments, which this check does not cover.

---

## 6. Structural objections

### 6.1 §8.1's upward walk has no stop condition

"Walk up from CWD looking for `.ai/`" will find a monorepo root's `.ai/`, or `~/.ai/`, and write to the
wrong `AGENTS.md` without saying so. Ruling out `.git` as a *discovery* marker is right; the tool still
needs a *boundary*.

**Resolution.** Stop at `$HOME` and at the filesystem root. Print the resolved project root in the
§7.3 status line so a wrong resolution is visible rather than silent. This also mitigates §3.4, where
a misresolved root is the most likely cause of an unexpected zero-fragment run.

### 6.2 §6.4 contradicts §1's stated design premise

"It never inspects the project" is the tool's declared character, and §6.4 is project inspection. It is
also narrow: it looks only for the hardcoded name `AGENTS.md` at the root, so migrating `docs/A.md` →
`AGENTS.md` leaves an undetected orphan at the old path.

**Resolution.** Either drop §6.4 as scope creep, or restate the §1 premise as "never infers content
from the project" — the guarantee that actually matters — and keep §6.4 as a documented heuristic with
acknowledged blind spots.

---

## 7. Test matrix

### 7.1 Rows to rewrite

**"Fragment with `===` line inside a fence → not treated as a separator."** No operation in the spec
parses separators; they are write-only. As phrased, the row names no branch that can fail. It is worth
keeping as a *preservation* assertion, since §4.3 explicitly promises fenced content is untouched —
rewrite it to assert that a fenced block containing `===`, `#` and leading indentation is emitted
byte-identical.

**"Interrupted write → original file intact."** Not testable as written without fault injection, and
the expectation is also wrong past the commit point: after the `rename` succeeds, the correct outcome
is a complete *new* file, not the original. Specify fault injection around each stage of §6.2 with the
stage-appropriate expectation.

### 7.2 Rows to add

| Case | Expected |
|---|---|
| Fragment beginning with a four-space indented block | Indentation preserved (§2.2) |
| Four-space indented block containing `#` | Not spaced as a heading |
| HTML block containing `# literal` | Blank line not inserted; stays an HTML block |
| Marker syntax inside a fence in user territory | Ignored, not matched |
| Marker syntax inside an inline code span | Ignored, not matched |
| Unterminated fence in a fragment | Exit 3 |
| `~~~ not-a-close` line inside a `~~~` fence | Not treated as a closer |
| Closing fence longer than the opener | Closes |
| `output` resolving inside `guidelinesDir` | Exit 3 |
| Output ending in two newlines / no newline, block replaced | Suffix bytes unchanged |
| Two begin markers | Exit 3 |
| `agents:end` before `agents:begin` | Exit 3, no second block appended |
| Managed block populated, zero fragments | Per §3.4 decision |
| `check` with output file missing | Per §3.2 table |
| `--force` on sha mismatch | Overwrites, prints diff, writes `.orig` |
| File modified between hash check and rename | Abort (§3.6) |
| `#####` / `######` headings | Spaced consistently |
| `#` alone; `#\tTitle` | Recognised as headings |
| `.MD` / `.Md` extension | Defined either way, but stated |
| Hidden *directory* under guidelines | Defined |
| Symlinked fragment; symlink loop | Defined, no hang |
| `exclude` with a wrong type (`"x.md"` not `["x.md"]`) | Exit 3 |
| `exclude: ["90-draft.md"]` with `writing/90-draft.md` present | Nested file **not** excluded |
| `exclude: ["**/90-draft.md"]` | Excluded at every depth |
| `exclude: ["writing/**"]` | Whole subtree excluded |
| `exclude: ["writing"]` | Excludes nothing; warns |
| `exclude` pattern matching no file | Warns on stderr, survives `--quiet`, exit 0 |
| `exclude` matching every fragment | Agrees with §3.4 |
| `guidelinesDir` escaping the project root | Exit 3 |
| Absolute path in `output` or `guidelinesDir` | Exit 3 |
| Symlink inside the root pointing outside it | Exit 3 (real-path check) |
| `#######` (seven hashes) | Not a heading |
| `#hashtag` at line start | Not a heading |
| Three-space-indented heading | Recognised; indentation preserved |
| Unknown flag or subcommand | Usage to stderr, exit 4 |
| `--dry-run --diff` together | Usage error, exit 4 |
| `--help`, `--version` | stdout, exit 0 |
| `--dry-run` output redirected to a file | Payload only; status line on stderr |
| `--quiet` with a §6.4 orphan present | Status suppressed, warning still printed |
| `init` run twice | Exit 0, nothing overwritten |
| `.ai` exists as a file, not a directory | Exit 3 |
| Compile twice over unchanged fragments | Second run `UNCHANGED` |

The last row is worth having as a cheap regression net, but it is **not** the coverage centrepiece
v2 claimed. Idempotence passes forever on output that is consistently mangled the same way.
Expected-output tests with hand-written fixtures remain necessary for every §4.3 rule.

---

## 8. Reconsider: the separator format

§4.1's `=== path ===` separator is explicitly visible, while §5.1 argues for HTML comment markers
precisely *because* they are invisible. The split is deliberate and the stated rationale is coherent: a
reader who wants to change the text should see where it came from.

The cost is that every separator is prose an agent reads and pays tokens for, and it is the only
content in the output no human authored — which sits awkwardly against §1's "never writes content the
user did not author".

`<!-- .ai/guidelines/10-git.md -->` keeps provenance for anyone editing the raw file and costs nothing
in the rendered view. The tradeoff to weigh: invisible seams mean a reader in a markdown preview pane
cannot tell managed content from hand-written content, which is the distinction the tool exists to
protect.

No recommendation — but §4.1 should acknowledge the token cost and the §1 tension rather than only the
case in favour.

*Confirmed not a problem:* `=== path ===` cannot be parsed as a setext heading underline. A setext
underline consists solely of `=` characters (or solely `-`), so the embedded path disqualifies it, and
§4.1's trailing blank line settles the block context regardless.
([CommonMark §4.3](https://spec.commonmark.org/0.31.2/#setext-headings))

---

## 9. Smaller notes

- **Hash strength.** 12 hex characters is 48 bits — appropriate for accident detection, not
  adversarial. Worth one line in §6.1 so the question does not resurface in review.
- **§5.2 `sha` length.** The pattern `[0-9a-f]+` does not pin the length. Rejecting a non-12-character
  value with a distinct error is a reasonable design choice — but it is a choice, not a deduction: a
  40-character value is just as likely to be a hand edit as another tool's output.
- **§6.2 durability.** Also `fsync` the containing directory after `rename`, and preserve the target's
  existing mode — a fresh temp file under the default umask silently changes permissions on rename.
- **§3.2 path separators.** State that sorting uses POSIX-normalized paths, matching §4.1. Otherwise
  Windows `\` (0x5C) sorts differently from `/` (0x2F).
- **§3.2 directory ordering.** Byte-comparing whole relative paths means a directory name is compared
  against sibling *filenames*, so numeric prefixes only order within a directory. §2's example happens
  to sort as its numbering suggests, but only by coincidence — adding `40-x.md` puts it after
  `writing/30-tone.md`. Worth one clarifying sentence in §3.2; it is not a defect.
- **§3.1 glob and dotfiles.** `guidelinesDir` defaults to a path with a leading-dot segment, and most
  glob implementations exclude dot segments by default. The interaction between "hidden files are
  ignored" and a hidden base directory needs stating.
- **§9 dependency budget.** Node 22 provides `fs.glob` and `node:crypto`; `--diff` is the only line
  item that tempts a dependency. A trust-first tool with a large transitive tree undercuts its own
  pitch. State the budget in §9.
- **Appendix A.** A stub `crib-sheet` package should carry a real README pointing at `cribsheet`; empty
  placeholder packages are occasionally flagged as spam.

---

## Appendix A — what changed from v2

Recorded so the corrections are auditable against [`spec-v2.md`](spec-v2.md).

**Withdrawn — the recommendation was wrong.**

- *v2 §3, normalized hashing.* Shown by counterexample to destroy real hand edits while still failing
  to absorb formatter reflow. Replaced by §4 above, which keeps the spec's hash input unchanged.

**Withdrawn — not a defect.**

- *v2 §1.4, "§2's example contradicts §3.2's sort".* False. Byte sort gives `00-`, `10-`, `20-`,
  `writing/30-tone.md` — exactly what the numbering implies. The v1 claim that the directory sorts
  after *every* top-level fragment is also false: `w` (0x77) < `z` (0x7a), so `z-last.md` sorts after
  it. Demoted to a clarifying note in §9.

**Corrected — finding holds, reasoning was overstated.**

- *v2 §1.2.* Global LF conversion resolves the conflict, but it need not *precede* fence detection; a
  scanner can handle CRLF, CR and LF directly. Now §1.2.
- *v2 §1.5.* Per-fragment normalization does not contain an unterminated fence — CommonMark ends it at
  the document boundary, so the composed output is still broken. The fix is to reject. Now §2.5.
- *v2 §2.1.* Appendix B does decide the zero-fragment case; v2 claimed the spec picked neither option.
  Reframed as a policy challenge. Now §3.4.
- *v2 §4, ATX definition.* "Requires a space after `#`" is incomplete — tabs and end-of-line also
  qualify. Now §5.
- *v2 §6.2, idempotence.* Does not cover the normalization class; consistently mangled output passes
  forever. Demoted to a regression net. Now §7.2.
- *v2 §6.1, separator test row.* Deletion was too aggressive; the row is salvageable as a preservation
  assertion. Now §7.1.
- *v2 §6.1, interruption test.* v2 missed that past the rename commit point the correct expectation is
  the new file, not the original. Now §7.1.
- *v2 §8, sha length.* A non-12-character value does not prove another tool wrote it. Now §9.

**Added — not present in v2.**

- §2.1 fence closing rules underspecified
- §2.2 body trimming destroys leading indented code
- §2.3 HTML blocks unprotected
- §2.4 inline code spans unprotected in marker detection
- §3.1 trailing-newline rule mutates user territory
- §3.5 output can become its own input
- §3.6 TOCTOU between hash check and rename

**Unchanged from v2.** §1.1 (`init` config), §1.3 (byte-for-byte), §3.2 (`check` exit table),
§3.3 (duplicate markers), §4.2 (`--force` recovery), §5 (open decisions), §6 (structural objections),
§8 (separator), and the remaining smaller notes.
