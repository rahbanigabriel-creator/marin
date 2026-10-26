# Regression tests

Use Node 20. Install the committed lockfile with `npm ci`, then run `npm test`.
The existing install hook generates the Prisma client. If installation uses
`--ignore-scripts`, run `npm run db:generate` before testing. Generation does
not migrate a database; the metrics tests inject their database operations.

The runner discovers `src/**/*.test.ts` (also TSX, MTS, JS and MJS), runs files
serially, prints the results, and writes fresh JUnit to
`test-results/junit.xml`. No discovered tests or any failed test returns a
nonzero exit code. The tests use synthetic token keys and injected metrics
data; they do not require customer credentials or external services.

For a verifier that supplies c8, use:

```sh
JEST_JUNIT_OUTPUT_FILE=/output/test-results.xml \
  c8 --reporter=lcov --reports-dir=/output/coverage npm test
```

`JEST_JUNIT_OUTPUT_FILE` takes precedence over `MOCHA_FILE`; both are supported
as report destinations. c8 belongs to the verifier's pinned tools, not this
project's dependency graph. The test runner removes its previous report before
starting so a failed start cannot reuse an old success report.

These tests cover metrics aggregation and ingestion, token encryption and
account binding, and OAuth cookie integrity, expiry and PKCE. Passing them
does not establish that a dependency vulnerability was fixed. A repair still
needs its baseline and candidate build/tests, coverage of the affected use
sites, dependency consistency checks and a fresh vulnerability scan. Full
Next.js build and browser integration tests are separate checks.
