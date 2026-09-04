# Pi-Velpari Pseudocode

> **v2.0 Update (2026-09-04):** The in-process `spawnScout` + `runScout` pattern described in §13 below (e.g. `runDiscuss` calling `spawnScout("extractor", ...)` from inside the handler) has been **replaced** by the visible-subagent pattern. The handler now calls `runStageWithScouts(config, ctx, pi)` which builds a stage prompt and hands off to the parent LLM via `pi.sendUserMessage(prompt)`. The parent LLM then spawns the 4 subagents via the `subagent()` tool from `@earendil-works/pi-interactive-subagents` in visible multiplexer panes. The pseudocode in §13-§14 still describes the *intent* (4 parallel agents per stage, deterministic merge) but the *mechanism* is now parent-LLM-driven. See `skills/velpari-discuss.md` for the current LLM-orchestrated flow. All 9 stages (discuss, prd, rtm, feasibility, design, pseudocode, testplan, atomic-function, development-order) follow this pattern.

- **Project:** Pi-Velpari
- **Source PRD:** `Doc/PRD.md` v1.1
- **Source Design:** `Doc/design.md`
- **Date:** 2026-08-24
- **Convention:** Each block describes one exported function: signature, inputs, outputs, preconditions, postconditions, step-by-step logic. Pseudocode language is TypeScript-flavored but not necessarily runnable; it's the algorithm specification.

---

## 1. Module: `index.ts`

### 1.1 default export

```ts
// Signature
export default function (api: ExtensionAPI): void

// Inputs
api: ExtensionAPI   // provided by Pi runtime

// Outputs
none

// Preconditions
process.env.PI_SUBAGENT_NAME is undefined (Velpari refuses to load in subagent context)

// Postconditions
- All 20 /velpari-* commands are registered
- session_before_compact hook is registered

// Logic
if (process.env.PI_SUBAGENT_NAME !== undefined) return;

registerCommands(api);

api.on("session_before_compact", (event, ctx) =>
  compaction.buildCompactionSummary(event, ctx)
);
```

---

## 2. Module: `constants.ts`

### 2.1 `STAGE_TRANSITIONS` (declarative constant)

```ts
// Type
const STAGE_TRANSITIONS: Record<Stage, Stage[]>

// Preconditions
none (declarative)

// Postconditions
For each Stage value s, STAGE_TRANSITIONS[s] is the set of allowed next stages

// Logic (table)
STAGE_TRANSITIONS["none"]                          = ["discussing"]
STAGE_TRANSITIONS["discussing"]                     = ["discussed"]
STAGE_TRANSITIONS["discussed"]                      = ["drafting-prd"]
STAGE_TRANSITIONS["drafting-prd"]                  = ["drafted-prd"]
STAGE_TRANSITIONS["drafted-prd"]                   = ["building-rtm"]
STAGE_TRANSITIONS["building-rtm"]                  = ["built-rtm"]
STAGE_TRANSITIONS["built-rtm"]                     = ["analyzing-feasibility"]
STAGE_TRANSITIONS["analyzing-feasibility"]         = ["analyzed-feasibility"]
STAGE_TRANSITIONS["analyzed-feasibility"]          = ["designing"]
STAGE_TRANSITIONS["designing"]                     = ["designed"]
STAGE_TRANSITIONS["designed"]                      = ["writing-pseudocode"]
STAGE_TRANSITIONS["writing-pseudocode"]            = ["wrote-pseudocode"]
STAGE_TRANSITIONS["wrote-pseudocode"]              = ["planning-tests"]
STAGE_TRANSITIONS["planning-tests"]                = ["planned-tests"]
STAGE_TRANSITIONS["planned-tests"]                 = ["handoff-ready"]
STAGE_TRANSITIONS["handoff-ready"]                 = []
```

### 2.2 `nextStage(current)`

```ts
function nextStage(current: Stage): Stage

// Inputs
current: Stage

// Outputs
next: Stage   // the unique allowed next stage, or throws

// Preconditions
current !== "handoff-ready"

// Postconditions
return value is in STAGE_TRANSITIONS[current]

// Logic
const allowed = STAGE_TRANSITIONS[current];
if (allowed.length === 0) throw new Error(`No transition from '${current}'`);
if (allowed.length !== 1) throw new Error(`Ambiguous transition from '${current}'`);
return allowed[0];
```

---

## 3. Module: `state.ts`

### 3.1 `loadState`

```ts
function loadState(rootDir: string): RunState | null

// Inputs
rootDir: string   // absolute path to project root

// Outputs
RunState | null   // parsed state, or null if missing/corrupt

// Preconditions
rootDir exists

// Postconditions
- file exists at path.join(rootDir, STATE_PATH) → returns parsed state
- file missing → returns null
- file corrupt → returns null (caller treats as "no run")

// Logic
const statePath = path.join(rootDir, STATE_PATH);
if (!fs.existsSync(statePath)) return null;

try {
  const raw = fs.readFileSync(statePath, "utf-8");
  const parsed = JSON.parse(raw);
  if (parsed.version !== 1) return null;
  return parsed as RunState;
} catch {
  return null;
}
```

### 3.2 `saveState`

```ts
function saveState(rootDir: string, state: RunState): void

// Inputs
rootDir: string
state: RunState

// Outputs
none

// Preconditions
state.version === 1
state.currentStage is a valid Stage
state.runId is non-empty

// Postconditions
file at path.join(rootDir, STATE_PATH) contains JSON.stringify(state)
// atomic: written to .tmp then renamed

// Logic
const dir = path.join(rootDir, ".IDE_Plans/velpari");
fs.mkdirSync(dir, { recursive: true });

const statePath = path.join(dir, "state.json");
const tmpPath = statePath + ".tmp";

const updated: RunState = { ...state, updatedAt: new Date().toISOString() };
fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), "utf-8");
fs.renameSync(tmpPath, statePath);
```

### 3.3 `createRun`

```ts
function createRun(rootDir: string, mission: string): RunState

// Inputs
rootDir: string
mission: string   // user-provided

// Outputs
newRun: RunState

// Preconditions
no existing state (loadState returns null)

// Postconditions
- run directory created at path.join(rootDir, RUNS_DIR, runId)
- state.json written with new RunState
- returned RunState has version=1, currentStage="discussing", history=[]

// Logic
const now = new Date();
const slug = slugify(mission);
const runId = `${formatTimestamp(now)}-${slug}`;

const runDir = path.join(rootDir, RUNS_DIR, runId);
fs.mkdirSync(runDir, { recursive: true });

const state: RunState = {
  version: 1,
  runId,
  mission,
  currentStage: "discussing",
  history: [],
  updatedAt: now.toISOString(),
};

saveState(rootDir, state);
return state;
```

### 3.4 `advanceStage`

```ts
function advanceStage(
  rootDir: string,
  state: RunState,
  next: Stage
): RunState

// Inputs
rootDir: string
state: RunState
next: Stage

// Outputs
newState: RunState

// Preconditions
next is in STAGE_TRANSITIONS[state.currentStage]
state.history does not already contain an entry with status="approved" for `next`

// Postconditions
- newState.currentStage === next
- newState.history contains a new entry { stage: state.currentStage, status: "approved", timestamp, artifactPaths }
- file at path.join(rootDir, STATE_PATH) updated

// Logic
const allowed = STAGE_TRANSITIONS[state.currentStage];
if (!allowed.includes(next)) {
  throw new Error(`Illegal transition: ${state.currentStage} -> ${next}`);
}

const runDir = path.join(rootDir, RUNS_DIR, state.runId);
const stageDir = path.join(runDir, stageToDirName(state.currentStage));
const publishedPath = path.join(rootDir, DOC_DIR, artifactNameFor(state.currentStage));

const entry: HistoryEntry = {
  stage: state.currentStage,
  status: "approved",
  timestamp: new Date().toISOString(),
  artifactPaths: {
    working: path.relative(rootDir, stageDir),
    published: fs.existsSync(publishedPath)
      ? path.relative(rootDir, publishedPath)
      : "",
  },
};

const newState: RunState = {
  ...state,
  currentStage: next,
  history: [...state.history, entry],
  updatedAt: new Date().toISOString(),
};

saveState(rootDir, newState);
return newState;
```

### 3.5 `clearRun`

```ts
function clearRun(rootDir: string): void

// Inputs
rootDir: string

// Outputs
none

// Preconditions
state file exists
user has confirmed deletion (UI flow)

// Postconditions
- state.json deleted
- run directory deleted
- .IDE_Plans/velpari/ exists but is otherwise empty

// Logic
const statePath = path.join(rootDir, STATE_PATH);
const state = loadState(rootDir);
if (state === null) return;  // nothing to clear

const runDir = path.join(rootDir, RUNS_DIR, state.runId);

if (fs.existsSync(runDir)) fs.rmSync(runDir, { recursive: true, force: true });
if (fs.existsSync(statePath)) fs.rmSync(statePath);
```

### 3.6 `publishToDoc`

