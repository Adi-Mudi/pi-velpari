# Pi-Velpari Test Plan

- **Project:** Pi-Velpari
- **Source PRD:** `Doc/PRD.md` v1.1
- **Source RTM:** `Doc/RTM_Pi-Velpari.md`
- **Source Design:** `Doc/design.md`
- **Source Pseudocode:** `Doc/pseudocode.md`
- **Specific TCs:** `Doc/test-cases.md`
- **Date:** 2026-08-24

---

## 1. Scope

### 1.1 In scope

The following are tested by automated tests (`node --test` under `pi-extension/test/`):

1. **State management** — load, save, atomic write, schema validation, run creation, stage advancement, reset, working/published copy separation.
2. **Stage transition enforcement** — every allowed transition succeeds; every disallowed transition throws; `nextStage` returns the correct value or throws on terminal states.
3. **Constants** — every Stage enum value has a transition entry; every stage has an artifact name.
4. **Prompt construction** — `loadStageSkill` reads the right file; `buildStagePrompt` includes scope block, path block, and rules block.
5. **Compaction hook** — `buildCompactionSummary` produces a deterministic, zero-LLM summary that includes run id, mission, current stage, completed stages, and current stage directory.
6. **Configuration** — `loadFilesConfig`, `saveFilesConfig`, `validateFilesConfig` round-trip a valid config; reject malformed ones; `runFilesDiscovery` returns sensible defaults.
7. **Doctor** — `runDoctor` produces a report with the expected sections; `scanForSecrets` matches each regex pattern with a known-positive input and rejects known-negatives; `validateSenaiHandoffSchema` reads Senai source and asserts field names.
8. **Stage modules** — each of the 7 stage modules (`discuss`, `prd`, `rtm`, `feasibility`, `design`, `pseudocode`, `testplan`) accepts a state, writes a working copy, and refuses to publish to `Doc/` without explicit confirm (verified by mocking `api.ui.previewAndConfirm`).
9. **Handoff** — `runHandoff` produces a valid `.pi/senai/architect-inputs.json` from approved artifacts; rejects when an artifact is missing; respects Senai's schema (verified against the actual Senai source).
10. **Show commands** — `showStage` returns artifact content when published; returns "stage not reached" message when missing; concatenates `test-plan.md` and `test-cases.md` for the testplan stage.
11. **Discussion 4-agent pattern** — `discuss.ts` spawns the 4 expected subagents (extractor, prd-checker, rtm-checker, decision-agent); each scout reads its designated doc; the DECISION AGENT's verdict correctly classifies user input; helper function dedup by `name + filePath` works; PRD auto-update applies the verdict.
12. **Atomic-function stage** — `atomic-function.ts` spawns 4 AF scouts in parallel; each reads its designated doc; suggestions are merged and deduplicated; picker returns accepted list; published doc only contains accepted entries.
13. **Development-order stage** — `development-order.ts` spawns 4 DO scouts in parallel; rankings are merged via average rank; order picker lets user drag-reorder; published doc only contains final accepted order.
14. **Helper ↔ atomic dependency** — bidirectional references maintained between helper functions and atomic functions; doctor flags unidirectional or orphan references; atomic functions cannot call other atomic functions.
15. **Optional artifact handoff** — handoff includes `atomic-functions.md` and `development-order.md` when present; proceeds without them when missing; warns when Senai doesn't recognize new document types.
16. **Scout agent architecture** — stages 2–7 do not spawn subagents; the 12 scout agents (4 in discuss + 4 in atomic-function + 4 in development-order) are spawned with correct names.

### 1.2 Out of scope

The following are **not** tested by automated tests:

1. **LLM behavior.** Tests do not invoke a real LLM. Stage modules are tested with a mock `ExtensionAPI` whose `llm.complete` returns a fixed fixture. The zero-hallucination rule is verified structurally (via cross-reference in doctor), not by running the LLM against a fixture.
2. **Pi UI rendering.** Pi's command registration and UI display are not testable without a live Pi runtime. Tests use a mock `ExtensionAPI` with stub methods.
3. **Live subagent behavior.** Subagents are mocked with deterministic fixtures (one JSON response per scout). Real subagent behavior (timeouts, retries, model latency) is not tested in CI. The 30-second timeout per subagent is enforced in code (per `pseudocode.md:spawnSubagent`) but not stress-tested.
3. **Live Senai integration.** The handoff test reads Senai's source to verify schema, but does not run `/senai-configure-architect-inputs` end-to-end. That integration test is the user's manual step.
4. **Performance / load.** No benchmarks; tests run with tiny temp directories.
5. **Cross-platform file path behavior.** Tests run on Linux/macOS. Windows path quirks are not exercised.
6. **Visual regression of skill markdown.** Skill markdown is treated as opaque text; no linting or formatting checks.

### 1.3 Risk-based additions

If a defect is found after release, a regression test is added before the fix lands. The fix and test are committed together.

---

## 2. Approach

### 2.1 Test runner

