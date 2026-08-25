# Pi-Velpari Requirements Traceability Matrix (RTM)

- **Project:** Pi-Velpari
- **Source PRD:** `Doc/PRD.md` (v1.7)
- **Status:** All requirements **Planned** — v1.3 includes the post-pipeline atomic-function and development-order stages. Implementation is Phase A–E of `pi_velpari_commands_plan_20260824_0924_v1.3.md`.
- **Format:** industry-standard RTM with `Req ID | Description | Source / PRD Section | Design Element | Implementation / Helper Function | Test Case ID | Status`.

---

## 1. How to read this document

- **Req ID** — stable functional or non-functional requirement identifier from `Doc/PRD.md` §4 and §5.
- **Description** — short, single-line summary.
- **Source / PRD Section** — points to the section in `Doc/PRD.md` where the requirement is defined.
- **Design Element** — points to the design component in `Doc/design.md` that satisfies the requirement.
- **Implementation / Helper Function** — the source file path and exported function that implements the requirement. Format: `path/to/file.ts:exportName()`.
- **Test Case ID** — references test cases in `Doc/test-cases.md`. Format: `TC-NNN` (single) or `TC-NNN..TC-MMM` (range).
- **Status** — `Planned` (designed, not implemented), `Approved` (designed and approved for implementation), `Implemented` (Phase A–E shipped and verified by tests).

Every requirement in `Doc/PRD.md` appears in this RTM with at least one row. Every design element in `Doc/design.md` is referenced by at least one row. Every test case in `Doc/test-cases.md` traces back to a row here.

---

## 2. Stage commands (FR-01 through FR-07)

| Req ID | Description | Source / PRD Section | Design Element | Implementation / Helper Function | Test Case ID | Status |
|---|---|---|---|---|---|---|
| FR-01 | Interactive multi-turn discussion with 4 parallel subagents (NEW EXTRACTOR, PRD CHECKER, RTM CHECKER, DECISION AGENT); captures raw user input, classifies against existing PRD/RTM, auto-updates PRD on approve | PRD §4.1 | Design §3.1 (Discussion stage module) | `pi-extension/src/discuss.ts:runDiscuss()` + 4 subagents | TC-001..TC-005 | Planned |
| FR-02 | Full rewrite of PRD from scratch; optional since v1.2 (discussion auto-updates PRD via FR-28); use for major pivots | PRD §4.1 | Design §3.2 (PRD stage module) | `pi-extension/src/prd.ts:runPrd()` | TC-006..TC-010 | Planned |
| FR-03 | Derive RTM from approved PRD; user maps each requirement to design / helper / test case | PRD §4.1 | Design §3.3 (RTM stage module) | `pi-extension/src/rtm.ts:runRtm()` | TC-011..TC-015 | Planned |
| FR-04 | Five-dimension feasibility analysis with Go / Conditional Go / No-Go verdict | PRD §4.1 | Design §3.4 (Feasibility stage module) | `pi-extension/src/feasibility.ts:runFeasibility()` | TC-016..TC-020 | Planned |
| FR-05 | High-level design document with modules, data model, contracts, data flow | PRD §4.1 | Design §3.5 (Design stage module) | `pi-extension/src/design.ts:runDesign()` | TC-021..TC-025 | Planned |
| FR-06 | Algorithmic pseudocode per design module with inputs, outputs, pre/postconditions | PRD §4.1 | Design §3.6 (Pseudocode stage module) | `pi-extension/src/pseudocode.ts:runPseudocode()` | TC-026..TC-030 | Planned |
| FR-07 | Test plan and test cases table traced to RTM requirements | PRD §4.1 | Design §3.7 (Test plan stage module) | `pi-extension/src/testplan.ts:runTestPlan()` | TC-031..TC-035 | Planned |

---

## 3. Discipline commands (FR-08 through FR-13)