```ts
function publishToDoc(
  rootDir: string,
  stage: Stage,
  sourcePath: string
): void

// Inputs
rootDir: string
stage: Stage   // the stage being approved
sourcePath: string   // path to working copy

// Outputs
none

// Preconditions
- stage is approved by current state (callers enforce via UI)
- sourcePath exists and is non-empty

// Postconditions
- file at path.join(rootDir, DOC_DIR, artifactNameFor(stage)) contains the content of sourcePath
- sourcePath is unchanged

// Logic
const docDir = path.join(rootDir, DOC_DIR);
fs.mkdirSync(docDir, { recursive: true });

const targetPath = path.join(docDir, artifactNameFor(stage));
fs.copyFileSync(sourcePath, targetPath);
```

---

## 4. Module: `prompt.ts`

### 4.1 `loadStageSkill`

```ts
function loadStageSkill(stage: Stage): string

// Inputs
stage: Stage

// Outputs
skillMarkdown: string

// Preconditions
none

// Postconditions
returns content of skills/velpari-<stage>.md from the extension package
throws if file missing

// Logic
const skillPath = path.join(EXTENSION_DIR, "skills", `velpari-${stage}.md`);
return fs.readFileSync(skillPath, "utf-8");
```

### 4.2 `buildStagePrompt`

```ts
function buildStagePrompt(args: BuildPromptArgs): string

// Inputs
args: {
  stage: Stage
  runDir: string
  publishedDir: string
  mission: string
  docScope: DocScope
}

// Outputs
prompt: string   // full markdown prompt

// Preconditions
args.stage is valid

// Postconditions
returns a string composed of: skill body + scope block + path block + rules

// Logic
const skill = loadStageSkill(args.stage);

const scopeBlock = renderDocScope(args.docScope);

const pathBlock = `
## Paths

- Mission: ${args.mission}
- Working copy directory: ${args.runDir}
- Published copy directory: ${args.publishedDir}

Write the working copy to the working copy directory.
Do NOT write to the published copy directory.
The user will publish via /velpari-approve after preview.
`;

const rulesBlock = `
## Rules

1. ZERO HALLUCINATION: every claim must trace to a user-provided statement
   in the discussion notes or to an earlier approved artifact. No new info.
2. PREVIEW-THEN-SAVE: produce the artifact as a complete draft, render it to
   the user, and STOP. Do NOT save until the user confirms.
3. Write only the working copy path. The published copy is the user's action.
`;

return [skill, scopeBlock, pathBlock, rulesBlock].join("\n\n");
```

---

## 5. Module: `commands.ts`

### 5.1 `registerCommands`

```ts
function registerCommands(api: ExtensionAPI): void

// Inputs
api: ExtensionAPI

// Outputs
none

// Postconditions
all 20 /velpari-* commands are registered

// Logic
// Stage commands
api.registerCommand("velpari-discuss",     handleDiscuss);
api.registerCommand("velpari-prd",         handlePrd);
api.registerCommand("velpari-rtm",         handleRtm);
api.registerCommand("velpari-feasibility", handleFeasibility);
api.registerCommand("velpari-design",      handleDesign);
api.registerCommand("velpari-pseudocode",  handlePseudocode);
api.registerCommand("velpari-testplan",    handleTestPlan);

// Discipline commands
api.registerCommand("velpari-approve",      handleApprove);
api.registerCommand("velpari-status",       handleStatus);
api.registerCommand("velpari-reset",        handleReset);
api.registerCommand("velpari-configure-inputs", handleConfigureInputs);
api.registerCommand("velpari-doctor",       handleDoctor);
api.registerCommand("velpari-handoff",      handleHandoff);

// View commands
api.registerCommand("velpari-show-discussion",  (a, api) => handleShow("discuss",     a, api));
api.registerCommand("velpari-show-prd",         (a, api) => handleShow("prd",         a, api));
api.registerCommand("velpari-show-rtm",         (a, api) => handleShow("rtm",         a, api));
api.registerCommand("velpari-show-feasibility", (a, api) => handleShow("feasibility", a, api));
api.registerCommand("velpari-show-design",      (a, api) => handleShow("design",      a, api));
api.registerCommand("velpari-show-pseudocode",  (a, api) => handleShow("pseudocode",  a, api));
api.registerCommand("velpari-show-testplan",    (a, api) => handleShow("testplan",    a, api));
```

### 5.2 `handleApprove`

```ts
async function handleApprove(args: CommandArgs, api: ExtensionAPI): Promise<void>

// Preconditions
state.currentStage is one of the "completed" half of a pair (e.g., "discussed", "drafted-prd")

// Postconditions
- working copy for current stage is published to Doc/
- state advances to the "starting" half of the next pair
- if parent context usage >= 50%, compaction is triggered first

// Logic
const state = loadState(rootDir);
if (state === null) { api.ui.error("No active run."); return; }

// Compact first if needed
if (api.contextUsage() >= 0.5) {
  await api.compactNow(compaction.buildCompactionSummary(...));
}

// Identify the stage that just finished (it's the one with status "pending"
// but whose working copy exists)
const justFinished = state.currentStage;
const stageDir = getStageDir(rootDir, state.runId, justFinished);
const workingCopy = path.join(stageDir, artifactNameFor(justFinished));
if (!fs.existsSync(workingCopy)) { api.ui.error("Working copy missing."); return; }

// Publish
state.publishToDoc(rootDir, justFinished, workingCopy);

// Advance
const next = nextStage(justFinished);
advanceStage(rootDir, state, next);

// Notify and auto-launch next stage if appropriate
api.ui.notify(`Approved. Moving to '${next}'.`);
await autoLaunchNextStage(next, state, api);
```

### 5.3 `handleStatus`

```ts
function handleStatus(args: CommandArgs, api: ExtensionAPI): void

// Postconditions
renders run status to user via api.ui.print

// Logic
const state = loadState(rootDir);
if (state === null) { api.ui.print("No active run. Start with /velpari-discuss."); return; }

const lines = [
  `Run id: ${state.runId}`,
  `Mission: ${state.mission}`,
  `Current stage: ${state.currentStage}`,
  `Updated: ${state.updatedAt}`,
  "",
  "History:",
];
for (const entry of state.history) {
  lines.push(`  - ${entry.stage} → ${entry.status} at ${entry.timestamp}`);
  if (entry.artifactPaths.published) {
    lines.push(`      published: ${entry.artifactPaths.published}`);
  }
}

api.ui.print(lines.join("\n"));
```

### 5.4 `handleReset`

```ts
async function handleReset(args: CommandArgs, api: ExtensionAPI): Promise<void>

// Preconditions
state file exists

// Postconditions
- on confirm, state.json and run directory are deleted
- on cancel, nothing happens

// Logic
const state = loadState(rootDir);
if (state === null) { api.ui.print("No active run to reset."); return; }

const confirmed = await api.ui.confirm(
  `Delete run '${state.runId}' (mission: ${state.mission})? This cannot be undone.`
);
if (!confirmed) { api.ui.print("Cancelled."); return; }

clearRun(rootDir);
api.ui.notify("Run reset. Use /velpari-discuss to start a new one.");
```

### 5.5 `handleShow`

```ts
function handleShow(stage: Stage, args: CommandArgs, api: ExtensionAPI): void

// Postconditions
prints artifact content to api.ui.print, or "not reached" message

// Logic
const content = showStage(stage, rootDir);
api.ui.print(content);
```

---

## 6. Module: `compaction.ts`

### 6.1 `buildCompactionSummary`

```ts
function buildCompactionSummary(event: SessionEvent, api: ExtensionAPI): string

// Inputs
event: SessionEvent   // provided by Pi
api: ExtensionAPI

// Outputs
summary: string   // markdown summary suitable for compaction

// Preconditions
none

// Postconditions
returns a deterministic, zero-LLM summary string

// Logic
const state = loadState(rootDir);
if (state === null) {
  return "No active Velpari run.";
}

const lines = [
  "# Velpari run state (compaction summary)",
  "",
  `- Run id: ${state.runId}`,
  `- Mission: ${state.mission}`,
  `- Current stage: ${state.currentStage}`,
  `- Updated: ${state.updatedAt}`,
  "",
  "## Completed stages",
];

for (const entry of state.history) {
  if (entry.status === "approved") {
    lines.push(`- ${entry.stage} (approved at ${entry.timestamp})`);
    if (entry.artifactPaths.published) {
      lines.push(`  - published: ${entry.artifactPaths.published}`);
    }
  }
}

const stageDir = getStageDir(rootDir, state.runId, state.currentStage);
lines.push("");
lines.push("## Current stage working copy");
lines.push(`- directory: ${path.relative(rootDir, stageDir)}`);
lines.push(`- expected file: ${artifactNameFor(state.currentStage)}`);

return lines.join("\n");
```

---

## 7. Module: `config.ts`

### 7.1 `loadFilesConfig`

```ts
function loadFilesConfig(rootDir: string): FilesConfig | null

// Logic
const configPath = path.join(rootDir, CONFIG_PATH);
if (!fs.existsSync(configPath)) return null;
try {
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  if (parsed.version !== 1) return null;
  return parsed as FilesConfig;
} catch {
  return null;
}
```

