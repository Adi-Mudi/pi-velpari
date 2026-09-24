# Velpari E2E tests

This directory holds **end-to-end tests** that drive a real `pi` process
via its `--mode rpc` interface. Tests use:

- `helpers/rpc-client.ts` — strict JSONL RPC client (`pi --mode rpc
  --no-session`). Adapted from Pi-Senai's RpcClient and built around the
  same edge cases (stderr capture, response matching, timeouts, idle
  wait, LF-only JSONL framing, `prompt` `text`→`message` normalization).
- `helpers/test-home.ts` — synthetic temp project + HOME + XDG dirs +
  extension symlink. Symlinks the BUILT extension
  (`dist/pi-extension/src/`) into `~/.pi/agent/extensions/pi-velpari` so
  the same compiled artifact is reachable both through Pi's discovery
  path and through the `distModuleUrl()` helper used by `bash` RPC
  imports.
- `helpers/fixtures.ts` — minimal project layout + `.pi/velpari/files.json`
  seeder.

## Tier 1 / Tier 2 split

The E2E suite is gated by `_setup.ts` and `helpers/test-home.ts`:

| Tier | Trigger                                    | What it proves                                            |
| ---- | ------------------------------------------ | --------------------------------------------------------- |
| 1    | `RUN_E2E=1`, `pi` on `$PATH`, build present | Extension loads into Pi + `/velpari-doctor` runs + report written |
| 2    | Tier 1 + `RUN_LLM_E2E=1` + real LLM key     | Reserved for future LLM-driven stages                     |

**Tier 1 needs no LLM key.** The doctor and registration tests never
invoke `prompt`. They exercise the registration (`get_commands`) and
the deterministic `runDoctor` module (called via the RPC `bash` channel
that imports the built JS directly).

## Running

```bash
npm run build        # required — tests load dist/pi-extension/src/index.js
RUN_E2E=1 npm run test:e2e
```

Prerequisites (checked by `_setup.ts:getTier1SkipReason()`):

- `RUN_E2E=1` (developer opt-in — CI sets this on every PR)
- `pi` executable on `$PATH` (npm-installed `@mariozechner/pi-coding-agent`
  is fine)
- `dist/pi-extension/src/index.js` exists (run `npm run build` first)

If any condition is missing, Tier 1 tests skip silently — `npm test`
does not fail when e2e is unavailable.

Tier 2 additionally requires:

- `RUN_LLM_E2E=1`
- A recognized provider key (`ANTHROPIC_API_KEY` /
  `OPENAI_API_KEY` / `GOOGLE_API_KEY` / `MISTRAL_API_KEY` /
  `KIMI_API_KEY`) set to a real value. The CI dummy
  `sk-ant-e2e-dummy-not-used` is intentionally treated as missing so
  the gate does not leak to local runs.

## Current coverage

| Test                              | Tier | What it proves                                                                              |
| --------------------------------- | ---- | ------------------------------------------------------------------------------------------- |
| `registration.e2e.test.ts`        | 1    | Extension loads into Pi + every `COMMAND_NAMES` entry (imported from the source, so the count can never drift) appears in `get_commands` |
| `doctor.e2e.test.ts`              | 1    | Extension loads + `runDoctor` writes its on-disk report and emits the expected `## ` sections |
| `config.e2e.test.ts`              | 1    | files.json v3→v4 migration on load; `discoverProjectFiles` honours excludedPaths; agents.json absent = all defaults (never auto-created); save→load→resolve→validate round-trip; `discoverAgents` dedup across project/user/bundled sources |
| `stage-gates.e2e.test.ts`         | 1    | Walking `STAGE_TRANSITIONS` from `brainstorming` reaches `handoff-ready` (19 states) with on-disk state in sync; illegal jumps throw `Cannot transition`; all 6 core stage commands hard-block at the wrong stage with nothing handed to the LLM; `runStage("prd")` gate-pass hands off exactly one prompt |
| `brainstorm-gates.e2e.test.ts`    | 1    | Mutation lock blocks edit/write outside the brainstorm folder and lifts after approve; approve hard-blocks on unconfirmed understanding / open question / `_TBD_` notes; happy path publishes + writes audit log + clears session fields + chains into PRD |
| `ops-doctor.e2e.test.ts`          | 1    | Doctor agent-mapping section renders; status appendEntry + footer setStatus; reset cancel/confirm; show-prd legacy-flat fallback; handoff hard-blocks at the wrong stage and writes a schema-valid `.pi/senai/architect-inputs.json` at `planned-tests` |
| `generate-sub-agents.e2e.test.ts` | 1    | `/velpari-generate-sub-agents` registers (L3 wiring intact) + the doctor's generator-completeness / generated-agent-freshness / verifier-verdict sections render |
| `migrate-store.e2e.test.ts`       | 1    | `/velpari-migrate-store` through a real `pi`: `migrateDryRun` writes nothing, `migrateExecute` creates the store DB + the exported YAML beside it and commits `velpari(migrate): <project> (run migrated)`, then the doctor's store/data checks are clean on the migrated project |
| `tier2-brainstorm-only.test.ts`   | 2    | Tier 2 scaffold: the harness precondition (LLM flag + real key) for a `/velpari-brainstorm` run — the LLM flow itself is not exercised yet |