| Req ID | Description | Source / PRD Section | Design Element | Implementation / Helper Function | Test Case ID | Status |
|---|---|---|---|---|---|---|
| FR-08 | Approve working copy, publish to Doc/, advance state, optionally auto-launch next stage | PRD §4.2 | Design §4.1 (Approval flow) | `pi-extension/src/commands.ts:handleApprove()` + `pi-extension/src/state.ts:advanceStage()` | TC-036..TC-040 | Planned |
| FR-09 | Display run id, mission, current stage, completed stages, artifact paths | PRD §4.2 | Design §4.2 (Status display) | `pi-extension/src/commands.ts:handleStatus()` + `pi-extension/src/state.ts:loadState()` | TC-041..TC-043 | Planned |
| FR-10 | Discard current run (state.json and run dir) with confirmation prompt | PRD §4.2 | Design §4.3 (Reset flow) | `pi-extension/src/commands.ts:handleReset()` + `pi-extension/src/state.ts:clearRun()` | TC-044..TC-046 | Planned |
| FR-11 | Categorize input docs and output paths; write `.pi/velpari/files.json` | PRD §4.2 | Design §4.4 (Configuration) | `pi-extension/src/config.ts:runFilesDiscovery()` + `pi-extension/src/config.ts:saveFilesConfig()` | TC-047..TC-050 | Planned |
| FR-12 | Audit setup, validate artifacts, secret scan, save report to `.IDE_Plans/velpari/doctor-report.md` | PRD §4.2 | Design §4.5 (Doctor) | `pi-extension/src/doctor.ts:runDoctor()` | TC-051..TC-055 | Planned |
| FR-13 | Package approved artifacts into `.pi/senai/architect-inputs.json` matching Senai's schema | PRD §4.2 | Design §4.6 (Handoff) | `pi-extension/src/handoff.ts:runHandoff()` | TC-056..TC-060 | Planned |

---

## 4. View commands (FR-14 through FR-20)

All seven view commands share a single helper function, parameterized by stage name.

| Req ID | Description | Source / PRD Section | Design Element | Implementation / Helper Function | Test Case ID | Status |
|---|---|---|---|---|---|---|
| FR-14 | Print `Doc/discussion-notes.md` if present, else "stage not reached" | PRD §4.3 | Design §5.1 (View layer) | `pi-extension/src/show.ts:showStage("discuss", rootDir)` | TC-061..TC-062 | Planned |
| FR-15 | Print `Doc/PRD_Pi-Velpari.md` if present, else "stage not reached" | PRD §4.3 | Design §5.1 (View layer) | `pi-extension/src/show.ts:showStage("prd", rootDir)` | TC-063..TC-064 | Planned |
| FR-16 | Print `Doc/RTM_Pi-Velpari.md` if present, else "stage not reached" | PRD §4.3 | Design §5.1 (View layer) | `pi-extension/src/show.ts:showStage("rtm", rootDir)` | TC-065..TC-066 | Planned |
| FR-17 | Print `Doc/feasibility-study.md` if present, else "stage not reached" | PRD §4.3 | Design §5.1 (View layer) | `pi-extension/src/show.ts:showStage("feasibility", rootDir)` | TC-067..TC-068 | Planned |
| FR-18 | Print `Doc/design.md` if present, else "stage not reached" | PRD §4.3 | Design §5.1 (View layer) | `pi-extension/src/show.ts:showStage("design", rootDir)` | TC-069..TC-070 | Planned |
| FR-19 | Print `Doc/pseudocode.md` if present, else "stage not reached" | PRD §4.3 | Design §5.1 (View layer) | `pi-extension/src/show.ts:showStage("pseudocode", rootDir)` | TC-071..TC-072 | Planned |
| FR-20 | Print `Doc/test-plan.md` and `Doc/test-cases.md` if present, else "stage not reached" | PRD §4.3 | Design §5.1 (View layer) | `pi-extension/src/show.ts:showStage("testplan", rootDir)` | TC-073..TC-074 | Planned |

---

## 5. Cross-cutting functional requirements (FR-21 through FR-25)