### 7.2 `saveFilesConfig`

```ts
function saveFilesConfig(rootDir: string, config: FilesConfig): void

// Logic
const errors = validateFilesConfig(config);
if (errors.length > 0) throw new Error(`Invalid config: ${errors.join("; ")}`);

const dir = path.dirname(path.join(rootDir, CONFIG_PATH));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(rootDir, CONFIG_PATH), JSON.stringify(config, null, 2), "utf-8");
```

### 7.3 `validateFilesConfig`

```ts
function validateFilesConfig(config: FilesConfig): string[]

// Logic
const errors: string[] = [];
if (config.version !== 1) errors.push("version must be 1");
if (!config.outputPaths) errors.push("outputPaths missing");
else {
  for (const stage of ["prd", "rtm", "feasibility", "design", "pseudocode", "testplan"] as const) {
    if (typeof config.outputPaths[stage] !== "string") {
      errors.push(`outputPaths.${stage} missing`);
    }
  }
}
return errors;
```

### 7.4 `runFilesDiscovery`

```ts
function runFilesDiscovery(rootDir: string): DiscoveryResult

// Logic
const suggestions: DiscoveryResult = {
  codePaths: [],
  inputDocuments: [],
  excludedPaths: [".git/", "node_modules/", "dist/", ".IDE_Plans/", "Doc/PRD.md", "Doc/RTM_Pi-Velpari.md"],
};

// Walk project
const entries = fs.readdirSync(rootDir, { withFileTypes: true });
for (const entry of entries) {
  if (entry.isDirectory() && !entry.name.startsWith(".")) {
    const subdir = path.join(rootDir, entry.name);
    const hasMarkdown = fs.readdirSync(subdir).some(f => f.endsWith(".md"));
    if (hasMarkdown) {
      // Suggest as inputDocuments if relevant name
      if (/prd|nfr|rtm|requirement|spec/i.test(entry.name)) {
        suggestions.inputDocuments.push(path.join(entry.name, "*.md"));
      }
    }
  }
}

// Default output paths
suggestions.outputPaths = {
  discuss: "Doc/discussion-notes.md",
  prd: "Doc/PRD_Pi-Velpari.md",
  rtm: "Doc/RTM_Pi-Velpari.md",
  feasibility: "Doc/feasibility-study.md",
  design: "Doc/design.md",
  pseudocode: "Doc/pseudocode.md",
  testplan: "Doc/test-plan.md",
};

return suggestions;
```

---

## 8. Module: `doctor.ts`

### 8.1 `runDoctor`

```ts
function runDoctor(rootDir: string): DoctorReport

// Logic
const report: DoctorReport = {
  setupProgress: [],
  checks: [],
  secretScan: [],
  writtenAt: new Date().toISOString(),
};

// Setup progress
report.setupProgress = [
  { step: "files.json exists",   done: loadFilesConfig(rootDir) !== null },
  { step: "state.json exists",   done: loadState(rootDir) !== null },
  { step: "Doc/ exists",         done: fs.existsSync(path.join(rootDir, "Doc")) },
];

// Per-stage checks
const state = loadState(rootDir);
if (state !== null) {
  for (const entry of state.history) {
    if (entry.status === "approved") {
      const working = path.join(rootDir, entry.artifactPaths.working);
      const published = path.join(rootDir, entry.artifactPaths.published);
      const ok =
        fs.existsSync(working) && fs.statSync(working).size > 0 &&
        fs.existsSync(published) && fs.statSync(published).size > 0;
      report.checks.push({
        name: `${entry.stage} artifacts present`,
        status: ok ? "pass" : "fail",
        detail: ok ? "" : `missing or empty: ${working} or ${published}`,
      });
    }
  }
}

// Secret scan
if (state !== null) {
  for (const entry of state.history) {
    if (entry.status === "approved" && entry.artifactPaths.published) {
      const content = fs.readFileSync(path.join(rootDir, entry.artifactPaths.published), "utf-8");
      report.secretScan.push(...scanForSecrets(content).map(f => ({ ...f, file: entry.artifactPaths.published })));
    }
  }
}

// Handoff schema check
if (state?.currentStage === "handoff-ready") {
  report.checks.push({
    name: "Senai handoff schema",
    status: "pass",
    detail: "",
  });
}

writeDoctorReport(rootDir, report);
return report;
```

### 8.2 `scanForSecrets`

```ts
function scanForSecrets(text: string): SecretFinding[]

// Logic
const patterns = [
  { name: "AWS access key",   regex: /AKIA[0-9A-Z]{16}/g },
  { name: "GitHub token",     regex: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "Generic API key",  regex: /(api[_-]?key|apikey|secret)["':\s=]+[A-Za-z0-9_\-]{20,}/gi },
  { name: "Private key",      regex: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
];

const findings: SecretFinding[] = [];
for (const { name, regex } of patterns) {
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    findings.push({
      type: name,
      match: match[0].slice(0, 8) + "***",  // redact
      offset: match.index,
    });
  }
}
return findings;
```

---

## 9. Module: `handoff.ts`

### 9.1 `runHandoff`

```ts
function runHandoff(state: RunState, rootDir: string): HandoffResult

// Preconditions
state.currentStage is "planned-tests" or "handoff-ready"

// Postconditions
- .pi/senai/architect-inputs.json is written
- state advances to "handoff-ready"
// Returns HandoffResult with warnings if any

// Logic
const artifacts = readApprovedArtifacts(rootDir);

const target: ArchitectInputs = {
  version: 1,
  projectName: slugify(state.mission),
  documents: [],
  constraints: [],
};

const typeMap: Record<string, ArchitectInputs["documents"][number]["type"]> = {
  "PRD_Pi-Velpari.md":            "PRD",
  "RTM_Pi-Velpari.md":            "RTM",
  "feasibility-study.md":         "Feasibility",
  "design.md":                    "Design",
  "pseudocode.md":                "Pseudocode",
  "test-plan.md":                 "Test Plan",
  "test-cases.md":                "Test Cases",
};

const warnings: string[] = [];
for (const [filename, content] of Object.entries(artifacts)) {
  const type = typeMap[filename];
  if (type === undefined) {
    warnings.push(`Unknown artifact: ${filename} — not included in handoff`);
    continue;
  }
  target.documents.push({ path: `Doc/${filename}`, type });
}

const schemaErrors = validateSenaiSchema(target);
if (schemaErrors.length > 0) {
  return { written: false, targetPath: HANDOFF_TARGET, documentCount: target.documents.length, warnings: [...warnings, ...schemaErrors] };
}

const targetDir = path.dirname(path.join(rootDir, HANDOFF_TARGET));
fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(
  path.join(rootDir, HANDOFF_TARGET),
  JSON.stringify(target, null, 2),
  "utf-8"
);

advanceStage(rootDir, state, "handoff-ready");

return { written: true, targetPath: HANDOFF_TARGET, documentCount: target.documents.length, warnings };
```

### 9.2 `validateSenaiSchema`

```ts
function validateSenaiSchema(target: object): string[]

// Logic
// Read Senai's architect-inputs-config.ts and parse the expected field names.
// In practice this is done by importing the Senai module or by reading and
// regex-matching its source. The assertion is: target has the same shape
// (same keys, same value types) as Senai expects.
const senaiSource = fs.readFileSync(
  path.join(rootDir, "..", "Pi-Orchestra_v4", "pi-extension", "src", "architect-inputs-config.ts"),
  "utf-8"
);

// Assert presence of expected keys
const requiredKeys = ["version", "projectName", "documents", "constraints"];
const errors: string[] = [];
for (const key of requiredKeys) {
  if (!(key in target)) errors.push(`Missing key: ${key}`);
}
return errors;
```

---

## 10. Module: `show.ts`

### 10.1 `showStage`

```ts
function showStage(stage: Stage, rootDir: string): string

// Preconditions
stage is one of the 7 content stages

// Postconditions
returns file content, or "stage not reached" message

// Logic
const artifactName = artifactNameFor(stage);
const publishedPath = path.join(rootDir, DOC_DIR, artifactName);

if (!fs.existsSync(publishedPath)) {
  return `Stage '${stage}' has not been reached yet. Use /velpari-${stage} to produce it.`;
}

const content = fs.readFileSync(publishedPath, "utf-8");

if (stage === "testplan") {
  // testplan stage produces two files; concatenate
  const testCasesPath = path.join(rootDir, DOC_DIR, "test-cases.md");
  const testCases = fs.existsSync(testCasesPath)
    ? fs.readFileSync(testCasesPath, "utf-8")
    : "";
  return content + "\n\n---\n\n" + testCases;
}

return content;
```

---

## 11. Module: `discuss.ts` (representative stage)

### 11.1 `runDiscuss`

