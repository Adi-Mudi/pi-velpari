/**
 * Shared test helper: build a minimal-but-complete project cwd for
 * doctor-check integration tests.
 *
 * Phase 3: extracted from approve-real-cwd.test.ts so every doctor check
 * can share one fixture. The helper writes:
 *   - .pi/velpari/files.json (v4, projectName=TestApp)
 *   - .pi/velpari/requirements-profile.json (core-psrs-v1)
 *   - .pi/velpari/standards-profile.json (none overlay)
 *   - .pi/velpari/agents.json (empty mapping)
 *   - Doc/requirements/PRD_TestApp.md + RTM_TestApp.{md,json}
 *
 * It does NOT write the per-stage working-copy file — each doctor check
 * test supplies its own stage-specific artifact.
 */

import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export const TEST_PROJECT = "TestApp";

const FILES_JSON = {
	version: 4,
	projectName: TEST_PROJECT,
	framework: { language: "typescript" },
	codePaths: ["src"],
	testPaths: ["test"],
	docPaths: ["Doc"],
	excludedPaths: ["node_modules"],
};

const REQUIREMENTS_PROFILE = {
	version: 1,
	profileId: "core-psrs-v1",
	profileKind: "common-core",
	applicationType: "general",
	domain: "general",
	developmentMethod: "agile",
	regulated: false,
	outputVariant: "standard",
};

const STANDARDS_PROFILE = {
	id: "none",
	version: "1.0.0",
	selectedAt: "2026-09-14T00:00:00.000Z",
	selectedBy: "test",
};

/**
 * Minimal PSRS-shaped PRD content (matches what approve-real-cwd.test.ts uses).
 */
export const PSRS_FM = `---
artifact: prd
project: ${TEST_PROJECT}
stage: drafted-prd
run: 2026-01-01-00-00-test
version: 1
generatedAt: 2026-09-14T00:00:00.000Z
---

# PRD — ${TEST_PROJECT}

## Objective
Test objective

## Problem
Test problem

## System Actors
- end user

## User Stories
| ID | Role | Want | So that | Status |
|---|---|---|---|---|
| US-01 | user | a thing | benefit | proposed |

## Scope
In: core feature. Out: payments.

## MVP
Phase 1.

## Success Metrics
| Metric | Target |
|---|---|
| latency p95 | < 200ms |

## Phases
| Phase | Goal |
|---|---|
| 1 | MVP |

## Functional Requirements
| ID | Requirement | Status |
|---|---|---|
| FR-01 | The system shall accept text input. | proposed |

## Non-Functional Requirements
| ID | Requirement | Status |
|---|---|---|
| NFR-01 | p95 < 200ms. | proposed |

## Data and Interfaces
Test data section.

## Errors and Edge Cases
Empty input → error.

## Constraints
None.

## Dependencies and Risks
None.

## Out of Scope
Payments.

## Open Questions
None.

## Acceptance Criteria
US-01 verified.

## Helper Function Candidates
None.

## Glossary
- MVP: minimum viable product.

## Change Log
- 2026-09-14: initial draft.
`;

export const RTM_JSON = {
	version: 1,
	rows: [
		{
			id: "RTM-01",
			requirementId: "FR-01",
			design: "design_TestApp.md",
			pseudocode: "pseudocode_TestApp.md",
			test: "test-plan_TestApp.md",
			phase: 1,
			status: "verified",
		},
	],
};

/** Writes the minimal-but-complete project tree into `cwd`. */
export function setupFullCwd(cwd: string): void {
	const vpDir = join(cwd, ".pi", "velpari");
	mkdirSync(vpDir, { recursive: true });
	writeFileSync(join(vpDir, "files.json"), JSON.stringify(FILES_JSON, null, 2));
	writeFileSync(join(vpDir, "requirements-profile.json"), JSON.stringify(REQUIREMENTS_PROFILE, null, 2));
	writeFileSync(join(vpDir, "standards-profile.json"), JSON.stringify(STANDARDS_PROFILE, null, 2));
	writeFileSync(join(vpDir, "agents.json"), JSON.stringify({ version: 1, agents: {} }));

	const docReqDir = join(cwd, "Doc", "requirements");
	mkdirSync(docReqDir, { recursive: true });
	writeFileSync(join(docReqDir, `PRD_${TEST_PROJECT}.md`), PSRS_FM, "utf8");
	writeFileSync(join(docReqDir, `RTM_${TEST_PROJECT}.md`), "# RTM\n", "utf8");
	writeFileSync(join(docReqDir, `RTM_${TEST_PROJECT}.json`), JSON.stringify(RTM_JSON, null, 2) + "\n", "utf8");
}

/** Removes the cwd if it was created with mkdtempSync — convenience helper. */
export function cleanupCwd(cwd: string): void {
	if (existsSync(cwd)) {
		rmSync(cwd, { recursive: true, force: true });
	}
}

/** Writes a minimal but valid PRD-shaped file to cwd/Doc/requirements. */
export function writePublishedPrd(cwd: string, projectName = TEST_PROJECT): string {
	const dir = join(cwd, "Doc", "requirements");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `PRD_${projectName}.md`);
	writeFileSync(path, PSRS_FM, "utf8");
	return path;
}
