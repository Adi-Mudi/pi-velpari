# Pi-Velpari Test Cases

- **Project:** Pi-Velpari
- **Source PRD:** `Doc/PRD.md` v1.1
- **Source RTM:** `Doc/RTM_Pi-Velpari.md`
- **Source Test Plan:** `Doc/test-plan.md`
- **Date:** 2026-08-24
- **Coverage:** 110 test cases across 17 test files. Every FR-N and NFR-N has at least one TC.

---

## Reading guide

- **TC ID** — stable identifier (`TC-001` through `TC-110`).
- **Description** — what the test verifies.
- **Preconditions** — state of the system before the test runs.
- **Steps** — actions the test performs.
- **Expected Result** — what must be true for the test to pass.
- **RTM Req ID** — link to `Doc/RTM_Pi-Velpari.md`.
- **Priority** — `P1` (must, blocks release), `P2` (should, fix before next minor), `P3` (nice, backlog).

Tests are grouped by the module they exercise. The "Test file" column tells you where the test code lives.

---

## 1. `discuss.ts` (FR-01) — 5 cases

**Test file:** `pi-extension/test/discuss.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-001 | `runDiscuss` writes a working copy under `runs/<id>/discuss/discussion-notes.md` | New run, state at `discussing`, mock API returns user answers | Call `runDiscuss` with mission "Test mission" | Working copy exists; content includes mission and Q&A list | FR-01 | P1 |
| TC-002 | `runDiscuss` advances state to `discussed` after user confirms | TC-001 setup; mock returns `previewAndConfirm = true` | Call `runDiscuss` | `loadState().currentStage === "discussed"`; history has one entry | FR-01 | P1 |
| TC-003 | `runDiscuss` does not advance state when user cancels | TC-001 setup; mock returns `previewAndConfirm = false` | Call `runDiscuss` | `loadState().currentStage === "discussing"`; no history entry; working copy retained | FR-01, FR-23 | P1 |
| TC-004 | `runDiscuss` does not write to `Doc/` directly | TC-001 setup | Call `runDiscuss` and complete | `Doc/discussion-notes.md` does not exist | FR-21, FR-23 | P1 |
| TC-005 | `runDiscuss` produces zero added information (every line traces to a Q&A answer) | TC-001 setup; mock answers are 5 simple strings | Call `runDiscuss` and complete | Every non-header line in the working copy is either empty, a question, or appears verbatim in an answer | FR-22 | P1 |

---

## 2. `prd.ts` (FR-02) — 5 cases

**Test file:** `pi-extension/test/prd.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-006 | `runPrd` writes a working copy under `runs/<id>/prd/PRD_Pi-Velpari.md` | State at `drafting-prd`; discussion-notes.md exists in Doc/ | Call `runPrd` | Working copy exists | FR-02 | P1 |
| TC-007 | `runPrd` advances state to `drafted-prd` after user confirms | TC-006 setup; mock returns true | Call `runPrd` | `currentStage === "drafted-prd"` | FR-02 | P1 |
| TC-008 | `runPrd` does not run when previous stage is not approved | State at `discussing` (not `discussed`) | Call `runPrd` | Error thrown or UI message; state unchanged | FR-24 | P1 |
| TC-009 | `runPrd` PRD contains stable FR-N identifiers | TC-006 setup; mock LLM returns PRD with FR-01..FR-07 listed | Call `runPrd` | Working copy text contains `FR-01`..`FR-07` | FR-02 | P1 |
| TC-010 | `runPrd` does not write to `Doc/` directly | TC-006 setup | Call `runPrd` and complete | `Doc/PRD_Pi-Velpari.md` does not exist | FR-21, FR-23 | P1 |

---

## 3. `rtm.ts` (FR-03) — 5 cases

**Test file:** `pi-extension/test/rtm.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-011 | `runRtm` writes a working copy with the industry-standard table | State at `building-rtm`; PRD exists | Call `runRtm` | Working copy exists; contains columns `Req ID`, `Description`, `Source / PRD Section`, `Design Element`, `Implementation / Helper Function`, `Test Case ID`, `Status` | FR-03 | P1 |
| TC-012 | `runRtm` advances state to `built-rtm` after confirm | TC-011 setup | Call `runRtm` | `currentStage === "built-rtm"` | FR-03 | P1 |
| TC-013 | Every PRD FR-N appears as a row in the RTM | TC-011 setup; PRD has FR-01..FR-05 | Call `runRtm` | RTM table has rows with `FR-01`..`FR-05` in the `Req ID` column | FR-03 | P1 |
| TC-014 | `runRtm` Implementation/Helper Function column points to existing functions | TC-011 setup; design.md lists functions | Call `runRtm` | Every cell in `Implementation / Helper Function` column matches a `path:func()` pattern that exists in design.md | FR-03, NFR-08 | P2 |
| TC-015 | `runRtm` rejects if PRD is missing | State at `building-rtm`; no PRD | Call `runRtm` | Error thrown or UI message; no working copy written | FR-24 | P1 |

---

## 4. `feasibility.ts` (FR-04) — 5 cases

**Test file:** `pi-extension/test/feasibility.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-016 | `runFeasibility` writes a working copy with all 5 dimensions | State at `analyzing-feasibility`; PRD + RTM exist | Call `runFeasibility` | Working copy contains sections: Technical, Economic, Legal, Operational, Schedule | FR-04 | P1 |
| TC-017 | `runFeasibility` produces a verdict (Go / Conditional Go / No-Go) | TC-016 setup | Call `runFeasibility` | Working copy contains the verdict line | FR-04 | P1 |
| TC-018 | `runFeasibility` advances state to `analyzed-feasibility` after confirm | TC-016 setup | Call `runFeasibility` | `currentStage === "analyzed-feasibility"` | FR-04 | P1 |
| TC-019 | `runFeasibility` ratings per dimension are present | TC-016 setup | Call `runFeasibility` | Each dimension section contains a rating (High / Medium / Low) | FR-04 | P2 |
| TC-020 | `runFeasibility` does not invent claims not traceable to PRD/RTM | TC-016 setup | Call `runFeasibility` and inspect | Each claim cites a PRD FR-N or RTM row | FR-22 | P2 |