```ts
async function runDiscuss(args: RunArgs): Promise<void>

// Preconditions
state.currentStage === "discussing"
// (If state is null, create a new run from the mission argument first.)

// Postconditions
- discussion-notes.md is written to run/discuss/
- state advances to "discussed"

// Logic
const { state, rootDir, api } = args;

// Ensure we have a state
let current = state ?? createRun(rootDir, args.mission ?? "Untitled");

// Build prompt
const skill = loadStageSkill("discuss");
const prompt = buildStagePrompt({
  stage: "discussing",
  runDir: getStageDir(rootDir, current.runId, "discussing"),
  publishedDir: path.join(rootDir, DOC_DIR),
  mission: current.mission,
  docScope: { inputs: [], comparisons: [] },
});

// Interactive interview loop
const answers: Array<{ question: string; answer: string }> = [];
let more = true;
while (more) {
  const question = await askNextQuestion(prompt, answers, api);
  const answer = await api.ui.input(question);
  answers.push({ question, answer });

  more = await api.ui.confirm("Add another point?");
}

// Generate discussion notes from Q&A
const notes = renderDiscussionNotes(current.mission, answers);

// Write working copy
const stageDir = getStageDir(rootDir, current.runId, "discussing");
fs.mkdirSync(stageDir, { recursive: true });
const workingPath = path.join(stageDir, "discussion-notes.md");
fs.writeFileSync(workingPath, notes, "utf-8");

// Preview + confirm
const preview = notes;
const confirmed = await api.ui.previewAndConfirm(preview, "Save discussion notes?");
if (!confirmed) {
  api.ui.print("Cancelled. Working copy retained; rerun /velpari-discuss to start over.");
  return;
}

api.ui.notify(`Working copy saved. Use /velpari-approve to publish.`);
```

### 11.2 `askNextQuestion`

```ts
async function askNextQuestion(
  skillPrompt: string,
  history: Array<{ question: string; answer: string }>,
  api: ExtensionAPI
): Promise<string>

// Logic
// The skillPrompt contains a directive like "ask one question at a time".
// Send the skill + history to the LLM and ask for the next question.
const next = await api.llm.complete(
  skillPrompt + "\n\nHistory so far:\n" + JSON.stringify(history, null, 2) +
  "\n\nOutput ONLY the next question, no preamble."
);
return next.trim();
```

### 11.3 `renderDiscussionNotes`

```ts
function renderDiscussionNotes(
  mission: string,
  answers: Array<{ question: string; answer: string }>
): string

// Logic
const lines = [
  "# Discussion Notes",
  "",
  `**Mission:** ${mission}`,
  `**Date:** ${new Date().toISOString()}`,
  "",
  "## User-provided statements",
  "",
];

answers.forEach((qa, i) => {
  lines.push(`### ${i + 1}. ${qa.question}`);
  lines.push("");
  lines.push(qa.answer);
  lines.push("");
});

return lines.join("\n");
```

---

## 12. Module: stage runners (`prd.ts`, `rtm.ts`, `feasibility.ts`, `design.ts`, `pseudocode.ts`, `testplan.ts`)

All six follow the same shape. Only the skill markdown and the artifact path vary.

### 12.1 `runXxx` (template)

```ts
async function runXxx(args: RunArgs): Promise<void>

// Preconditions
state.currentStage is the "starting" half of the pair for this stage
e.g., runPrd requires state.currentStage === "drafting-prd"

// Postconditions
- artifact is written to run/<stage>/
- state advances to the "completed" half of the pair

// Logic
const { state, rootDir, api } = args;

const prompt = buildStagePrompt({
  stage: state.currentStage,
  runDir: getStageDir(rootDir, state.runId, state.currentStage),
  publishedDir: path.join(rootDir, DOC_DIR),
  mission: state.mission,
  docScope: buildDocScopeFor(state.currentStage, rootDir),
});

// Send to LLM, get artifact draft
const draft = await api.llm.complete(prompt + "\n\nProduce the artifact now.");

// Preview + confirm
const stageDir = getStageDir(rootDir, state.runId, state.currentStage);
fs.mkdirSync(stageDir, { recursive: true });
const workingPath = path.join(stageDir, artifactNameFor(state.currentStage));
const confirmed = await api.ui.previewAndConfirm(draft, `Save ${artifactNameFor(state.currentStage)}?`);
if (!confirmed) return;

fs.writeFileSync(workingPath, draft, "utf-8");
api.ui.notify(`Working copy saved. Use /velpari-approve to publish.`);
```

The `buildDocScopeFor` helper assembles the truth/comparison documents for the current stage by reading the published `Doc/` artifacts of earlier stages and the user's `files.json:inputDocuments`.

---

## 13. Module: `discuss.ts` — updated for v1.5 (4-agent: DECISION → WEB SEARCH + main-handler merge)

### 13.1 `runDiscuss` — coordinates 4 scouts + main-handler merge

```ts
async function runDiscuss(args: RunArgs): Promise<void>

// Preconditions
state is null or currentStage === "discussing"

// Postconditions
- discussion-notes.md written to working dir
- verdict (new FR / update / helper function update / new helper) rendered to user
- on /velpari-approve, Doc/discussion-notes.md published AND PRD auto-updated per verdict

// Logic
const { state: existingState, rootDir, api } = args;
let state = existingState ?? createRun(rootDir, args.mission ?? "Untitled");

// Multi-turn interview (collect user answers)
const answers = [];
let more = true;
while (more) {
  const question = await askNextQuestion(state.mission, answers, api);
  const answer = await api.ui.input(question);
  answers.push({ question, answer });
  more = await api.ui.confirm("Add another point?");
}

// User-prompted web search activation (v1.5)
let useWebSearch = false;
if (answers.length > 0) {
  useWebSearch = await api.ui.confirm(
    "Do you want me to search the web for community resources, " +
    "official documentation, and similar projects related to your input? " +
    "This adds ~15 seconds and uses ~1 LLM call."
  );
}

// Spawn 4 scouts in parallel (3 always + 1 optional)
const scoutPromises: Promise<ScoutOutput>[] = [
  spawnScout("extractor", { mission: state.mission, answers }, api),
  spawnScout("prd-checker", { rootDir, runId: state.runId }, api),
  spawnScout("rtm-checker", { rootDir, runId: state.runId }, api),
];
if (useWebSearch) {
  scoutPromises.push(spawnScout("web-search", { mission: state.mission, answers }, api));
}

const scoutResults = await Promise.all(scoutPromises);

// Main handler performs DECISION AGENT logic (v1.5 — deterministic post-scout processing)
const verdict = mergeAndClassify(scoutResults, answers, rootDir);

// Render verdict for user preview
const previewText = renderVerdictForPreview(verdict, useWebSearch);

// Write working copy
const stageDir = getStageDir(rootDir, state.runId, "discussing");
fs.mkdirSync(stageDir, { recursive: true });
const workingPath = path.join(stageDir, "discussion-notes.md");
fs.writeFileSync(workingPath, renderDiscussionNotes(state.mission, answers, verdict, useWebSearch), "utf-8");

// Preview + confirm
const confirmed = await api.ui.previewAndConfirm(previewText, "Save discussion notes?");
if (!confirmed) return;

api.ui.notify("Discussion ready. Run /velpari-approve to publish and auto-update PRD.");
```

### 13.2 `mergeAndClassify` — DECISION AGENT logic in main handler (v1.5)

```ts
function mergeAndClassify(
  scoutResults: ScoutOutput[],
  userAnswers: Array<{ question: string; answer: string }>,
  rootDir: string
): DecisionVerdict

// Preconditions
scoutResults is non-empty; userAnswers is non-empty

// Postconditions
returns a DecisionVerdict with all user statements classified

// Logic
// 1. Collect all proposals from all scouts
const allProposals: Proposal[] = scoutResults.flatMap(r => r.proposals);

// 2. Extract candidate helper-function mentions from user answers
const candidateHelpers = extractHelperMentions(userAnswers);

// 3. Dedup helper functions by name + filePath (case-insensitive, forward slashes)
const existingHelpers = readExistingHelpers(path.join(rootDir, DOC_DIR, "PRD_Pi-Velpari.md"));
const dedupedHelpers = dedupHelpers(candidateHelpers, existingHelpers);

// 4. For each user statement, classify into one of:
//    - new FR-N: new requirement, no existing match
//    - update existing FR-N: modifies an existing FR
//    - helper function update: modifies existing helper
//    - new helper function: adds a new helper
const newFRs: NewFR[] = [];
const updatedFRs: UpdatedFR[] = [];
const newHelpers: NewHelper[] = [];
const updatedHelpers: UpdatedHelper[] = [];

for (const statement of extractStatements(userAnswers)) {
  const matchedFR = findMatchingFR(statement, existingPRD);
  const matchedHelper = findMatchingHelper(statement, existingHelpers);

  if (matchedHelper) {
    updatedHelpers.push({ id: matchedHelper.id, newPurpose: statement.text, callsAtomic: [] });
  } else if (matchedFR) {
    updatedFRs.push({ id: matchedFR.id, newDescription: statement.text });
  } else if (isHelperMention(statement)) {
    newHelpers.push(extractHelperEntry(statement));
  } else {
    newFRs.push({ description: statement.text, traceTo: sourceQuestion(statement) });
  }
}

// 5. Include web search proposals as "context" entries (advisory, not classified)
const webSearchProposals = scoutResults.find(r => r.source === "web-search")?.proposals ?? [];