| Req ID | Description | Source / PRD Section | Design Element | Implementation / Helper Function | Test Case ID | Status |
|---|---|---|---|---|---|---|
| FR-21 | Working copy lives in `.IDE_Plans/velpari/runs/<run-id>/<stage>/`; published copy lives in `Doc/`; only `/velpari-approve` writes the published copy; covers atomic-function and development-order stages too | PRD §4.4 | Design §6.1 (Copy model) | `pi-extension/src/state.ts:publishToDoc()` (called from `commands.ts:handleApprove()`) | TC-075..TC-078 | Planned |
| FR-22 | Zero-hallucination: every artifact claim traces to a user statement or earlier approved artifact; verified by cross-reference in doctor | PRD §4.4 | Design §6.2 (Traceability) | Enforced by stage skill markdown (`skills/velpari-*.md`) and verified by `pi-extension/src/doctor.ts:runDoctor()` | TC-079..TC-082 | Planned |
| FR-23 | Preview-then-save: no `Doc/` write without explicit user confirmation | PRD §4.4 | Design §6.3 (Confirm gate) | Stage modules render preview via `pi-extension/src/prompt.ts:buildStagePrompt()` and call `pi-extension/src/state.ts:publishToDoc()` only after confirm | TC-083..TC-085 | Planned |
| FR-24 | Stage transitions enforced by `STAGE_TRANSITIONS` table; manual override not supported | PRD §4.4 | Design §6.4 (Transition table) | `pi-extension/src/constants.ts:STAGE_TRANSITIONS` + `pi-extension/src/state.ts:advanceStage()` | TC-086..TC-088 | Planned |
| FR-25 | State persisted to `.IDE_Plans/velpari/state.json` after every operation; state file is the source of truth | PRD §4.4 | Design §6.5 (Persistence) | `pi-extension/src/state.ts:saveState()` + `pi-extension/src/state.ts:loadState()` | TC-089..TC-091 | Planned |

---

## 5b. Discussion-stage cross-cutting (FR-26 through FR-30, added in v1.2)

| Req ID | Description | Source / PRD Section | Design Element | Implementation / Helper Function | Test Case ID | Status |
|---|---|---|---|---|---|---|
| FR-26 | Discussion stage spawns 4 parallel subagents (NEW EXTRACTOR, PRD CHECKER, RTM CHECKER, DECISION AGENT) | PRD §4.4 | Design §3.1 (Discussion stage) | `pi-extension/src/discuss.ts:runDiscuss()` (coordinates 4 subagents) | TC-111..TC-115 | Planned |
| FR-27 | DECISION AGENT dedupes helper functions by `name + file path`; classifies user input as new FR, update, helper update, or new helper | PRD §4.4 | Design §3.1 (Decision Agent) | `pi-extension/src/discuss.ts:decisionAgent()` | TC-116..TC-120 | Planned |
| FR-28 | Auto-update PRD on `/velpari-approve`: new FR-Ns added to Functional Requirements; existing FR-Ns updated; new helpers appended to `## Helper Functions` | PRD §4.4 | Design §3.1 (Auto-update flow) | `pi-extension/src/state.ts:applyDecisionVerdict()` | TC-121..TC-124 | Planned |
| FR-29 | `/velpari-prd` retained only for full rewrite; not the primary path for materializing discussion into PRD | PRD §4.4 | Design §3.2 (PRD stage module) | `pi-extension/src/prd.ts:runPrd()` | TC-125 | Planned |
| FR-30 | Helper functions defined in PRD's `## Helper Functions` section with `HF-NN` id; RTM references `HF-NN` ids | PRD §4.4 | Design §3 (Data Model) | PRD schema in `Doc/PRD.md` template; RTM stage writes `HF-NN` references | TC-126..TC-128 | Planned |

---

## 5c. Atomic-function and development-order stages (FR-31 and FR-32, added in v1.3)

| Req ID | Description | Source / PRD Section | Design Element | Implementation / Helper Function | Test Case ID | Status |
|---|---|---|---|---|---|---|
| FR-31 | `/velpari-atomic-function` post-pipeline stage with 4 scout agents; produces `Doc/atomic-functions.md` after user reviews suggestions | PRD §4.1 | Design §3.8 (Atomic-function stage) | `pi-extension/src/atomic-function.ts:runAtomicFunction()` + 4 AF-SCOUT agents | TC-129..TC-135 | Planned |
| FR-32 | `/velpari-development-order` post-pipeline stage with 4 scout agents; produces `Doc/development-order.md` after user reviews suggestions | PRD §4.1 | Design §3.9 (Development-order stage) | `pi-extension/src/development-order.ts:runDevelopmentOrder()` + 4 DO-SCOUT agents | TC-136..TC-142 | Planned |

---

## 5d. Helper ↔ atomic and handoff (FR-33 through FR-36, added in v1.3)