---

## 5. `design.ts` (FR-05) — 5 cases

**Test file:** `pi-extension/test/design.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-021 | `runDesign` writes a working copy with all 5 design sections | State at `designing`; PRD + feasibility exist | Call `runDesign` | Working copy contains: Module Breakdown, Data Model, Interface Contracts, Data Flow, Non-Functional Considerations | FR-05 | P1 |
| TC-022 | `runDesign` advances state to `designed` after confirm | TC-021 setup | Call `runDesign` | `currentStage === "designed"` | FR-05 | P1 |
| TC-023 | Every design element maps back to a PRD FR-N | TC-021 setup | Call `runDesign` and inspect | Each design element has at least one FR-N tag in its description | FR-05, FR-22 | P1 |
| TC-024 | `runDesign` interface contracts section lists every module from design.md | TC-021 setup | Call `runDesign` and inspect | The Interface Contracts section lists all 17 modules | FR-05 | P2 |
| TC-025 | `runDesign` data flow section matches the diagrams in design.md §5 | TC-021 setup | Call `runDesign` and inspect | Data Flow section references the same flows (pipeline, configure-inputs, doctor, compaction) | FR-05 | P3 |

---

## 6. `pseudocode.ts` (FR-06) — 5 cases

**Test file:** `pi-extension/test/pseudocode.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-026 | `runPseudocode` writes a working copy with one block per design module | State at `writing-pseudocode`; design exists | Call `runPseudocode` | Working copy has ≥17 algorithm blocks | FR-06 | P1 |
| TC-027 | Each pseudocode block has inputs, outputs, preconditions, postconditions | TC-026 setup | Call `runPseudocode` and inspect | Every block contains the four labeled sub-sections | FR-06 | P1 |
| TC-028 | `runPseudocode` advances state to `wrote-pseudocode` after confirm | TC-026 setup | Call `runPseudocode` | `currentStage === "wrote-pseudocode"` | FR-06 | P1 |
| TC-029 | Every pseudocode block's function name matches a design.md module export | TC-026 setup | Call `runPseudocode` and inspect | Each block's function name appears in design.md's "Key exports" | FR-06, NFR-08 | P2 |
| TC-030 | `runPseudocode` does not introduce logic not in pseudocode.md | TC-026 setup | Call `runPseudocode` and inspect | Each block's step-by-step logic traces to a block in `Doc/pseudocode.md` | FR-06, FR-22 | P2 |

---

## 7. `testplan.ts` (FR-07) — 5 cases

**Test file:** `pi-extension/test/testplan.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-031 | `runTestPlan` writes two working copies (test-plan.md and test-cases.md) | State at `planning-tests`; pseudocode + RTM exist | Call `runTestPlan` | Both files exist under `runs/<id>/testplan/` | FR-07 | P1 |
| TC-032 | `runTestPlan` advances state to `planned-tests` after confirm | TC-031 setup | Call `runTestPlan` | `currentStage === "planned-tests"` | FR-07 | P1 |
| TC-033 | test-cases.md uses the standard TC table columns | TC-031 setup | Call `runTestPlan` and inspect | File contains columns: TC ID, Description, Preconditions, Steps, Expected Result, RTM Req ID, Priority | FR-07 | P1 |
| TC-034 | Every test case references an RTM row | TC-031 setup | Call `runTestPlan` and inspect | Every row in the TC table has a non-empty `RTM Req ID` cell referencing a real RTM row | FR-07, FR-22 | P1 |
| TC-035 | No test cases appear for requirements not in RTM | TC-031 setup; RTM has 5 rows | Call `runTestPlan` and inspect | TC count equals or exceeds RTM row count; no TCs reference non-existent RTM rows | FR-07, FR-22 | P2 |

---

## 8. `commands.ts` — approve flow (FR-08) — 5 cases

**Test file:** `pi-extension/test/commands.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-036 | `handleApprove` copies working copy to `Doc/` for current stage | State at `discussed`; working copy exists | Call `handleApprove` | `Doc/discussion-notes.md` exists with the same content | FR-08, FR-21 | P1 |
| TC-037 | `handleApprove` advances state to the next stage | State at `discussed` | Call `handleApprove` | `currentStage === "drafting-prd"` | FR-08 | P1 |
| TC-038 | `handleApprove` appends to history | TC-036 setup | Call `handleApprove` | `loadState().history` has a new entry for `discussed` with status `approved` | FR-08, FR-25 | P1 |
| TC-039 | `handleApprove` refuses when working copy is missing | State at `discussed`; no working copy | Call `handleApprove` | Error or UI message; state unchanged | FR-08 | P1 |
| TC-040 | `handleApprove` triggers compaction when context usage ≥ 50% | TC-036 setup; mock returns `contextUsage() >= 0.5` | Call `handleApprove` | `compactNow` is called with the compaction summary | FR-08, NFR-01 | P2 |

