# Velpari Testing Guide

> How tests are organized in `pi-velpari`, what each layer covers, and how
> to add a new test. Last updated 2026-09-15 (after the 8-phase test plan).

## 1. Test Pyramid

Velpari uses 4 test layers, chosen for what they each prove best:

| Layer | Tool | Speed | Proves | Skipped by |
|---|---|---|---|---|
| **L1 — Unit** | `node --test` | <1s/test | Pure logic, registry entries, helpers, atomic functions | nothing (default) |
| **L2 — RPC e2e** | spawn `pi --mode rpc` | ~3-5s/test | Real extension loads, real commands, real doctor, real state machine | `RUN_E2E=1` (CI sets this) |
| **L3 — In-process** | `pi-coding-agent-test@0.1.1` | ~1-3s/test | Real Pi + scripted LLM responses (deterministic) | **`RUN_L3_E2E=1`** (currently broken — Phase 4) |
| **Perf** | `node --test` (timing) | variable | Doctor + handoff + walk latency budgets | `RUN_PERF=1` |

## 2. Layer Selection — When to Use Which

| What you're testing | Add it to |
|---|---|
| Pure function, no UI, no fs | L1 unit |
| Stage handler inputs/outputs (registry entry, missing-input msg) | L1 unit |
| Brainstorm / approve / status flow end-to-end | L2 RPC e2e |
| Handoff path with all 10 required artifacts | L2 RPC e2e + Perf |
| Stage sequence gate acceptance (which states are allowed) | L1 unit (STAGE_GATE) |
| Scripted LLM conversation (deterministic LLM replies) | L3 in-process (currently deferred) |
| Latency budget (doctor, walk, handoff) | Perf |

When in doubt, **start with L1 unit** — fastest to write, easiest to debug.
Move to L2 RPC e2e when you need the real extension to load.

## 3. How to Add a New Unit Test for a Stage Handler

The cleanest pattern: pin the STAGE_REGISTRY entry to detect drift.

```ts
// pi-extension/test/stages/<stage>.test.ts
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { STAGE_REGISTRY } from "../../src/stages/registry.js";

describe("/velpari-<stage> — Stage N registry", () => {
  const entry = STAGE_REGISTRY["<stage>"];

  it("stageEnum is <in-progress-state>", () => {
    assert.equal(entry.stageEnum, "<in-progress-state>");
  });

  it("uses N scouts named ...", () => {
    assert.deepEqual([...entry.scouts], ["..."]);
  });

  it("reads N prior artifacts in deterministic order", () => {
    const artifacts = entry.inputs.map((i) => i.artifact);
    assert.deepEqual(artifacts, ["...", "..."]);
  });

  it("missing-input error message names Stage N + all prior stages", () => {
    const msg = entry.formatMissingError({ cwd: "/fake", projectName: "X", mission: "m", topicSlug: "m" });
    assert.match(msg, /Cannot run <stage>/);
    assert.match(msg, /Stage N/);
  });
});
```

See `pi-extension/test/stages/atomic-function.test.ts` for a complete example.

## 4. How to Add a New Test for a Doctor Check

```ts
// pi-extension/test/doctor/checks/<check>.test.ts
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("<check> doctor check", () => {
  it("flags missing <thing>", () => {
    const cwd = mkdtempSync(join(tmpdir(), "velpari-test-"));
    // Don't create the <thing> — check should flag it.
    const issues = runCheck(cwd);
    assert.ok(issues.some((i) => i.kind === "<expected>"));
  });

  it("passes when <thing> is present", () => {
    const cwd = mkdtempSync(join(tmpdir(), "velpari-test-"));
    mkdirSync(join(cwd, "<expected-path>"), { recursive: true });
    writeFileSync(join(cwd, "<file>"), "<content>");
    const issues = runCheck(cwd);
    assert.ok(issues.every((i) => i.kind !== "<expected>"));
  });
});
```

See `pi-extension/test/doctor/checks/` for existing patterns.

## 5. How to Add a New RPC E2E Test

Tier 1 RPC e2e tests use a real Pi subprocess via `--mode rpc`.

```ts
// pi-extension/test/e2e/<name>.e2e.test.ts
import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";

import { runRpcTest } from "./helpers/rpc-client.js";

describe("/<command> — RPC e2e", () => {
  it("walks the legal chain to <stage>", { skip: !tier1Enabled() }, async (t) => {
    const out = await runRpcTest(client, `
      import { clearRun, createRun, advanceStage, loadState } from ${STATE_JS};
      // ...
      process.stdout.write(JSON.stringify({ stage: loadState(cwd).currentStage }));
    `);
    assert.equal(out.stage, "<expected-stage>");
  });
});
```

Key rules (from `test/e2e/README.md`):
- Scripts must NOT contain backticks or `${...}` — use string concatenation.
- The client auto-sets cwd; the script reads `process.cwd()`.
- `tier1Enabled()` checks `RUN_E2E=1` + `pi` on PATH.

## 6. How to Add a New In-Process Test (L3)

> **Status (2026-09-15):** `pi-coding-agent-test@0.1.1` is INCOMPATIBLE with
> pi 0.85.1. L3 is currently DEFERRED. The harness wrapper
> (`pi-extension/test/in-process/harness.ts`) is kept so we can re-probe when
> either side ships a fix.

When L3 is enabled:

