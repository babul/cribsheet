# cribsheet

Compile `AGENTS.md` from reusable markdown fragments — treating the output as a committed file you
hand-edit, not a build artifact it is safe to overwrite.

Every other tool in this space generates `AGENTS.md` by scanning your project and expects you to
gitignore the result. cribsheet does the opposite: it merges fragments you wrote into a marked block,
leaves everything outside that block alone, and **refuses to run** rather than clobber an edit you
made by hand.

## Install

```bash
npx cribsheet          # one-off
npm i -g cribsheet     # or install it
```

Requires Node 22+. No dependencies.

## Use

```bash
cribsheet init         # create .ai/guidelines/
cribsheet              # compose and write AGENTS.md
cribsheet check        # exit non-zero if stale or hand-edited; writes nothing
```

Write fragments into `.ai/guidelines/`, ordered by filename:

```
.ai/guidelines/
├── 00-foundation.md
├── 10-git.md
└── writing/
    └── 30-tone.md
```

They compose into a marked block, leaving your own prose untouched:

```markdown
Hand-written preamble. Never touched.

<!-- cribsheet:begin -->
=== .ai/guidelines/00-foundation.md ===

# Foundation

Always read the spec first.
<!-- cribsheet:end sha=b0fbee7a2e6d -->

Hand-written notes below. Also never touched.
```

The `sha` records what cribsheet last wrote. If the block no longer matches it, someone edited the
output by hand, and cribsheet stops with exit 2 and a diff rather than overwriting the edit. Move
the edit into the fragment it belongs in: once the block matches what the fragments compose,
cribsheet replaces it without `--force`, keeping that content and updating the `sha`. Pass
`--force` only when you mean to discard the edit.

## Ordering

Filenames decide the order — sorted by path, bytes ascending. Use numeric prefixes with gaps
(`00-`, `10-`, `20-`) so you can insert later.

Directories sort as a unit: `writing/30-tone.md` comes after every top-level file up to `w`, not
between `20-` and `40-`. Prefixes order files *within* a directory.

## Configuration

`.ai/config.json` is optional; every key has a working default. Unknown keys are an error, so a
typo fails the run instead of silently doing nothing.

| Key | Default | Notes |
|---|---|---|
| `output` | `AGENTS.md` | Relative to the project root |
| `guidelinesDir` | `.ai/guidelines` | Relative to the project root |
| `exclude` | `[]` | Anchored globs, relative to `guidelinesDir` |

Exclude patterns are anchored at `guidelinesDir`, and `*` does not cross `/`:

| Pattern | Matches |
|---|---|
| `90-draft.md` | only the top-level file, **not** `writing/90-draft.md` |
| `**/90-draft.md` | that name at any depth |
| `writing/**` | the whole subtree |
| `writing` | nothing — name the files, or use `writing/**` |

## Options

| Flag | Effect |
|---|---|
| `--dir <path>` | Override `guidelinesDir` |
| `--output <path>` | Override `output` |
| `--force` | Overwrite despite a hash mismatch |
| `--allow-empty` | Clear the block when no fragments are found |
| `--dry-run` | Print the resulting file to stdout, write nothing |
| `--diff` | Print a unified diff to stdout, write nothing |
| `--quiet` | Suppress the status line; warnings and errors still print |

Payloads (`--dry-run`, `--diff`) go to stdout; status lines and warnings go to stderr, so
`cribsheet --dry-run > new.md` and `cribsheet --diff | git apply` both work.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, or `check` passed |
| 1 | `check` failed — output is stale, run `cribsheet` |
| 2 | Refused — the block was hand-edited, a human should look |
| 3 | Error — unreadable directory, write failure, bad config |
| 4 | Usage — the command line is wrong, nothing was attempted |

`check` returns 2 only when markers are present and their integrity cannot be verified. Everything
else that is not clean is 1 — so 1 means "run compile", and 2 means "read the diff first".

## In CI

Run `check`, don't auto-write. The output is committed; silent mutation is the thing this tool
exists to avoid.

```yaml
- run: npx cribsheet check
```

## Design notes

The `docs/` folder in the repository carries the specification and the review that shaped it. They
are not shipped in the npm package.

- **[`docs/spec-v4.md`](docs/spec-v4.md)** — the specification, as implemented. Start here.
- **[`docs/spec-v3.md`](docs/spec-v3.md)** — the review behind it. Read this when a behaviour looks
  wrong and you want to know whether it was considered: why the hash is never normalised before
  comparison, why four markdown contexts are protected rather than one, why unterminated fences
  refuse while indented code is handled conservatively.
- `docs/spec-v1.md` and `docs/spec-v2.md` are the superseded draft and first review, kept for
  provenance.

This repository manages its own `AGENTS.md` with cribsheet. The fragments are in `.ai/guidelines/`.

## What it does not do

No templating, no project scanning, no network, no shipped defaults, no sibling output files. It
merges text you wrote, and it tells you when it cannot do that safely.

## Prior art

cribsheet was inspired by **[laravel/boost](https://github.com/laravel/boost)**, which established
both the `.ai/` convention this tool adopts and the idea of assembling agent guidelines from
reusable fragments rather than writing one long file by hand. Boost is the reason this tool has a
shape to depart from.

**On Laravel?** Use [boost](https://github.com/laravel/boost). It generates guidelines from your
actual project, ships an MCP server, and knows the framework — none of which this does. Reach for
cribsheet only if you want to write the guidelines yourself and keep hand-editing the result. The
two are not substitutes, and if boost covers you, you do not need this.

The departure is the safety model, not the idea. Boost treats its generated output as disposable
and expects it to be gitignored, which is a coherent choice — if the file is always regenerated,
there is nothing to protect. cribsheet assumes the opposite: `AGENTS.md` is committed, humans edit
it directly, and so the tool has to prove it is not about to destroy someone's work before it
writes. Everything distinctive here — the marked block, the content hash, the refusals — follows
from that one inverted assumption.

No boost code is used; the debt is to the design. Boost is MIT-licensed, as is this.

Others working the same ground, none of which treat the output as a hand-edited file:
[bearings](https://www.npmjs.com/package/bearings), [agentseed](https://www.npmjs.com/package/agentseed),
`@agents-dev/cli`, `@agents-mdx/cli`, `@momo792/agentsmd`.
