# Velpari v1.0 RPC E2E Test Report

- **Date:** 2026-09-03
- **Pi version:** 0.84.3 (installed)
- **Node version:** 22.22.1
- **Environment:** this sandbox (no API access to model providers)

## ⚠️  Blocked: Pi itself cannot start in this sandbox

The RPC E2E harness (`scripts/e2e-rpc-test.mjs`) was built per the plan. When run in this sandbox environment, **Pi's RPC mode produces 0 bytes of output and times out** after 5 seconds — even for the simplest `get_state` command.

Reproduced with:
- `pi --mode rpc --no-session`
- `pi --mode rpc --no-session --provider google --model gemini-2.5-flash`
- `pi --mode rpc --no-session --provider kimi-coding --model kimi-for-coding`
- `pi --mode json "test"`
- `pi --print "say hello"` (also 0 bytes)

All produce 0 stdout and time out. Pi is installed but cannot start because this environment has no API access for any model provider. `pi --list-models` works (it just reads local config), so the binary is functional — but actual model-dependent operations are blocked.

**Conclusion:** The harness CANNOT be executed in this environment. It must be run on a local machine with API access.

## What was achieved

| Deliverable | Status |
|---|---|
| `scripts/e2e-rpc-test.mjs` | DONE — ~270 LOC, full 10-step scenario, JSONL client, UI request router, file/state assertions, markdown report generator |
| Pre-flight verification | DONE — 7/7 gates pass (`scripts/e2e-preflight.sh`) |
| Harness execution | **BLOCKED** — Pi doesn't function in this sandbox |
| Report generation | PARTIAL — produced this document; full results pending harness run |

## What the user needs to do

To run the E2E test on a machine where Pi works:

```bash
cd /path/to/Pi-Velpari
npm run build
node scripts/e2e-rpc-test.mjs
```

**Prerequisites:**
- Pi 0.84.x installed (`pi --version`)
- Node 22.19.0+
- API key for at least one model provider (kimi-coding, google, anthropic, etc.)
- The extension built (the preflight script verifies this)

The harness will:
1. Spawn `pi --mode rpc --no-session --extension dist/pi-extension/src/index.js`
2. Run the 10-step scenario (get_commands, status, reset, doctor, configure-inputs, discuss, approve-discuss, approve, reset, compact)
3. Assert file states (Doc/, .IDE_Plans/, .pi/velpari/)
4. Produce `DevPlan/e2e-rpc-test-report.md` (overwrites this file)
5. Exit 0 (all pass), 1 (assertion failed), or 2 (harness error)

## Harness design (for reference)

The harness uses Pi's official RPC protocol:
- `pi --mode rpc` (JSONL over stdin/stdout)
- `prompt` command with `/velpari-*` messages → extension commands execute immediately
- `extension_ui_request` events for `ctx.ui.input`/`confirm`/`notify`/etc.
- `extension_ui_response` sends back user input
- `compact` command triggers `session_before_compact` hook (our extension's zero-LLM compaction handler)
- `bash` command runs shell commands for file verification

The harness automates the previously-manual phases of the original E2E plan.

## Findings from this sandbox investigation

While trying to run the harness, I discovered:
1. Pi's `--mode rpc` does NOT emit a `session` event (only `--mode json` does). The harness was updated to skip that wait.
2. Pi requires API access even for state queries like `get_state` (it must initialize the model runtime before responding).
3. The harness can detect this and exit gracefully (the test framework wraps everything in try/catch and produces a meaningful report).

## Next steps

1. **User runs the harness locally** on a machine with API access
2. Report produced at `DevPlan/e2e-rpc-test-report-2026-09-03.md` (overwrites this)
3. Any bugs found → create separate fix plans in `.IDE_Plans/`
4. Once harness passes 0 failures, declare v1.0 production-ready