---

## 9. `commands.ts` — status / reset (FR-09, FR-10) — 6 cases

**Test file:** `pi-extension/test/commands.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-041 | `handleStatus` renders run id, mission, current stage, history | State file with mission "Test", stage "discussed", 1 history entry | Call `handleStatus` | Output contains run id, mission, current stage, history entry | FR-09 | P1 |
| TC-042 | `handleStatus` prints "No active run" when state is missing | No state file | Call `handleStatus` | Output contains "No active run" | FR-09 | P1 |
| TC-043 | `handleStatus` lists every approved stage with its published path | State with 3 approved stages | Call `handleStatus` | Output lists all 3 stages with their `Doc/` paths | FR-09 | P2 |
| TC-044 | `handleReset` asks for confirmation before deleting | State file exists | Call `handleReset` with mock that records confirm call | Mock's `confirm` was called with a deletion prompt | FR-10 | P1 |
| TC-045 | `handleReset` deletes state and run dir on confirm | TC-044 setup; mock returns true | Call `handleReset` | State file gone; run dir gone | FR-10 | P1 |
| TC-046 | `handleReset` does nothing on cancel | TC-044 setup; mock returns false | Call `handleReset` | State file still exists; run dir still exists | FR-10 | P1 |

---

## 10. `config.ts` (FR-11) — 4 cases

**Test file:** `pi-extension/test/config.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-047 | `saveFilesConfig` + `loadFilesConfig` round-trip a valid config | Temp dir | Save then load | Loaded config equals saved config | FR-11 | P1 |
| TC-048 | `validateFilesConfig` rejects a config missing outputPaths | Config with no outputPaths | Call `validateFilesConfig` | Returns non-empty error list mentioning outputPaths | FR-11 | P1 |
| TC-049 | `runFilesDiscovery` returns sensible defaults for an empty project | Empty temp dir | Call `runFilesDiscovery` | Result includes default output paths under `Doc/` | FR-11 | P2 |
| TC-050 | `runFilesDiscovery` suggests markdown files in subdirectories | Temp dir with subdirs containing `.md` files | Call `runFilesDiscovery` | Result's `inputDocuments` includes detected markdown paths | FR-11 | P2 |

---

## 11. `doctor.ts` (FR-12) — 5 cases

**Test file:** `pi-extension/test/doctor.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-051 | `runDoctor` writes a report to `.IDE_Plans/velpari/doctor-report.md` | Temp project root | Call `runDoctor` | Report file exists | FR-12, NFR-05 | P1 |
| TC-052 | `runDoctor` opens the report with a "Setup progress" section | TC-051 setup | Read report | First section is "Setup progress" with steps marked done/pending | FR-12, NFR-05 | P1 |
| TC-053 | `runDoctor` reports failure when an approved stage's artifact is missing | State with 1 approved stage; the working copy was deleted | Call `runDoctor` | Report contains a fail check for that stage | FR-12 | P1 |
| TC-054 | `runDoctor` reports secret findings | Doc contains a string matching AWS key regex | Call `runDoctor` | Report contains a secret finding with type "AWS access key" | FR-12, NFR-04 | P1 |
| TC-055 | `runDoctor` passes on a clean complete run | All 7 stages approved, all artifacts present, no secrets | Call `runDoctor` | All checks pass; no secret findings | FR-12 | P1 |

---

## 12. `handoff.ts` (FR-13) — 5 cases

**Test file:** `pi-extension/test/handoff.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-056 | `runHandoff` writes `.pi/senai/architect-inputs.json` | State at `planned-tests`; all 7 Doc/ artifacts present | Call `runHandoff` | File exists at HANDOFF_TARGET | FR-13 | P1 |
| TC-057 | `runHandoff` advances state to `handoff-ready` | TC-056 setup | Call `runHandoff` | `currentStage === "handoff-ready"` | FR-13 | P1 |
| TC-058 | `runHandoff` rejects when an artifact is missing | State at `planned-tests`; feasibility-study.md missing | Call `runHandoff` | `written: false`; warning lists missing artifact | FR-13 | P1 |
| TC-059 | `runHandoff` output schema matches Senai's `architect-inputs-config.ts` | TC-056 setup | Call `runHandoff`; parse output | All required keys present (`version`, `projectName`, `documents`, `constraints`) | FR-13, NFR-08 | P1 |
| TC-060 | `runHandoff` document types match the typeMap | TC-056 setup | Call `runHandoff`; inspect documents array | Each document has a `type` matching the typeMap (PRD, RTM, etc.) | FR-13 | P1 |

---

## 13. `show.ts` (FR-14 through FR-20) — 14 cases

**Test file:** `pi-extension/test/show.test.ts`