| Req ID | Description | Source / PRD Section | Design Element | Implementation / Helper Function | Test Case ID | Status |
|---|---|---|---|---|---|---|
| FR-33 | Helper functions may call atomic functions; dependency recorded bidirectionally (`helper → calls atomic: AF-NN`, `atomic → called by helper: HF-NN`); atomic functions are strictly leaf nodes | PRD §4.4 | Design §3 (Data Model) | PRD schema enforces bidirectional refs; `pi-extension/src/doctor.ts` cross-checks | TC-143..TC-147 | Planned |
| FR-34 | Handoff includes optional artifacts (`Doc/atomic-functions.md`, `Doc/development-order.md`) when they exist | PRD §4.4 | Design §4.6 (Handoff) | `pi-extension/src/handoff.ts:runHandoff()` checks file existence before including | TC-148..TC-150 | Planned |
| FR-35 | AF-SCOUT agents: helper splitter, duplicate pattern finder, requirement helper, test helper | PRD §4.4 | Design §3.8 (AF scouts) | 4 functions in `pi-extension/src/atomic-function.ts` | TC-151..TC-155 | Planned |
| FR-36 | DO-SCOUT agents: dependency sort, risk priority, test priority, user value; weighted merge with user resolving conflicts | PRD §4.4 | Design §3.9 (DO scouts) | 4 functions in `pi-extension/src/development-order.ts` | TC-156..TC-160 | Planned |

---

## 5e. Per-command doc scope and gate (FR-43 through FR-48, added in v1.4)

| Req ID | Description | Source / PRD Section | Design Element | Implementation / Helper Function | Test Case ID | Status |
|---|---|---|---|---|---|---|
| FR-43 | Per-command doc scope: each stage command declares reads (Doc/ artifacts) and writes | PRD §4.4 | Design §3.7 (Doc scope) | `pi-extension/src/commands.ts:COMMAND_SCOPE` (declarative table per command) | TC-167..TC-170 | Planned |
| FR-44 | Per-command gate enforcement: pre-LLM check that all required input docs exist and are non-empty; clear error on failure | PRD §4.4 | Design §3.7 (Gate) | `pi-extension/src/commands.ts:checkDocScope(command, rootDir): void` | TC-171..TC-175 | Planned |
| FR-45 | Sub-agent inventory documented: 3 commands use sub-agents today (discuss, atomic-function, development-order); 12 scouts total; no auto-generation in v1.x | PRD §4.4 | Sequence §10 (Scout pattern); PRD Glossary | Inventory lives in `Doc/velpari-sequence.md` §10; no code function | TC-176..TC-178 | Planned |
| FR-46 | Architecture discussion doc exists: `Doc/architecture-discussion.md` studies pi, senai, community patterns; lists pending decisions; no recommendations | PRD §4.4 | New doc | File presence; pending decisions list | TC-179..TC-181 | Planned |
| FR-47 | No architecture command in Velpari: documented explicitly; rationale is "Velpari is pre-production; Senai handles architecture" | PRD §4.4 | Design §7 (Architecture decisions) | No code (negative requirement); grep for `/velpari-architect` in `pi-extension/src/commands.ts` returns no matches | TC-182 | Planned |
| FR-48 | PRD and RTM remain separate stages: rationale is "different audiences, different review cycles" | PRD §4.4 | Stage map in `constants.ts:STAGE_TRANSITIONS` | Separate transition states (`drafting-prd` vs `building-rtm`) | TC-183 | Planned |

---

## 5f. Framework + web search + uniform subagent pattern (FR-49..FR-57, added in v1.5)

