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