For each of the 7 content stages, two cases: published artifact exists (returns content), and missing (returns "not reached" message). The testplan stage has an additional case for concatenation.

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-061 | `showStage("discuss")` returns content when Doc/discussion-notes.md exists | Doc/discussion-notes.md exists with text "Notes" | Call `showStage` | Returns "Notes" | FR-14 | P1 |
| TC-062 | `showStage("discuss")` returns "not reached" when missing | Doc/discussion-notes.md does not exist | Call `showStage` | Returns "not reached" message | FR-14 | P1 |
| TC-063 | `showStage("prd")` returns content when present | Doc/PRD_Pi-Velpari.md exists | Call `showStage` | Returns content | FR-15 | P1 |
| TC-064 | `showStage("prd")` returns "not reached" when missing | File missing | Call `showStage` | Returns "not reached" message | FR-15 | P1 |
| TC-065 | `showStage("rtm")` returns content when present | Doc/RTM_Pi-Velpari.md exists | Call `showStage` | Returns content | FR-16 | P1 |
| TC-066 | `showStage("rtm")` returns "not reached" when missing | File missing | Call `showStage` | Returns "not reached" message | FR-16 | P1 |
| TC-067 | `showStage("feasibility")` returns content when present | Doc/feasibility-study.md exists | Call `showStage` | Returns content | FR-17 | P1 |
| TC-068 | `showStage("feasibility")` returns "not reached" when missing | File missing | Call `showStage` | Returns "not reached" message | FR-17 | P1 |
| TC-069 | `showStage("design")` returns content when present | Doc/design.md exists | Call `showStage` | Returns content | FR-18 | P1 |
| TC-070 | `showStage("design")` returns "not reached" when missing | File missing | Call `showStage` | Returns "not reached" message | FR-18 | P1 |
| TC-071 | `showStage("pseudocode")` returns content when present | Doc/pseudocode.md exists | Call `showStage` | Returns content | FR-19 | P1 |
| TC-072 | `showStage("pseudocode")` returns "not reached" when missing | File missing | Call `showStage` | Returns "not reached" message | FR-19 | P1 |
| TC-073 | `showStage("testplan")` returns concatenated test-plan + test-cases | Both files present | Call `showStage` | Returns both contents separated by `---` | FR-20 | P1 |
| TC-074 | `showStage("testplan")` returns "not reached" when test-plan.md missing | test-plan.md missing | Call `showStage` | Returns "not reached" message | FR-20 | P1 |

---

## 14. Cross-cutting — working/published copy separation (FR-21) — 4 cases

**Test file:** `pi-extension/test/state.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-075 | Working copy lives under `.IDE_Plans/velpari/runs/<id>/<stage>/` | New run at `discussing` | Write a working copy via stage module | File exists at the expected working path | FR-21 | P1 |
| TC-076 | Published copy lives under `Doc/` and is created only by `publishToDoc` | Stage approved | Call `publishToDoc` | File exists at `Doc/<artifact>`; matches working copy byte-for-byte | FR-21 | P1 |
| TC-077 | `Doc/` is never written by a stage module | New run, all stages | Run all stage modules with mock confirm=true | After all stages, `Doc/` is empty (no stage wrote to it directly) | FR-21, FR-23 | P1 |
| TC-078 | `Doc/` files are bit-identical to working copies | Stage approved | Call `publishToDoc` | SHA-256 of `Doc/<artifact>` equals SHA-256 of working copy | FR-21 | P1 |

---

## 15. Cross-cutting — zero-hallucination rule (FR-22) — 4 cases

**Test file:** `pi-extension/test/doctor.test.ts` (rule verified by doctor cross-reference)

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-079 | Doctor flags a PRD requirement not in any RTM row | PRD has FR-99 not in RTM | Call `runDoctor` | Report lists FR-99 as a trace-back violation | FR-22 | P1 |
| TC-080 | Doctor flags an RTM row with no test case | RTM has FR-01 with no TC reference | Call `runDoctor` | Report lists FR-01 as "no test case" | FR-22 | P1 |
| TC-081 | Doctor flags an implementation row pointing to a function that doesn't exist | RTM has Implementation cell `ghost.ts:nope()` | Call `runDoctor` | Report lists the missing function | FR-22 | P2 |
| TC-082 | Doctor passes when RTM is fully traced | All RTM rows have TCs and existing functions | Call `runDoctor` | No trace-back violations | FR-22 | P1 |

---

## 16. Cross-cutting — preview-then-save gate (FR-23) — 3 cases

**Test file:** `pi-extension/test/<stage>.test.ts` (one per stage)

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-083 | Stage module calls `previewAndConfirm` before writing | New run, mock records API calls | Call any stage module | `mock.calls.previewAndConfirm.length > 0` happens before any `fs.writeFileSync` to `Doc/` | FR-23 | P1 |
| TC-084 | Stage module does not write `Doc/` when user cancels | New run, mock `previewAndConfirm` returns false | Call any stage module | `Doc/` file does not exist | FR-23 | P1 |
| TC-085 | Stage module writes `Doc/` only after user confirms | New run, mock `previewAndConfirm` returns true | Call any stage module | `Doc/` file exists after the call | FR-23 | P1 |

---

## 17. Cross-cutting — stage transition enforcement (FR-24) — 3 cases

**Test file:** `pi-extension/test/state.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-086 | `advanceStage` succeeds for every allowed transition | State at every stage | Call `advanceStage(next)` for each allowed transition | No throw; state updated | FR-24 | P1 |
| TC-087 | `advanceStage` throws for every disallowed transition | State at every stage | Call `advanceStage("random")` | Throws with descriptive error | FR-24 | P1 |
| TC-088 | `nextStage` returns the unique allowed next | State at every non-terminal stage | Call `nextStage(current)` | Returns the expected next stage | FR-24 | P1 |

---

## 18. Cross-cutting — run state persistence (FR-25) — 3 cases

