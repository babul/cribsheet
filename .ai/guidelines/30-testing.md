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
