# Eval baselines

Committed reference reports for the Tier 5 golden-mission quality gate
(`.github/workflows/test.yml` → `tier5-evals`).

## Layout

```
Doc/test-fixtures/eval-baselines/
└── <model-slug>/
    ├── cli-todo.baseline.json
    └── notes-api.baseline.json
```

- `<model-slug>` is the report's `model` id sanitized to one path segment
  (`scripts/eval-baseline.mjs:modelSlug` — `cline-pass/deepseek-v4.1-flash`
  → `cline-pass-deepseek-v4.1-flash`).
- Each file is a full `reportVersion: 1` report copied verbatim from a golden
  run (`scripts/eval-run.mjs`).

## Procedure (baseline FIRST, gates SECOND)

1. Dispatch `tier5-evals` once (`gh workflow run test.yml --ref evals -f job=tier5-evals`).
   The comparison step is **fail-open** while no baseline exists, so this first
   run only captures the reference reports in the `tier5-evals-result` artifact.
2. From the downloaded artifact, record each green report:
   `node scripts/eval-baseline.mjs record --report <mission>-report.json`
   then commit the touched files here.
3. Later dispatches gate against the bands. `check` compares a fresh report's
   per-stage `totalScore` to the matching baseline with a tolerance band
   (`floor = baseline − 0.15`; `--band` / `EVAL_BASELINE_BAND`). Within band →
   exit 0; a stage below floor, or a baseline stage missing from the fresh
   report, → exit 1 with the diff. Never exact-match (LLM output varies).

The baseline path is keyed by model slug, so a model/judge identity change
routes to a fresh (absent) baseline instead of mixing scores across identities.

## Failure semantics

- Missing baseline → exit 0, "NO BASELINE YET" (fail-open — no reference, no gate).
- Corrupt/malformed report or baseline → exit 2 (fail-open is about absence,
  never malformed data).