`node --test` — the built-in Node.js test runner. No third-party test framework. Tests live under `pi-extension/test/*.test.ts`.

### 2.2 Build before test

`npm test` is defined as `npm run build && node --test dist/pi-extension/test/**/*.test.js`. This catches TypeScript errors before tests run and ensures tests exercise the compiled output (matching what Pi loads).

### 2.3 Test isolation

Every test creates its own temp directory with `fs.mkdtempSync(path.join(os.tmpdir(), "velpari-test-"))` and removes it in a `finally` block. Tests do not share state. Tests do not write to the project's real `.IDE_Plans/`, `.pi/`, or `Doc/` directories.

### 2.4 Mocking `ExtensionAPI`

A `createMockApi(overrides)` helper returns a mock `ExtensionAPI` object whose methods are stubs recording calls. Stage modules are invoked with this mock. Tests assert on:
- The mock's recorded calls (`mock.calls.publishToDoc`, `mock.calls.notify`, etc.).
- Files written to the temp directory.
- The mock's `previewAndConfirm` returning `true` or `false` as the test dictates.

### 2.5 Fixture strategy

- **State fixtures:** minimal valid `RunState` objects with `version: 1` and one history entry per scenario.
- **Doc fixtures:** small markdown strings (10–50 lines) per stage, written to the temp `Doc/` directory.
- **Senai fixture:** read Senai's `architect-inputs-config.ts` at test time. The handoff test imports a small parser that extracts the expected schema. The parser is also covered by its own tests.

### 2.6 Test categories

Per file/module:

| Test file | Module | Category | Coverage focus |
|---|---|---|---|
| `index.test.ts` | `index.ts` | Smoke | Loads without throwing; refuses to load when `PI_SUBAGENT_NAME` is set |
| `constants.test.ts` | `constants.ts` | Unit | `STAGE_TRANSITIONS`, `nextStage`, `artifactNameFor`, `isContentStage`, `isApprovedStage` |
| `state.test.ts` | `state.ts` | Unit | `loadState`/`saveState`/`createRun`/`advanceStage`/`clearRun`/`publishToDoc` round-trip, atomic write, schema validation |
| `prompt.test.ts` | `prompt.ts` | Unit | `loadStageSkill`, `buildStagePrompt` block composition |
| `commands.test.ts` | `commands.ts` | Unit | `registerCommands` registers all 22 commands; handler delegation |
| `compaction.test.ts` | `compaction.ts` | Unit | `buildCompactionSummary` deterministic output |
| `config.test.ts` | `config.ts` | Unit | `loadFilesConfig`/`saveFilesConfig`/`validateFilesConfig`/`runFilesDiscovery` |
| `doctor.test.ts` | `doctor.ts` | Unit | `runDoctor`, `scanForSecrets`, `validateSenaiHandoffSchema` |
| `discuss.test.ts` | `discuss.ts` | Unit (mocked) | 4-agent pattern; multi-turn loop; preview gate; auto-update PRD |
| `prd.test.ts` | `prd.ts` | Unit (mocked) | Working copy written; preview gate; trace-back enforced |
| `rtm.test.ts` | `rtm.ts` | Unit (mocked) | Working copy written; table columns enforced; `HF-NN` references |
| `feasibility.test.ts` | `feasibility.ts` | Unit (mocked) | All 5 dimensions covered; Go verdict path |
| `design.test.ts` | `design.ts` | Unit (mocked) | All 5 design sections covered; trace-back enforced |
| `pseudocode.test.ts` | `pseudocode.ts` | Unit (mocked) | Pseudocode blocks per module; pre/postconditions |
| `testplan.test.ts` | `testplan.ts` | Unit (mocked) | Two files written (test-plan + test-cases); TC table columns |
| `atomic-function.test.ts` | `atomic-function.ts` | Unit (mocked) | 4 AF scouts; merge/dedup; picker; working copy; bidirectional atomic refs |
| `development-order.test.ts` | `development-order.ts` | Unit (mocked) | 4 DO scouts; ranking merge; order picker; working copy |
| `handoff.test.ts` | `handoff.ts` | Unit + integration | Valid handoff; missing artifact rejection; optional artifact inclusion; Senai schema round-trip |
| `show.test.ts` | `show.ts` | Unit | All 7 stages; missing-artifact path; testplan concatenation |

**Total: 19 test files.**

### 2.7 Integration tests

Most tests are unit tests with mocked `ExtensionAPI`. Two integration-level tests exist:

1. **`handoff.test.ts` — Senai schema round-trip.** Reads Senai's `architect-inputs-config.ts` at test time and asserts the handoff output's field names match.
2. **`doctor.test.ts` — full report.** Runs `runDoctor` against a synthetic complete run (state file + 7 approved artifacts) and asserts the report covers every check.

These are still deterministic and run in CI.

### 2.8 Coverage measurement

Not measured. Code coverage tooling is out of scope for v1.0 (NFR-09 says "at least one test per module", not "X% coverage"). A future v1.x release may add coverage measurement.

---

## 3. Test Environment

### 3.1 Runtime

