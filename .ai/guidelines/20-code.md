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