| Req ID | Description | Source / PRD Section | Design Element | Implementation / Helper Function | Test Case ID | Status |
|---|---|---|---|---|---|---|
| FR-49 | Framework is one-time setup in `/velpari-configure-inputs`; stored in `.pi/velpari/files.json` under `framework`; injected into every stage prompt | PRD §4.4 | Design §3.8 (Framework handling) | `pi-extension/src/config.ts:runFilesDiscovery()` extended; `pi-extension/src/prompt.ts:buildStagePrompt()` injects framework | TC-189..TC-190 | Planned |
| FR-50 | Discussion stage has 4 scout agents: NEW EXTRACTOR, PRD CHECKER, RTM CHECKER, WEB SEARCH AGENT | PRD §4.4 | Design §2.9 + Pseudocode §13 | `pi-extension/src/discuss.ts:runDiscuss()` coordinates 4 scouts | TC-191 | Planned |
| FR-51 | DECISION AGENT logic (helper function dedup, classification) moves to main handler | PRD §4.4 | Design §7.8 (Architecture decisions) | `pi-extension/src/discuss.ts:mergeAndClassify()` runs in main handler after scouts | TC-192 | Planned |
| FR-52 | WEB SEARCH AGENT is user-prompted (yes/no after interview) | PRD §4.4 | Pseudocode §13.2 | `pi-extension/src/discuss.ts:promptForWebSearch()` | TC-193 | Planned |
| FR-53 | WEB SEARCH AGENT scope: community + official docs + similar projects | PRD §4.4 | Pseudocode §13.2 | Skill markdown `skills/scouts/web-search.md` defines scope | TC-194 | Planned |
| FR-54 | All 12 scout agents follow the `ScoutContract` (same spawn, JSON envelope, timeout, picker UI) | PRD §4.4 | Design §2.20 (contracts.ts) | `pi-extension/src/contracts.ts:ScoutContract`; `pi-extension/src/scout.ts:spawnScout()` | TC-195..TC-197 | Planned |
| FR-55 | Velpari does NOT depend on Senai at runtime | PRD §4.4 (constraint) | Design §3.9 (TUI independence) | `package.json` does not list Senai; TUI re-implemented in `pi-extension/src/ui/` | TC-198 | Planned |
| FR-56 | `ScoutContract` interface defined in `pi-extension/src/contracts.ts`; all scout modules import it; scout files at `skills/scouts/{scoutId}.md` | PRD §4.4 | Design §2.20 | New file `pi-extension/src/contracts.ts` | TC-195 | Planned |
| FR-57 | `framework` field in `files.json` validated by `config.ts:validateFilesConfig` | PRD §4.4 | Design §3.8 | `pi-extension/src/config.ts:validateFilesConfig()` extended | TC-189 | Planned |

---

## 5g. Approval command split (FR-58..FR-61, added in v1.6)

| Req ID | Description | Source / PRD Section | Design Element | Implementation / Helper Function | Test Case ID | Status |
|---|---|---|---|---|---|---|
| FR-58 | `/velpari-approve-discuss` command: publishes `Doc/discussion-notes.md` and auto-invokes `/velpari-prd` | PRD §4.4 | Design §2.23 (discuss-approve.ts) | `pi-extension/src/commands.ts:handleApproveDiscuss()` | TC-201..TC-203 | Planned |
| FR-59 | `/velpari-approve` scope restricted to stages 2–7; errors when in discussion stage | PRD §4.4 | Design §3.10 (Approval model) | `pi-extension/src/commands.ts:handleApprove()` checks `state.currentStage` | TC-204..TC-205 | Planned |
| FR-60 | Stage-aware approval hint: UI suggests correct approve command based on `currentStage` | PRD §4.4 | Design §3.10 | `pi-extension/src/commands.ts:renderApproveHint()` | TC-206 | Planned |
| FR-61 | `/velpari-prd` is canonical PRD update path; auto-invoked by `/velpari-approve-discuss` | PRD §4.4 | Design §2.10 (prd.ts) | `pi-extension/src/prd.ts:runPrd()`; chain invoked from `handleApproveDiscuss()` | TC-207..TC-208 | Planned |

---

## 5h. Project-name output documents (FR-67..FR-71, added in v1.7)

| Req ID | Description | Source / PRD Section | Design Element | Implementation / Helper Function | Test Case ID | Status |
|---|---|---|---|---|---|---|
| FR-67 | `projectName` captured in `/velpari-configure-inputs`; persisted in `.pi/velpari/files.json` (v3); validated by `config.ts:validateFilesConfig` | PRD §4.4 | Design §3.2 (files.json v3) | `pi-extension/src/config.ts:runFilesDiscovery()` | TC-209..TC-210 | Planned |
| FR-68 | Output docs use `projectName` suffix: `Doc/PRD_{projectName}.md`, `Doc/RTM_{projectName}.md`, etc. | PRD §4.4 | Design §3.10 (Output naming) | `pi-extension/src/paths.ts:buildOutputPath(stage, projectName)` | TC-211..TC-215 | Planned |
| FR-69 | Discussion output is per-topic: `Doc/discussion-{topic-slug}.md` for first run; timestamp suffix for subsequent | PRD §4.4 | Design §3.10 | `pi-extension/src/paths.ts:buildDiscussionPath(topic, timestamp?)` | TC-216..TC-217 | Planned |
| FR-70 | `topic-slug` derived from `/velpari-discuss <mission>` argument via slugification (lowercase, hyphens, no special chars) | PRD §4.4 | Design §3.10 | `pi-extension/src/paths.ts:slugify(mission)` | TC-218 | Planned |
| FR-71 | Handoff schema uses project-suffixed document paths | PRD §4.4 | Design §3.3 | `pi-extension/src/handoff.ts:runHandoff()` | TC-219 | Planned |

