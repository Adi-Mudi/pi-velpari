# Test Coverage Baseline

**CI floor:** statement coverage ≥ 92% — enforced by the "Coverage gate" step in
`.github/workflows/test.yml`. The full suite runs in CI; this file records the
floor and the update rules only.

## Update rules

1. Run `npm run test:coverage` to see the current percentage.
2. If you intentionally raise the floor, change `test.yml` and this file together.
3. Never lower the floor without an approved plan.

## Last recorded snapshot

| When | Tests | Statements | Branches | Functions |
|---|---|---|---|---|
| v1.4.0 (2026-09-16) | 1307 | 94.53% | 88.79% | 93.92% |
| Sequence upgrade complete (2026-09-21, branch `bug-fix`) | ~1762 | ≥ 92% floor (CI green) | — | — |

Historical per-phase tables were removed in the 2026-09-21 cleanup; recover them
from git history if ever needed.
