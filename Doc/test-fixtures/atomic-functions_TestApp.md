---
artifact: atomic-functions
project: TestApp
version: 1.0.0
status: published
stage: analyzed-atomic-functions
run: 2026-09-17-1400-fixture
atomicTier: basic
safetyClass: A
sil: none
standardsOverlay: null
created: 2026-09-17T14:00:00.000Z
updated: 2026-09-17T14:00:00.000Z
reviewerVerdictPath: .IDE_Plans/velpari/runs/2026-09-17-1400-fixture/atomic-function/scouts/reviewer-report.json
---

# Atomic Functions — TestApp

## Summary
- Tier: Basic (ISO/IEC 29110 basic profile, IEC 62304 Class A)
- Total atomic functions: 3
- Safety class: A (loss-of-comfort)
- SIL: none

## Atomic Functions

| AF ID | Name | File Path | Signature | Purpose | Source | Cohesion | Verification | Testable | Called by FRs | Design ref | Extracted from | Satisfies FR | Feasibility ref |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AF-1 | parseInput | src/utils/parse-input.ts | function parseInput(s: string): string | Parses user input per RFC 5322 | RTM | perfect-atomic | Test | yes | FR-1, FR-2 | §3.1 | — | FR-1 | §4.2 |
| AF-2 | validateEmail | src/utils/validate-email.ts | function validateEmail(email: string): boolean | Validates email against RFC 5322 | PRD | perfect-atomic | Test | yes | FR-3 | §3.2 | — | FR-3 | §4.2 |
| AF-3 | hashPassword | src/utils/hash-password.ts | function hashPassword(pw: string): string | Hashes password via bcrypt cost-12 | RTM | perfect-atomic | Test | yes | FR-7 | §3.5 | — | FR-7 | §4.5 |

## Cross-references

| AF | Used by |
|---|---|
| AF-1 | FR-1 (input validation), FR-2 (input parsing) |
| AF-2 | FR-3 (auth flow — email step) |
| AF-3 | FR-7 (auth flow — password step) |

## Change Log

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-09-17 | Initial atomic-function split (basic tier) — 3 leaf functions extracted from helper `parseUserCredential` |