---
id: generic
name: Generic Technology Resource
keywords: ["generic", "fallback", "any"]
---

# Generic Technology Resource

Technology-agnostic craft. Used when no specific technology resource matches. When the generator falls back to this resource, the user is asked whether to fetch a real resource from official docs or accept the generic advice.

## Core rules

1. Keep functions small and single-purpose; pass dependencies explicitly, no hidden globals.
2. Handle errors at the boundary: catch, log with context, and fail visibly instead of silently swallowing.
3. Validate all external input (files, network, user data) before use.
4. Keep secrets out of source code; use environment variables or a secret store (source: https://owasp.org/www-community/vulnerabilities/Use_of_hard-coded_password).

## Testing patterns

1. Every public function gets at least one happy-path and one edge-case test.
2. Tests must be independent: no shared mutable state, each test sets up and cleans up its own data.
3. Name tests after behavior: `test_<function>_<scenario>_<expected>`.
4. Run the full suite before reporting any task as done (source: https://testing.googleblog.com/2007/01/how-to-write-good-test.html).

### Integration testing

1. Wire the real modules together; mock only true externals (network, clock, randomness).
2. Cover each critical path named in the plan at least once: input → modules → observable output.
3. Service dependencies (database, queue) run as real instances in tests where the stack supports it — e.g. Testcontainers (source: https://testcontainers.com/getting-started/).

## Tooling and limits

1. Use the project's existing build and test commands; do not invent new ones.
2. Respect the limits already declared in the project (timeouts, sizes, quotas).
3. If a limit is unknown, state the assumption instead of guessing a number.

## Common mistakes

1. Catching errors and continuing with empty or default data — hides failures.
2. Tests that depend on execution order or on leftover state from other tests.
3. Copy-paste duplication instead of extracting a shared helper.
4. Over-mocking tests — tests that mock the unit under test prove nothing because the mock and the implementation can both be wrong in the same direction (source: https://martinfowler.com/articles/mocksArentStubs.html).

_Last updated: 2026-09-14_