**Test file:** `pi-extension/test/state.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-089 | `saveState` writes valid JSON to state.json | Temp dir | Call `saveState` | File contains valid JSON matching `RunState` | FR-25 | P1 |
| TC-090 | `loadState` round-trips with `saveState` | TC-089 setup | Save then load | Loaded equals saved (deep equal) | FR-25 | P1 |
| TC-091 | `saveState` is atomic (uses temp file + rename) | TC-089 setup | Save twice in quick succession; inspect file | File is never half-written (validate by checksum during write) | FR-25 | P2 |

---

## 19. `compaction.ts` (NFR-01) — 3 cases

**Test file:** `pi-extension/test/compaction.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-092 | `buildCompactionSummary` produces a deterministic summary | State file present | Call `buildCompactionSummary` | Returns markdown with run id, mission, current stage, completed stages | NFR-01 | P1 |
| TC-093 | `buildCompactionSummary` does not invoke the LLM | TC-092 setup | Call `buildCompactionSummary` and check `api.llm.complete` was not called | Mock's LLM stub has zero calls | NFR-01 | P1 |
| TC-094 | `buildCompactionSummary` handles missing state gracefully | No state file | Call `buildCompactionSummary` | Returns "No active Velpari run." | NFR-01 | P1 |

---

## 20. `index.ts` (NFR-02, NFR-03) — 2 cases

**Test file:** `pi-extension/test/index.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-095 | `index.ts` early-returns when `PI_SUBAGENT_NAME` is set | `process.env.PI_SUBAGENT_NAME = "test-agent"` | Import the default export and call it | No commands registered; no error thrown | NFR-02 | P1 |
| TC-096 | `package.json` declares only `@mariozechner/pi-coding-agent` as a peer dep and has no runtime `dependencies` | Read package.json | Inspect dependencies block | Only peer dep; no `dependencies` key | NFR-07 | P1 |

---

## 21. `doctor.ts` — secret scanning (NFR-04) — 3 cases

**Test file:** `pi-extension/test/doctor.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-097 | `scanForSecrets` matches AWS access keys | Text contains `AKIA1234567890ABCDEF` | Call `scanForSecrets` | Returns finding with type "AWS access key" | NFR-04 | P1 |
| TC-098 | `scanForSecrets` matches GitHub tokens | Text contains `ghp_abcdefghijklmnopqrstuvwxyz0123456789AB` | Call `scanForSecrets` | Returns finding with type "GitHub token" | NFR-04 | P1 |
| TC-099 | `scanForSecrets` does not flag benign text | Text is normal prose | Call `scanForSecrets` | Returns empty array | NFR-04 | P1 |

---

## 22. `doctor.ts` — doctor report (NFR-05) — 2 cases

**Test file:** `pi-extension/test/doctor.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-100 | Doctor report includes "Setup progress" as the first section | TC-051 setup | Read report | First `##` heading is "Setup progress" | NFR-05 | P1 |
| TC-101 | Doctor report names the next command to run | Setup incomplete | Read report | Report includes a line "Next: /velpari-..." for the first pending step | NFR-05 | P2 |

---

## 23. Coding conventions & dependencies (NFR-06, NFR-07) — 2 cases

**Test file:** `pi-extension/test/build.test.ts` (lightweight)

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-102 | `npm run build` succeeds under TypeScript strict mode | Code complete | Run `npm run build` | Exit code 0; no type errors | NFR-06 | P1 |
| TC-103 | `package.json` declares no `dependencies` (peer dep only) | Read package.json | Inspect | `dependencies` block is absent or empty | NFR-07 | P1 |

---

## 24. Senai cross-extension compatibility (NFR-08) — 3 cases

**Test file:** `pi-extension/test/handoff.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-104 | Handoff output has the keys Senai's `architect-inputs-config.ts` expects | Senai source present | Run handoff; parse output | All keys present | NFR-08 | P1 |
| TC-105 | Handoff output's `documents` array matches Senai's expected shape | Senai source present | Run handoff; inspect | Each document has `path` and `type` keys with correct value types | NFR-08 | P1 |
| TC-106 | Handoff test fails when Senai's schema changes | Senai source modified to remove a key | Run handoff test | Test fails with a clear message about the missing key | NFR-08 | P2 |

---

## 25. Testing strategy (NFR-09) — 2 cases

**Test file:** `pi-extension/test/package-manifest.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-107 | Every source module under `pi-extension/src/` has a corresponding test file | Code complete | List source files and test files | 1:1 mapping (every module has `<module>.test.ts`) | NFR-09 | P1 |
| TC-108 | `npm test` exits with code 0 after `npm run build` | All tests implemented | Run `npm test` | Exit code 0 | NFR-09 | P1 |

---

## 26. Documentation (NFR-10) — 2 cases

**Test file:** `pi-extension/test/docs.test.ts` (or manual)

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-109 | All required doc files exist | Project layout complete | Check for each file | README.md, AGENTS.md, CHANGELOG.md, Doc/velpari-sequence.md, Doc/step-by-step-guide.md all exist | NFR-10 | P1 |
| TC-110 | Doc files are non-empty | TC-109 setup | Stat each file | Every file has size > 1 KB | NFR-10 | P1 |

---

## 27. Coverage matrix

