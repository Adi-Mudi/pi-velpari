# Velpari E2E Reliability Fix Plan

- Confidence: 95%
- Version: v1.0
- Status: DONE

## Purpose

Fix the Velpari E2E Doctor timeout by replacing the fragile interactive PiIntegrationTest flow with deterministic RPC tests modeled on the Pi-Senai E2E architecture.

## Documents

- Truth: `/mnt/Just_Do_It/02_Devp_Soft/12_orchestra/Pi-Velpari/AGENTS.md` and current Velpari behavior.
- References: `pi-seani/pi-extension/test/e2e/helpers/rpc-client.ts`, `pi-seani/pi-extension/test/e2e/helpers/test-home.ts`, `pi-seani/pi-extension/test/e2e/12-doctor-cadence.test.ts`, `pi-seani/pi-extension/test/e2e/15-doctor-full-run.test.ts`, `pi-seani/package.json`, `pi-seani/.github/workflows/e2e.yml`, and the Velpari E2E files.
- Targets: `pi-extension/test/e2e/helpers/rpc-client.ts`, `pi-extension/test/e2e/helpers/test-home.ts`, `pi-extension/test/e2e/helpers/fixtures.ts`, `pi-extension/test/e2e/doctor.e2e.test.ts`, `pi-extension/test/e2e/registration.e2e.test.ts`, `pi-extension/test/e2e/_setup.ts`, `pi-extension/test/e2e/README.md`, `package.json`, `package-lock.json`, and `.github/workflows/e2e.yml`.
- Dependencies: Node built-ins, existing Pi RPC process, existing built `runDoctor` module, existing TypeScript test runner, and current Velpari test-home patterns.
- Tests: `npm run build`, `npm test`, `RUN_E2E=1 npm run test:e2e`, optional Tier 2 E2E, and `git diff --check`.

## Completed changes

1. Added strict JSONL RPC client for `pi --mode rpc --no-session`.
2. Added synthetic E2E home and isolated project directory.
3. Added deterministic Tier 1 and Tier 2 gates.
4. Replaced interactive Doctor test with RPC `bash` direct Doctor invocation.
5. Added RPC registration coverage.
6. Added E2E scripts and removed the unused `pi-coding-agent-test` dependency.
7. Added GitHub Actions E2E tiers and E2E documentation.
8. Preserved unrelated runtime code and existing user changes.

## Validation results

- `npm run build`: PASS
- `npm test`: 450 passed, 0 failed
- `RUN_E2E=1 npm run test:e2e`: 5 passed, 0 failed
- Tier 1 does not require a real LLM key.
- `git diff --check`: PASS
- Final code review: PASS

## Retrospective

- What went well: The real Pi RPC process ran successfully, extension registration was verified, and Doctor output/report assertions completed without the previous 30-second settlement timeout.
- What failed: The original interactive Doctor test wrote the report but timed out because Pi did not settle. The new RPC path removed that dependency.
- What to improve next time: Keep deterministic Tier 1 E2E no-LLM and real-LLM Tier 2 separated; add future real-agent tests only to the Tier 2 script.