---

## 6. Non-functional requirements (NFR-01 through NFR-11)

| Req ID | Description | Source / PRD Section | Design Element | Implementation / Helper Function | Test Case ID | Status |
|---|---|---|---|---|---|---|
| NFR-01 | `session_before_compact` hook supplies zero-LLM run summary; context compaction preserves run state | PRD §5 | Design §7.1 (Compaction) | `pi-extension/src/compaction.ts:buildCompactionSummary()` | TC-092..TC-094 | Planned |
| NFR-02 | Velpari does not spawn subagents in stages 2–7 or handoff; stages 1 (discuss), 8 (atomic-function), 9 (development-order) are exceptions | PRD §5 | Design §7.2 (Architecture boundary) | Extension entry `pi-extension/src/index.ts` guards against `PI_SUBAGENT_NAME` env var for stages 2–7 | TC-095 | Planned |
| NFR-03 | Project-local installation via `package.json`'s `pi.extensions` field; no global state | PRD §5 | Design §7.3 (Deployment) | `package.json` declares `"pi": { "extensions": ["pi-extension/src/index.ts"] }`; all paths are project-relative | TC-096 | Planned |
| NFR-04 | Doctor's secret scan uses a deterministic regex set; findings are warnings, not failures | PRD §5 | Design §7.4 (Secret scanning) | `pi-extension/src/doctor.ts:scanForSecrets()` with regex set for AWS keys, GitHub tokens, generic API keys, private key headers | TC-097..TC-099 | Planned |
| NFR-05 | Doctor report written to `.IDE_Plans/velpari/doctor-report.md` on every run; opens with "Setup progress" section | PRD §5 | Design §7.5 (Doctor report) | `pi-extension/src/doctor.ts:writeDoctorReport()` | TC-100..TC-101 | Planned |
| NFR-06 | TypeScript strict mode; `path.join` for paths; no in-place state mutation; thin command handlers | PRD §5 | Design §7.6 (Coding conventions) | `tsconfig.json` with `"strict": true`; convention enforced via code review in AGENTS.md §"Coding conventions" | TC-102 | Planned |
| NFR-07 | Peer dependency on `@mariozechner/pi-coding-agent` only; no runtime dependencies added | PRD §5 | Design §7.7 (Dependencies) | `package.json` declares the peer dep and no `dependencies` block | TC-103 | Planned |
| NFR-08 | Handoff output schema is compatible with Senai's `architect-inputs-config.ts`; handoff test reads Senai source to assert compatibility | PRD §5 | Design §7.8 (Cross-extension compat) | `pi-extension/src/handoff.ts:validateSenaiSchema()` | TC-104..TC-106 | Planned |
| NFR-09 | One test file per source module under `pi-extension/test/`; `node --test`; `fs.mkdtempSync` for temp dirs | PRD §5 | Design §7.9 (Testing strategy) | Each test file imports its module and uses temp directories; `npm test` script builds then runs tests | TC-107..TC-108 | Planned |
| NFR-10 | `AGENTS.md`, `README.md`, `CHANGELOG.md`, `Doc/velpari-sequence.md`, `Doc/step-by-step-guide.md` exist and accurately describe behavior | PRD §5 | Design §7.10 (Documentation) | Documents written in Phase 0 of v1.1 plan | TC-109..TC-110 | Planned |
| NFR-11 | Subagents permitted only in 3 stages: discuss (4 agents), atomic-function (4 scouts), development-order (4 scouts); total 12 scout agents; stages 2–7 and handoff MUST NOT spawn subagents | PRD §5 | Design §7.11 (Subagent exception) | Each scout agent lives in its own module function: `discuss.ts` (4 subagents), `atomic-function.ts` (4 AF scouts), `development-order.ts` (4 DO scouts) | TC-161..TC-163 | Planned |
| NFR-12 | Doc scope is the source of truth for command behavior; the PRD per-command section, sequence doc §11, design.md pseudocode, and test cases must all agree | PRD §5 | Design §3.7 (Doc scope) | `pi-extension/src/commands.ts:checkDocScope()` (deterministic gate function) | TC-164..TC-166 | Planned |
| NFR-13 | Uniform subagent pattern: all 12 scouts follow the `ScoutContract` (same spawn helper, JSON envelope, 30s timeout, picker UI); drift is a defect | PRD §5 | Design §2.20 + §7.8 | `pi-extension/src/contracts.ts:ScoutContract`; `pi-extension/src/scout.ts:spawnScout()` | TC-195..TC-198 | Planned |
| NFR-14 | Approval commands are stage-aware: `/velpari-approve-discuss` for discussion; `/velpari-approve` for stages 2–7; UI hints reflect current stage; user is never confused | PRD §5 | Design §3.10 | `pi-extension/src/commands.ts:handleApproveDiscuss()` vs `handleApprove()`; `renderApproveHint()` | TC-204..TC-206 | Planned |
| NFR-15 | Output file names are deterministic and project-derived: same `projectName` produces same file name; no "Pi-Velpari" hardcoding | PRD §5 | Design §3.10 | `pi-extension/src/paths.ts:buildOutputPath()`; tests assert naming | TC-211..TC-219 | Planned |