| Category | TC count | Test file(s) |
|---|---|---|
| Stage modules (FR-01..FR-07, FR-31..FR-32) | 49 | `discuss.test.ts`, `prd.test.ts`, `rtm.test.ts`, `feasibility.test.ts`, `design.test.ts`, `pseudocode.test.ts`, `testplan.test.ts`, `atomic-function.test.ts`, `development-order.test.ts` |
| Discipline commands (FR-08..FR-13) | 25 | `commands.test.ts`, `config.test.ts`, `doctor.test.ts`, `handoff.test.ts` |
| View commands (FR-14..FR-20) | 14 | `show.test.ts` |
| Cross-cutting v1.1 (FR-21..FR-25) | 17 | `state.test.ts`, `doctor.test.ts` |
| Cross-cutting v1.2 (FR-26..FR-30) | 18 | `discuss.test.ts`, `state.test.ts` |
| Cross-cutting v1.3 (FR-33..FR-36) | 18 | `state.test.ts`, `handoff.test.ts`, `atomic-function.test.ts`, `development-order.test.ts` |
| Non-functional (NFR-01..NFR-11) | 22 | `compaction.test.ts`, `index.test.ts`, `doctor.test.ts`, `build.test.ts`, `handoff.test.ts`, `package-manifest.test.ts`, `docs.test.ts` |
| **Total** | **163** | **19 test files** |

Every requirement in `Doc/RTM_Pi-Velpari.md` has at least one TC. Every TC references a requirement. No orphan TCs.

---

## 28. Discussion 4-agent pattern (FR-26) — 5 cases

**Test file:** `pi-extension/test/discuss.test.ts` (extended)

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-111 | Discussion spawns all 4 expected subagents | New run at discussing | Mock LLM records subagent calls | extractor, prd-checker, rtm-checker, decision-agent each called once | FR-26 | P1 |
| TC-112 | Subagents run in parallel (not sequential) | TC-111 setup | Time the calls | Total time < 2× single-call latency | FR-26 | P2 |
| TC-113 | DECISION AGENT classifies user input correctly | TC-111 setup with mock answers | Inspect verdict | Verdict has newFRs/updatedFRs/newHelpers/newAtomics categorized correctly | FR-27 | P1 |
| TC-114 | Helper function dedup by name + filePath works | TC-111 setup with mock PRD containing HF-01 | Discussion re-runs proposing same helper | Verdict classifies as updatedHelpers, not newHelpers | FR-27 | P1 |
| TC-115 | Auto-update PRD adds new FR-Ns on /velpari-approve | TC-113 setup with verdict containing newFR-99 | Run /velpari-approve | Doc/PRD_Pi-Velpari.md has FR-99 row added | FR-28 | P1 |

## 29. Helper functions in PRD (FR-30) — 3 cases

**Test file:** `pi-extension/test/rtm.test.ts` and `pi-extension/test/state.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-126 | PRD's `## Helper Functions` section is preserved across approves | Discussion auto-update adds HF-01 | Re-run /velpari-approve | HF-01 entry remains in PRD | FR-30 | P1 |
| TC-127 | RTM Implementation column references HF-NN ids | RTM built with helper function references | Inspect table cells | Cells contain `HF-NN` format, not `path:func()` | FR-30 | P1 |
| TC-128 | Helper function dedup uses normalized path (forward slashes) | Discussion input has `src\utils\helper.ts` | Run dedup | Match found with `src/utils/helper.ts` | FR-30 | P2 |

## 30. Atomic-function stage (FR-31) — 7 cases

**Test file:** `pi-extension/test/atomic-function.test.ts` (new)

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-129 | Stage spawns all 4 AF scouts in parallel | State at proposing-atomic-functions; completed docs exist | Call runAtomicFunction | afScout1, afScout2, afScout3, afScout4 each called once | FR-31, FR-35 | P1 |
| TC-130 | Each AF scout reads its designated doc | TC-129 setup | Inspect scout calls | afScout1 reads RTM, afScout2 reads pseudocode, afScout3 reads PRD, afScout4 reads test-cases | FR-35 | P1 |
| TC-131 | Suggestions are merged and deduplicated | TC-129 setup; 2 scouts propose same atomic | Call mergeSuggestions | Single merged entry with combined source | FR-31 | P1 |
| TC-132 | Picker renders suggestions and returns accepted list | TC-129 setup; mock picker returns subset | Call renderSuggestionPicker | Returned list matches picked subset | FR-31 | P1 |
| TC-133 | Published doc only contains accepted suggestions | TC-132 setup | Call writeAtomicFunctions | Doc/atomic-functions.md has only accepted entries | FR-31 | P1 |
| TC-134 | Working copy written before /velpari-approve | TC-129 setup with accepted entries | Call runAtomicFunction | Working copy at .IDE_Plans/velpari/runs/<id>/atomic-function/atomic-functions.md | FR-21, FR-31 | P1 |
| TC-135 | /velpari-approve advances state to atomic-functions-proposed | TC-134 setup | Call handleApprove | State.currentStage === "atomic-functions-proposed" | FR-31 | P1 |

## 31. Development-order stage (FR-32) — 7 cases

**Test file:** `pi-extension/test/development-order.test.ts` (new)

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-136 | Stage spawns all 4 DO scouts in parallel | State at proposing-development-order; completed docs exist | Call runDevelopmentOrder | doScout1, doScout2, doScout3, doScout4 each called once | FR-32, FR-36 | P1 |
| TC-137 | Each DO scout reads its designated doc | TC-136 setup | Inspect scout calls | doScout1 reads RTM + design, doScout2 reads feasibility + design, doScout3 reads test-plan, doScout4 reads PRD | FR-36 | P1 |
| TC-138 | Rankings are merged via average rank | TC-136 setup with mock rankings | Call mergeRankings | Average rank per FR-NN, sorted ascending | FR-36 | P1 |
| TC-139 | Order picker lets user drag-reorder | TC-138 setup; mock picker reorders | Call renderOrderPicker | Returned list matches user reorder | FR-32 | P1 |
| TC-140 | Published doc only contains final accepted order | TC-139 setup | Call writeDevelopmentOrder | Doc/development-order.md has reordered list | FR-32 | P1 |
| TC-141 | Working copy written before /velpari-approve | TC-136 setup with accepted order | Call runDevelopmentOrder | Working copy at .IDE_Plans/velpari/runs/<id>/development-order/development-order.md | FR-21, FR-32 | P1 |
| TC-142 | /velpari-approve advances state to development-order-proposed | TC-141 setup | Call handleApprove | State.currentStage === "development-order-proposed" | FR-32 | P1 |

