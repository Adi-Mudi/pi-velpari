# Pi-Velpari Design Document

- **Project:** Pi-Velpari
- **Source PRD:** `Doc/PRD.md` v1.1
- **Source RTM:** `Doc/RTM_Pi-Velpari.md`
- **Date:** 2026-08-24
- **Status:** Design complete; implementation in Phase A–E per `pi_velpari_commands_plan_20260824_0924_v1.1.md`.

---

## 1. Overview

Pi-Velpari is a Pi extension written in TypeScript that implements a 7-stage pre-production pipeline (`discuss → prd → rtm → feasibility → design → pseudocode → testplan`) with an approval-gated state machine, a working-copy + published-copy artifact model, and a deterministic handoff to `Pi-Orchestra_v4` (pi-senai).

The design follows the discipline pattern established by Senai:

- A single source of truth for run state (`.IDE_Plans/velpari/state.json`).
- A single source of truth for stage transitions (`constants.ts:STAGE_TRANSITIONS`).
- A single source of truth for paths (`constants.ts`).
- One module per concern, with thin command handlers delegating to module functions.
- Skills (markdown) describe what each stage's LLM should do; code describes the deterministic scaffolding around it.

This document covers: module breakdown, data model, interface contracts, data flow, and how the design satisfies the non-functional requirements. Every module section lists the FR-N / NFR-N IDs it implements; every requirement in the RTM is mapped to at least one module.

---

## 2. Module Breakdown

The extension source lives under `pi-extension/src/`. Each module has a single responsibility.

### 2.1 `index.ts` — entry point

- **Purpose:** Pi extension entry. Registers commands and hooks; guards against loading inside subagent processes.
- **Implements:** NFR-02, NFR-03.
- **Key exports:**
  - `default export function (api: ExtensionAPI): void` — Pi's extension contract.