---

## 7. Coverage summary

| Category | Requirement count | Test case count |
|---|---|---|
| Stage commands (FR-01..FR-07, FR-31..FR-32) | 9 | 44 (TC-001..TC-035, TC-129..TC-142) |
| Discipline commands (FR-08..FR-13) | 6 | 25 (TC-036..TC-060) |
| View commands (FR-14..FR-20) | 7 | 14 (TC-061..TC-074) |
| Cross-cutting v1.1 (FR-21..FR-25) | 5 | 17 (TC-075..TC-091) |
| Cross-cutting v1.2 (FR-26..FR-30) | 5 | 18 (TC-111..TC-128) |
| Cross-cutting v1.3 (FR-33..FR-36) | 4 | 18 (TC-143..TC-160) |
| Cross-cutting v1.4 (FR-43..FR-48) | 6 | 17 (TC-167..TC-183) |
| Cross-cutting v1.5 (FR-49..FR-57) | 9 | 10 (TC-189..TC-198) |
| Cross-cutting v1.6 (FR-58..FR-61) | 4 | 8 (TC-201..TC-208) |
| Cross-cutting v1.7 (FR-67..FR-71) | 5 | 11 (TC-209..TC-219) |
| Non-functional (NFR-01..NFR-15) | 15 | 40 (TC-092..TC-110, TC-161..TC-166, TC-195..TC-198, TC-204..TC-206, TC-211..TC-219) |
| **Total** | **75** | **212** |

Every requirement has at least one test case. Every test case traces back to a requirement. No requirement is un-traced; no test case is orphan.

---

## 8. Trace-back enforcement (how this is verified at runtime)

1. **At design time:** `Doc/design.md` lists a "Design elements" section where each design element is tagged with one or more FR-N or NFR-N IDs. A design element with no tagged requirement is a defect.
2. **At code time:** each implementation file's exported function appears in the "Implementation / Helper Function" column. A function exported but not referenced in this RTM is a defect (or, conversely, a row pointing to a function that does not exist is a defect).
3. **At test time:** each test case in `Doc/test-cases.md` is tagged with a Test Case ID that matches a TC-NNN in this RTM. A test case with no RTM row is a defect.
4. **At audit time:** `pi-extension/src/doctor.ts:runDoctor()` reads this RTM and walks the dependency graph, reporting:
   - PRD requirements with no RTM row.
   - RTM rows with no test case.
   - RTM rows pointing to functions that do not exist.
   - Test cases with no PRD requirement (orphan tests).
   - Helper functions in PRD's `## Helper Functions` section that are not referenced by any FR-N.
   - Atomic functions in `Doc/atomic-functions.md` that are not called by any helper function or test case.
   - Helper ↔ atomic dependency references that are not bidirectional (helper points to atomic but atomic doesn't list the helper, or vice versa).

---

*This RTM is consumed by `Doc/design.md` (every row's "Design Element" column is a design section), `Doc/test-cases.md` (every row's "Test Case ID" column is a test case entry), and `pi-extension/src/doctor.ts` (audit-time cross-reference check).*