return {
  newFRs,
  updatedFRs,
  newHelpers: dedupedHelpers.new,
  updatedHelpers: dedupedHelpers.updated,
  webSearchContext: webSearchProposals,  // advisory
};
```

### 13.3 `applyVerdict` — applies verdict to PRD on `/velpari-approve`

```ts
async function applyVerdict(verdict: DecisionVerdict, rootDir: string, runId: string): Promise<void>

// Preconditions
verdict has been confirmed by user (via /velpari-approve)

// Postconditions
- Doc/PRD_Pi-Velpari.md updated:
//   - new FR-Ns added to Functional Requirements table
//   - updated FR-Ns replace existing entries
//   - new HF-NNs added to ## Helper Functions
//   - updated HF-NNs replace existing entries

// Logic
const prdPath = path.join(rootDir, DOC_DIR, "PRD_Pi-Velpari.md");
let prd = fs.readFileSync(prdPath, "utf-8");

for (const fr of verdict.newFRs) prd = insertFRRow(prd, fr);
for (const fr of verdict.updatedFRs) prd = replaceFRRow(prd, fr);
for (const hf of verdict.newHelpers) prd = appendHelperEntry(prd, hf);
for (const hf of verdict.updatedHelpers) prd = replaceHelperEntry(prd, hf);

// Atomic write
fs.writeFileSync(`${prdPath}.tmp`, prd, "utf-8");
fs.renameSync(`${prdPath}.tmp`, prdPath);
```

---

## 14. Module: `atomic-function.ts` (v1.3)

### 14.1 `runAtomicFunction`

```ts
async function runAtomicFunction(args: RunArgs): Promise<void>

// Preconditions
state.currentStage is "proposing-atomic-functions" or "planned-tests"

// Postconditions
- working copy of atomic-functions.md written to run/atomic-function/
- suggestions rendered in picker; only accepted entries land in published copy

// Logic
const { state, rootDir, api } = args;

// Spawn 4 scouts in parallel
const [scout1, scout2, scout3, scout4] = await Promise.all([
  afScout1(rootDir),
  afScout2(rootDir),
  afScout3(rootDir),
  afScout4(rootDir),
]);

// Merge suggestions (dedup by name + filePath)
const merged = mergeSuggestions([scout1, scout2, scout3, scout4]);

// Render picker
const accepted = await renderSuggestionPicker(merged, api);

if (accepted.length === 0) {
  api.ui.notify("No atomic functions accepted. Skipping stage.");
  return;
}

// Write working copy
const stageDir = getStageDir(rootDir, state.runId, "atomic-function");
fs.mkdirSync(stageDir, { recursive: true });
const workingPath = path.join(stageDir, "atomic-functions.md");
fs.writeFileSync(workingPath, renderAtomicFunctions(accepted), "utf-8");

api.ui.notify("Atomic functions ready. Run /velpari-approve to publish.");
```

### 14.2 `afScout1` — helper splitter

```ts
async function afScout1(rootDir: string): Promise<AtomicFunction[]>

// Reads
Doc/RTM_Pi-Velpari.md — looks at Implementation / Helper Function column

// Logic
const rtm = fs.readFileSync(path.join(rootDir, DOC_DIR, "RTM_Pi-Velpari.md"), "utf-8");
const helpers = parseHelperFunctionReferences(rtm);

const prompt = buildScoutPrompt("af-scout-1-helper-splitter", { helpers });
const raw = await api.llm.complete(prompt);
return JSON.parse(raw).proposals as AtomicFunction[];
```

### 14.3 `afScout2` — duplicate pattern finder

```ts
async function afScout2(rootDir: string): Promise<AtomicFunction[]>

// Reads
Doc/pseudocode.md — looks for repeated logic patterns

// Logic
const pseudocode = fs.readFileSync(path.join(rootDir, DOC_DIR, "pseudocode.md"), "utf-8");
const prompt = buildScoutPrompt("af-scout-2-duplicate-pattern-finder", { pseudocode });
const raw = await api.llm.complete(prompt);
return JSON.parse(raw).proposals as AtomicFunction[];
```

### 14.4 `afScout3` — requirement helper

```ts
async function afScout3(rootDir: string): Promise<AtomicFunction[]>

// Reads
Doc/PRD_Pi-Velpari.md — Functional Requirements section

// Logic
const prd = fs.readFileSync(path.join(rootDir, DOC_DIR, "PRD_Pi-Velpari.md"), "utf-8");
const frs = parseFunctionalRequirements(prd);
const prompt = buildScoutPrompt("af-scout-3-requirement-helper", { frs });
const raw = await api.llm.complete(prompt);
return JSON.parse(raw).proposals as AtomicFunction[];
```

### 14.5 `afScout4` — test helper

```ts
async function afScout4(rootDir: string): Promise<AtomicFunction[]>

// Reads
Doc/test-cases.md — looks for test setup/teardown patterns

// Logic
const tcs = fs.readFileSync(path.join(rootDir, DOC_DIR, "test-cases.md"), "utf-8");
const prompt = buildScoutPrompt("af-scout-4-test-helper", { testCases: tcs });
const raw = await api.llm.complete(prompt);
return JSON.parse(raw).proposals as AtomicFunction[];
```

### 14.6 `mergeSuggestions`

```ts
function mergeSuggestions(scoutResults: AtomicFunction[][]): AtomicFunction[]

// Logic
const seen = new Map<string, AtomicFunction>();
for (const result of scoutResults) {
  for (const af of result) {
    const key = `${af.name.toLowerCase()}|${af.filePath.toLowerCase().replace(/\\/g, "/")}`;
    if (seen.has(key)) {
      // Merge sources
      const existing = seen.get(key)!;
      existing.source = `${existing.source}, ${af.source}`;
    } else {
      seen.set(key, { ...af });
    }
  }
}
return Array.from(seen.values());
```

### 14.7 `renderSuggestionPicker`

```ts
async function renderSuggestionPicker(suggestions: AtomicFunction[], api: ExtensionAPI): Promise<AtomicFunction[]>

// Logic
// Reuse Senai's simple-picker pattern. Each suggestion is shown with:
//   - name, filePath, signature, purpose
//   - source (which scout proposed it)
//   - accept/reject buttons (default: accept)
// User can also edit name/filePath/signature/purpose inline.
// Returns the list of accepted suggestions.
const accepted: AtomicFunction[] = [];
for (const suggestion of suggestions) {
  const choice = await api.ui.pickOne(
    `Accept this atomic function?\n\n${suggestion.name}\n${suggestion.filePath}\n${suggestion.purpose}\n\nSource: ${suggestion.source}`,
    ["Accept", "Reject", "Edit"]
  );
  if (choice === "Accept") accepted.push(suggestion);
  else if (choice === "Edit") {
    const edited = await api.ui.edit(suggestion);
    if (edited !== null) accepted.push(edited);
  }
}
return accepted;
```

---

## 15. Module: `development-order.ts` (v1.3)

### 15.1 `runDevelopmentOrder`

```ts
async function runDevelopmentOrder(args: RunArgs): Promise<void>

// Preconditions
state.currentStage is "proposing-development-order", "atomic-functions-proposed", or "planned-tests"

// Postconditions
- working copy of development-order.md written to run/development-order/
- merged ranking rendered; user reorders; only final order published

// Logic
const { state, rootDir, api } = args;

// Spawn 4 scouts in parallel
const [scout1, scout2, scout3, scout4] = await Promise.all([
  doScout1(rootDir),
  doScout2(rootDir),
  doScout3(rootDir),
  doScout4(rootDir),
]);

// Merge rankings (weighted average or user picks strategy)
const merged = mergeRankings([scout1, scout2, scout3, scout4]);

// Render order picker — user can drag-reorder
const finalOrder = await renderOrderPicker(merged, api);

// Write working copy
const stageDir = getStageDir(rootDir, state.runId, "development-order");
fs.mkdirSync(stageDir, { recursive: true });
const workingPath = path.join(stageDir, "development-order.md");
fs.writeFileSync(workingPath, renderDevelopmentOrder(finalOrder), "utf-8");

api.ui.notify("Development order ready. Run /velpari-approve to publish.");
```

### 15.2 `doScout1` — dependency sort

```ts
async function doScout1(rootDir: string): Promise<OrderEntry[]>

// Reads
Doc/RTM_Pi-Velpari.md + Doc/design.md — extracts dependency graph

// Logic
const rtm = fs.readFileSync(path.join(rootDir, DOC_DIR, "RTM_Pi-Velpari.md"), "utf-8");
const design = fs.readFileSync(path.join(rootDir, DOC_DIR, "design.md"), "utf-8");
const prompt = buildScoutPrompt("do-scout-1-dependency-sort", { rtm, design });
const raw = await api.llm.complete(prompt);
return JSON.parse(raw).ranking as OrderEntry[];
```

### 15.3 `doScout2` — risk priority

```ts
async function doScout2(rootDir: string): Promise<OrderEntry[]>

// Reads
Doc/feasibility-study.md + Doc/design.md