## 32. Helper ↔ atomic dependency (FR-33) — 5 cases

**Test file:** `pi-extension/test/state.test.ts` and `pi-extension/test/doctor.test.ts`

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-143 | Helper function entry stores callsAtomic references | Helper declared with callsAtomic: ["AF-01"] | Inspect helper entry | callsAtomic array preserved | FR-33 | P1 |
| TC-144 | Atomic function entry stores calledByHelpers references | Atomic declared with calledByHelpers: ["HF-01"] | Inspect atomic entry | calledByHelpers array preserved | FR-33 | P1 |
| TC-145 | Doctor flags unidirectional references | Helper points to AF-01, but AF-01 doesn't list helper | Run doctor | Report flags asymmetry | FR-33 | P1 |
| TC-146 | Doctor flags atomic functions not called by anyone | Doc/atomic-functions.md has AF-99, no helper references it | Run doctor | Report flags AF-99 as orphan atomic | FR-33 | P2 |
| TC-147 | Atomic functions cannot call other atomic functions | Proposed atomic AF-NN with callsAtomic field | Run merge | Field stripped or rejected | FR-33 | P1 |

## 33. Optional artifact handoff (FR-34) — 3 cases

**Test file:** `pi-extension/test/handoff.test.ts` (extended)

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-148 | Handoff includes atomic-functions.md when present | Both atomic-functions.md and development-order.md exist | Run handoff | architect-inputs.json documents array has both Atomic Functions and Development Order entries | FR-34 | P1 |
| TC-149 | Handoff proceeds without atomic-functions.md when missing | Only core artifacts; atomic-functions.md does not exist | Run handoff | architect-inputs.json documents array does NOT have Atomic Functions entry | FR-34 | P1 |
| TC-150 | Handoff warns when Senai doesn't recognize new document types | Senai source modified to not accept "Atomic Functions" | Run handoff | Result.warnings contains "Senai may not recognize document type 'Atomic Functions'" | FR-34, NFR-08 | P2 |

## 34. Scout agent architecture (NFR-11) — 3 cases

**Test file:** `pi-extension/test/scouts.test.ts` (new) — covers all 12 scout agents

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-161 | Stages 2–7 do not spawn subagents | Each stage handler called | Inspect mock for subagent API calls | Zero subagent calls in stages 2–7 | NFR-02, NFR-11 | P1 |
| TC-162 | Discussion stage spawns exactly 4 subagents with correct names | New run, call discuss | Inspect mock | 4 calls: extractor, prd-checker, rtm-checker, decision-agent | NFR-11 | P1 |
| TC-163 | Atomic-function and development-order stages spawn 4 scouts each | Both stages run | Inspect mock | 4 + 4 = 8 calls with correct scout names (AF-SCOUT-1..4, DO-SCOUT-1..4) | NFR-11 | P1 |

---

## 35. Per-command gate and doc scope (FR-43, FR-44, NFR-12, FR-45..FR-48)

**Test file:** `pi-extension/test/commands.test.ts` (extended) + `pi-extension/test/gate.test.ts` (new)

### Gate failure tests (one per stage command)

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-167 | `/velpari-prd` gate fails when `Doc/discussion-notes.md` missing | Fresh project, no Doc/ | Run handler | Error thrown; specific message names the missing file; no LLM call | FR-44 | P1 |
| TC-168 | `/velpari-rtm` gate fails when `Doc/PRD_Pi-Velpari.md` missing | Only discussion-notes exists | Run handler | Error thrown; message names PRD | FR-44 | P1 |
| TC-169 | `/velpari-feasibility` gate fails when either PRD or RTM missing | One of two exists | Run handler | Error thrown; message names the missing one | FR-44 | P1 |
| TC-170 | `/velpari-design` gate fails when RTM missing | Only PRD exists | Run handler | Error thrown | FR-44 | P1 |
| TC-171 | `/velpari-pseudocode` gate fails when design missing | PRD + RTM exist, no design | Run handler | Error thrown | FR-44 | P1 |
| TC-172 | `/velpari-testplan` gate fails when pseudocode missing | PRD + RTM + design exist, no pseudocode | Run handler | Error thrown | FR-44 | P1 |
| TC-173 | `/velpari-atomic-function` gate fails when test-cases missing | All others exist | Run handler | Error thrown | FR-44 | P1 |
| TC-174 | `/velpari-development-order` gate fails when any required input missing | All except RTM exist | Run handler | Error thrown | FR-44 | P1 |
| TC-175 | `/velpari-handoff` gate fails when Doc/ is empty | No published artifacts | Run handler | Error thrown | FR-44 | P1 |

