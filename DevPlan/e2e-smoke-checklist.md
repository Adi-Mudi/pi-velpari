# Velpari v1.0 E2E Smoke Checklist

Date: ____________
Pi version: ____________
Node version: ____________
Tester: ____________

**Run from a real Pi session** (`pi` in the terminal). For each command, run the invocation and check the result.

## Phase 3 — Smoke test all 23 commands

| # | Command | Test invocation | Expected | Result |
|---|---|---|---|---|
| 1 | `/velpari-discuss` | `/velpari-discuss test-mission` | Starts interview loop | ☐ |
| 2 | `/velpari-discuss` (empty) | `/velpari-discuss` (no args) | Error: "Usage: /velpari-discuss <topic>" | ☐ |
| 3 | `/velpari-prd` | `/velpari-prd` | Error: "Project name not set" | ☐ |
| 4 | `/velpari-rtm` | `/velpari-rtm` | Error: "Project name not set" | ☐ |
| 5 | `/velpari-feasibility` | `/velpari-feasibility` | Error: "Project name not set" | ☐ |
| 6 | `/velpari-design` | `/velpari-design` | Error: "Project name not set" | ☐ |
| 7 | `/velpari-pseudocode` | `/velpari-pseudocode` | Error: "Project name not set" | ☐ |
| 8 | `/velpari-testplan` | `/velpari-testplan` | Error: "Project name not set" | ☐ |
| 9 | `/velpari-atomic-function` | `/velpari-atomic-function` | Stub notification "Phase A stub" | ☐ |
| 10 | `/velpari-development-order` | `/velpari-development-order` | Stub notification "Phase A stub" | ☐ |
| 11 | `/velpari-approve` | `/velpari-approve` | Error: "No active discussion" | ☐ |
| 12 | `/velpari-approve-discuss` | `/velpari-approve-discuss` | Error: "No active discussion" | ☐ |
| 13 | `/velpari-status` | `/velpari-status` | "No active Velpari run." | ☐ |
| 14 | `/velpari-reset` | `/velpari-reset` | "No active run to reset." | ☐ |
| 15 | `/velpari-reset` (decline) | Confirm "no" | "Reset cancelled." | ☐ |
| 16 | `/velpari-configure-inputs` | `/velpari-configure-inputs` | Starts multi-step prompts | ☐ |
| 17 | `/velpari-doctor` | `/velpari-doctor` | Audit report | ☐ |
| 18 | `/velpari-handoff` | `/velpari-handoff` | Error: "No active run" | ☐ |
| 19 | `/velpari-show-discussion` | `/velpari-show-discussion` | Error: missing run | ☐ |
| 20 | `/velpari-show-prd` | `/velpari-show-prd` | Error: missing projectName | ☐ |
| 21 | `/velpari-show-rtm` | (after config) | Stub behavior | ☐ |
| 22 | `/velpari-show-feasibility` | (after config) | Stub behavior | ☐ |
| 23 | `/velpari-show-design` | (after config) | Stub behavior | ☐ |
| 24 | `/velpari-show-pseudocode` | (after config) | Stub behavior | ☐ |
| 25 | `/velpari-show-testplan` | (after config) | Stub behavior | ☐ |

## Notes

_(Record observations, bugs, and timing here)_

## Summary

| Metric | Count |
|---|---|
| Total commands tested | __ |
| Pass | __ |
| Fail | __ |
| Bugs found | __ |