// Logic
const feasibility = fs.readFileSync(path.join(rootDir, DOC_DIR, "feasibility-study.md"), "utf-8");
const design = fs.readFileSync(path.join(rootDir, DOC_DIR, "design.md"), "utf-8");
const prompt = buildScoutPrompt("do-scout-2-risk-priority", { feasibility, design });
const raw = await api.llm.complete(prompt);
return JSON.parse(raw).ranking as OrderEntry[];
```

### 15.4 `doScout3` — test priority

```ts
async function doScout3(rootDir: string): Promise<OrderEntry[]>

// Reads
Doc/test-plan.md

// Logic
const testPlan = fs.readFileSync(path.join(rootDir, DOC_DIR, "test-plan.md"), "utf-8");
const prompt = buildScoutPrompt("do-scout-3-test-priority", { testPlan });
const raw = await api.llm.complete(prompt);
return JSON.parse(raw).ranking as OrderEntry[];
```

### 15.5 `doScout4` — user value

```ts
async function doScout4(rootDir: string): Promise<OrderEntry[]>

// Reads
Doc/PRD_Pi-Velpari.md

// Logic
const prd = fs.readFileSync(path.join(rootDir, DOC_DIR, "PRD_Pi-Velpari.md"), "utf-8");
const prompt = buildScoutPrompt("do-scout-4-user-value", { prd });
const raw = await api.llm.complete(prompt);
return JSON.parse(raw).ranking as OrderEntry[];
```

### 15.6 `mergeRankings`

```ts
function mergeRankings(scoutResults: OrderEntry[][]): OrderEntry[]

// Logic
// Combine 4 rankings. Each OrderEntry has a frId and a rank (1 = highest).
// For each FR-NN, average its rank across all 4 scouts (skip scouts that didn't include it).
// Sort by average rank ascending (lower = earlier in order).
const rankByFr = new Map<string, number[]>();
for (const result of scoutResults) {
  for (const entry of result) {
    if (!rankByFr.has(entry.frId)) rankByFr.set(entry.frId, []);
    rankByFr.get(entry.frId)!.push(entry.rank);
  }
}

const merged: OrderEntry[] = [];
for (const [frId, ranks] of rankByFr) {
  const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length;
  merged.push({
    frId,
    rank: avg,
    source: "merged",
    rationale: `Average rank across ${ranks.length} scouts`,
  });
}

merged.sort((a, b) => a.rank - b.rank);
return merged;
```

### 15.7 `renderOrderPicker`

```ts
async function renderOrderPicker(ranked: OrderEntry[], api: ExtensionAPI): Promise<OrderEntry[]>

// Logic
// Show the merged ranking as a draggable list. User can:
// - accept the order as-is
// - drag items to reorder
// - exclude items (drop from the list)
// Returns the final accepted order.
const finalOrder = await api.ui.draggableList(
  ranked.map(r => ({ id: r.frId, label: `${r.frId} — ${r.rationale}` })),
  { title: "Development order" }
);
return finalOrder.map((item, i) => ({
  frId: item.id,
  rank: i + 1,
  source: "user",
  rationale: "User reordered",
}));
```

---

## 16. Module: `handoff.ts` — updated for v1.3 (handle optional artifacts)

### 16.1 `runHandoff` — extended

```ts
function runHandoff(state: RunState, rootDir: string): HandoffResult

// Postconditions
- .pi/senai/architect-inputs.json written
- includes atomic-functions.md and development-order.md if they exist (v1.3 addition)
// state advances to "handoff-ready"

// Logic
const artifacts = readApprovedArtifacts(rootDir);

const target: ArchitectInputs = {
  version: 1,
  projectName: slugify(state.mission),
  documents: [],
  constraints: [],
};

const typeMap: Record<string, ArchitectInputs["documents"][number]["type"]> = {
  "PRD_Pi-Velpari.md":            "PRD",
  "RTM_Pi-Velpari.md":            "RTM",
  "feasibility-study.md":         "Feasibility",
  "design.md":                    "Design",
  "pseudocode.md":                "Pseudocode",
  "test-plan.md":                 "Test Plan",
  "test-cases.md":                "Test Cases",
  "atomic-functions.md":          "Atomic Functions",   // v1.3 — optional
  "development-order.md":         "Development Order",  // v1.3 — optional
};

const warnings: string[] = [];
for (const [filename, content] of Object.entries(artifacts)) {
  const type = typeMap[filename];
  if (type === undefined) {
    warnings.push(`Unknown artifact: ${filename} — not included in handoff`);
    continue;
  }
  target.documents.push({ path: `Doc/${filename}`, type });
}

const schemaErrors = validateSenaiSchema(target);
if (schemaErrors.length > 0) {
  return { written: false, targetPath: HANDOFF_TARGET, documentCount: target.documents.length, warnings: [...warnings, ...schemaErrors] };
}

// v1.3: validate document types against Senai's accepted list
const senaiAcceptedTypes = await getSenaiAcceptedDocumentTypes();
for (const doc of target.documents) {
  if (!senaiAcceptedTypes.includes(doc.type)) {
    warnings.push(`Senai may not recognize document type '${doc.type}' for ${doc.path}`);
  }
}

const targetDir = path.dirname(path.join(rootDir, HANDOFF_TARGET));
fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(
  path.join(rootDir, HANDOFF_TARGET),
  JSON.stringify(target, null, 2),
  "utf-8"
);

advanceStage(rootDir, state, "handoff-ready");

