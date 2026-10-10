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
| **Tier 3 — Full-sequence RPC** | `scripts/e2e-rpc-test.mjs` | hours (real LLM) | Whole chain brainstorm → handoff against a live pi + real model | **CI-only** (`workflow_dispatch`, cline-pass DeepSeek via `CLINE_PASS_AUTH_JSON`) |
| **Tier 4 — Full sequence with real herdr scout panes** | `scripts/e2e-rpc-test.mjs` inside a herdr pane | hours (real LLM, 4 visible panes per scout stage) | Tier 3 chain **plus** real multi-pane scout dispatch (2–10 stages) through the herdr mux backend | **CI-only, explicit only** (`workflow_dispatch -f job=tier4`; never in `job=all`) |
| **Perf** | `node --test` (timing) | variable | Doctor + handoff + walk latency budgets | `RUN_PERF=1` |

> **Naming note (herdr initiative).** The herdr integration initiative numbers
> its own layers L1 unit / L2 full suite / **L3 herdr-in-CI** / L4 full-sequence
> / L5 release matrix (master plan §5). That "L3" is the `herdr-l3` CI job in
> §10 — it is **not** the "L3 — In-process" harness in the table above. The two
> vocabularies are unrelated; when a reference is ambiguous, name which one.

### Manual dispatch — selecting one job family (2026-10-09)

`workflow_dispatch` now takes a `job` input so a manual run does not have to drag the whole pipeline with it:

- `gh workflow run test.yml --ref <branch> -f job=tier2` — Tier 2 only (`unit-and-e2e`, `herdr-l3`, `perf` and `tier3` are skipped).
- `gh workflow run test.yml --ref <branch> -f job=tier3` — Tier 3 only.
- `gh workflow run test.yml --ref <branch> -f job=tier4` — Tier 4 only (full sequence with real herdr scout panes; paid multi-hour acceptance run — dispatch **once**, re-dispatch needs a user decision).
- Omitted (or `-f job=all`) — everything, i.e. exactly what a bare dispatch did before this input existed.

Push and PR runs are unaffected: the input is empty for them and every gated job falls through its `github.event_name != 'workflow_dispatch'` arm. Note that the `concurrency` group is per-ref with `cancel-in-progress: true`, so dispatching on a branch while its push run is still in flight cancels that run.

Tier 2 also had two missing prerequisites, fixed alongside: the job never ran `npm run build` (the `test:e2e:tier2` script runs the **compiled** suite, so a fresh checkout matched no test files and the job passed having executed zero tests), and it never installed `pi` (so every Tier 1-gated e2e skipped). Both now mirror Tier 1: a `Build` step and the fail-soft `pi@0.87.1` install.

### Tier 3 — remote full-sequence run (2026-10-07)

- What it is: `scripts/e2e-rpc-test.mjs` drives a real `pi --mode rpc` process through the complete chain — configure-inputs → brainstorm → all 9 stages (stage command → working copy + payload → fall-back approve) → `/velpari-handoff` — in a throwaway git workspace, asserting state advances, the store DB (`Doc/store/RPCTestApp/index.db`), exported YAML, and the handoff payload.
- How to run: GitHub Actions only — `gh workflow run test.yml --ref SQL-DB`, job `tier3` (manual dispatch, `timeout-minutes: 360`). Installs pi 0.87.1 + `pi-interactive-subagents` + tmux on the runner. Never runs on push (LLM cost/flakiness).
- Key/env knobs (2026-10-09, final): the default model is `cline-pass/deepseek-v4.1-flash` (paid ClinePass plan — small free models proved too weak for the stage lifecycle: branch run 37965973660 passed 20/27, failing the LLM-driven brainstorm lifecycle). Auth: the `CLINE_PASS_AUTH_JSON` repo secret holds the OAuth credential from the dev machine's pi auth store; the job seeds it onto the runner and pi auto-refreshes. Caveats: per-token billing on ClinePass every run; WorkOS refresh-token rotation can invalidate the dev machine's local login (re-`/login` if so); refresh the secret when the local credential rotates. Free fallback: `E2E_MODEL=cline-free/mimo-v2.6-flash` + drop the auth-seed step. The cline provider is not built into pi — the tier3 job installs the `npm:@maxpaulus/pi-cline` extension to supply it (same as local pi setups). Kimi is the documented fallback: restore the `KIMI_API_KEY: ${{ secrets.KIMI_API_KEY }}` env line + `E2E_MODEL: kimi-coding/kimi-for-coding` in the tier3 job (the secret itself stays in the repo). Harness env: `E2E_UNTIL_STAGE` (stop early), `E2E_MODEL` (pi `--model` passthrough), `E2E_STAGE_TIMEOUT_MS` (default 20 min/stage). Spawn fixes `PI_SUBAGENT_MUX=tmux` and `VELPARI_EXCALIDRAW=0`.
- Results: `tier3-result` artifact = `.tmp/tier3/run-<ts>/` (report.md + results.json + pi-stderr.log).