### Gate success tests

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-176 | `/velpari-prd` gate passes when `Doc/discussion-notes.md` exists and non-empty | Discussion published | Run handler | No error; stage module runs | FR-43, FR-44 | P1 |
| TC-177 | `/velpari-rtm` gate passes when PRD exists and non-empty | PRD published | Run handler | No error | FR-43, FR-44 | P1 |
| TC-178 | `/velpari-testplan` gate passes when all 4 inputs exist | All published | Run handler | No error | FR-43, FR-44 | P1 |

### Gate empty-file behavior

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-179 | Gate fails when required file is empty (0 bytes) | PRD exists but is 0 bytes | Run `/velpari-rtm` | Error thrown; message says "file is empty" | FR-44 | P1 |
| TC-180 | Gate fails when required file is whitespace-only | PRD exists but only `\n` | Run `/velpari-rtm` | Error thrown; file is non-empty by stat but whitespace by content | FR-44 | P2 |

### COMMAND_SCOPE declarative table

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-181 | `COMMAND_SCOPE` exists and contains all 22 commands | Read commands.ts | Inspect table | All 22 commands have a scope entry | FR-43, NFR-12 | P1 |
| TC-182 | `COMMAND_SCOPE` matches the sequence doc §11 table | Both exist | Diff | No drift between docs | NFR-12 | P1 |

### Sub-agent inventory (FR-45)

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-183 | Sequence doc §10 lists 3 commands that use sub-agents | Read sequence doc | Inspect | Discuss, atomic-function, development-order are listed; stages 2–7 are NOT listed | FR-45 | P1 |

### Architecture decisions (FR-46, FR-47, FR-48)

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-184 | `Doc/architecture-discussion.md` exists | Check filesystem | `fs.existsSync` | File exists | FR-46 | P1 |
| TC-185 | `architecture-discussion.md` has a "Pending decisions" section | TC-184 | Read doc | Section exists with at least 5 pending items | FR-46 | P1 |
| TC-186 | `architecture-discussion.md` makes no recommendations | TC-184 | Read doc | No "we recommend" or "should use" sentences | FR-46 | P1 |
| TC-187 | No `/velpari-architect` command registered | Read `commands.ts` | grep | Zero matches | FR-47 | P1 |
| TC-188 | `commands.ts` exports `velpari-prd` and `velpari-rtm` as separate commands | Read `commands.ts` | Inspect | Both registered separately | FR-48 | P1 |

---

## 36. v1.5: Framework + web search + uniform subagent pattern

**Test file:** `pi-extension/test/framework.test.ts` (new), `pi-extension/test/scout.test.ts` (new)

### Framework handling (FR-49, FR-57)

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-189 | `/velpari-configure-inputs` prompts for framework/language/libraries/runtime | Fresh project | Run command | Picker UI shows framework options; user can select or type custom | FR-49 | P1 |
| TC-190 | `framework` field in `files.json` is validated; missing → error | Files written without `framework` | Run any stage command | Error: "Framework not configured. Run /velpari-configure-inputs." | FR-57 | P1 |

### Discussion 4-agent pattern (FR-50..FR-53)

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-191 | Discussion spawns 3 always-on scouts (NEW EXTRACTOR, PRD CHECKER, RTM CHECKER) | New run, web search declined | Call runDiscuss | 3 spawnScout calls; no web-search call | FR-50, FR-52 | P1 |
| TC-192 | Main handler performs DECISION AGENT logic after scouts return | TC-191 setup | Inspect mergeAndClassify output | Verdict has newFRs/updatedFRs/newHelpers/updatedHelpers | FR-51 | P1 |
| TC-193 | Web search activation prompt is shown to user | Multi-turn interview completed | Inspect UI flow | "Do you want me to search the web?" prompt is shown | FR-52 | P1 |
| TC-194 | WEB SEARCH AGENT scope includes community, official docs, similar projects | User opted in | Inspect skill markdown or output | Output references community/official/similar | FR-53 | P1 |

### Uniform subagent pattern (FR-54, FR-56, NFR-13)

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-195 | `ScoutContract` interface defined in `pi-extension/src/contracts.ts` | Read source | Inspect | Interface has scoutId, stageName, inputSchema, outputSchema, timeoutMs | FR-56, NFR-13 | P1 |
| TC-196 | All 12 scout files exist at `skills/scouts/{scoutId}.md` | Read filesystem | List files | 12 files: extractor, prd-checker, rtm-checker, web-search, af-scout-1..4, do-scout-1..4 | FR-54, FR-56 | P1 |
| TC-197 | `spawnScout()` enforces 30-second timeout uniformly | Mock LLM with slow response | Call spawnScout | Throws after 30s; no scout can exceed timeout | FR-54, NFR-13 | P1 |
| TC-198 | All scout outputs follow the `{ proposals: [...], source: ScoutId }` envelope | Mock LLM returns various shapes | Call spawnScout | Output is normalized to envelope; missing fields throw | FR-54, NFR-13 | P1 |

### TUI independence (FR-55)

| TC ID | Description | Preconditions | Steps | Expected Result | RTM Req ID | Priority |
|---|---|---|---|---|---|---|
| TC-199 | `package.json` does not list Senai as a dependency | Read package.json | Inspect | Zero matches for `Pi-Orchestra_v4` in dependencies/peerDependencies | FR-55 | P1 |
| TC-200 | Velpari's `pi-extension/src/` has no `import` from Senai's source | Grep source files | Match `from ".*Pi-Orchestra_v4"` | Zero matches | FR-55 | P1 |

---

*This document is consumed by Phase A–E implementation (each test is written alongside its module) and by `pi-extension/src/doctor.ts` (audit-time verification that every RTM row has at least one test case).*