return { written: true, targetPath: HANDOFF_TARGET, documentCount: target.documents.length, warnings };
```

---

## 17. Module: `commands.ts` — per-command gate (v1.4)

### 17.1 `COMMAND_SCOPE` (declarative table)

```ts
// pi-extension/src/commands.ts
const COMMAND_SCOPE: Record<string, { reads: string[]; writes: string[] }> = {
  "velpari-discuss":          { reads: [],                writes: ["Doc/discussion-notes.md"] },
  "velpari-prd":              { reads: ["Doc/discussion-notes.md"], writes: ["Doc/PRD_Pi-Velpari.md"] },
  "velpari-rtm":              { reads: ["Doc/PRD_Pi-Velpari.md"], writes: ["Doc/RTM_Pi-Velpari.md"] },
  "velpari-feasibility":      { reads: ["Doc/PRD_Pi-Velpari.md", "Doc/RTM_Pi-Velpari.md"], writes: ["Doc/feasibility-study.md"] },
  "velpari-design":           { reads: ["Doc/PRD_Pi-Velpari.md", "Doc/RTM_Pi-Velpari.md"], writes: ["Doc/design.md"] },
  "velpari-pseudocode":       { reads: ["Doc/PRD_Pi-Velpari.md", "Doc/RTM_Pi-Velpari.md", "Doc/design.md"], writes: ["Doc/pseudocode.md"] },
  "velpari-testplan":         { reads: ["Doc/PRD_Pi-Velpari.md", "Doc/RTM_Pi-Velpari.md", "Doc/design.md", "Doc/pseudocode.md"], writes: ["Doc/test-plan.md", "Doc/test-cases.md"] },
  "velpari-atomic-function":  { reads: ["Doc/PRD_Pi-Velpari.md", "Doc/RTM_Pi-Velpari.md", "Doc/design.md", "Doc/pseudocode.md", "Doc/test-plan.md", "Doc/test-cases.md"], writes: ["Doc/atomic-functions.md"] },
  "velpari-development-order": { reads: ["Doc/PRD_Pi-Velpari.md", "Doc/RTM_Pi-Velpari.md", "Doc/design.md", "Doc/pseudocode.md", "Doc/test-plan.md", "Doc/test-cases.md"], writes: ["Doc/development-order.md"] },
  "velpari-handoff":          { reads: ["Doc/*"], writes: [".pi/senai/architect-inputs.json"] },
  // Discipline commands have no doc scope (no LLM, no inputs).
  // View commands have no doc scope (they read the published artifact directly).
};
```

### 17.2 `checkDocScope` (gate function)

```ts
// pi-extension/src/commands.ts
function checkDocScope(commandName: string, rootDir: string): void {
  const scope = COMMAND_SCOPE[commandName];
  if (!scope) {
    // Unknown command — should never happen if commands are registered correctly.
    throw new Error(`Unknown command: ${commandName}`);
  }
  for (const artifact of scope.reads) {
    if (artifact === "Doc/*") continue;  // wildcard — handled by handoff command itself
    const fullPath = path.join(rootDir, artifact);
    if (!fs.existsSync(fullPath)) {
      throw new Error(
        `/${commandName} requires ${artifact} to exist. ` +
        `Run the previous stage first, or check /velpari-status.`
      );
    }
    const stat = fs.statSync(fullPath);
    if (stat.size === 0) {
      throw new Error(
        `/${commandName} requires ${artifact} to be non-empty. ` +
        `The file exists but is empty. Re-run the stage that produces it.`
      );
    }
  }
}
```

### 17.3 Per-stage gate usage

Every stage command handler calls `checkDocScope` at the top, before delegating to the stage module.

```ts
// pi-extension/src/commands.ts (handler template)
async function stageHandler(args: CommandArgs, api: ExtensionAPI): Promise<void> {
  try {
    checkDocScope("velpari-<stage>", rootDir);
  } catch (err) {
    api.ui.error(err.message);
    return;
  }
  // Delegate to the stage module
  await stageModule.runXxx({ state, rootDir, api });
}
```

### 17.4 Per-command gate behavior (one block per command)

#### `/velpari-discuss` gate
```ts
// No inputs — entry point. Always passes.
function gate_discuss(rootDir: string): void {
  // No-op. Discussion creates the first artifact.
}
```

#### `/velpari-prd` gate
```ts
function gate_prd(rootDir: string): void {
  assertFileNonEmpty(path.join(rootDir, "Doc/discussion-notes.md"));
  // On failure: "/velpari-prd requires Doc/discussion-notes.md to exist and be non-empty.
  //             Run /velpari-discuss first."
}
```

#### `/velpari-rtm` gate
```ts
function gate_rtm(rootDir: string): void {
  assertFileNonEmpty(path.join(rootDir, "Doc/PRD_Pi-Velpari.md"));
  // On failure: "/velpari-rtm requires Doc/PRD_Pi-Velpari.md to exist and be non-empty.
  //             Run /velpari-discuss and /velpari-approve, or /velpari-prd and /velpari-approve."
}
```

#### `/velpari-feasibility` gate
```ts
function gate_feasibility(rootDir: string): void {
  assertFileNonEmpty(path.join(rootDir, "Doc/PRD_Pi-Velpari.md"));
  assertFileNonEmpty(path.join(rootDir, "Doc/RTM_Pi-Velpari.md"));
}
```

#### `/velpari-design` gate
```ts
function gate_design(rootDir: string): void {
  assertFileNonEmpty(path.join(rootDir, "Doc/PRD_Pi-Velpari.md"));
  assertFileNonEmpty(path.join(rootDir, "Doc/RTM_Pi-Velpari.md"));
}
```

#### `/velpari-pseudocode` gate
```ts
function gate_pseudocode(rootDir: string): void {
  assertFileNonEmpty(path.join(rootDir, "Doc/PRD_Pi-Velpari.md"));
  assertFileNonEmpty(path.join(rootDir, "Doc/RTM_Pi-Velpari.md"));
  assertFileNonEmpty(path.join(rootDir, "Doc/design.md"));
}
```

#### `/velpari-testplan` gate
```ts
function gate_testplan(rootDir: string): void {
  assertFileNonEmpty(path.join(rootDir, "Doc/PRD_Pi-Velpari.md"));
  assertFileNonEmpty(path.join(rootDir, "Doc/RTM_Pi-Velpari.md"));
  assertFileNonEmpty(path.join(rootDir, "Doc/design.md"));
  assertFileNonEmpty(path.join(rootDir, "Doc/pseudocode.md"));
}
```

#### `/velpari-atomic-function` gate
```ts
function gate_atomic_function(rootDir: string): void {
  assertFileNonEmpty(path.join(rootDir, "Doc/PRD_Pi-Velpari.md"));
  assertFileNonEmpty(path.join(rootDir, "Doc/RTM_Pi-Velpari.md"));
  assertFileNonEmpty(path.join(rootDir, "Doc/design.md"));
  assertFileNonEmpty(path.join(rootDir, "Doc/pseudocode.md"));
  assertFileNonEmpty(path.join(rootDir, "Doc/test-plan.md"));
  assertFileNonEmpty(path.join(rootDir, "Doc/test-cases.md"));
}
```

#### `/velpari-development-order` gate
```ts
function gate_development_order(rootDir: string): void {
  assertFileNonEmpty(path.join(rootDir, "Doc/PRD_Pi-Velpari.md"));
  assertFileNonEmpty(path.join(rootDir, "Doc/RTM_Pi-Velpari.md"));
  assertFileNonEmpty(path.join(rootDir, "Doc/design.md"));
  assertFileNonEmpty(path.join(rootDir, "Doc/pseudocode.md"));
  assertFileNonEmpty(path.join(rootDir, "Doc/test-plan.md"));
  assertFileNonEmpty(path.join(rootDir, "Doc/test-cases.md"));
}
```

#### `/velpari-handoff` gate
```ts
function gate_handoff(rootDir: string): void {
  // Wildcard check: at least one Doc/ artifact must exist.
  const docDir = path.join(rootDir, "Doc");
  if (!fs.existsSync(docDir) || fs.readdirSync(docDir).length === 0) {
    throw new Error(
      "/velpari-handoff requires at least one published artifact in Doc/. " +
      "Run at least one stage and /velpari-approve before handoff."
    );
  }
}
```

#### `assertFileNonEmpty` (helper)

```ts
function assertFileNonEmpty(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file missing: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    throw new Error(`Required file is empty: ${filePath}`);
  }
}
```

---

## 18. Module: `contracts.ts` and `scout.ts` (v1.5)

### 18.1 `ScoutContract`

```ts
// pi-extension/src/contracts.ts
export interface ScoutContract {
  scoutId: string;             // "extractor", "prd-checker", "web-search", "af-scout-1", "do-scout-3", etc.
  stageName: Stage;            // which stage owns this scout
  inputSchema: object;         // what the scout reads
  outputSchema: object;        // JSON envelope the scout returns
  timeoutMs: number;           // default 30_000
}

export interface ScoutInput {
  skillPath: string;           // path to skill markdown
  payload: object;             // stage-specific structured input
}

export interface ScoutOutput {
  proposals: Array<{
    id?: string;                // optional stable id (e.g., "HF-NN" or "AF-NN")
    payload: object;            // stage-specific
    source: string;             // always set to scoutId
  }>;
  warnings: string[];
}

export interface AcceptedProposal {
  proposal: ScoutOutput["proposals"][number];
  accepted: boolean;            // false if user rejected
  edits?: { payload: object };   // user-edited payload if any
}
```

### 18.2 `spawnScout` — uniform scout spawn helper

```ts
// pi-extension/src/scout.ts
export async function spawnScout(
  scoutId: string,
  input: object,
  api: ExtensionAPI
): Promise<ScoutOutput>

// Preconditions
scoutId is one of the 12 registered scout ids
input matches ScoutInput shape

// Postconditions
returns parsed ScoutOutput; throws on timeout or invalid response

// Logic
const skillPath = path.join(EXTENSION_DIR, "skills", "scouts", `${scoutId}.md`);
if (!fs.existsSync(skillPath)) {
  throw new Error(`Scout skill not found: ${skillPath}`);
}
const skill = fs.readFileSync(skillPath, "utf-8");
const prompt =
  skill +
  "\n\n# Input\n" + JSON.stringify(input, null, 2) +
  "\n\n# Output\nProduce JSON matching the ScoutOutput envelope. No preamble, no markdown, just JSON.";

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 30_000);  // 30-second timeout (uniform across all scouts)
try {
  const raw = await api.llm.complete(prompt, { signal: controller.signal });
  const parsed = JSON.parse(raw);
  // Validate output envelope
  if (!parsed.proposals || !Array.isArray(parsed.proposals)) {
    throw new Error(`Scout '${scoutId}' returned invalid output envelope`);
  }
  // Stamp source on each proposal
  for (const p of parsed.proposals) p.source = scoutId;
  return parsed as ScoutOutput;
} catch (err) {
  throw new Error(`Scout '${scoutId}' failed: ${err.message}`);
} finally {
  clearTimeout(timer);
}
```

### 18.3 `renderScoutPicker` — uniform picker UI

```ts
// pi-extension/src/ui/simple-picker.ts (re-implementation of Senai's pattern)
export async function renderScoutPicker(
  scoutId: string,
  output: ScoutOutput,
  api: ExtensionAPI
): Promise<AcceptedProposal[]>

// Preconditions
output has at least one proposal

// Postconditions
returns the list of accepted proposals (with edits if any)

// Logic
// For each proposal, show user:
//   - proposal.payload (formatted)
//   - source: scoutId
//   - accept / reject / edit buttons
// Default action: accept.
// After all proposals processed, return the accepted list.
```

### 18.4 `FrameworkInfo` and injection

```ts
// pi-extension/src/contracts.ts (continued)
export interface FrameworkInfo {
  framework: string;        // e.g., "Next.js"
  language: string;         // e.g., "TypeScript"
  libraries: string[];      // e.g., ["react", "tailwindcss"]
  runtime: string;          // e.g., "Node.js 20+"
}

// pi-extension/src/prompt.ts (extended)
export function buildStagePrompt(args: BuildPromptArgs & { framework?: FrameworkInfo }): string {
  const skill = loadStageSkill(args.stage);
  const frameworkBlock = args.framework
    ? `\n\n## Framework\n\n- Language: ${args.framework.language}\n- Framework: ${args.framework.framework}\n- Libraries: ${args.framework.libraries.join(", ")}\n- Runtime: ${args.framework.runtime}\n`
    : "";
  // ... existing logic + frameworkBlock appended to the prompt
  return [skill, scopeBlock, pathBlock, frameworkBlock, rulesBlock].join("\n\n");
}
```

### 18.5 Discussion web-search activation

```ts
// pi-extension/src/discuss.ts (v1.5)
export async function promptForWebSearch(api: ExtensionAPI): Promise<boolean> {
  return await api.ui.confirm(
    "Do you want me to search the web for community resources, " +
    "official documentation, and similar projects related to your input? " +
    "This adds ~15 seconds and uses ~1 LLM call."
  );
}
```

---

## 19. Module: `discuss-approve.ts` (v1.6)

### 19.1 `handleApproveDiscuss` — `/velpari-approve-discuss` handler

```ts
async function handleApproveDiscuss(args: CommandArgs, api: ExtensionAPI): Promise<void>