**Shipped publish default (DB-only).** Since Phase 11 an approve publishes to
the **store DB + the exported YAML beside it + a git commit** and writes **no
markdown** to `Doc/` — the `Doc/` markdown you may still see is legacy history
or the opt-in write-alongside hatch (`files.json:velpari.markdownWrites`), and
`/velpari-export` is the way to download a human view. E2E suites that assert
on `Doc/` markdown must therefore either enable that hatch or expect no files.

The doctor command was chosen as the smoke test because it has **no
interview loop, no LLM call, and no subagent fan-out** — it just runs
the audit, writes the report, and notifies the user. This makes it the
right first target for validating the e2e infrastructure itself.

## What the stage suites cover (and what they cannot)

The nine stage handlers (`/velpari-prd`, `/velpari-rtm`, ...,
`/velpari-development-order`) hand off to the parent LLM, which drives the
scout fan-out per the stage skill. The brainstorm handler (lifecycle v2) no
longer runs a `ctx.ui.input` / `ctx.ui.confirm` interview — the interview
is conversational, owned by the parent LLM via the `velpari-brainstorm`
skill and the `velpari_brainstorm_session` tool.

The deterministic part of every stage — the sequence gate, input
resolution, state transitions, approve hard-blocks, publish, handoff —
IS covered end-to-end: the suites above call the real built handlers
(`runStage`, `handleApproveBrainstorm`, `runHandoff`, ...) through the RPC
`bash` channel with capture fakes for `ctx.ui.*` / `pi.sendUserMessage`,
so everything up to (and including) the prompt hand-off is asserted
against real state files. The LLM fan-out after the hand-off stays Tier 2
(needs a scripted conversation the current RPC harness does not support —
see the `prompt` bug note below).

## Why the RPC + bash channel instead of `PiIntegrationTest`

The earlier smoke test used `pi-coding-agent-test`'s `PiIntegrationTest`,
which runs `pi --mode rpc` under the hood but wraps it with a scripted
LLM conversation and a settle detector. On real `pi` versions that
detector never observed `/velpari-doctor` as complete, and the test
hung at the 30s settle timeout even though Doctor had already written
its report.

The new flow side-steps the issue:

1. The RPC client (`helpers/rpc-client.ts`) speaks raw JSONL. No
   scripted conversation, no settle wait.
2. The doctor test imports the built `runDoctor` module directly via
   the RPC `bash` channel — same compiled JS that Pi loads, executed
   in the temp project's cwd, JSON-encoded output piped back.
3. The on-disk report is written the same way (`writeDoctorReport` from
   the same module) so the side effect matches a real `/velpari-doctor`
   invocation.

The result is a deterministic Tier 1 test that finishes in seconds and
proves both that the extension was loaded by a real `pi` process
(registration test) and that the doctor module produces the expected
sections and writes the report to disk.

## Adding a new e2e test

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { RpcClient } from "./helpers/rpc-client.js";
import {
  makeTestHome,
  distModuleUrl,
  shouldRunE2E,
  type TestHome,
} from "./helpers/test-home.js";
import { makeMinimalProjectFiles, seedVelpariConfig } from "./helpers/fixtures.js";
import { tier1Enabled, describeTier1Skip } from "./_setup.js";

const SKIP_MESSAGE = "Tier 1 E2E tests require pi binary on PATH, RUN_E2E=1, and a built extension";

describe("e2e/<your-suite>", () => {
  let home: TestHome | undefined;
  let client: RpcClient | undefined;

  before(async () => {
    if (!shouldRunE2E()) return;
    home = makeTestHome({ files: makeMinimalProjectFiles() });
    seedVelpariConfig(home, { projectName: "E2EFixture" });
    client = new RpcClient({ env: home.env, cwd: home.cwd });
  });

  after(async () => {
    if (client) await client.close();
    if (home) home.cleanup();
  });

  it("...", { timeout: 60_000 }, async (t) => {
    if (!tier1Enabled()) return t.skip(`${SKIP_MESSAGE}: ${describeTier1Skip()}`);
    assert.ok(client && home, "test setup missing");
    // ... RPC calls go here. Use `await client.request<T>("rpc-type", { ... })`
    // or one of the typed wrappers (getCommands, getState, ...).
  });
});
```

If your test needs to run deterministic Node code inside the temp
project, drive it via the RPC `bash` channel and import the built
module via `distModuleUrl("module-name.js")`:

```ts
const result = await client.request<any>("bash", {
  command: `node --input-type=module -e "import { runFoo } from '${distModuleUrl("foo.js")}'; process.stdout.write(JSON.stringify(runFoo(process.cwd())))"`,
});
assert.ok(result.success);
const output = result.data?.output ?? result.output ?? "";
const payload = JSON.parse(output);
```

Avoid `client.request("prompt", ...)` — Pi 0.84.3 has a known
RPC-prompt-handler bug (`Cannot read properties of undefined (reading
'startsWith')`). If a future test genuinely needs prompt scripting,
gate it on `isPiRpcPromptBug(err)` and `t.skip()` accordingly.

**Shell-safety rule for embedded scripts:** the `bash` channel command is
a double-quoted shell string, so the embedded `-e` script must not
contain backticks or `${...}` — bash would expand them before node ever
sees the source. Use single-quoted strings and `+` concatenation inside
embedded scripts (see `stage-gates.e2e.test.ts` / `brainstorm-gates.e2e.test.ts`
for the pattern).