```ts
// pi-extension/test/in-process/<name>.test.ts
import { describe, it } from "node:test";
import { text } from "pi-coding-agent-test";
import { makeTest } from "./harness.js";

describe("L3 in-process — <feature>", () => {
  it("does <behavior>", async () => {
    const t = makeTest("<test-name>", {
      conversation: [
        { blocks: [text("scripted assistant reply")] },
      ],
    });
    const result = await t.run("user prompt");
    assert.match(/* result inspection */);
  });
});
```

Run with `RUN_L3_E2E=1 npm run test:l3`. See `pi-extension/test/in-process/smoke.test.ts` for the current compatibility probe.

## 7. How to Add a New Performance Budget

Perf tests are gated by `RUN_PERF=1` so they don't slow the default `npm test`.

```ts
// pi-extension/test/performance/<feature>-budget.test.ts
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PERF_ENABLED = process.env.RUN_PERF === "1";

describe("performance — <feature>", () => {
  it("<operation> finishes under <budget>ms", { skip: !PERF_ENABLED }, () => {
    const cwd = mkdtempSync(join(tmpdir(), "velpari-perf-"));
    // setup fixture...

    const start = Date.now();
    // operation
    const elapsed = Date.now() - start;
    assert.ok(elapsed < <budget>, `<operation> took ${elapsed}ms (budget <budget>ms)`);
  });
});
```

Existing budgets (Phase 6 deliverable):

| Operation | Budget | File |
|---|---|---|
| `runDoctor` on 200 PRD-shaped files | <5s | `doctor-big-tree.test.ts` |
| `runDoctor` on 500 PRD-shaped files | <10s | `doctor-big-tree.test.ts` |
| `runDoctor` on 500 RTM files + JSON sidecars | <12s | `doctor-big-tree.test.ts` |
| Full pipeline walk (21 transitions) | <500ms | `pipeline-budget.test.ts` |
| `readApprovedArtifacts` on 10-doc fixture | <250ms | `pipeline-budget.test.ts` |
| `runDoctor` on a minimal full-cwd | <1s | `budget.test.ts` |
| avg of 5 `runDoctor` runs on minimal full-cwd | <500ms | `budget.test.ts` |

When adding a new budget, pick a value that's **at least 2× the typical
observed time** — perf tests should catch regressions, not flake on
normal variance.

## 8. Common Helpers

| Helper | Purpose | File |
|---|---|---|
| `setupFullCwd(cwd)` | Writes minimal config + 2 of 10 required docs | `pi-extension/test/helpers/full-cwd.ts` |
| `TEST_PROJECT = "TestApp"` | Project name expected by setupFullCwd | `pi-extension/test/helpers/full-cwd.ts` |
| `PSRS_FM`, `RTM_JSON` | Pre-built frontmatter + RTM JSON | `pi-extension/test/helpers/full-cwd.ts` |
| `runRpcTest(client, scriptBody)` | Runs a script in a child process and returns JSON | `pi-extension/test/e2e/helpers/rpc-client.ts` |
| `tier1Enabled()` | Returns true when `RUN_E2E=1` and `pi` on PATH | `pi-extension/test/e2e/helpers/test-home.ts` |
| `clearRun(cwd)`, `createRun(mission, cwd)`, `advanceStage(state, cmd, cwd)` | State machine primitives for unit tests | `pi-extension/src/core/state.ts` |

## 9. Useful Commands

```bash
npm test                          # L1 unit (default; fast)
npm run test:coverage             # L1 unit + coverage report
RUN_E2E=1 npm run test:e2e        # L2 RPC e2e (needs pi on PATH)
RUN_PERF=1 npm run test:coverage -- --test --test-reporter=spec \
                                   dist/pi-extension/test/performance/*.test.js
                                   # Perf tests (gated by RUN_PERF)
RUN_L3_E2E=1 npm run test:l3      # L3 in-process (DEFERRED — see Phase 4)
```

## 10. CI Pipeline

`.github/workflows/test.yml` runs on every push + PR:

| Job | When | Soft or hard fail |
|---|---|---|
| `unit-and-e2e` | always | hard fail if statements < 92% |
| `perf` | always (after unit-and-e2e) | soft fail (continue-on-error) — leaves PR comment |
| `tier2` | workflow_dispatch only | hard fail if `KIMI_API_KEY` is set |

Concurrency: stale runs on the same ref are cancelled when a new commit lands.

## 11. Layer-aligned Architecture Tests

`pi-extension/test/architecture-alignment.test.ts` walks the compiled
`dist/` and asserts that:

- Layer 0 (core, io) imports nothing else from src/
- Layer 1 (stages, ops, doctor, view) imports only L0
- Layer 2 (ui, hooks) imports L0 + L1
- Layer 3 (commands, index.ts) imports all lower layers

If you add a new folder, update `pi-extension/src/layers.ts` AND `src/AGENTS.md`.

## 12. Where to Find Things

| You want to... | Look at |
|---|---|
| Update the test counts in this doc | `npm test` output |
| Find which tests cover a specific function | `grep -r "<function-name>" pi-extension/test/` |
| Add a test for a new stage | `pi-extension/test/stages/atomic-function.test.ts` (template) |
| Add a test for a new doctor check | `pi-extension/test/doctor/checks/` |
| Update the coverage baseline | `Doc/test-coverage-baseline.md` |
| Understand the test plan | `.IDE_Plans/multi-phase-test-plan_plan_20260915_1224_v1.0.md` |