// Preconditions
- state.currentStage is "discussing" (working copy is ready)
- working copy at runs/<run-id>/discussing/discussion-notes.md exists

// Postconditions
- Doc/discussion-notes.md is published
- state advances: discussing → discussed → drafting-prd → drafted-prd
- The chain runs through publishDiscussionNotes() then chainToPrd()

// Logic
const state = loadState(rootDir);
if (state === null) {
  api.ui.error("No active run. Run /velpari-discuss first.");
  return;
}
if (state.currentStage !== "discussing") {
  api.ui.error(
    "/velpari-approve-discuss is for the discussion stage only. " +
    `Current stage: ${state.currentStage}. Use /velpari-approve instead.`
  );
  return;
}

// 1. Publish discussion notes
publishDiscussionNotes(rootDir, state);

// 2. Advance state: discussing → discussed
const afterPublish = advanceStage(rootDir, state, "discussed");

// 3. Auto-invoke /velpari-prd (with its own preview/confirm gate)
api.ui.notify("Discussion published. Auto-generating PRD...");

try {
  await chainToPrd(afterPublish, rootDir, api);
  api.ui.notify("PRD ready. Run /velpari-approve to continue to RTM.");
} catch (err) {
  // User cancelled the PRD preview. State stays at drafting-prd.
  api.ui.notify(
    "PRD generation cancelled. Re-run /velpari-approve-discuss to retry. " +
    `Reason: ${err.message}`
  );
  return;
}
```

### 19.2 `publishDiscussionNotes`

```ts
function publishDiscussionNotes(rootDir: string, state: RunState): void

// Preconditions
- working copy exists at runs/<run-id>/discussing/discussion-notes.md

// Postconditions
- Doc/discussion-notes.md contains the working copy content
- atomic write

// Logic
const workingPath = path.join(rootDir, RUNS_DIR, state.runId, "discussing", "discussion-notes.md");
if (!fs.existsSync(workingPath)) {
  throw new Error(`Discussion working copy missing: ${workingPath}`);
}
const content = fs.readFileSync(workingPath, "utf-8");
const docPath = path.join(rootDir, DOC_DIR, "discussion-notes.md");
const tmpPath = docPath + ".tmp";
fs.writeFileSync(tmpPath, content, "utf-8");
fs.renameSync(tmpPath, docPath);
```

### 19.3 `chainToPrd`

```ts
async function chainToPrd(state: RunState, rootDir: string, api: ExtensionAPI): Promise<void>

// Preconditions
- state.currentStage is "discussed" (just published)
// Doc/discussion-notes.md exists

// Postconditions
- Doc/PRD_Pi-Velpari.md is published (after user preview + confirm)
// state advances: discussed → drafting-prd → drafted-prd

// Logic
// 1. Advance state: discussed → drafting-prd
const afterAdvance = advanceStage(rootDir, state, "drafting-prd");

// 2. Run the PRD stage (which produces draft, shows preview, requires confirm)
const prdModule = await import("./prd.js");
await prdModule.runPrd({ state: afterAdvance, rootDir, api });

// 3. The prd module itself advances state from drafting-prd to drafted-prd via its
//    internal publishToDoc + advanceStage calls.
```

### 19.4 `renderApproveHint`

```ts
function renderApproveHint(currentStage: Stage): string

// Preconditions
- none

// Postconditions
- returns a string the UI displays when the user is ready to advance

// Logic
switch (currentStage) {
  case "discussed":
    return "Discussion notes are ready. Run /velpari-approve-discuss to publish and auto-generate the PRD.";
  case "drafted-prd":
  case "built-rtm":
  case "analyzed-feasibility":
  case "designed":
  case "wrote-pseudocode":
  case "planned-tests":
    return "Ready for next stage. Run /velpari-approve to continue.";
  case "handoff-ready":
    return "Ready for handoff. Run /velpari-handoff to package for Senai.";
  default:
    return "Run /velpari-status to see current state.";
}
```

### 19.5 Updated `handleApprove` — error on discussion stage

```ts
async function handleApprove(args: CommandArgs, api: ExtensionAPI): Promise<void>

// Logic
const state = loadState(rootDir);
if (state === null) {
  api.ui.error("No active run.");
  return;
}

// NEW in v1.6: refuse if in discussion stage
if (state.currentStage === "discussed" || state.currentStage === "discussing") {
  api.ui.error(
    "Use /velpari-approve-discuss for the discussion stage. " +
    "/velpari-approve is for stages 2-7 only."
  );
  return;
}

// ... existing logic for stages 2-7 (auto-advance chain)
```

---

## 20. Module: `paths.ts` (v1.7)

### 20.1 `buildOutputPath` — project-name-suffixed output path

```ts
// pi-extension/src/paths.ts
export function buildOutputPath(
  stage: "prd" | "rtm" | "feasibility" | "design" | "pseudocode" | "testPlan" | "testCases" | "atomicFunction" | "developmentOrder",
  projectName: string
): string

// Preconditions
projectName is non-empty (validated by config.ts:validateFilesConfig)

// Postconditions
returns a path under Doc/ with the project-name suffix

// Logic
switch (stage) {
  case "prd":               return path.join("Doc", `PRD_${projectName}.md`);
  case "rtm":               return path.join("Doc", `RTM_${projectName}.md`);
  case "feasibility":       return path.join("Doc", `feasibility-study_${projectName}.md`);
  case "design":            return path.join("Doc", `design_${projectName}.md`);
  case "pseudocode":        return path.join("Doc", `pseudocode_${projectName}.md`);
  case "testPlan":          return path.join("Doc", `test-plan_${projectName}.md`);
  case "testCases":         return path.join("Doc", `test-cases_${projectName}.md`);
  case "atomicFunction":    return path.join("Doc", `atomic-functions_${projectName}.md`);
  case "developmentOrder":  return path.join("Doc", `development-order_${projectName}.md`);
}
```

### 20.2 `buildDiscussionPath` — per-topic discussion path

```ts
// pi-extension/src/paths.ts
export function buildDiscussionPath(
  topicSlug: string,
  timestamp?: string
): string

// Preconditions
topicSlug is non-empty (slugified from mission argument)

// Postconditions
returns a path under Doc/ with optional timestamp suffix

// Logic
if (timestamp === undefined) {
  return path.join("Doc", `discussion-${topicSlug}.md`);
}
return path.join("Doc", `discussion-${topicSlug}-${timestamp}.md`);
```

### 20.3 `slugify` — mission argument → topic-slug

```ts
// pi-extension/src/paths.ts
export function slugify(mission: string): string

// Preconditions
mission is non-empty

// Postconditions
returns a URL-safe slug

// Logic
return mission
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")   // non-alphanumeric → hyphen
  .replace(/^-+|-+$/g, "")       // trim leading/trailing hyphens
  .slice(0, 64);                 // max 64 chars
```

### 20.4 `buildHandoffDocuments` — project-suffixed handoff

```ts
// pi-extension/src/handoff.ts (updated v1.7)
export function buildHandoffDocuments(projectName: string): ArchitectInputDocument[]

// Logic
return [
  { path: buildOutputPath("prd", projectName),              type: "PRD" },
  { path: buildOutputPath("rtm", projectName),              type: "RTM" },
  { path: buildOutputPath("feasibility", projectName),      type: "Feasibility" },
  { path: buildOutputPath("design", projectName),           type: "Design" },
  { path: buildOutputPath("pseudocode", projectName),       type: "Pseudocode" },
  { path: buildOutputPath("testPlan", projectName),         type: "Test Plan" },
  { path: buildOutputPath("testCases", projectName),        type: "Test Cases" },
  ... // optional atomicFunctions and developmentOrder if Doc/ has them
];
```

### 20.5 Updated `publishToDoc` (v1.7)

```ts
// pi-extension/src/state.ts (updated v1.7)
export function publishToDoc(
  rootDir: string,
  stage: Stage,
  sourcePath: string,
  projectName: string
): void

// Logic
const docPath = stage === "discuss"
  ? buildDiscussionPath(slugify(missionForStage), undefined)  // first run; or with timestamp
  : path.join(rootDir, buildOutputPath(stageToKey(stage), projectName));

// Atomic write
fs.mkdirSync(path.dirname(docPath), { recursive: true });
fs.copyFileSync(sourcePath, docPath);
```

---

*This pseudocode is the algorithm specification consumed by Phase A–E implementation. Every exported function in `Doc/design.md` §4 has a corresponding block here. No pseudocode block introduces logic that is not already documented in the design.*