### Tier 4 — full sequence with real herdr scout panes (2026-10-10)

- What it is: the Tier 3 chain, but the harness runs **inside a managed herdr pane** and every scout stage splits real visible herdr panes (`E2E_SPAWN_SCOUTS=all`) through the fork plugin's herdr mux backend. It proves what Tier 3 cannot — that scout dispatch physically creates 4 panes with live `pi` children in the herdr backend, not just that reports appear. First local smokes on the fork (only pane layout differs): `.IDE_Plans/smoke/run-6/`.
- How to run: GitHub Actions only, manual dispatch, explicit job — `gh workflow run test.yml --ref development -f job=tier4` (`timeout-minutes: 360`). It is deliberately **not** reachable through `-f job=all`, so a casual dispatch can never spend the paid multi-hour run. The job installs pi 0.87.1 + the **herdr-capable fork** (`pi install git:github.com/Adi-Mudi/pi-interactive-subagents`, not upstream `HazAT`) + `npm:@maxpaulus/pi-cline`, installs the herdr CLI, seeds the cline-pass auth secret, seeds the default model in `settings.json` (tolerant merge), runs a `pi --model … -p "Reply with exactly: ok"` pre-flight, then starts a headless `herdr server` and runs the harness inside a real pane (same start/health/pane/sentinel pattern as `herdr-l3`).
- Key/env knobs: `PI_SUBAGENT_MUX=herdr` (selects the fork's herdr backend), `E2E_SPAWN_SCOUTS=all` (dispatch real 4-scout panes at every scout stage; the first scout stage is asserted strictly, later stages are recorded as informational), `E2E_REPORT_ROOT=.tmp/tier4`, `E2E_MODEL=cline-pass/deepseek-v4.1-flash`.
- Cost rule: one dispatch per acceptance gate. `CLINE_PASS_AUTH_JSON` is per-token billed; a re-dispatch is a user decision, never an automatic retry.
- Results: `tier4-result` artifact = `.tmp/tier4/run-<ts>/` (report.md + results.json + events.jsonl + pi-stderr.log) **plus** `.tmp/herdr-tier4/` (herdr server log, `herdr status server`, workspace JSON, full pane output).
- Fallback note (limitation slot): if headless herdr inside the CI runner proves impossible (e.g. install endpoint or server needs a real terminal), this subsection is where the limitation gets documented — a Tier 4 limitation is recorded here for the user to decide, never silently downgraded to a Tier 3 pass.

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
npm run test:herdr-mux            # multiplexer detection + brainstorm gate (2 files)
```

## 10. CI Pipeline

`.github/workflows/test.yml` runs on every push + PR:

| Job | When | Soft or hard fail |
|---|---|---|
| `unit-and-e2e` | always | hard fail if statements < 92% |
| `perf` | always (after unit-and-e2e) | soft fail (continue-on-error) — leaves PR comment |
| `tier2` | workflow_dispatch only | hard fail if `KIMI_API_KEY` is set |
| `tier3` | workflow_dispatch only (`-f job=tier3`, or `job=all`) | hard fail |
| `tier4` | workflow_dispatch only (`-f job=tier4`) — **never** in `job=all` | hard fail — installs herdr, starts the headless server, and runs the full sequence inside a real pane with real 4-scout dispatch at every scout stage |
| `herdr-l3` | always (after unit-and-e2e); `herdr*` branches are the initiative's | hard fail — installs herdr on `ubuntu-latest` + `macos-latest`, starts the headless server, health-checks `herdr status server`, then runs the multiplexer + brainstorm-gate test files inside a real herdr pane |

`herdr-l3` is **L3 — herdr-in-CI** (see the naming note in §1). It drives the
real herdr CLI (`herdr pane run` / `herdr pane read`) so the run happens with
herdr's own `HERDR_ENV` / `HERDR_PANE_ID` injected, and always uploads
`.tmp/herdr-l3/` (server log, status, workspace JSON, pane output) as the
`herdr-l3-<os>` artifact. Failures print the server log or the pane dump.
**Windows is out of the matrix** — herdr's Windows support is preview-only;
revisit at herdr Windows GA.

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
