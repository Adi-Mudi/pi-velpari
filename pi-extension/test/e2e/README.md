# Velpari E2E tests

This directory holds **end-to-end tests** that load the built extension
into a real Pi session via [`pi-coding-agent-test`](https://www.npmjs.com/package/pi-coding-agent-test)
and exercise a full command.

## Running

```bash
npm run build        # required — tests load dist/pi-extension/src/index.js
RUN_E2E=1 npm run test:e2e
```

Prerequisites (checked by `_setup.ts:e2eEnabled()`):

- `RUN_E2E=1` (developer opt-in — CI never sets this)
- `pi` executable on `$PATH`
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` set
- `dist/pi-extension/src/index.js` exists

If any condition is missing, e2e tests skip silently — `npm test` does
not fail when e2e is unavailable.

## Current coverage

| Test                                | What it proves                                          |
| ----------------------------------- | ------------------------------------------------------- |
| `doctor.e2e.test.ts` (smoke)        | Extension loads into Pi + `/velpari-doctor` runs + writes its report |

The doctor command was chosen as the smoke test because it has **no
interview loop and no LLM-driven subagent fan-out** — it just runs the
audit, writes the report, and notifies the user. This makes it the
right first target for validating the e2e infrastructure itself.

## Why no per-stage e2e tests yet

The eight stage handlers (`/velpari-prd`, `/velpari-rtm`,
`/velpari-feasibility`, `/velpari-design`, `/velpari-pseudocode`,
`/velpari-testplan`, `/velpari-atomic-function`,
`/velpari-development-order`) and the discuss handler all drive their
interviews through **`ctx.ui.input` / `ctx.ui.confirm`**. In a real Pi
session these are wired to the TUI prompt UI. In a test session
`ctx.ui.input` blocks waiting for user input that never arrives.

`pi-coding-agent-test`'s scripted conversation (`assistantMessage`,
`text`, etc.) is the LLM side — it cannot answer `ctx.ui.input` prompts.
There is currently **no documented scripting API for `ctx.ui.input` /
`ctx.ui.confirm` responses** in `pi-coding-agent-test@0.1.x`.

### Options to break this blocker

1. **Add an upstream scripting API.** File an issue / PR against
   `pi-coding-agent-test` to allow the test framework to inject canned
   responses for `ctx.ui.input` and `ctx.ui.confirm`. This is the cleanest
   fix but requires upstream coordination.

2. **Refactor Velpari handlers to use AskUserQuestion (LLM-driven).**
   `AskUserQuestion` is part of the scripted conversation surface — the
   test framework can supply answers via the `assistantMessage` stream.
   This is a larger architectural change because all 8 stage handlers +
   discuss + configure-inputs would need to switch UI primitives. Risk:
   changes the user-facing UX (TUI prompts vs. LLM-driven Q&A).

3. **Add a `VELPARI_SKIP_INTERVIEW=1` test escape hatch to handlers.**
   Pollutes production code with a debug switch. Rejected as a long-term
   solution but acceptable as a one-off for stage e2e if the user prefers.

**Current decision:** stop at doctor smoke + this gap doc. Stage e2e
tests are deferred until one of the three options above lands. The
doctor smoke test is enough to prove the e2e infrastructure works end
to end (extension loads, command registers, handler executes, output
file is produced).

## Adding a new e2e test

Use `doctor.e2e.test.ts` as the template. Key pieces:

```ts
import { PiIntegrationTest, testArtifactsDir } from "pi-coding-agent-test";
import { EXTENSION_PATH, e2eEnabled } from "./_setup.js";

const t = e2eEnabled() ? test : test.skip;

t("my test name", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "velpari-e2e-XXX-"));
  try {
    const result = await new PiIntegrationTest({
      testName: "my-test",
      artifactsDir: testArtifactsDir(import.meta.filename),
      cwd: workspace,
      extensions: [EXTENSION_PATH],
      conversation: [/* scripted LLM messages */],
    }).run("/velpari-XXX <args>");

    // Assert on `result` AND on files written under `workspace`.
    assert.ok(/* ... */);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
```

If your test drives a handler that calls `ctx.ui.input` or
`ctx.ui.confirm`, expect the test to hang — that is the blocker
documented above. Prefer testing such handlers via unit tests
(`test/commands.test.ts`-style) until the blocker is resolved.