- **Node.js:** LTS (currently Node 20+). Matches `package.json:engines.node`.
- **TypeScript:** 5.x.
- **Operating system:** Linux (primary), macOS (developer machine). Windows is not a target in v1.0.

### 3.2 Dependencies

- **`node:test`** — built-in test runner.
- **`node:assert`** — built-in assertions.
- **`fs.mkdtempSync`**, **`os.tmpdir`** — built-in.
- **No third-party test framework.** No Jest, Mocha, Vitest, or chai.

### 3.3 Project-local setup

- Each test uses `fs.mkdtempSync` for an isolated temp directory.
- Tests do not depend on the project's `.IDE_Plans/`, `.pi/`, or `Doc/` directories.
- Tests do not depend on real LLM credentials.

### 3.4 CI considerations

Out of scope for v1.0 (no CI is configured yet). When CI is added, `npm test` is the single command that runs the full suite.

---

## 4. Entry Criteria

Tests may run when ALL of the following are true:

1. `package.json` exists and declares the required scripts.
2. `tsconfig.json` exists with strict mode.
3. All source modules under `pi-extension/src/` exist.
4. All test files under `pi-extension/test/` exist.
5. `npm install` has completed successfully.

If any criterion is false, the test runner exits with code 1 and an explanatory error.

---

## 5. Exit Criteria

Tests pass (i.e., the test suite is "done") when ALL of the following are true:

1. `npm run build` exits with code 0 under TypeScript strict mode.
2. `npm test` exits with code 0.
3. Every test file has at least 3 test cases (positive, negative, edge).
4. Every FR-N in `Doc/RTM_Pi-Velpari.md` has at least one corresponding TC in `Doc/test-cases.md` that is exercised by an automated test.
5. Every NFR-N has at least one corresponding TC.
6. The handoff test passes against the current Senai source in `Pi-Orchestra_v4`.
7. No test depends on the network, on real LLM credentials, or on the project's real filesystem locations.

A release is blocked if any criterion fails.

---

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LLM behavior drift breaks stage modules | High | Medium | Tests use mocked LLM. Real LLM behavior is verified manually in the walkthrough (`Doc/step-by-step-guide.md`). Skill markdown iteration is a known phase of development. |
| Scout agent test brittleness | Medium | Medium | 12 scout agents return JSON parsed from LLM responses. JSON schema is enforced by each scout's skill prompt. Tests use fixture JSON for each scout. Failure modes: invalid JSON, missing required fields, malformed `name + filePath` keys — all covered by negative tests. |
| Senai schema changes break handoff test | Medium | Medium | Test reads Senai source at test time, so schema changes are caught immediately. Fix is a one-line update to `handoff.ts:validateSenaiSchema`. |
| `fs.mkdtempSync` leaves temp dirs on test failure | Low | Low | Each test wraps setup/teardown in try/finally. CI runs in clean containers. |
| Mock API drift from real API | Medium | Medium | Mock is small and only stubs methods we use. If real API gains new required methods, mock grows. |
| Windows path quirks | Low | Low | Windows not a target in v1.0. |
| Test execution time grows unmanageably | Low | Low | Tests are fast (no network, no LLM). Suite should complete in <2s on a developer machine. |
| TypeScript version drift breaks build | Low | Low | `package.json` pins `typescript` to a specific minor version. |

---

## 7. Test Maintenance

### 7.1 Adding a new test

When a new requirement or behavior is added:
1. Add a row to `Doc/RTM_Pi-Velpari.md` with a new FR-N and TC range.
2. Add specific TCs to `Doc/test-cases.md`.
3. Add test cases to the relevant `pi-extension/test/*.test.ts` file.
4. Run `npm test` to verify.

### 7.2 Modifying an existing test

When behavior changes:
1. Update the test to match the new behavior.
2. Update `Doc/pseudocode.md` if the algorithm changed.
3. Update `Doc/design.md` if the contract changed.
4. Run `npm test` to verify.

### 7.3 Removing a test

When a requirement is removed:
1. Remove the row from `Doc/RTM_Pi-Velpari.md`.
2. Remove the TC from `Doc/test-cases.md`.
3. Remove the test case.
4. Remove or refactor any helper functions that become orphan.
5. Run `npm test` to verify nothing else relied on the removed behavior.

### 7.4 Test naming convention

- File: `<module>.test.ts` (e.g., `state.test.ts`).
- Test description: `functionName: scenario` (e.g., `"loadState: returns null when file missing"`).
- Use `describe` blocks to group tests for a single function.
- Use `it` blocks for individual scenarios.

---

## 8. Acceptance Criteria for the Test Suite Itself

The test plan is considered implemented when:

1. All 17 test files exist under `pi-extension/test/`.
2. `npm test` exits with code 0.
3. Every RTM row has at least one corresponding automated test.
4. The handoff test passes against current Senai source.
5. No test depends on the network or on a real LLM.

---

*This test plan is consumed by `Doc/test-cases.md` (specific test cases) and by Phase A–E implementation (each module ships with its test file).*
