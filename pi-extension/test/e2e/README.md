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
| `registration.e2e.test.ts`        | 1    | Extension loads into Pi + `get_commands` lists `/velpari-doctor` and `/velpari-show-prd`    |
| `doctor.e2e.test.ts`              | 1    | Extension loads + `runDoctor` writes its on-disk report and emits the expected `## ` sections |

The doctor command was chosen as the smoke test because it has **no
interview loop, no LLM call, and no subagent fan-out** — it just runs
the audit, writes the report, and notifies the user. This makes it the
right first target for validating the e2e infrastructure itself.

## Why no per-stage e2e tests yet

The eight stage handlers (`/velpari-prd`, `/velpari-rtm`, ...,
`/velpari-development-order`) and the discuss handler all drive their
interviews through **`ctx.ui.input` / `ctx.ui.confirm`**. In a real Pi
session these are wired to the TUI prompt UI. In an RPC session
`ctx.ui.input` blocks waiting for user input that never arrives.

RPC `prompt` calls do not solve this — they drive the LLM side of the
conversation, but the stage handlers still ask the user via
`ctx.ui.input`. There is currently no documented RPC surface for
responding to `ctx.ui.input` / `ctx.ui.confirm`.

Per-stage coverage therefore lives in unit tests (`test/*.test.ts`)
until either Pi exposes an RPC scripting API for `ctx.ui.input` or
the handlers are refactored to use scripted primitives.

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