- **Behavior:**
  - Early-returns if `process.env.PI_SUBAGENT_NAME` is set (mirrors Senai's subagent guard).
  - Calls `registerCommands(api)`.
  - Registers `session_before_compact` hook that calls `compaction.ts:buildCompactionSummary`.
  - Sets up any one-time initialization.

### 2.2 `constants.ts` — single source of truth for stages and paths

- **Purpose:** Stage enum, transition table, path constants, helpers.
- **Implements:** FR-24.
- **Key exports:**
  - `enum Stage` — 15 states (`none`, `discussing`, `discussed`, `drafting-prd`, `drafted-prd`, `building-rtm`, `built-rtm`, `analyzing-feasibility`, `analyzed-feasibility`, `designing`, `designed`, `writing-pseudocode`, `wrote-pseudocode`, `planning-tests`, `planned-tests`, `handoff-ready`).
  - `const STAGE_TRANSITIONS: Record<Stage, Stage[]>` — allowed next stages from each current stage.
  - `const STATE_PATH = ".IDE_Plans/velpari/state.json"`.
  - `const RUNS_DIR = ".IDE_Plans/velpari/runs"`.
  - `const DOC_DIR = "Doc"`.
  - `const CONFIG_PATH = ".pi/velpari/files.json"`.
  - `const HANDOFF_TARGET = ".pi/senai/architect-inputs.json"`.
  - `const DOCTOR_REPORT_PATH = ".IDE_Plans/velpari/doctor-report.md"`.
  - `const STAGE_ARTIFACT_NAMES: Record<Stage, string[]>` — published artifact file names per stage.
  - `function isContentStage(s: Stage): boolean`.
  - `function isApprovedStage(s: Stage): boolean`.
  - `function nextStage(current: Stage): Stage` — throws if no allowed transition.

### 2.3 `state.ts` — run state persistence

- **Purpose:** Load, save, advance, reset, and publish state. Owns the working-copy + published-copy model.
- **Implements:** FR-21, FR-23, FR-25, NFR-06.
- **Key exports:**
  - `interface RunState { version: number; runId: string; mission: string; currentStage: Stage; history: HistoryEntry[]; updatedAt: string; }`
  - `interface HistoryEntry { stage: Stage; status: "pending" | "approved"; timestamp: string; artifactPaths: Record<string, string>; }`
  - `function loadState(rootDir: string): RunState | null` — returns null if no state file.
  - `function saveState(rootDir: string, state: RunState): void` — atomic write via temp file + rename.
  - `function createRun(rootDir: string, mission: string): RunState` — creates new state + run directory.
  - `function advanceStage(rootDir: string, state: RunState, next: Stage): RunState` — mutates stage and appends history, then saves.
  - `function clearRun(rootDir: string): void` — confirms with caller, then deletes state and run dir.
  - `function getRunDir(rootDir: string, runId: string): string`.
  - `function getStageDir(rootDir: string, runId: string, stage: Stage): string`.
  - `function publishToDoc(rootDir: string, stage: Stage, sourcePath: string): void` — copies working copy to `Doc/` per `STAGE_ARTIFACT_NAMES`. Only callable from `commands.ts:handleApprove`.

### 2.4 `prompt.ts` — stage prompt construction

- **Purpose:** Load stage skill markdown and build the prompt the LLM receives.
- **Implements:** FR-22, FR-23.
- **Key exports:**
  - `function loadStageSkill(stage: Stage): string` — reads `skills/velpari-<stage>.md` from extension package.
  - `function buildStagePrompt(args: { stage: Stage; runDir: string; publishedDir: string; mission: string; docScope: DocScope; }): string` — assembles: skill body + zero-hallucination rule + working/published paths + doc scope block + confirm-gate reminder.

### 2.5 `commands.ts` — command registration and handlers

- **Purpose:** Register all 20 `/velpari-*` commands. Each handler is thin; logic lives in stage modules and discipline modules.
- **Implements:** FR-01 through FR-20, FR-08 (approval flow), FR-09, FR-10.
- **Key exports:**
  - `function registerCommands(api: ExtensionAPI): void` — registers all 20 commands.
  - **Stage handlers** (each delegates to the per-stage module):
    - `handleDiscuss(args, api) → discuss.ts:runDiscuss()`
    - `handlePrd(args, api) → prd.ts:runPrd()`
    - `handleRtm(args, api) → rtm.ts:runRtm()`
    - `handleFeasibility(args, api) → feasibility.ts:runFeasibility()`
    - `handleDesign(args, api) → design.ts:runDesign()`
    - `handlePseudocode(args, api) → pseudocode.ts:runPseudocode()`
    - `handleTestPlan(args, api) → testplan.ts:runTestPlan()`
  - **Discipline handlers:**
    - `handleApprove(args, api) → state.ts:advanceStage() + state.ts:publishToDoc() + (optional) auto-launch next stage`
    - `handleStatus(args, api) → state.ts:loadState() + format and display`
    - `handleReset(args, api) → confirm → state.ts:clearRun()`
  - **View handlers:**
    - `handleShow(stage, args, api) → show.ts:showStage()` (parameterized over 7 stages).

### 2.6 `compaction.ts` — deterministic compaction summary

- **Purpose:** Build a zero-LLM summary for `session_before_compact` hook so context compaction never loses run state.
- **Implements:** NFR-01.
- **Key exports:**
  - `function buildCompactionSummary(event: SessionEvent, api: ExtensionAPI): string` — returns a markdown summary: run id, mission, current stage, completed stages, all artifact paths.

### 2.7 `config.ts` — configure-inputs logic

- **Purpose:** Categorize input documents and output paths. Persist to `.pi/velpari/files.json`.
- **Implements:** FR-11.
- **Key exports:**
  - `interface FilesConfig { version: 1; codePaths: string[]; inputDocuments: string[]; outputPaths: Record<Stage, string>; excludedPaths: string[]; }`
  - `function loadFilesConfig(rootDir: string): FilesConfig | null`.
  - `function saveFilesConfig(rootDir: string, config: FilesConfig): void` — atomic write.
  - `function validateFilesConfig(config: FilesConfig): string[]` — returns list of error messages (empty if valid).
  - `function runFilesDiscovery(rootDir: string): DiscoveryResult` — deep-scans project for suggested inputs (markdown files) and outputs (default paths).

### 2.8 `doctor.ts` — setup audit

- **Purpose:** Audit setup, validate artifacts, scan for secrets, write report.
- **Implements:** FR-12, NFR-04, NFR-05, NFR-08.
- **Key exports:**
  - `function runDoctor(rootDir: string): DoctorReport` — runs all checks, writes report.
  - `interface DoctorReport { setupProgress: SetupStep[]; checks: CheckResult[]; secretScan: SecretFinding[]; writtenAt: string; }`
  - `function writeDoctorReport(rootDir: string, report: DoctorReport): void`.
  - `function scanForSecrets(text: string): SecretFinding[]` — regex set for AWS keys, GitHub tokens, generic API keys, private key headers.
  - `function validateSenaiHandoffSchema(rootDir: string): string[]` — reads Senai's `architect-inputs-config.ts` to verify handoff target schema.

### 2.9–2.15 Stage modules — `discuss.ts`, `prd.ts`, `rtm.ts`, `feasibility.ts`, `design.ts`, `pseudocode.ts`, `testplan.ts`

- **Purpose:** Each implements one stage's interaction with the user and the LLM. The shape is identical across all seven:
  - Validate the previous stage is approved (FR-24).
  - Build a stage prompt via `prompt.ts:buildStagePrompt()`.
  - Drive the LLM (or interactive interview for `discuss`) to produce a working-copy artifact under `getStageDir()`.
  - Render the artifact as preview to the user.
  - Call `state.ts:advanceStage()` to mark the working copy ready for approval.
- **Each implements:** its own FR-N (FR-01 through FR-07) and FR-22, FR-23 (zero-hallucination, confirm gate).
- **Key exports per stage module:**
  - `function runXxx(args: { state: RunState; rootDir: string; api: ExtensionAPI; }): Promise<void>` — drives the stage end-to-end.
  - Optional helpers for interactive input (e.g., `discuss.ts` has `askNextQuestion`, `recordAnswer`).

### 2.16 `handoff.ts` — bridge to Senai

- **Purpose:** Read approved `Doc/` artifacts, package them into `.pi/senai/architect-inputs.json` matching Senai's expected schema. Set state to `handoff-ready`.
- **Implements:** FR-13, NFR-08.
- **Key exports:**
  - `function runHandoff(state: RunState, rootDir: string): HandoffResult`.
  - `interface HandoffResult { written: boolean; targetPath: string; documentCount: number; warnings: string[]; }`.
  - `function validateSenaiSchema(targetContent: object): string[]` — checks against schema read from Senai's `architect-inputs-config.ts`.
  - `function readApprovedArtifacts(rootDir: string): ArtifactMap` — collects all `Doc/` artifacts whose stage is `approved`.

### 2.17 `show.ts` — view commands

- **Purpose:** Print the published artifact for each stage.
- **Implements:** FR-14 through FR-20.
- **Key exports:**
  - `function showStage(stage: Stage, rootDir: string): string` — returns the file content as a string. Returns `"Stage '<stage>' not yet reached."` if the artifact is missing. Prints both `test-plan.md` and `test-cases.md` for the `testplan` stage.

### 2.18 `atomic-function.ts` — post-pipeline atomic-function stage

- **Purpose:** Optional post-pipeline stage. Spawns 4 parallel scout agents that read completed docs and propose atomic functions. User reviews suggestions in a unified picker and only accepted entries are written to `Doc/atomic-functions.md`.
- **Implements:** FR-31, FR-35.
- **Key exports:**
  - `function runAtomicFunction(args: { state: RunState; rootDir: string; api: ExtensionAPI; }): Promise<void>` — coordinates the 4 scouts and renders the suggestion picker.
  - `interface AtomicFunction { id: AF-NN; name: string; filePath: string; signature: string; purpose: string; calledByHelpers: HF-NN[]; source: AF-Scout-id; }`
  - `function afScout1(rtmPath: string): AtomicFunction[]` — AF-SCOUT-1 reads RTM's helper functions and proposes atomic splits.
  - `function afScout2(pseudocodePath: string): AtomicFunction[]` — AF-SCOUT-2 reads pseudocode and finds duplicate patterns.
  - `function afScout3(prdPath: string): AtomicFunction[]` — AF-SCOUT-3 reads PRD requirements and proposes atomic helpers per FR-N.
  - `function afScout4(testCasesPath: string): AtomicFunction[]` — AF-SCOUT-4 reads test cases and proposes atomic test helpers.
  - `function mergeSuggestions(scoutResults: AtomicFunction[][]): AtomicFunction[]` — deduplicates by `name + file path` and returns merged list.
  - `function renderSuggestionPicker(suggestions: AtomicFunction[], api: ExtensionAPI): AtomicFunction[]` — renders the picker UI, returns accepted entries.
  - `function writeAtomicFunctions(accepted: AtomicFunction[], rootDir: string): void` — writes to working copy and (on approve) published copy.

### 2.19 `development-order.ts` — post-pipeline development-order stage

- **Purpose:** Optional post-pipeline stage. Spawns 4 parallel scout agents that read completed docs and propose implementation order. User reviews and reorders.
- **Implements:** FR-32, FR-36.
- **Key exports:**
  - `function runDevelopmentOrder(args: { state: RunState; rootDir: string; api: ExtensionAPI; }): Promise<void>` — coordinates the 4 scouts and renders the order picker.
  - `interface OrderEntry { frId: FR-NN; rank: number; source: DO-Scout-id; rationale: string; }`
  - `function doScout1(rtmPath: string, designPath: string): OrderEntry[]` — DO-SCOUT-1 produces topologically sorted order.
  - `function doScout2(feasibilityPath: string, designPath: string): OrderEntry[]` — DO-SCOUT-2 produces risk-aware priority.
  - `function doScout3(testPlanPath: string): OrderEntry[]` — DO-SCOUT-3 produces test-coverage priority.
  - `function doScout4(prdPath: string): OrderEntry[]` — DO-SCOUT-4 produces user-value ranking.
  - `function mergeRankings(scoutResults: OrderEntry[][]): OrderEntry[]` — weighted merge of 4 rankings.
  - `function renderOrderPicker(ranked: OrderEntry[], api: ExtensionAPI): OrderEntry[]` — lets the user reorder and accept.
  - `function writeDevelopmentOrder(accepted: OrderEntry[], rootDir: string): void` — writes to working copy and (on approve) published copy.

### 2.20 `contracts.ts` — shared types (v1.5)

- **Purpose:** Centralize shared types so all scout modules follow the same shape. Avoids drift between the 12 scouts.
- **Implements:** FR-54, FR-56, NFR-13.
- **Key exports:**
  - `interface ScoutContract` — input/output shapes for any scout.
  - `interface ScoutOutput` — standard envelope `{ proposals: [...], source: ScoutId, warnings?: string[] }`.
  - `interface ScoutInput` — stage-specific input with skill markdown path.
  - `interface AcceptedProposal` — what the picker returns.
  - `interface FrameworkInfo` — shape of `.pi/velpari/files.json:framework` field.
  - `function spawnScout(scoutId, input, api)` — standard spawn helper with 30s timeout, JSON parsing, error handling. Used by all 12 scouts.

### 2.21 `scout.ts` — scout coordinator (v1.5)

- **Purpose:** Single point of entry for spawning any scout. Wraps `contracts.ts:spawnScout()` with stage-specific helpers.
- **Implements:** FR-54.
- **Key exports:**
  - `function spawnDiscussionScout(name, mission, answers, api)` — for the 4 discussion scouts.
  - `function spawnAfScout(name, rootDir, api)` — for the 4 AF-SCOUTs.
  - `function spawnDoScout(name, rootDir, api)` — for the 4 DO-SCOUTs.
  - `function spawnWebSearchScout(input, api)` — for the WEB SEARCH AGENT (only in discussion).

### 2.22 `ui/` — re-implemented TUI patterns (v1.5)

- **Purpose:** Velpari does NOT depend on Senai. TUI patterns (pickers, list editors) are re-implemented here using Pi's TUI primitives.
- **Implements:** FR-55.
- **Key exports:**
  - `pi-extension/src/ui/simple-picker.ts` — re-implementation of Senai's simple-picker (single-select).
  - `pi-extension/src/ui/list-editor.ts` — re-implementation of Senai's list-editor (multi-select with toggling).
  - `pi-extension/src/ui/role-picker.ts` — re-implementation of Senai's role-picker.
- **Note:** These are independent of Senai's source. They may share UX patterns but the implementations are separate. Drift over time is a known risk; tests in `pi-extension/test/ui/` lock the contract.

---

## 3. Data Model

### 3.1 `RunState` (state.json)

```ts
interface RunState {
  version: 1;
  runId: string;              // "2026-08-24-09-24-my-mission"
  mission: string;            // user-provided
  currentStage: Stage;
  history: HistoryEntry[];
  updatedAt: string;          // ISO 8601
}

interface HistoryEntry {
  stage: Stage;
  status: "pending" | "approved";
  timestamp: string;
  artifactPaths: {
    working: string;          // path relative to rootDir
    published: string;        // path relative to rootDir, empty if not yet approved
  };
}
```

**File location:** `.IDE_Plans/velpari/state.json`.

**Versioning:** v1 stable within v1.x. New versions add optional fields.

### 3.2 `FilesConfig` (files.json)

```ts
interface FilesConfig {
  version: 1;
  codePaths: string[];        // empty for Velpari — no code is read
  inputDocuments: string[];   // PRDs, NFRs, etc. the user wants Velpari to be aware of
  outputPaths: {
    discuss: string;          // "Doc/discussion-notes.md"
    prd: string;              // "Doc/PRD_Pi-Velpari.md"
    rtm: string;              // "Doc/RTM_Pi-Velpari.md"
    feasibility: string;      // "Doc/feasibility-study.md"
    design: string;           // "Doc/design.md"
    pseudocode: string;       // "Doc/pseudocode.md"
    testplan: string;         // "Doc/test-plan.md" (test-cases.md is colocated)
    atomicFunction: string;    // "Doc/atomic-functions.md" (optional stage)
    developmentOrder: string;  // "Doc/development-order.md" (optional stage)
  };
  excludedPaths: string[];    // standard ignores
}
```

**File location:** `.pi/velpari/files.json`.

### 3.3 `architect-inputs.json` (Senai-compatible handoff target)

```ts
interface ArchitectInputs {
  version: 1;
  projectName: string;        // derived from mission slug
  documents: Array<{
    path: string;             // path relative to rootDir, e.g., "Doc/PRD_Pi-Velpari.md"
    type:
      | "PRD"
      | "RTM"
      | "NFR"
      | "Test Plan"
      | "Design"
      | "Feasibility"
      | "Pseudocode"
      | "Test Cases"
      | "Atomic Functions"      // optional — only if Doc/atomic-functions.md exists
      | "Development Order";   // optional — only if Doc/development-order.md exists
  }>;
  constraints: string[];      // user-provided additional constraints, empty for v1.3
}
```

**File location:** `.pi/senai/architect-inputs.json` (written by `/velpari-handoff`).

**Schema compatibility:** handoff test reads `Pi-Orchestra_v4/pi-extension/src/architect-inputs-config.ts` and asserts that field names match. If Senai does not recognize the new document types (`Atomic Functions`, `Development Order`), the handoff logs a warning but still includes the file.

### 3.4 Helper function entry (in PRD's `## Helper Functions`)

```ts
interface HelperFunctionEntry {
  id: HF-NN;                  // "HF-01", "HF-02", ...
  name: string;               // e.g., "validateUserInput"
  filePath: string;           // planned, e.g., "src/utils/validateUserInput.ts"
  signature: string;          // planned, e.g., "validateUserInput(input: string): boolean"
  purpose: string;            // one-sentence description
  dependsOn: FR-NN[];         // FR-Ns that use this helper
  callsAtomic: AF-NN[];       // atomic functions this helper calls
}
```

### 3.5 Atomic function entry (in `Doc/atomic-functions.md`)

```ts
interface AtomicFunctionEntry {
  id: AF-NN;                  // "AF-01", "AF-02", ...
  name: string;               // e.g., "isValidEmail"
  filePath: string;           // planned, e.g., "src/utils/isValidEmail.ts"
  signature: string;          // planned
  purpose: string;            // one-sentence description
  calledByHelpers: HF-NN[];   // helper functions that call this atomic
  source: AF-Scout-id;        // which scout proposed this entry
}
```

**Atomic functions are strictly leaf nodes** — they do not call other atomic functions. The `calledByHelpers` field is the inverse of `HelperFunctionEntry.callsAtomic` and is maintained bidirectionally.

### 3.6 Run directory layout

```
.IDE_Plans/velpari/
├── state.json
├── doctor-report.md
└── runs/
    └── YYYY-MM-DD-HH-MM-<mission-slug>/
        ├── discuss/discussion-notes.md          (working copy)
        ├── prd/PRD_Pi-Velpari.md                (working copy)
        ├── rtm/RTM_Pi-Velpari.md                (working copy)
        ├── feasibility/feasibility-study.md     (working copy)
        ├── design/design.md                     (working copy)
        ├── pseudocode/pseudocode.md             (working copy)
        ├── testplan/
        │   ├── test-plan.md                     (working copy)
        │   └── test-cases.md                    (working copy)
        ├── atomic-function/atomic-functions.md  (working copy; only if stage run)
        └── development-order/development-order.md (working copy; only if stage run)
```

Published copies live in `Doc/` (top-level) and are written only by `state.ts:publishToDoc()` or by the optional post-pipeline stages after user accepts scout suggestions.

### 3.7 Per-command doc scope and gate (v1.4)

Every stage command declares its **doc scope** (the `Doc/` artifacts it reads) and **writes** (the artifact it produces). Before any LLM call, a **gate** checks that every required input artifact exists and is non-empty. Failure → clear error, no LLM call, state unchanged.

#### 3.7.1 `COMMAND_SCOPE` (declarative table)

```ts
// pi-extension/src/commands.ts
const COMMAND_SCOPE: Record<CommandName, { reads: string[]; writes: string[] }> = {
  "velpari-discuss":          { reads: [],                writes: ["Doc/discussion-notes.md"] },
  "velpari-prd":              { reads: ["Doc/discussion-notes.md"],
                                  writes: ["Doc/PRD_Pi-Velpari.md"] },
  "velpari-rtm":              { reads: ["Doc/PRD_Pi-Velpari.md"],
                                  writes: ["Doc/RTM_Pi-Velpari.md"] },
  "velpari-feasibility":      { reads: ["Doc/PRD_Pi-Velpari.md", "Doc/RTM_Pi-Velpari.md"],
                                  writes: ["Doc/feasibility-study.md"] },
  "velpari-design":           { reads: ["Doc/PRD_Pi-Velpari.md", "Doc/RTM_Pi-Velpari.md"],
                                  writes: ["Doc/design.md"] },
  "velpari-pseudocode":       { reads: ["Doc/PRD_Pi-Velpari.md", "Doc/RTM_Pi-Velpari.md", "Doc/design.md"],
                                  writes: ["Doc/pseudocode.md"] },
  "velpari-testplan":         { reads: ["Doc/PRD_Pi-Velpari.md", "Doc/RTM_Pi-Velpari.md",
                                        "Doc/design.md", "Doc/pseudocode.md"],
                                  writes: ["Doc/test-plan.md", "Doc/test-cases.md"] },
  "velpari-atomic-function":  { reads: ["Doc/PRD_Pi-Velpari.md", "Doc/RTM_Pi-Velpari.md",
                                        "Doc/design.md", "Doc/pseudocode.md",
                                        "Doc/test-plan.md", "Doc/test-cases.md"],
                                  writes: ["Doc/atomic-functions.md"] },
  "velpari-development-order": { reads: ["Doc/PRD_Pi-Velpari.md", "Doc/RTM_Pi-Velpari.md",
                                        "Doc/design.md", "Doc/pseudocode.md",
                                        "Doc/test-plan.md", "Doc/test-cases.md"],
                                  writes: ["Doc/development-order.md"] },
  "velpari-handoff":          { reads: ["Doc/*"],
                                  writes: [".pi/senai/architect-inputs.json"] },
  // Discipline and view commands have no Doc scope.
};
```

#### 3.7.2 `checkDocScope` (gate function)

```ts
// pi-extension/src/commands.ts
function checkDocScope(commandName: CommandName, rootDir: string): void {
  const scope = COMMAND_SCOPE[commandName];
  for (const artifact of scope.reads) {
    const fullPath = path.join(rootDir, artifact);
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).size === 0) {
      throw new Error(
        `/velpari-${commandName.replace("velpari-", "")} requires ${artifact} to exist and be non-empty. ` +
        `Run the previous stage first, or check /velpari-status.`
      );
    }
  }
}
```

The gate is called at the top of every stage command handler — before any LLM call, before any UI prompt. It throws on failure; the command handler catches the throw and surfaces the message to the user via `api.ui.error()`. State is unchanged. No LLM tokens are spent.

The gate is **deterministic** — it uses only `fs.existsSync` and `fs.statSync().size`. No LLM involvement. No race conditions within a single command invocation.

### 3.8 Framework handling (v1.5)

Framework/tech-stack selection happens **once per project** in `/velpari-configure-inputs`. It is not a pipeline stage. The selection is stored in `.pi/velpari/files.json` under `framework` and injected into every stage prompt.

#### 3.8.1 `FrameworkInfo` shape

```ts
interface FrameworkInfo {
  framework: string;        // e.g., "Next.js", "Django", "Spring Boot"
  language: string;         // e.g., "TypeScript", "Python", "Java"
  libraries: string[];      // e.g., ["react", "tailwindcss", "prisma"]
  runtime: string;          // e.g., "Node.js 20+", "Python 3.12+"
}
```

#### 3.8.2 `files.json` extended shape (version 2)

```ts
interface FilesConfig {
  version: 2;                // bumped from 1 to add framework
  framework?: FrameworkInfo; // optional but recommended
  codePaths: string[];
  inputDocuments: string[];
  outputPaths: { ... };
  excludedPaths: string[];
}
```

When `framework` is missing or malformed, `/velpari-configure-inputs` rejects with a clear error. Subsequent stage commands refuse to run with a different error: "Framework not configured. Run /velpari-configure-inputs first."

#### 3.8.3 Prompt injection

`prompt.ts:buildStagePrompt` includes the framework info in the prompt context block:

```
## Framework

- Language: TypeScript
- Framework: Next.js
- Libraries: react, tailwindcss, prisma
- Runtime: Node.js 20+

[existing prompt content follows]
```

Skill markdown for each stage references the framework in its instructions. Example: if language is TypeScript, the skill says "produce TypeScript helper function signatures"; if Python, "produce Python helper function signatures".

### 3.9 TUI independence (v1.5)

Velpari does NOT depend on Senai at runtime. The picker UI patterns used by Velpari are re-implementations of Senai's patterns, using Pi's TUI primitives.

#### 3.9.1 Why

- **Independent lifecycles.** Velpari and Senai evolve separately. A change in one should not break the other.
- **Different audiences.** Velpari is pre-production (developer captures requirements). Senai is production (LLM implements). They have different UX needs.
- **No circular dependency.** Both extensions live in the same monorepo but neither imports the other.

#### 3.9.2 Implementation

`pi-extension/src/ui/` contains:

- `simple-picker.ts` — single-select picker. Pattern mirrors Senai's but is independently implemented using Pi's `truncate-toWidth` and component API.
- `list-editor.ts` — multi-select with toggling. Same approach.
- `role-picker.ts` — role selector. Same approach.

#### 3.9.3 Verification

- `package.json` does not list Senai as a dependency. TC-198 verifies this.
- A grep for `from ".*Pi-Orchestra_v4.*"` in `pi-extension/src/` returns zero matches.

---

## 4. Interface Contracts

Each module exports a small, well-typed surface. Side effects are explicit. Pure functions take inputs and return outputs without touching the filesystem.

### 4.1 `state.ts` contracts

```ts
function loadState(rootDir: string): RunState | null;
// Pre: rootDir exists
// Post: returns parsed state, or null if file missing/corrupt

function saveState(rootDir: string, state: RunState): void;
// Pre: state passes validation (version === 1, currentStage in enum)
// Post: file exists at .IDE_Plans/velpari/state.json, atomic write
// Side: writes file

function advanceStage(rootDir: string, state: RunState, next: Stage): RunState;
// Pre: next is in STAGE_TRANSITIONS[state.currentStage]
// Post: returns new RunState with currentStage = next, history updated
// Throws: if transition not allowed
// Side: writes file

function createRun(rootDir: string, mission: string): RunState;
// Pre: no existing state (caller checks via loadState)
// Post: returns new RunState, run directory created
// Side: creates run directory, writes initial state

function clearRun(rootDir: string): void;
// Pre: user has confirmed deletion (UI confirms before calling)
// Post: state.json and run directory are gone
// Side: deletes files

function publishToDoc(rootDir: string, stage: Stage, sourcePath: string): void;
// Pre: stage is approved (callers enforce via UI flow)
// Post: file at sourcePath is copied to Doc/<artifactName>
// Side: writes file
```

### 4.2 `prompt.ts` contracts

```ts
function loadStageSkill(stage: Stage): string;
// Pure. Returns markdown body.

function buildStagePrompt(args: BuildPromptArgs): string;
// Pure. Returns full prompt string.
// No side effects.
```

### 4.3 `commands.ts` contracts

All 20 handlers follow the same shape:

```ts
type Handler = (args: CommandArgs, api: ExtensionAPI) => Promise<void> | void;
```

Each handler:
- Reads state via `state.ts:loadState()`.
- Validates prerequisites.
- Delegates to the relevant module.
- On success, calls `state.ts:advanceStage()` (stage handlers) or mutates state as needed (discipline handlers).
- Updates UI via `api` methods.

Handlers do not throw to the user — errors are caught, formatted, and shown via `api`.

### 4.4 Stage module contracts

Each stage module exports:

```ts
function runXxx(args: {
  state: RunState;
  rootDir: string;
  api: ExtensionAPI;
}): Promise<void>;
```

- Validates the previous stage is approved.
- Builds the prompt.
- Drives the LLM (or interactive UI for `discuss`).
- Writes the working copy to `getStageDir(rootDir, runId, stage)`.
- Renders preview to the user.
- On confirm, calls `state.ts:advanceStage()` to mark the working copy ready.

### 4.5 `handoff.ts` contracts

```ts
function runHandoff(state: RunState, rootDir: string): HandoffResult;
// Pre: state.currentStage === "planned-tests" or "handoff-ready"
// Post: writes .pi/senai/architect-inputs.json
// Side: writes file

function validateSenaiSchema(targetContent: object): string[];
// Pure. Returns list of errors (empty if valid).
```

### 4.6 `doctor.ts` contracts

```ts
function runDoctor(rootDir: string): DoctorReport;
// Pre: rootDir exists
// Post: writes .IDE_Plans/velpari/doctor-report.md
// Returns: full report object
// Side: writes file

function scanForSecrets(text: string): SecretFinding[];
// Pure. Returns matches.

function validateSenaiHandoffSchema(rootDir: string): string[];
// Pure. Returns errors. Reads Senai source for schema.
```

### 4.7 `show.ts` contracts

```ts
function showStage(stage: Stage, rootDir: string): string;
// Pre: rootDir exists
// Post: returns artifact content or "stage not reached" message
// Pure (file read is the only side effect; no writes)
```

---

## 5. Data Flow

### 5.1 End-to-end pipeline flow

```
User                  Velpari                   Pi Runtime           Filesystem
 |                       |                          |                     |
 | /velpari-discuss      |                          |                     |
 |---------------------->|                          |                     |
 |                       | loadState()              |                     |
 |                       |------------------------->|                     |
 |                       |                          | read state.json     |
 |                       |                          |-------------------->|
 |                       |                          |<-------------------|
 |                       |<-------------------------|                     |
 |                       | buildStagePrompt()       |                     |
 |                       |------ prompt ------      |                     |
 |                       |                          |                     |
 |<----- Q1 -------------|                          |                     |
 |------- A1 ----------->|                          |                     |
 |       ... (loop)      |                          |                     |
 |<----- QN -------------|                          |                     |
 |------- AN ----------->|                          |                     |
 |                       |                          | write working copy |
 |                       |                          |------------------->|
 |                       |                          |                     |
 |<-- preview -----------|                          |                     |
 |-- confirm ----------->|                          |                     |
 |                       | advanceStage()           |                     |
 |                       |------------------------->|                     |
 |                       |                          | write state.json    |
 |                       |                          |------------------->|
 |                       |                          |                     |
 | /velpari-approve      |                          |                     |
 |---------------------->|                          |                     |
 |                       | advanceStage()           |                     |
 |                       | publishToDoc()           |                     |
 |                       |------------------------->|                     |
 |                       |                          | copy to Doc/        |
 |                       |                          |------------------->|
 |                       |                          |                     |
 | (next stage auto-     |                          |                     |
 |  launched)            |                          |                     |
 |                       |                          |                     |
 [repeat for prd, rtm, feasibility, design, pseudocode, testplan]
 |                       |                          |                     |
 | /velpari-handoff      |                          |                     |
 |---------------------->|                          |                     |
 |                       | readApprovedArtifacts()  |                     |
 |                       |                          | read Doc/*          |
 |                       |                          |------------------->|
 |                       |<------------------------|                     |
 |                       | validateSenaiSchema()    |                     |
 |                       | write handoff            |                     |
 |                       |------------------------->|                     |
 |                       |                          | write architect-    |
 |                       |                          | inputs.json         |
 |                       |                          |------------------->|
 |                       | advanceStage()           |                     |
 |                       |------------------------->|                     |
 |                       |                          | write state.json    |
 |                       |                          |------------------->|
 |                       |                          |                     |
 | (handoff-ready; user  |                          |                     |
 |  switches to Senai)    |                          |                     |
```

### 5.2 Configure-inputs flow

```
User                    commands.ts             config.ts             Filesystem
 |                          |                       |                     |
 | /velpari-configure-inputs|                       |                     |
 |------------------------->|                       |                     |
 |                          | runFilesDiscovery()   |                     |
 |                          |---------------------->|                     |
 |                          |                       | scan project       |
 |                          |                       |-------------------->|
 |                          |                       |<-------------------|
 |                          |<----------------------|                     |
 |                          | show picker           |                     |
 |<---- picker UI ---------|                       |                     |
 |--- select items ------->|                       |                     |
 |                          | saveFilesConfig()     |                     |
 |                          |---------------------->|                     |
 |                          |                       | write files.json    |
 |                          |                       |------------------->|
 |                          |                       |                     |
 |<-- confirmation ---------|                       |                     |
```

### 5.3 Doctor flow

```
User                    commands.ts             doctor.ts             Filesystem
 |                          |                       |                     |
 | /velpari-doctor          |                       |                     |
 |------------------------->|                       |                     |
 |                          | runDoctor()           |                     |
 |                          |---------------------->|                     |
 |                          |                       |                     |
 |                          |   loadState()         |                     |
 |                          |   loadFilesConfig()   |                     |
 |                          |   list Doc/           |                     |
 |                          |   list run dir        |                     |
 |                          |   scan secrets        |                     |
 |                          |   validateSenaiSchema |                     |
 |                          |                       |                     |
 |                          |<----------------------|                     |
 |                          | writeDoctorReport()   |                     |
 |                          |---------------------->|                     |
 |                          |                       | write report        |
 |                          |                       |------------------->|
 |                          |                       |                     |
 |<-- report rendered ------|                       |                     |
```

### 5.4 Compaction flow

```
Pi Runtime              compaction.ts             state.ts            Filesystem
    |                       |                       |                     |
    | session_before_compact|                       |                     |
    |---------------------->|                       |                     |
    |                       | loadState()           |                     |
    |                       |---------------------->|                     |
    |                       |                       | read state.json    |
    |                       |                       |------------------->|
    |                       |<----------------------|                     |
    |                       | build summary string  |                     |
    |<------ summary -------|                       |                     |
    |                       |                       |                     |
    | (compaction proceeds, |                       |                     |
    |  state.json unchanged)|                       |                     |
```

---

## 6. Non-Functional Considerations (how the design satisfies NFRs)

| NFR | How the design satisfies it |
|---|---|
| NFR-01 (compaction) | `compaction.ts:buildCompactionSummary` is pure and zero-LLM. State.json is unchanged by compaction. |
| NFR-02 (no subagents in stages 2–7) | `index.ts` guards against `PI_SUBAGENT_NAME` env for stages 2–7 and handoff. No subagent-spawning code exists in those stages. |
| NFR-03 (project-local) | `package.json` declares `pi.extensions`. All paths are project-relative. |
| NFR-04 (secret scan) | `doctor.ts:scanForSecrets` uses a fixed regex set; findings are warnings only. |
| NFR-05 (doctor report) | `doctor.ts:writeDoctorReport` writes to `DOCTOR_REPORT_PATH` on every run. Report opens with "Setup progress". |
| NFR-06 (code quality) | TypeScript strict mode; `path.join` everywhere; no in-place state mutation; thin handlers in `commands.ts`. |
| NFR-07 (no extra deps) | `package.json` declares only the `@mariozechner/pi-coding-agent` peer dep. |
| NFR-08 (Senai compat) | `handoff.ts:validateSenaiSchema` reads Senai's `architect-inputs-config.ts` at test time. |
| NFR-09 (testing) | One test file per source module under `pi-extension/test/`. `node --test` with `fs.mkdtempSync` for temp dirs. |
| NFR-10 (docs) | Phase 0 of v1.1 plan produces README, AGENTS, CHANGELOG, sequence, step-by-step. |
| NFR-11 (scout agent exception) | Three stages use subagents: `discuss.ts` (4 subagents), `atomic-function.ts` (4 AF scouts), `development-order.ts` (4 DO scouts) — total 12 scout agents. Each scout lives in its own function with deterministic input/output. The scout pattern is centralized so all stages share UI affordance and trace-back rigor. |

---

## 7. Architecture Decisions

### 7.1 Why subagents in three stages (and nowhere else)

The original v1.1 principle was "no subagents anywhere." v1.2 relaxed this for the discussion stage; v1.3 extended it to two more stages. The scoping rationale:

**Three stages use scouts:**
- `discuss` — incremental requirements capture benefits from parallel classification.
- `atomic-function` — candidate decomposition proposals benefit from parallel analysis.
- `development-order` — implementation ordering benefits from parallel ranking.

**Four stages stay subagent-free:**
- `prd`, `rtm`, `feasibility`, `design`, `pseudocode`, `testplan` — these are linear document production stages; the LLM handles them inline.
- `handoff` — file packaging, no LLM involved.

**Why this split:** the LLM is well-suited to **proposing** candidates (multiple angles in parallel) but a human is required to **accept** them. The scout + picker pattern lets the user stay in control while still benefiting from LLM-driven proposal generation. Linear stages don't have this trade-off — they're deterministic scaffolding with a single LLM call to produce the artifact.

This is the same model Senai uses in its plan stage (4 scouts). Same mental model, same UI affordance, same trace-back rigor — applied to Velpari's three stages that benefit from it.

### 7.2 Why helper functions live in the PRD

Helper functions are an artifact of the **requirement**, not the implementation. A helper function exists because a requirement needs it. Storing helper functions in `Doc/PRD_Pi-Velpari.md` keeps the "what" (requirements) and the "how to fulfill it" (helper functions) in one place. The RTM's `Implementation / Helper Function` column references `HF-NN` ids, so traceability is mechanical: RTM row → HF-NN → PRD's `## Helper Functions` section.

Atomic functions are split into a separate doc (`Doc/atomic-functions.md`) because they are finer-grained and produced by a separate scout stage. The dependency `helper → atomic` is bidirectional: each helper records which atomics it calls, each atomic records which helpers call it.

### 7.3 Why optional stages stay optional

The two post-pipeline stages (`/velpari-atomic-function` and `/velpari-development-order`) could be made required, but they add value only when the user wants extra rigor. For a small feature, the core 7 stages are sufficient. For a large or risky feature, atomic decomposition and explicit ordering are valuable.

Making them optional:
- Keeps the simple case simple.
- Lets the user invest the extra effort where it pays off.
- Keeps `/velpari-handoff` simple — it always works, with or without the optional artifacts.

### 7.4 Why helper↔atomic is bidirectional

A helper function can call many atomics; an atomic function can be called by many helpers. If only one direction is recorded, the other side can drift. Bidirectional references are maintained at every update (PRD update, atomic-functions.md update) and verified by doctor cross-checks.

### 7.2 Why working-copy + published-copy

Working copies under `.IDE_Plans/velpari/runs/<run-id>/<stage>/` are:
- Editable freely (intermediate work).
- Easy to wipe on `/velpari-reset`.
- Isolated from the published `Doc/` artifacts.

Published copies under `Doc/` are:
- Read-only by convention (no code mutates them after publication).
- Visible to view commands, other tools, and version control.
- The artifact of record for the run.

This separation enforces the confirm gate: a `Doc/` write implies an explicit user action.

### 7.3 Why per-stage modules instead of one big stage runner

Each stage has a distinct user-facing interaction (interview for discuss, single prompt for others) and a distinct output structure. Per-stage modules:
- Are easier to test in isolation.
- Allow phase-by-phase delivery (Phase B ships 3 stages; Phase C ships 4 more).
- Make skill markdown per-stage (each skill lives at `skills/velpari-<stage>.md`).

### 7.4 Why Senai handoff is a single file, not a directory

Pi-Senai's `/senai-configure-architect-inputs` accepts a single `.pi/senai/architect-inputs.json` with all documents listed inside it. Matching that shape (rather than scattering files in `.pi/senai/inputs/`) keeps the contract tight and the test simple — one file, one schema, one assertion.

### 7.5 Why version 1 schemas are stable within v1.x

Changing `state.json` or `files.json` mid-version would silently break existing runs. Per PRD §6, schemas are stable within v1.x. New versions add optional fields only.

### 7.6 Why per-command doc scope and gate (v1.4)

Without explicit doc scope, a user can run a command out of order or against missing inputs. The LLM is then asked to produce something it cannot, and either invents (violating zero-hallucination) or returns a confused draft. The gate prevents this:

1. **Pre-LLM check is fast.** A single `fs.existsSync` and `fs.statSync().size > 0` per required input is microseconds.
2. **Errors are specific.** "Missing Doc/RTM_Pi-Velpari.md — run /velpari-rtm first" is better than "the LLM produced an empty table".
3. **State integrity is preserved.** A failed gate does not advance the state machine or write any working copy.
4. **The DAG becomes a true DAG.** Each stage's outputs are the next stage's verified inputs. No silent skips.

The gate is enforced by `commands.ts:checkDocScope`, called at the top of every stage command handler. The scope is declared in `COMMAND_SCOPE` (per-command reads/writes) and is the single source of truth — design, pseudocode, and tests all derive from it.

### 7.7 Why no `/velpari-architect` command (v1.4)

Architecture is the boundary between Velpari (pre-production) and Senai (production). Velpari captures requirements and produces design documents; Senai consumes them and generates the architecture. Adding a `/velpari-architect` command to Velpari would either:

- Duplicate Senai's `/senai-generate-architect` work (Senai already does this well, with 16 architecture patterns in its library), or
- Produce an output that doesn't match Senai's architecture factory's expected format, forcing a translation step.

Neither is desirable. The clean separation is:

- **Velpari** produces `Doc/PRD_Pi-Velpari.md`, `Doc/RTM_Pi-Velpari.md`, `Doc/design.md`, etc.
- **Senai** consumes those via `/senai-configure-architect-inputs` + `/senai-generate-architect`.

If a future version needs to add pre-architecture steps (e.g., a "design review" stage before Senai's architecture generation), they go in Senai, not Velpari. This is documented as `FR-47` (no architecture command in Velpari) and tracked as a constraint (PRD §6 item 11).

### 7.8 Why DECISION AGENT moved into the main handler (v1.5)

In v1.4, the discussion stage had 4 scouts: NEW EXTRACTOR, PRD CHECKER, RTM CHECKER, DECISION AGENT. The DECISION AGENT's job was to merge the other 3 scouts' outputs and classify each user statement as new FR / update / helper function update / new helper.

This work is **deterministic** post-processing, not LLM reasoning. It doesn't benefit from a separate LLM call — it can run in the main discussion handler after all scouts complete. Moving it:

- Frees the 4th scout slot for WEB SEARCH AGENT, which adds genuine value (community context).
- Reduces LLM round-trips (4 calls instead of 5).
- Reduces latency (one fewer parallel call to wait for).

The DECISION AGENT's logic is preserved as `discuss.ts:mergeAndClassify()`. It runs synchronously after all scouts return.

### 7.9 Why Velpari re-implements Senai's TUI patterns (v1.5)

Both extensions share UX patterns because they share a design philosophy (Senai-scout + picker). But Velpari does NOT import Senai's source. The pickers (`simple-picker`, `list-editor`, `role-picker`) are re-implemented in `pi-extension/src/ui/`.

**Why:**

- **Independent lifecycles.** Either extension can be removed or refactored without breaking the other.
- **No circular dependency.** Both extensions live in the same monorepo but neither depends on the other at runtime.
- **Different UX needs.** Velpari's pickers emphasize configuration (project setup), Senai's pickers emphasize agent orchestration (multi-agent). The shared pattern is the "spirit"; the implementations diverge.
- **Testability.** Each picker has its own test file. Drift between them is caught by tests, not by shared source.

This is documented as `FR-55` and tracked as a constraint (PRD §6 item 12). TC-198 verifies that `package.json` does not list Senai.

---

## 8. Cross-Reference Index

| Module | FR-Ns implemented | NFR-Ns implemented |
|---|---|---|
| `index.ts` | — | NFR-02 (stages 2–7), NFR-03 |
| `constants.ts` | FR-24 | — |
| `state.ts` | FR-21, FR-23, FR-25, FR-28, FR-30, FR-33 | NFR-06 |
| `prompt.ts` | FR-22, FR-23 | — |
| `commands.ts` | FR-01..FR-32, FR-43, FR-44, FR-49, FR-57 (delegation, 22 commands total; COMMAND_SCOPE and checkDocScope; framework handling) | — |
| `compaction.ts` | — | NFR-01 |
| `config.ts` | FR-11 | — |
| `doctor.ts` | FR-12, FR-33 | NFR-04, NFR-05, NFR-08 |
| `discuss.ts` | FR-01, FR-22, FR-23, FR-26, FR-28, FR-50, FR-51, FR-52, FR-53 | NFR-11 (4 scouts incl. WEB SEARCH) |
| `prd.ts` | FR-02, FR-22, FR-23, FR-29 | — |
| `rtm.ts` | FR-03, FR-22, FR-23, FR-30 | — |
| `feasibility.ts` | FR-04, FR-22, FR-23 | — |
| `design.ts` | FR-05, FR-22, FR-23 | — |
| `pseudocode.ts` | FR-06, FR-22, FR-23 | — |
| `testplan.ts` | FR-07, FR-22, FR-23 | — |
| `atomic-function.ts` | FR-31, FR-35 | NFR-11 (4 AF scouts) |
| `development-order.ts` | FR-32, FR-36 | NFR-11 (4 DO scouts) |
| `handoff.ts` | FR-13, FR-34 | NFR-08 |
| `show.ts` | FR-14..FR-20 | — |
| `contracts.ts` | FR-54, FR-56 | NFR-13 (uniform subagent pattern) |
| `scout.ts` | FR-54 | NFR-13 |
| `ui/{simple-picker,list-editor,role-picker}.ts` | FR-55 | — |

Every requirement in the RTM is implemented by at least one module. No module is orphan (every module implements at least one FR-N or NFR-N).

---

*This design is consumed by `Doc/pseudocode.md` (per-module algorithm specs), `Doc/test-plan.md` (test strategy), `Doc/test-cases.md` (specific TCs), and Phase A–E implementation in code.*
